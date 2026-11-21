import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_CANCELLATION_KEY = 'allow_during_cancellation';

/**
 * Decorates endpoints that are explicitly allowed to perform operations
 * even when the tenant is in `cancelled_readonly` status (e.g. data export jobs).
 */
export const AllowDuringCancellation = () => SetMetadata(ALLOW_DURING_CANCELLATION_KEY, true);
