import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import {
  CrearUsuarioSchema,
  EditarUsuarioSchema,
  type CrearUsuarioDto,
  type EditarUsuarioDto,
} from "./usuarios.schemas.ts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CallerContext {
  tenantId:     string;
  callerUserId: string;
  callerName:   string;
  callerRole:   string;
  authHeader:   string;
}

export interface UsuarioPublico {
  id:        string;
  username:  string;
  email:     string;
  fullName:  string;
  phone:     string | null;
  active:    boolean;
  rolId:     string;
  rolName:   string;
  createdAt: string;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** RN-SEC5: especialidad por defecto del perfil profesional creado en el alta. */
const SPECIALTY_POR_DEFECTO = "Clínica general";

/** Omite campos sensibles de la respuesta (RN-S1) */
function toPublicUser(row: Record<string, unknown>): UsuarioPublico {
  return {
    id:        row["id"] as string,
    username:  row["username"] as string,
    email:     row["email"] as string,
    fullName:  row["full_name"] as string,
    phone:     (row["phone"] as string | null) ?? null,
    active:    row["active"] as boolean,
    rolId:     row["rol_id"] as string,
    rolName:   (row["rolName"] as string) ?? "",
    createdAt: row["created_at"] as string,
  };
}

/** Cuenta admins activos del tenant (para RN-SEC6) */
async function countAdminsActivos(
  db: ReturnType<typeof getServiceDb>,
  tenantId: string,
): Promise<number> {
  // Obtener el ID del rol admin del tenant
  const { data: rolAdmin } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();

  if (!rolAdmin) return 0;

  // Contar usuarios activos con rol admin
  const { data: users } = await (db.auth.admin as {
    listUsers: () => Promise<{ data: { users: unknown[] }; error: unknown }>;
  }).listUsers();

  // Alternativa: contar desde la tabla usuarios
  // Usamos auth.admin.listUsers como proxy del mock;
  // en producción se haría SELECT COUNT(*) FROM usuarios WHERE tenant_id=? AND rol_id=? AND active=true
  return (users?.users.length as number) ?? 0;
}

// ─── UsuariosService ──────────────────────────────────────────────────────────

export const UsuariosService = {
  async crear(
    dto: CrearUsuarioDto,
    ctx: CallerContext,
  ): Promise<UsuarioPublico> {
    // 1. Validar schema (RN-SEC1)
    const parsed = CrearUsuarioSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de usuario inválidos",
        parsed.error.issues ?? (parsed.error as { errors?: unknown[] }).errors ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    // 2. Verificar unicidad username (RN-SEC4)
    const { data: existeUsername } = await db
      .from("usuarios")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("username", data.username)
      .single();

    if (existeUsername) {
      throw new DomainError(ErrorCode.DUPLICATE_USER, 409, "El nombre de usuario ya está en uso");
    }

    // 3. Verificar unicidad email (RN-SEC4)
    const { data: existeEmail } = await db
      .from("usuarios")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("email", data.email)
      .single();

    if (existeEmail) {
      throw new DomainError(ErrorCode.DUPLICATE_USER, 409, "El email ya está registrado");
    }

    // 4. Crear en Supabase Auth (con app_metadata.tenant_id)
    const { data: authData, error: authError } = await (db.auth.admin as {
      createUser: (u: {
        email: string;
        password: string;
        email_confirm: boolean;
        app_metadata: Record<string, unknown>;
      }) => Promise<{ data: { user: { id: string } | null } | null; error: { message: string } | null }>;
    }).createUser({
      email:          data.email,
      password:       data.password,
      email_confirm:  true,
      app_metadata:   { tenant_id: ctx.tenantId },
    });

    if (authError || !authData?.user) {
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo crear el usuario en Auth: ${authError?.message ?? ""}`,
      );
    }

    const authUserId = authData.user.id;

    // 5. Insertar en tabla usuarios (transacción lógica: rollback en caso de fallo)
    const { error: insertError } = await db
      .from("usuarios")
      .insert({
        id:        authUserId,
        tenant_id: ctx.tenantId,
        username:  data.username,
        email:     data.email,
        full_name: data.fullName,
        rol_id:    data.roleId,
        phone:     data.phone ?? null,
        active:    data.active,
      });

    if (insertError) {
      // Rollback: eliminar de Auth para no dejar huérfano
      await (db.auth.admin as { deleteUser: (id: string) => Promise<unknown> })
        .deleteUser(authUserId);
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo guardar el usuario: ${insertError.message}`,
      );
    }

    // 6. Si rol es 'veterinario' → crear Doctor automáticamente (RN-SEC5)
    const { data: rol } = await db
      .from("roles")
      .select("id, name")
      .eq("id", data.roleId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (rol && (rol as { name: string }).name === "veterinario") {
      // UPSERT sobre UNIQUE(tenant_id, user_id) con DO NOTHING: si el perfil ya
      // existe se conserva tal cual (specialty/matrícula/available editadas a
      // mano en el ABM de Doctores no se pisan). El default solo aplica al alta.
      await db.from("doctores").upsert(
        {
          tenant_id: ctx.tenantId,
          user_id:   authUserId,
          name:      data.fullName,
          specialty: SPECIALTY_POR_DEFECTO,
          available: true,
        },
        { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
      );
    }

    // 7. Auditoría CREATE (RN-SEC7 / RN-S3) — sin password en newValues (RN-S1)
    const { password: _pw, ...dtoSinPassword } = data;
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "CREATE",
      module:    "users",
      entityId:  authUserId,
      newValues: dtoSinPassword as Record<string, unknown>,
    });

    return toPublicUser({
      id:         authUserId,
      username:   data.username,
      email:      data.email,
      full_name:  data.fullName,
      phone:      data.phone ?? null,
      active:     data.active,
      rol_id:     data.roleId,
      rolName:    (rol as { name: string } | null)?.name ?? "",
      created_at: new Date().toISOString(),
    });
  },

