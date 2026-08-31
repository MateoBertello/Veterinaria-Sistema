import type { SupabaseClient } from "@supabase/supabase-js";
import { crearUsuarioAuth } from "./_teardown.ts";

export async function crearFixtureConsumo(db: SupabaseClient, prefix: string) {
  async function insert(table: string, payload: any) {
    const { data, error } = await db.from(table).insert(payload).select().single();
    if (error) throw new Error(`Insert failed in ${table}: ${JSON.stringify(error)} Payload: ${JSON.stringify(payload)}`);
    return data;
  }

  // 1. Tenant
  const { data: t, error: errT } = await db.rpc("crear_tenant", {
    p_nombre: `${prefix} Tenant Consumo`,
    p_cuit_rut: `30-${Math.floor(10000000 + Math.random() * 90000000)}-2`,
    p_email_contacto: `${prefix.toLowerCase()}_cons_${Date.now()}@test.com`,
    p_plan: "premium",
  });
  if (errT || !t) throw new Error(`Error creando tenant: ${errT?.message}`);
  const tenantId = typeof t === "string" ? t : (t as { id: string }).id;

  // 2. Roles
  const { data: roles } = await db.from("roles").select("id, name").eq("tenant_id", tenantId);
  const adminId = roles!.find((r) => r.name === "admin")!.id;
  const vetId = roles!.find((r) => r.name === "veterinario")!.id;
  const repId = roles!.find((r) => r.name === "recepcionista")!.id;

  // 3. Usuarios
  const adminAuthId = await crearUsuarioAuth(`${prefix.toLowerCase()}_admin_${Date.now()}@test.com`, { tenant_id: tenantId });
  const vetAuthId = await crearUsuarioAuth(`${prefix.toLowerCase()}_vet_${Date.now()}@test.com`, { tenant_id: tenantId });
  const repAuthId = await crearUsuarioAuth(`${prefix.toLowerCase()}_rep_${Date.now()}@test.com`, { tenant_id: tenantId });

  await db.from("usuarios").insert([
    { id: adminAuthId, tenant_id: tenantId, username: `admin_${Date.now()}`, email: `admin_${Date.now()}@test.com`, full_name: `${prefix} Admin`, rol_id: adminId, active: true },
    { id: vetAuthId, tenant_id: tenantId, username: `vet_${Date.now()}`, email: `vet_${Date.now()}@test.com`, full_name: "Vet", rol_id: vetId, active: true },
    { id: repAuthId, tenant_id: tenantId, username: `rep_${Date.now()}`, email: `rep_${Date.now()}@test.com`, full_name: "Rep", rol_id: repId, active: true },
  ]);

  // 4. Especie y Cliente -> Mascota
  let espId;
  const { data: espExistente } = await db.from("especies").select("id").eq("tenant_id", tenantId).eq("name", "Perro").maybeSingle();
  if (espExistente) espId = espExistente.id;
  else { const e = await insert("especies", { tenant_id: tenantId, name: "Perro", active: true }); espId = e.id; }
  
  let razaId;
  const { data: razaExistente } = await db.from("razas").select("id").eq("tenant_id", tenantId).eq("name", "Mestizo").eq("especie_id", espId).maybeSingle();
  if (razaExistente) razaId = razaExistente.id;
  else { const r = await insert("razas", { tenant_id: tenantId, especie_id: espId, name: "Mestizo", active: true }); razaId = r.id; }

  const cli = await insert("clientes", { tenant_id: tenantId, full_name: "Dueño Test" });
  const mascota1 = await insert("mascotas", { tenant_id: tenantId, client_id: cli.id, name: "Fido", especie_id: espId, raza_id: razaId, sex: "Macho", tamano: "Mediano" });
  const mascota2 = await insert("mascotas", { tenant_id: tenantId, client_id: cli.id, name: "Bobby", especie_id: espId, raza_id: razaId, sex: "Macho", tamano: "Mediano" });

  // 5. Productos y Unidad
  let uId;
  const { data: exU } = await db.from("unidades_medida").select("id").eq("abreviatura", "u").maybeSingle();
  if (exU) uId = exU.id;
  else { const u = await insert("unidades_medida", { nombre: "Unidad", abreviatura: "u", admite_decimales: false, escala_decimal: 0 }); uId = u.id; }

  let uDecId;
  const { data: exUDec } = await db.from("unidades_medida").select("id").eq("abreviatura", "ml").maybeSingle();
  if (exUDec) uDecId = exUDec.id;
  else { const uDec = await insert("unidades_medida", { nombre: "Mililitro", abreviatura: "ml", admite_decimales: true, escala_decimal: 1 }); uDecId = uDec.id; }

  const prodVac = await insert("productos", { tenant_id: tenantId, codigo: "V1", nombre: "Vacuna Rabia", controla_lote: true, controla_vencimiento: true, unidad_medida_id: uId, familia_id: null, costo_reposicion: 100, precio_venta: 200, alicuota_iva: 21, es_consumible_clinico: true, condicion_venta: "libre" });
  const prodReceta = await insert("productos", { tenant_id: tenantId, codigo: "P2", nombre: "Sedante Fuerte", controla_lote: true, controla_vencimiento: true, unidad_medida_id: uDecId, familia_id: null, costo_reposicion: 50, precio_venta: 100, alicuota_iva: 21, es_consumible_clinico: true, condicion_venta: "bajo_receta" });
  const prodNoCons = await insert("productos", { tenant_id: tenantId, codigo: "P3", nombre: "Collar", controla_lote: true, controla_vencimiento: true, unidad_medida_id: uId, familia_id: null, costo_reposicion: 100, precio_venta: 200, alicuota_iva: 21, es_consumible_clinico: false, condicion_venta: "libre" });

  // 6. Lotes (para Vacuna y Sedante)
  
  
  const lotesVac: any[] = [];
  for (const venc of ["2027-01-01", "2027-03-01", null]) {
    const l = await insert("lotes", { tenant_id: tenantId, producto_id: prodVac.id, codigo_lote: `L-${venc || "NULL"}`, costo_unitario_neto: 100, costo_unitario_efectivo: 100, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: venc });
    await insert("existencias_lote", { tenant_id: tenantId, lote_id: l.id, producto_id: prodVac.id, cantidad: 10 });
    lotesVac.push(l);
  }
  
  const lVencido = await insert("lotes", { tenant_id: tenantId, producto_id: prodVac.id, codigo_lote: `L-VENC`, costo_unitario_neto: 100, costo_unitario_efectivo: 100, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: "2020-01-01" });
  await insert("existencias_lote", { tenant_id: tenantId, lote_id: lVencido.id, producto_id: prodVac.id, cantidad: 10 });
  
  const lBloq = await insert("lotes", { tenant_id: tenantId, producto_id: prodVac.id, codigo_lote: `L-BLOQ`, costo_unitario_neto: 100, costo_unitario_efectivo: 100, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: "2027-12-01", estado: "bloqueado", motivo_bloqueo: "Falla de calidad" });
  await insert("existencias_lote", { tenant_id: tenantId, lote_id: lBloq.id, producto_id: prodVac.id, cantidad: 10 });

  const lSed = await insert("lotes", { tenant_id: tenantId, producto_id: prodReceta.id, codigo_lote: `L-SED`, costo_unitario_neto: 50, costo_unitario_efectivo: 50, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: "2027-12-01" });
  await insert("existencias_lote", { tenant_id: tenantId, lote_id: lSed.id, producto_id: prodReceta.id, cantidad: 10 });

  const lNoCons = await insert("lotes", { tenant_id: tenantId, producto_id: prodNoCons.id, codigo_lote: `L-COLL`, costo_unitario_neto: 100, costo_unitario_efectivo: 100, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: null });
  await insert("existencias_lote", { tenant_id: tenantId, lote_id: lNoCons.id, producto_id: prodNoCons.id, cantidad: 5 });

  const lEscaso = await insert("lotes", { tenant_id: tenantId, producto_id: prodVac.id, codigo_lote: `L-ESCASO`, costo_unitario_neto: 100, costo_unitario_efectivo: 100, origen: "inicial", usuario_id: adminAuthId, fecha_vencimiento: "2027-11-01" });
  await insert("existencias_lote", { tenant_id: tenantId, lote_id: lEscaso.id, producto_id: prodVac.id, cantidad: 2 });

  // 7. Eventos clínicos
  const evt1 = await insert("historial_clinico", { tenant_id: tenantId, pet_id: mascota1.id, professional_id: vetAuthId, client_id_at_time: cli.id, client_name_at_time: "Dueño Test", event_type: "Consulta", date: "2026-10-01", description: "Consulta normal" });
  const evt2 = await insert("historial_clinico", { tenant_id: tenantId, pet_id: mascota2.id, professional_id: vetAuthId, client_id_at_time: cli.id, client_name_at_time: "Dueño Test", event_type: "Consulta", date: "2026-10-02", description: "Otra consulta" });

  return {
    tenantId, adminAuthId, vetAuthId, repAuthId,
    mascota1, mascota2,
    prodVac, prodReceta, prodNoCons,
    lotesVac, lVencido, lBloq, lSed, lNoCons, lEscaso,
    evt1, evt2
  };
}
