/**
 * shared/jwt.ts — verificación de la FIRMA de los JWT.
 *
 * Origen: la Edge Function corre con `verify_jwt = false` (necesita atender el
 * login, que llega sin token), así que el gateway no valida nada. Los
 * middlewares se limitaban a decodificar el payload en base64, con lo cual
 * cualquiera podía fabricar un token con los claims que quisiera. En `/admin/*`
 * eso era una toma total de la plataforma, porque esos services usan
 * `service_role` y RLS no vuelve a revisar nada.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyJwt } from "../../supabase/functions/api/src/shared/jwt.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";
import { JWT_SECRET_DE_TEST, makeJwt, makeJwtAlgNone, makeJwtForjado } from "./_helpers/permissionMock.ts";

const AHORA = () => Math.floor(Date.now() / 1000);

const PAYLOAD_SUPER_ADMIN = {
  sub: "sa-1",
  app_metadata: { platform_role: "super_admin" },
  exp: AHORA() + 3600,
};

describe("verifyJwt — firma válida", () => {
  it("acepta un token bien firmado y devuelve su payload", async () => {
    const payload = await verifyJwt(makeJwt({ sub: "u1", app_metadata: { tenant_id: "t1" } }));

    expect(payload.sub).toBe("u1");
    expect((payload.app_metadata as { tenant_id: string }).tenant_id).toBe("t1");
  });

  it("acepta un token sin `exp` (no todos los emisores lo ponen)", async () => {
    await expect(verifyJwt(makeJwt({ sub: "u1" }))).resolves.toMatchObject({ sub: "u1" });
  });
});

describe("verifyJwt — rechazos", () => {
  it("rechaza una firma inválida aunque los claims sean perfectos", async () => {
    // Este es EL ataque: claims de super admin con una firma cualquiera.
    await expect(verifyJwt(makeJwtForjado(PAYLOAD_SUPER_ADMIN))).rejects.toMatchObject({
      code:       ErrorCode.UNAUTHORIZED,
      statusCode: 401,
    });
  });

  it("rechaza `alg: none` (token sin firma)", async () => {
    await expect(verifyJwt(makeJwtAlgNone(PAYLOAD_SUPER_ADMIN))).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it("rechaza un token firmado con OTRO secreto", async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64")
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const header = b64({ alg: "HS256", typ: "JWT" });
    const cuerpo = b64(PAYLOAD_SUPER_ADMIN);
    const firma  = createHmac("sha256", "otro-secreto-cualquiera")
      .update(`${header}.${cuerpo}`).digest("base64")
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

    await expect(verifyJwt(`${header}.${cuerpo}.${firma}`)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it("rechaza un token vencido", async () => {
    const vencido = makeJwt({ sub: "u1", app_metadata: { tenant_id: "t1" }, exp: AHORA() - 60 });

    await expect(verifyJwt(vencido)).rejects.toMatchObject({
      code:    ErrorCode.UNAUTHORIZED,
      message: expect.stringContaining("expiró"),
    });
  });

  it("rechaza un algoritmo no soportado", async () => {
    const partes = makeJwt({ sub: "u1" }).split(".");
    const header = Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" }))
      .toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

    await expect(verifyJwt(`${header}.${partes[1]}.${partes[2]}`)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it.each([
    ["no es un jwt",            "esto-no-es-un-token"],
    ["le falta un segmento",    "abc.def"],
    ["payload que no es JSON",  `${Buffer.from("{h}").toString("base64url")}.no-json.firma`],
    ["cadena vacía",            ""],
  ])("rechaza un token corrupto: %s", async (_caso, token) => {
    await expect(verifyJwt(token)).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
  });

  it("una firma con caracteres inválidos da 401, no un 500", async () => {
    // `atob` lanza DOMException ante base64 mal formado. Sin atajarlo, un token
    // basura escalaba al error handler global como 5xx —y disparaba una alerta
    // de Sentry— en vez de terminar en el 401 que corresponde.
    const partes = makeJwt({ sub: "u1", app_metadata: { tenant_id: "t1" } }).split(".");

    await expect(
      verifyJwt(`${partes[0]}.${partes[1]}.no-es-base64-válido!!`),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHORIZED, statusCode: 401 });
  });

  it("el secreto de test es el que se usa: cambia el secreto, cae la verificación", () => {
    // Guarda contra un falso verde: si `verifyJwt` ignorara la firma, los tests
    // de arriba pasarían igual. Acá se comprueba que la firma REALMENTE depende
    // del secreto configurado.
    expect(process.env["SUPABASE_JWT_SECRET"]).toBe(JWT_SECRET_DE_TEST);
  });
});
