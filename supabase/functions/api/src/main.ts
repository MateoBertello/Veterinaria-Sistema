import { Hono } from "hono";
// SONDA TEMPORAL DE LATENCIA — quitar cuando termine la medición.
import { T0, T0_WALL, contarRequest } from "./shared/boot.ts";
import { verifyJwt } from "./shared/jwt.ts";
import { getServiceDb } from "./shared/db.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { buildCors, securityHeaders } from "./middleware/security.ts";
import { ok } from "./shared/envelope.ts";
import { montarPerezoso } from "./shared/lazyRoute.ts";

// ─── Carga perezosa de los controllers ───────────────────────────────────────
// El isolate no sobrevive al request (lo confirma la sonda de abajo), así que el
// grafo de imports se evalúa entero en cada request. Importar los 28 controllers
// arriba costaba construir services y schemas de TODOS los módulos para atender
// una sola ruta. Cada `montarPerezoso` difiere ese trabajo al request que de
// verdad usa el módulo.
//
// Lo que sigue eager es lo que todo request necesita igual: el router raíz, el
// error handler, CORS y los security headers.

// ─── Sonda de latencia (condicionada a ENABLE_LATENCY_PROBE) ────────────────
// Por defecto inactiva (false) en producción para costo cero y no exponer
// métricas internas de infraestructura a clientes públicos sin autenticación.
// Se activa seteando la variable de entorno ENABLE_LATENCY_PROBE="true" en Supabase.
export const SONDA_ACTIVA =
  (typeof process !== "undefined" && process.env?.["ENABLE_LATENCY_PROBE"] === "true") ||
  (globalThis as Record<string, unknown>)?.["ENABLE_LATENCY_PROBE"] === "true";

// SONDA: instante en que terminó de evaluarse el grafo de imports.
// GRAPH_READY - T0 = costo de arranque del router.
export const GRAPH_READY = performance.now();

const app = new Hono().basePath("/api/v1");

app.onError(errorHandler);

// ─── Seguridad transversal (Etapa 9 / S7) ──────────────────────────────────
// CORS con allowlist explícita + security headers en TODA respuesta. Se registran
// antes de los routers: el preflight OPTIONS lo resuelve buildCors() sin llegar al
// tenantContext de cada módulo.
// SONDA: primer borde del recorrido dentro del isolate (solo si la sonda está activa).
app.use("*", async (c, next) => {
  if (SONDA_ACTIVA) {
    c.set("tReqIn", performance.now());
  }
  await next();
});

app.use("*", buildCors());
app.use("*", securityHeaders);

// ─── Endpoint público de salud ─────────────────────────────────────────────
app.get("/health", (c) => {
  // Cuando la sonda está inactiva (por defecto): respuesta estándar sin métricas internas
  if (!SONDA_ACTIVA) {
    return c.json(ok({ status: "ok" }));
  }

  // Sonda activa (ENABLE_LATENCY_PROBE=true)
  const tHandlerIn = performance.now();
  const seq        = contarRequest();
  const tReqIn     = (c.get("tReqIn") as number | undefined) ?? tHandlerIn;

  const cuerpo = {
    status: "ok",
    ts: new Date().toISOString(),
    sonda: {
      // Arranque: se paga una vez por isolate, o en cada request si el isolate es nuevo.
      // Con carga perezosa esto ya NO incluye los controllers: mide el router pelado.
      graphBootMs:  +(GRAPH_READY - T0).toFixed(2),
      // Antigüedad del isolate al llegar este request. ~0 => isolate recién creado.
      isolateAgeMs: +(tHandlerIn - T0).toFixed(2),
      // Requests servidos por ESTE isolate. Siempre 1 => isolate nuevo por request.
      requestSeq:   seq,
      // Recorrido dentro del isolate.
      middlewareMs: +(tHandlerIn - tReqIn).toFixed(3),
      handlerMs:    +(performance.now() - tHandlerIn).toFixed(3),
      bootWall:     new Date(T0_WALL).toISOString(),
      // Módulos que este request llegó a evaluar. Con carga perezosa, /health no
      // evalúa ninguno; un endpoint de negocio evalúa el suyo y nada más.
      modulosCargados: modulosCargados(),
    },
  };

  const res = c.json(ok(cuerpo));
  // handlerMs va por header: se calcula después de serializar el cuerpo.
  res.headers.set("Server-Timing",
    `handler;dur=${(performance.now() - tHandlerIn).toFixed(3)}, ` +
    `mw;dur=${(tHandlerIn - tReqIn).toFixed(3)}, ` +
    `boot;dur=${(GRAPH_READY - T0).toFixed(2)}, ` +
    `isolate;dur=${(tHandlerIn - T0).toFixed(2)}, ` +
    `modulos;desc="${modulosCargados()}"`);
  return res;
});

