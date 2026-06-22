import { z } from "zod";

// RN-MA8: el tamaño es ENUM PostgreSQL `tamano_mascota` con valores exactos.
export const TAMANO_VALUES = ["Pequeño", "Mediano", "Grande"] as const;
// Sexo: ENUM `sexo_mascota`.
export const SEXO_VALUES = ["Macho", "Hembra", "Desconocido"] as const;

export const CrearMascotaSchema = z.object({
  // RN-MA1: obligatorios → nombre, cliente, especie, sexo y tamaño.
  name:          z.string().min(1, "El nombre es requerido").max(120),
  clientId:      z.string().uuid("clientId debe ser un UUID válido"),
  especieId:     z.string().uuid("especieId debe ser un UUID válido"),
  // RN-MA2: la raza es opcional; su coherencia con la especie se valida en el Service.
  razaId:        z.string().uuid("razaId debe ser un UUID válido").nullish(),
  sex:           z.enum(SEXO_VALUES),
  // RN-MA8: tamaño tipado; cualquier otro valor → VALIDATION_ERROR.
  tamano:        z.enum(TAMANO_VALUES),
  // RN-MA9: alimento/dieta opcional, máx. 500 chars (fallback se aplica en el Service).
  alimentoDieta: z.string().max(500, "La dieta admite hasta 500 caracteres").nullish(),
  // RN-MA1: opcionales. RN-MA4: la fecha de nacimiento solo se acepta en creación.
  birthDate:     z.string().date("birthDate debe ser una fecha ISO (YYYY-MM-DD)").nullish(),
  color:         z.string().max(60).nullish(),
  observations:  z.string().max(1000).nullish(),
});

// RN-MA4: birthDate inmutable; cambio de dueño (clientId) es otro caso de uso → ambos se omiten.
export const EditarMascotaSchema = CrearMascotaSchema
  .omit({ birthDate: true, clientId: true })
  .partial();

export const EDAD_CAT_VALUES = ["cachorro", "adulto", "senior"] as const;

export const ListarMascotasQuerySchema = z.object({
  search:    z.string().trim().min(1).optional(),
  clientId:  z.string().uuid().optional(),
  especieId: z.string().uuid().optional(),
  estado:    z.enum(["Activa", "Fallecida"]).optional(),
  edadCat:   z.enum(EDAD_CAT_VALUES).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

// RN-CD1..CD5: Cambiar Dueño de Mascota. El dueño distinto (RN-CD1) se valida
// en la transacción (RPC); aquí sólo se exige un UUID y metadatos opcionales.
export const CambiarDuenoSchema = z.object({
  newClientId: z.string().uuid("newClientId debe ser un UUID válido"),
  reason:      z.string().max(500, "El motivo admite hasta 500 caracteres").nullish(),
  notes:       z.string().max(1000, "Las notas admiten hasta 1000 caracteres").nullish(),
});

// RN-MF1..MF5: Marcar Mascota como Fallecida (manual). El motivo es obligatorio
// (RN-MF1); la fecha por defecto es hoy (se resuelve en el Service).
export const MarcarFallecidaSchema = z.object({
  deceasedReason: z.string().trim().min(1, "El motivo del fallecimiento es requerido").max(500),
  deceasedDate:   z.string().date("deceasedDate debe ser una fecha ISO (YYYY-MM-DD)").nullish(),
  deceasedNotes:  z.string().max(1000, "Las notas admiten hasta 1000 caracteres").nullish(),
});

export type CrearMascotaDto        = z.infer<typeof CrearMascotaSchema>;
export type EditarMascotaDto       = z.infer<typeof EditarMascotaSchema>;
export type ListarMascotasQueryDto = z.infer<typeof ListarMascotasQuerySchema>;
export type CambiarDuenoDto        = z.infer<typeof CambiarDuenoSchema>;
export type MarcarFallecidaDto     = z.infer<typeof MarcarFallecidaSchema>;
