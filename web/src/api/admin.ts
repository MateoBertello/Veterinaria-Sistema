import { apiClient, apiClientList } from "./client.ts";
import type {
  ApiMeta,
  CrearTenantInput,
  EditarTenantInput,
  EstadoTenantFiltro,
  ModuloContratado,
  ModuloVendible,
  PlanTenant,
  Tenant,
} from "../types/index.ts";

/**
 * Consola Super Admin (`/api/v1/admin/*`). Todos los endpoints pasan por
 * `requireSuperAdmin` en el backend (claim de plataforma, NO permiso de tenant)
 * y NO por `requireModule`: la consola es plataforma, no un módulo vendible.
 */

export interface ListarTenantsParams {
  page?:   number;
  limit?:  number;
  /** Busca por nombre o CUIT/RUT (el backend lo sanitiza para el ILIKE). */
  q?:      string;
  plan?:   PlanTenant;
  estado?: EstadoTenantFiltro;
}

function buildQuery(params: ListarTenantsParams): string {
  const qs = new URLSearchParams();
  if (params.page)   qs.set("page", String(params.page));
  if (params.limit)  qs.set("limit", String(params.limit));
  if (params.q)      qs.set("q", params.q);
  if (params.plan)   qs.set("plan", params.plan);
  if (params.estado) qs.set("estado", params.estado);

  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** GET /admin/tenants — listado paginado con filtros (envelope con meta). */
export function listarTenants(
  params: ListarTenantsParams = {},
): Promise<{ items: Tenant[]; meta: ApiMeta }> {
  return apiClientList<Tenant>(`/admin/tenants${buildQuery(params)}`);
}

/** GET /admin/tenants/:id — metadatos comerciales del tenant (RN-SA4). */
export function obtenerTenant(id: string): Promise<Tenant> {
  return apiClient<Tenant>(`/admin/tenants/${id}`);
}

/**
 * POST /admin/tenants — alta de clínica (RN-SA1/SA2): el backend crea el tenant
 * y su aprovisionamiento (roles, configuración y módulos del plan) de forma
 * atómica, y luego invita al Admin por email — si la invitación falla, el tenant
 * queda creado con `adminInvitado=false` y se reintenta desde el detalle.
 */
export function crearTenant(input: CrearTenantInput): Promise<Tenant> {
  return apiClient<Tenant>("/admin/tenants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PUT /admin/tenants/:id — edición de datos comerciales (no cambia el estado). */
export function editarTenant(id: string, input: EditarTenantInput): Promise<Tenant> {
  return apiClient<Tenant>(`/admin/tenants/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * PATCH /admin/tenants/:id/estado — suspende/reactiva el tenant (RN-SA3, baja
 * lógica). Suspender bloquea los módulos de sus usuarios de inmediato; no borra
 * datos.
 */
export function cambiarEstadoTenant(id: string, activo: boolean): Promise<Tenant> {
  return apiClient<Tenant>(`/admin/tenants/${id}/estado`, {
    method: "PATCH",
    body: JSON.stringify({ activo }),
  });
}

/**
 * POST /admin/tenants/:id/invitar-admin — RN-SA2: reintento idempotente de la
 * invitación al Admin del tenant. Si ya fue invitado, el backend no reenvía nada
 * y devuelve el tenant tal cual.
 */
export function invitarAdminTenant(id: string): Promise<Tenant> {
  return apiClient<Tenant>(`/admin/tenants/${id}/invitar-admin`, { method: "POST" });
}

/** GET /admin/tenants/:id/modulos — estado de los módulos vendibles del tenant. */
export function listarModulosTenant(id: string): Promise<ModuloContratado[]> {
  return apiClient<ModuloContratado[]>(`/admin/tenants/${id}/modulos`);
}

/**
 * PUT /admin/tenants/:id/modulos/:modulo — habilita/deshabilita un módulo
 * vendible (RN-SM2/SM3): deshabilitar NO borra datos y el cambio es inmediato
 * (el backend invalida la caché de `requireModule`). Un módulo desconocido
 * responde 422 MODULE_UNKNOWN.
 */
export function setModuloTenant(
  id: string,
  modulo: ModuloVendible,
  habilitado: boolean,
): Promise<ModuloContratado> {
  return apiClient<ModuloContratado>(`/admin/tenants/${id}/modulos/${modulo}`, {
    method: "PUT",
    body: JSON.stringify({ habilitado }),
  });
}
