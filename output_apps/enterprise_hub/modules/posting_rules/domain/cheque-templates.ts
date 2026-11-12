import type { PostingRole } from '../constants/posting-roles';
import type { PostingTemplate, TemplateLine } from './posting-templates';

/**
 * Cheque lifecycle vouchers. Every role (`cheques_receivable`, `cheques_in_collection`,
 * `cheques_payable`, `bank`, `receivable`, `payable`) resolves per tenant via PostingRulesService
 * and falls back to `DEFAULT_ROLE_ACCOUNTS` (`iran-chart-template.ts`: 1012 bank, 1020 receivable,
 * 2010 payable, 1021 notes receivable, 2011 notes payable). Lines carry no description; only the
 * receivable and payable lines carry the party.
 */
const dr = (role: PostingRole, party = false): TemplateLine => ({ role, side: 'debit', amount: 'amount', description: '', party });
const cr = (role: PostingRole, party = false): TemplateLine => ({ role, side: 'credit', amount: 'amount', description: '', party });
const t = (docType: string, title: string, lines: TemplateLine[]): PostingTemplate => ({ docType, title, amounts: ['amount'], lines });

export const CHEQUE_TEMPLATES: readonly PostingTemplate[] = [
  t('cheque.received.create', 'دریافت چک', [dr('cheques_receivable'), cr('receivable', true)]),
  t('cheque.received.deposit', 'واگذاری چک به بانک برای وصول', [dr('cheques_in_collection'), cr('cheques_receivable')]),
  t('cheque.received.redeposit', 'ارائه مجدد چک برگشتی به بانک', [dr('cheques_in_collection'), cr('receivable', true)]),
  t('cheque.received.clear', 'وصول چک', [dr('bank'), cr('cheques_in_collection')]),
  t('cheque.received.clear_direct', 'وصول چک (ارائه مستقیم در بانک)', [dr('bank'), cr('cheques_receivable')]),
  t('cheque.received.bounce', 'برگشت چک', [dr('receivable', true), cr('cheques_in_collection')]),
  t('cheque.received.bounce_direct', 'برگشت چک (ارائه مستقیم در بانک)', [dr('receivable', true), cr('cheques_receivable')]),
  t('cheque.received.spend', 'خرج چک به شخص ثالث', [dr('payable', true), cr('cheques_receivable')]),
  t('cheque.received.return', 'استرداد چک به صادرکننده', [dr('receivable', true), cr('cheques_receivable')]),
  t('cheque.issued.create', 'صدور چک', [dr('payable', true), cr('cheques_payable')]),
  t('cheque.issued.clear', 'پاس شدن چک پرداختنی', [dr('cheques_payable'), cr('bank')]),
  t('cheque.issued.return', 'ابطال و استرداد چک صادرشده', [dr('cheques_payable'), cr('payable', true)]),
];
