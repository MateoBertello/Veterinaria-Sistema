/**
 * Catálogos comerciales de lectura directa por PostgREST.
 *
 * POR QUÉ ESTAS TRES LECTURAS NO VAN POR LA API:
 * 1. `unidades_medida` y `medios_pago` son catálogos GLOBALES de solo lectura
 *    (sin tenant_id). Su RLS es `auth.uid() IS NOT NULL`. No tienen endpoints
 *    en Hono ni los necesitan: se consultan directamente vía PostgREST con el Bearer
 *    del usuario autenticado, tal como los permisos de la plataforma.
 * 2. `servicios` es un catálogo por tenant protegido por RLS (`tenant_id = current_tenant_id()`).
 *    Su consulta para alimentar el mostrador es de solo lectura.
 * 3. Esta es la excepción documentada en CLAUDE.md / GUIA_ESTILO.md: catálogos
 *    transversales de lectura rápida. Cualquier ESCRITURA (p. ej. alta o edición
 *    de servicios) sigue pasando estrictamente por la API auditable (/api/v1/servicios).
 *
 * NINGUNA DE ESTAS FUNCIONES MANDA tenant_id EN QUERY, PARAMS NI HEADERS.
 */

import { ApiError } from "../types/index.ts";
import type { MedioPago, ServicioVendible, UnidadMedida } from "../types/index.ts";

const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
const MODO_DIRECTO = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const cacheLectura = new Map<string, Promise<unknown[]>>();

/** Descarta las promesas cacheadas para forzar recarga. */
export function invalidarCacheCatalogosComercial(): void {
  cacheLectura.clear();
}

function postgrestCacheado<T>(path: string): Promise<T[]> {
  const enCache = cacheLectura.get(path);
  if (enCache) return enCache as Promise<T[]>;

  const pedido = postgrest<T>(path).catch((err) => {
    // Un fallo no se cachea: la próxima lectura tiene que poder reintentar
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
    res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
  } catch (err) {
    throw new ApiError("NETWORK_ERROR", 0, "No se pudo conectar con el servidor", [err]);
  }

  if (!res.ok) {
    throw new ApiError("INTERNAL_ERROR", res.status, `Error al cargar catálogo (${res.status})`);
  }

  return res.json() as Promise<T[]>;
}

export function listarUnidadesMedida(): Promise<UnidadMedida[]> {
  return postgrestCacheado<UnidadMedida>(
    "unidades_medida?select=id,codigo,nombre,abreviatura,admite_decimales,escala_decimal&activo=eq.true&order=nombre",
  );
}

export function listarMediosPago(): Promise<MedioPago[]> {
  return postgrestCacheado<MedioPago>(
    "medios_pago?select=id,codigo,nombre,afecta_arqueo,requiere_referencia&activo=eq.true&order=nombre",
  );
}

export function listarServiciosVendibles(): Promise<ServicioVendible[]> {
  return postgrestCacheado<ServicioVendible>(
    "servicios?select=id,nombre,precio,alicuota_iva,tipo&activo=eq.true&order=nombre",
  );
}
