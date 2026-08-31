/**
 * Tests de integración — Guardería: Registrar Estadía con guarda de cupo
 * (Etapa 7, v1.0 §5 + Addendum v1.1, RN-GU1..GU5).
 *
 * El cupo por día (RN-GU4) se resuelve en DB con el RPC `crear_estadia_con_cupo`,
 * que serializa los altas por tenant con `SELECT cupo_maximo_diario ... FOR UPDATE`
 * sobre la fila singleton de configuracion_tenant. Los tests unitarios mockean la
 * base y por tanto NUNCA ejecutan ese RPC: esta suite es la que lo ejerce DE VERDAD
 * contra el stack local (con la migración 20260629000001 aplicada), igual que la
 * suite de eutanasia con su RPC.
 *
 * Casos pactados (todos bloqueantes):
 *   1. CONCURRENCIA (el crítico): dos altas SIMULTÁNEAS (Promise.all) por el último
 *      lugar → sólo una persiste; la otra recibe CUPO_GUARDERIA_AGOTADO. Prueba que
 *      el FOR UPDATE serializa de verdad (sin él, ambas contarían 0<cupo → overbooking).
 *   2. Borde exacto: ocupados == cupo → rechaza, con los días sin cupo en `details`.
 *   3. RN-CF3: el cupo se lee VIGENTE dentro de la transacción (subir el cupo permite
 *      un alta que antes se rechazaba; sin caché).
 *   4. RLS / aislamiento: el módulo usa getServiceDb (bypasa RLS), así que el
 *      aislamiento depende del filtro EXPLÍCITO de tenant_id en cada query. B no ve
 *      ni cuenta ni crea estadías de A.
 *   + Bonus: `anon` no puede ejecutar el RPC (EXECUTE revocado de PUBLIC).
 *
 * Requieren Supabase real con TODAS las migraciones aplicadas y .env con
 * SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Para correr: npx vitest run tests/integration
 */

// Polyfill WebSocket solo en entorno de tests (NUNCA en código de funciones)
globalThis.WebSocket = class FakeWebSocket {} as never;

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import app from "../../supabase/functions/api/src/main.ts";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";
import { crearUsuarioAuth, limpiarTenant, catalogoDelTenant } from "./_teardown.ts";

function skipIfNoCredentials(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    console.warn("⚠️  Tests de integración guardería omitidos: falta configuración Supabase en .env");
    return true;
  }
  return false;
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? "";
}

