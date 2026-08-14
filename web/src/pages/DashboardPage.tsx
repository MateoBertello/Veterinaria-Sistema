import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  CalendarPlus,
  ClipboardList,
  FileText,
  Home,
  PawPrint,
  Shield,
  ShieldCheck,
  Syringe,
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
import { MetricaCard } from "../components/dashboard/MetricaCard.tsx";
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

const METRICA_ACCENT: Record<MetricaKey, string> = {
  clientes:           "from-orange-500 to-orange-600",
  mascotasActivas:    "from-amber-500 to-amber-600",
  turnosHoy:          "from-blue-500 to-blue-600",
  estadiasHoy:        "from-emerald-500 to-emerald-600",
  vacunasProximas30d: "from-violet-500 to-violet-600",
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
      {/* Bienvenida */}
      <header className="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 p-5 text-white shadow-lg md:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold md:text-2xl">
            {nombre ? `Bienvenido, ${nombre}` : "Bienvenido"}
          </h1>
          {user?.roleName ? (
            <Badge className="border border-white/30 bg-white/20 text-white hover:bg-white/20">
              {rolMeta.displayName || user.roleName}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-orange-50">
          Sistema de Gestión Veterinaria Leo · {formatFechaLarga(fecha)}
        </p>
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
        <Card className="border-orange-200">
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
