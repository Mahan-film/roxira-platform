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
} from './constants/moadian.constants';
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
    buyerInfo: { name: 'Buyer', nationalId: '0012345678', economicCode: '0012345678' },
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
      cap: 2_590_000,
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

  it('marks an 11-digit buyer id as a legal person and credit as insp', () => {
    const packet = mapInvoiceToMoadianPacket(
      buildInvoice({ buyerInfo: { name: 'Co', nationalId: '10101234567' } }),
      { ...mappingContext, settlementMethod: MoadianSettlementMethod.CREDIT },
    );
    expect(packet.header.tob).toBe(MoadianBuyerType.LEGAL);
    expect(packet.header.cap).toBeNull();
    expect(packet.header.insp).toBe(2_590_000);
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
    expect(verifyMoadianJws(`${token.slice(0, -2)}AA`, tenantKeys.publicKey)).toBeNull();
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
}

interface FakeServerState {
  received: Array<{ packet: Record<string, unknown>; header: Record<string, unknown> }>;
  inquiryStatus: string;
  invoiceHttpStatus: number;
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
      if (state.invoiceHttpStatus !== 200) {
        return json(state.invoiceHttpStatus, {
          errors: [{ errorCode: 'E1', detail: 'rejected by fake' }],
        });
      }
      const [item] = JSON.parse(String(init!.body)) as Array<{
        payload: string;
        header: Record<string, unknown>;
      }>;
      const { plaintext } = decryptMoadianJwe(item.payload, taxOrgKeys.privateKeyPem);
      const verified = verifyMoadianJws(plaintext, tenantKeys.publicKey);
      expect(verified).not.toBeNull();
      state.received.push({ packet: verified!.payload as Record<string, unknown>, header: item.header });
      return json(200, {
        timestamp: Date.now(),
        result: [{ uid: item.header.requestTraceId, referenceNumber: 'REF-1', packetType: null }],
      });
    }
    if (path.startsWith('/inquiry-by-reference-id')) {
      expect(path).toContain('referenceIds=REF-1');
      return json(200, [
        {
          referenceNumber: 'REF-1',
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

function buildMoadian(options: { enabled?: boolean } = {}) {
  const env: Record<string, string> = {
    [MOADIAN_ENV.ENABLED]: options.enabled === false ? 'false' : 'true',
    [MOADIAN_ENV.KEY_ENCRYPTION_KEY]: masterKeyB64,
    [MOADIAN_ENV.MAX_POLLS]: '3',
  };
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  const state: FakeServerState = {
    received: [],
    inquiryStatus: 'SUCCESS',
    invoiceHttpStatus: 200,
    authHeaders: [],
  };
  const client = new MoadianApiClient(config, fakeMoadianServer(state));
  const repository = new InMemoryMoadianRepository();
  const jobs: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const queue = {
    add: jest.fn(async (name: string, data: unknown, opts: Record<string, unknown>) => {
      jobs.push({ name, data, opts });
    }),
  } as unknown as Queue;
  const invoicingService = {
    findOne: jest.fn(async (tenantId: string, id: string) => {
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
  );
  return { service, repository, state, jobs, env };
}

const credentialDto = () => ({
  memoryId: 'a1b2c3',
  economicCode: '10101010101',
  certificatePem: tenantKeys.certificatePem,
  privateKeyPem: tenantKeys.privateKeyPem,
  defaultSstid: '2330001234567',
  defaultMeasurementUnit: '1627',
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
