import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FlagOptions } from './feature-flags.types';
import { REQUIRE_FLAG_KEY, RequiredFlag } from './require-flag.constants';

/**
 * Hides a route (404) unless the flag is on for the caller's tenant and country pack.
 * Use on every route of a new module so it can be switched off without a deploy.
 */
export const RequireFlag = (flag: string, options: FlagOptions = {}) =>
  applyDecorators(
    SetMetadata(REQUIRE_FLAG_KEY, { flag, ...options } satisfies RequiredFlag),
    UseGuards(FeatureFlagGuard),
  );
