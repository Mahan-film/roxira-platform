import { EInvoiceType, InvoiceDirection, InvoiceSubject } from '../invoicing/enums/invoice-kind.enum';
import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { KeyObject, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'crypto';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { InvoicingService } from '../invoicing/services/invoicing.service';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { CreateMoadianTables1789310000000 } from '../../migrations/1789310000000-CreateMoadianTables';
import {
  MOADIAN_ENV,
  MOADIAN_POLL_JOB,
  MOADIAN_SANDBOX_BASE_URL,
  MOADIAN_SEND_JOB,
  MOADIAN_SYNC_STATUS_JOB,
} from './constants/moadian.constants';
import { MoadianProcessor } from './processors/moadian.processor';
import { MoadianController } from './controllers/moadian.controller';
import { MoadianCredentialEntity } from './entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from './entities/moadian-submission.entity';
import {
  MoadianBuyerType,
  MoadianInvoiceType,
  MoadianSettlementMethod,
  MoadianSubmissionStatus,
} from './enums/moadian.enum';
import { MoadianRepository } from './repositories/moadian.repository';
import { FetchLike, MoadianApiClient } from './services/moadian-api.client';
import { MoadianService } from './services/moadian.service';
import {
  decryptMoadianJwe,
  encryptMoadianJwe,
  signMoadianJws,
  verifyMoadianJws,
} from './utils/moadian-jose.util';
import {
  MoadianMappingContext,
  MoadianMappingError,
  mapInvoiceToMoadianPacket,
} from './utils/moadian-packet.mapper';
import {
  generateMoadianTaxId,
  isValidMoadianTaxId,
  verhoeffCheckDigit,
  verhoeffValidate,
} from './utils/moadian-tax-id.util';
import { openSecret, parseMasterKey, sealSecret } from './utils/secret-box.util';

// -----------------------------------------------------------------------------
// Test-only key material, generated at runtime. No key is committed.
// -----------------------------------------------------------------------------

function der(tag: number, content: Buffer): Buffer {
  const len = content.length;
  let header: Buffer;
  if (len < 0x80) {
    header = Buffer.from([tag, len]);
  } else {
    const bytes: number[] = [];
    for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    header = Buffer.from([tag, 0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([header, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const SHA256_RSA = seq(
  der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])),
  der(0x05, Buffer.alloc(0)),
);
function name(cn: string): Buffer {
  const cnOid = der(0x06, Buffer.from([0x55, 0x04, 0x03]));
  return seq(der(0x31, seq(cnOid, der(0x0c, Buffer.from(cn, 'utf8')))));
}

/** گواهی خودامضای حداقلی (X.509 v1) فقط برای آزمون. */
function selfSignedCertificate(privateKey: KeyObject, publicKey: KeyObject, cn: string): string {
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const validity = seq(
    der(0x17, Buffer.from('250101000000Z', 'ascii')),
    der(0x17, Buffer.from('351231235959Z', 'ascii')),
  );
  const tbs = seq(der(0x02, Buffer.from([0x01])), SHA256_RSA, name(cn), validity, name(cn), spki);
  const signature = sign('sha256', tbs, privateKey);
  const cert = seq(tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const b64 = cert.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

function testKeys(cn: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKey,
    certificatePem: selfSignedCertificate(privateKey, publicKey, cn),
  };
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INVOICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const tenantKeys = testKeys('Roxira Test Taxpayer');
const taxOrgKeys = testKeys('Test Tax Org');
const taxOrgPublicKeyB64 = (
  taxOrgKeys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
).toString('base64');
const masterKeyB64 = randomBytes(32).toString('base64');

function buildInvoice(overrides: Partial<InvoiceResponseDto> = {}): InvoiceResponseDto {
  return {
    id: INVOICE_A,
    taxInvoiceNumber: 'TI-A-1',
    direction: InvoiceDirection.SALE,
    einvoiceType: EInvoiceType.WITH_BUYER,
    subject: InvoiceSubject.ORIGINAL,
    relatedInvoiceId: null,
    warehouseId: null,
    customerId: null,
    sellerInfo: { name: 'Seller', economicCode: '10101010101' },
    buyerInfo: { name: 'Buyer', nationalId: '0012345678', economicCode: '00123456780012' },
    items: [
      {
        description: 'Consulting',
        quantity: 2,
        unitPrice: 1_000_000,
        discount: 100_000,
        vatRate: 0.1,
        tax: 190_000,
        total: 2_090_000,
      },
      {
        description: 'Book (VAT exempt)',
        quantity: 1,
        unitPrice: 500_000,
        discount: 0,
        vatRate: 0,
        tax: 0,
        total: 500_000,
      },
    ],
    currency: Currency.IRR,
    jurisdiction: InvoiceJurisdiction.IR,
    exchangeRate: 1,
    fxRate: 1,
    amountFx: null,
    baseCurrency: Currency.USD,
    totalAmount: 2_500_000,
    totalDiscount: 100_000,
    invoiceDiscount: 0,
    totalTax: 190_000,
    finalPayable: 2_590_000,
    baseTotalAmount: 0,
    baseTotalTax: 0,
    baseFinalPayable: 0,
    status: InvoiceStatus.ISSUED,
    issuedAt: new Date('2026-10-22T08:30:00Z'),
    paidAt: null,
    journalEntryId: null,
    paidJournalEntryId: null,
    reversalJournalEntryId: null,
    postingError: null,
    createdAt: new Date('2026-10-22T08:00:00Z'),
    ...overrides,
  };
}

const mappingContext: MoadianMappingContext = {
  memoryId: 'A1B2C3',
  sellerEconomicCode: '10101010101',
  serial: 1,
  defaultSstid: '2330001234567',
  defaultMeasurementUnit: '1627',
  settlementMethod: MoadianSettlementMethod.CASH,
};

// -----------------------------------------------------------------------------
// Tax ID (شماره منحصربه‌فرد مالیاتی)
// -----------------------------------------------------------------------------

describe('Moadian tax id', () => {
  it('computes textbook Verhoeff check digits', () => {
    expect(verhoeffCheckDigit('236')).toBe(3);
    expect(verhoeffCheckDigit('12345')).toBe(1);
    expect(verhoeffValidate('2363')).toBe(true);
    expect(verhoeffValidate('2364')).toBe(false);
  });

  // Expected values computed with the independent Python reference
  // implementation (PyPI `moadian` 1.0.4, utils.generate_tax_id + verhoeff.checkSum).
  it.each([
    ['A1B2C3', '2026-10-22T08:30:00Z', 1, 'A1B2C30510C00000000019'],
    ['A11216', '2023-05-01T00:00:00Z', 123456, 'A1121604C16000001E2401'],
    ['ZZZ999', '2026-01-01T23:59:59Z', 0xff_ffff_ffff, 'ZZZ99904FE6FFFFFFFFFF3'],
    ['000000', '1970-01-01T00:00:00Z', 0, '0000000000000000000003'],
  ])('generates %s / %s / %d -> %s', (memoryId, iso, serial, expected) => {
    const taxId = generateMoadianTaxId(memoryId, Date.parse(iso), serial);
    expect(taxId).toBe(expected);
    expect(taxId).toHaveLength(22);
    expect(isValidMoadianTaxId(taxId)).toBe(true);
  });

  it('normalises a lower-case memory id', () => {
    expect(generateMoadianTaxId('a1b2c3', Date.parse('2026-10-22T08:30:00Z'), 1)).toBe(
      'A1B2C30510C00000000019',
    );
  });

  it('detects a single changed character', () => {
    expect(isValidMoadianTaxId('A1B2C30510C00000000018')).toBe(false);
    expect(isValidMoadianTaxId('A1B2C30510C00000000029')).toBe(false);
  });

  it('rejects bad memory ids and serials', () => {
    expect(() => generateMoadianTaxId('ABC', 0, 1)).toThrow();
    expect(() => generateMoadianTaxId('ABC-12', 0, 1)).toThrow();
    expect(() => generateMoadianTaxId('ABC123', 0, -1)).toThrow();
    expect(() => generateMoadianTaxId('ABC123', 0, 0x100_0000_0000)).toThrow();
    expect(() => generateMoadianTaxId('ABC123', 0, 1.5)).toThrow();
  });
});

// -----------------------------------------------------------------------------
// Packet mapping
// -----------------------------------------------------------------------------

describe('Moadian packet mapping', () => {
  it('maps header, VAT per line and totals in rials', () => {
    const packet = mapInvoiceToMoadianPacket(buildInvoice(), mappingContext);
    const { header, body, payments } = packet;

    expect(header.taxid).toBe('A1B2C30510C00000000019');
    expect(header.indatim).toBe(Date.parse('2026-10-22T08:30:00Z'));
    expect(header.inty).toBe(MoadianInvoiceType.WITH_BUYER);
    expect(header.inno).toBe('0000000001');
    expect(header.inp).toBe(1);
    expect(header.ins).toBe(1);
    expect(header.tins).toBe('10101010101');
    expect(header.tob).toBe(MoadianBuyerType.NATURAL);
    expect(header.bid).toBe('0012345678');

    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      sstid: '2330001234567',
      sstt: 'Consulting',
      am: 2,
      mu: '1627',
      fee: 1_000_000,
      prdis: 2_000_000,
      dis: 100_000,
      adis: 1_900_000,
      vra: 10,
      vam: 190_000,
      tsstam: 2_090_000,
    });
    expect(body[1]).toMatchObject({ vra: 0, vam: 0, adis: 500_000, tsstam: 500_000 });

    expect(header).toMatchObject({
      tprdis: 2_500_000,
      tdis: 100_000,
      tadis: 2_400_000,
      tvam: 190_000,
      todam: 0,
      tbill: 2_590_000,
      setm: MoadianSettlementMethod.CASH,
      cap: null,
      insp: null,
    });
    expect(header.tbill).toBe(buildInvoice().finalPayable);
    expect(payments).toEqual([]);
  });

  it('converts toman (IRT) amounts to rials with the stored fxRate', () => {
    const packet = mapInvoiceToMoadianPacket(
      buildInvoice({ currency: Currency.IRT, fxRate: 10 }),
      mappingContext,
    );
    expect(packet.body[0].fee).toBe(10_000_000);
    expect(packet.body[0].vam).toBe(1_900_000);
    expect(packet.header.tbill).toBe(25_900_000);
  });

  it('uses type 2 (no buyer details) when the buyer has no id', () => {
    const packet = mapInvoiceToMoadianPacket(
      buildInvoice({ buyerInfo: { name: 'Walk-in' } }),
      mappingContext,
    );
    expect(packet.header.inty).toBe(MoadianInvoiceType.WITHOUT_BUYER);
    expect(packet.header.tob).toBeNull();
    expect(packet.header.bid).toBeNull();
  });

  it('marks an 11-digit buyer id as a legal person; credit sends neither cap nor insp', () => {
    const packet = mapInvoiceToMoadianPacket(
      buildInvoice({ buyerInfo: { name: 'Co', nationalId: '10101234567' } }),
      { ...mappingContext, settlementMethod: MoadianSettlementMethod.CREDIT },
    );
    expect(packet.header.tob).toBe(MoadianBuyerType.LEGAL);
    expect(packet.header.cap).toBeNull();
    expect(packet.header.insp).toBeNull();
  });

  it.each([
    ['an INTL invoice', { jurisdiction: InvoiceJurisdiction.INTL }],
    ['a DRAFT invoice', { status: InvoiceStatus.DRAFT }],
    ['a CANCELLED invoice', { status: InvoiceStatus.CANCELLED }],
    ['an invoice without items', { items: [] }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      mapInvoiceToMoadianPacket(buildInvoice(overrides as Partial<InvoiceResponseDto>), mappingContext),
    ).toThrow(MoadianMappingError);
  });

  it('rejects a missing sstid or seller economic code', () => {
    expect(() =>
      mapInvoiceToMoadianPacket(buildInvoice(), { ...mappingContext, defaultSstid: null }),
    ).toThrow(MoadianMappingError);
    expect(() =>
      mapInvoiceToMoadianPacket(buildInvoice({ sellerInfo: { name: 'S' } }), {
        ...mappingContext,
        sellerEconomicCode: null,
      }),
    ).toThrow(MoadianMappingError);
  });
});

// -----------------------------------------------------------------------------
// JWS / JWE / at-rest encryption
// -----------------------------------------------------------------------------

describe('Moadian JOSE and key sealing', () => {
  it('JWS sign -> verify round trip with the Moadian header', () => {
    const now = new Date('2026-10-22T08:30:00.123Z');
    const token = signMoadianJws({ hello: 'سلام' }, tenantKeys.privateKeyPem, tenantKeys.certificatePem, now);
    const verified = verifyMoadianJws(token, tenantKeys.publicKey);
    expect(verified?.payload).toEqual({ hello: 'سلام' });
    expect(verified?.header).toMatchObject({
      alg: 'RS256',
      typ: 'jose',
      sigT: '2026-10-22T08:30:00Z',
      crit: ['sigT'],
      cty: 'text/plain',
    });
    expect(verified?.header.x5c[0]).not.toContain('BEGIN');
    expect(verifyMoadianJws(token, taxOrgKeys.publicKey)).toBeNull();
    // Tamper with the first signature character (always significant). Rewriting the last
    // characters is not safe: the final base64url char carries 2 padding bits, so a few
    // key/signature combinations decode to the same bytes and the token still verifies.
    const [h, p, sig] = token.split('.');
    const flipped = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(verifyMoadianJws(`${h}.${p}.${flipped}`, tenantKeys.publicKey)).toBeNull();
  });

  it('JWE(JWS) encrypt -> decrypt round trip with the tax org key', () => {
    const packet = mapInvoiceToMoadianPacket(buildInvoice(), mappingContext);
    const jws = signMoadianJws(packet, tenantKeys.privateKeyPem, tenantKeys.certificatePem);
    const jwe = encryptMoadianJwe(jws, taxOrgPublicKeyB64, 'tax-org-key-1');
    expect(jwe.split('.')).toHaveLength(5);

    const { header, plaintext } = decryptMoadianJwe(jwe, taxOrgKeys.privateKeyPem);
    expect(header).toEqual({ alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: 'tax-org-key-1' });
    expect(plaintext).toBe(jws);
    expect(verifyMoadianJws(plaintext, tenantKeys.publicKey)?.payload).toEqual(packet);
  });

  it('JWE decryption fails when the ciphertext or header is tampered with', () => {
    const jwe = encryptMoadianJwe('payload', taxOrgPublicKeyB64, 'k');
    const parts = jwe.split('.');
    const flipped = [...parts];
    flipped[3] = parts[3].startsWith('A') ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
    expect(() => decryptMoadianJwe(flipped.join('.'), taxOrgKeys.privateKeyPem)).toThrow();
    const otherHeader = encryptMoadianJwe('payload', taxOrgPublicKeyB64, 'other').split('.')[0];
    expect(() =>
      decryptMoadianJwe([otherHeader, ...parts.slice(1)].join('.'), taxOrgKeys.privateKeyPem),
    ).toThrow();
  });

  it('sealed private key opens only for the same tenant and master key', () => {
    const master = parseMasterKey(masterKeyB64);
    const sealed = sealSecret(tenantKeys.privateKeyPem, master, TENANT_A);
    expect(sealed).not.toContain('PRIVATE KEY');
    expect(openSecret(sealed, master, TENANT_A)).toBe(tenantKeys.privateKeyPem);
    expect(() => openSecret(sealed, master, TENANT_B)).toThrow();
    expect(() => openSecret(sealed, randomBytes(32), TENANT_A)).toThrow();
  });

  it('refuses a missing or short master key', () => {
    expect(() => parseMasterKey(undefined)).toThrow();
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow();
  });
});

// -----------------------------------------------------------------------------
// Service + client end to end (fake Moadian server, no network)
// -----------------------------------------------------------------------------

class InMemoryMoadianRepository {
  credentials: MoadianCredentialEntity[] = [];
  submissions: MoadianSubmissionEntity[] = [];
  private seq = 0;

  async findCredential(tenantId: string) {
    const row = this.credentials.find((c) => c.tenantId === tenantId);
    if (!row) return null;
    const { privateKeySealed: _hidden, ...rest } = row;
    void _hidden;
    return rest as MoadianCredentialEntity;
  }
  async findCredentialWithPrivateKey(tenantId: string) {
    return this.credentials.find((c) => c.tenantId === tenantId) ?? null;
  }
  async upsertCredential(tenantId: string, data: Partial<MoadianCredentialEntity>) {
    const existing = this.credentials.find((c) => c.tenantId === tenantId);
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    }
    const row = {
      ...data,
      id: `cred-${++this.seq}`,
      tenantId,
      nextSerial: '1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MoadianCredentialEntity;
    this.credentials.push(row);
    return row;
  }
  async reserveSerial(tenantId: string) {
    const row = this.credentials.find((c) => c.tenantId === tenantId)!;
    const serial = Number(row.nextSerial);
    row.nextSerial = String(serial + 1);
    return serial;
  }
  async findSubmissionByInvoice(tenantId: string, invoiceId: string) {
    return this.submissions.find((s) => s.tenantId === tenantId && s.invoiceId === invoiceId) ?? null;
  }
  async listSubmissions(tenantId: string) {
    return this.submissions
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
  }
  async findSubmissionById(tenantId: string, id: string) {
    return this.submissions.find((s) => s.tenantId === tenantId && s.id === id) ?? null;
  }
  async createSubmission(tenantId: string, data: Partial<MoadianSubmissionEntity>) {
    const row = {
      ...data,
      id: `sub-${++this.seq}`,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MoadianSubmissionEntity;
    this.submissions.push(row);
    return row;
  }
  async updateSubmission(tenantId: string, id: string, patch: Partial<MoadianSubmissionEntity>) {
    const row = this.submissions.find((s) => s.tenantId === tenantId && s.id === id);
    if (!row) return null;
    Object.assign(row, patch, { id, tenantId, updatedAt: new Date() });
    return row;
  }
  async listTenantIds() {
    return [...new Set([TENANT_A, ...this.submissions.map((s) => s.tenantId)])];
  }
  async findNonFinalSubmissions(tenantId: string) {
    const nonFinal = [
      MoadianSubmissionStatus.QUEUED,
      MoadianSubmissionStatus.SENT,
      MoadianSubmissionStatus.ERROR,
    ];
    return this.submissions.filter(
      (s) => nonFinal.includes(s.status) && s.tenantId === tenantId,
    );
  }
  async findSubmissions(tenantId: string, invoiceIds?: string[]) {
    return this.submissions.filter(
      (s) => s.tenantId === tenantId && (!invoiceIds || invoiceIds.includes(s.invoiceId)),
    );
  }
}

interface FakeServerState {
  received: Array<{ packet: Record<string, unknown>; header: Record<string, unknown> }>;
  inquiryStatus: string;
  uidInquiryStatus: string;
  uidInquiryHttpStatus: number;
  invoiceHttpStatus: number;
  sendAttempts: number;
  authHeaders: string[];
}

function fakeMoadianServer(state: FakeServerState): FetchLike {
  const json = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

  return async (url: string, init?: RequestInit) => {
    expect(url.startsWith(MOADIAN_SANDBOX_BASE_URL)).toBe(true);
    const path = url.slice(MOADIAN_SANDBOX_BASE_URL.length);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (path.startsWith('/nonce')) {
      return json(200, { nonce: 'test-nonce', expDate: 0 });
    }
    // Every other call must carry a token signed by the tenant key.
    expect(auth).toMatch(/^Bearer /);
    state.authHeaders.push(auth!);
    const token = verifyMoadianJws(auth!.slice(7), tenantKeys.publicKey);
    expect(token?.payload).toEqual({ nonce: 'test-nonce', clientId: 'A1B2C3' });

    if (path === '/server-information') {
      return json(200, {
        serverTime: Date.now(),
        publicKeys: [{ id: 'tax-org-key-1', key: taxOrgPublicKeyB64, algorithm: 'RSA', purpose: 1 }],
      });
    }
    if (path === '/invoice') {
      state.sendAttempts += 1;
      const [item] = JSON.parse(String(init!.body)) as Array<{
        payload: string;
        header: Record<string, unknown>;
      }>;
      const { plaintext } = decryptMoadianJwe(item.payload, taxOrgKeys.privateKeyPem);
      const verified = verifyMoadianJws(plaintext, tenantKeys.publicKey);
      expect(verified).not.toBeNull();
      // The packet is recorded even when the response is lost (non-200): that is
      // exactly the "reached the tax system, only the response was lost" case.
      state.received.push({ packet: verified!.payload as Record<string, unknown>, header: item.header });
      if (state.invoiceHttpStatus !== 200) {
        return json(state.invoiceHttpStatus, {
          errors: [{ errorCode: 'E1', detail: 'rejected by fake' }],
        });
      }
      return json(200, {
        timestamp: Date.now(),
        result: [{ uid: item.header.requestTraceId, referenceNumber: 'REF-1', packetType: null }],
      });
    }
    if (path.startsWith('/inquiry-by-uid')) {
      if (state.uidInquiryHttpStatus !== 200) {
        return json(state.uidInquiryHttpStatus, {
          errors: [{ errorCode: 'E1', detail: 'inquiry rejected by fake' }],
        });
      }
      if (state.uidInquiryStatus === 'NOT_FOUND') {
        return json(200, []);
      }
      const uid = decodeURIComponent(path.split('uidList=')[1]?.split('&')[0] ?? '');
      return json(200, [
        {
          uid,
          referenceNumber: 'REF-UID-1',
          status: state.uidInquiryStatus,
          data: {
            error: [],
            warning: [],
            success: state.uidInquiryStatus === 'SUCCESS',
          },
        },
      ]);
    }
    if (path.startsWith('/inquiry-by-reference-id')) {
      const ref = decodeURIComponent(path.split('referenceIds=')[1]?.split('&')[0] ?? '');
      if (!ref) {
        return json(400, { errors: [{ errorCode: 'MISSING_REF', detail: 'referenceIds required' }] });
      }
      return json(200, [
        {
          referenceNumber: ref,
          uid: null,
          status: state.inquiryStatus,
          data: {
            error:
              state.inquiryStatus === 'FAILED' ? [{ code: '0100', message: 'bad sstid', errorType: 'ERROR' }] : [],
            warning: [{ code: 'W1', message: 'warn', errorType: 'WARNING' }],
            success: state.inquiryStatus === 'SUCCESS',
          },
        },
      ]);
    }
    return json(404, { errors: [{ errorCode: '404', detail: path }] });
  };
}

function buildMoadian(
  options: {
    enabled?: boolean;
    invoices?: InvoiceResponseDto[];
    activeSigningKeyPem?: string | null;
  } = {},
) {
  const env: Record<string, string> = {
    [MOADIAN_ENV.ENABLED]: options.enabled === false ? 'false' : 'true',
    [MOADIAN_ENV.KEY_ENCRYPTION_KEY]: masterKeyB64,
    [MOADIAN_ENV.MAX_POLLS]: '3',
  };
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  const state: FakeServerState = {
    received: [],
    inquiryStatus: 'SUCCESS',
    uidInquiryStatus: 'NOT_FOUND',
    uidInquiryHttpStatus: 200,
    invoiceHttpStatus: 200,
    sendAttempts: 0,
    authHeaders: [],
  };
  const client = new MoadianApiClient(config, fakeMoadianServer(state));
  const repository = new InMemoryMoadianRepository();
  const taxComplianceRepository =
    options.activeSigningKeyPem !== undefined
      ? ({
          findActiveKeyWithPrivate: jest.fn(async () =>
            options.activeSigningKeyPem
              ? { keyFingerprint: 'fp-active', privateKeyPem: options.activeSigningKeyPem }
              : null,
          ),
        } as unknown as import('./repositories/tax-compliance.repository').TaxComplianceRepository)
      : undefined;
  const jobs: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const queue = {
    add: jest.fn(async (name: string, data: unknown, opts: Record<string, unknown>) => {
      jobs.push({ name, data, opts });
    }),
  } as unknown as Queue;
  const invoicingService = {
    findOne: jest.fn(async (tenantId: string, id: string) => {
      const custom = options.invoices?.find((invoice) => invoice.id === id);
      if (tenantId === TENANT_A && custom) return custom;
      if (tenantId === TENANT_A && id === INVOICE_A) return buildInvoice();
      throw new NotFoundException('invoice not found');
    }),
  } as unknown as InvoicingService;
  const service = new MoadianService(
    repository as unknown as MoadianRepository,
    invoicingService,
    client,
    config,
    queue,
    taxComplianceRepository,
  );
  return { service, repository, state, jobs, env, taxComplianceRepository };
}

const credentialDto = () => ({
  memoryId: 'a1b2c3',
  economicCode: '10101010101',
  certificatePem: tenantKeys.certificatePem,
  privateKeyPem: tenantKeys.privateKeyPem,
  defaultSstid: '2330001234567',
  defaultMeasurementUnit: '1627',
});

// Synthetic data only; the fake server above is the only "Moadian" these specs talk to.
describe('MoadianService — every pattern through the send path', () => {
  const sentHeader = (state: FakeServerState) => state.received[0].packet.header as Record<string, unknown>;
  const submitAndSend = async (
    options: { invoices?: InvoiceResponseDto[] },
    id: string,
    body?: Parameters<MoadianService['submitInvoice']>[2],
  ) => {
    const ctx = buildMoadian(options);
    await ctx.service.putCredential(TENANT_A, credentialDto());
    const queued = await ctx.service.submitInvoice(TENANT_A, id, body);
    await ctx.service.processSend(ctx.jobs[0].data as never, false);
    return { ...ctx, queued };
  };
  const INV2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('a plain submit is still pattern 1', async () => {
    const { state } = await submitAndSend({}, INVOICE_A);
    expect(sentHeader(state)).toMatchObject({ inp: 1, ins: 1 });
  });

  it('pattern 4 is chosen explicitly (crn is optional in 1 to 3, so it does not infer)', async () => {
    const { state } = await submitAndSend({}, INVOICE_A, { pattern: 4, extras: { header: { crn: '123456789012' } } });
    expect(sentHeader(state)).toMatchObject({ inp: 4, crn: '123456789012' });
  });

  it('an optional crn on a plain sale does not turn it into a contract', async () => {
    const { state } = await submitAndSend({}, INVOICE_A, { extras: { header: { crn: '123456789012' } } });
    expect(sentHeader(state)).toMatchObject({ inp: 1, crn: '123456789012' });
  });

  it('infers pattern 7 from the export lines and sends the export totals', async () => {
    const { state } = await submitAndSend({}, INVOICE_A, {
      extras: { items: [{ ssrv: 6_000_000, sscv: 10, cut: 'USD', exr: 600_000 }, { ssrv: 600_000, sscv: 1, cut: 'USD', exr: 600_000 }] },
    });
    expect(sentHeader(state)).toMatchObject({ inp: 7, torv: 6_600_000, tocv: 11, tprdis: null });
  });

  it('an explicit pattern must agree with the data and with the supported range', async () => {
    const ctx = buildMoadian();
    await ctx.service.putCredential(TENANT_A, credentialDto());
    await expect(
      ctx.service.submitInvoice(TENANT_A, INVOICE_A, { pattern: 5, extras: { header: { ft: 1 } } }),
    ).rejects.toThrow(/نمی‌خواند/);
    await expect(
      ctx.service.submitInvoice(TENANT_A, INVOICE_A, { extras: { header: { billid: '1', ft: 1 } } }),
    ).rejects.toThrow(/چند الگو/);
    await expect(ctx.service.submitInvoice(TENANT_A, INVOICE_A, { pattern: 8 })).rejects.toThrow(/۱ تا ۷/);
    expect(ctx.jobs).toHaveLength(0);
  });

  it('fails with a Persian message on a missing required field and burns no serial', async () => {
    const ctx = buildMoadian();
    await ctx.service.putCredential(TENANT_A, credentialDto());
    await expect(ctx.service.submitInvoice(TENANT_A, INVOICE_A, { pattern: 6 })).rejects.toThrow(/فیلد header\.ft اجباری است/);
    await expect(ctx.service.submitInvoice(TENANT_A, INVOICE_A, { pattern: 2, extras: { items: [{ cpr: 1, sovat: 1 }] } })).rejects.toThrow(/cfee/);
    expect(ctx.repository.credentials[0].nextSerial).toBe('1');
    expect(ctx.jobs).toHaveLength(0);
  });

  it('a cancellation points at the tax id of the invoice it cancels and needs it to be registered', async () => {
    const cancel = buildInvoice({ id: INV2, subject: InvoiceSubject.CANCEL, relatedInvoiceId: INVOICE_A });
    const ctx = buildMoadian({ invoices: [cancel] });
    await ctx.service.putCredential(TENANT_A, credentialDto());
    await expect(ctx.service.submitInvoice(TENANT_A, INV2)).rejects.toThrow(/صورتحساب مرجع/);
    await ctx.repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A, taxId: 'A1B2C30510C00000000019', status: MoadianSubmissionStatus.SUCCESS,
    });
    await ctx.service.submitInvoice(TENANT_A, INV2);
    await ctx.service.processSend(ctx.jobs[0].data as never, false);
    expect(sentHeader(ctx.state)).toMatchObject({ ins: 3, irtaxid: 'A1B2C30510C00000000019' });
  });

  it('cash and credit needs the cash part', async () => {
    const ctx = buildMoadian();
    await ctx.service.putCredential(TENANT_A, { ...credentialDto(), settlementMethod: MoadianSettlementMethod.CASH_AND_CREDIT } as never);
    await expect(ctx.service.submitInvoice(TENANT_A, INVOICE_A)).rejects.toThrow(/cashPortion/);
    await ctx.service.submitInvoice(TENANT_A, INVOICE_A, { cashPortion: 1_000_000 });
    await ctx.service.processSend(ctx.jobs[0].data as never, false);
    expect(sentHeader(ctx.state)).toMatchObject({ setm: 3, cap: 1_000_000 });
  });
});

describe('MoadianService — send and poll', () => {
  it('stores the private key sealed and never returns it', async () => {
    const { service, repository } = buildMoadian();
    const response = await service.putCredential(TENANT_A, credentialDto());
    expect(response.memoryId).toBe('A1B2C3');
    expect(JSON.stringify(response)).not.toContain('PRIVATE KEY');
    expect(response.certificateSubject).toContain('Roxira Test Taxpayer');
    const row = repository.credentials[0];
    expect(row.privateKeySealed.startsWith('v1.')).toBe(true);
    expect(row.privateKeySealed).not.toContain('PRIVATE KEY');
  });

  it('rejects a private key that does not match the certificate', async () => {
    const { service } = buildMoadian();
    await expect(
      service.putCredential(TENANT_A, { ...credentialDto(), privateKeyPem: taxOrgKeys.privateKeyPem }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('queues, sends a signed+encrypted packet, then polls to SUCCESS', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());

    const queued = await service.submitInvoice(TENANT_A, INVOICE_A);
    expect(queued.status).toBe(MoadianSubmissionStatus.QUEUED);
    expect(queued.taxId).toBe('A1B2C30510C00000000019');
    expect(jobs[0]).toMatchObject({
      name: MOADIAN_SEND_JOB,
      data: { tenantId: TENANT_A, submissionId: queued.id },
    });
    expect(JSON.stringify(jobs[0].data)).not.toContain('PRIVATE');

    await expect(service.processSend(jobs[0].data as never, false)).resolves.toBe('poll');
    expect(state.received).toHaveLength(1);
    expect(state.received[0].header).toEqual({ requestTraceId: queued.uid, fiscalId: 'A1B2C3' });
    expect((state.received[0].packet.header as Record<string, unknown>).taxid).toBe(queued.taxId);
    const sent = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(sent).toMatchObject({ status: MoadianSubmissionStatus.SENT, referenceNumber: 'REF-1' });
    expect(jobs[1].name).toBe(MOADIAN_POLL_JOB);

    await expect(service.processPoll(jobs[1].data as never)).resolves.toBe('done');
    const done = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(done.status).toBe(MoadianSubmissionStatus.SUCCESS);
    expect(done.warnings).toEqual([{ code: 'W1', message: 'warn' }]);

    await expect(service.submitInvoice(TENANT_A, INVOICE_A)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records FAILED with Moadian errors and allows a resubmission with a new serial', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'FAILED';
    const first = await service.submitInvoice(TENANT_A, INVOICE_A);
    await service.processSend(jobs[0].data as never, false);
    await service.processPoll(jobs[1].data as never);
    const failed = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(failed.status).toBe(MoadianSubmissionStatus.FAILED);
    expect(failed.errors).toEqual([{ code: '0100', message: 'bad sstid' }]);

    const second = await service.submitInvoice(TENANT_A, INVOICE_A);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(MoadianSubmissionStatus.QUEUED);
    expect(second.taxId).not.toBe(first.taxId);
    expect(second.uid).not.toBe(first.uid);
  });

  it('does not burn a serial when the invoice cannot be mapped', async () => {
    const { service, repository } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    const reserve = jest.spyOn(repository, 'reserveSerial');
    // Credential without default sstid/unit forces a mapping error for the stock invoice.
    repository.credentials[0].defaultSstid = null;
    repository.credentials[0].defaultMeasurementUnit = null;
    const outcome = await service.submitInvoice(TENANT_A, INVOICE_A).then(
      () => 'ok',
      (error: unknown) => error,
    );
    expect(outcome).not.toBe('ok');
    {
      expect(outcome).toBeInstanceOf(BadRequestException);
      expect(reserve).not.toHaveBeenCalled();
    }
  });

  it('translates a unique-index violation on (tenant, invoice) into 409', async () => {
    const { service, repository } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    jest
      .spyOn(repository, 'createSubmission')
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.submitInvoice(TENANT_A, INVOICE_A)).rejects.toBeInstanceOf(ConflictException);
  });

  it('stops polling at MOADIAN_MAX_POLLS while still PENDING', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'PENDING';
    await service.submitInvoice(TENANT_A, INVOICE_A);
    await service.processSend(jobs[0].data as never, false);
    expect(await service.processPoll(jobs[1].data as never)).toBe('poll');
    expect(await service.processPoll(jobs[2].data as never)).toBe('poll');
    expect(await service.processPoll(jobs[3].data as never)).toBe('done');
    const row = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(row.status).toBe(MoadianSubmissionStatus.SENT);
    expect(row.pollCount).toBe(3);
    expect(row.errors[0].code).toBe('POLL_LIMIT');
  });

  it('marks a 4xx send as FAILED without retrying, and retries 5xx until ERROR', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.invoiceHttpStatus = 400;
    await service.submitInvoice(TENANT_A, INVOICE_A);
    await expect(service.processSend(jobs[0].data as never, false)).resolves.toBe('done');
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.FAILED,
    );

    state.invoiceHttpStatus = 503;
    await service.submitInvoice(TENANT_A, INVOICE_A);
    const job = jobs[jobs.length - 1].data as never;
    await expect(service.processSend(job, false)).rejects.toThrow('HTTP 503');
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.QUEUED,
    );
    await expect(service.processSend(job, true)).rejects.toThrow('HTTP 503');
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.ERROR,
    );
  });

  it('on retry after a lost response, asks by uid first and never resends a known invoice', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    // The first send reaches the tax system but the response is lost (503).
    state.invoiceHttpStatus = 503;
    await service.submitInvoice(TENANT_A, INVOICE_A);
    const job = jobs[0].data as never;
    await expect(service.processSend(job, false, 0)).rejects.toThrow('HTTP 503');
    expect(state.sendAttempts).toBe(1);

    // The retry finds the uid registered: only the reference is stored and the poll scheduled.
    state.uidInquiryStatus = 'SUCCESS';
    state.invoiceHttpStatus = 200;
    await expect(service.processSend(job, false, 1)).resolves.toBe('poll');
    expect(state.sendAttempts).toBe(1);
    const sent = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(sent).toMatchObject({
      status: MoadianSubmissionStatus.SENT,
      referenceNumber: 'REF-UID-1',
    });
    expect(jobs[1].name).toBe(MOADIAN_POLL_JOB);
  });

  it('on retry of an unknown uid, the packet is sent again', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.invoiceHttpStatus = 503;
    await service.submitInvoice(TENANT_A, INVOICE_A);
    const job = jobs[0].data as never;
    await expect(service.processSend(job, false, 0)).rejects.toThrow('HTTP 503');
    expect(state.sendAttempts).toBe(1);

    // Inquiry says the uid is unknown, so the packet is sent again and goes through.
    state.invoiceHttpStatus = 200;
    await expect(service.processSend(job, false, 1)).resolves.toBe('poll');
    expect(state.sendAttempts).toBe(2);
    const sent = await service.getSubmission(TENANT_A, INVOICE_A);
    expect(sent).toMatchObject({
      status: MoadianSubmissionStatus.SENT,
      referenceNumber: 'REF-1',
    });
  });

  it('a failed uid inquiry on retry is a transport error and never sends', async () => {
    const { service, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.invoiceHttpStatus = 503;
    await service.submitInvoice(TENANT_A, INVOICE_A);
    const job = jobs[0].data as never;
    await expect(service.processSend(job, false, 0)).rejects.toThrow('HTTP 503');
    expect(state.sendAttempts).toBe(1);

    // Inquiry itself fails (transport): nothing is sent and the job retries.
    state.uidInquiryHttpStatus = 503;
    await expect(service.processSend(job, false, 1)).rejects.toThrow('HTTP 503');
    expect(state.sendAttempts).toBe(1);
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.QUEUED,
    );
    // On the final attempt the transport error marks the submission ERROR, still without a resend.
    await expect(service.processSend(job, true, 1)).rejects.toThrow('HTTP 503');
    expect(state.sendAttempts).toBe(1);
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.ERROR,
    );
  });

  it('is off by default: submit is refused and queued jobs do nothing', async () => {
    const { service, repository, state, env } = buildMoadian({ enabled: false });
    await service.putCredential(TENANT_A, credentialDto());
    await expect(service.submitInvoice(TENANT_A, INVOICE_A)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    delete env[MOADIAN_ENV.ENABLED];
    expect(service.isEnabled()).toBe(false);
    repository.submissions.push({
      id: 'sub-x',
      tenantId: TENANT_A,
      status: MoadianSubmissionStatus.QUEUED,
    } as MoadianSubmissionEntity);
    await expect(
      service.processSend({ tenantId: TENANT_A, submissionId: 'sub-x' }, false),
    ).resolves.toBe('done');
    expect(state.received).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Tenant isolation
// -----------------------------------------------------------------------------

describe('Moadian — tenant isolation', () => {
  it('tenant B cannot submit or read tenant A invoices and has no credential', async () => {
    const { service, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    await service.submitInvoice(TENANT_A, INVOICE_A);

    await expect(service.submitInvoice(TENANT_B, INVOICE_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getSubmission(TENANT_B, INVOICE_A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getCredential(TENANT_B)).rejects.toBeInstanceOf(NotFoundException);

    // A forged job naming tenant B with tenant A's submission id does nothing.
    const forged = { tenantId: TENANT_B, submissionId: (jobs[0].data as { submissionId: string }).submissionId };
    await expect(service.processSend(forged, false)).resolves.toBe('done');
    expect((await service.getSubmission(TENANT_A, INVOICE_A)).status).toBe(
      MoadianSubmissionStatus.QUEUED,
    );
  });

  it("a sealed key copied into another tenant's row cannot be opened", async () => {
    const { service, repository, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    await service.putCredential(TENANT_B, credentialDto());
    repository.credentials[1].privateKeySealed = repository.credentials[0].privateKeySealed;
    repository.submissions.push({
      id: 'sub-b',
      tenantId: TENANT_B,
      uid: '33333333-3333-4333-8333-333333333333',
      status: MoadianSubmissionStatus.QUEUED,
      packet: {},
    } as unknown as MoadianSubmissionEntity);
    await expect(
      service.processSend({ tenantId: TENANT_B, submissionId: 'sub-b' }, false),
    ).rejects.toThrow();
    expect(jobs).toHaveLength(0);
  });

  it('MoadianRepository scopes every query and update by tenant_id', async () => {
    const credentials = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const submissions = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      update: jest.fn(),
    };
    const repo = new MoadianRepository(credentials as never, submissions as never);

    await repo.findCredential(TENANT_A);
    expect(credentials.findOne).toHaveBeenLastCalledWith({ where: { tenantId: TENANT_A } });

    const created = await repo.upsertCredential(TENANT_A, { memoryId: 'A1B2C3', tenantId: TENANT_B } as never);
    expect(created.tenantId).toBe(TENANT_A);

    await repo.findSubmissionByInvoice(TENANT_A, INVOICE_A);
    expect(submissions.findOne).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, invoiceId: INVOICE_A },
    });
    await repo.listSubmissions(TENANT_A);
    expect(submissions.find).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A },
      order: { updatedAt: 'DESC' },
    });
    await repo.findSubmissionById(TENANT_A, 'sub-1');
    expect(submissions.findOne).toHaveBeenLastCalledWith({ where: { tenantId: TENANT_A, id: 'sub-1' } });

    const sub = await repo.createSubmission(TENANT_A, { tenantId: TENANT_B } as never);
    expect(sub.tenantId).toBe(TENANT_A);

    await repo.updateSubmission(TENANT_A, 'sub-1', {
      tenantId: TENANT_B,
      status: MoadianSubmissionStatus.SENT,
    });
    expect(submissions.update).toHaveBeenCalledWith(
      { id: 'sub-1', tenantId: TENANT_A },
      { status: MoadianSubmissionStatus.SENT },
    );
  });

  it('controller reads the tenant only from the verified request user', async () => {
    const { service } = buildMoadian();
    const controller = new MoadianController(service);
    const requestWith = (user: unknown) => ({ user }) as unknown as AuthenticatedRequest;

    // Who may call is decided by AccessGuard (see permission-matrix.spec); here only the tenant source.
    await expect(
      controller.getCredential(requestWith({ tenantId: null, role: UserRole.ADMIN })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const owner = requestWith({ tenantId: TENANT_A, role: UserRole.USER, tenantRole: TenantRole.OWNER });
    await controller.putCredential(owner, credentialDto());
    await expect(controller.getCredential(owner)).resolves.toMatchObject({ memoryId: 'A1B2C3' });
    const otherOwner = requestWith({ tenantId: TENANT_B, role: UserRole.USER, tenantRole: TenantRole.OWNER });
    await expect(controller.getCredential(otherOwner)).rejects.toBeInstanceOf(NotFoundException);

    await expect(controller.listSubmissions(owner)).resolves.toEqual([]);
  });

  it('putCredential supports useActiveSigningKey (sealed & legacy) and rejects when active key is absent, wrong tenant, or mismatched', async () => {
    const { service } = buildMoadian({ activeSigningKeyPem: tenantKeys.privateKeyPem });
    const saved = await service.putCredential(TENANT_A, {
      memoryId: 'a1b2c3',
      economicCode: '10101010101',
      certificatePem: tenantKeys.certificatePem,
      useActiveSigningKey: true,
      settlementMethod: MoadianSettlementMethod.CREDIT,
    });
    expect(saved.memoryId).toBe('A1B2C3');
    expect(saved.settlementMethod).toBe(MoadianSettlementMethod.CREDIT);

    const sealedForTenantA = sealSecret(
      tenantKeys.privateKeyPem,
      parseMasterKey(masterKeyB64),
      TENANT_A,
    );
    const sealedCtx = buildMoadian({ activeSigningKeyPem: sealedForTenantA });
    const savedFromSealed = await sealedCtx.service.putCredential(TENANT_A, {
      memoryId: 'a1b2c3',
      economicCode: '10101010101',
      certificatePem: tenantKeys.certificatePem,
      useActiveSigningKey: true,
    });
    expect(savedFromSealed.memoryId).toBe('A1B2C3');

    const sealedForTenantB = sealSecret(
      tenantKeys.privateKeyPem,
      parseMasterKey(masterKeyB64),
      TENANT_B,
    );
    const crossTenantCtx = buildMoadian({ activeSigningKeyPem: sealedForTenantB });
    await expect(
      crossTenantCtx.service.putCredential(TENANT_A, {
        memoryId: 'a1b2c3',
        economicCode: '10101010101',
        certificatePem: tenantKeys.certificatePem,
        useActiveSigningKey: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const noKey = buildMoadian({ activeSigningKeyPem: null });
    await expect(
      noKey.service.putCredential(TENANT_A, {
        memoryId: 'a1b2c3',
        economicCode: '10101010101',
        certificatePem: tenantKeys.certificatePem,
        useActiveSigningKey: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const wrongKey = buildMoadian({ activeSigningKeyPem: testKeys('other.example').privateKeyPem });
    await expect(
      wrongKey.service.putCredential(TENANT_A, {
        memoryId: 'a1b2c3',
        economicCode: '10101010101',
        certificatePem: tenantKeys.certificatePem,
        useActiveSigningKey: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateMoadianTables migration', () => {
  it('creates both tables with tenant_id and tenant-scoped unique indexes', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) };
    await new CreateMoadianTables1789310000000().up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "moadian_credentials"[\s\S]*"tenant_id" uuid NOT NULL/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "moadian_submissions"[\s\S]*"tenant_id" uuid NOT NULL/);
    expect(sql).toContain('ON "moadian_credentials" ("tenant_id")');
    expect(sql).toContain('ON "moadian_submissions" ("tenant_id", "invoice_id")');
    expect(sql).toContain('"private_key_sealed" text NOT NULL');
    expect(sql).not.toMatch(/private_key_pem/);

    queries.length = 0;
    await new CreateMoadianTables1789310000000().down(runner as never);
    expect(queries.join('\n')).toContain('DROP TABLE IF EXISTS "moadian_credentials"');
  });
});

describe('Moadian status sync (T82)', () => {
  it('syncNonFinalSubmissions polls SENT submissions and transitions to SUCCESS', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'SUCCESS';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-test-1',
      taxId: 'TAXID123',
      serial: '1',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 1,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, updated: 1 });

    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.status).toBe(MoadianSubmissionStatus.SUCCESS);
    expect(updated?.errors).toEqual([]);
    expect(updated?.warnings).toHaveLength(1);
    expect(updated?.lastPolledAt).toBeInstanceOf(Date);
  });

  it('syncNonFinalSubmissions stores FAILED status and error list', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'FAILED';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-test-2',
      taxId: 'TAXID123',
      serial: '2',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, updated: 1 });

    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.status).toBe(MoadianSubmissionStatus.FAILED);
    expect(updated?.errors).toEqual([
      expect.objectContaining({ code: '0100', message: 'bad sstid' }),
    ]);
  });

  it('syncNonFinalSubmissions retries safe states (TIMEOUT) without marking FAILED', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'TIMEOUT';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-test-3',
      taxId: 'TAXID123',
      serial: '3',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 1,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, retried: 1 });

    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.status).toBe(MoadianSubmissionStatus.SENT);
    expect(updated?.pollCount).toBe(2);
    expect(updated?.errors[0]?.code).toBe('TIMEOUT');
  });

  it('syncNonFinalSubmissions for QUEUED checks uid first and avoids double submit', async () => {
    const { service, repository, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.uidInquiryStatus = 'SUCCESS';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-already-sent',
      taxId: 'TAXID123',
      serial: '4',
      referenceNumber: null,
      status: MoadianSubmissionStatus.QUEUED,
      errors: [],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, updated: 1 });

    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.status).toBe(MoadianSubmissionStatus.SUCCESS);
    expect(updated?.referenceNumber).toBe('REF-UID-1');
    expect(jobs.filter((j) => j.name === MOADIAN_SEND_JOB)).toHaveLength(0);
  });

  it('syncNonFinalSubmissions enumerates tenants globally via listTenantIds when targetTenantId is omitted', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'SUCCESS';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-global-1',
      taxId: 'TAXID123',
      serial: '10',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions();
    expect(res).toMatchObject({ checked: 1, updated: 1 });
    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.status).toBe(MoadianSubmissionStatus.SUCCESS);
  });

  it('syncNonFinalSubmissions marks POLL_LIMIT when TIMEOUT reaches MAX_POLLS', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'TIMEOUT';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-timeout-max',
      taxId: 'TAXID123',
      serial: '11',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 2, // +1 = 3 === MOADIAN_MAX_POLLS
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, retried: 0 });
    const updated = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(updated?.pollCount).toBe(3);
    expect(updated?.errors[0]?.code).toBe('POLL_LIMIT');
  });

  it('syncNonFinalSubmissions moves ERROR to QUEUED with a fresh jobId and executes processSend without double submit', async () => {
    const { service, repository, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.uidInquiryStatus = 'NOT_FOUND';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-err-recover',
      taxId: 'TAXID123',
      serial: '12',
      referenceNumber: null,
      packet: { header: { requestTraceId: 'uid-err-recover' }, body: [] } as any,
      status: MoadianSubmissionStatus.ERROR,
      errors: [{ code: 'TRANSPORT', message: 'timeout' }],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, retried: 1 });

    const queued = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(queued?.status).toBe(MoadianSubmissionStatus.QUEUED);
    expect(queued?.pollCount).toBe(1);

    const retryJob = jobs.find((j) => j.name === MOADIAN_SEND_JOB);
    expect(retryJob?.data).toEqual({
      tenantId: TENANT_A,
      submissionId: sub.id,
      checkExistingFirst: true,
    });
    expect(retryJob?.opts?.jobId).toBe(`moadian-retry-${sub.id}-12-1`);

    // Simulate the worker running: if Moadian already knows the uid before send executes, processSend must NOT call /invoice again.
    state.uidInquiryStatus = 'PENDING';
    const outcome = await service.processSend(retryJob!.data as any, false, 0);
    expect(outcome).toBe('poll');
    expect(state.received).toHaveLength(0);
    const afterWorker = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(afterWorker?.status).toBe(MoadianSubmissionStatus.SENT);
    expect(afterWorker?.referenceNumber).toBe('REF-UID-1');
  });

  it('does not treat transient uid inquiry HTTP failure as NOT_FOUND or re-enqueue send', async () => {
    const { service, repository, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.uidInquiryHttpStatus = 500;

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-transient-500',
      taxId: 'TAXID123',
      serial: '13',
      referenceNumber: null,
      status: MoadianSubmissionStatus.QUEUED,
      errors: [],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, updated: 0, retried: 0 });
    expect(jobs.filter((j) => j.name === MOADIAN_SEND_JOB)).toHaveLength(0);
    const stillQueued = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(stillQueued?.status).toBe(MoadianSubmissionStatus.QUEUED);
  });

  it('syncNonFinalSubmissions re-enqueues stalled QUEUED submissions safely', async () => {
    const { service, repository, state, jobs } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.uidInquiryStatus = 'NOT_FOUND';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-stalled',
      taxId: 'TAXID123',
      serial: '5',
      referenceNumber: null,
      status: MoadianSubmissionStatus.QUEUED,
      errors: [],
      warnings: [],
      pollCount: 0,
    });

    const res = await service.syncNonFinalSubmissions(TENANT_A);
    expect(res).toMatchObject({ checked: 1, retried: 1 });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: MOADIAN_SEND_JOB,
          data: { tenantId: TENANT_A, submissionId: sub.id, checkExistingFirst: true },
          opts: expect.objectContaining({ jobId: `moadian-retry-${sub.id}-5-1` }),
        }),
      ]),
    );
  });

  it('syncNonFinalSubmissions is idempotent across multiple runs', async () => {
    const { service, repository, state } = buildMoadian();
    await service.putCredential(TENANT_A, credentialDto());
    state.inquiryStatus = 'SUCCESS';

    const sub = await repository.createSubmission(TENANT_A, {
      invoiceId: INVOICE_A,
      uid: 'uid-test-idem',
      taxId: 'TAXID123',
      serial: '6',
      referenceNumber: 'REF-1',
      status: MoadianSubmissionStatus.SENT,
      errors: [],
      warnings: [],
      pollCount: 1,
    });

    const r1 = await service.syncNonFinalSubmissions(TENANT_A);
    expect(r1).toMatchObject({ checked: 1, updated: 1 });

    const r2 = await service.syncNonFinalSubmissions(TENANT_A);
    expect(r2).toMatchObject({ checked: 0, updated: 0 });

    const finalSub = await repository.findSubmissionById(TENANT_A, sub.id);
    expect(finalSub?.status).toBe(MoadianSubmissionStatus.SUCCESS);
  });

  it('MoadianProcessor processes MOADIAN_SYNC_STATUS_JOB', async () => {
    const { service } = buildMoadian();
    const processor = new MoadianProcessor(service);
    const syncSpy = jest
      .spyOn(service, 'syncNonFinalSubmissions')
      .mockResolvedValue({ checked: 0, updated: 0, retried: 0 });

    const job = {
      name: MOADIAN_SYNC_STATUS_JOB,
      data: { tenantId: TENANT_A },
    } as any;

    const result = await processor.process(job);
    expect(result).toEqual({ outcome: 'done' });
    expect(syncSpy).toHaveBeenCalledWith(TENANT_A);
  });
});