async function callApp(path: string, opts: { method?: string; jwt?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  return app.request(`http://localhost/api/v1${path}`, {
    method:  opts.method ?? "GET",
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

/** Aprovisiona un tenant PREMIUM (módulo guarderia habilitado) con su admin y un cliente. */
async function provisionTenant(serviceDb: SupabaseClient, sufijo: string) {
  const { data: tenant } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         `Clínica Guardería ${sufijo}`,
      cuit_rut:       `34-${Date.now().toString().slice(-7)}${sufijo}-9`,
      email_contacto: `guarderia-${sufijo}@test.com`,
      plan:           "premium", // premium → módulo guarderia habilitado
    })
    .select("id")
    .single();
  const tenantId = tenant?.id as string;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  const email  = `admin-guarderia-${sufijo}@test.com`;
  const userId = await crearUsuarioAuth(email, { tenant_id: tenantId });
  const { data: rolAdmin } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "admin").single();
  await serviceDb.from("usuarios").insert({
    id: userId, tenant_id: tenantId, username: `admin_${sufijo}`,
    email, full_name: `Admin ${sufijo}`, rol_id: rolAdmin?.id, active: true,
  });
  const jwt = await signIn(email, "TestPass123!");

  const { data: cliente } = await serviceDb
    .from("clientes")
    .insert({ tenant_id: tenantId, full_name: `Dueño ${sufijo}`, phone: "1112223334" })
    .select("id")
    .single();

  return { tenantId, jwt, userId, clienteId: cliente?.id as string };
}

let serviceDb: SupabaseClient;
let tenantA = { tenantId: "", jwt: "", userId: "", clienteId: "" };
let tenantB = { tenantId: "", jwt: "", userId: "", clienteId: "" };

beforeAll(async () => {
  if (skipIfNoCredentials()) return;

  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  tenantA = await provisionTenant(serviceDb, "GA");
  tenantB = await provisionTenant(serviceDb, "GB");
}, 60_000);

afterAll(async () => {
  if (!serviceDb) return;
  for (const tid of [tenantA.tenantId, tenantB.tenantId]) await limpiarTenant(serviceDb, tid);
});

// ─── Helpers de datos ──────────────────────────────────────────────────────────

/** Crea una mascota Activa (tamaño Mediano) de un tenant vía API y devuelve su id. */
async function crearMascota(t: typeof tenantA, name: string): Promise<string> {
  // Catálogo por tenant (20260827000001_catalogos_por_tenant.sql): cada clínica
  // tiene su propia especie "Perro", y la de la otra la rechaza la FK compuesta.
  const { especieId } = await catalogoDelTenant(serviceDb, t.tenantId);
  const res = await callApp("/mascotas", {
    method: "POST", jwt: t.jwt,
    body: { name, clientId: t.clienteId, especieId, sex: "Macho", tamano: "Mediano" },
  });
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

async function setCupo(tenantId: string, n: number) {
  await serviceDb.from("configuracion_tenant").update({ cupo_maximo_diario: n }).eq("tenant_id", tenantId);
}

/** Cuenta las estadías activas (Reservada/EnCurso) del tenant que cubren `day`. */
async function contarActivasEnDia(tenantId: string, day: string): Promise<number> {
  const { data } = await serviceDb
    .from("estadias")
    .select("check_in_date, check_out_date")
    .eq("tenant_id", tenantId)
    .in("status", ["Reservada", "EnCurso"]);
  return ((data ?? []) as Array<{ check_in_date: string; check_out_date: string }>)
    .filter((r) => r.check_in_date <= day && day <= r.check_out_date).length;
}

/** Mismos 7 args que envía el Service, opcionales explícitos, para no depender de overloads de PostgREST. */
function estadiaRpcParams(
  tenantId: string, clientId: string, petId: string,
  checkIn: string, checkOut: string, over: Record<string, unknown> = {},
) {
  return {
    p_tenant_id: tenantId,
    p_client_id: clientId,
    p_pet_id:    petId,
    p_check_in:  checkIn,
    p_check_out: checkOut,
    p_reason:    "Estadía de integración",
    p_notes:     null,
    ...over,
  };
}

type RpcResult = { data: unknown; error: { message: string } | null };

/** Una llamada al RPC ejecutó de verdad (no fue "function not found" / cache). */
function rpcReallyRan(error: { message: string } | null): boolean {
  return !/could not find|schema cache/i.test(error?.message ?? "");
}

function esExito(r: RpcResult): boolean {
  return r.error === null && Array.isArray(r.data) && r.data.length === 1;
}

/** Crea una estadía via RPC y devuelve su id. Lanza si el RPC falla. */
async function crearEstadiaRpc(
  tenantId: string, clientId: string, petId: string,
  checkIn: string, checkOut: string,
): Promise<string> {
  const r = await serviceDb.rpc(
    "crear_estadia_con_cupo",
    estadiaRpcParams(tenantId, clientId, petId, checkIn, checkOut),
  ) as RpcResult;
  if (!esExito(r)) throw new Error(`crearEstadiaRpc falló: ${r.error?.message}`);
  return ((r.data as Array<{ id: string }>)[0]).id;
}

function modificarRpcParams(
  tenantId: string, estadiaId: string,
  checkIn: string, checkOut: string,
  reason = "Modificación de integración", notes: string | null = null,
) {
  return { p_tenant_id: tenantId, p_estadia_id: estadiaId, p_check_in: checkIn, p_check_out: checkOut, p_reason: reason, p_notes: notes };
}

function cancelarRpcParams(tenantId: string, estadiaId: string, reason = "Cancelación de integración") {
  return { p_tenant_id: tenantId, p_estadia_id: estadiaId, p_cancellation_reason: reason };
}

// ─── Caso 1: CONCURRENCIA por el último lugar (el más crítico) ──────────────────

describeIntegration("Guardería: concurrencia por el último lugar (RN-GU4, FOR UPDATE)", () => {
  it("dos altas SIMULTÁNEAS con cupo=1 → exactamente una persiste; la otra CUPO_GUARDERIA_AGOTADO", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-01-10";

    // Dos mascotas DISTINTAS (mismo pet daría STAY_OVERLAP, no CUPO) compitiendo
    // por el mismo día con un único lugar.
    const pet1 = await crearMascota(tenantA, "Concurrente1");
    const pet2 = await crearMascota(tenantA, "Concurrente2");

    // Promise.all: las dos RPC salen a la base CASI a la vez → sesiones/transacciones
    // concurrentes. El FOR UPDATE de configuracion_tenant las serializa.
    const [r1, r2] = await Promise.all([
      serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, pet1, dia, dia)),
      serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, pet2, dia, dia)),
    ]) as [RpcResult, RpcResult];

    // Ambas llamadas ejecutaron el RPC real (no falso verde por función inexistente).
    expect(rpcReallyRan(r1.error)).toBe(true);
    expect(rpcReallyRan(r2.error)).toBe(true);

    const exitos  = [r1, r2].filter(esExito);
    const fallos  = [r1, r2].filter((r) => r.error !== null);

    expect(exitos).toHaveLength(1);   // sólo una ganó el lugar
    expect(fallos).toHaveLength(1);   // la otra fue rechazada
    expect(fallos[0].error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // Garantía dura: en la base hay EXACTAMENTE una estadía activa ese día (no overbooking).
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);
  });
});

// ─── Caso 2: Borde exacto (ocupados == cupo) ────────────────────────────────────

describeIntegration("Guardería: borde exacto ocupados == cupo (RN-GU4)", () => {
  it("con cupo=2 y 2 estadías el día D, la 3.ª se rechaza con D en details", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 2);
    const dia = "2027-02-10";

    const petA = await crearMascota(tenantA, "Borde1");
    const petB = await crearMascota(tenantA, "Borde2");
    const petC = await crearMascota(tenantA, "Borde3");

    const r1 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petA, dia, dia)) as RpcResult;
    const r2 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petB, dia, dia)) as RpcResult;
    expect(esExito(r1)).toBe(true);
    expect(esExito(r2)).toBe(true);

    // ocupados (2) == cupo (2) → la 3.ª se rechaza.
    const r3 = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petC, dia, dia)) as RpcResult;
    expect(r3.error).toBeTruthy();
    expect(rpcReallyRan(r3.error)).toBe(true);

    const msg = r3.error?.message ?? "";
    expect(msg).toContain("CUPO_GUARDERIA_AGOTADO");
    // El día sin cupo viaja como JSON tras los dos puntos (lo que el Service pone en details).
    const dias = JSON.parse(msg.slice(msg.indexOf(":", msg.indexOf("CUPO_GUARDERIA_AGOTADO")) + 1)) as string[];
    expect(dias).toContain(dia);

    // No hubo overbooking: siguen siendo 2 activas ese día.
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(2);
  });
});

