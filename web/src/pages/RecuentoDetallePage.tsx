import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Save,
  Search,
  SlidersHorizontal,
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
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.tsx";
import {
  aplicarRecuento,
  guardarDetallesRecuento,
  obtenerRecuento,
} from "../api/comercial/ajustes.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import { EstadoRecuentoBadge } from "./RecuentosPage.tsx";
import { ApiError } from "../types/index.ts";
import type { ItemRecuentoInput, Lote, Recuento, RecuentoDetalle } from "../types/index.ts";

function formatFecha(fechaStr: string | null): string {
  if (!fechaStr) return "—";
  try {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return fechaStr;
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return fechaStr;
  }
}

export function RecuentoDetallePage() {
  const { id } = useParams<{ id: string }>();

  const [recuento, setRecuento] = useState<Recuento | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados de carga de planilla en borrador
  // RN §2.3: el campo "cantidad contada" arranca VACÍO (""), nunca precargado con el sistema
  const [valoresContados, setValoresContados] = useState<Record<string, string>>({});
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [busqueda, setBusqueda] = useState("");
  const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);

  // Guardado de avance
  const [guardandoAvance, setGuardandoAvance] = useState(false);
  const [mensajeExitoAvance, setMensajeExitoAvance] = useState<string | null>(null);

  // Diálogo aplicar recuento
  const [dialogAplicarOpen, setDialogAplicarOpen] = useState(false);
  const [confirmarDesvios, setConfirmarDesvios] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Carga inicial del recuento
  const cargarRecuento = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    setError(null);
    try {
      const r = await obtenerRecuento(id);
      setRecuento(r);

      // Si tiene detalles ya guardados, inicializamos los contados con ellos
      if (r.detalles && r.detalles.length > 0) {
        const contadosInit: Record<string, string> = {};
        const motivosInit: Record<string, string> = {};
        for (const det of r.detalles) {
          contadosInit[det.loteId] = String(det.cantidadContada);
          if (det.motivo) motivosInit[det.loteId] = det.motivo;
        }
        setValoresContados(contadosInit);
        setMotivos(motivosInit);
      }

      // Si está en borrador, cargar los lotes con existencia
      if (r.estado === "borrador") {
        setCargandoLotes(true);
        try {
          // NOTA PLAN_FRONTEND_COMERCIAL.md §4.3:
          // Con conExistencia, el backend filtra después de paginar. No usamos meta.total.
          // Seguimos pidiendo páginas hasta que los ítems devueltos sean menos que limit.
          let p = 1;
          const lotesCargados: Lote[] = [];
          while (true) {
            const resLotes = await listarLotes({
              conExistencia: "true",
              limit: 100,
              page: p,
            });
            lotesCargados.push(...resLotes.items);
            if (resLotes.items.length < 100) {
              break;
            }
            p++;
          }
          setLotes(lotesCargados);
        } catch (err) {
          console.error("Error al cargar lotes para la planilla", err);
        } finally {
          setCargandoLotes(false);
        }
      }
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al cargar el detalle del recuento",
      );
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargarRecuento();
  }, [cargarRecuento]);

  // Advertencia de cambios sin guardar al salir de la pestaña
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hayCambiosSinGuardar) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hayCambiosSinGuardar]);

  // Filtrado de lotes para la planilla en borrador
  const lotesFiltrados = useMemo(() => {
    if (!busqueda.trim()) return lotes;
    const term = busqueda.toLowerCase().trim();
    return lotes.filter((l) => {
      const prodNom = l.producto?.nombre?.toLowerCase() ?? "";
      const prodCod = l.producto?.codigo?.toLowerCase() ?? "";
      const loteCod = l.codigoLote?.toLowerCase() ?? "";
      return prodNom.includes(term) || prodCod.includes(term) || loteCod.includes(term);
    });
  }, [lotes, busqueda]);

  // Cálculos de desvíos e impacto
  const {
    itemsCargados,
    desviosCount,
    unidadesEntrada,
    unidadesSalida,
  } = useMemo(() => {
    let cargados = 0;
    let desvios = 0;
    let entrada = 0;
    let salida = 0;

    for (const lote of lotes) {
      const valStr = valoresContados[lote.id];
      if (valStr !== undefined && valStr !== "") {
        const valNum = Number(valStr);
        if (!isNaN(valNum)) {
          cargados++;
          const sist = Number(lote.cantidad);
          const diff = valNum - sist;
          if (diff !== 0) {
            desvios++;
            if (diff > 0) {
              entrada += diff;
            } else {
              salida += Math.abs(diff);
            }
          }
        }
      }
    }

    return {
      itemsCargados: cargados,
      desviosCount: desvios,
      unidadesEntrada: Math.round(entrada * 1000) / 1000,
      unidadesSalida: Math.round(salida * 1000) / 1000,
    };
  }, [lotes, valoresContados]);

  // Manejador para actualizar cantidad contada
  const handleContadaChange = (loteId: string, val: string) => {
    setValoresContados((prev) => ({ ...prev, [loteId]: val }));
    setHayCambiosSinGuardar(true);
    setMensajeExitoAvance(null);
  };

  // Manejador para actualizar motivo
  const handleMotivoChange = (loteId: string, val: string) => {
    setMotivos((prev) => ({ ...prev, [loteId]: val }));
    setHayCambiosSinGuardar(true);
    setMensajeExitoAvance(null);
  };

  // Guardar avance (PUT /recuentos/:id/detalles con todos los ítems cargados hasta el momento)
  const handleGuardarAvance = async () => {
    if (!id || itemsCargados === 0) return;
    setGuardandoAvance(true);
    setMensajeExitoAvance(null);
    try {
      const items: ItemRecuentoInput[] = lotes
        .filter((l) => valoresContados[l.id] !== undefined && valoresContados[l.id] !== "")
        .map((l) => ({
          loteId: l.id,
          cantidadContada: Number(valoresContados[l.id]),
          cantidadSistema: Number(l.cantidad),
          motivo: motivos[l.id]?.trim() || undefined,
        }));

      await guardarDetallesRecuento(id, items);
      setHayCambiosSinGuardar(false);
      setMensajeExitoAvance(`Avance guardado (${items.length} ${items.length === 1 ? "lote contado" : "lotes contados"}).`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al guardar el avance",
      );
    } finally {
      setGuardandoAvance(false);
    }
  };

  // Aplicar recuento
  const handleEjecutarAplicar = async () => {
    if (!id) return;
    setAplicando(true);
    setDialogError(null);
    try {
      // Si hay cambios sin guardar, primero guardamos los detalles
      if (hayCambiosSinGuardar || (recuento?.detalles?.length ?? 0) === 0) {
        const items: ItemRecuentoInput[] = lotes
          .filter((l) => valoresContados[l.id] !== undefined && valoresContados[l.id] !== "")
          .map((l) => ({
            loteId: l.id,
            cantidadContada: Number(valoresContados[l.id]),
            cantidadSistema: Number(l.cantidad),
            motivo: motivos[l.id]?.trim() || undefined,
          }));
        await guardarDetallesRecuento(id, items);
      }

      await aplicarRecuento(id, {
        confirmarDesvios: Boolean(confirmarDesvios),
      });

      setDialogAplicarOpen(false);
      setHayCambiosSinGuardar(false);
      void cargarRecuento();
    } catch (err: unknown) {
      setDialogError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al aplicar el recuento",
      );
    } finally {
      setAplicando(false);
    }
  };

  // Resumen del recuento aplicado
  const resumenAplicado = useMemo(() => {
    if (!recuento || recuento.estado !== "aplicado" || !recuento.detalles) {
      return null;
    }
    const totalContados = recuento.detalles.length;
    const conDesvio = recuento.detalles.filter((d) => (d.diferencia ?? 0) !== 0).length;
    const desvioNeto = recuento.detalles.reduce((acc, d) => acc + (d.diferencia ?? 0), 0);
    return {
      totalContados,
      conDesvio,
      desvioNeto: Math.round(desvioNeto * 1000) / 1000,
    };
  }, [recuento]);

  const esBorrador = recuento?.estado === "borrador";

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <StockBreadcrumb
        items={[
          { label: "Recuentos", href: "/stock/recuentos" },
          { label: "Detalle de Recuento" },
        ]}
      />
      {/* Header de la página */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0 text-slate-500">
              <Link to="/stock/recuentos" title="Volver a recuentos">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-orange-600" />
              Detalle de Recuento
            </h1>
            {recuento && <EstadoRecuentoBadge estado={recuento.estado} />}
          </div>
          {recuento && (
            <p className="text-sm text-muted-foreground mt-1 ml-11">
              Iniciado el {formatFecha(recuento.fecha || recuento.createdAt)}
              {recuento.usuario?.nombre ? ` por ${recuento.usuario.nombre}` : ""}
              {recuento.observaciones ? ` — "${recuento.observaciones}"` : ""}
            </p>
          )}
        </div>

        {/* Acciones principales en estado Borrador */}
        {recuento?.estado === "borrador" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void handleGuardarAvance()}
              disabled={guardandoAvance || itemsCargados === 0}
              className="border-slate-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {guardandoAvance ? "Guardando..." : "Guardar avance"}
            </Button>
            <Button
              onClick={() => {
                setDialogError(null);
                setConfirmarDesvios(false);
                setDialogAplicarOpen(true);
              }}
              disabled={itemsCargados === 0}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Aplicar recuento
            </Button>
          </div>
        )}
      </div>

      {cargando ? (
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : error || !recuento ? (
        <div role="alert" className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error || "Recuento no encontrado"}</p>
        </div>
      ) : (
        <>

      {/* Banner de cambios sin guardar o éxito de guardado */}
      {hayCambiosSinGuardar && (
        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center justify-between text-amber-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Hay cambios sin guardar en la planilla de conteo.</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleGuardarAvance()}
            disabled={guardandoAvance}
            className="h-7 text-xs border-amber-300 bg-white hover:bg-amber-100 text-amber-900"
          >
            Guardar ahora
          </Button>
        </div>
      )}
      {mensajeExitoAvance && (
        <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{mensajeExitoAvance}</span>
        </div>
      )}

      {/* Resumen superior en estado APLICADO */}
      {!esBorrador && resumenAplicado && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white shadow-xs border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Lotes Contados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{resumenAplicado.totalContados}</div>
              <p className="text-xs text-muted-foreground mt-1">Lotes verificados en el conteo</p>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-xs border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Lotes con Desvío</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-700">{resumenAplicado.conDesvio}</div>
              <p className="text-xs text-muted-foreground mt-1">Requirieron ajuste de existencia</p>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-xs border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Desvío Neto</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  resumenAplicado.desvioNeto === 0
                    ? "text-emerald-600"
                    : resumenAplicado.desvioNeto > 0
                      ? "text-blue-600"
                      : "text-rose-600"
                }`}
              >
                {resumenAplicado.desvioNeto > 0 ? `+${resumenAplicado.desvioNeto}` : resumenAplicado.desvioNeto}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Aplicado el {formatFecha(recuento.aplicadoAt)}
                {recuento.aplicadoPor?.nombre ? ` por ${recuento.aplicadoPor.nombre}` : ""}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ESTADO BORRADOR: Planilla de Conteo interactiva */}
      {esBorrador && (
        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="bg-gradient-to-br from-orange-50/70 to-white border-b border-slate-100 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-orange-600" />
                  Planilla de Conteo Físico
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ingrese la cantidad física contada para cada lote. Los desvíos se calcularán automáticamente.
                </p>
              </div>

              {/* Buscador de lotes */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Buscar producto o lote..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-8 h-9 text-sm bg-white"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <TableScrollContainer aria-label="Planilla de conteo físico de inventario">
              <Table>
                <TableHeader className="bg-slate-50/70 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="font-semibold text-slate-900">Producto</TableHead>
                    <TableHead className="font-semibold text-slate-900">Lote</TableHead>
                    <TableHead className="font-semibold text-slate-900">Vencimiento</TableHead>
                    <TableHead className="font-semibold text-slate-500 text-right">Cant. Sistema</TableHead>
                    <TableHead className="font-semibold text-slate-900 w-36 text-center">Cant. Contada</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-center w-28">Desvío</TableHead>
                    <TableHead className="font-semibold text-slate-900 min-w-[200px]">Motivo del desvío</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cargandoLotes ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-24 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : lotesFiltrados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No se encontraron lotes con existencia disponible.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lotesFiltrados.map((lote) => {
                      const contadaStr = valoresContados[lote.id] ?? "";
                      const contadaNum = Number(contadaStr);
                      const tieneConteo = contadaStr !== "" && !isNaN(contadaNum);
                      const sistNum = Number(lote.cantidad);
                      const desvio = tieneConteo ? contadaNum - sistNum : 0;
                      const tieneDesvio = tieneConteo && desvio !== 0;

                      return (
                        <TableRow key={lote.id} className="hover:bg-slate-50/80">
                          <TableCell className="font-medium text-slate-900">
                            <div>{lote.producto?.nombre ?? "Producto"}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {lote.producto?.codigo ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-slate-800">
                            {lote.codigoLote || "S/L"}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {lote.fechaVencimiento ? formatFecha(lote.fechaVencimiento) : "Sin vencimiento"}
                          </TableCell>

                          {/* Cantidad Sistema (visual secundario) */}
                          <TableCell className="text-right text-muted-foreground font-medium text-sm">
                            {sistNum}
                          </TableCell>

                          {/* Cantidad Contada (RN §2.3: arranca VACÍO) */}
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="—"
                              aria-label={`Cantidad contada lote ${lote.codigoLote || lote.id}`}
                              value={contadaStr}
                              onChange={(e) => handleContadaChange(lote.id, e.target.value)}
                              className="w-28 text-center mx-auto h-8 text-sm"
                            />
                          </TableCell>

                          {/* Desvío con color */}
                          <TableCell className="text-center">
                            {!tieneConteo ? (
                              <span className="text-slate-300 font-mono">—</span>
                            ) : desvio === 0 ? (
                              <Badge
                                variant="outline"
                                className="bg-emerald-50 text-emerald-700 border-emerald-300 font-mono"
                              >
                                0
                              </Badge>
                            ) : desvio > 0 ? (
                              <Badge
                                variant="outline"
                                className="bg-amber-50 text-amber-800 border-amber-300 font-mono"
                              >
                                +{desvio}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-rose-50 text-rose-700 border-rose-300 font-mono"
                              >
                                {desvio}
                              </Badge>
                            )}
                          </TableCell>

                          {/* Motivo (habilitado solo cuando hay desvío) */}
                          <TableCell>
                            <Input
                              type="text"
                              placeholder={tieneDesvio ? "Explicación del desvío..." : "Sin desvío"}
                              aria-label={`Motivo lote ${lote.codigoLote || lote.id}`}
                              value={motivos[lote.id] ?? ""}
                              disabled={!tieneDesvio}
                              onChange={(e) => handleMotivoChange(lote.id, e.target.value)}
                              className="h-8 text-sm disabled:opacity-50 disabled:bg-slate-50"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableScrollContainer>
          </CardContent>
        </Card>
      )}

      {/* ESTADO APLICADO: Solo Lectura (sin inputs) */}
      {!esBorrador && (
        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="bg-slate-50/70 border-b border-slate-100 pb-3">
            <CardTitle className="text-base font-bold text-slate-900">
              Detalle del Conteo Aplicado
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Este recuento fue consolidado y sus ajustes se encuentran asentados en el kardex de stock.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <TableScrollContainer aria-label="Detalle del conteo aplicado">
              <Table>
                <TableHeader className="bg-slate-50/60 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="font-semibold text-slate-900">Producto</TableHead>
                    <TableHead className="font-semibold text-slate-900">Lote</TableHead>
                    <TableHead className="font-semibold text-slate-900">Vencimiento</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right">Cant. Sistema</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-right">Cant. Contada</TableHead>
                    <TableHead className="font-semibold text-slate-900 text-center">Desvío</TableHead>
                    <TableHead className="font-semibold text-slate-900">Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(!recuento.detalles || recuento.detalles.length === 0) ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No se registraron líneas de detalle en este recuento.
                      </TableCell>
                    </TableRow>
                  ) : (
                    recuento.detalles.map((det: RecuentoDetalle) => (
                      <TableRow key={det.id} className="hover:bg-slate-50/80">
                        <TableCell className="font-medium text-slate-900">
                          <div>{det.producto?.nombre ?? "Producto"}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {det.producto?.codigo ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-800">
                          {det.codigoLote || "S/L"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {det.fechaVencimiento ? formatFecha(det.fechaVencimiento) : "Sin vencimiento"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground font-mono text-sm">
                          {det.cantidadSistema ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-sm text-slate-900">
                          {det.cantidadContada}
                        </TableCell>
                        <TableCell className="text-center">
                          {det.diferencia === 0 || det.diferencia === null ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-mono">
                              0
                            </Badge>
                          ) : det.diferencia > 0 ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-mono">
                              +{det.diferencia}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-300 font-mono">
                              {det.diferencia}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {det.motivo || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableScrollContainer>
          </CardContent>
        </Card>
      )}

      {/* AlertDialog Aplicar Recuento (RN §2.1) */}
      <AlertDialog open={dialogAplicarOpen} onOpenChange={setDialogAplicarOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar el recuento</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-slate-700">
              <span className="block">
                Se van a generar {desviosCount} movimientos de ajuste sobre {desviosCount} lotes, para llevar la existencia del sistema a lo contado: {unidadesEntrada} unidades de entrada y {unidadesSalida} de salida.
              </span>
              <span className="block font-medium text-slate-900">
                Los movimientos quedan asentados en el libro de stock y en la auditoría. El recuento queda aplicado y <strong>no se puede deshacer</strong> — para corregirlo hay que registrar ajustes nuevos.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Checkbox obligatorio dentro del diálogo si hay desvíos */}
          {desviosCount > 0 && (
            <div className="flex items-start gap-2 pt-3 pb-1 border-t border-slate-100">
              <Checkbox
                id="confirmar-desvios"
                checked={confirmarDesvios}
                onCheckedChange={(checked) => setConfirmarDesvios(Boolean(checked))}
                className="mt-0.5"
              />
              <Label
                htmlFor="confirmar-desvios"
                className="text-sm font-normal text-slate-800 cursor-pointer leading-snug"
              >
                Confirmo que los desvíos son correctos y deben aplicarse.
              </Label>
            </div>
          )}

          {/* Error del backend retenido dentro del diálogo */}
          {dialogError && (
            <p role="alert" className="text-sm text-destructive font-medium my-2">
              {dialogError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={aplicando || (desviosCount > 0 && !confirmarDesvios)}
              onClick={(e) => {
                e.preventDefault();
                void handleEjecutarAplicar();
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {aplicando ? "Aplicando..." : "Aplicar recuento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </>
      )}
    </div>
  );
}

export default RecuentoDetallePage;
