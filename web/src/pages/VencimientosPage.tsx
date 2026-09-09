import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Calendar,
  CalendarClock,
  Clock,
  Eye,
  ExternalLink,
  Filter,
} from "lucide-react";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollContainer,
} from "../components/ui/table.tsx";
import { Button } from "../components/ui/button.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { diferenciaDias, formatFechaISO, hoyISO, sumarDias } from "../lib/fechas.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import type { Lote } from "../types/index.ts";

export function VencimientosPage() {
  // NOTA PLAN_FRONTEND_COMERCIAL.md §4.5:
  // La config del tenant (configuracion_tenant.dias_alerta_vencimiento) es la fuente
  // correcta de este umbral; la pantalla la está sustituyendo porque la API de configuración
  // pública no la expone.
  const [diasRango, setDiasRango] = useState<number>(60);
  const [productoFiltro, setProductoFiltro] = useState<string>("todos");

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hoy = hoyISO();
  const limiteSemana = sumarDias(hoy, 7);

  // Carga de lotes por vencer
  const cargarLotes = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const fechaLimite = sumarDias(hoy, diasRango);

      // NOTA PLAN_FRONTEND_COMERCIAL.md §4.3:
      // conExistencia filtra en memoria después de paginar. No usamos meta.total.
      // Recorremos páginas con limit 100 hasta que la respuesta cruda traiga menos de limit ítems.
      let lotesAcumulados: Lote[] = [];
      let page = 1;
      let hayMasPaginas = true;

      while (hayMasPaginas && lotesAcumulados.length < 2000) {
        const res = await listarLotes({
          venceAntesDe: fechaLimite,
          conExistencia: "true",
          page,
          limit: 100,
        });

        lotesAcumulados = lotesAcumulados.concat(res.items);

        // Si la respuesta cruda trajo menos que el limit, no hay más lotes
        if (res.items.length < 100) {
          hayMasPaginas = false;
        } else {
          page++;
        }
      }

      setLotes(lotesAcumulados);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar vencimientos");
    } finally {
      setCargando(false);
    }
  }, [hoy, diasRango]);

  useEffect(() => {
    void cargarLotes();
  }, [cargarLotes]);

  // Lista de productos presentes en los lotes cargados (sin fetch extra)
  const productosDisponibles = useMemo(() => {
    const mapa = new Map<string, { id: string; nombre: string; codigo: string }>();
    for (const l of lotes) {
      if (l.producto) {
        mapa.set(l.producto.id, l.producto);
      }
    }
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [lotes]);

  // Filtrado por producto
  const lotesFiltrados = useMemo(() => {
    if (productoFiltro === "todos") return lotes;
    return lotes.filter((l) => l.producto?.id === productoFiltro);
  }, [lotes, productoFiltro]);

  // Agrupamiento en 3 categorías:
  // 1. Vencidos (fechaVencimiento < hoy)
  // 2. Vencen esta semana (hoy <= fechaVencimiento <= hoy + 7 días)
  // 3. Vencen en el rango elegido (resto hasta N días)
  const { grupoVencidos, grupoSemana, grupoRango } = useMemo(() => {
    const vencidos: Array<{ lote: Lote; diasRestantes: number }> = [];
    const semana: Array<{ lote: Lote; diasRestantes: number }> = [];
    const rango: Array<{ lote: Lote; diasRestantes: number }> = [];

    for (const l of lotesFiltrados) {
      if (!l.fechaVencimiento) continue;
      const fVenc = l.fechaVencimiento.slice(0, 10);
      const diasRestantes = diferenciaDias(hoy, fVenc);

      if (fVenc < hoy) {
        vencidos.push({ lote: l, diasRestantes });
      } else if (fVenc <= limiteSemana) {
        semana.push({ lote: l, diasRestantes });
      } else {
        rango.push({ lote: l, diasRestantes });
      }
    }

    // Ordenar por fecha de vencimiento ascendente dentro de cada grupo
    const sortFn = (
      a: { lote: Lote; diasRestantes: number },
      b: { lote: Lote; diasRestantes: number },
    ) => (a.lote.fechaVencimiento ?? "").localeCompare(b.lote.fechaVencimiento ?? "");

    vencidos.sort(sortFn);
    semana.sort(sortFn);
    rango.sort(sortFn);

    return { grupoVencidos: vencidos, grupoSemana: semana, grupoRango: rango };
  }, [lotesFiltrados, hoy, limiteSemana]);

  const totalPorVencer =
    grupoVencidos.length + grupoSemana.length + grupoRango.length;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <StockBreadcrumb items={[{ label: "Vencimientos" }]} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-orange-600" />
            Vencimientos Próximos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoreo preventivo de lotes en riesgo de caducidad con existencias en inventario.
          </p>
        </div>
      </div>

      {/* Selector de rango y filtro por producto */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Ventana de alerta:</span>
            <Select
              value={String(diasRango)}
              onValueChange={(val) => setDiasRango(Number(val))}
            >
              <SelectTrigger aria-label="Rango de alerta en días" className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 días</SelectItem>
                <SelectItem value="60">60 días (default)</SelectItem>
                <SelectItem value="90">90 días</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Filtrar producto:</span>
            <Select value={productoFiltro} onValueChange={setProductoFiltro}>
              <SelectTrigger aria-label="Filtrar por producto" className="w-56 h-9">
                <SelectValue placeholder="Todos los productos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los productos</SelectItem>
                {productosDisponibles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre} ({p.codigo})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Total analizados: <span className="font-semibold text-slate-900">{totalPorVencer}</span> lotes
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Si está cargando */}
      {cargando ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-slate-200 p-6 space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ))}
        </div>
      ) : totalPorVencer === 0 ? (
        /* Estado vacío con copy propio */
        <div className="p-12 text-center bg-white rounded-lg border border-slate-200 shadow-sm space-y-3">
          <Calendar className="h-12 w-12 text-emerald-500 mx-auto" />
          <h3 className="text-lg font-semibold text-slate-900">
            No hay lotes que venzan en los próximos {diasRango} días.
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Todas las existencias cuentan con vencimientos superiores al umbral seleccionado.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ─── GRUPO 1: VENCIDOS ─── */}
          {grupoVencidos.length > 0 && (
            <Card className="border-rose-200 shadow-sm overflow-hidden bg-rose-50/20">
              <CardHeader className="bg-rose-100/70 border-b border-rose-200/80 py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="h-5 w-5 text-rose-700" />
                    <CardTitle className="text-base font-bold text-rose-950">
                      Vencidos ({grupoVencidos.length})
                    </CardTitle>
                  </div>
                  <span className="text-xs font-medium text-rose-800 bg-rose-200/70 px-2.5 py-0.5 rounded-full">
                    Atención inmediata requerida
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <TableScrollContainer aria-label="Tabla de lotes vencidos">
                  <Table>
                    <TableHeader className="bg-rose-50/50">
                      <TableRow>
                        <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                        <TableHead className="font-semibold text-slate-700">Lote</TableHead>
                        <TableHead className="font-semibold text-slate-700">Vencimiento</TableHead>
                        <TableHead className="font-semibold text-slate-700">Días restantes</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                        <TableHead className="font-semibold text-slate-700">Proveedor</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grupoVencidos.map(({ lote, diasRestantes }) => (
                        <TableRow key={lote.id} className="hover:bg-rose-50/40">
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{lote.producto?.nombre ?? "—"}</p>
                              <p className="text-xs text-muted-foreground font-mono">{lote.producto?.codigo}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900">
                            {lote.codigoLote ?? "S/L"}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-rose-800">
                            {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-xs">
                              {diasRestantes} {Math.abs(diasRestantes) === 1 ? "día" : "días"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-slate-900">
                            {lote.cantidad}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {lote.proveedor?.razonSocial ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <Button asChild variant="ghost" size="sm" className="h-8 text-xs gap-1">
                                <Link to={`/stock/lotes/${lote.id}`} title="Ver lote">
                                  <Eye className="h-3.5 w-3.5" />
                                  Ver
                                </Link>
                              </Button>
                              <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs gap-1 border-rose-300 text-rose-800 hover:bg-rose-100"
                              >
                                <Link to={`/stock/ajustes?loteId=${lote.id}`} title="Ajustar por merma">
                                  Dar de baja
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollContainer>
              </CardContent>
            </Card>
          )}

          {/* ─── GRUPO 2: VENCEN ESTA SEMANA ─── */}
          {grupoSemana.length > 0 && (
            <Card className="border-amber-200 shadow-sm overflow-hidden bg-amber-50/15">
              <CardHeader className="bg-amber-100/70 border-b border-amber-200/80 py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-700" />
                    <CardTitle className="text-base font-bold text-amber-950">
                      Vencen esta semana ({grupoSemana.length})
                    </CardTitle>
                  </div>
                  <span className="text-xs font-medium text-amber-800 bg-amber-200/70 px-2.5 py-0.5 rounded-full">
                    Dentro de los próximos 7 días
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <TableScrollContainer aria-label="Tabla de lotes que vencen esta semana">
                  <Table>
                    <TableHeader className="bg-amber-50/50">
                      <TableRow>
                        <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                        <TableHead className="font-semibold text-slate-700">Lote</TableHead>
                        <TableHead className="font-semibold text-slate-700">Vencimiento</TableHead>
                        <TableHead className="font-semibold text-slate-700">Días restantes</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                        <TableHead className="font-semibold text-slate-700">Proveedor</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grupoSemana.map(({ lote, diasRestantes }) => (
                        <TableRow key={lote.id} className="hover:bg-amber-50/40">
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{lote.producto?.nombre ?? "—"}</p>
                              <p className="text-xs text-muted-foreground font-mono">{lote.producto?.codigo}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900">
                            {lote.codigoLote ?? "S/L"}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-amber-900">
                            {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs">
                              {diasRestantes === 0 ? "Hoy" : `${diasRestantes} días`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-slate-900">
                            {lote.cantidad}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {lote.proveedor?.razonSocial ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button asChild variant="ghost" size="sm" className="h-8 text-xs gap-1">
                              <Link to={`/stock/lotes/${lote.id}`}>
                                <Eye className="h-3.5 w-3.5" />
                                Ver
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollContainer>
              </CardContent>
            </Card>
          )}

          {/* ─── GRUPO 3: VENCEN EN EL RANGO ELEGIDO ─── */}
          {grupoRango.length > 0 && (
            <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-200 py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-slate-600" />
                    <CardTitle className="text-base font-bold text-slate-900">
                      Vencen en el rango ({grupoRango.length})
                    </CardTitle>
                  </div>
                  <span className="text-xs font-medium text-slate-600 bg-slate-200/60 px-2.5 py-0.5 rounded-full">
                    Entre 8 y {diasRango} días
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <TableScrollContainer aria-label="Tabla de lotes que vencen en el rango">
                  <Table>
                    <TableHeader className="bg-slate-50/50">
                      <TableRow>
                        <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                        <TableHead className="font-semibold text-slate-700">Lote</TableHead>
                        <TableHead className="font-semibold text-slate-700">Vencimiento</TableHead>
                        <TableHead className="font-semibold text-slate-700">Días restantes</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                        <TableHead className="font-semibold text-slate-700">Proveedor</TableHead>
                        <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grupoRango.map(({ lote, diasRestantes }) => (
                        <TableRow key={lote.id} className="hover:bg-slate-50/60">
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{lote.producto?.nombre ?? "—"}</p>
                              <p className="text-xs text-muted-foreground font-mono">{lote.producto?.codigo}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium text-slate-900">
                            {lote.codigoLote ?? "S/L"}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 font-medium text-xs">
                              {diasRestantes} días
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-slate-900">
                            {lote.cantidad}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {lote.proveedor?.razonSocial ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button asChild variant="ghost" size="sm" className="h-8 text-xs gap-1">
                              <Link to={`/stock/lotes/${lote.id}`}>
                                <Eye className="h-3.5 w-3.5" />
                                Ver
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
export default VencimientosPage;