// ─── Caso 3: RN-CF3 — el cupo se lee VIGENTE dentro de la transacción ───────────

describeIntegration("Guardería: cupo vigente sin caché (RN-CF3)", () => {
  it("subir cupo_maximo_diario permite un alta que antes se rechazaba", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-03-10";

    const petX = await crearMascota(tenantA, "Vigente1");
    const petY = await crearMascota(tenantA, "Vigente2");

    // Con cupo=1, la primera entra y la segunda se rechaza.
    expect(esExito(await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petX, dia, dia)) as RpcResult)).toBe(true);
    const rechazo = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petY, dia, dia)) as RpcResult;
    expect(rechazo.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // Subimos el cupo: el RPC debe leer el valor NUEVO (no uno cacheado).
    await setCupo(tenantA.tenantId, 2);
    const reintento = await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petY, dia, dia)) as RpcResult;
    expect(rpcReallyRan(reintento.error)).toBe(true);
    expect(esExito(reintento)).toBe(true);

    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(2);
  });
});

// ─── Caso 4: RLS / aislamiento por tenant (filtro explícito) ────────────────────

describeIntegration("Guardería: aislamiento por tenant (bloqueante)", () => {
  it("B no puede registrar una estadía sobre una mascota de A vía API → MASCOTA_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const petDeA = await crearMascota(tenantA, "AjenaEstadia");

    const res = await callApp("/estadias", {
      method: "POST", jwt: tenantB.jwt,
      body: { clientId: tenantB.clienteId, petId: petDeA, checkInDate: "2027-04-10", checkOutDate: "2027-04-11", reason: "Intento ajeno" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("MASCOTA_NOT_FOUND");

    // No se creó nada para B.
    const { data } = await serviceDb.from("estadias").select("id").eq("tenant_id", tenantB.tenantId);
    expect((data ?? []).length).toBe(0);
  });

  it("el RPC con p_tenant_id de B sobre mascota de A no la encuentra (scoping explícito)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petDeA = await crearMascota(tenantA, "RpcCrossTenant");
    const r = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantB.tenantId, tenantB.clienteId, petDeA, "2027-04-12", "2027-04-12"),
    ) as RpcResult;
    expect(r.error).toBeTruthy();
    expect(rpcReallyRan(r.error)).toBe(true);
    expect(r.error?.message ?? "").toContain("MASCOTA_NOT_FOUND");
  });

  it("GET /estadias/cupo de B no cuenta las estadías de A (ocupación aislada)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-05-10";

    // A crea una estadía ese día.
    const petDeA = await crearMascota(tenantA, "OcupacionA");
    expect(esExito(await serviceDb.rpc("crear_estadia_con_cupo", estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia)) as RpcResult)).toBe(true);

    // B consulta el cupo de ese día: no debe ver la ocupación de A.
    const res = await callApp(`/estadias/cupo?dateFrom=${dia}&dateTo=${dia}`, { jwt: tenantB.jwt });
    const body = await res.json() as { data: Array<{ date: string; ocupados: number }> };
    expect(res.status).toBe(200);
    expect(body.data[0].ocupados).toBe(0);
  });
});

// ─── Bonus: endurecimiento de EXECUTE (REVOKE FROM PUBLIC) ──────────────────────

describeIntegration("Guardería: endurecimiento del RPC (anon no puede ejecutarlo)", () => {
  it("un cliente anon no puede invocar crear_estadia_con_cupo (EXECUTE revocado de PUBLIC)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const petId  = await crearMascota(tenantA, "AnonNoPuede");
    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

    const { error } = await anonDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petId, "2027-06-10", "2027-06-10"),
    ) as RpcResult;
    expect(error?.message ?? "").toMatch(/permission denied/i);
  });

  it("anon tampoco puede invocar modificar_estadia_con_cupo ni cancelar_estadia", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const fakeId = "00000000-0000-4000-8000-000000000001";

    const { error: errMod } = await anonDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, fakeId, "2027-06-11", "2027-06-11"),
    ) as RpcResult;
    expect(errMod?.message ?? "").toMatch(/permission denied/i);

    const { error: errCan } = await anonDb.rpc(
      "cancelar_estadia",
      cancelarRpcParams(tenantA.tenantId, fakeId),
    ) as RpcResult;
    expect(errCan?.message ?? "").toMatch(/permission denied/i);
  });
});

// ─── Modificar: revalidación de cupo (RN-ME2) ────────────────────────────────────
//
// Verifica que:
//  a) mover una estadía a un día lleno → CUPO_GUARDERIA_AGOTADO (con los días en msg).
//  b) mover a un día con lugar → OK; el día viejo libera su slot y el nuevo lo toma.
//  El RPC excluye la estadía actual del conteo para no auto-bloquearse (key diff vs crear).

