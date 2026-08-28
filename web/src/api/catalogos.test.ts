/**
 * catalogos.ts — modos de acceso a PostgREST según hosting (pre-deploy).
 *
 * El módulo lee VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY al importarse, por
 * eso cada caso stubea el env y re-importa con vi.resetModules().
 *
 *  • Modo proxy (default, dev / nginx): path RELATIVO y SIN apikey en el
 *    request (la inyecta el proxy server-side; no debe viajar desde el front).
 *  • Modo directo (hosting estático, Vercel/Netlify): URL absoluta a Supabase
 *    y apikey en el header, siempre junto al Bearer del usuario (el rol
 *    efectivo en PostgREST sigue siendo `authenticated`; `anon` no tiene
 *    SELECT sobre los catálogos desde DT-5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

async function importCatalogos() {
  vi.resetModules();
  return await import("./catalogos.ts");
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => [{ id: "e1", name: "Perro" }],
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("catalogos — modo proxy (default, sin VITE_SUPABASE_*)", () => {
  it("fetchea /rest/v1 relativo, con Bearer y SIN apikey (la inyecta el proxy)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/rest/v1/especies?select=id,name&active=eq.true&order=name");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt-de-prueba");
    expect(headers["apikey"]).toBeUndefined();
  });
});

describe("catalogos — modo directo (hosting estático con VITE_SUPABASE_*)", () => {
  it("fetchea la URL absoluta de Supabase con apikey + Bearer", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://miref.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key-publica");
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://miref.supabase.co/rest/v1/especies?select=id,name&active=eq.true&order=name");
    const headers = init.headers as Record<string, string>;
    expect(headers["apikey"]).toBe("anon-key-publica");
    expect(headers["Authorization"]).toBe("Bearer jwt-de-prueba");
  });

  it("con una sola de las dos variables NO activa el modo directo (config a medias)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://miref.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/rest/v1/especies?select=id,name&active=eq.true&order=name");
    expect((init.headers as Record<string, string>)["apikey"]).toBeUndefined();
  });
});

// ─── Cache de lectura e invalidación ──────────────────────────────────────────
//
// El CRUD de catálogos (etapa "Gestión de catálogos por clínica") introdujo un
// cache de lectura. La razón de que exista es también su mayor riesgo: si una
// escritura no lo invalidara, alguien crearía una raza y no la vería en el combo
// de mascotas hasta recargar la página — el CRUD se sentiría roto sin estarlo.
// Estos casos fijan exactamente ese contrato.

describe("catalogos — cache de lectura", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  });

  it("dos lecturas iguales seguidas hacen UN solo fetch", async () => {
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();
    await listarEspecies();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pide las especies ACTIVAS: una dada de baja no se ofrece en un alta nueva (RN-CAT9)", async () => {
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();

    expect(String(fetchMock.mock.calls[0][0])).toContain("active=eq.true");
  });

  it("no deja que el navegador sirva su propia copia (cache: no-store)", async () => {
    const { listarEspecies } = await importCatalogos();

    await listarEspecies();

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("invalidarCacheCatalogos() fuerza a releer", async () => {
    const { listarEspecies, invalidarCacheCatalogos } = await importCatalogos();

    await listarEspecies();
    invalidarCacheCatalogos();
    await listarEspecies();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un fallo NO se cachea: la lectura siguiente reintenta", async () => {
    const { listarEspecies } = await importCatalogos();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(listarEspecies()).rejects.toThrow();

    await listarEspecies();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("crear una raza invalida el catálogo cacheado: el combo la ve sin recargar la página", async () => {
    const { listarEspecies, listarRazas, crearRaza } = await importCatalogos();

    // El combo de mascotas ya cargó especies y razas: quedan cacheadas.
    await listarEspecies();
    await listarRazas("especie-1");
    const lecturasPrevias = fetchMock.mock.calls.length;

    // Alguien da de alta una raza desde la pantalla de catálogos.
    fetchMock.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ success: true, data: { id: "r9", name: "Border Collie" } }),
    });
    await crearRaza({ especieId: "especie-1", name: "Border Collie" });

    // La siguiente lectura NO puede venir del cache.
    await listarRazas("especie-1");

    // +1 por la escritura y +1 por la relectura.
    expect(fetchMock.mock.calls.length).toBe(lecturasPrevias + 2);
  });

  it("una escritura que falla igual invalida: puede haber llegado al servidor", async () => {
    const { listarEspecies, crearEspecie } = await importCatalogos();

    await listarEspecies();
    const lecturasPrevias = fetchMock.mock.calls.length;

    fetchMock.mockRejectedValueOnce(new Error("red caída"));
    await expect(crearEspecie({ name: "Hurón" })).rejects.toThrow();

    await listarEspecies();
    expect(fetchMock.mock.calls.length).toBe(lecturasPrevias + 2);
  });
});
