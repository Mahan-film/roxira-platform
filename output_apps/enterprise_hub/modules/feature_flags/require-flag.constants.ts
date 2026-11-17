import { FlagOptions } from './feature-flags.types';

export const REQUIRE_FLAG_KEY = 'roxira:require-flag';

export interface RequiredFlag extends FlagOptions {
  flag: string;
}
