import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  FileText,
  Home,
  PawPrint,
  Shield,
  ShieldCheck,
  Syringe,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { MetricaCard, type MetricaAccent } from "../components/dashboard/MetricaCard.tsx";
import { TurnosHoyCard } from "../components/dashboard/TurnosHoyCard.tsx";
import { OcupacionGuarderiaCard } from "../components/dashboard/OcupacionGuarderiaCard.tsx";
import { formatFechaLarga, hoyISO } from "../components/turnos/fechas.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { obtenerResumenDashboard } from "../api/dashboard.ts";
import { fetchModulosHabilitados } from "../api/modulos.ts";
import {
  buildAccesosRapidos,
  metricasVisibles,
  type MetricaKey,
} from "../lib/dashboard.ts";
import { getRolMeta } from "../lib/roles.ts";
import { isSuperAdmin } from "../lib/platform.ts";
import { ApiError, type ModuloContratado, type ResumenDashboard } from "../types/index.ts";

// Ícono y acento de cada métrica (presentación pura; los datos vienen del resumen).
const METRICA_ICON: Record<MetricaKey, LucideIcon> = {
  clientes:           Users,
  mascotasActivas:    PawPrint,
  turnosHoy:          Calendar,
  estadiasHoy:        Home,
  vacunasProximas30d: Syringe,
};

// Acento de cada tarjeta. Es una clave semántica del sistema visual, no un
// color: MetricaCard la traduce a los tokens --metric-*. El reparto respeta la
// semántica de badges de docs/GUIA_ESTILO.md §0 (naranja = marca/clínica,
// ámbar = advertencia/seguimiento, azul = informativo, verde = ocupación
// confirmada, púrpura = categoría secundaria).
const METRICA_ACCENT: Record<MetricaKey, MetricaAccent> = {
  clientes:           "marca",
  mascotasActivas:    "ambar",
  turnosHoy:          "info",
  estadiasHoy:        "exito",
  vacunasProximas30d: "especial",
};

const ACCESO_ICON: Record<string, LucideIcon> = {
  clientes:  Users,
  mascotas:  PawPrint,
  turno:     CalendarPlus,
  estadia:   Home,
  historial: FileText,
  usuarios:  Shield,
  auditoria: ClipboardList,
  admin:     ShieldCheck,
};

/**
 * Panel de inicio (ruta "/").
 *
 * Fuente de datos: `GET /dashboard/resumen` (Etapa 12A) — UNA llamada para todas
 * las tarjetas de métrica. Los paneles de detalle (turnos del día, ocupación de
 * guardería) piden su propio listado, pero solo se montan si el resumen ya probó
 * que el usuario ve esa métrica: nunca se dispara un request que vaya a dar 403.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const [resumen, setResumen] = useState<ResumenDashboard | null>(null);
  const [modulos, setModulos] = useState<ModuloContratado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResumen(await obtenerResumenDashboard());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el panel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Módulos habilitados: gatean los accesos rápidos igual que el sidebar (RN-G2).
  // Si falla, se degradan a los accesos que no dependen de un módulo vendible.
  useEffect(() => {
    let activo = true;
    fetchModulosHabilitados()
      .then((items) => { if (activo) setModulos(items); })
      .catch(() => { if (activo) setModulos([]); });
    return () => { activo = false; };
  }, []);

  const metricas = metricasVisibles(resumen);
  const accesos  = buildAccesosRapidos(permissions, modulos, { superAdmin: isSuperAdmin() });
  const fecha    = resumen?.fecha ?? hoyISO();
  const rolMeta  = getRolMeta(user?.roleName);
  const nombre   = user?.fullName?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Bienvenida. El naranja es acento, no fondo (GUIA_ESTILO §1.1): la
          superficie es neutra (bg-card) y el naranja queda en la línea de
          acento izquierda y en el badge de rol (el único Badge con la variante
          por defecto, bg-primary). El resto del sistema — fecha, tipografía —
          es neutro, igual que cualquier card del dashboard. */}
      <header className="flex flex-col gap-3 rounded-surface border-l-4 border-l-metric-brand bg-card p-5 shadow-card md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {nombre ? `Bienvenido, ${nombre}` : "Bienvenido"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sistema de Gestión Veterinaria Leo
          </p>
        </div>

        {/* Chips: el rol y la fecha que ya mostraba el header, ahora como piezas
            propias. Mismo Badge del kit con las clases del sistema — sin
            componente nuevo y sin copy nuevo. Solo el rol lleva la variante por
            defecto (naranja de marca); la fecha es "secondary" (neutra). */}
        <ul className="flex flex-wrap gap-2">
          {user?.roleName ? (
            <li>
              <Badge className="gap-1.5 px-2.5 py-1">
                <UserRound aria-hidden />
                {rolMeta.displayName || user.roleName}
              </Badge>
            </li>
          ) : null}
          <li>
            <Badge variant="secondary" className="gap-1.5 px-2.5 py-1">
              <CalendarDays aria-hidden />
              {formatFechaLarga(fecha)}
            </Badge>
          </li>
        </ul>
      </header>

      {/* Métricas */}
      <section aria-labelledby="metricas-heading" className="space-y-3">
        <h2 id="metricas-heading" className="sr-only">Métricas de la clínica</h2>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" aria-busy="true" aria-label="Cargando métricas" />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/40">
            <CardContent className="space-y-3 py-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => void cargar()}>Reintentar</Button>
            </CardContent>
          </Card>
        ) : metricas.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Tu rol no tiene métricas asignadas en el panel. Usá el menú lateral para
              ir a las secciones habilitadas.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {metricas.map((metrica) => (
              <MetricaCard
                key={metrica.key}
                metrica={metrica}
                icon={METRICA_ICON[metrica.key]}
                accent={METRICA_ACCENT[metrica.key]}
              />
            ))}
          </div>
        )}
      </section>

      {/* Paneles de detalle: solo los que el resumen probó visibles. */}
      {!loading && !error && resumen ? (
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          {resumen.turnosHoy !== null ? <TurnosHoyCard fecha={resumen.fecha} /> : null}
          {resumen.estadiasHoy !== null ? <OcupacionGuarderiaCard fecha={resumen.fecha} /> : null}
        </div>
      ) : null}

      {/* Accesos rápidos */}
      {accesos.length > 0 ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base text-foreground md:text-lg">Accesos rápidos</CardTitle>
            <CardDescription>Las secciones habilitadas para tu rol</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <nav aria-label="Accesos rápidos">
              <ul className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
                {accesos.map((accion) => {
                  const Icon = ACCESO_ICON[accion.key] ?? FileText;
                  return (
                    <li key={accion.key}>
                      <Button asChild variant="outline" className="h-auto w-full flex-col gap-2 py-4">
                        <Link to={accion.href}>
                          <Icon className="size-5 text-orange-600 md:size-6" aria-hidden />
                          <span className="text-center text-xs md:text-sm">{accion.label}</span>
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
