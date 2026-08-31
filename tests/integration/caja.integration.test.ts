import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuth } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let cajaA1Id = "";
let cajaA2Id = "";

let tenantBId = "";
let usuarioBId = "";
let cajaBId = "";

let medioPagoEfectivoId = "";

export async function crearFixtureCaja(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_caja@test.com`,
    p_plan: "basico",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = typeof t === "string" ? t : (t as { id: string }).id;

  // 2. Rol admin
  const { data: r } = await db
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "admin")
    .single();
  const rolId = r!.id as string;

  // 3. Usuario Auth + DB
  const usuarioId = await crearUsuarioAuth(`${prefix.toLowerCase()}_${Date.now()}@test.com`, {
    tenant_id: tenantId,
  });

  const { error: errU } = await db.from("usuarios").insert({
    id: usuarioId,
    tenant_id: tenantId,
    username: `${prefix.toLowerCase()}_admin_${Date.now()}`,
    email: `${prefix.toLowerCase()}_${Date.now()}@test.com`,
    full_name: `${prefix} Admin`,
    rol_id: rolId,
    active: true,
  });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Caja
  const { data: c, error: errC } = await db
    .from("cajas")
    .insert({
      tenant_id: tenantId,
      nombre: `${prefix} Caja Principal`,
    })
    .select("id")
    .single();
  if (errC || !c) throw new Error(`Error creando caja: ${errC?.message}`);

  return { tenantId, usuarioId, cajaId: c.id as string };
}

describeIntegration("C3·T1: Restricciones de base de datos para Caja", () => {
  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fixA = await crearFixtureCaja(serviceDb, "CajaA");
    tenantAId = fixA.tenantId;
    usuarioAId = fixA.usuarioId;
    cajaA1Id = fixA.cajaId;

    // Segunda caja para Tenant A
    const { data: c2 } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: tenantAId,
        nombre: "Caja Secundaria A",
      })
      .select("id")
      .single();
    cajaA2Id = c2!.id as string;

    const fixB = await crearFixtureCaja(serviceDb, "CajaB");
    tenantBId = fixB.tenantId;
    usuarioBId = fixB.usuarioId;
    cajaBId = fixB.cajaId;

    const { data: mp } = await serviceDb
      .from("medios_pago")
      .select("id")
      .eq("codigo", "efectivo")
      .single();
    medioPagoEfectivoId = mp!.id as string;
  });

  afterAll(async () => {
    if (!serviceDb) return;
    if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
    if (usuarioBId) await borrarUsuarioAuth(usuarioBId);
    if (tenantAId) await serviceDb.from("tenants").delete().eq("id", tenantAId);
    if (tenantBId) await serviceDb.from("tenants").delete().eq("id", tenantBId);
  });

  it("RN-CJ4: el índice parcial rechaza la segunda sesión abierta", async () => {
    // 1. Abrir primera sesión en Caja 1
    const { data: s1, error: err1 } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaA1Id,
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 1000,
      })
      .select("id")
      .single();

    expect(err1).toBeNull();
    expect(s1?.id).toBeDefined();

    // 2. Intentar abrir segunda sesión en la misma caja → falla por uq_sesion_caja_abierta (23505)
    const { error: err2 } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaA1Id,
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 500,
      });

    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");

    // 3. Abrir sesión en OTRA caja del mismo tenant → funciona (índice es por tenant_id, caja_id)
    const { data: sCaja2, error: errCaja2 } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaA2Id,
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 2000,
      })
      .select("id")
      .single();

    expect(errCaja2).toBeNull();
    expect(sCaja2?.id).toBeDefined();

    // 4. Cerrar la primera sesión de Caja 1
    const { error: errCierre } = await serviceDb
      .from("sesiones_caja")
      .update({
        estado: "cerrada",
        cierre_at: new Date().toISOString(),
        cierre_usuario_id: usuarioAId,
        saldo_teorico_efectivo: 1000,
        efectivo_contado: 1000,
        diferencia: 0,
      })
      .eq("id", s1!.id);

    expect(errCierre).toBeNull();

    // 5. Ahora abrir una nueva sesión en Caja 1 → funciona
    const { data: s3, error: err3 } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaA1Id,
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 1500,
      })
      .select("id")
      .single();

    expect(err3).toBeNull();
    expect(s3?.id).toBeDefined();
  });

  it("RN-CJ6: una sesión cerrada sin diferencia no es válida", async () => {
    // Crear caja dedicada para este test
    const { data: cajaTest } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: tenantAId,
        nombre: `Caja Test RN-CJ6 ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = cajaTest!.id as string;

    // 1. Insertar una sesión abierta
    const { data: s, error: errApertura } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaId,
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 500,
      })
      .select("id")
      .single();

    expect(errApertura).toBeNull();
    expect(s?.id).toBeDefined();

    // 2. Intentar cerrarla sin diferencia (NULL) → viola chk_sesion_cierre_completo (23514)
    const { error: errUpdateIncompleto } = await serviceDb
      .from("sesiones_caja")
      .update({
        estado: "cerrada",
        cierre_at: new Date().toISOString(),
        cierre_usuario_id: usuarioAId,
        saldo_teorico_efectivo: 500,
        efectivo_contado: 500,
        diferencia: null,
      })
      .eq("id", s!.id);

    expect(errUpdateIncompleto).not.toBeNull();
    expect(errUpdateIncompleto?.code).toBe("23514"); // check_violation

    // 3. Intentar crear una sesión directamente cerrada sin saldo teórico → falla 23514
    const { error: errInsertInvalido } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaId,
        estado: "cerrada",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 500,
        cierre_at: new Date().toISOString(),
        cierre_usuario_id: usuarioAId,
        efectivo_contado: 500,
        diferencia: 0,
        // falta saldo_teorico_efectivo
      });

    expect(errInsertInvalido).not.toBeNull();
    expect(errInsertInvalido?.code).toBe("23514");
  });

  it("un movimiento de caja no se puede actualizar ni borrar", async () => {
    // 1. Obtener o crear una sesión abierta
    const { data: s } = await serviceDb
      .from("sesiones_caja")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("estado", "abierta")
      .limit(1)
      .single();

    // 2. Insertar movimiento de caja
    const { data: mov, error: errMov } = await serviceDb
      .from("movimientos_caja")
      .insert({
        tenant_id: tenantAId,
        sesion_caja_id: s!.id,
        tipo: "ingreso_manual",
        medio_pago_id: medioPagoEfectivoId,
        importe: 300,
        usuario_id: usuarioAId,
        motivo: "Aporte de cambio",
      })
      .select("id")
      .single();

    expect(errMov).toBeNull();
    expect(mov?.id).toBeDefined();

    // 3. Intentar UPDATE → MOVEMENT_IMMUTABLE
    const { error: errUpdate } = await serviceDb
      .from("movimientos_caja")
      .update({ importe: 999 })
      .eq("id", mov!.id);

    expect(errUpdate).not.toBeNull();
    expect(errUpdate?.message).toMatch(/MOVEMENT_IMMUTABLE/);

    // 4. Intentar DELETE → MOVEMENT_IMMUTABLE
    const { error: errDelete } = await serviceDb
      .from("movimientos_caja")
      .delete()
      .eq("id", mov!.id);

    expect(errDelete).not.toBeNull();
    expect(errDelete?.message).toMatch(/MOVEMENT_IMMUTABLE/);
  });

  it("el signo lo determina el tipo", async () => {
    const { data: resIngreso, error: errIngreso } = await serviceDb.rpc(
      "signo_movimiento_caja",
      { p_tipo: "ingreso_venta" }
    );
    expect(errIngreso).toBeNull();
    expect(resIngreso).toBe(1);

    const { data: resEgreso, error: errEgreso } = await serviceDb.rpc(
      "signo_movimiento_caja",
      { p_tipo: "egreso_retiro" }
    );
    expect(errEgreso).toBeNull();
    expect(resEgreso).toBe(-1);
  });

  it("RN-SC2: una sesión de A no puede colgar de una caja de B", async () => {
    const { error } = await serviceDb
      .from("sesiones_caja")
      .insert({
        tenant_id: tenantAId,
        caja_id: cajaBId, // Caja perteneciente al Tenant B
        estado: "abierta",
        apertura_usuario_id: usuarioAId,
        saldo_inicial: 100,
      });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503"); // foreign_key_violation
  });
});
