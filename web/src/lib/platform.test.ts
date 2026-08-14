/**
 * platform.ts — lectura del claim de plataforma del JWT de sesión. Es el espejo
 * exacto de lo que exige `requireSuperAdmin` en el backend: sin el claim
 * `app_metadata.platform_role='super_admin'` no hay consola de plataforma.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  decodeJwtPayload,
  getPlatformSession,
  isSuperAdmin,
  platformSessionFromToken,
} from "./platform.ts";

/** Arma un JWT de mentira (header/payload/firma) con el payload dado. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.firma-no-verificada`;
}

const FUTURO = Math.floor(Date.now() / 1000) + 3600;
const PASADO = Math.floor(Date.now() / 1000) - 3600;

afterEach(() => {
  localStorage.clear();
});

describe("decodeJwtPayload", () => {
  it("decodifica el payload, incluidos caracteres UTF-8", () => {
    const token = makeJwt({ sub: "sa-1", nombre: "Clínica Ñandú" });
    expect(decodeJwtPayload(token)).toMatchObject({ sub: "sa-1", nombre: "Clínica Ñandú" });
  });

  it("devuelve null si el token no tiene 3 partes o no es JSON", () => {
    expect(decodeJwtPayload("no-es-un-jwt")).toBeNull();
    expect(decodeJwtPayload("a.b.c")).toBeNull();
  });
});

describe("platformSessionFromToken", () => {
  it("con platform_role=super_admin devuelve la sesión de plataforma", () => {
    const token = makeJwt({
      sub: "sa-1",
      email: "super@leo.vet",
      exp: FUTURO,
      app_metadata: { platform_role: "super_admin" },
    });

    expect(platformSessionFromToken(token)).toEqual({
      superAdminId: "sa-1",
      email: "super@leo.vet",
      expiresAt: FUTURO * 1000,
    });
  });

  it("un usuario de tenant (con tenant_id, sin platform_role) NO es super admin", () => {
    const token = makeJwt({
      sub: "u-1",
      exp: FUTURO,
      app_metadata: { tenant_id: "11111111-1111-1111-1111-111111111111" },
    });
    expect(platformSessionFromToken(token)).toBeNull();
  });

  it("un platform_role distinto de super_admin no autoriza", () => {
    const token = makeJwt({ sub: "u-1", exp: FUTURO, app_metadata: { platform_role: "soporte" } });
    expect(platformSessionFromToken(token)).toBeNull();
  });

  it("token vencido → sin sesión de plataforma (el backend lo rechazaría igual)", () => {
    const token = makeJwt({ sub: "sa-1", exp: PASADO, app_metadata: { platform_role: "super_admin" } });
    expect(platformSessionFromToken(token)).toBeNull();
  });

  it("sin token o sin sub → null", () => {
    expect(platformSessionFromToken(null)).toBeNull();
    expect(platformSessionFromToken(makeJwt({ app_metadata: { platform_role: "super_admin" } }))).toBeNull();
  });
});

describe("getPlatformSession / isSuperAdmin", () => {
  it("leen el token guardado en la sesión", () => {
    localStorage.setItem(
      "sb-token",
      makeJwt({ sub: "sa-9", exp: FUTURO, app_metadata: { platform_role: "super_admin" } }),
    );

    expect(getPlatformSession()?.superAdminId).toBe("sa-9");
    expect(isSuperAdmin()).toBe(true);
  });

  it("sin token guardado, no hay super admin", () => {
    expect(getPlatformSession()).toBeNull();
    expect(isSuperAdmin()).toBe(false);
  });
});
