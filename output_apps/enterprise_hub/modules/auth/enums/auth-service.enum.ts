/**
 * دامنه/سرویس هدف احراز هویت.
 *
 * هر دامنه قالب پیامک اختصاصی خود را در کاوه‌نگار دارد:
 *   • GHAZI  → قالب `ghazi-verify`  (دامنه ghazihoushmand.ir)
 *   • ROXIRA → قالب `roxira-verify` (دامنه roxira.ir / roxira.net)
 */
export enum AuthServiceDomain {
  ROXIRA = 'ROXIRA',
  GHAZI = 'GHAZI',
}
