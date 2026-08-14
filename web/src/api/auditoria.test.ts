/**
 * auditoria.ts — cliente API contra el envelope estándar (mock de fetch) y
 * contra la respuesta binaria del export (blob + headers de truncado).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listarAuditoria, exportarAuditoriaCsv } from "./auditoria.ts";

const fetchMock = vi.fn();

function envelope(data: unknown, meta?: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => (meta ? { success: true, data, meta } : { success: true, data }),
  };
}

function blobResponse(headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["id,timestamp\n"], { type: "text/csv" }),
    headers: new Headers(headers),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-de-prueba");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("listarAuditoria", () => {
  it("sin filtros pide /auditoria sin query string", async () => {
    fetchMock.mockResolvedValue(envelope([], { page: 1, limit: 20, total: 0 }));

    await listarAuditoria();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/auditoria");
  });

  it("arma el query string con todos los filtros y desempaqueta items + meta", async () => {
    fetchMock.mockResolvedValue(
      envelope(
        [{
          id: "a1", timestamp: "2026-07-20T10:00:00Z", module: "clients", action: "CREATE",
          userId: "u1", userName: "Ana", userRole: "admin", entityId: "c1",
          oldValues: null, newValues: { fullName: "Ana" }, details: null, ipAddress: "127.0.0.1",
        }],
        { page: 2, limit: 20, total: 5 },
      ),
    );

    const { items, meta } = await listarAuditoria({
      search: "ana", module: "clients", action: "CREATE", userId: "u1",
      dateFrom: "2026-07-01T00:00:00Z", dateTo: "2026-07-20T23:59:59Z",
      page: 2, limit: 20,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/v1/auditoria?search=ana&module=clients&action=CREATE&userId=u1" +
      "&dateFrom=2026-07-01T00%3A00%3A00Z&dateTo=2026-07-20T23%3A59%3A59Z&page=2&limit=20",
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer jwt-de-prueba");
    expect(items).toHaveLength(1);
    expect(items[0]?.userName).toBe("Ana");
    expect(meta).toEqual({ page: 2, limit: 20, total: 5 });
  });
});

describe("exportarAuditoriaCsv", () => {
  it("pide /auditoria/export con los filtros (sin page/limit) y devuelve el blob sin truncar", async () => {
    fetchMock.mockResolvedValue(blobResponse({
      "Content-Disposition": 'attachment; filename="auditoria_2026-07-24.csv"',
    }));

    const resultado = await exportarAuditoriaCsv({ module: "clients" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/auditoria/export?module=clients");
    expect(resultado.truncated).toBe(false);
    expect(resultado.totalMatching).toBeNull();
    expect(resultado.rowsExported).toBeNull();
    expect(resultado.filename).toBe("auditoria_2026-07-24.csv");
    expect(resultado.blob).toBeInstanceOf(Blob);
  });

  it("detecta el export truncado por los headers X-Export-* y expone los conteos", async () => {
    fetchMock.mockResolvedValue(blobResponse({
      "X-Export-Truncated":      "true",
      "X-Export-Total-Matching": "15000",
      "X-Export-Rows":           "10000",
    }));

    const resultado = await exportarAuditoriaCsv();

    expect(resultado.truncated).toBe(true);
    expect(resultado.totalMatching).toBe(15000);
    expect(resultado.rowsExported).toBe(10000);
  });
});
