import { Hono } from "hono";
import { AuthService } from "./auth.service.ts";
import {
  LoginSchema,
  RecuperarPasswordSchema,
  RecuperarUsuarioSchema,
  RefreshSchema,
  ResetPasswordSchema,
} from "./auth.schemas.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import { ok } from "../../shared/envelope.ts";
import { tenantContext, getTenantContext } from "../../middleware/tenantContext.ts";
import { CALLER_UNRESOLVED } from "../../shared/audit.ts";
import { ipDelRequest } from "../../shared/requestIp.ts";

export const authRouter = new Hono();

// ── POST /auth/login ─────────────────────────────────────────────────────────
authRouter.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LoginSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de login inválidos",
      parsed.error.issues ?? [],
    );
  }

  const result = await AuthService.login(parsed.data, ipDelRequest(c));
  return c.json(ok(result), 200);
});

// ── POST /auth/refresh ───────────────────────────────────────────────────────
// Renueva el access token con el refresh token. Público a propósito: se llama
// justamente cuando el access token ya no sirve.
authRouter.post("/refresh", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = RefreshSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos de refresh inválidos",
      parsed.error.issues ?? [],
    );
  }

  const result = await AuthService.refresh(parsed.data);
  return c.json(ok(result), 200);
});

// ── POST /auth/logout ────────────────────────────────────────────────────────
authRouter.post("/logout", tenantContext, async (c) => {
  const { userId, tenantId } = getTenantContext(c);
  const authHeader = c.req.header("Authorization") ?? "";

  // El JWT no trae nombre ni rol: los resuelve `recordAudit` por `userId`.
  await AuthService.logout({
    userId,
    tenantId,
    userName:    CALLER_UNRESOLVED,
    userRole:    CALLER_UNRESOLVED,
    accessToken: authHeader,
  });

  return c.json(ok({ message: "Sesión cerrada correctamente" }), 200);
});

// ── GET /auth/me ─────────────────────────────────────────────────────────────
authRouter.get("/me", tenantContext, async (c) => {
  const { userId, tenantId } = getTenantContext(c);
  const authHeader = c.req.header("Authorization") ?? "";

  const perfil = await AuthService.me(userId, tenantId, authHeader);
  return c.json(ok(perfil), 200);
});

// ── POST /auth/recuperar-usuario ─────────────────────────────────────────────
authRouter.post("/recuperar-usuario", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = RecuperarUsuarioSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Email inválido",
      parsed.error.issues ?? [],
    );
  }

  // Respuesta genérica independiente de si el usuario existe (RN-REC2)
  await AuthService.recuperarUsuario(parsed.data);
  return c.json(
    ok({ message: "Si existe una cuenta con ese email, recibirá su usuario en breve" }),
    200,
  );
});

// ── POST /auth/recuperar-password ────────────────────────────────────────────
authRouter.post("/recuperar-password", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = RecuperarPasswordSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Email inválido",
      parsed.error.issues ?? [],
    );
  }

  await AuthService.recuperarPassword(parsed.data);
  return c.json(
    ok({ message: "Si existe una cuenta con ese email, recibirá un enlace de recuperación" }),
    200,
  );
});

// ── POST /auth/reset-password ────────────────────────────────────────────────
authRouter.post("/reset-password", async (c) => {
  const body   = await c.req.json().catch(() => ({}));
  const parsed = ResetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    throw new DomainError(
      ErrorCode.VALIDATION_ERROR,
      422,
      "Datos inválidos",
      parsed.error.issues ?? [],
    );
  }

  await AuthService.resetPassword(parsed.data);
  return c.json(ok({ message: "Contraseña actualizada correctamente" }), 200);
});
