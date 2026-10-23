// This local dashboard has no remote authentication. Refuse cross-origin and
// non-loopback requests before returning private annotations or making API calls.
export function localKeyRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return false;
  // Next's Node server can normalize request.url to localhost while preserving
  // the browser's actual 127.0.0.1 Host. Validate that Host before comparing Origin.
  const host = request.headers.get("host") ?? url.host;
  let actual: URL;
  try { actual = new URL(`${url.protocol}//${host}`); } catch { return false; }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(actual.hostname) || actual.host !== host) return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== actual.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "none" || site === "same-origin";
}
export function validKeyRange(start: string, end: string): boolean {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  return valid(start) && valid(end) && start < end && Date.parse(end) - Date.parse(start) <= 3660 * 86400_000;
}
