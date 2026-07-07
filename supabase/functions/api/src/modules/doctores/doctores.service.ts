import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import {
  ActualizarDoctorSchema,
  type ActualizarDoctorDto,
  type ListarDoctoresOpts,
} from "./doctores.schemas.ts";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
}

export interface UsuarioEmbed {
  username: string;
  fullName: string;
  active:   boolean;
}

/**
 * Contrato del "profesional" (DT-2) — el objeto expone DOS claves y cada
 * consumidor debe usar la que corresponde:
 *
 * - `id`: PK de `doctores`. Es la clave de Turnos y Horarios
 *   (`turnos.doctor_id`, `horarios_doctor.doctor_id`).
 * - `userId`: `usuarios.id` del usuario logueable vinculado (nullable por
 *   `ON DELETE SET NULL`). Es la clave que Historial Clínico y Vacunación
 *   esperan como `professionalId` (FK `historial_clinico.professional_id`
 *   → `usuarios(id)`, y los RPCs de eutanasia/vacunación).
 *
 * Los selects de historial deben listar con `professional=true` (solo
 * doctores con `userId`) y enviar `userId`, nunca `id`.
 */
export interface DoctorPublico {
  id:            string;
  userId:        string | null;
  name:          string;
  specialty:     string | null;
  licenseNumber: string | null;
  available:     boolean;
  createdAt:     string;
  usuario:       UsuarioEmbed | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mapea una fila de `doctores` (snake_case) al DTO público (camelCase). */
function toPublic(row: Record<string, unknown>): DoctorPublico {
  // El embed de PostgREST llega como objeto (to-one) o null.
  const u = row["usuario"] as Record<string, unknown> | null | undefined;
  return {
    id:            row["id"]             as string,
    userId:        (row["user_id"]       as string | null) ?? null,
    name:          row["name"]           as string,
    specialty:     (row["specialty"]      as string | null) ?? null,
    licenseNumber: (row["license_number"] as string | null) ?? null,
    available:     row["available"]      as boolean,
    createdAt:     row["created_at"]     as string,
    usuario: u
      ? {
          username: u["username"]  as string,
          fullName: u["full_name"] as string,
          active:   u["active"]    as boolean,
        }
      : null,
  };
}

// Embed del usuario enlazado en una sola consulta (evita N+1 en el listado).
const COLS_EMBED =
  "id, user_id, name, specialty, license_number, available, created_at, usuario:usuarios!user_id(username, full_name, active)";

// ─── DoctorService ──────────────────────────────────────────────────────────────

export const DoctorService = {
  /** Listar y paginar doctores del tenant, con filtros opcionales. */
  async buscarPaginado(
    opts: ListarDoctoresOpts,
    tenantId: string,
  ): Promise<{ items: DoctorPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (opts.page - 1) * opts.limit;

    let query = db
      .from("doctores")
      .select(COLS_EMBED, { count: "exact" })
      .eq("tenant_id", tenantId);

    if (opts.available !== undefined) {
      query = query.eq("available", opts.available);
    }
    if (opts.professional) {
      // DT-2: seleccionables como profesional clínico ⇒ usuario vinculado.
      query = query.not("user_id", "is", null);
    }
    if (opts.search) {
      const term = sanitizeLikeTerm(opts.search);
      query = query.ilike("name", `%${term}%`);
    }

    const { data, error, count } = await query
      .order("name", { ascending: true })
      .range(offset, offset + opts.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) =>
      toPublic(r as Record<string, unknown>),
    );
    return { items, total: count ?? 0 };
  },

  /** Detalle de un doctor del tenant. */
  async obtenerPorId(id: string, tenantId: string): Promise<DoctorPublico | null> {
    const db = getServiceDb();
    const { data } = await db
      .from("doctores")
      .select(COLS_EMBED)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    return data ? toPublic(data as unknown as Record<string, unknown>) : null;
  },

  /**
   * Editar el perfil de un Doctor (name, specialty, licenseNumber, available).
   * `available=false` es la baja lógica. Auditoría UPDATE en módulo `users`
   * (el Doctor es una extensión del usuario; cf. permiso manage_users).
   */
  async actualizar(
    id: string,
    dto: ActualizarDoctorDto,
    ctx: CallerContext,
  ): Promise<DoctorPublico> {
    const parsed = ActualizarDoctorSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de doctor inválidos",
        parsed.error.issues,
      );
    }
    const data = parsed.data;

    const db = getServiceDb();

    // Guard de tenant: el doctor debe existir y pertenecer al tenant del JWT.
    const { data: actual } = await db
      .from("doctores")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (!actual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Doctor no encontrado en este tenant");
    }

    const actualRow = actual as unknown as Record<string, unknown>;

    const updatePayload: Record<string, unknown> = {};
    if (data.name          !== undefined) updatePayload["name"]           = data.name;
    if (data.specialty     !== undefined) updatePayload["specialty"]      = data.specialty ?? null;
    if (data.licenseNumber !== undefined) updatePayload["license_number"] = data.licenseNumber ?? null;
    if (data.available     !== undefined) updatePayload["available"]      = data.available;

    const { data: row, error } = await db
      .from("doctores")
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select(COLS_EMBED)
      .single();

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    // RN-S3: auditoría implícita de la escritura.
    await recordAudit(db as never, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "users",
      entityId:  id,
      oldValues: actualRow,
      newValues: updatePayload,
    });

    return toPublic(
      (row ?? { ...actualRow, ...updatePayload }) as unknown as Record<string, unknown>,
    );
  },
};
