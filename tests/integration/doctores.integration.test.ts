/**
 * Tests de integración — UNIQUE(tenant_id, user_id) en doctores (DT-1, Etapa 9 — S4).
 *
 * Verifica que la migración `20260706000002_doctores_unique_tenant_user.sql`:
 *   1. impide duplicar el perfil profesional de un mismo usuario (23505);
 *   2. NO alcanza a los doctores sin usuario vinculado (NULLs distintos);
 *   3. soporta el UPSERT de PostgREST (`on_conflict=tenant_id,user_id` +
 *      ignoreDuplicates), que es exactamente lo que usa usuarios.service.ts
 *      (RN-SEC5) — y la razón por la que el constraint no es un índice parcial.
 *
 * Requieren un proyecto Supabase real con las migraciones aplicadas.
 * Para correr: npx vitest run tests/integration
 */

import { it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SERVICE_ROLE_KEY, describeIntegration } from "./_env.ts";

globalThis.WebSocket = class FakeWebSocket {} as never;

let serviceDb: SupabaseClient;
let tenantId  = "";
let usuarioId = "";

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  serviceDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: tenant, error } = await serviceDb
    .from("tenants")
    .insert({
      nombre:         "Clínica DT-1 Doctores",
      cuit_rut:       `30-${Date.now().toString().slice(-8)}-4`,
      email_contacto: "dt1-doctores@test.com",
      plan:           "basico",
    })
    .select("id")
    .single();
  if (error) throw new Error(`No pude crear el tenant de prueba: ${error.message}`);
  tenantId = tenant.id;
  await serviceDb.rpc("on_tenant_created", { p_tenant_id: tenantId });

  // usuarios.id es un UUID plano (sin FK a auth.users): no hace falta Auth.
  const { data: rolVet } = await serviceDb
    .from("roles").select("id").eq("tenant_id", tenantId).eq("name", "veterinario").single();
  usuarioId = crypto.randomUUID();
  const { error: userError } = await serviceDb.from("usuarios").insert({
    id: usuarioId, tenant_id: tenantId, username: "vet_dt1",
    email: "vet-dt1@test.com", full_name: "Vet DT-1", rol_id: rolVet?.id, active: true,
  });
  if (userError) throw new Error(`No pude crear el usuario de prueba: ${userError.message}`);
}, 30_000);

afterAll(async () => {
  if (!serviceDb || !tenantId) return;
  // El ON DELETE CASCADE de tenants arrastra usuarios y doctores.
  await serviceDb.from("tenants").delete().eq("id", tenantId);
});

describeIntegration("DT-1: UNIQUE(tenant_id, user_id) en doctores", () => {
  it("RN-SEC5: segundo INSERT con el mismo (tenant_id, user_id) → 23505", async () => {
    const fila = { tenant_id: tenantId, user_id: usuarioId, name: "Vet DT-1", available: true };

    const { error: first } = await serviceDb.from("doctores").insert(fila);
    expect(first).toBeNull();

    const { error: second } = await serviceDb.from("doctores").insert(fila);
    expect(second?.code).toBe("23505");
  });

  it("RN-SEC5: el UPSERT on_conflict=tenant_id,user_id no duplica ni falla (contrato de usuarios.service)", async () => {
    // Mismo call shape que UsuariosService.crear/editar. Si el constraint fuera
    // un índice parcial, PostgREST respondería "no unique or exclusion
    // constraint matching the ON CONFLICT specification".
    const { error } = await serviceDb.from("doctores").upsert(
      {
        tenant_id: tenantId,
        user_id:   usuarioId,
        name:      "Vet DT-1 renombrado",
        specialty: "Clínica general",
        available: true,
      },
      { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
    );
    expect(error).toBeNull();

    const { data: filas } = await serviceDb
      .from("doctores").select("id, name").eq("tenant_id", tenantId).eq("user_id", usuarioId);
    expect(filas).toHaveLength(1);
    // DO NOTHING: el perfil existente no se pisa.
    expect(filas?.[0]?.name).toBe("Vet DT-1");
  });

  it("doctores sin usuario vinculado (user_id NULL) conviven sin conflicto", async () => {
    const { error: a } = await serviceDb.from("doctores")
      .insert({ tenant_id: tenantId, user_id: null, name: "Externo A", available: true });
    const { error: b } = await serviceDb.from("doctores")
      .insert({ tenant_id: tenantId, user_id: null, name: "Externo B", available: true });

    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});
