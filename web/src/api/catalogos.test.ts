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
    expect(url).toBe("/rest/v1/especies?select=id,name&order=name");
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
    expect(url).toBe("https://miref.supabase.co/rest/v1/especies?select=id,name&order=name");
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
    expect(url).toBe("/rest/v1/especies?select=id,name&order=name");
    expect((init.headers as Record<string, string>)["apikey"]).toBeUndefined();
  });
});
