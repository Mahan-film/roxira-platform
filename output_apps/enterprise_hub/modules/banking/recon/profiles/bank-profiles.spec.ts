import { BankCode } from '../../enums/banking.enum';
import {
  BANK_PROFILES,
  OTHER_BANKS,
  bankFromIban,
  bankFromText,
  bankNameFa,
  matchLayout,
} from './bank-profiles';

describe('bank-profiles', () => {
  describe('BANK_PROFILES', () => {
    it('each profile has required fields', () => {
      for (const profile of BANK_PROFILES) {
        expect(profile.code).toBeDefined();
        expect(profile.nameFa).toBeDefined();
        expect(profile.ibanBankId).toBeDefined();
        expect(profile.titleKeywords).toBeDefined();
        expect(profile.layouts).toBeDefined();
        expect(profile.layouts.length).toBeGreaterThan(0);
        
        for (const layout of profile.layouts) {
          expect(layout.id).toBeDefined();
          expect(layout.evidence).toBeDefined();
          expect(layout.columns).toBeDefined();
          expect(Object.keys(layout.columns).length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('OTHER_BANKS', () => {
    it('each bank has required fields', () => {
      for (const bank of OTHER_BANKS) {
        expect(bank.code).toBeDefined();
        expect(bank.nameFa).toBeDefined();
        expect(bank.ibanBankId).toBeDefined();
        expect(bank.titleKeywords).toBeDefined();
      }
    });
  });

  describe('bankNameFa', () => {
    it('returns the correct bank name in Farsi', () => {
      expect(bankNameFa(BankCode.MELLAT)).toBe('بانک ملت');
      expect(bankNameFa(BankCode.MELLI)).toBe('بانک ملی ایران');
      expect(bankNameFa(BankCode.SADERAT)).toBe('بانک صادرات ایران');
      expect(bankNameFa('unknown')).toBe('نامشخص');
    });
  });

  describe('bankFromIban', () => {
    it('returns the correct bank code from IBAN', () => {
      // bankFromIban reads iban.slice(4, 7), i.e. the 3 bank-id digits after IR + check digits.
      expect(bankFromIban('IR0001200000000000000000')).toBe(BankCode.MELLAT);
      expect(bankFromIban('IR0001700000000000000000')).toBe(BankCode.MELLI);
      expect(bankFromIban('IR0001900000000000000000')).toBe(BankCode.SADERAT);
      expect(bankFromIban('IR0099900000000000000000')).toBeNull();
    });
  });

  describe('bankFromText', () => {
    it('returns the correct bank code from text', () => {
      expect(bankFromText('بانک ملت')).toBe(BankCode.MELLAT);
      expect(bankFromText('بانک ملی')).toBe(BankCode.MELLI);
      expect(bankFromText('بانک صادرات')).toBe(BankCode.SADERAT);
      expect(bankFromText('بانک تجارت')).toBe(BankCode.TEJARAT);
      expect(bankFromText('بانک پاسارگاد')).toBe(BankCode.PASARGAD);
      expect(bankFromText('بانک سامان')).toBe(BankCode.SAMAN);
      expect(bankFromText('بانک سپه')).toBe(BankCode.SEPAH);
      expect(bankFromText('بانک کشاورزی')).toBe(BankCode.KESHAVARZI);
      expect(bankFromText('بانک مسکن')).toBe(BankCode.MASKAN);
      expect(bankFromText('بانک رفاه')).toBe(BankCode.REFAH);
      expect(bankFromText('بانک پارسیان')).toBe(BankCode.PARSIAN);
      expect(bankFromText('بانک کارآفرین')).toBe(BankCode.KARAFARIN);
      expect(bankFromText('بانک اقتصاد نوین')).toBe(BankCode.EGHTESAD_NOVIN);
      expect(bankFromText('بانک سینا')).toBe(BankCode.SINA);
      expect(bankFromText('بانک شهر')).toBe(BankCode.SHAHR);
      expect(bankFromText('بانک آینده')).toBe(BankCode.AYANDEH);
      expect(bankFromText('بانک دی')).toBe(BankCode.DEY);
      expect(bankFromText('پست بانک')).toBe(BankCode.POST_BANK);
      expect(bankFromText('unknown bank')).toBeNull();
    });
  });

  describe('matchLayout', () => {
    it('matches the correct layout for Mellat bank', () => {
      const headers = ['تاریخ', 'زمان', 'شرح', 'شماره پیگیری', 'بدهکار', 'بستانکار', 'مانده'];
      const result = matchLayout(headers);
      expect(result).not.toBeNull();
      expect(result?.profile.code).toBe(BankCode.MELLAT);
      expect(result?.layout.id).toBe('mellat-internet-bank');
    });

    it('matches the correct layout for Melli bank', () => {
      const headers = ['تاریخ', 'ساعت', 'شرح عملیات', 'شماره سند', 'برداشت', 'واریز', 'مانده'];
      const result = matchLayout(headers);
      expect(result).not.toBeNull();
      expect(result?.profile.code).toBe(BankCode.MELLI);
      expect(result?.layout.id).toBe('melli-sepideh');
    });

    it('returns null for unknown layout', () => {
      const headers = ['unknown', 'headers'];
      const result = matchLayout(headers);
      expect(result).toBeNull();
    });
  });
});
