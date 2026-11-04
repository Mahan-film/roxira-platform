import { BadRequestException } from '@nestjs/common';

export type PostingErrorCode =
  | 'UNKNOWN_DOC_TYPE'
  | 'MISSING_AMOUNT'
  | 'NEGATIVE_AMOUNT'
  | 'UNMAPPED_ROLE'
  | 'UNBALANCED'
  | 'EMPTY_VOUCHER'
  | 'UNKNOWN_ACCOUNT'
  | 'HEADER_ACCOUNT'
  | 'INVALID_MAPPING';

/** A refusal of the posting engine; the message is Persian and shown to the user as is. */
export class PostingRuleError extends BadRequestException {
  constructor(
    readonly code: PostingErrorCode,
    message: string,
  ) {
    super({ statusCode: 400, error: 'PostingRuleError', code, message });
  }
}
