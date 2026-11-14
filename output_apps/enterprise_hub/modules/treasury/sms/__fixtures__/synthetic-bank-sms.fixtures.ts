import { BankCode } from '../../../banking/enums/banking.enum';
import { BankSmsDirection } from '../bank-sms.types';

export interface SyntheticBankSmsFixture {
  bank: BankCode;
  bankNameFa: string;
  direction: BankSmsDirection;
  text: string;
  expected: {
    amountRials: string;
    direction: BankSmsDirection;
    balanceRials?: string;
    cardOrAccountTail?: string;
  };
}

export const SYNTHETIC_BANK_SMS_FIXTURES: readonly SyntheticBankSmsFixture[] = [
  // 1. Melli (بانک ملی)
  {
    bank: BankCode.MELLI,
    bankNameFa: 'بانک ملی ایران',
    direction: 'deposit',
    text: `بانک ملی ایران
واریز: ۲,۵۰۰,۰۰۰ ریال
حساب: ...۴۳۲۱
مانده: ۱۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲-۱۴:۳۰`,
    expected: {
      amountRials: '2500000.00',
      direction: 'deposit',
      balanceRials: '10000000.00',
      cardOrAccountTail: '4321',
    },
  },
  {
    bank: BankCode.MELLI,
    bankNameFa: 'بانک ملی ایران',
    direction: 'withdraw',
    text: `بانک ملی ایران
برداشت: ۱,۲۰۰,۰۰۰ ریال
از حساب: ...۴۳۲۱
مانده: ۸,۸۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲-۱۵:۰۰`,
    expected: {
      amountRials: '1200000.00',
      direction: 'withdraw',
      balanceRials: '8800000.00',
      cardOrAccountTail: '4321',
    },
  },

  // 2. Mellat (بانک ملت)
  {
    bank: BankCode.MELLAT,
    bankNameFa: 'بانک ملت',
    direction: 'deposit',
    text: `بانک ملت
واریز مبلغ: ۳,۰۰۰,۰۰۰ ریال
به: ...۵۶۷۸
مانده: ۱۵,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۱:۲۰`,
    expected: {
      amountRials: '3000000.00',
      direction: 'deposit',
      balanceRials: '15000000.00',
      cardOrAccountTail: '5678',
    },
  },
  {
    bank: BankCode.MELLAT,
    bankNameFa: 'بانک ملت',
    direction: 'withdraw',
    text: `بانک ملت
برداشت مبلغ: ۵۰۰,۰۰۰ ریال
از: ...۵۶۷۸
مانده: ۱۴,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۲:۱۰`,
    expected: {
      amountRials: '500000.00',
      direction: 'withdraw',
      balanceRials: '14500000.00',
      cardOrAccountTail: '5678',
    },
  },

  // 3. Saderat (بانک صادرات)
  {
    bank: BankCode.SADERAT,
    bankNameFa: 'بانک صادرات ایران',
    direction: 'deposit',
    text: `بانک صادرات ایران
واریز: ۴,۰۰۰,۰۰۰ ریال
حساب: ...۹۸۷۶
مانده: ۲۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۰:۱۵`,
    expected: {
      amountRials: '4000000.00',
      direction: 'deposit',
      balanceRials: '20000000.00',
      cardOrAccountTail: '9876',
    },
  },
  {
    bank: BankCode.SADERAT,
    bankNameFa: 'بانک صادرات ایران',
    direction: 'withdraw',
    text: `بانک صادرات ایران
برداشت: ۱,۰۰۰,۰۰۰ ریال
حساب: ...۹۸۷۶
مانده: ۱۹,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۳:۴۵`,
    expected: {
      amountRials: '1000000.00',
      direction: 'withdraw',
      balanceRials: '19000000.00',
      cardOrAccountTail: '9876',
    },
  },

  // 4. Tejarat (بانک تجارت)
  {
    bank: BankCode.TEJARAT,
    bankNameFa: 'بانک تجارت',
    direction: 'deposit',
    text: `بانک تجارت
واریز: ۷,۵۰۰,۰۰۰ ریال
حساب: ...۳۴۵۶
مانده: ۳۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۰۹:۰۰`,
    expected: {
      amountRials: '7500000.00',
      direction: 'deposit',
      balanceRials: '30000000.00',
      cardOrAccountTail: '3456',
    },
  },
  {
    bank: BankCode.TEJARAT,
    bankNameFa: 'بانک تجارت',
    direction: 'withdraw',
    text: `بانک تجارت
برداشت: ۲,۵۰۰,۰۰۰ ریال
حساب: ...۳۴۵۶
مانده: ۲۷,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۴:۲۰`,
    expected: {
      amountRials: '2500000.00',
      direction: 'withdraw',
      balanceRials: '27500000.00',
      cardOrAccountTail: '3456',
    },
  },

  // 5. Saman (بانک سامان)
  {
    bank: BankCode.SAMAN,
    bankNameFa: 'بانک سامان',
    direction: 'deposit',
    text: `بانک سامان
واریز: ۶,۰۰۰,۰۰۰ ریال
حساب: ...۱۱۲۲
موجودی: ۲۵,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۰۸:۳۰`,
    expected: {
      amountRials: '6000000.00',
      direction: 'deposit',
      balanceRials: '25000000.00',
      cardOrAccountTail: '1122',
    },
  },
  {
    bank: BankCode.SAMAN,
    bankNameFa: 'بانک سامان',
    direction: 'withdraw',
    text: `بانک سامان
برداشت: ۱,۵۰۰,۰۰۰ ریال
کارت: ...۶۰۳۷
موجودی: ۲۳,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۶:۰۰`,
    expected: {
      amountRials: '1500000.00',
      direction: 'withdraw',
      balanceRials: '23500000.00',
      cardOrAccountTail: '6037',
    },
  },

  // 6. Pasargad (بانک پاسارگاد)
  {
    bank: BankCode.PASARGAD,
    bankNameFa: 'بانک پاسارگاد',
    direction: 'deposit',
    text: `بانک پاسارگاد
واریز: ۸,۰۰۰,۰۰۰ ریال
به سپرده: ...۷۷۸۸
موجودی: ۴۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۷:۴۵`,
    expected: {
      amountRials: '8000000.00',
      direction: 'deposit',
      balanceRials: '40000000.00',
      cardOrAccountTail: '7788',
    },
  },
  {
    bank: BankCode.PASARGAD,
    bankNameFa: 'بانک پاسارگاد',
    direction: 'withdraw',
    text: `بانک پاسارگاد
برداشت: ۲,۰۰۰,۰۰۰ ریال
از سپرده: ...۷۷۸۸
موجودی: ۳۸,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۸:۳۰`,
    expected: {
      amountRials: '2000000.00',
      direction: 'withdraw',
      balanceRials: '38000000.00',
      cardOrAccountTail: '7788',
    },
  },

  // 7. Parsian (بانک پارسیان)
  {
    bank: BankCode.PARSIAN,
    bankNameFa: 'بانک پارسیان',
    direction: 'deposit',
    text: `بانک پارسیان
واریز: ۳,۵۰۰,۰۰۰ ریال
حساب: ...۹۹۰۰
مانده: ۱۸,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۰:۰۰`,
    expected: {
      amountRials: '3500000.00',
      direction: 'deposit',
      balanceRials: '18000000.00',
      cardOrAccountTail: '9900',
    },
  },
  {
    bank: BankCode.PARSIAN,
    bankNameFa: 'بانک پارسیان',
    direction: 'withdraw',
    text: `بانک پارسیان
برداشت: ۱,۵۰۰,۰۰۰ ریال
حساب: ...۹۹۰۰
مانده: ۱۶,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۲:۰۰`,
    expected: {
      amountRials: '1500000.00',
      direction: 'withdraw',
      balanceRials: '16500000.00',
      cardOrAccountTail: '9900',
    },
  },

  // 8. Sepah (بانک سپه)
  {
    bank: BankCode.SEPAH,
    bankNameFa: 'بانک سپه',
    direction: 'deposit',
    text: `بانک سپه
واریز: ۵,۰۰۰,۰۰۰ ریال
حساب: ...۵۵۴۴
مانده: ۱۲,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۳:۰۰`,
    expected: {
      amountRials: '5000000.00',
      direction: 'deposit',
      balanceRials: '12000000.00',
      cardOrAccountTail: '5544',
    },
  },
  {
    bank: BankCode.SEPAH,
    bankNameFa: 'بانک سپه',
    direction: 'withdraw',
    text: `بانک سپه
برداشت: ۵۰۰,۰۰۰ ریال
حساب: ...۵۵۴۴
مانده: ۱۱,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۶:۱۵`,
    expected: {
      amountRials: '500000.00',
      direction: 'withdraw',
      balanceRials: '11500000.00',
      cardOrAccountTail: '5544',
    },
  },
];
