/**
 * Accepts only http(s) URLs, same-origin absolute paths and raster data:image URLs
 * (no SVG) for a template logo. Anything else (javascript:, vbscript:, data:text/html,
 * protocol-relative //host, quotes, angle brackets, whitespace) returns "".
 * The result is still HTML-escaped by renderTemplate when printed.
 */
export function safeLogoUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (url === "" || url.length > 200_000) return "";
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
  if (/^https?:\/\/[^\s"'<>`\\]+$/i.test(url)) return url;
  if (/^\/(?!\/)[^\s"'<>`\\]*$/.test(url)) return url;
  return "";
}
