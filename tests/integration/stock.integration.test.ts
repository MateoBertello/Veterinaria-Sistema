import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuth } from "./_teardown.ts";

globalThis.WebSocket = class FakeWebSocket {} as any;

let serviceDb: SupabaseClient;

let tenantAId = "";
let usuarioAId = "";
let unidadId = "";
let productoAId = "";
let loteAId = "";

export async function crearFixtureStock(db: SupabaseClient, prefix: string) {
  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-1`,
    p_email_contacto: `${prefix.toLowerCase()}_stock@test.com`,
    p_plan: "basico",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = (typeof t === "string" ? t : (t as { id: string }).id);

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

  const { error: errU } = await db
    .from("usuarios")
    .insert({
      id: usuarioId,
      tenant_id: tenantId,
      username: `${prefix.toLowerCase()}_admin_${Date.now()}`,
      email: `${prefix.toLowerCase()}_${Date.now()}@test.com`,
      full_name: `${prefix} Admin`,
      rol_id: rolId,
      active: true,
    });
  if (errU) throw new Error(`Error creando usuario: ${errU?.message}`);

  // 4. Unidad medida
  const { data: un } = await db
    .from("unidades_medida")
    .select("id")
    .eq("codigo", "unidad")
    .single();
  const uId = un?.id as string;

  // 4. Producto
  const { data: p, error: errP } = await db
    .from("productos")
    .insert({
      tenant_id: tenantId,
      codigo: `${prefix}-SKU-1`,
      nombre: `${prefix} Producto Test`,
      unidad_medida_id: uId,
      alicuota_iva: 21,
      precio_venta: 1000,
      es_vendible: true,
    })
    .select("id")
    .single();
  if (errP || !p) throw new Error(`Error creando producto: ${errP?.message}`);
  const productoId = p.id as string;

  // 5. Lote
  const { data: l, error: errL } = await db
    .from("lotes")
    .insert({
      tenant_id: tenantId,
      producto_id: productoId,
      codigo_lote: `${prefix}-LOTE-1`,
      costo_unitario_neto: 500,
      costo_unitario_efectivo: 500,
      origen: "compra",
      usuario_id: usuarioId,
    })
    .select("id")
    .single();
  if (errL || !l) throw new Error(`Error creando lote: ${errL?.message}`);
  const loteId = l.id as string;

  return { tenantId, usuarioId, unidadId: uId, productoId, loteId };
}

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const fixture = await crearFixtureStock(serviceDb, "StockIntA");
  tenantAId = fixture.tenantId;
  usuarioAId = fixture.usuarioId;
  unidadId = fixture.unidadId;
  productoAId = fixture.productoId;
  loteAId = fixture.loteId;
});

afterAll(async () => {
  if (!serviceDb || !tenantAId) return;
  await serviceDb.from("movimientos_stock").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("existencias_lote").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("lotes").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("productos").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("usuarios").delete().eq("tenant_id", tenantAId);
  await serviceDb.from("tenants").delete().eq("id", tenantAId);
  if (usuarioAId) await borrarUsuarioAuth(usuarioAId);
});

describeIntegration("C2·T1 — Libro mayor, lotes y existencias_lote (Base de datos)", () => {
  it("RN-MV2: un movimiento no se puede actualizar ni borrar, tampoco con service_role", async () => {
    // 1. Insertar movimiento inicial
    const { data: mov, error: errIns } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_inicial",
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 10,
        costo_unitario: 500,
        costo_total: 5000,
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    expect(errIns).toBeNull();
    expect(mov).toBeDefined();
    const movId = mov!.id;

    // 2. Intentar UPDATE con service_role -> MOVEMENT_IMMUTABLE
    const { error: errUpd } = await serviceDb
      .from("movimientos_stock")
      .update({ cantidad: 999 })
      .eq("id", movId);

    expect(errUpd).not.toBeNull();
    expect(errUpd?.message).toContain("MOVEMENT_IMMUTABLE");

    // 3. Intentar DELETE con service_role -> MOVEMENT_IMMUTABLE
    const { error: errDel } = await serviceDb
      .from("movimientos_stock")
      .delete()
      .eq("id", movId);

    expect(errDel).not.toBeNull();
    expect(errDel?.message).toContain("MOVEMENT_IMMUTABLE");
  });

  it("RN-MV3: la cantidad es siempre positiva", async () => {
    // cantidad 0
    const { error: errZero } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 0,
      usuario_id: usuarioAId,
    });
    expect(errZero).not.toBeNull();

    // cantidad negativa
    const { error: errNeg } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: -5,
      usuario_id: usuarioAId,
    });
    expect(errNeg).not.toBeNull();
  });

  it("RN-MV4: el signo lo determina el tipo", async () => {
    // 1. entrada_compra da signo positivo (+10)
    const { data: movEntrada, error: errEntrada } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "entrada_compra",
        compra_item_id: crypto.randomUUID(),
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 10,
        usuario_id: usuarioAId,
      })
      .select("cantidad, cantidad_con_signo")
      .single();

    expect(errEntrada).toBeNull();
    expect(Number(movEntrada?.cantidad_con_signo)).toBe(10);

    // 2. salida_venta da signo negativo (-3)
    const { data: movSalida, error: errSalida } = await serviceDb
      .from("movimientos_stock")
      .insert({
        tenant_id: tenantAId,
        operacion_id: crypto.randomUUID(),
        tipo: "salida_venta",
        venta_item_id: crypto.randomUUID(),
        producto_id: productoAId,
        lote_id: loteAId,
        cantidad: 3,
        usuario_id: usuarioAId,
      })
      .select("cantidad, cantidad_con_signo")
      .single();

    expect(errSalida).toBeNull();
    expect(Number(movSalida?.cantidad_con_signo)).toBe(-3);
  });

  it("RN-MV5: la existencia nunca queda negativa", async () => {
    // Crear lote específico para probar saldo
    const { data: l2 } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: "LOTE-MV5",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    const loteId = l2!.id;

    // Ingresar 5 unidades
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 5,
      usuario_id: usuarioAId,
    });

    // Intentar salida de 8 directamente con service_role -> rechazo por CHECK (cantidad >= 0)
    const { error: errSalidaExcesiva } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 8,
      usuario_id: usuarioAId,
    });

    expect(errSalidaExcesiva).not.toBeNull();

    // Comprobar que la existencia en existencias_lote sigue en 5
    const { data: ext } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("lote_id", loteId)
      .single();

    expect(Number(ext?.cantidad)).toBe(5);
  });

  it("RN-MV8: cada tipo exige su documento y prohíbe los demás", async () => {
    // 1. salida_venta sin venta_item_id -> error
    const { error: errSinDoc } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errSinDoc).not.toBeNull();

    // 2. entrada_compra con venta_item_id Y compra_item_id (> 1 documento) -> error
    const { error: errMultiDoc } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_compra",
      compra_item_id: crypto.randomUUID(),
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errMultiDoc).not.toBeNull();

    // 3. entrada_compra con venta_item_id en vez de compra_item_id -> error
    const { error: errDocInvalido } = await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_compra",
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteAId,
      cantidad: 1,
      usuario_id: usuarioAId,
    });
    expect(errDocInvalido).not.toBeNull();
  });

  it("la caché se mantiene sola mediante trigger", async () => {
    const { data: l3 } = await serviceDb
      .from("lotes")
      .insert({
        tenant_id: tenantAId,
        producto_id: productoAId,
        codigo_lote: "LOTE-CACHE-TEST",
        costo_unitario_neto: 100,
        costo_unitario_efectivo: 100,
        origen: "compra",
        usuario_id: usuarioAId,
      })
      .select("id")
      .single();

    const loteId = l3!.id;

    // +10
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 10,
      usuario_id: usuarioAId,
    });

    // -3
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "salida_venta",
      venta_item_id: crypto.randomUUID(),
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 3,
      usuario_id: usuarioAId,
    });

    // +5
    await serviceDb.from("movimientos_stock").insert({
      tenant_id: tenantAId,
      operacion_id: crypto.randomUUID(),
      tipo: "entrada_inicial",
      producto_id: productoAId,
      lote_id: loteId,
      cantidad: 5,
      usuario_id: usuarioAId,
    });

    const { data: ext } = await serviceDb
      .from("existencias_lote")
      .select("cantidad")
      .eq("lote_id", loteId)
      .single();

    // 10 - 3 + 5 = 12
    expect(Number(ext?.cantidad)).toBe(12);
  });
});