describeIntegration("Guardería: modificar — revalidación de cupo (RN-ME2)", () => {
  it("mover a día lleno → CUPO_GUARDERIA_AGOTADO; luego mover a día libre → OK y cupo correcto en ambos días", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);

    const dLleno = "2027-07-10";
    const dLibre = "2027-07-15";

    // Llena el día 10 (cupo=1).
    const petOcupa  = await crearMascota(tenantA, "ModCupoOcupa");
    await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petOcupa, dLleno, dLleno);

    // Estadía que vamos a modificar: cubre el día 15 (libre).
    const petMover = await crearMascota(tenantA, "ModCupoMover");
    const idMover  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petMover, dLibre, dLibre);

    // a) Intentar mover a dLleno → CUPO_GUARDERIA_AGOTADO.
    const rFallo = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, idMover, dLleno, dLleno),
    ) as RpcResult;
    expect(rFallo.error).toBeTruthy();
    expect(rpcReallyRan(rFallo.error)).toBe(true);
    expect(rFallo.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // La estadía NO se modificó: idMover sigue en dLibre.
    expect(await contarActivasEnDia(tenantA.tenantId, dLibre)).toBe(1);
    expect(await contarActivasEnDia(tenantA.tenantId, dLleno)).toBe(1);

    // b) Mover a un día con lugar (día 20, completamente libre).
    const dDestino = "2027-07-20";
    const rOk = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, idMover, dDestino, dDestino),
    ) as RpcResult;
    expect(rpcReallyRan(rOk.error)).toBe(true);
    expect(esExito(rOk)).toBe(true);

    // Cupo correcto tras la modificación:
    // - dLibre (15): liberado → 0 activas.
    // - dDestino (20): tomado → 1 activa.
    expect(await contarActivasEnDia(tenantA.tenantId, dLibre)).toBe(0);
    expect(await contarActivasEnDia(tenantA.tenantId, dDestino)).toBe(1);
  });
});

// ─── Cancelar: el cupo se libera (RN-ME3) ────────────────────────────────────────
//
// Prueba que al cancelar, los días de la estadía dejan de contar en el cupo, de
// forma que un alta que antes se rechazaba (por CUPO_GUARDERIA_AGOTADO) ahora entra.
// Esto valida que cancelar_estadia NO deja el lugar "fantasma" ocupado.

describeIntegration("Guardería: cancelar — libera cupo (RN-ME3)", () => {
  it("cancel → cupo liberado → una alta que antes era rechazada ahora entra", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-07-25";

    // Llenar el día.
    const petCan1 = await crearMascota(tenantA, "CancelCupo1");
    const idCan1  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petCan1, dia, dia);

    // Confirmar que el cupo está lleno: un segundo alta se rechaza.
    const petCan2 = await crearMascota(tenantA, "CancelCupo2");
    const rAntes = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petCan2, dia, dia),
    ) as RpcResult;
    expect(rAntes.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // Cancelar la primera estadía.
    const rCan = await serviceDb.rpc(
      "cancelar_estadia",
      cancelarRpcParams(tenantA.tenantId, idCan1),
    ) as RpcResult;
    expect(rpcReallyRan(rCan.error)).toBe(true);
    expect(esExito(rCan)).toBe(true);

    // El status devuelto es Cancelada y cancelled_at es un timestamp válido.
    const fila = (rCan.data as Array<{ id: string; status: string; cancelled_at: string }>)[0];
    expect(fila.status).toBe("Cancelada");
    expect(fila.cancelled_at).toBeTruthy();

    // Verificar en la base: la estadía tiene status Cancelada y cancelled_at.
    const { data: rowDb } = await serviceDb
      .from("estadias")
      .select("status, cancelled_at")
      .eq("id", idCan1)
      .single() as { data: { status: string; cancelled_at: string } | null };
    expect(rowDb?.status).toBe("Cancelada");
    expect(rowDb?.cancelled_at).toBeTruthy();

    // El cupo quedó libre: el día ya no tiene activas.
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(0);

    // La alta de petCan2 ahora pasa.
    const rDespues = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petCan2, dia, dia),
    ) as RpcResult;
    expect(rpcReallyRan(rDespues.error)).toBe(true);
    expect(esExito(rDespues)).toBe(true);
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);
  });
});

// ─── STAY_LOCKED: estados terminales y restricción EnCurso (RN-ME1) ──────────────