// ─── SONDA: capas 2 y 3 (solo disponibles si ENABLE_LATENCY_PROBE=true) ──────
// Capa 2: JWT sin base. Aísla el costo de verificar la firma (y de resolver el
// JWKS, que se cachea en memoria del isolate: si el isolate es nuevo por
// request, ese caché nunca pega y hay un fetch de red escondido acá).
app.get("/health/jwt", async (c) => {
  if (!SONDA_ACTIVA) {
    return c.notFound();
  }

  const tIn    = performance.now();
  const seq    = contarRequest();
  const tReqIn = c.get("tReqIn") ?? tIn;

  const auth = c.req.header("Authorization") ?? "";
  const tokenPresente = auth.startsWith("Bearer ");

  let verifyMs = -1;
  let resultado = "sin-token";
  if (tokenPresente) {
    const t = performance.now();
    try {
      await verifyJwt(auth.slice("Bearer ".length));
      resultado = "firma-ok";
    } catch {
      resultado = "firma-rechazada";
    }
    verifyMs = +(performance.now() - t).toFixed(3);
  }

  return c.json(ok({
    capa: "2-jwt-sin-base",
    resultado,
    sonda: {
      graphBootMs:  +(GRAPH_READY - T0).toFixed(2),
      isolateAgeMs: +(tIn - T0).toFixed(2),
      requestSeq:   seq,
      middlewareMs: +(tIn - tReqIn).toFixed(3),
      verifyJwtMs:  verifyMs,
      totalHandlerMs: +(performance.now() - tIn).toFixed(3),
    },
  }));
});

// Capa 3: una sola consulta a la base, la misma que hace GET /configuracion.
// Sin tenantContext: el tenant se pasa por query solo para la sonda y NUNCA se
// usa para devolver datos — se devuelven tiempos, no filas.
app.get("/health/db", async (c) => {
  if (!SONDA_ACTIVA) {
    return c.notFound();
  }

  const tIn    = performance.now();
  const seq    = contarRequest();
  const tReqIn = c.get("tReqIn") ?? tIn;

  let clientMs = -1;
  let queryMs  = -1;
  let filas    = -1;
  let fallo    = "";
  try {
    const tCli = performance.now();
    const db = getServiceDb();
    clientMs = +(performance.now() - tCli).toFixed(3);

    const tQ = performance.now();
    const { data, error } = await db
      .from("configuracion_tenant")
      .select("tenant_id")
      .limit(1);
    queryMs = +(performance.now() - tQ).toFixed(3);
    filas = error ? -1 : (data?.length ?? 0);
    if (error) fallo = error.message;
  } catch (e) {
    // La sonda nunca devuelve 500: sin env la medición igual tiene que reportar.
    fallo = e instanceof Error ? e.message : String(e);
  }

  return c.json(ok({
    capa: "3-una-consulta",
    filas,
    fallo,
    sonda: {
      graphBootMs:    +(GRAPH_READY - T0).toFixed(2),
      isolateAgeMs:   +(tIn - T0).toFixed(2),
      requestSeq:     seq,
      middlewareMs:   +(tIn - tReqIn).toFixed(3),
      createClientMs: clientMs,
      queryMs,
      totalHandlerMs: +(performance.now() - tIn).toFixed(3),
    },
  }));
});

