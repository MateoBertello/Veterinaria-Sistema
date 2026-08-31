import { apiClient, apiClientList } from "./client.ts";
import { ApiError } from "../types/index.ts";
import type {
  ApiMeta,
  Especie,
  EspecieCatalogo,
  EspecieInput,
  Raza,
  RazaCatalogo,
  RazaInput,
  TipoVacunaCatalogo,
  TipoVacunaInput,
} from "../types/index.ts";

// Los catálogos clínicos (especies, razas, tipos de vacuna) se leen por PostgREST
// directo — sin pasar por Controller/Service de Hono. Son POR TENANT desde
// 20260827000001_catalogos_por_tenant.sql: ninguna de estas funciones manda un
// tenant, y no debe hacerlo. El filtro lo aplica RLS a partir del Bearer del
// usuario, que es el único camino donde el aislamiento lo impone la base.
//
// Dos modos según el hosting:
//
//  • DEV / hosting con reverse proxy: fetch relativo a /rest/v1/*; la apikey la
//    inyecta el proxy server-side (vite.config.ts en dev, nginx en prod) y nunca
//    entra al bundle. Es el modo por defecto (sin VITE_SUPABASE_*).
//  • Hosting estático sin proxy (Vercel/Netlify): se setean VITE_SUPABASE_URL y
//    VITE_SUPABASE_ANON_KEY en el build y el fetch va directo a Supabase con la
//    anon key en el bundle. La anon key es pública por diseño (solo identifica
//    el proyecto); la barrera real son RLS y el Bearer del usuario, igual que en
//    el modo proxy.
//
// En ambos modos el front envía el Bearer del usuario igual que con apiClient.
const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
const MODO_DIRECTO = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Cache de LECTURA del catálogo, por path de consulta.
 *
 * Por qué existe: el catálogo cambia rarísimo y se lee en todos lados (el combo
 * de especies se pedía de nuevo en CADA apertura del formulario de mascota).
 * Pero el motivo real es el otro: con el CRUD de catálogos, alguien puede crear
 * una raza y pasar acto seguido a cargar una mascota. Si esa lectura quedara
 * servida por una copia vieja —la del cache, o la del propio navegador— la raza
 * recién creada no aparecería en el combo hasta recargar la página, y el CRUD se
 * sentiría roto. Tener UN solo lugar donde se guarda es lo que permite tener UN
 * solo lugar donde se invalida: `invalidarCacheCatalogos()`, que llaman todas
 * las escrituras de este archivo.
 *
 * Se cachea la promesa, no el resultado: dos componentes que montan a la vez
 * comparten un único request en vuelo en lugar de disparar dos.
 *
 * OJO — el cache es por identidad: guarda el catálogo DEL TENANT del token
 * vigente. `AuthContext` lo limpia al pasar a anónimo (logout y 401), porque si
 * sobreviviera al cambio de sesión la clínica entrante vería el catálogo de la
 * saliente. Es memoria del proceso, no `localStorage`: no cruza pestañas ni
 * sobrevive a un reload.
 */
const cacheLectura = new Map<string, Promise<unknown[]>>();

/** Descarta el catálogo cacheado. La llama toda escritura, y el logout. */
export function invalidarCacheCatalogos(): void {
  cacheLectura.clear();
}

function postgrestCacheado<T>(path: string): Promise<T[]> {
  const enCache = cacheLectura.get(path);
  if (enCache) return enCache as Promise<T[]>;

  const pedido = postgrest<T>(path).catch((err) => {
    // Un fallo no se cachea: la próxima lectura tiene que poder reintentar.
    cacheLectura.delete(path);
    throw err;
  });

  cacheLectura.set(path, pedido as Promise<unknown[]>);
  return pedido;
}

