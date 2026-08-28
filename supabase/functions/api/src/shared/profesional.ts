import { DomainError, ErrorCode } from "./errors.ts";
import { getServiceDb } from "./db.ts";

type Db = ReturnType<typeof getServiceDb>;

/**
 * RN-HOR8 (baja lógica del profesional) — guardas compartidas.
 *
 * La regla nació en Horarios ("un doctor con `available=false` no recibe
 * franjas nuevas") pero es la misma en todos los módulos que asignan trabajo a
 * un profesional: **la baja corta las asignaciones NUEVAS y no toca lo ya
 * asignado**. Un turno agendado antes de la baja sigue existiendo y se puede
 * reprogramar; un evento clínico ya firmado es inmutable. Lo único que se
 * rechaza es *empezar* a depender de alguien que la clínica dio de baja.
 *
 * Hay DOS claves para un profesional (DT-2) y por eso hay dos guardas:
 *
 * - `doctores.id`  → lo usan Turnos y Horarios (`turnos.doctor_id`).
 * - `usuarios.id`  → lo usan Historial Clínico y Vacunación
 *   (`historial_clinico.professional_id` es FK a `usuarios(id)`), que llegan al
 *   perfil profesional por `doctores.user_id`.
 *
 * Las dos corren con `getServiceDb()` (service role, sin RLS): el
 * `.eq("tenant_id", …)` explícito es el único aislamiento que hay.
 */

/**
 * Turnos/Horarios: el `doctorId` debe ser un profesional de ESTE tenant y estar
 * disponible. Resolver la fila acá también cierra el paso a un `doctor_id` de
 * otra clínica llegado por el body: la FK `turnos.doctor_id → doctores(id)` no
 * lleva el tenant en la clave y por sí sola lo aceptaría.
 */
export async function assertDoctorAsignable(
  db: Db,
  tenantId: string,
  doctorId: string,
): Promise<void> {
  const { data } = await db
    .from("doctores")
    .select("id, available")
    .eq("id", doctorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const doctor = data as unknown as { available: boolean } | null;

  if (!doctor) {
    throw new DomainError(ErrorCode.FORBIDDEN, 403, "Doctor no encontrado en este tenant");
  }
  if (!doctor.available) {
    throw new DomainError(
      ErrorCode.DOCTOR_INACTIVE,
      422,
      "El profesional está dado de baja: no puede recibir asignaciones nuevas",
    );
  }
}

/**
 * Historial Clínico/Vacunación: el `professionalId` es un `usuarios.id`, y su
 * perfil profesional se busca por `doctores.user_id` (UNIQUE por tenant, de ahí
 * el `maybeSingle`).
 *
 * Alcance deliberadamente acotado: sólo rechaza cuando EXISTE un perfil de
 * doctor y está dado de baja. Un usuario del tenant sin perfil de doctor pasa,
 * igual que hoy — quién puede firmar un evento clínico es otra regla (y hoy la
 * única barrera es el permiso `manage_medical_history`). Ampliarla a "sólo
 * doctores firman" cambiaría el contrato de eventos y eutanasia, así que no se
 * mezcla con esta corrección.
 */
export async function assertProfesionalAsignable(
  db: Db,
  tenantId: string,
  professionalId: string,
): Promise<void> {
  const { data } = await db
    .from("doctores")
    .select("id, available")
    .eq("user_id", professionalId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const doctor = data as unknown as { available: boolean } | null;

  if (doctor && !doctor.available) {
    throw new DomainError(
      ErrorCode.DOCTOR_INACTIVE,
      422,
      "El profesional está dado de baja: no puede firmar registros nuevos",
    );
  }
}
