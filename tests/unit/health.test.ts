import { describe, it, expect } from "vitest";
import app from "../../supabase/functions/api/src/main.ts";

describe("Endpoint /health y sonda de latencia", () => {
  it("con sonda inactiva (defecto): /health responde ok sin filtrar métricas ni Server-Timing", async () => {
    const res = await app.request("http://localhost/api/v1/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ status: "ok" });
    expect(body.data.sonda).toBeUndefined();

    // No expone Server-Timing con detalles internos
    expect(res.headers.get("Server-Timing")).toBeNull();
  });

  it("con sonda inactiva (defecto): /health/jwt responde 404", async () => {
    const res = await app.request("http://localhost/api/v1/health/jwt");
    expect(res.status).toBe(404);
  });

  it("con sonda inactiva (defecto): /health/db responde 404", async () => {
    const res = await app.request("http://localhost/api/v1/health/db");
    expect(res.status).toBe(404);
  });
});