async function postgrest<T>(path: string): Promise<T[]> {
  const token = localStorage.getItem("sb-token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (MODO_DIRECTO) {
    headers["apikey"] = SUPABASE_ANON_KEY as string;
  }
  const base = MODO_DIRECTO ? `${SUPABASE_URL}/rest/v1/` : "/rest/v1/";

  let res: Response;
  try {
    // `no-store`: la frescura la gobierna `cacheLectura`, que sabe cuándo
    // invalidar. Si además el navegador guardara su propia copia, una raza
    // recién creada podría no aparecer aunque el cache de acá ya se haya
    // limpiado — y desde afuera se vería como un CRUD que no guarda.
    res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
  } catch (err) {
    throw new ApiError("NETWORK_ERROR", 0, "No se pudo conectar con el servidor", [err]);
  }

  if (!res.ok) {
    throw new ApiError("INTERNAL_ERROR", res.status, `Error al cargar catálogo (${res.status})`);
  }

  return res.json() as Promise<T[]>;
}

/**
 * Especies SELECCIONABLES de la clínica (PostgREST directo; RLS filtra por tenant).
 *
 * `active=eq.true` es RN-CAT9: una especie dada de baja sigue mostrándose en las
 * fichas que ya la usan, pero no se ofrece en altas nuevas. Sin este filtro la
 * baja lógica no se notaría en el único lugar donde tiene que notarse.
 */
export function listarEspecies(): Promise<Especie[]> {
  return postgrestCacheado<Especie>("especies?select=id,name&active=eq.true&order=name");
}

/** Razas seleccionables de una especie (activas — RN-CAT9). */
export function listarRazas(especieId: string): Promise<Raza[]> {
  return postgrestCacheado<Raza>(
    `razas?especie_id=eq.${especieId}&select=id,name,especie_id&active=eq.true&order=name`,
  );
}

// Acá vivía `listarTiposVacuna()`, que leía `tipos_vacuna` entero por PostgREST.
// Se fue con `especie_aplicable`: qué vacuna le corresponde a una mascota es una
// regla de negocio (sale de la relación especie↔vacuna, RN-PV11), no una lectura
// de catálogo que el frontend pueda filtrar por su cuenta. Lo reemplaza
// `listarTiposVacunaAplicables(petId)` en `api/vacunacion.ts`, que le pregunta al
// backend por UNA mascota concreta. Las especies y razas siguen leyéndose acá
// porque siguen siendo catálogo puro: no dependen de con qué se las combine.

// ══════════════════════════════════════════════════════════════════════════════
// GESTIÓN DEL CATÁLOGO — /api/v1 (Controller → Service, con Zod y auditoría)
// ══════════════════════════════════════════════════════════════════════════════
//
// Las lecturas de arriba van por PostgREST directo (excepción documentada en el
// CLAUDE.md). Todo lo de acá abajo ESCRIBE, y por lo tanto es auditable: pasa
// por la API, con permiso `manage_catalogs`.
//
// Cada escritura invalida el cache de lectura. Es la razón por la que las dos
// mitades viven en el MISMO archivo: si las escrituras estuvieran en otro
// módulo, invalidar sería un paso que alguien puede olvidar.

export interface ListarCatalogoParams {
  search?: string;
  active?: boolean;
  page?:   number;
  limit?:  number;
}

function query(params: ListarCatalogoParams & { especieId?: string }): string {
  const qs = new URLSearchParams();
  if (params.search)             qs.set("search", params.search);
  if (params.active !== undefined) qs.set("active", String(params.active));
  if (params.especieId)          qs.set("especieId", params.especieId);
  if (params.page)               qs.set("page", String(params.page));
  if (params.limit)              qs.set("limit", String(params.limit));
  return qs.toString() ? `?${qs.toString()}` : "";
}

/** Ejecuta una escritura y descarta el catálogo cacheado, pase lo que pase. */
async function escribir<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } finally {
    // En `finally` a propósito: un 409 CATALOG_IN_USE no cambia nada, pero un
    // fallo de red puede haber llegado igual al servidor. Ante la duda, releer.
    invalidarCacheCatalogos();
  }
}

