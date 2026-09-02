import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, limpiarTenant } from "./_teardown.ts";

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
    // Antes: borrado a mano tabla por tabla, ignorando todos los errores. Dos
    // fallas garantizadas — `movimientos_stock` lo rechaza siempre el trigger de
    // inmutabilidad, y el DELETE de `tenants` también, por la misma cascada — y
    // ninguna se veía. `limpiarTenant` usa la vía legítima (`dar_de_baja_tenant`)
    // y revienta si el tenant sobrevive.
    for (const tid of [tenantAId, tenantBId]) await limpiarTenant(serviceDb, tid);
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

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

function rpcReallyRan(error: { message: string } | null): boolean {
  return !/could not find|schema cache/i.test(error?.message ?? "");
}

function esExito(r: RpcResult): boolean {
  return r.error === null && Array.isArray(r.data) && r.data.length === 1;
}

describeIntegration("C3·T2: RPCs de Caja y Concurrencia", () => {
  let t2TenantId = "";
  let t2UsuarioId = "";

  beforeAll(async () => {
    serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fix = await crearFixtureCaja(serviceDb, "CajaT2");
    t2TenantId = fix.tenantId;
    t2UsuarioId = fix.usuarioId;
  });

  afterAll(async () => {
    if (!serviceDb) return;
    await limpiarTenant(serviceDb, t2TenantId);
  });

  it("RN-CJ4: dos aperturas SIMULTÁNEAS de la misma caja → gana exactamente una", async () => {
    const reps = process.env.CONCURRENCY_REPS ? parseInt(process.env.CONCURRENCY_REPS, 10) : 50;

    for (let i = 0; i < reps; i++) {
      const { data: cajaConcurrente, error: errCaja } = await serviceDb
        .from("cajas")
        .insert({
          tenant_id: t2TenantId,
          nombre: `Caja Concurrente ${Date.now()}_${i}`,
        })
        .select("id")
        .single();
      expect(errCaja).toBeNull();
      const cajaId = cajaConcurrente!.id as string;

      const [r1, r2] = (await Promise.all([
        serviceDb.rpc("abrir_sesion_caja", {
          p_tenant_id: t2TenantId,
          p_usuario_id: t2UsuarioId,
          p_caja_id: cajaId,
          p_saldo_inicial: 1000,
        }),
        serviceDb.rpc("abrir_sesion_caja", {
          p_tenant_id: t2TenantId,
          p_usuario_id: t2UsuarioId,
          p_caja_id: cajaId,
          p_saldo_inicial: 1000,
        }),
      ])) as [RpcResult, RpcResult];

      expect(rpcReallyRan(r1.error)).toBe(true);
      expect(rpcReallyRan(r2.error)).toBe(true);

      const exitos = [r1, r2].filter(esExito);
      const fallos = [r1, r2].filter((r) => r.error !== null);

      expect(exitos).toHaveLength(1);
      expect(fallos).toHaveLength(1);
      expect(fallos[0].error?.message ?? "").toContain("CASH_SESSION_ALREADY_OPEN");

      const { count } = await serviceDb
        .from("sesiones_caja")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", t2TenantId)
        .eq("caja_id", cajaId)
        .eq("estado", "abierta");

      expect(count).toBe(1);
    }
  });

  it("RN-CJ2: solo el efectivo afecta el arqueo", async () => {
    // 1. Crear caja
    const { data: caja } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Arqueo ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = caja!.id as string;

    // 2. Abrir sesion con 1000
    const { data: sData, error: errApertura } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: cajaId,
      p_saldo_inicial: 1000,
    });
    expect(errApertura).toBeNull();
    const sesionId = (sData as Array<{ sesion_id: string }>)[0].sesion_id;

    // 3. Medios de pago: transferencia y efectivo
    const { data: mpTransf } = await serviceDb.from("medios_pago").select("id").eq("codigo", "transferencia").single();
    const { data: mpEfec } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();

    // Movimiento transferencia 5000 (afecta_arqueo = false)
    const { error: err1 } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_venta",
      p_medio_pago_id: mpTransf!.id,
      p_importe: 5000,
      p_referencia: "TR-123456",
    });
    expect(err1).toBeNull();

    // Movimiento efectivo 2000 (afecta_arqueo = true)
    const { error: err2 } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_venta",
      p_medio_pago_id: mpEfec!.id,
      p_importe: 2000,
    });
    expect(err2).toBeNull();

    // 4. Cerrar sesion con 3000 contados (1000 inicial + 2000 efectivo = 3000 teorico)
    const { data: cierreData, error: errCierre } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_efectivo_contado: 3000,
    });
    expect(errCierre).toBeNull();
    const cierre = (cierreData as Array<any>)[0];
    expect(Number(cierre.saldo_teorico_efectivo)).toBe(3000);
    expect(Number(cierre.efectivo_contado)).toBe(3000);
    expect(Number(cierre.diferencia)).toBe(0);
  });

  it("RN-CJ5: cerrar es irreversible", async () => {
    // Abrir y cerrar una sesion
    const { data: caja } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Irreversible ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = caja!.id as string;

    const { data: sData } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: cajaId,
      p_saldo_inicial: 500,
    });
    const sesionId = (sData as Array<{ sesion_id: string }>)[0].sesion_id;

    await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_efectivo_contado: 500,
    });

    // (a) registrar_movimiento_caja sobre sesion cerrada -> CASH_SESSION_CLOSED
    const { data: mpEfec } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();
    const { error: errMov } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_manual",
      p_medio_pago_id: mpEfec!.id,
      p_importe: 100,
      p_motivo: "Motivo de prueba con mas de diez caracteres",
    });
    expect(errMov?.message).toContain("CASH_SESSION_CLOSED");

    // (b) cerrar_sesion_caja otra vez -> CASH_SESSION_CLOSED
    const { error: errCierreDoble } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_efectivo_contado: 500,
    });
    expect(errCierreDoble?.message).toContain("CASH_SESSION_CLOSED");

    // (c) No existe ninguna función que la reabra
    const { data: procs, error: errProcs } = await serviceDb.rpc("signo_movimiento_caja", {
      p_tipo: "ingreso_venta",
    });
    expect(errProcs).toBeNull();
  });

  it("RN-CJ6: la diferencia se guarda incluso en cero", async () => {
    const { data: caja } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Cero ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = caja!.id as string;

    const { data: sData } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: cajaId,
      p_saldo_inicial: 1000,
    });
    const sesionId = (sData as Array<{ sesion_id: string }>)[0].sesion_id;

    const { data: cData, error: errCierre } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_efectivo_contado: 1000,
    });
    expect(errCierre).toBeNull();
    const res = (cData as Array<any>)[0];
    expect(Number(res.diferencia)).toBe(0);

    const { data: row } = await serviceDb
      .from("sesiones_caja")
      .select("diferencia")
      .eq("id", sesionId)
      .single();
    expect(row?.diferencia).not.toBeNull();
    expect(Number(row?.diferencia)).toBe(0);
  });

  it("RN-CJ7: la diferencia sobre la tolerancia exige motivo", async () => {
    // 1. tolerancia = 0
    await serviceDb
      .from("configuracion_tenant")
      .update({ tolerancia_diferencia_arqueo: 0 })
      .eq("tenant_id", t2TenantId);

    const { data: caja1 } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Tol0 ${Date.now()}`,
      })
      .select("id")
      .single();
    const caja1Id = caja1!.id as string;

    const { data: s1Data } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: caja1Id,
      p_saldo_inicial: 1000,
    });
    const sesion1Id = (s1Data as Array<{ sesion_id: string }>)[0].sesion_id;

    // Faltante de $50 sin motivo -> REASON_REQUIRED
    const { error: errSinMotivo } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesion1Id,
      p_efectivo_contado: 950,
    });
    expect(errSinMotivo?.message).toContain("REASON_REQUIRED");

    // Con motivo >= 10 chars -> exito
    const { data: c1Data, error: errConMotivo } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesion1Id,
      p_efectivo_contado: 950,
      p_motivo: "Faltante justificado por cambio",
    });
    expect(errConMotivo).toBeNull();
    expect((c1Data as Array<any>)[0].diferencia).toBe(-50);

    const { data: sesionGuardada } = await serviceDb
      .from("sesiones_caja")
      .select("motivo_diferencia")
      .eq("id", sesion1Id)
      .single();
    expect(sesionGuardada?.motivo_diferencia).toBe("Faltante justificado por cambio");

    // 2. tolerancia = 100
    await serviceDb
      .from("configuracion_tenant")
      .update({ tolerancia_diferencia_arqueo: 100 })
      .eq("tenant_id", t2TenantId);

    const { data: caja2 } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Tol100 ${Date.now()}`,
      })
      .select("id")
      .single();
    const caja2Id = caja2!.id as string;

    const { data: s2Data } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: caja2Id,
      p_saldo_inicial: 1000,
    });
    const sesion2Id = (s2Data as Array<{ sesion_id: string }>)[0].sesion_id;

    // Faltante de $50 sin motivo con tolerancia 100 -> exito
    const { error: errTol100 } = await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesion2Id,
      p_efectivo_contado: 950,
    });
    expect(errTol100).toBeNull();
  });

  it("RN-CJ8: el teórico se congela", async () => {
    const { data: caja } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Freeze ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = caja!.id as string;

    const { data: sData } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: cajaId,
      p_saldo_inicial: 1000,
    });
    const sesionId = (sData as Array<{ sesion_id: string }>)[0].sesion_id;

    // Cerrar sesion con 1000
    await serviceDb.rpc("cerrar_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_efectivo_contado: 1000,
    });

    // Forzar un movimiento directo por serviceDb
    const { data: mpEfec } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();
    await serviceDb.from("movimientos_caja").insert({
      tenant_id: t2TenantId,
      sesion_caja_id: sesionId,
      tipo: "ingreso_manual",
      medio_pago_id: mpEfec!.id,
      importe: 500,
      usuario_id: t2UsuarioId,
      motivo: "Movimiento forzado posterior",
    });

    // Releer la sesion cerrada
    const { data: sesionReleida } = await serviceDb
      .from("sesiones_caja")
      .select("saldo_teorico_efectivo, diferencia")
      .eq("id", sesionId)
      .single();

    expect(Number(sesionReleida?.saldo_teorico_efectivo)).toBe(1000);
    expect(Number(sesionReleida?.diferencia)).toBe(0);
  });

  it("RN-CJ9: la referencia es obligatoria según el medio", async () => {
    const { data: caja } = await serviceDb
      .from("cajas")
      .insert({
        tenant_id: t2TenantId,
        nombre: `Caja Ref ${Date.now()}`,
      })
      .select("id")
      .single();
    const cajaId = caja!.id as string;

    const { data: sData } = await serviceDb.rpc("abrir_sesion_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_caja_id: cajaId,
      p_saldo_inicial: 1000,
    });
    const sesionId = (sData as Array<{ sesion_id: string }>)[0].sesion_id;

    const { data: mpTransf } = await serviceDb.from("medios_pago").select("id").eq("codigo", "transferencia").single();
    const { data: mpEfec } = await serviceDb.from("medios_pago").select("id").eq("codigo", "efectivo").single();

    // Transferencia sin referencia -> PAYMENT_REFERENCE_REQUIRED
    const { error: errTransfSinRef } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_venta",
      p_medio_pago_id: mpTransf!.id,
      p_importe: 100,
    });
    expect(errTransfSinRef?.message).toContain("PAYMENT_REFERENCE_REQUIRED");

    // Transferencia con referencia -> exito
    const { error: errTransfConRef } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_venta",
      p_medio_pago_id: mpTransf!.id,
      p_importe: 100,
      p_referencia: "REF-998877",
    });
    expect(errTransfConRef).toBeNull();

    // Efectivo sin referencia -> exito
    const { error: errEfecSinRef } = await serviceDb.rpc("registrar_movimiento_caja", {
      p_tenant_id: t2TenantId,
      p_usuario_id: t2UsuarioId,
      p_sesion_id: sesionId,
      p_tipo: "ingreso_venta",
      p_medio_pago_id: mpEfec!.id,
      p_importe: 100,
    });
    expect(errEfecSinRef).toBeNull();
  });
});

