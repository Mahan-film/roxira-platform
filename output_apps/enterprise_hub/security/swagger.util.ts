/** Swagger فقط در غیر production یا با ENABLE_SWAGGER=1 فعال می‌شود. */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ENABLE_SWAGGER === '1';
}
