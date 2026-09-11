/**
 * قراردادهای تایپ‌سیف ماژول «تطبیق سامانه مودیان و امضای الکترونیک».
 * منطبق بر DTOهای بک‌اند در
 * `modules/tax_compliance/dto/` (Rule #4 - AGENTS.md).
 */

export enum TaxSubmissionStatus {
  SIGNED = "SIGNED",
  SENT = "SENT",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
}

export const TAX_SUBMISSION_STATUS_LABELS: Record<TaxSubmissionStatus, string> = {
  [TaxSubmissionStatus.SIGNED]: "امضاشده (در انتظار ارسال)",
  [TaxSubmissionStatus.SENT]: "ارسال‌شده (در انتظار پذیرش)",
  [TaxSubmissionStatus.ACCEPTED]: "پذیرفته‌شده توسط مودیان",
  [TaxSubmissionStatus.REJECTED]: "ردشده توسط مودیان",
};

export interface SignInvoiceDto {
  invoiceId: string;
  hashAlgorithm?: string;
}

export interface TaxSignatureResponseDto {
  id: string;
  invoiceId: string;
  taxInvoiceNumber: string;
  taxId: string;
  hashAlgorithm: string;
  dataHash: string;
  signatureAlgorithm: string;
  jwsSignature: string;
  keyId: string;
  keyFingerprint: string;
  status: TaxSubmissionStatus;
  referenceNumber: string | null;
  errorMessage: string | null;
  qrCodePayload: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaxSignatureDetailResponseDto extends TaxSignatureResponseDto {
  signedPacket: Record<string, unknown>;
}

export interface QueryTaxSignatureDto {
  page?: number;
  limit?: number;
  status?: TaxSubmissionStatus;
  taxInvoiceNumber?: string;
  invoiceId?: string;
  taxId?: string;
}

export interface PaginatedTaxSignaturesResponse {
  data: TaxSignatureResponseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface SigningKeyResponseDto {
  keyId: string;
  keyFingerprint: string;
  algorithm: string;
  modulusLength: number;
  publicKeyPem: string;
  certificateRequestPem: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CertificateSubjectDto {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  state?: string;
  locality?: string;
  serialNumber?: string;
  emailAddress?: string;
}

export interface GenerateCsrDto {
  subject: CertificateSubjectDto;
  privateKeyPem?: string;
}

export interface GenerateCsrResponse {
  keyId: string | null;
  keyFingerprint: string;
  certificateRequestPem: string;
}

export interface VerifySignatureResponse {
  valid: boolean;
  keyId: string;
  taxId: string;
  checkedAt: string;
}
