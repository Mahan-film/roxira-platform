const ts = () => new Date().toISOString().slice(11, 23);

export function logger(tag: string) {
  return {
    info: (...a: unknown[]) => console.log(ts(), `[${tag}]`, ...a),
    warn: (...a: unknown[]) => console.warn(ts(), `[${tag}] WARN`, ...a),
    error: (...a: unknown[]) => console.error(ts(), `[${tag}] ERROR`, ...a),
  };
}
export type Log = ReturnType<typeof logger>;