// ─── SONDA: qué módulos evaluó este request (solo si está activa) ────────────
const cargados = new Set<string>();
function modulosCargados(): string {
  return [...cargados].join(",") || "ninguno";
}
function marcar<T>(nombre: string, mod: T): T {
  if (SONDA_ACTIVA) {
    cargados.add(nombre);
  }
  return mod;
}

// ─── Módulos habilitados del tenant autenticado (sidebar dinámico) ──────────
montarPerezoso(app, "/modulos-habilitados", async () =>
  [(marcar("modulos", await import("./modules/modulos/modulos.controller.ts"))).modulosRouter]);

// ─── Dashboard (métricas agregadas del tenant — Etapa 12A) ───────────────────
// Sin requirePermission ni requireModule: el gate es por métrica, dentro del
// Service (ver dashboard.controller.ts).
montarPerezoso(app, "/dashboard", async () =>
  [(marcar("dashboard", await import("./modules/dashboard/dashboard.controller.ts"))).dashboardRouter]);

// ─── Módulo Auth ──────────────────────────────────────────────────────────────
montarPerezoso(app, "/auth", async () =>
  [(marcar("auth", await import("./modules/auth/auth.controller.ts"))).authRouter]);

// ─── Módulo Usuarios ──────────────────────────────────────────────────────────
montarPerezoso(app, "/usuarios", async () =>
  [(marcar("usuarios", await import("./modules/usuarios/usuarios.controller.ts"))).usuariosRouter]);

// ─── Módulo Clientes (Core Cliente-Mascota) ────────────────────────────────────
montarPerezoso(app, "/clientes", async () =>
  [(marcar("clientes", await import("./modules/clientes/clientes.controller.ts"))).clientesRouter]);

// ─── Módulo Mascotas (Core Cliente-Mascota) ────────────────────────────────────
// Tres routers aditivos en el mismo prefijo, en el orden histórico: el ABM de
// mascotas, el historial anidado (/:petId/historial, /:petId/resumen-clinico) y
// el plan de vacunación anidado (/:petId/plan-vacunacion).
montarPerezoso(app, "/mascotas", async () => {
  const [mascotas, historial, vacunacion] = await Promise.all([
    import("./modules/mascotas/mascotas.controller.ts"),
    import("./modules/historial/historial.controller.ts"),
    import("./modules/vacunacion/vacunacion.controller.ts"),
  ]);
  marcar("mascotas", 0); marcar("historial", 0); marcar("vacunacion", 0);
  return [
    mascotas.mascotasRouter,
    historial.historialMascotaRouter,
    vacunacion.planVacunacionMascotaRouter,
  ];
});

// ─── Módulo Servicios (Transversal — Etapa 4) ──────────────────────────────────
montarPerezoso(app, "/servicios", async () =>
  [(marcar("servicios", await import("./modules/servicios/servicios.controller.ts"))).serviciosRouter]);

// ─── Configuración de la Clínica (Transversal — Etapa 4) ───────────────────────
montarPerezoso(app, "/configuracion", async () =>
  [(marcar("configuracion", await import("./modules/configuracion/configuracion.controller.ts"))).configuracionRouter]);

// ─── Catálogos clínicos del tenant (Core transversal) ──────────────────────────
// Cada clínica administra los suyos. Rutas del tenant, NO bajo /admin: dejaron
// de ser globales en 20260827000001_catalogos_por_tenant.sql. La LECTURA para
// los combos sigue yendo por PostgREST directo (excepción del CLAUDE.md); acá
// vive todo lo que ESCRIBE, que es auditable y pasa por Controller → Service.
const catalogos = () => marcar("catalogos", import("./modules/catalogos/catalogos.controller.ts"));
montarPerezoso(app, "/especies",     async () => [(await catalogos()).especiesRouter]);
montarPerezoso(app, "/razas",        async () => [(await catalogos()).razasRouter]);
montarPerezoso(app, "/tipos-vacuna", async () => [(await catalogos()).tiposVacunaRouter]);

