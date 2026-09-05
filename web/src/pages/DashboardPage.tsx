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
      {/* Bienvenida. El degradado, sus tintas y la superficie de los chips salen
          de los tokens --brand-* (theme.css): el naranja de identidad #f97316 no
          puede ser fondo de texto blanco (2.80:1), así que la superficie arranca
          en orange-700 y todo punto del degradado da >= 4.5:1 contra el blanco.
          Los chips van sobre un velo NEGRO y no blanco por la misma razón: un
          velo blanco aclara el fondo y hunde el contraste a 3.73:1. */}
      <header className="rounded-surface bg-[image:var(--brand-gradient)] p-6 text-brand-on-gradient shadow-brand md:p-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {nombre ? `Bienvenido, ${nombre}` : "Bienvenido"}
        </h1>
        <p className="mt-2 text-sm text-brand-on-gradient-muted md:text-base">
          Sistema de Gestión Veterinaria Leo
        </p>

        {/* Chips: el rol y la fecha que ya mostraba el header, ahora como piezas
            propias. Mismo Badge del kit con las clases del sistema — sin
            componente nuevo y sin copy nuevo. */}
        <ul className="mt-4 flex flex-wrap gap-2">
          {user?.roleName ? (
            <li>
              <Badge className="gap-1.5 border-brand-chip-border bg-brand-chip-surface px-2.5 py-1 text-brand-on-gradient">
                <UserRound aria-hidden />
                {rolMeta.displayName || user.roleName}
              </Badge>
            </li>
          ) : null}
          <li>
            <Badge className="gap-1.5 border-brand-chip-border bg-brand-chip-surface px-2.5 py-1 text-brand-on-gradient">
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
        <Card className="border-orange-200 shadow-card">
          <CardHeader className="bg-gradient-to-r from-orange-50 to-transparent">
            <CardTitle className="text-base text-orange-800 md:text-lg">Accesos rápidos</CardTitle>
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
