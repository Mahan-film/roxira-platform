import { ChartTemplateInfo } from '../country-pack.types';

/**
 * Neutral SKR03/04-compatible chart template for Germany (Standard-Kontenrahmen DE).
 *
 * Adheres to:
 * - 4-digit German accounting conventions compatible with DATEV SKR03 / SKR04
 * - Neutral naming "Standard-Kontenrahmen DE" (docs/strategy/research/R13_GERMANY.md § 4)
 * - Strict requirement for E-Bilanz Taxonomy 6.9 / 6.10: Grundsteuer in its own dedicated account (4510)
 *   separate from other municipal, vehicle, and operating taxes.
 */
export const DE_NEUTRAL_CHART_TEMPLATE: ChartTemplateInfo = {
  key: 'de-skr-neutral',
  name: 'Standard-Kontenrahmen DE (SKR-kompatibel)',
  description: 'Neutral 4-digit chart of accounts compatible with SKR03/SKR04 with dedicated Grundsteuer account for E-Bilanz',
  accounts: [
    // 0000 Anlagevermögen (Fixed Assets)
    { code: '0001', name: 'Anlagevermögen', accountType: 'ASSET', level: 'GROUP', parentCode: null, reportLine: 'assets.noncurrent' },
    { code: '0100', name: 'Immaterielle Vermögensgegenstände', accountType: 'ASSET', level: 'MOEIN', parentCode: '0001', reportLine: 'assets.noncurrent.intangible' },
    { code: '0110', name: 'Konzessionen, gewerbliche Schutzrechte und Software', accountType: 'ASSET', level: 'TAFSILI', parentCode: '0100', reportLine: 'assets.noncurrent.intangible' },
    { code: '0200', name: 'Sachanlagen', accountType: 'ASSET', level: 'MOEIN', parentCode: '0001', reportLine: 'assets.noncurrent.ppe' },
    { code: '0210', name: 'Grundstücke und grundstücksgleiche Rechte', accountType: 'ASSET', level: 'TAFSILI', parentCode: '0200', reportLine: 'assets.noncurrent.ppe' },
    { code: '0300', name: 'Betriebs- und Geschäftsausstattung', accountType: 'ASSET', level: 'TAFSILI', parentCode: '0200', reportLine: 'assets.noncurrent.ppe' },
    { code: '0480', name: 'Geringwertige Wirtschaftsgüter (GWG)', accountType: 'ASSET', level: 'TAFSILI', parentCode: '0200', reportLine: 'assets.noncurrent.ppe' },

    // 1000 Umlaufvermögen (Current Assets)
    { code: '1000', name: 'Umlaufvermögen und liquide Mittel', accountType: 'ASSET', level: 'GROUP', parentCode: null, reportLine: 'assets.current' },
    { code: '1200', name: 'Bankguthaben und Kasse', accountType: 'ASSET', level: 'MOEIN', parentCode: '1000', reportLine: 'assets.current.cash' },
    { code: '1210', name: 'Kasse (Cash on hand)', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1200', reportLine: 'assets.current.cash' },
    { code: '1220', name: 'Bank (Geschäftskonto EUR)', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1200', reportLine: 'assets.current.cash' },
    { code: '1360', name: 'Geldtransit', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1200', reportLine: 'assets.current.cash' },
    { code: '1400', name: 'Forderungen aus Lieferungen und Leistungen (Debitoren)', accountType: 'ASSET', level: 'MOEIN', parentCode: '1000', reportLine: 'assets.current.receivables' },
    { code: '1410', name: 'Forderungen Inland', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1400', reportLine: 'assets.current.receivables' },
    { code: '1420', name: 'Forderungen EU / Drittland', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1400', reportLine: 'assets.current.receivables' },
    { code: '1500', name: 'Steuerforderungen und Vorsteuer', accountType: 'ASSET', level: 'MOEIN', parentCode: '1000', reportLine: 'assets.current.tax' },
    { code: '1571', name: 'Abziehbare Vorsteuer 7%', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1500', reportLine: 'assets.current.tax' },
    { code: '1576', name: 'Abziehbare Vorsteuer 19%', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1500', reportLine: 'assets.current.tax' },
    { code: '1577', name: 'Abziehbare Vorsteuer nach § 13b UStG', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1500', reportLine: 'assets.current.tax' },
    { code: '1780', name: 'Umsatzsteuer-Vorauszahlungen', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1500', reportLine: 'assets.current.tax' },
    { code: '1781', name: 'USt-Sondervorauszahlung 1/11 (Dauerfristverlängerung)', accountType: 'ASSET', level: 'TAFSILI', parentCode: '1500', reportLine: 'assets.current.tax' },

    // 2000 Eigenkapital (Equity)
    { code: '2000', name: 'Eigenkapital', accountType: 'EQUITY', level: 'GROUP', parentCode: null, reportLine: 'equity' },
    { code: '2100', name: 'Gezeichnetes Kapital / Stammkapital', accountType: 'EQUITY', level: 'MOEIN', parentCode: '2000', reportLine: 'equity.capital' },
    { code: '2110', name: 'Stammkapital / Festkapital', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '2100', reportLine: 'equity.capital' },
    { code: '2800', name: 'Gewinnrücklagen und Ergebnis', accountType: 'EQUITY', level: 'MOEIN', parentCode: '2000', reportLine: 'equity.retained' },
    { code: '2868', name: 'Gewinnvortrag vor Verwendung', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '2800', reportLine: 'equity.retained' },
    { code: '2869', name: 'Jahresüberschuss / Jahresfehlbetrag', accountType: 'EQUITY', level: 'TAFSILI', parentCode: '2800', reportLine: 'equity.retained' },

    // 3000 Verbindlichkeiten (Liabilities)
    { code: '3000', name: 'Verbindlichkeiten', accountType: 'LIABILITY', level: 'GROUP', parentCode: null, reportLine: 'liabilities' },
    { code: '3100', name: 'Verbindlichkeiten aus Lieferungen und Leistungen (Kreditoren)', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '3000', reportLine: 'liabilities.payables' },
    { code: '3110', name: 'Verbindlichkeiten Inland', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '3100', reportLine: 'liabilities.payables' },
    { code: '3120', name: 'Verbindlichkeiten EU / Drittland', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '3100', reportLine: 'liabilities.payables' },
    { code: '1700', name: 'Umsatzsteuerverbindlichkeiten', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '3000', reportLine: 'liabilities.tax' },
    { code: '1771', name: 'Umsatzsteuer 7%', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '1700', reportLine: 'liabilities.tax' },
    { code: '1776', name: 'Umsatzsteuer 19%', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '1700', reportLine: 'liabilities.tax' },
    { code: '1787', name: 'Umsatzsteuer nach § 13b UStG (Steuerschuldnerschaft)', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '1700', reportLine: 'liabilities.tax' },
    { code: '1750', name: 'Verbindlichkeiten aus Lohn und Gehalt', accountType: 'LIABILITY', level: 'MOEIN', parentCode: '3000', reportLine: 'liabilities.payroll' },
    { code: '1755', name: 'Lohnsteuerverbindlichkeiten', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '1750', reportLine: 'liabilities.payroll' },
    { code: '1760', name: 'Verbindlichkeiten soziale Sicherheit', accountType: 'LIABILITY', level: 'TAFSILI', parentCode: '1750', reportLine: 'liabilities.payroll' },

    // 8000 Erlöse (Revenue)
    { code: '8000', name: 'Umsatzerlöse', accountType: 'REVENUE', level: 'GROUP', parentCode: null, reportLine: 'revenue' },
    { code: '8100', name: 'Steuerfreie und nicht steuerbare Umsätze', accountType: 'REVENUE', level: 'MOEIN', parentCode: '8000', reportLine: 'revenue.exempt' },
    { code: '8120', name: 'Steuerfreie Umsätze § 4 Nr. 1a UStG (Ausfuhrlieferungen)', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8100', reportLine: 'revenue.exempt' },
    { code: '8125', name: 'Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8100', reportLine: 'revenue.exempt' },
    { code: '8195', name: 'Erlöse als Kleinunternehmer nach § 19 UStG', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8100', reportLine: 'revenue.exempt' },
    { code: '8300', name: 'Steuerpflichtige Umsätze 7% USt', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8000', reportLine: 'revenue.taxable' },
    { code: '8400', name: 'Steuerpflichtige Umsätze 19% USt', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8000', reportLine: 'revenue.taxable' },
    { code: '8700', name: 'Erlösschmälerungen, Rabatte und Skonti', accountType: 'REVENUE', level: 'MOEIN', parentCode: '8000', reportLine: 'revenue.discounts' },
    { code: '8736', name: 'Gewährte Skonti 19% USt', accountType: 'REVENUE', level: 'TAFSILI', parentCode: '8700', reportLine: 'revenue.discounts' },

    // 4000 Betriebsausgaben (Operating Expenses)
    { code: '4000', name: 'Betriebsausgaben', accountType: 'EXPENSE', level: 'GROUP', parentCode: null, reportLine: 'expenses' },
    { code: '5000', name: 'Materialaufwand und Wareneingang', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '4000', reportLine: 'expenses.materials' },
    { code: '5400', name: 'Wareneingang 19% Vorsteuer', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '5000', reportLine: 'expenses.materials' },
    { code: '6000', name: 'Personalaufwand', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '4000', reportLine: 'expenses.personnel' },
    { code: '6020', name: 'Gehälter', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '6000', reportLine: 'expenses.personnel' },
    { code: '6110', name: 'Gesetzliche soziale Aufwendungen (Arbeitgeberanteil)', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '6000', reportLine: 'expenses.personnel' },
    { code: '4200', name: 'Raumkosten und Miete', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '4000', reportLine: 'expenses.occupancy' },
    { code: '4210', name: 'Miete und Nebenkosten', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '4200', reportLine: 'expenses.occupancy' },

    // Dedicated Betriebliche Steuern MOEIN group with separate Grundsteuer account
    { code: '4500', name: 'Betriebliche Steuern', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '4000', reportLine: 'expenses.taxes' },
    {
      code: '4510',
      name: 'Grundsteuer',
      accountType: 'EXPENSE',
      level: 'TAFSILI',
      parentCode: '4500',
      reportLine: 'expenses.taxes.property_tax',
    },
    { code: '4520', name: 'Gewerbesteuer', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '4500', reportLine: 'expenses.taxes.trade_tax' },
    { code: '4530', name: 'Kraftfahrzeugsteuer', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '4500', reportLine: 'expenses.taxes.vehicle_tax' },
    { code: '4540', name: 'Sonstige betriebliche Steuern und Abgaben', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '4500', reportLine: 'expenses.taxes.other' },

    // Sonstige betriebliche Aufwendungen
    { code: '6800', name: 'Sonstige betriebliche Aufwendungen', accountType: 'EXPENSE', level: 'MOEIN', parentCode: '4000', reportLine: 'expenses.other' },
    { code: '6855', name: 'Rechts- und Beratungskosten', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '6800', reportLine: 'expenses.other' },
    { code: '6870', name: 'Buchführungs- und Steuerberatungskosten', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '6800', reportLine: 'expenses.other' },
    { code: '6850', name: 'Beiträge und Gebühren', accountType: 'EXPENSE', level: 'TAFSILI', parentCode: '6800', reportLine: 'expenses.other' },
  ],
};
