import type { Context } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { fail } from "../shared/envelope.ts";

let sentry: { captureException: (err: unknown, opts?: unknown) => string } | null = null;

// Inicializa Sentry solo si hay DSN configurado
async function getSentry(): Promise<typeof sentry> {
  if (sentry !== null) return sentry;
  const dsn = process.env["SENTRY_DSN"] ??
    (globalThis as Record<string, unknown>)["SENTRY_DSN"];
  if (!dsn) return null;

  try {
    // Importación dinámica de Sentry — evita resolución estática de módulos
    // para que el typecheck no falle si el paquete no está instalado localmente.
    // En producción (Deno Edge), se resuelve via importmap o npm: specifier.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function("m", "return import(m)") as
      (m: string) => Promise<Record<string, unknown>>;
    const Sentry = await dynamicImport("@sentry/node").catch(() => null);
    if (Sentry && typeof Sentry["init"] === "function") {
      (Sentry["init"] as (o: unknown) => void)({ dsn });
      sentry = {
        captureException: (err: unknown, opts?: unknown) =>
          (Sentry["captureException"] as (e: unknown, o?: unknown) => string)(err, opts),
      };
    }
  } catch {
    // Sentry no disponible en este entorno
  }
  return sentry;
}

/**
 * Error handler global para Hono (app.onError).
 * - DomainError → respuesta tipada con el código y statusCode del error.
 * - Errores no controlados → captura en Sentry, responde 500 INTERNAL_ERROR.
 * - Nunca filtra stack traces al cliente (RN-G).
 */
export async function errorHandler(err: unknown, c: Context): Promise<Response> {
  if (err instanceof DomainError) {
    return c.json(
      fail(err.code, err.message, err.statusCode, err.details),
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500,
    );
  }

  // Error no controlado
  const tenantId = (() => {
    try { return c.get("tenantId"); } catch { return "unknown"; }
  })();

  console.error("[errorHandler] Error no controlado:", err);

  const s = await getSentry();
  if (s) {
    s.captureException(err, {
      tags: { tenantId, module: "unknown" },
    });
  }

  return c.json(
    fail(ErrorCode.INTERNAL_ERROR, "Error interno del servidor", 500),
    500,
  );
}
