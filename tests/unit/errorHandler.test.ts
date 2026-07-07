import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import {
  errorHandler,
  __setSentryClient,
  __resetSentry,
} from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import {
  DomainError,
  ErrorCode,
} from "../../supabase/functions/api/src/shared/errors.ts";

const TENANT_ID = "tenant-abc";

function buildApp(captureException: (err: unknown, opts?: unknown) => string) {
  __setSentryClient({ captureException });

  const app = new Hono().basePath("/api/v1");
  app.onError(errorHandler);

  // Setea tenantId en contexto como lo haría tenantContext antes de fallar.
  app.use("*", async (c, next) => {
    c.set("tenantId", TENANT_ID);
    await next();
  });

  // 5xx no controlado
  app.get("/turnos/boom", () => {
    throw new Error("fallo inesperado con dato sensible: Juan Pérez DNI 123");
  });
  // DomainError 4xx
  app.get("/turnos/dominio", () => {
    throw new DomainError(ErrorCode.TURNO_NOT_FOUND, 404, "no existe");
  });

  return app;
}

beforeEach(() => {
  __resetSentry();
});

describe("errorHandler — integración Sentry (Regla 7)", () => {
  it("RN-G: un 5xx responde INTERNAL_ERROR genérico sin filtrar el mensaje real", async () => {
    const app = buildApp(vi.fn(() => "evt-id"));
    const res = await app.request("http://localhost/api/v1/turnos/boom");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Error interno del servidor");
    // No se filtra el mensaje original (que contenía PII)
    expect(JSON.stringify(body)).not.toContain("DNI 123");
  });

  it("Regla 7: un 5xx NO filtra el stack trace (ni ruta de archivo) en body ni headers", async () => {
    const app = buildApp(vi.fn(() => "evt-id"));
    // Error con stack real: contiene rutas de archivo del proyecto.
    app.get("/turnos/stack", () => {
      const err = new Error("boom con secreto");
      err.stack =
        "Error: boom con secreto\n    at /home/mateo/Veterinaria-Sistema/supabase/functions/api/src/secreto.ts:42:7";
      throw err;
    });
    const res = await app.request("http://localhost/api/v1/turnos/stack");

    expect(res.status).toBe(500);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("secreto.ts");
    expect(serialized).not.toContain("boom con secreto");
    // Tampoco debe viajar el stack por headers.
    let headerBlob = "";
    res.headers.forEach((v, k) => (headerBlob += `${k}:${v};`));
    expect(headerBlob).not.toContain("secreto.ts");
  });

  it("Regla 7: un 5xx reporta a Sentry con tags module y tenantId", async () => {
    const capture = vi.fn(() => "evt-id");
    const app = buildApp(capture);
    await app.request("http://localhost/api/v1/turnos/boom");

    expect(capture).toHaveBeenCalledTimes(1);
    const [err, opts] = capture.mock.calls[0] as [unknown, { tags: Record<string, string> }];
    expect(err).toBeInstanceOf(Error);
    expect(opts.tags.module).toBe("turnos");
    expect(opts.tags.tenantId).toBe(TENANT_ID);
  });

  it("Regla 7: un DomainError (4xx) NO se reporta a Sentry", async () => {
    const capture = vi.fn(() => "evt-id");
    const app = buildApp(capture);
    const res = await app.request("http://localhost/api/v1/turnos/dominio");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("TURNO_NOT_FOUND");
    expect(capture).not.toHaveBeenCalled();
  });

  it("module = 'unknown' cuando el path no encaja con /api/v1/<modulo>", async () => {
    const capture = vi.fn(() => "evt-id");
    __setSentryClient({ captureException: capture });
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/raro", () => {
      throw new Error("boom");
    });
    await app.request("http://localhost/raro");

    const [, opts] = capture.mock.calls[0] as [unknown, { tags: Record<string, string> }];
    expect(opts.tags.module).toBe("unknown");
    expect(opts.tags.tenantId).toBe("unknown");
  });
});
