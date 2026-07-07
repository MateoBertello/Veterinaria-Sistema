import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  buildCors,
  securityHeaders,
} from "../../supabase/functions/api/src/middleware/security.ts";
import { errorHandler } from "../../supabase/functions/api/src/middleware/errorHandler.ts";
import { DomainError, ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const ALLOWED = "https://app.veterinaria.example";
const OTHER = "https://evil.example";

/**
 * App mínima que replica el orden de main.ts: CORS + securityHeaders globales antes de
 * los routers. Un router "protegido" lanza 401 en cualquier método que lo alcance, para
 * demostrar que el preflight OPTIONS NO lo alcanza (lo corta buildCors()).
 */
function buildApp() {
  const app = new Hono().basePath("/api/v1");
  app.onError(errorHandler);
  app.use("*", buildCors());
  app.use("*", securityHeaders);

  const protectedR = new Hono();
  protectedR.use("/*", () => {
    throw new DomainError(ErrorCode.UNAUTHORIZED, 401, "sin auth");
  });
  protectedR.get("/", (c) => c.json({ ok: true }));
  app.route("/clientes", protectedR);

  // Ruta abierta para inspeccionar headers en una respuesta 200.
  app.get("/ping", (c) => c.json({ ok: true }));
  // Ruta que devuelve un Response crudo (como los export CSV/XLSX).
  app.get("/export", () =>
    new Response("a,b,c", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="x.csv"',
      },
    }),
  );
  return app;
}

beforeEach(() => {
  process.env.CORS_ALLOWED_ORIGINS = ALLOWED;
});
afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

describe("CORS — allowlist explícita (Etapa 9 / S7)", () => {
  it("RN-SEC-CORS1: refleja el origin permitido y habilita credentials (nunca *)", async () => {
    const res = await buildApp().request("http://localhost/api/v1/ping", {
      headers: { Origin: ALLOWED },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("RN-SEC-CORS2: NO refleja un origin fuera de la allowlist", async () => {
    const res = await buildApp().request("http://localhost/api/v1/ping", {
      headers: { Origin: OTHER },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe(OTHER);
    expect(acao).not.toBe("*");
  });

  it("RN-SEC-CORS3: el preflight OPTIONS responde 2xx con headers CORS y SIN pasar por auth", async () => {
    const res = await buildApp().request("http://localhost/api/v1/clientes", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "POST",
      },
    });
    // buildCors() corta el preflight: no llega al middleware que lanza 401.
    expect(res.status).not.toBe(401);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  it("RN-SEC-CORS4: una request real a la ruta protegida SÍ exige auth (401)", async () => {
    const res = await buildApp().request("http://localhost/api/v1/clientes", {
      headers: { Origin: ALLOWED },
    });
    expect(res.status).toBe(401);
  });
});

describe("Security headers — en toda respuesta de la API", () => {
  it("RN-SEC-HDR1: setea nosniff, Referrer-Policy y Cache-Control no-store", async () => {
    const res = await buildApp().request("http://localhost/api/v1/ping");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("RN-SEC-HDR2: los headers aplican también a un Response crudo (export CSV/XLSX)", async () => {
    const res = await buildApp().request("http://localhost/api/v1/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toContain("text/csv");
  });
});
