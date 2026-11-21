import { Currency } from '../../currency/enums/currency.enum';
import {
  VendorInvoiceParty,
  VendorInvoiceRequest,
  VendorInvoiceDocument,
} from '../services/vendor-invoice.generator';

export const SUPPLIER_ROXIRA_MY: VendorInvoiceParty = {
  name: 'Roxira Technologies Sdn. Bhd.',
  country: 'MY',
  address: 'Level 28, The Exchange 106, Lingkaran TRX, 55188 Kuala Lumpur, Malaysia',
  registrationNumber: '202401009988 (1550123-X)',
  taxId: 'W10-2401-32000042',
  isB2B: true,
};

/**
 * 1. Malaysian B2B Customer Fixture
 * Subject to Malaysian Service Tax (SST) at the effective 8% rate.
 */
export const CUSTOMER_MY_B2B: VendorInvoiceParty = {
  name: 'Pelangi Media Berhad',
  country: 'MY',
  address: 'Menara Pelangi, Jalan Sultan Ismail, 50250 Kuala Lumpur, Malaysia',
  registrationNumber: '201901045678 (1345678-A)',
  taxId: 'B10-1808-11000011',
  isB2B: true,
};

export const MY_B2B_INVOICE_REQUEST: VendorInvoiceRequest = {
  documentType: 'INVOICE',
  series: 'INV-2026',
  issueDate: '2026-11-21',
  supplier: SUPPLIER_ROXIRA_MY,
  customer: CUSTOMER_MY_B2B,
  currency: 'MYR' as Currency,
  items: [
    {
      description: 'Roxira Enterprise Platform SaaS Subscription (Monthly)',
      quantity: 1,
      unitPriceMinor: 450000n, // RM 4,500.00
      sku: 'ROX-SAAS-ENT-MO',
    },
    {
      description: 'Additional AI Inference Processing Quota (500k tokens)',
      quantity: 2,
      unitPriceMinor: 50000n, // RM 500.00 each
      sku: 'ROX-AI-TOK-500K',
    },
  ],
};

/**
 * 2. EU B2B Customer Fixture
 * Cross-border supply from non-EU vendor to EU B2B customer with verified VAT ID.
 * Mandatory Reverse Charge applies under Article 196 of Council Directive 2006/112/EC.
 */
export const CUSTOMER_EU_B2B: VendorInvoiceParty = {
  name: 'Kanzlei Schmidt & Partner Rechtsanwälte mbB',
  country: 'DE',
  address: 'Maximilianstraße 35, 80539 München, Germany',
  registrationNumber: 'PR 1234 München',
  taxId: 'DE312456789',
  isB2B: true,
  verifiedTaxId: true,
};

export const EU_B2B_INVOICE_REQUEST: VendorInvoiceRequest = {
  documentType: 'INVOICE',
  series: 'INV-2026',
  issueDate: '2026-11-21',
  supplier: SUPPLIER_ROXIRA_MY,
  customer: CUSTOMER_EU_B2B,
  currency: Currency.EUR,
  fxRate: {
    baseCurrency: Currency.USD,
    rate: '1.085000',
  },
  items: [
    {
      description: 'SmartJudge Legal Intelligence SaaS - Professional Plan (5 Seats)',
      quantity: 5,
      unitPriceMinor: 20000n, // EUR 200.00 each
      sku: 'SJ-PRO-SEAT-MO',
    },
  ],
};

/**
 * 3. EU B2C Refund / Credit Note Fixture
 * Refund issued to an individual consumer within statutory withdrawal period.
 * Document references original invoice number and date.
 */
export const CUSTOMER_EU_B2C: VendorInvoiceParty = {
  name: 'Hans Müller',
  country: 'DE',
  address: 'Friedrichstraße 42, 10117 Berlin, Germany',
  isB2B: false,
};

export const EU_B2C_REFUND_REQUEST: VendorInvoiceRequest = {
  documentType: 'CREDIT_NOTE',
  series: 'CN-2026',
  issueDate: '2026-11-21',
  supplier: SUPPLIER_ROXIRA_MY,
  customer: CUSTOMER_EU_B2C,
  currency: Currency.EUR,
  items: [
    {
      description: 'SmartJudge Individual Researcher Subscription (Statutory Refund)',
      quantity: 1,
      unitPriceMinor: 4900n, // EUR 49.00
      sku: 'SJ-IND-SUB-MO',
    },
  ],
  relatedInvoice: {
    invoiceNumber: 'INV-2026-000003',
    issueDate: '2026-11-15',
    reason: 'Statutory 14-day consumer withdrawal refund under Directive 2011/83/EU',
  },
};
