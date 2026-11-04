/**
 * What a migration needs from the source database, independent of the vendor (Holoo, Sepidar, Hamkaran, Mahak, ...).
 * Each target has typed fields; `synonyms` are normalised Persian/English column-name hints. Vendors do not
 * publish their schemas, so these are hints for the heuristic and context for the AI step, never a fixed mapping.
 *
 * Types: text, money (DECIMAL(28,4), rial unless the review says otherwise), qty (DECIMAL(28,6)), date (ISO, Jalali
 * accepted), enum (listed `values`).
 */
export const TARGETS = {
  gl_accounts: {
    hints: ['حساب', 'سرفصل', 'account', 'coa', 'chart', 'accounts', 'tblhesab'],
    fields: {
      code: { type: 'text', required: true, synonyms: ['code', 'کدحساب', 'کد', 'accountcode', 'accno', 'hesabcode'] },
      name: { type: 'text', required: true, synonyms: ['name', 'نام', 'نامحساب', 'title', 'عنوان', 'accountname'] },
      parent_code: { type: 'text', required: false, synonyms: ['parent', 'parentcode', 'کدسرگروه', 'سرگروه', 'کدپدر'] },
    },
  },
  gl_trial_balance: {
    hints: ['تراز', 'trial', 'balance', 'مانده', 'tarazname'],
    fields: {
      account_code: { type: 'text', required: true, synonyms: ['accountcode', 'کدحساب', 'کد', 'code', 'account'] },
      debit: { type: 'money', required: true, synonyms: ['debit', 'بدهکار', 'بد', 'debtor', 'dr'] },
      credit: { type: 'money', required: true, synonyms: ['credit', 'بستانکار', 'بس', 'creditor', 'cr'] },
    },
  },
  gl_lines: {
    hints: ['سند', 'آرتیکل', 'voucher', 'journal', 'entry', 'document', 'sanad', 'ledger', 'دفتر'],
    fields: {
      account_code: { type: 'text', required: true, synonyms: ['accountcode', 'کدحساب', 'حساب', 'account', 'code'] },
      voucher_no: { type: 'text', required: true, synonyms: ['voucherno', 'documentno', 'شمارهسند', 'سند', 'sanadno', 'docno', 'number'] },
      date: { type: 'date', required: false, synonyms: ['date', 'تاریخ', 'docdate', 'تاریخسند'] },
      debit: { type: 'money', required: false, synonyms: ['debit', 'بدهکار', 'بد', 'dr'] },
      credit: { type: 'money', required: false, synonyms: ['credit', 'بستانکار', 'بس', 'cr'] },
      description: { type: 'text', required: false, synonyms: ['description', 'شرح', 'توضیحات', 'desc', 'memo'] },
    },
  },
  parties: {
    hints: ['مشتری', 'طرفحساب', 'اشخاص', 'party', 'customer', 'supplier', 'vendor', 'person', 'tafzili', 'تفصیلی'],
    fields: {
      code: { type: 'text', required: true, synonyms: ['code', 'کد', 'کدمشتری', 'partycode', 'customercode', 'کدتفصیلی'] },
      name: { type: 'text', required: true, synonyms: ['name', 'نام', 'نامشخص', 'customername', 'title', 'عنوان'] },
      kind: { type: 'text', required: false, synonyms: ['type', 'kind', 'نوع'] },
    },
  },
  open_items: {
    hints: ['مانده', 'فاکتور', 'invoice', 'receivable', 'payable', 'bill', 'ar', 'ap', 'بدهکاران', 'بستانکاران'],
    fields: {
      party_code: { type: 'text', required: true, synonyms: ['partycode', 'customercode', 'کدمشتری', 'کدطرفحساب', 'party', 'customer'] },
      doc_no: { type: 'text', required: true, synonyms: ['docno', 'invoiceno', 'شمارهفاکتور', 'شماره', 'number', 'billno'] },
      date: { type: 'date', required: false, synonyms: ['date', 'تاریخ', 'invoicedate'] },
      due_date: { type: 'date', required: false, synonyms: ['duedate', 'سررسید', 'تاریخسررسید'] },
      amount: { type: 'money', required: true, synonyms: ['amount', 'مبلغ', 'مانده', 'balance', 'remaining', 'total'] },
      kind: { type: 'enum', values: ['AR', 'AP'], required: false, synonyms: ['kind', 'type', 'نوع'] },
    },
  },
  cheques: {
    hints: ['چک', 'cheque', 'check', 'checks', 'cheques'],
    fields: {
      cheque_no: { type: 'text', required: true, synonyms: ['chequeno', 'checkno', 'شمارهچک', 'شماره', 'number', 'serial'] },
      bank: { type: 'text', required: false, synonyms: ['bank', 'بانک', 'نامبانک'] },
      due_date: { type: 'date', required: true, synonyms: ['duedate', 'سررسید', 'تاریخسررسید', 'date'] },
      amount: { type: 'money', required: true, synonyms: ['amount', 'مبلغ', 'مبلغچک'] },
      party_code: { type: 'text', required: false, synonyms: ['partycode', 'customercode', 'کدمشتری', 'party'] },
      direction: { type: 'enum', values: ['receivable', 'payable'], required: false, synonyms: ['direction', 'type', 'نوع', 'دریافتی', 'پرداختی'] },
      status: { type: 'text', required: false, synonyms: ['status', 'وضعیت', 'state'] },
    },
  },
  items: {
    hints: ['کالا', 'محصول', 'item', 'product', 'goods', 'article', 'kala'],
    fields: {
      code: { type: 'text', required: true, synonyms: ['code', 'کد', 'کدکالا', 'itemcode', 'sku'] },
      name: { type: 'text', required: true, synonyms: ['name', 'نام', 'نامکالا', 'itemname', 'title'] },
      unit: { type: 'text', required: false, synonyms: ['unit', 'واحد', 'واحداصلی', 'uom'] },
    },
  },
  stock_moves: {
    hints: ['موجودی', 'انبار', 'حواله', 'رسید', 'stock', 'inventory', 'warehouse', 'movement', 'kardex', 'کاردکس'],
    fields: {
      item_code: { type: 'text', required: true, synonyms: ['itemcode', 'کدکالا', 'کالا', 'sku', 'code'] },
      warehouse: { type: 'text', required: true, synonyms: ['warehouse', 'انبار', 'کدانبار', 'store', 'wh'] },
      date: { type: 'date', required: false, synonyms: ['date', 'تاریخ'] },
      doc_no: { type: 'text', required: false, synonyms: ['docno', 'شماره', 'شمارهسند', 'number'] },
      qty: { type: 'qty', required: true, synonyms: ['qty', 'quantity', 'تعداد', 'مقدار', 'موجودی'] },
      unit_cost: { type: 'money', required: false, synonyms: ['unitcost', 'cost', 'فی', 'قیمتواحد', 'price', 'نرخ'] },
      direction: { type: 'enum', values: ['in', 'out'], required: false, synonyms: ['direction', 'type', 'نوع', 'ورود', 'خروج'] },
    },
  },
};
