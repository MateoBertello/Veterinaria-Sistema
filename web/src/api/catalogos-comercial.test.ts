import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

async function importCatalogosComercial() {
  vi.resetModules();
  return await import("./catalogos-comercial.ts");
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => [{ id: "test-id", nombre: "Item Test" }],
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-comercial-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("catalogos-comercial (PostgREST directo)", () => {
  it("las tres lecturas mandan Authorization: Bearer con el token del usuario", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const {
      listarUnidadesMedida,
      listarMediosPago,
      listarServiciosVendibles,
    } = await importCatalogosComercial();

    await listarUnidadesMedida();
    await listarMediosPago();
    await listarServiciosVendibles();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer jwt-comercial-token");
    }
  });

  it("ninguna lectura manda filtro de tenant (ni en URL ni en headers)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const {
      listarUnidadesMedida,
      listarMediosPago,
      listarServiciosVendibles,
    } = await importCatalogosComercial();

    await listarUnidadesMedida();
    await listarMediosPago();
    await listarServiciosVendibles();

    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url.toLowerCase()).not.toContain("tenant_id");
      expect(url.toLowerCase()).not.toContain("tenantid");
      const headersStr = JSON.stringify(init.headers ?? {}).toLowerCase();
      expect(headersStr).not.toContain("tenant_id");
      expect(headersStr).not.toContain("tenantid");
    }
  });

  it("el cache sirve la segunda llamada idéntica sin volver a hacer fetch", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { listarUnidadesMedida } = await importCatalogosComercial();

    const p1 = await listarUnidadesMedida();
    const p2 = await listarUnidadesMedida();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(p1).toEqual(p2);
  });

  it("un fallo NO se cachea y permite reintentar en el próximo llamado", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    fetchMock.mockRejectedValueOnce(new Error("Fallo de red"));

    const { listarMediosPago } = await importCatalogosComercial();

    await expect(listarMediosPago()).rejects.toThrow("No se pudo conectar con el servidor");

    // Segundo llamado con mock exitoso
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "mp-1", nombre: "Efectivo" }],
    });

    const res = await listarMediosPago();
    expect(res).toEqual([{ id: "mp-1", nombre: "Efectivo" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidarCacheCatalogosComercial() limpia el cache y fuerza nuevo fetch", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { listarServiciosVendibles, invalidarCacheCatalogosComercial } =
      await importCatalogosComercial();

    await listarServiciosVendibles();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidarCacheCatalogosComercial();

    await listarServiciosVendibles();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("en modo directo usa la URL absoluta y envía apikey", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://directo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-123");
    const { listarUnidadesMedida } = await importCatalogosComercial();

    await listarUnidadesMedida();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://directo.supabase.co/rest/v1/unidades_medida")).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers["apikey"]).toBe("anon-key-123");
    expect(headers["Authorization"]).toBe("Bearer jwt-comercial-token");
  });
});
