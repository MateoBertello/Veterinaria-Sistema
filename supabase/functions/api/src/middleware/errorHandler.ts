import type { Context } from "hono";
import { DomainError, ErrorCode } from "../shared/errors.ts";
import { fail } from "../shared/envelope.ts";

interface SentryClient {
  captureException: (err: unknown, opts?: unknown) => string;
}

let sentryClient: SentryClient | null = null;
let resolved = false;

/**
 * Inyecta (o limpia) el cliente Sentry. Pensado para tests: permite verificar
 * que un 5xx llama a captureException con los tags correctos sin depender del
 * SDK real ni de un DSN. En producción NO se usa.
 */
export function __setSentryClient(client: SentryClient | null): void {
  sentryClient = client;
  resolved = true;
}

/** Restablece el estado de resolución (solo tests). */
export function __resetSentry(): void {
  sentryClient = null;
  resolved = false;
}

function readEnv(key: string): string | undefined {
  return (process.env[key] ??
    (globalThis as Record<string, unknown>)[key]) as string | undefined;
}

/**
 * beforeSend: barrera anti-PII / datos clínicos (Regla 7). Nunca se envía a
 * Sentry el cuerpo del request, headers, datos de usuario ni de entidades de
 * negocio (historial clínico, clientes). Solo viajan tipo de error, mensaje y
 * los tags module/tenantId.
 */
function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
  delete event["request"];
  delete event["user"];
  delete event["extra"];
  delete event["contexts"];
  delete event["breadcrumbs"];
  return event;
}

/**
 * Resuelve el SDK de Sentry de forma perezosa, solo si hay SENTRY_DSN.
 * - Runtime Edge (Deno): @sentry/deno (nativo, en el importmap de deno.json).
 * - Entorno de tests (Node/Vitest): fallback a @sentry/node si está instalado.
 * El import es dinámico vía `new Function` para evitar la resolución estática
 * de módulos en el typecheck.
 */
async function getSentry(): Promise<SentryClient | null> {
  if (resolved) return sentryClient;
  resolved = true;

  const dsn = readEnv("SENTRY_DSN");
  if (!dsn) {
    sentryClient = null;
    return null;
  }

  try {
    const dynamicImport = new Function("m", "return import(m)") as
      (m: string) => Promise<Record<string, unknown>>;

    const Sentry =
      (await dynamicImport("@sentry/deno").catch(() => null)) ??
      (await dynamicImport("@sentry/node").catch(() => null));

    if (Sentry && typeof Sentry["init"] === "function") {
      (Sentry["init"] as (o: unknown) => void)({
        dsn,
        environment: readEnv("SENTRY_ENVIRONMENT") ?? "production",
        sendDefaultPii: false,
        beforeSend: (event: Record<string, unknown>) => scrubEvent(event),
      });
      sentryClient = {
        captureException: (err: unknown, opts?: unknown) =>
          (Sentry["captureException"] as (e: unknown, o?: unknown) => string)(
            err,
            opts,
          ),
      };
    }
  } catch {
    // Sentry no disponible en este entorno: se sigue respondiendo 500 genérico.
  }
  return sentryClient;
}

/**
 * Deriva el tag `module` del path de la request: `/api/v1/<modulo>/...` → `<modulo>`.
 * Fallback `"unknown"` si el path no encaja.
 */
function moduleFromPath(path: string): string {
  const m = path.match(/\/api\/v1\/([^/?]+)/);
  return m?.[1] ?? "unknown";
}

/**
 * Error handler global para Hono (app.onError).
 * - DomainError → respuesta tipada con el código y statusCode del error (no se reporta).
 * - Errores no controlados → 500 INTERNAL_ERROR genérico + captura en Sentry con
 *   tags `module` (derivado del path) y `tenantId` (del contexto) — Regla 7.
 * - Nunca filtra stack traces ni PII al cliente.
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
    try {
      return (c.get("tenantId") as string | undefined) ?? "unknown";
    } catch {
      return "unknown";
    }
  })();
  const module = moduleFromPath(c.req.path);

  console.error("[errorHandler] Error no controlado:", err);

  const s = await getSentry();
  if (s) {
    s.captureException(err, {
      tags: { tenantId, module },
    });
  }

  return c.json(
    fail(ErrorCode.INTERNAL_ERROR, "Error interno del servidor", 500),
    500,
  );
}