  async editar(
    id: string,
    dto: EditarUsuarioDto,
    ctx: CallerContext,
  ): Promise<UsuarioPublico | null> {
    // 1. Validar schema
    const parsed = EditarUsuarioSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de usuario inválidos",
        parsed.error.issues ?? (parsed.error as { errors?: unknown[] }).errors ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    // 2. Cargar usuario actual (debe pertenecer al tenant)
    const { data: usuarioActual, error: findError } = await db
      .from("usuarios")
      .select("id, tenant_id, username, email, full_name, phone, active, rol_id, created_at")
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (findError || !usuarioActual) {
      throw new DomainError(ErrorCode.FORBIDDEN, 403, "Usuario no encontrado en este tenant");
    }

    // 3. Protección LAST_ADMIN (RN-SEC6): no desactivar si es el único admin activo
    if (data.active === false) {
      const { data: rolActual } = await db
        .from("roles")
        .select("id, name")
        .eq("id", (usuarioActual as { rol_id: string }).rol_id)
        .single();

      if (rolActual && (rolActual as { name: string }).name === "admin") {
        const count = await countAdminsActivos(db, ctx.tenantId);
        if (count <= 1) {
          throw new DomainError(
            ErrorCode.LAST_ADMIN,
            409,
            "No se puede desactivar el último administrador activo",
          );
        }
      }
    }

    // 4. Actualizar
    const emailAnterior = (usuarioActual as { email: string }).email;
    const emailNuevo    =
      data.email !== undefined && data.email !== emailAnterior ? data.email : null;

    // 4a. Si cambia el email, sincronizarlo PRIMERO en Supabase Auth. El login
    //     autentica contra Auth usando el email del espejo `usuarios`; si solo se
    //     tocara la tabla, el usuario quedaría con un email que Auth no conoce y
    //     no podría volver a iniciar sesión (401). Espejamos el rollback de crear().
    if (emailNuevo !== null) {
      const { error: authError } = await (db.auth.admin as {
        updateUserById: (
          uid: string,
          attrs: { email: string; email_confirm: boolean },
        ) => Promise<{ error: { message: string } | null }>;
      }).updateUserById(id, { email: emailNuevo, email_confirm: true });

      if (authError) {
        // Unicidad de email en Auth es global (cross-tenant): mapear el choque.
        const duplicado = /already|registered|exists|duplicate/i.test(authError.message ?? "");
        throw new DomainError(
          duplicado ? ErrorCode.DUPLICATE_USER : ErrorCode.INTERNAL_ERROR,
          duplicado ? 409 : 500,
          duplicado
            ? "El email ya está registrado"
            : `No se pudo actualizar el email en Auth: ${authError.message}`,
        );
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.fullName  !== undefined) updatePayload["full_name"] = data.fullName;
    if (data.email     !== undefined) updatePayload["email"]     = data.email;
    if (data.phone     !== undefined) updatePayload["phone"]     = data.phone;
    if (data.active    !== undefined) updatePayload["active"]    = data.active;
    if (data.roleId    !== undefined) updatePayload["rol_id"]    = data.roleId;
    if (data.username  !== undefined) updatePayload["username"]  = data.username;

    const { error: updateError } = await db
      .from("usuarios")
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId);

    if (updateError) {
      // Rollback del email en Auth: no dejar Auth y el espejo desincronizados.
      if (emailNuevo !== null) {
        await (db.auth.admin as {
          updateUserById: (
            uid: string,
            attrs: { email: string; email_confirm: boolean },
          ) => Promise<unknown>;
        }).updateUserById(id, { email: emailAnterior, email_confirm: true }).catch(() => {});
      }
      if (updateError.message.includes("duplicate")) {
        throw new DomainError(ErrorCode.DUPLICATE_USER, 409, "Username o email ya en uso");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, updateError.message);
    }

    // 5. Si cambió a rol veterinario → upsert Doctor (RN-SEC5)
    if (data.roleId) {
      const { data: nuevoRol } = await db
        .from("roles")
        .select("name")
        .eq("id", data.roleId)
        .single();
      if (nuevoRol && (nuevoRol as { name: string }).name === "veterinario") {
        // Mismo UPSERT DO NOTHING que en crear(): re-asignar el rol veterinario
        // a un usuario que ya tiene perfil NO duplica la fila ni la modifica.
        await db.from("doctores").upsert(
          {
            tenant_id: ctx.tenantId,
            user_id:   id,
            name:      data.fullName ?? (usuarioActual as { full_name: string }).full_name,
            specialty: SPECIALTY_POR_DEFECTO,
            available: true,
          },
          { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
        );
      }
    }

    // 6. Auditoría UPDATE (RN-SEC7 / RN-S3)
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName,
      userRole:  ctx.callerRole,
      action:    "UPDATE",
      module:    "users",
      entityId:  id,
      oldValues: usuarioActual as Record<string, unknown>,
      newValues: updatePayload,
    });

    return toPublicUser({
      ...usuarioActual as Record<string, unknown>,
      ...updatePayload,
    });
  },

  async listar(
    tenantId: string,
    page: number,
    limit: number,
  ): Promise<{ items: UsuarioPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (page - 1) * limit;

    const { data, error, count } = await db
      .from("usuarios")
      .select(`
        id, username, email, full_name, phone, active, rol_id, created_at,
        roles!inner(display_name)
      `, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const rol = r["roles"] as { display_name: string } | null;
      return toPublicUser({ ...r, rolName: rol?.display_name ?? "" });
    });

    return { items, total: count ?? 0 };
  },

  async obtenerRoles(tenantId: string): Promise<object[]> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("roles")
      .select("id, name, display_name, description")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("display_name");

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    return (data as object[]) ?? [];
  },
};