describeIntegration("Guardería: STAY_LOCKED — estados terminales y EnCurso (RN-ME1)", () => {
  it("Finalizada → modificar lanza STAY_LOCKED; cancelar lanza STAY_LOCKED", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-07-30";
    const petFin = await crearMascota(tenantA, "LockFinalizada");
    const idFin  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petFin, dia, dia);

    // Pasar a Finalizada vía DB directo (simula el check-out completado).
    await serviceDb.from("estadias").update({ status: "Finalizada" }).eq("id", idFin);

    const rMod = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, idFin, "2027-07-31", "2027-07-31"),
    ) as RpcResult;
    expect(rMod.error?.message ?? "").toContain("STAY_LOCKED");

    const rCan = await serviceDb.rpc(
      "cancelar_estadia",
      cancelarRpcParams(tenantA.tenantId, idFin),
    ) as RpcResult;
    expect(rCan.error?.message ?? "").toContain("STAY_LOCKED");

    // La estadía sigue siendo Finalizada (no fue alterada).
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status").eq("id", idFin).single() as { data: { status: string } | null };
    expect(rowDb?.status).toBe("Finalizada");
  });

  it("EnCurso + cambio de check_in → STAY_LOCKED; solo cambio de check_out → OK", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const checkIn  = "2027-08-01";
    const checkOut = "2027-08-03";

    const petEnCurso = await crearMascota(tenantA, "LockEnCurso");
    const idEnCurso  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petEnCurso, checkIn, checkOut);

    // Pasar a EnCurso vía DB directo.
    await serviceDb.from("estadias").update({ status: "EnCurso" }).eq("id", idEnCurso);

    // Intentar cambiar check_in → STAY_LOCKED.
    const rModCheckIn = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, idEnCurso, "2027-08-02", checkOut),
    ) as RpcResult;
    expect(rModCheckIn.error?.message ?? "").toContain("STAY_LOCKED");

    // Solo cambiar check_out → OK (check_in queda igual).
    const nuevoCheckOut = "2027-08-05";
    const rModCheckOut = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantA.tenantId, idEnCurso, checkIn, nuevoCheckOut),
    ) as RpcResult;
    expect(rpcReallyRan(rModCheckOut.error)).toBe(true);
    expect(esExito(rModCheckOut)).toBe(true);

    // Verificar que el check_out se actualizó.
    const { data: rowDb } = await serviceDb
      .from("estadias").select("check_out_date, status").eq("id", idEnCurso).single() as {
        data: { check_out_date: string; status: string } | null;
      };
    expect(rowDb?.check_out_date).toBe(nuevoCheckOut);
    expect(rowDb?.status).toBe("EnCurso");
  });
});

// ─── Check-in / Check-out — Ciclo de cupo (el crítico, RN-CK3 × RN-GU4) ─────────
//
// Prueba que Finalizada libera el cupo de verdad, cruzando con la guarda de 7a.
// Flujo: cupo=1 → crear estadía A (ocupa slot) → segunda alta rechazada →
//        check-in A (sigue ocupando: EnCurso también cuenta) → segunda alta
//        sigue rechazada → check-out A (Finalizada) → segunda alta AHORA entra.

describeIntegration("Guardería: check-out libera cupo (RN-CK3 × RN-GU4)", () => {
  it("ciclo completo: crear → check-in → cupo sigue ocupado → check-out → cupo libre → nueva alta entra", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 1);
    const dia = "2027-09-10";

    const petCkA = await crearMascota(tenantA, "CheckCupoA");
    const petCkB = await crearMascota(tenantA, "CheckCupoB");

    // (1) Crear estadía A: Reservada ocupa el cupo.
    const idA = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petCkA, dia, dia);
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);

    // (2) Segunda alta rechazada: cupo lleno con Reservada.
    const rAntes = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petCkB, dia, dia),
    ) as RpcResult;
    expect(rAntes.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // (3) Check-in de A: Reservada → EnCurso. Cupo SIGUE ocupado (EnCurso cuenta).
    const rCheckin = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id:  tenantA.tenantId,
      p_estadia_id: idA,
    }) as RpcResult;
    expect(rpcReallyRan(rCheckin.error)).toBe(true);
    expect(esExito(rCheckin)).toBe(true);

    const filaCheckin = (rCheckin.data as Array<{ id: string; status: string; checked_in_at: string }>)[0];
    expect(filaCheckin.status).toBe("EnCurso");
    expect(filaCheckin.checked_in_at).toBeTruthy();

    // Cupo sigue ocupado: B sigue sin poder entrar.
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);
    const rDurante = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petCkB, dia, dia),
    ) as RpcResult;
    expect(rDurante.error?.message ?? "").toContain("CUPO_GUARDERIA_AGOTADO");

    // (4) Check-out de A: EnCurso → Finalizada. Cupo liberado implícitamente.
    const rCheckout = await serviceDb.rpc("hacer_checkout", {
      p_tenant_id:  tenantA.tenantId,
      p_estadia_id: idA,
    }) as RpcResult;
    expect(rpcReallyRan(rCheckout.error)).toBe(true);
    expect(esExito(rCheckout)).toBe(true);

    const filaCheckout = (rCheckout.data as Array<{ id: string; status: string; checked_out_at: string }>)[0];
    expect(filaCheckout.status).toBe("Finalizada");
    expect(filaCheckout.checked_out_at).toBeTruthy();

    // Verificar en DB: checked_out_at persistido.
    const { data: rowDb } = await serviceDb
      .from("estadias")
      .select("status, checked_out_at")
      .eq("id", idA)
      .single() as { data: { status: string; checked_out_at: string } | null };
    expect(rowDb?.status).toBe("Finalizada");
    expect(rowDb?.checked_out_at).toBeTruthy();

    // Finalizada no cuenta en el cupo: contarActivas debe ser 0.
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(0);

    // (5) Segunda alta B ahora sí entra.
    const rDespues = await serviceDb.rpc(
      "crear_estadia_con_cupo",
      estadiaRpcParams(tenantA.tenantId, tenantA.clienteId, petCkB, dia, dia),
    ) as RpcResult;
    expect(rpcReallyRan(rDespues.error)).toBe(true);
    expect(esExito(rDespues)).toBe(true);
    expect(await contarActivasEnDia(tenantA.tenantId, dia)).toBe(1);
  });
});

// ─── Check-in / Check-out — Transiciones reales vía RPC (RN-CK1, CK4) ──────────

