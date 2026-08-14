import { z } from "zod";

// ─── Exportar Historial (RN-EX1..EX5) ───────────────────────────────────────
export const ExportHistorialQuerySchema = z.object({
  format: z.enum(["pdf", "xlsx"]).default("pdf"),
});

export type ExportHistorialQuery = z.infer<typeof ExportHistorialQuerySchema>;

export const ListarHistorialQuerySchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListarHistorialQuery = z.infer<typeof ListarHistorialQuerySchema>;

// ─── Registrar Evento Clínico (RN-EC1, RN-EC6) ──────────────────────────────────
// Etapa 5 sin eutanasia: `Eutanasia` se excluye del enum aceptado (→ VALIDATION_ERROR);
// se reincorpora con su RPC transaccional y `euthanasiaConfirmed` en la próxima sesión.
// `proximaDosis` (plan_vacunacion) se difiere a Etapa 8.
export const CrearEventoClinicoSchema = z.object({
  date:              z.string().date(),
  eventType:         z.enum([
    "Consulta", "Vacunación", "Cirugía", "Análisis", "Radiografía",
    "Ecografía", "Desparasitación", "Control", "Emergencia",
    "Internación", "Otro",
  ]),
  professionalId:    z.string().uuid(),
  description:       z.string().min(1).max(2000),
  weightKg:          z.number().min(0).max(200).optional(),   // RN-EC6
  temperatureC:      z.number().min(30).max(45).optional(),   // RN-EC6
  diagnosis:         z.string().max(2000).optional(),
  treatment:         z.string().max(2000).optional(),
  medication:        z.string().max(2000).optional(),
  notes:             z.string().max(2000).optional(),
  sendEmailToClient: z.boolean().default(false),
});

export type CrearEventoClinicoDto = z.infer<typeof CrearEventoClinicoSchema>;

// ─── Registrar Eutanasia (RN-EC10, RN-EC11) ─────────────────────────────────────
// Ruta dedicada (POST /mascotas/:petId/eutanasia), separada del Registrar Evento
// genérico: la única operación irreversible (CLAUDE.md regla 8) no se dispara por
// la ruta común. eventType es implícito ('Eutanasia'), por eso no está en el schema.
// `euthanasiaConfirmed` queda OPCIONAL aquí a propósito: la confirmación (RN-EC10)
// la valida el Service para devolver EUTHANASIA_CONFIRMATION_REQUIRED y no un
// VALIDATION_ERROR genérico. La UI igualmente envía euthanasiaConfirmed:true.
export const RegistrarEutanasiaSchema = z.object({
  date:               z.string().date(),
  professionalId:     z.string().uuid(),
  description:        z.string().min(1).max(2000),
  weightKg:           z.number().min(0).max(200).optional(),   // RN-EC6
  temperatureC:       z.number().min(30).max(45).optional(),   // RN-EC6
  diagnosis:          z.string().max(2000).optional(),
  notes:              z.string().max(2000).optional(),
  euthanasiaConfirmed: z.boolean().optional(),                 // RN-EC10 (lo exige el Service)
});

export type RegistrarEutanasiaDto = z.infer<typeof RegistrarEutanasiaSchema>;
