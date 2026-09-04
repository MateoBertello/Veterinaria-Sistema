import { describe, it, expect } from "vitest";
import { describeIntegration, SUPABASE_URL, SERVICE_ROLE_KEY } from "./_env.ts";
import { crearUsuarioAuth, borrarUsuarioAuthPorEmail, borrarUsuarioAuth, adminHeaders } from "./_teardown.ts";
import { createClient } from "@supabase/supabase-js";

describeIntegration("H3b: borrarUsuarioAuthPorEmail con más de 50 usuarios", () => {
  it("crea super@admin-test.com PRIMERO y 60 cuentas de relleno DESPUÉS, la encuentra y la borra dejando las 60 intactas", async () => {
    const fillerIds: string[] = [];
    try {
      const saId = await crearUsuarioAuth("super@admin-test.com", { platform_role: "super_admin" });
      for (let i = 1; i <= 60; i++) {
        const email = `filler_h3b_${i}_${Date.now()}@test.com`;
        const id = await crearUsuarioAuth(email);
        fillerIds.push(id);
      }

      await borrarUsuarioAuthPorEmail("super@admin-test.com");

      // Verificar que el usuario super_admin no existe más
      const checkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${saId}`, { headers: adminHeaders() });
      expect(checkRes.status).toBe(404);

      // Verificar que las 60 cuentas de relleno siguen intactas
      for (const fid of fillerIds) {
        const fillerCheck = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${fid}`, { headers: adminHeaders() });
        expect(fillerCheck.status).toBe(200);
      }
    } finally {
      for (const fid of fillerIds) {
        await borrarUsuarioAuth(fid);
      }
      await borrarUsuarioAuthPorEmail("super@admin-test.com");
    }
  }, 120_000);
});