describeIntegration("Guardería: transiciones check-in y check-out (RN-CK1/CK4)", () => {
  it("hacer_checkin: Reservada → OK; EnCurso → INVALID_TRANSITION; Finalizada → INVALID_TRANSITION; Cancelada → INVALID_TRANSITION", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-09-15";

    // Reservada → check-in OK.
    const petTr1 = await crearMascota(tenantA, "TrCheckinOk");
    const idTr1  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petTr1, dia, dia);

    const rOk = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idTr1,
    }) as RpcResult;
    expect(rpcReallyRan(rOk.error)).toBe(true);
    expect(esExito(rOk)).toBe(true);
    expect((rOk.data as Array<{ status: string }>)[0].status).toBe("EnCurso");

    // EnCurso → check-in rechazado (ya está en curso).
    const rEnCurso = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idTr1,
    }) as RpcResult;
    expect(rEnCurso.error?.message ?? "").toContain("INVALID_TRANSITION");

    // Finalizada → check-in rechazado.
    const petTr2 = await crearMascota(tenantA, "TrCheckinFin");
    const idTr2  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petTr2, dia, dia);
    await serviceDb.from("estadias").update({ status: "Finalizada" }).eq("id", idTr2);

    const rFin = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idTr2,
    }) as RpcResult;
    expect(rpcReallyRan(rFin.error)).toBe(true);
    expect(rFin.error?.message ?? "").toContain("INVALID_TRANSITION");

    // Cancelada → check-in rechazado.
    const petTr3 = await crearMascota(tenantA, "TrCheckinCan");
    const idTr3  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petTr3, dia, dia);
    await serviceDb.rpc("cancelar_estadia", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idTr3, p_cancellation_reason: "Test",
    });

    const rCan = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idTr3,
    }) as RpcResult;
    expect(rpcReallyRan(rCan.error)).toBe(true);
    expect(rCan.error?.message ?? "").toContain("INVALID_TRANSITION");
  });

  it("hacer_checkout: EnCurso → OK; Reservada → INVALID_TRANSITION; Finalizada → INVALID_TRANSITION", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-09-20";

    // Reservada → checkout rechazado (no hizo check-in).
    const petCo1 = await crearMascota(tenantA, "TrCheckoutRes");
    const idCo1  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petCo1, dia, dia);

    const rRes = await serviceDb.rpc("hacer_checkout", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idCo1,
    }) as RpcResult;
    expect(rpcReallyRan(rRes.error)).toBe(true);
    expect(rRes.error?.message ?? "").toContain("INVALID_TRANSITION");

    // EnCurso → checkout OK.
    await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idCo1,
    });

    const rOk = await serviceDb.rpc("hacer_checkout", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idCo1,
    }) as RpcResult;
    expect(rpcReallyRan(rOk.error)).toBe(true);
    expect(esExito(rOk)).toBe(true);
    expect((rOk.data as Array<{ status: string }>)[0].status).toBe("Finalizada");

    // Finalizada → checkout rechazado (ya finalizada).
    const rFin = await serviceDb.rpc("hacer_checkout", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idCo1,
    }) as RpcResult;
    expect(rpcReallyRan(rFin.error)).toBe(true);
    expect(rFin.error?.message ?? "").toContain("INVALID_TRANSITION");
  });
});

// ─── Check-in / Check-out — Aislamiento de tenant (bloqueante) ───────────────────

describeIntegration("Guardería: aislamiento tenant en check-in/out (bloqueante)", () => {
  it("B no puede hacer check-in sobre estadía de A vía RPC (p_tenant_id de B → ESTADIA_NOT_FOUND)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia   = "2027-09-25";
    const petDeA = await crearMascota(tenantA, "CheckinAisladoA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    const rCheckin = await serviceDb.rpc("hacer_checkin", {
      p_tenant_id:  tenantB.tenantId,
      p_estadia_id: idDeA,
    }) as RpcResult;
    expect(rCheckin.error).toBeTruthy();
    expect(rpcReallyRan(rCheckin.error)).toBe(true);
    expect(rCheckin.error?.message ?? "").toContain("ESTADIA_NOT_FOUND");

    // La estadía de A sigue en Reservada.
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status").eq("id", idDeA).single() as {
        data: { status: string } | null;
      };
    expect(rowDb?.status).toBe("Reservada");
  });

  it("B no puede hacer check-out sobre estadía de A vía RPC (p_tenant_id de B → ESTADIA_NOT_FOUND)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia   = "2027-09-26";
    const petDeA = await crearMascota(tenantA, "CheckoutAisladoA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);
    await serviceDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: idDeA,
    });

    const rCheckout = await serviceDb.rpc("hacer_checkout", {
      p_tenant_id:  tenantB.tenantId,
      p_estadia_id: idDeA,
    }) as RpcResult;
    expect(rCheckout.error).toBeTruthy();
    expect(rpcReallyRan(rCheckout.error)).toBe(true);
    expect(rCheckout.error?.message ?? "").toContain("ESTADIA_NOT_FOUND");

    // La estadía de A sigue EnCurso (no fue alterada por B).
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status").eq("id", idDeA).single() as {
        data: { status: string } | null;
      };
    expect(rowDb?.status).toBe("EnCurso");
  });

  it("B no puede hacer check-in/out vía HTTP con JWT de B sobre estadía de A → 404 STAY_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia   = "2027-09-27";
    const petDeA = await crearMascota(tenantA, "CheckHttpAisladoA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    // check-in con JWT de B.
    const resCheckin = await callApp(`/estadias/${idDeA}/checkin`, {
      method: "PATCH", jwt: tenantB.jwt,
    });
    const bodyCheckin = await resCheckin.json() as { error: { code: string } };
    expect(resCheckin.status).toBe(404);
    expect(bodyCheckin.error.code).toBe("STAY_NOT_FOUND");

    // La estadía de A sigue Reservada (B no pudo hacer check-in).
    // Hacemos check-in legítimo con JWT de A para probar el check-out cross-tenant.
    await callApp(`/estadias/${idDeA}/checkin`, { method: "PATCH", jwt: tenantA.jwt });

    // check-out con JWT de B.
    const resCheckout = await callApp(`/estadias/${idDeA}/checkout`, {
      method: "PATCH", jwt: tenantB.jwt,
    });
    const bodyCheckout = await resCheckout.json() as { error: { code: string } };
    expect(resCheckout.status).toBe(404);
    expect(bodyCheckout.error.code).toBe("STAY_NOT_FOUND");

    // La estadía de A sigue EnCurso (B no pudo hacer check-out).
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status").eq("id", idDeA).single() as {
        data: { status: string } | null;
      };
    expect(rowDb?.status).toBe("EnCurso");
  });
});