// ─── Especies ─────────────────────────────────────────────────────────────────

export function listarEspeciesCatalogo(
  params: ListarCatalogoParams = {},
): Promise<{ items: EspecieCatalogo[]; meta: ApiMeta }> {
  return apiClientList<EspecieCatalogo>(`/especies${query(params)}`);
}

export function crearEspecie(input: EspecieInput): Promise<EspecieCatalogo> {
  return escribir(() =>
    apiClient<EspecieCatalogo>("/especies", { method: "POST", body: JSON.stringify(input) }),
  );
}

export function editarEspecie(id: string, input: EspecieInput): Promise<EspecieCatalogo> {
  return escribir(() =>
    apiClient<EspecieCatalogo>(`/especies/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  );
}

export function cambiarEstadoEspecie(id: string, active: boolean): Promise<EspecieCatalogo> {
  return escribir(() =>
    apiClient<EspecieCatalogo>(`/especies/${id}/estado`, {
      method: "PATCH",
      body:   JSON.stringify({ active }),
    }),
  );
}

// ─── Razas ────────────────────────────────────────────────────────────────────

export function listarRazasCatalogo(
  params: ListarCatalogoParams & { especieId?: string } = {},
): Promise<{ items: RazaCatalogo[]; meta: ApiMeta }> {
  return apiClientList<RazaCatalogo>(`/razas${query(params)}`);
}

export function crearRaza(input: RazaInput): Promise<RazaCatalogo> {
  return escribir(() =>
    apiClient<RazaCatalogo>("/razas", { method: "POST", body: JSON.stringify(input) }),
  );
}

export function editarRaza(id: string, input: RazaInput): Promise<RazaCatalogo> {
  return escribir(() =>
    apiClient<RazaCatalogo>(`/razas/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  );
}

export function cambiarEstadoRaza(id: string, active: boolean): Promise<RazaCatalogo> {
  return escribir(() =>
    apiClient<RazaCatalogo>(`/razas/${id}/estado`, {
      method: "PATCH",
      body:   JSON.stringify({ active }),
    }),
  );
}

// ─── Tipos de vacuna ──────────────────────────────────────────────────────────

export function listarTiposVacunaCatalogo(
  params: ListarCatalogoParams = {},
): Promise<{ items: TipoVacunaCatalogo[]; meta: ApiMeta }> {
  return apiClientList<TipoVacunaCatalogo>(`/tipos-vacuna${query(params)}`);
}

export function crearTipoVacuna(input: TipoVacunaInput): Promise<TipoVacunaCatalogo> {
  return escribir(() =>
    apiClient<TipoVacunaCatalogo>("/tipos-vacuna", { method: "POST", body: JSON.stringify(input) }),
  );
}

export function editarTipoVacuna(id: string, input: TipoVacunaInput): Promise<TipoVacunaCatalogo> {
  return escribir(() =>
    apiClient<TipoVacunaCatalogo>(`/tipos-vacuna/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  );
}

/**
 * PUT /tipos-vacuna/{id}/especies — reemplaza las especies a las que aplica
 * (RN-CAT10). El conjunto va COMPLETO: lo que no está deja de estar asociado.
 */
export function asociarEspeciesTipoVacuna(
  id: string,
  especieIds: string[],
): Promise<TipoVacunaCatalogo> {
  return escribir(() =>
    apiClient<TipoVacunaCatalogo>(`/tipos-vacuna/${id}/especies`, {
      method: "PUT",
      body:   JSON.stringify({ especieIds }),
    }),
  );
}

export function cambiarEstadoTipoVacuna(id: string, active: boolean): Promise<TipoVacunaCatalogo> {
  return escribir(() =>
    apiClient<TipoVacunaCatalogo>(`/tipos-vacuna/${id}/estado`, {
      method: "PATCH",
      body:   JSON.stringify({ active }),
    }),
  );
}