// ─── Catálogo comercial (módulo vendible stock — Etapa C1) ─────────────────────
const productos = () => marcar("productos", import("./modules/productos/productos.controller.ts"));
montarPerezoso(app, "/productos",             async () => [(await productos()).productosRouter]);
montarPerezoso(app, "/familias-producto",     async () => [(await productos()).familiasRouter]);
montarPerezoso(app, "/producto-conversiones", async () => [(await productos()).conversionesRouter]);
montarPerezoso(app, "/proveedores", async () =>
  [(marcar("proveedores", await import("./modules/proveedores/proveedores.controller.ts"))).proveedoresRouter]);

// ─── Stock y Compras (módulo vendible stock — Etapa C2) ────────────────────────
const stock = () => marcar("stock", import("./modules/stock/stock.controller.ts"));
// /lotes monta dos routers aditivos: el de stock y el de ajustes
// (/:id/bloquear y /:id/desbloquear).
montarPerezoso(app, "/lotes", async () => {
  const [s, a] = await Promise.all([
    stock(),
    marcar("ajustes", import("./modules/ajustes/ajustes.controller.ts")),
  ]);
  return [s.lotesRouter, a.lotesAjustesRouter];
});
montarPerezoso(app, "/movimientos-stock", async () => [(await stock()).movimientosRouter]);
montarPerezoso(app, "/existencias",       async () => [(await stock()).existenciasRouter]);
montarPerezoso(app, "/compras", async () =>
  [(marcar("compras", await import("./modules/compras/compras.controller.ts"))).comprasRouter]);

// ─── Caja (módulo vendible ventas — Etapa C3) ─────────────────────────────────
montarPerezoso(app, "/caja", async () =>
  [(marcar("caja", await import("./modules/caja/caja.controller.ts"))).cajaRouter]);

// ─── Ventas (módulo vendible ventas — Etapa C4) ───────────────────────────────
montarPerezoso(app, "/ventas", async () =>
  [(marcar("ventas", await import("./modules/ventas/ventas.controller.ts"))).ventasRouter]);

// ─── Ajustes, Recuentos y Devoluciones (módulos stock / ventas — Etapa C5) ─────
const ajustes = () => marcar("ajustes", import("./modules/ajustes/ajustes.controller.ts"));
montarPerezoso(app, "/ajustes",      async () => [(await ajustes()).ajustesRouter]);
montarPerezoso(app, "/recuentos",    async () => [(await ajustes()).recuentosRouter]);
montarPerezoso(app, "/devoluciones", async () => [(await ajustes()).devolucionesRouter]);

// ─── Fraccionamiento (módulo stock — Etapa C6) ─────────────────────────────────
montarPerezoso(app, "/fraccionamiento", async () =>
  [(marcar("fraccionamiento", await import("./modules/fraccionamiento/fraccionamiento.controller.ts"))).fraccionamientoRouter]);

// ─── Consumo clínico (módulo vendible stock — Etapa C7) ───────────────────────
montarPerezoso(app, "/consumos", async () =>
  [(marcar("consumo", await import("./modules/consumo/consumo.controller.ts"))).consumoRouter]);

// ─── Reportes comerciales (módulos stock / ventas — Etapa C8) ────────────────
montarPerezoso(app, "/reportes", async () =>
  [(marcar("reportes", await import("./modules/reportes/reportes.controller.ts"))).reportesRouter]);

