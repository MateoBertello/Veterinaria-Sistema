/**
 * Helpers de sanitización contra inyección. Centralizados para tener un único punto
 * auditado (evita el `replace` inline duplicado por cada service con búsqueda).
 */

/**
 * Neutraliza un término de búsqueda antes de interpolarlo en un patrón `ilike`/`or()`
 * de PostgREST.
 *
 * - `,` es el separador de condiciones dentro de `.or(...)`: sin quitarlo, un término
 *   como `x,activo.eq.true` inyectaría condiciones PostgREST adicionales.
 * - `%` es el wildcard de `LIKE`: se elimina para que el usuario no controle el patrón.
 *
 * Ambos se reemplazan por espacio (no se borran) para no fusionar tokens vecinos.
 */
export function sanitizeLikeTerm(term: string): string {
  return term.replace(/[%,]/g, " ");
}

/**
 * Neutraliza una celda contra formula/CSV injection (CWE-1236): en Excel/LibreOffice/
 * Sheets, una celda que empieza con `=`, `+`, `-`, `@`, TAB o CR se interpreta como
 * fórmula al abrir el archivo. Se prefija una comilla simple para forzar texto.
 *
 * Sólo actúa sobre strings no vacíos; devuelve el valor intacto en cualquier otro caso.
 */
export function neutralizeFormula(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
