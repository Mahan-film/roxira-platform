import { ForbiddenException } from '@nestjs/common';

/** Machine-readable reasons the frontend can react to (`{ code, message }` in the 403 body). */
export type AccessDeniedCode =
  | 'NO_ORGANISATION'
  | 'NOT_A_MEMBER'
  | 'MODULE_NOT_ENTITLED'
  | 'FORBIDDEN_ACTION'
  | 'FORBIDDEN_FIELD'
  | 'FORBIDDEN_SCOPE'
  | 'AMOUNT_LIMIT_EXCEEDED'
  | 'MFA_REQUIRED'
  | 'NO_ACCESS_POLICY';

export const denied = (code: AccessDeniedCode, message: string): ForbiddenException =>
  new ForbiddenException({ statusCode: 403, code, message });