// ─── Doctores + Horarios de Atención (Transversal — Etapa 4) ───────────────────
// Doctores: ABM (listar/editar) bajo manage_users.
// Horarios: franjas anidadas (/doctores/:id/horarios, /doctores/horarios/resumen)
// y operaciones planas (/horarios/:id) bajo manage_schedules. El router de
// horarios va PRIMERO, como en el montaje aditivo original.
const horarios = () => marcar("horarios", import("./modules/horarios/horarios.controller.ts"));
montarPerezoso(app, "/doctores", async () => {
  const [h, d] = await Promise.all([
    horarios(),
    marcar("doctores", import("./modules/doctores/doctores.controller.ts")),
  ]);
  return [h.horariosDoctorRouter, d.doctoresRouter];
});
montarPerezoso(app, "/horarios", async () => [(await horarios()).horariosRouter]);

// ─── Auditoría (Transversal — Etapa 4) ────────────────────────────────────────
montarPerezoso(app, "/auditoria", async () =>
  [(marcar("auditoria", await import("./modules/auditoria/auditoria.controller.ts"))).auditoriaRouter]);

// ─── Historial Clínico (módulo vendible — Etapa 5) ───────────────────────────
const historial = () => marcar("historial", import("./modules/historial/historial.controller.ts"));
montarPerezoso(app, "/historial", async () => [(await historial()).historialRouter]);
montarPerezoso(app, "/adjuntos",  async () => [(await historial()).adjuntosRouter]);

// ─── Turnos (módulo vendible — Etapa 6) ──────────────────────────────────────
// Notificaciones se registra primero: su prefijo /turnos/notificaciones es más
// específico que el /turnos/:id de la agenda. Si no matchea ahí, montarPerezoso
// devuelve el control y sigue buscando en /turnos.
montarPerezoso(app, "/turnos/notificaciones", async () =>
  [(marcar("notificaciones", await import("./modules/notificaciones/notificaciones.controller.ts"))).notificacionesRouter]);
montarPerezoso(app, "/turnos", async () =>
  [(marcar("turnos", await import("./modules/turnos/turnos.controller.ts"))).turnosRouter]);

// ─── Guardería (módulo vendible — Etapa 7) ───────────────────────────────────
montarPerezoso(app, "/estadias", async () =>
  [(marcar("guarderia", await import("./modules/guarderia/guarderia.controller.ts"))).guarderiaRouter]);

// ─── Plan de Vacunación (módulo historial_clinico — Etapa 8) ─────────────────
const vacunacion = () => marcar("vacunacion", import("./modules/vacunacion/vacunacion.controller.ts"));
montarPerezoso(app, "/plan-vacunacion", async () => [(await vacunacion()).planVacunacionRouter]);
// avisosVacunacionRouter: disparo manual de avisos → /notificaciones/vacunas/procesar (RN-PV6/PV7)
montarPerezoso(app, "/notificaciones/vacunas", async () => [(await vacunacion()).avisosVacunacionRouter]);

// ─── Cron de notificaciones (sistema, fuera de tenant — Etapa 9 / RN-NT5) ────────
// Disparado por pg_cron→pg_net (no por un usuario); protegido por X-Cron-Secret.
// Barre todos los tenants activos con el módulo licenciado (turnos + vacunas).
montarPerezoso(app, "/internal/notificaciones", async () =>
  [(marcar("cron", await import("./modules/notificaciones/cron.controller.ts"))).cronNotificacionesRouter]);

// ─── Consola Super Admin (fuera de tenant) ──────────────────────────────────────
// Autenticación de plataforma: login/refresh/logout del Super Admin. Va ANTES de
// /admin/tenants por legibilidad (son prefijos distintos, el orden no decide el
// match). Es el único camino que produce un token de plataforma: el Super Admin
// no tiene fila en `usuarios`, así que /auth/login nunca pudo dárselo.
montarPerezoso(app, "/admin/auth", async () =>
  [(marcar("platformAuth", await import("./modules/admin/platformAuth.controller.ts"))).platformAuthRouter]);

// Montado en /api/v1/admin/tenants; el router NO repite el segmento /tenants.
montarPerezoso(app, "/admin/tenants", async () =>
  [(marcar("tenants", await import("./modules/admin/tenants.controller.ts"))).tenantsRouter]);

export default app;