// ─── Endurecimiento de EXECUTE para hacer_checkin/checkout (REVOKE FROM PUBLIC) ────

describeIntegration("Guardería: endurecimiento de RPCs hacer_checkin y hacer_checkout (anon no puede ejecutarlos)", () => {
  it("anon no puede invocar hacer_checkin ni hacer_checkout (EXECUTE revocado de PUBLIC)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const fakeId = "00000000-0000-4000-8000-000000000002";

    const { error: errCheckin } = await anonDb.rpc("hacer_checkin", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: fakeId,
    }) as RpcResult;
    expect(errCheckin?.message ?? "").toMatch(/permission denied/i);

    const { error: errCheckout } = await anonDb.rpc("hacer_checkout", {
      p_tenant_id: tenantA.tenantId, p_estadia_id: fakeId,
    }) as RpcResult;
    expect(errCheckout?.message ?? "").toMatch(/permission denied/i);
  });
});

// ─── Listado de ocupación GET /estadias?date= (aislamiento + solape inclusivo) ────
//
// El listado usa getServiceDb (bypasa RLS): el aislamiento lo garantiza el filtro
// EXPLÍCITO de tenant_id del Service. Además valida que el filtro de solape es
// inclusivo (una estadía Lun→Vie aparece cada uno de los 5 días).

describeIntegration("Guardería: GET /estadias?date= — aislamiento y solape (bloqueante)", () => {
  it("B no ve las estadías de A (aislamiento por tenant vía HTTP)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-10-10";

    // A crea una estadía ese día.
    const petDeA = await crearMascota(tenantA, "ListadoAisladoA");
    await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    // A la ve.
    const resA = await callApp(`/estadias?date=${dia}`, { jwt: tenantA.jwt });
    const bodyA = await resA.json() as { data: Array<{ id: string }> };
    expect(resA.status).toBe(200);
    expect(bodyA.data.length).toBeGreaterThanOrEqual(1);

    // B, para el mismo día, NO ve ninguna estadía de A.
    const resB = await callApp(`/estadias?date=${dia}`, { jwt: tenantB.jwt });
    const bodyB = await resB.json() as { data: Array<{ id: string }> };
    expect(resB.status).toBe(200);
    expect(bodyB.data.length).toBe(0);
  });

  it("solape inclusivo: una estadía Lun→Vie aparece en el listado los 5 días", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dias = ["2027-10-18", "2027-10-19", "2027-10-20", "2027-10-21", "2027-10-22"]; // lun..vie

    const petSemana = await crearMascota(tenantA, "ListadoSemana");
    const idSemana  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petSemana, dias[0], dias[4]);

    for (const dia of dias) {
      const res = await callApp(`/estadias?date=${dia}`, { jwt: tenantA.jwt });
      const body = await res.json() as { data: Array<{ id: string; petName: string }> };
      expect(res.status).toBe(200);
      const fila = body.data.find((e) => e.id === idSemana);
      expect(fila, `la estadía debe aparecer el ${dia}`).toBeTruthy();
      expect(fila?.petName).toBe("ListadoSemana");
    }

    // El día siguiente (fuera del rango) NO la incluye.
    const resFuera = await callApp(`/estadias?date=2027-10-23`, { jwt: tenantA.jwt });
    const bodyFuera = await resFuera.json() as { data: Array<{ id: string }> };
    expect(bodyFuera.data.find((e) => e.id === idSemana)).toBeUndefined();
  });

  it("excluye las Cancelada del listado del día", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia = "2027-10-28";

    const petCanc = await crearMascota(tenantA, "ListadoCancelada");
    const idCanc  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petCanc, dia, dia);
    await serviceDb.rpc("cancelar_estadia", cancelarRpcParams(tenantA.tenantId, idCanc));

    const res = await callApp(`/estadias?date=${dia}`, { jwt: tenantA.jwt });
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(res.status).toBe(200);
    expect(body.data.find((e) => e.id === idCanc)).toBeUndefined();
  });

  it("rango dateFrom/dateTo: una sola consulta trae las estadías que solapan el rango (vista mes)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    // Estadía a mitad del rango del mes.
    const petMes = await crearMascota(tenantA, "ListadoRangoMes");
    const idMes  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petMes, "2027-11-10", "2027-11-14");

    const res = await callApp(`/estadias?dateFrom=2027-11-01&dateTo=2027-11-30`, { jwt: tenantA.jwt });
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(res.status).toBe(200);
    expect(body.data.find((e) => e.id === idMes)).toBeTruthy();

    // Aislamiento: B no ve la estadía de A en el rango.
    const resB = await callApp(`/estadias?dateFrom=2027-11-01&dateTo=2027-11-30`, { jwt: tenantB.jwt });
    const bodyB = await resB.json() as { data: Array<{ id: string }> };
    expect(resB.status).toBe(200);
    expect(bodyB.data.find((e) => e.id === idMes)).toBeUndefined();

    // Un rango que no solapa (mes anterior) no la trae.
    const resFuera = await callApp(`/estadias?dateFrom=2027-10-01&dateTo=2027-10-31`, { jwt: tenantA.jwt });
    const bodyFuera = await resFuera.json() as { data: Array<{ id: string }> };
    expect(bodyFuera.data.find((e) => e.id === idMes)).toBeUndefined();
  });

  it("rechaza combinar date con dateFrom/dateTo → 422", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt) return;

    const res = await callApp(`/estadias?date=2027-11-10&dateFrom=2027-11-01&dateTo=2027-11-30`, { jwt: tenantA.jwt });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Aislamiento de tenant en modificar / cancelar (bloqueante) ──────────────────

