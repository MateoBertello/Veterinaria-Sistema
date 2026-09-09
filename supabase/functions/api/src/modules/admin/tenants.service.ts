import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { recordAudit } from "../../shared/audit.ts";
import { getServiceDb } from "../../shared/db.ts";
import { sanitizeLikeTerm } from "../../shared/sanitize.ts";
import { invalidateModuleCache } from "../../middleware/requireModule.ts";
import {
  CrearTenantSchema,
  EditarTenantSchema,
  CrearAdminTenantSchema,
  type CrearTenantDto,
  type EditarTenantDto,
  type CrearAdminTenantDto,
  type ListarTenantsQueryDto,
} from "./tenants.schemas.ts";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface SuperAdminContext {
  superAdminId: string;
  superAdminName?: string;
}

/**
 * Metadatos comerciales de un tenant (RN-SA4): NUNCA expone datos de negocio
 * internos del tenant (clientes, mascotas, historial, etc.).
 */
export interface TenantPublico {
  id:            string;
  nombre:        string;
  cuitRut:       string;
  emailContacto: string;
  plan:          string;
  activo:        boolean;
  adminInvitado: boolean;
  createdAt:     string;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function toPublicTenant(row: Record<string, unknown>): TenantPublico {
  return {
    id:            row["id"] as string,
    nombre:        row["nombre"] as string,
    cuitRut:       row["cuit_rut"] as string,
    emailContacto: row["email_contacto"] as string,
    plan:          row["plan"] as string,
    activo:        row["activo"] as boolean,
    adminInvitado: (row["admin_invitado"] as boolean) ?? false,
    createdAt:     row["created_at"] as string,
  };
}

/** Detecta violación de unicidad de Postgres (cuit_rut duplicado). */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" ||
    (typeof error.message === "string" && error.message.toLowerCase().includes("duplicate"));
}

/**
 * Usuario administrador de una clínica, tal como lo devuelve el alta.
 * NUNCA incluye la contraseña (RN-S1): quien da el alta ya la eligió.
 */
export interface AdminTenantPublico {
  id:        string;
  tenantId:  string;
  username:  string;
  email:     string;
  fullName:  string;
  rol:       string;
  active:    boolean;
}

/** RN-SEC5: especialidad por defecto del perfil profesional creado en el alta. */
const SPECIALTY_POR_DEFECTO = "Clínica general";

interface AuthUserMinimo {
  id:            string;
  email:         string;
  app_metadata?: Record<string, unknown>;
}

/**
 * Localiza una cuenta de Supabase Auth por email, paginando el listado admin.
 *
 * GoTrue no expone "traer usuario por email", así que hay que recorrer. El tope
 * de páginas evita un bucle infinito si la API cambia de contrato; con 200 por
 * página cubre 10.000 cuentas, que es varios órdenes de magnitud más de lo que
 * cualquier instalación de esto va a tener.
 */
async function buscarAuthUserPorEmail(
  db: ReturnType<typeof getServiceDb>,
  email: string,
): Promise<AuthUserMinimo | null> {
  const objetivo = email.trim().toLowerCase();
  const admin = db.auth.admin as {
    listUsers: (o: { page: number; perPage: number }) => Promise<{
      data: { users: AuthUserMinimo[] } | null;
      error: { message: string } | null;
    }>;
  };

  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === objetivo);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

/**
 * Deriva un nombre de usuario a partir del email cuando el alta no trae uno.
 *
 * `usuarios.username` es NOT NULL y único por clínica (índice sobre
 * (tenant_id, username_ci)), así que no alcanza con limpiar el texto: hay que
 * comprobar que no esté tomado EN ESA clínica y desambiguar. Se prueba el
 * candidato pelado y después con sufijos numéricos.
 */
async function derivarUsername(
  db: ReturnType<typeof getServiceDb>,
  tenantId: string,
  email: string,
): Promise<string> {
  const local = email.split("@")[0] ?? "";
  let base = local.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
  if (base.length < 3) base = `${base}usuario`.slice(0, 40);

  for (let intento = 0; intento < 50; intento++) {
    const candidato = intento === 0 ? base : `${base}${intento + 1}`;
    const { data } = await db
      .from("usuarios")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("username_ci", candidato.toLowerCase())
      .maybeSingle();
    if (!data) return candidato;
  }

  // Improbable: 50 homónimos en la misma clínica. Mejor un sufijo aleatorio que
  // devolver algo que la base va a rechazar.
  return `${base}${Math.random().toString(36).slice(2, 8)}`.slice(0, 50);
}

