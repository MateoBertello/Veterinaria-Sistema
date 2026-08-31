import { Hono } from "hono";
import { PlatformAuthService } from "./platformAuth.service.ts";
import { PlatformLoginSchema, PlatformRefreshSchema } from "./platformAuth.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { ipDelRequest } from "../../shared/requestIp.ts";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.ts";

/**
 * Router de autenticación de plataforma, montado en `/api/v1/admin/auth`.
 *
 * `login` y `refresh` son públicos por definición (se llaman justo cuando no hay
 * token válido); `logout` pasa por `requireSuperAdmin` como el resto de
 * `/admin/*`, que es lo que verifica la firma del token y deja el `superAdminId`
 * en el contexto para la auditoría.
 */
export const platformAuthRouter = new Hono();

// ── POST /admin/auth/login ───────────────────────────────────────────────────
platformAuthRouter.post("/login", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = PlatformLoginSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de login inválidos",
      parsed.error.issues ?? [],
    );
  }

  const result = await PlatformAuthService.login(parsed.data, ipDelRequest(c));
  return c.json(ok(result), 200);
});

// ── POST /admin/auth/refresh ─────────────────────────────────────────────────
platformAuthRouter.post("/refresh", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = PlatformRefreshSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de refresh inválidos",
      parsed.error.issues ?? [],
    );
  }

  const result = await PlatformAuthService.refresh(parsed.data);
  return c.json(ok(result), 200);
});

// ── POST /admin/auth/logout ──────────────────────────────────────────────────
platformAuthRouter.post("/logout", requireSuperAdmin, async (c) => {
  await PlatformAuthService.logout({
    superAdminId: c.get("superAdminId"),
    email:        c.get("superAdminEmail") ?? null,
    accessToken:  c.req.header("Authorization") ?? "",
  });

  return c.json(ok({ message: "Sesión cerrada correctamente" }), 200);
});