describeIntegration("Guardería: aislamiento tenant en modificar/cancelar (bloqueante)", () => {
  it("B no puede modificar una estadía de A vía RPC (p_tenant_id de B → ESTADIA_NOT_FOUND)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia    = "2027-08-10";
    const petDeA = await crearMascota(tenantA, "AisladoModA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    // B intenta modificar la estadía de A pasando su propio tenantId.
    const rMod = await serviceDb.rpc(
      "modificar_estadia_con_cupo",
      modificarRpcParams(tenantB.tenantId, idDeA, "2027-08-11", "2027-08-11"),
    ) as RpcResult;
    expect(rMod.error).toBeTruthy();
    expect(rpcReallyRan(rMod.error)).toBe(true);
    expect(rMod.error?.message ?? "").toContain("ESTADIA_NOT_FOUND");

    // La estadía de A no fue alterada.
    const { data: rowDb } = await serviceDb
      .from("estadias").select("check_in_date").eq("id", idDeA).single() as {
        data: { check_in_date: string } | null;
      };
    expect(rowDb?.check_in_date).toBe(dia);
  });

  it("B no puede cancelar una estadía de A vía RPC (p_tenant_id de B → ESTADIA_NOT_FOUND)", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia    = "2027-08-15";
    const petDeA = await crearMascota(tenantA, "AisladoCancelA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    const rCan = await serviceDb.rpc(
      "cancelar_estadia",
      cancelarRpcParams(tenantB.tenantId, idDeA),
    ) as RpcResult;
    expect(rCan.error).toBeTruthy();
    expect(rpcReallyRan(rCan.error)).toBe(true);
    expect(rCan.error?.message ?? "").toContain("ESTADIA_NOT_FOUND");

    // La estadía de A sigue Reservada.
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status").eq("id", idDeA).single() as {
        data: { status: string } | null;
      };
    expect(rowDb?.status).toBe("Reservada");
  });

  it("B no puede modificar ni cancelar vía HTTP con JWT de B sobre estadía de A → 404 STAY_NOT_FOUND", async () => {
    if (skipIfNoCredentials() || !tenantA.jwt || !tenantB.jwt) return;

    await setCupo(tenantA.tenantId, 10);
    const dia    = "2027-08-20";
    const petDeA = await crearMascota(tenantA, "AisladoHttpA");
    const idDeA  = await crearEstadiaRpc(tenantA.tenantId, tenantA.clienteId, petDeA, dia, dia);

    // Modificar con JWT de B.
    const resMod = await callApp(`/estadias/${idDeA}`, {
      method: "PUT", jwt: tenantB.jwt,
      body: { checkInDate: "2027-08-21", checkOutDate: "2027-08-21", reason: "Intento ajeno" },
    });
    const bodyMod = await resMod.json() as { error: { code: string } };
    expect(resMod.status).toBe(404);
    expect(bodyMod.error.code).toBe("STAY_NOT_FOUND");

    // Cancelar con JWT de B.
    const resCan = await callApp(`/estadias/${idDeA}/cancelar`, {
      method: "PATCH", jwt: tenantB.jwt,
      body: { cancellationReason: "Intento ajeno" },
    });
    const bodyCan = await resCan.json() as { error: { code: string } };
    expect(resCan.status).toBe(404);
    expect(bodyCan.error.code).toBe("STAY_NOT_FOUND");

    // La estadía de A no fue tocada.
    const { data: rowDb } = await serviceDb
      .from("estadias").select("status, check_in_date").eq("id", idDeA).single() as {
        data: { status: string; check_in_date: string } | null;
      };
    expect(rowDb?.status).toBe("Reservada");
    expect(rowDb?.check_in_date).toBe(dia);
  });
});