/**
 * Marca que la clínica ya tiene administrador (`tenants.admin_invitado`).
 *
 * El nombre de la columna es herencia del flujo de invitación por mail, que ya
 * no existe. Renombrarla exigiría una migración nueva sobre una tabla en
 * producción y no cambiaría ningún comportamiento, así que se documenta el
 * significado nuevo acá y en la API sale como `adminInvitado`.
 *
 * No rompe el alta si falla: es un indicador de la consola de plataforma, no un
 * invariante del usuario que se acaba de crear.
 */
async function marcarTenantConAdmin(
  db: ReturnType<typeof getServiceDb>,
  tenantId: string,
): Promise<void> {
  await db
    .from("tenants")
    .update({ admin_invitado: true })
    .eq("id", tenantId)
    .then(undefined, () => undefined);
}

// ─── TenantService ────────────────────────────────────────────────────────────

export const TenantService = {
  /**
   * RN-SA1 (unicidad fiscal), RN-SA2 (alta atómica del tenant).
   *
   * El alta del tenant y su aprovisionamiento (on_tenant_created) son atómicos
   * vía el RPC crear_tenant. El tenant nace SIN usuarios: el administrador se
   * da de alta después, con `crearAdmin`.
   *
   * Acá se llamaba a `inviteUserByEmail` para invitar por mail a la cuenta de
   * contacto. Se sacó: esa invitación mandaba el `tenant_id` a `user_metadata`
   * —donde la API no lo lee— y no creaba fila en `usuarios`, así que el invitado
   * se autenticaba y después recibía 401 en todo. Nunca sirvió para entrar, y
   * mientras tanto cada alta dejaba una cuenta huérfana en `auth.users`: sin
   * fila en `usuarios`, invisible para cualquier herramienta que recorra tablas
   * de negocio. Lo que la invitación quería dar —que el administrador eligiera
   * su propia contraseña— hoy lo dan `crearAdmin` más la recuperación de
   * contraseña, que sí funciona.
   */
  async crear(dto: CrearTenantDto, ctx: SuperAdminContext): Promise<TenantPublico> {
    const parsed = CrearTenantSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de tenant inválidos",
        parsed.error.issues ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    // RN-SA1: pre-check de unicidad fiscal (respuesta limpia 409).
    const { data: existente } = await db
      .from("tenants")
      .select("id")
      .eq("cuit_rut", data.cuitRut)
      .single();

    if (existente) {
      throw new DomainError(
        ErrorCode.TENANT_DUPLICATE_TAXID,
        409,
        "Ya existe una clínica con ese CUIT/RUT",
      );
    }

    // RN-SA2: alta atómica (tenant + on_tenant_created) vía RPC.
    const { data: created, error: rpcError } = await db.rpc("crear_tenant", {
      p_nombre:         data.nombre,
      p_cuit_rut:       data.cuitRut,
      p_email_contacto: data.emailContacto,
      p_plan:           data.plan,
    });

    if (rpcError || !created) {
      // Fallback de carrera: la unicidad la garantiza el UNIQUE de la tabla.
      if (isUniqueViolation(rpcError)) {
        throw new DomainError(
          ErrorCode.TENANT_DUPLICATE_TAXID,
          409,
          "Ya existe una clínica con ese CUIT/RUT",
        );
      }
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo crear la clínica: ${rpcError?.message ?? ""}`,
      );
    }

    // El RPC RETURNS tenants → supabase-js puede devolver fila u objeto único.
    const tenantRow = (Array.isArray(created) ? created[0] : created) as Record<string, unknown>;

    // RN-SA5: auditoría de plataforma.
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "CREATE",
      module:    "platform",
      entityId:  tenantRow["id"] as string,
      newValues: {
        nombre:        data.nombre,
        cuitRut:       data.cuitRut,
        emailContacto: data.emailContacto,
        plan:          data.plan,
      },
    });

    // El tenant recién creado no tiene administrador todavía: `admin_invitado`
    // nace en false (default de la columna) y lo pone en true `crearAdmin`.
    // Ya no hace falta releer la fila: nada la modificó después del RPC.
    return toPublicTenant(tenantRow);
  },

  /**
   * Alta del usuario administrador inicial de una clínica.
   *
   * Es el paso que faltaba para que el alta completa de una clínica se pueda
   * hacer entera por la API. `on_tenant_created` deja los roles y los permisos,
   * pero ningún usuario: hasta acá, la única forma de que alguien entrara a una
   * clínica recién creada era correr `scripts/crear-usuario-tenant.mjs` con la
   * service-role key. El script sigue existiendo y sigue siendo el camino de
   * bootstrap (sirve cuando la API todavía no está desplegada), pero escribe con
   * la llave maestra y NO deja asiento de auditoría. Este endpoint sí.
   *
   * Es también lo que marca `tenants.admin_invitado`. Esa columna nació con el
   * significado "ya se le mandó el mail de invitación"; desde que la invitación
   * se sacó del alta, significa **la clínica ya tiene administrador**, y la pone
   * en true este método cuando el usuario creado tiene rol `admin`. El nombre de
   * la columna quedó viejo pero no se renombra: es una migración ya aplicada.
   *
   * Idempotente por (tenant, email): si el usuario ya existe en esa clínica se
   * devuelve tal cual está, sin duplicar, sin pisar su contraseña y sin escribir
   * un asiento nuevo — no hubo alta que auditar. El controller distingue los dos
   * casos por el flag `created` (201 contra 200).
   */
  async crearAdmin(
    tenantId: string,
    dto: CrearAdminTenantDto,
    ctx: SuperAdminContext,
  ): Promise<{ usuario: AdminTenantPublico; created: boolean }> {
    const parsed = CrearAdminTenantSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de administrador inválidos",
        parsed.error.issues ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    // 1. El tenant destino tiene que existir. Es el ÚNICO origen del tenant_id
    //    en toda esta operación: sale del `:id` de la ruta y nunca del body.
    const { data: tenant } = await db
      .from("tenants")
      .select("id, nombre")
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenant) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    // 2. El rol se resuelve por nombre DENTRO de esta clínica. Un rol de otra
    //    clínica no entra ni por accidente: además de este filtro, la FK
    //    compuesta (rol_id, tenant_id) → roles(id, tenant_id) lo rechaza en la
    //    base (20260725000005_usuarios_integridad_referencial.sql).
    const { data: rol } = await db
      .from("roles")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("name", data.rol)
      .maybeSingle();

    if (!rol) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        `La clínica no tiene el rol '${data.rol}'. ¿Se creó con el alta de la API?`,
      );
    }

    const rolDestino = rol as { id: string; name: string };
    const email      = data.email.trim();

    // 3. Idempotencia: ¿ya hay un usuario con ese email EN ESTA clínica?
    //    Se compara contra `email_ci` porque la unicidad es case-insensitive.
    const { data: yaExiste } = await db
      .from("usuarios")
      .select("id, tenant_id, username, email, full_name, active, rol_id")
      .eq("tenant_id", tenantId)
      .eq("email_ci", email.toLowerCase())
      .maybeSingle();

    if (yaExiste) {
      const fila = yaExiste as Record<string, unknown>;

      // Autocuración: una clínica dada de alta ANTES de este cambio puede tener
      // administrador y la columna todavía en false. El reintento la corrige.
      if (rolDestino.name === "admin") {
        await marcarTenantConAdmin(db, tenantId);
      }

      return {
        created: false,
        usuario: {
          id:       fila["id"] as string,
          tenantId: fila["tenant_id"] as string,
          username: fila["username"] as string,
          email:    fila["email"] as string,
          fullName: fila["full_name"] as string,
          rol:      rolDestino.name,
          active:   fila["active"] as boolean,
        },
      };
    }

    const username = data.username ?? await derivarUsername(db, tenantId, email);

    // 4. Cuenta en Supabase Auth, con el tenant en `app_metadata`.
    //
    //    En `app_metadata` y NO en `user_metadata`: el JWT lleva las dos, pero
    //    `tenantContext` lee `app_metadata.tenant_id`, y `user_metadata` es
    //    editable por el propio usuario. Ponerlo en el lugar equivocado es
    //    exactamente el defecto que tiene hoy la invitación por email: la cuenta
    //    se crea, el mail llega, y toda llamada a la API responde 401.
    let authUserId: string;
    let creadaAcaEnAuth = false;

    const { data: authData, error: authError } = await (db.auth.admin as {
      createUser: (u: {
        email: string;
        password: string;
        email_confirm: boolean;
        app_metadata: Record<string, unknown>;
      }) => Promise<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
    }).createUser({
      email:         email,
      password:      data.password,
      email_confirm: true,
      app_metadata:  { tenant_id: tenantId },
    });

    if (authError || !authData?.user) {
      const yaRegistrado = /already|registered|exists/i.test(authError?.message ?? "");
      if (!yaRegistrado) {
        throw new DomainError(
          ErrorCode.INTERNAL_ERROR,
          500,
          `No se pudo crear el usuario en Auth: ${authError?.message ?? ""}`,
        );
      }

      // La cuenta de Auth ya existe pero no hay fila en `usuarios` de esta
      // clínica. Es el estado que deja la invitación rota, y también el de una
      // cuenta de OTRA clínica. Hay que distinguirlos: reparar la primera es
      // correcto; tocar la segunda sería robarle el usuario a otro tenant.
      const existente = await buscarAuthUserPorEmail(db, email);
      if (!existente) {
        throw new DomainError(
          ErrorCode.INTERNAL_ERROR,
          500,
          `Auth informa que ${email} ya existe pero no se pudo localizar`,
        );
      }

      const meta        = existente.app_metadata ?? {};
      const tenantDeEsa = meta["tenant_id"] as string | undefined;
      const esPlataforma = meta["platform_role"] !== undefined;

      if (esPlataforma || (tenantDeEsa && tenantDeEsa !== tenantId)) {
        throw new DomainError(
          ErrorCode.DUPLICATE_USER,
          409,
          "Ese email ya pertenece a otra cuenta del sistema",
        );
      }

      // Cuenta huérfana o ya de esta clínica: se adopta. Esto es lo que repara
      // una invitación cursada antes, que dejó la cuenta sin tenant utilizable.
      authUserId = existente.id;
      await (db.auth.admin as {
        updateUserById: (
          uid: string,
          attrs: {
            password: string;
            email_confirm: boolean;
            app_metadata: Record<string, unknown>;
          },
        ) => Promise<{ error: { message: string } | null }>;
      }).updateUserById(authUserId, {
        password:      data.password,
        email_confirm: true,
        app_metadata:  { tenant_id: tenantId },
      });
    } else {
      authUserId      = authData.user.id;
      creadaAcaEnAuth = true;
    }

    // 5. Fila espejo en `usuarios`. Sin esto el login de clínica no encuentra al
    //    usuario: resuelve el identificador contra esta tabla.
    const { error: insertError } = await db
      .from("usuarios")
      .insert({
        id:        authUserId,
        tenant_id: tenantId,
        username,
        email,
        full_name: data.fullName,
        rol_id:    rolDestino.id,
        active:    true,
      });

    if (insertError) {
      // Rollback acotado: solo se borra la cuenta de Auth si la creamos en ESTA
      // llamada. Una cuenta preexistente que adoptamos no se destruye por un
      // fallo nuestro.
      if (creadaAcaEnAuth) {
        await (db.auth.admin as { deleteUser: (id: string) => Promise<unknown> })
          .deleteUser(authUserId).catch(() => {});
      }
      if (isUniqueViolation(insertError)) {
        throw new DomainError(
          ErrorCode.DUPLICATE_USER,
          409,
          "El nombre de usuario o el email ya están tomados en esta clínica",
        );
      }
      throw new DomainError(
        ErrorCode.INTERNAL_ERROR,
        500,
        `No se pudo guardar el usuario: ${insertError.message}`,
      );
    }

    // 6. RN-SEC5: un veterinario tiene además perfil profesional, para poder ser
    //    elegido en Historial, Turnos y Horarios.
    if (rolDestino.name === "veterinario") {
      await db.from("doctores").upsert(
        {
          tenant_id: tenantId,
          user_id:   authUserId,
          name:      data.fullName,
          specialty: SPECIALTY_POR_DEFECTO,
          available: true,
        },
        { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
      );
    }

    // 7. Auditoría (RN-S3 / RN-SEC7). El asiento va con el `tenant_id` de la
    //    clínica —no `null` como los de plataforma— porque lo que se creó es un
    //    usuario DE esa clínica, y es en su registro donde tiene que aparecer.
    //    El autor es el Super Admin, que no tiene fila en `usuarios`: por eso el
    //    nombre y el rol se pasan resueltos, del token ya verificado.
    //    Sin password en newValues (RN-S1).
    await recordAudit(db as unknown as SupabaseClient, {
      tenantId,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "CREATE",
      module:    "users",
      entityId:  authUserId,
      newValues: {
        username,
        email,
        fullName: data.fullName,
        rol:      rolDestino.name,
        active:   true,
      },
      details:   "Alta del usuario inicial de la clínica desde la consola de plataforma",
    });

    // 8. La clínica ya tiene administrador. Solo cuenta el rol `admin`: un
    //    veterinario o un recepcionista no dejan a la clínica administrada.
    if (rolDestino.name === "admin") {
      await marcarTenantConAdmin(db, tenantId);
    }

    return {
      created: true,
      usuario: {
        id:       authUserId,
        tenantId,
        username,
        email,
        fullName: data.fullName,
        rol:      rolDestino.name,
        active:   true,
      },
    };
  },

  /** Edición de datos comerciales. Auditoría UPDATE platform (RN-SA5). */
  async actualizar(
    id: string,
    dto: EditarTenantDto,
    ctx: SuperAdminContext,
  ): Promise<TenantPublico> {
    const parsed = EditarTenantSchema.safeParse(dto);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_ERROR,
        422,
        "Datos de tenant inválidos",
        parsed.error.issues ?? [],
      );
    }

    const data = parsed.data;
    const db   = getServiceDb();

    const { data: actual, error: findError } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (findError || !actual) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.nombre        !== undefined) updatePayload["nombre"]         = data.nombre;
    if (data.emailContacto !== undefined) updatePayload["email_contacto"] = data.emailContacto;
    if (data.plan          !== undefined) updatePayload["plan"]           = data.plan;

    const { data: updated, error: updateError } = await db
      .from("tenants")
      .update(updatePayload)
      .eq("id", id)
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .single();

    if (updateError) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, updateError.message);
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "UPDATE",
      module:    "platform",
      entityId:  id,
      oldValues: actual as Record<string, unknown>,
      newValues: updatePayload,
    });

    return toPublicTenant(updated as Record<string, unknown>);
  },

  /**
   * RN-SA3 (lado escritura): suspender/reactivar un tenant (baja lógica).
   * Invalida la caché de módulos para que la suspensión surta efecto sin esperar
   * el TTL. Auditoría UPDATE platform (RN-SA5).
   */
  async cambiarEstado(
    id: string,
    activo: boolean,
    ctx: SuperAdminContext,
  ): Promise<TenantPublico> {
    const db = getServiceDb();

    const { data: actual, error: findError } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (findError || !actual) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    const { data: updated, error: updateError } = await db
      .from("tenants")
      .update({ activo })
      .eq("id", id)
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .single();

    if (updateError) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, updateError.message);
    }

    invalidateModuleCache(id);

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  null,
      userId:    ctx.superAdminId,
      userName:  ctx.superAdminName ?? "super_admin",
      userRole:  "super_admin",
      action:    "UPDATE",
      module:    "platform",
      entityId:  id,
      oldValues: { activo: (actual as { activo: boolean }).activo },
      newValues: { activo },
    });

    return toPublicTenant(updated as Record<string, unknown>);
  },

  /** RN-SA4: solo metadatos comerciales, nunca datos de negocio del tenant. */
  async obtenerPorId(id: string): Promise<TenantPublico> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("tenants")
      .select("id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.TENANT_NOT_FOUND, 404, "Tenant no encontrado");
    }

    return toPublicTenant(data as Record<string, unknown>);
  },

  /** RN-SA4: listado paginado de metadatos comerciales con filtros. */
  async buscarPaginado(
    filtros: ListarTenantsQueryDto,
  ): Promise<{ items: TenantPublico[]; total: number }> {
    const db     = getServiceDb();
    const offset = (filtros.page - 1) * filtros.limit;

    let query = db
      .from("tenants")
      .select(
        "id, nombre, cuit_rut, email_contacto, plan, activo, admin_invitado, created_at",
        { count: "exact" },
      );

    if (filtros.q) {
      const q = sanitizeLikeTerm(filtros.q);
      query = query.or(`nombre.ilike.%${q}%,cuit_rut.ilike.%${q}%`);
    }
    if (filtros.plan) {
      query = query.eq("plan", filtros.plan);
    }
    if (filtros.estado) {
      query = query.eq("activo", filtros.estado === "activo");
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + filtros.limit - 1);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((row) =>
      toPublicTenant(row as Record<string, unknown>),
    );

    return { items, total: count ?? 0 };
  },
};
