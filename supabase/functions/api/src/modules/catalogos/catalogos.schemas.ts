import { z } from "zod";

/**
 * Schemas del módulo Catálogos clínicos (especies, razas, tipos de vacuna).
 *
 * Los tres son catálogos POR TENANT desde
 * `20260827000001_catalogos_por_tenant.sql`. El `tenant_id` NUNCA viaja en el
 * request (RN-CAT1): sale del JWT vía `tenantContext`, así que no aparece en
 * ningún schema de este archivo. Que no esté es la regla, no un olvido.
 */

// ─── Especies ─────────────────────────────────────────────────────────────────

export const CrearEspecieSchema = z.object({
  name:        z.string().trim().min(2, "El nombre requiere al menos 2 caracteres").max(60),
  description: z.string().trim().max(200).nullish(),
});

export const ActualizarEspecieSchema = CrearEspecieSchema.partial();

// ─── Razas ────────────────────────────────────────────────────────────────────

export const CrearRazaSchema = z.object({
  // La especie tiene que ser del MISMO tenant (RN-CAT3); eso lo resuelve el
  // Service contra la base, no Zod, que solo puede exigir la forma.
  especieId:   z.string().uuid("especieId debe ser un UUID"),
  name:        z.string().trim().min(2, "El nombre requiere al menos 2 caracteres").max(60),
  description: z.string().trim().max(200).nullish(),
});

// `especieId` también es editable: una raza mal clasificada se corrige sin
// borrarla (RN-CAT4 no expone DELETE, así que este es el único camino).
export const ActualizarRazaSchema = CrearRazaSchema.partial();

// ─── Tipos de vacuna ──────────────────────────────────────────────────────────

/**
 * A qué especies aplica un tipo de vacuna (RN-CAT10).
 *
 * Reemplaza al `especieAplicable` de texto libre, que ya no existe: la relación
 * es N:M contra el catálogo de especies (`especie_tipo_vacuna`). Zod sólo puede
 * exigir la forma —UUIDs, sin repetidos, al menos uno—; que cada id sea una
 * especie DE ESTA CLÍNICA lo resuelve el Service contra la base.
 *
 * `min(1)` es la regla, no una comodidad de formulario: un tipo de vacuna sin
 * especies no aplica a ninguna mascota, así que crearlo así sería crear algo
 * inutilizable sin decirlo.
 */
const EspecieIds = z
  .array(z.string().uuid("Cada especie debe ser un UUID"))
  .min(1, "Elegí al menos una especie a la que aplique la vacuna")
  .max(50, "Demasiadas especies")
  .refine((ids) => new Set(ids).size === ids.length, "Hay especies repetidas");

export const CrearTipoVacunaSchema = z.object({
  nombre:                z.string().trim().min(2, "El nombre requiere al menos 2 caracteres").max(80),
  especieIds:            EspecieIds,
  mesesRefuerzoSugerido: z
    .number()
    .int("mesesRefuerzoSugerido debe ser un entero")
    .min(1,   "El refuerzo mínimo es 1 mes")
    .max(120, "El refuerzo máximo es 120 meses")
    .nullish(),
});

// En la edición `especieIds` es opcional (se puede corregir el nombre sin tocar
// las especies), pero si viene, viene completo: reemplaza el conjunto entero.
export const ActualizarTipoVacunaSchema = CrearTipoVacunaSchema.partial();

/** Body de `PUT /tipos-vacuna/:id/especies` — reemplaza el conjunto (RN-CAT10). */
export const AsociarEspeciesSchema = z.object({
  especieIds: EspecieIds,
});

// ─── Comunes ──────────────────────────────────────────────────────────────────

/** Baja/alta lógica: el único camino para sacar de circulación (RN-CAT4). */
export const CambiarEstadoSchema = z.object({
  active: z.boolean(),
});

/**
 * Query de los listados de administración.
 *
 * `active` llega como string por querystring; `undefined` significa "sin
 * filtrar" (trae activos e inactivos), que es lo que la pantalla de gestión
 * necesita para poder reactivar algo dado de baja.
 */
const ActiveQuery = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v === "true"));

export const ListarCatalogoQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  active: ActiveQuery,
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

/** El listado de razas suma el filtro por especie. */
export const ListarRazasQuerySchema = ListarCatalogoQuerySchema.extend({
  especieId: z.string().uuid().optional(),
});

export type CrearEspecieDto        = z.infer<typeof CrearEspecieSchema>;
export type ActualizarEspecieDto   = z.infer<typeof ActualizarEspecieSchema>;
export type CrearRazaDto           = z.infer<typeof CrearRazaSchema>;
export type ActualizarRazaDto      = z.infer<typeof ActualizarRazaSchema>;
export type CrearTipoVacunaDto     = z.infer<typeof CrearTipoVacunaSchema>;
export type ActualizarTipoVacunaDto = z.infer<typeof ActualizarTipoVacunaSchema>;
export type AsociarEspeciesDto     = z.infer<typeof AsociarEspeciesSchema>;
export type ListarCatalogoOpts     = z.infer<typeof ListarCatalogoQuerySchema>;
export type ListarRazasOpts        = z.infer<typeof ListarRazasQuerySchema>;
