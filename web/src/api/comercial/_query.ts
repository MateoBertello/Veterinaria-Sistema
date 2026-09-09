/**
 * Helper para construcción uniforme de query strings.
 * Omite undefined, null y strings vacíos para no contaminar la URL.
 * Prohibido enviar tenant_id en cualquier query param.
 */
export function buildQuery(params: Record<string, unknown> = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      qs.set(key, String(value));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}
