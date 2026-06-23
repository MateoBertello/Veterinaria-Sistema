import { Hono } from "hono";
import { errorHandler } from "./middleware/errorHandler.ts";
import { ok } from "./shared/envelope.ts";
import { authRouter } from "./modules/auth/auth.controller.ts";
import { usuariosRouter } from "./modules/usuarios/usuarios.controller.ts";
import { clientesRouter } from "./modules/clientes/clientes.controller.ts";
import { mascotasRouter } from "./modules/mascotas/mascotas.controller.ts";
import { tenantsRouter } from "./modules/admin/tenants.controller.ts";
import { modulosRouter } from "./modules/modulos/modulos.controller.ts";
import { serviciosRouter } from "./modules/servicios/servicios.controller.ts";
import { configuracionRouter } from "./modules/configuracion/configuracion.controller.ts";
import { doctoresRouter } from "./modules/doctores/doctores.controller.ts";
import {
  horariosDoctorRouter,
  horariosRouter,
} from "./modules/horarios/horarios.controller.ts";
import { auditoriaRouter } from "./modules/auditoria/auditoria.controller.ts";

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  return c.json(ok({ status: "ok", ts: new Date().toISOString() }));
});

// ─── Módulos habilitados del tenant autenticado (sidebar dinámico) ──────────
app.route("/modulos-habilitados", modulosRouter);

// ─── Módulo Auth ──────────────────────────────────────────────────────────────
app.route("/auth", authRouter);

// ─── Módulo Usuarios ──────────────────────────────────────────────────────────
app.route("/usuarios", usuariosRouter);

// ─── Módulo Clientes (Core Cliente-Mascota) ────────────────────────────────────
app.route("/clientes", clientesRouter);

// ─── Módulo Mascotas (Core Cliente-Mascota) ────────────────────────────────────
app.route("/mascotas", mascotasRouter);

// ─── Módulo Servicios (Transversal — Etapa 4) ──────────────────────────────────
app.route("/servicios", serviciosRouter);

// ─── Configuración de la Clínica (Transversal — Etapa 4) ───────────────────────
app.route("/configuracion", configuracionRouter);

// ─── Doctores + Horarios de Atención (Transversal — Etapa 4) ───────────────────
// Doctores: ABM (listar/editar) bajo manage_users.
// Horarios: franjas anidadas (/doctores/:id/horarios, /doctores/horarios/resumen)
// y operaciones planas (/horarios/:id) bajo manage_schedules. Hono permite
// registros aditivos en el mismo prefijo /doctores.
app.route("/doctores", horariosDoctorRouter);
app.route("/doctores", doctoresRouter);
app.route("/horarios", horariosRouter);

// ─── Auditoría (Transversal — Etapa 4) ────────────────────────────────────────
app.route("/auditoria", auditoriaRouter);

// ─── Consola Super Admin (fuera de tenant) ──────────────────────────────────────
// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
app.route("/admin/tenants", tenantsRouter);

export default app;
