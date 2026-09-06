import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  History,
  Package,
  Plus,
  Scissors,
  Search,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollContainer,
} from "../components/ui/table.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
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
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext.tsx";
import {
  crearDerivado,
  listarConversiones,
  listarProductos,
  obtenerProducto,
} from "../api/comercial/productos.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import {
  fraccionar,
  historial,
  sugerirVencimiento,
} from "../api/comercial/fraccionamiento.ts";
import { listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import { formatFechaISO } from "../lib/fechas.ts";
import {
  ApiError,
  type ApiMeta,
  type Conversion,
  type CrearDerivadoInput,
  type ItemHistorialFraccionamiento,
  type Lote,
  type Producto,
  type ResultadoFraccionamiento,
  type UnidadMedida,
} from "../types/index.ts";

function redondear2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function redondear4(val: number): number {
  return Math.round((val + Number.EPSILON) * 10000) / 10000;
}

function desvioPorcentaje(teorico: number, obtenido: number): number {
  if (teorico <= 0) return 0;
  return redondear2(((teorico - obtenido) / teorico) * 100);
}

const PAGE_SIZE_HISTORIAL = 20;

export function FraccionamientoPage() {
  const { user } = useAuth();
  const tieneManageProducts = Boolean(user?.permissions?.includes("manage_products"));

  // Pestaña activa
  const [tabActiva, setTabActiva] = useState<"fraccionar" | "historial">("fraccionar");

  // Catálogos auxiliares
  const [unidadesMedida, setUnidadesMedida] = useState<UnidadMedida[]>([]);
  useEffect(() => {
    listarUnidadesMedida()
      .then(setUnidadesMedida)
      .catch(() => setUnidadesMedida([]));
  }, []);

  const unidadesMap = useMemo(() => {
    const map = new Map<string, UnidadMedida>();
    for (const u of unidadesMedida) {
      map.set(u.id, u);
    }
    return map;
  }, [unidadesMedida]);

  // ─── 1. Búsqueda y Selección de Producto Origen ────────────────────────────
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [productosEncontrados, setProductosEncontrados] = useState<Producto[]>([]);
  const [buscandoProductos, setBuscandoProductos] = useState(false);
  const [productoOrigen, setProductoOrigen] = useState<Producto | null>(null);

  // ─── 2. Lotes Origen con Existencia ─────────────────────────────────────────
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [loteSeleccionado, setLoteSeleccionado] = useState<Lote | null>(null);

  // ─── 3. Conversiones y Producto Destino ──────────────────────────────────────
  const [conversiones, setConversiones] = useState<Conversion[]>([]);
  const [cargandoConversiones, setCargandoConversiones] = useState(false);
  const [conversionSeleccionada, setConversionSeleccionada] = useState<Conversion | null>(null);
  const [productosDestinoMap, setProductosDestinoMap] = useState<Map<string, Producto>>(new Map());

  // ─── 4. Formulario de Fraccionamiento (§2.3) ────────────────────────────────
  const [cantidadOrigen, setCantidadOrigen] = useState<string>("");
  // RN §2.3: La cantidad obtenida arranca VACÍA. Nunca precargada con el teórico.
  const [cantidadObtenida, setCantidadObtenida] = useState<string>("");
  const [codigoLoteDestino, setCodigoLoteDestino] = useState<string>("");
  const [fechaVencimientoDestino, setFechaVencimientoDestino] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");
  const [cargandoSugerenciaVencimiento, setCargandoSugerenciaVencimiento] = useState(false);

  // ─── 5. Confirmación y Diálogo (§2.1) ───────────────────────────────────────
  const [dialogConfirmarOpen, setDialogConfirmarOpen] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [resultadoExito, setResultadoExito] = useState<ResultadoFraccionamiento | null>(null);

  // ─── 6. Atajo: Crear Producto Derivado (solo manage_products) ───────────────
  const [dialogDerivadoOpen, setDialogDerivadoOpen] = useState(false);

  // ─── 7. Historial ───────────────────────────────────────────────────────────
  const [itemsHistorial, setItemsHistorial] = useState<ItemHistorialFraccionamiento[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [metaHistorial, setMetaHistorial] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE_HISTORIAL, total: 0 });
  const [pageHistorial, setPageHistorial] = useState(1);

  // Búsqueda de producto origen
  const handleBuscarProducto = useCallback(async (query: string) => {
    setBusquedaProducto(query);
    if (!query.trim() || query.trim().length < 2) {
      setProductosEncontrados([]);
      return;
    }
    setBuscandoProductos(true);
    try {
      const res = await listarProductos({ search: query.trim(), limit: 10, activo: true });
      setProductosEncontrados(res.items);
    } catch {
      setProductosEncontrados([]);
    } finally {
      setBuscandoProductos(false);
    }
  }, []);

  // Seleccionar producto origen y disparar cargas
  const handleSeleccionarProducto = useCallback(async (prod: Producto) => {
    setProductoOrigen(prod);
    setLoteSeleccionado(null);
    setConversionSeleccionada(null);
    setProductosEncontrados([]);
    setBusquedaProducto("");
    setCantidadOrigen("");
    setCantidadObtenida(""); // RN §2.3: arranca VACÍO
    setCodigoLoteDestino("");
    setFechaVencimientoDestino("");
    setMotivo("");
    setResultadoExito(null);

    // Cargar lotes con existencia (trampa §4.3: conExistencia filtra en memoria, no usar meta.total)
    setCargandoLotes(true);
    listarLotes({ productoId: prod.id, conExistencia: "true", limit: 100 })
      .then((res) => setLotes(res.items))
      .catch(() => setLotes([]))
      .finally(() => setCargandoLotes(false));

    // Cargar conversiones definidas activas
    setCargandoConversiones(true);
    try {
      const convRes = await listarConversiones({ productoOrigenId: prod.id, activo: true });
      setConversiones(convRes.items);

      // Cargar productos destino para resolver sus nombres y unidades
      const destIds = Array.from(new Set(convRes.items.map((c) => c.productoDestinoId)));
      const destMap = new Map<string, Producto>();
      await Promise.all(
        destIds.map(async (id) => {
          try {
            const p = await obtenerProducto(id);
            destMap.set(id, p);
          } catch {
            // Silencioso si falla alguno
          }
        }),
      );
      setProductosDestinoMap(destMap);

      // Si hay exactamente una conversión, la preseleccionamos
      if (convRes.items.length === 1) {
        setConversionSeleccionada(convRes.items[0]);
      }
    } catch {
      setConversiones([]);
    } finally {
      setCargandoConversiones(false);
    }
  }, []);

  // Sugerir vencimiento cuando haya lote origen y producto destino
  useEffect(() => {
    if (!loteSeleccionado || !conversionSeleccionada) {
      return;
    }

    let activo = true;
    setCargandoSugerenciaVencimiento(true);
    sugerirVencimiento({
      loteOrigenId: loteSeleccionado.id,
      productoDestinoId: conversionSeleccionada.productoDestinoId,
    })
      .then((res) => {
        if (activo && res.vencimientoSugerido) {
          // Se precarga pero es editable
          setFechaVencimientoDestino(res.vencimientoSugerido);
        }
      })
      .catch(() => {
        // Fallback al vencimiento del padre si hubiera
        if (activo && loteSeleccionado.fechaVencimiento) {
          setFechaVencimientoDestino(loteSeleccionado.fechaVencimiento);
        }
      })
      .finally(() => {
        if (activo) setCargandoSugerenciaVencimiento(false);
      });

    return () => {
      activo = false;
    };
  }, [loteSeleccionado?.id, conversionSeleccionada?.productoDestinoId]);

  // Cargar historial
  const cargarHistorial = useCallback(async (pagina: number) => {
    setCargandoHistorial(true);
    try {
      const res = await historial({ page: pagina, limit: PAGE_SIZE_HISTORIAL });
      setItemsHistorial(res.items);
      setMetaHistorial(res.meta);
    } catch {
      setItemsHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  }, []);

  useEffect(() => {
    if (tabActiva === "historial") {
      void cargarHistorial(pageHistorial);
    }
  }, [tabActiva, pageHistorial, cargarHistorial]);

  // Cálculos reactivos de la regla §2.3
  const cantidadOrigenNum = Number(cantidadOrigen);
  const cantidadOrigenValida = !isNaN(cantidadOrigenNum) && cantidadOrigenNum > 0;
  const existenciaLote = loteSeleccionado ? Number(loteSeleccionado.cantidad) : 0;
  const cantidadOrigenSuperaExistencia =
    cantidadOrigenValida && Boolean(loteSeleccionado) && cantidadOrigenNum > existenciaLote;

  const factorTeorico = conversionSeleccionada?.factorTeorico ?? 0;
  const mermaEsperadaPorcentaje = conversionSeleccionada?.mermaEsperadaPorcentaje ?? 0;

  // Teórico: cantidadOrigen * factorTeorico
  const teorico =
    cantidadOrigenValida && conversionSeleccionada ? redondear4(cantidadOrigenNum * factorTeorico) : 0;

  // Unidades de medida
  const productoDestinoObj = conversionSeleccionada
    ? productosDestinoMap.get(conversionSeleccionada.productoDestinoId)
    : null;
  const unidadOrigen = productoOrigen ? unidadesMap.get(productoOrigen.unidadMedidaId) : null;
  const unidadDestino = productoDestinoObj ? unidadesMap.get(productoDestinoObj.unidadMedidaId) : null;

  const unidadOrigenTexto = unidadOrigen?.abreviatura || unidadOrigen?.nombre || "unidades";
  const unidadDestinoTexto = unidadDestino?.abreviatura || unidadDestino?.nombre || "unidades";

  // Cantidad obtenida tipeada
  const cantidadObtenidaNum = Number(cantidadObtenida);
  const haTipeadoObtenida =
    cantidadObtenida.trim() !== "" && !isNaN(cantidadObtenidaNum) && cantidadObtenidaNum >= 0;

  // Merma real = teorico - obtenido
  const mermaReal = haTipeadoObtenida ? redondear4(teorico - cantidadObtenidaNum) : 0;
  const desvioRealPorcentaje = haTipeadoObtenida && teorico > 0 ? desvioPorcentaje(teorico, cantidadObtenidaNum) : 0;

  // Estados semánticos de la merma real
  const obtenidoSuperaTeorico = haTipeadoObtenida && cantidadObtenidaNum > teorico;
  const superaMermaEsperada =
    haTipeadoObtenida && !obtenidoSuperaTeorico && desvioRealPorcentaje > mermaEsperadaPorcentaje;
  const mermaDentroDeEsperado =
    haTipeadoObtenida && !obtenidoSuperaTeorico && !superaMermaEsperada;

  // Código destino sugerido en el placeholder
  const placeholderCodigoLote = loteSeleccionado
    ? `${loteSeleccionado.codigoLote || "LOTE"}-F1`
    : "Ej: LOT-001-F1";

  // Validación para habilitar confirmación
  const puedeConfirmar =
    Boolean(loteSeleccionado) &&
    Boolean(conversionSeleccionada) &&
    cantidadOrigenValida &&
    !cantidadOrigenSuperaExistencia &&
    haTipeadoObtenida &&
    cantidadObtenidaNum > 0 &&
    codigoLoteDestino.trim().length >= 1 &&
    codigoLoteDestino.trim().length <= 50;

  // Ejecutar fraccionamiento en el backend
  async function ejecutarFraccionamiento() {
    if (!loteSeleccionado || !conversionSeleccionada || !puedeConfirmar) return;

    setConfirmando(true);
    setDialogError(null);

    try {
      const res = await fraccionar({
        loteOrigenId: loteSeleccionado.id,
        productoDestinoId: conversionSeleccionada.productoDestinoId,
        cantidadOrigen: cantidadOrigenNum,
        cantidadObtenida: cantidadObtenidaNum,
        codigoLoteDestino: codigoLoteDestino.trim(),
        fechaVencimientoDestino: fechaVencimientoDestino.trim() || null,
        motivo: motivo.trim() || null,
      });

      setResultadoExito(res);
      setDialogConfirmarOpen(false);
      toast.success("Fraccionamiento realizado con éxito");

      // Actualizar existencia local del lote origen
      const nuevaExistencia = Math.max(0, existenciaLote - cantidadOrigenNum);
      setLoteSeleccionado((prev) => (prev ? { ...prev, cantidad: nuevaExistencia } : null));
      setLotes((prev) =>
        prev
          .map((l) => (l.id === loteSeleccionado.id ? { ...l, cantidad: nuevaExistencia } : l))
          .filter((l) => l.cantidad > 0),
      );

      // Limpiar inputs del formulario
      setCantidadOrigen("");
      setCantidadObtenida(""); // RN §2.3: arranca VACÍO
      setCodigoLoteDestino("");
      setFechaVencimientoDestino("");
      setMotivo("");
    } catch (err: unknown) {
      // RN §2.1: El error queda DENTRO del diálogo sin cerrarlo
      setDialogError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al registrar el fraccionamiento",
      );
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-800 flex items-center gap-2">
            <Scissors className="h-6 w-6 text-orange-600" />
            Fraccionamiento de Lotes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fraccione lotes de medicamentos o insumos clínicos en unidades menores registrando la merma real.
          </p>
        </div>
      </div>

      <Tabs value={tabActiva} onValueChange={(v) => setTabActiva(v as "fraccionar" | "historial")} className="space-y-6">
        <TabsList className="bg-orange-50 border border-orange-200">
          <TabsTrigger
            value="fraccionar"
            className="data-[state=active]:bg-white data-[state=active]:text-orange-900 font-medium"
          >
            <Scissors className="h-4 w-4 mr-2" />
            Fraccionar Lote
          </TabsTrigger>
          <TabsTrigger
            value="historial"
            className="data-[state=active]:bg-white data-[state=active]:text-orange-900 font-medium"
          >
            <History className="h-4 w-4 mr-2" />
            Historial de Fraccionamientos
          </TabsTrigger>
        </TabsList>

        {/* ─── PESTAÑA: FRACCIONAR ─────────────────────────────────────────────── */}
        <TabsContent value="fraccionar" className="space-y-6">
          {/* Panel de Éxito cuando se completa una operación */}
          {resultadoExito && (
            <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Fraccionamiento registrado con éxito
                </CardTitle>
                <CardDescription className="text-emerald-700">
                  Operación N°: <span className="font-mono font-semibold">{resultadoExito.operacionId}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="bg-white/80 p-2.5 rounded border border-emerald-100">
                    <span className="text-muted-foreground block text-xs">Cant. Teórica</span>
                    <span className="font-semibold text-slate-800">{resultadoExito.cantidadTeorica}</span>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded border border-emerald-100">
                    <span className="text-muted-foreground block text-xs">Cant. Obtenida</span>
                    <span className="font-semibold text-slate-800">{resultadoExito.cantidadObtenida}</span>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded border border-emerald-100">
                    <span className="text-muted-foreground block text-xs">Merma Registrada</span>
                    <span className="font-semibold text-slate-800">{resultadoExito.mermaRegistrada}</span>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded border border-emerald-100">
                    <span className="text-muted-foreground block text-xs">Desvío</span>
                    <span className="font-semibold text-slate-800">{resultadoExito.desvioPorcentaje}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link to={`/stock/lotes/${resultadoExito.loteDestinoId}`}>
                    <Button variant="default" size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
                      Ver lote derivado / Trazabilidad
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResultadoExito(null)}
                  >
                    Fraccionar otro lote
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Columna Izquierda: Selección de Origen y Destino */}
            <div className="lg:col-span-5 space-y-6">
              {/* 1. Selección de Producto Origen */}
              <Card className="shadow-sm">
                <CardHeader className="bg-gradient-to-r from-orange-50 to-white pb-3 border-b">
                  <CardTitle className="text-base text-orange-950 flex items-center gap-2">
                    <Package className="h-4 w-4 text-orange-600" />
                    1. Producto y Lote Origen
                  </CardTitle>
                  <CardDescription>
                    Busque el producto que se va a fraccionar y seleccione un lote disponible.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="buscar-producto">Buscar producto origen</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="buscar-producto"
                        placeholder="Nombre o código del producto..."
                        className="pl-8"
                        value={busquedaProducto}
                        onChange={(e) => void handleBuscarProducto(e.target.value)}
                      />
                    </div>

                    {buscandoProductos && (
                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        Buscando productos...
                      </div>
                    )}

                    {productosEncontrados.length > 0 && (
                      <div className="border rounded-md divide-y max-h-48 overflow-y-auto bg-white shadow-sm mt-1">
                        {productosEncontrados.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            className="w-full text-left p-2.5 hover:bg-orange-50 transition-colors flex justify-between items-center text-sm"
                            onClick={() => void handleSeleccionarProducto(p)}
                          >
                            <div>
                              <p className="font-medium text-slate-800">{p.nombre}</p>
                              <p className="text-xs text-muted-foreground font-mono">{p.codigo}</p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {unidadesMap.get(p.unidadMedidaId)?.abreviatura || "unid."}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {productoOrigen && (
                    <div className="p-3 bg-orange-50/60 rounded-md border border-orange-100 space-y-1 text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs text-orange-700 font-semibold uppercase tracking-wider block">
                            Producto Seleccionado
                          </span>
                          <span className="font-medium text-slate-900">{productoOrigen.nombre}</span>
                        </div>
                        <Badge className="bg-orange-100 text-orange-900 border-orange-200">
                          {productoOrigen.codigo}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {/* Lotes disponibles */}
                  {productoOrigen && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label htmlFor="select-lote-origen">Lote origen con existencia</Label>
                      {cargandoLotes ? (
                        <div className="space-y-2">
                          <Skeleton className="h-9 w-full" />
                          <Skeleton className="h-9 w-full" />
                        </div>
                      ) : lotes.length === 0 ? (
                        <div className="p-3 text-sm border rounded-md bg-slate-50 text-muted-foreground flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                          No hay lotes con existencia disponible para este producto.
                        </div>
                      ) : (
                        <Select
                          value={loteSeleccionado?.id ?? ""}
                          onValueChange={(val: string) => {
                            const l = lotes.find((item) => item.id === val);
                            setLoteSeleccionado(l ?? null);
                          }}
                        >
                          <SelectTrigger id="select-lote-origen" className="w-full">
                            <SelectValue placeholder="Seleccione un lote origen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {lotes.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.codigoLote || "S/L"} — Existencia: {l.cantidad} {unidadOrigenTexto}
                                {l.fechaVencimiento ? ` (Vence: ${formatFechaISO(l.fechaVencimiento)})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {loteSeleccionado && (
                        <div className="text-xs text-muted-foreground space-y-0.5 pt-1 px-1">
                          <p>
                            Existencia disponible:{" "}
                            <span className="font-semibold text-slate-800">
                              {loteSeleccionado.cantidad} {unidadOrigenTexto}
                            </span>
                          </p>
                          {loteSeleccionado.fechaVencimiento && (
                            <p>
                              Vencimiento:{" "}
                              <span className="font-medium text-slate-700">
                                {formatFechaISO(loteSeleccionado.fechaVencimiento)}
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. Selección de Destino / Conversiones */}
              {productoOrigen && (
                <Card className="shadow-sm">
                  <CardHeader className="bg-gradient-to-r from-orange-50 to-white pb-3 border-b">
                    <CardTitle className="text-base text-orange-950 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-orange-600" />
                        2. Conversión a Producto Destino
                      </span>
                      {tieneManageProducts && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 border-orange-300 text-orange-800 hover:bg-orange-50"
                          onClick={() => setDialogDerivadoOpen(true)}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Crear producto derivado
                        </Button>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Reglas de transformación definidas para este producto.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-3">
                    {cargandoConversiones ? (
                      <Skeleton className="h-10 w-full" />
                    ) : conversiones.length === 0 ? (
                      <div className="p-3 text-sm border border-dashed rounded-md bg-amber-50/50 text-amber-900 space-y-2">
                        <p className="flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          Sin conversiones definidas
                        </p>
                        <p className="text-xs text-amber-800">
                          Este producto no tiene conversiones activas para fraccionamiento.
                        </p>
                        <div className="pt-1 flex flex-wrap gap-2 text-xs">
                          <Link
                            to="/stock/familias"
                            className="underline text-orange-700 hover:text-orange-900 font-medium"
                          >
                            Ir a Catálogo / Familias para configurar una
                          </Link>
                          {tieneManageProducts && (
                            <span className="text-muted-foreground">
                              o use el botón superior para crear un producto derivado.
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="select-conversion">Seleccione la conversión destino</Label>
                        <Select
                          value={conversionSeleccionada?.id ?? ""}
                          onValueChange={(val: string) => {
                            const c = conversiones.find((item) => item.id === val);
                            setConversionSeleccionada(c ?? null);
                          }}
                        >
                          <SelectTrigger id="select-conversion" className="w-full">
                            <SelectValue placeholder="Seleccione el producto destino..." />
                          </SelectTrigger>
                          <SelectContent>
                            {conversiones.map((c) => {
                              const dest = productosDestinoMap.get(c.productoDestinoId);
                              const destNombre = dest?.nombre || `Producto ${c.productoDestinoId.slice(0, 8)}`;
                              return (
                                <SelectItem key={c.id} value={c.id}>
                                  {destNombre} (Factor: ×{c.factorTeorico} · Merma: {c.mermaEsperadaPorcentaje}%)
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>

                        {conversionSeleccionada && (
                          <div className="p-2.5 bg-slate-50 rounded border text-xs space-y-1 text-slate-700">
                            <p>
                              Factor teórico:{" "}
                              <span className="font-semibold text-slate-900">
                                1 {unidadOrigenTexto} → {conversionSeleccionada.factorTeorico} {unidadDestinoTexto}
                              </span>
                            </p>
                            <p>
                              Merma esperada de proceso:{" "}
                              <span className="font-medium text-slate-800">
                                {conversionSeleccionada.mermaEsperadaPorcentaje}%
                              </span>
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Columna Derecha: Formulario de Fraccionamiento (§2.3) */}
            <div className="lg:col-span-7">
              <Card className="shadow-sm">
                <CardHeader className="bg-gradient-to-r from-orange-50 to-white pb-3 border-b">
                  <CardTitle className="text-base text-orange-950 flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-orange-600" />
                    3. Parámetros de Fraccionamiento
                  </CardTitle>
                  <CardDescription>
                    Ingrese la cantidad a descontar y la cantidad obtenida real tras el fraccionamiento.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-5">
                  {!loteSeleccionado || !conversionSeleccionada ? (
                    <div className="p-8 text-center border border-dashed rounded-lg bg-slate-50 text-muted-foreground space-y-2">
                      <Scissors className="h-8 w-8 mx-auto text-slate-400" />
                      <p className="font-medium text-slate-700">Seleccione el lote origen y la conversión</p>
                      <p className="text-xs">
                        Para habilitar el formulario de fraccionamiento, primero elija un lote con stock y el producto destino deseado.
                      </p>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (puedeConfirmar) setDialogConfirmarOpen(true);
                      }}
                      className="space-y-5"
                    >
                      {/* Campo: Cantidad Origen */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <Label htmlFor="cantidadOrigen" className="font-medium">
                            Cantidad a tomar del lote origen ({unidadOrigenTexto})
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            Máx. disponible: {existenciaLote} {unidadOrigenTexto}
                          </span>
                        </div>
                        <Input
                          id="cantidadOrigen"
                          type="number"
                          step="any"
                          min="0.001"
                          placeholder="0.00"
                          value={cantidadOrigen}
                          onChange={(e) => setCantidadOrigen(e.target.value)}
                          className={cantidadOrigenSuperaExistencia ? "border-rose-500 focus-visible:ring-rose-500" : ""}
                        />
                        {cantidadOrigenSuperaExistencia && (
                          <p role="alert" className="text-xs text-rose-600 font-medium">
                            La cantidad a fraccionar no puede superar la existencia actual del lote ({existenciaLote} {unidadOrigenTexto}).
                          </p>
                        )}
                      </div>

                      {/* ─── REGLA §2.3: CANTIDAD OBTENIDA Y CÁLCULO DE MERMA ─── */}
                      <div className="p-4 bg-slate-50/70 border rounded-lg space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                          {/* Input Cantidad Obtenida (ARRANCA VACÍO) */}
                          <div className="md:col-span-7 space-y-1.5">
                            <Label htmlFor="cantidadObtenida" className="font-semibold text-slate-900">
                              Cantidad obtenida real ({unidadDestinoTexto}) *
                            </Label>
                            <Input
                              id="cantidadObtenida"
                              type="number"
                              step="any"
                              min="0.001"
                              placeholder="Tipee la cantidad real obtenida..."
                              value={cantidadObtenida}
                              onChange={(e) => setCantidadObtenida(e.target.value)}
                              className="font-mono text-base"
                            />
                            <p className="text-xs text-muted-foreground">
                              Tipee el valor observado en balanza o conteo. No se precarga para capturar la merma real.
                            </p>
                          </div>

                          {/* Referencia Teórica permanente al lado del input */}
                          <div className="md:col-span-5 bg-white p-3 rounded border space-y-1 text-xs">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                              Referencia Teórica
                            </span>
                            <p className="text-slate-800">
                              Teórico:{" "}
                              <span className="font-semibold text-slate-950">
                                {teorico} {unidadDestinoTexto}
                              </span>
                            </p>
                            <p className="text-slate-600">
                              Merma esperada:{" "}
                              <span className="font-medium text-slate-800">
                                {mermaEsperadaPorcentaje}%
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Merma resultante en vivo al tipear */}
                        {haTipeadoObtenida && (
                          <div
                            className={`p-3 rounded-md border text-xs flex items-center justify-between transition-colors ${
                              obtenidoSuperaTeorico
                                ? "bg-rose-50 border-rose-200 text-rose-800"
                                : superaMermaEsperada
                                  ? "bg-amber-50 border-amber-200 text-amber-800"
                                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
                            }`}
                          >
                            <div>
                              <span className="font-semibold">
                                Merma real: {mermaReal} {unidadDestinoTexto} ({desvioRealPorcentaje}%)
                              </span>
                              <span className="block text-[11px] opacity-90">
                                {obtenidoSuperaTeorico
                                  ? "Atención: La cantidad obtenida supera al rendimiento teórico."
                                  : superaMermaEsperada
                                    ? `Merma superior a la tolerancia esperada (${mermaEsperadaPorcentaje}%).`
                                    : "Merma dentro de los límites de tolerancia esperados."}
                              </span>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[11px] font-semibold uppercase ${
                                obtenidoSuperaTeorico
                                  ? "border-rose-400 bg-rose-100 text-rose-900"
                                  : superaMermaEsperada
                                    ? "border-amber-400 bg-amber-100 text-amber-900"
                                    : "border-emerald-400 bg-emerald-100 text-emerald-900"
                              }`}
                            >
                              {obtenidoSuperaTeorico
                                ? "Rendimiento > 100%"
                                : superaMermaEsperada
                                  ? "Desvío Alto"
                                  : "Esperado"}
                            </Badge>
                          </div>
                        )}
                      </div>

                      {/* Código de Lote Destino */}
                      <div className="space-y-1.5">
                        <Label htmlFor="codigoLoteDestino" className="font-medium">
                          Código del lote derivado / destino *
                        </Label>
                        <Input
                          id="codigoLoteDestino"
                          placeholder={placeholderCodigoLote}
                          value={codigoLoteDestino}
                          onChange={(e) => setCodigoLoteDestino(e.target.value)}
                          maxLength={50}
                        />
                        <p className="text-xs text-muted-foreground">
                          Patrón sugerido en placeholder: <span className="font-mono">{placeholderCodigoLote}</span>.
                        </p>
                      </div>

                      {/* Fecha de Vencimiento Destino */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <Label htmlFor="fechaVencimientoDestino" className="font-medium">
                            Fecha de vencimiento del lote derivado
                          </Label>
                          {cargandoSugerenciaVencimiento && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Skeleton className="h-3 w-3 rounded-full" />
                              Calculando fecha sugerida...
                            </span>
                          )}
                        </div>
                        <Input
                          id="fechaVencimientoDestino"
                          type="date"
                          value={fechaVencimientoDestino}
                          onChange={(e) => setFechaVencimientoDestino(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Calculada a partir del vencimiento de origen y la vida útil post-apertura. Es editable.
                        </p>
                      </div>

                      {/* Motivo Opcional */}
                      <div className="space-y-1.5">
                        <Label htmlFor="motivo" className="font-medium">
                          Motivo / Observaciones (opcional)
                        </Label>
                        <Textarea
                          id="motivo"
                          rows={2}
                          placeholder="Notas sobre el fraccionamiento o justificación de desvío..."
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                        />
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Button
                          type="button"
                          disabled={!puedeConfirmar}
                          onClick={() => setDialogConfirmarOpen(true)}
                          className="bg-orange-700 hover:bg-orange-800 text-white min-w-36"
                        >
                          <Scissors className="h-4 w-4 mr-2" />
                          Fraccionar lote
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── PESTAÑA: HISTORIAL ─────────────────────────────────────────────── */}
        <TabsContent value="historial" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="bg-gradient-to-r from-orange-50 to-white pb-3 border-b">
              <CardTitle className="text-base text-orange-950 flex items-center gap-2">
                <History className="h-4 w-4 text-orange-600" />
                Historial de Operaciones de Fraccionamiento
              </CardTitle>
              <CardDescription>
                Registro inmutable de todos los fraccionamientos ejecutados en el sistema.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {cargandoHistorial ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : itemsHistorial.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground border rounded-md">
                  No hay operaciones de fraccionamiento registradas.
                </div>
              ) : (
                <>
                  <TableScrollContainer aria-label="Historial de operaciones de fraccionamiento">
                    <Table>
                      <TableHeader className="bg-orange-50/70">
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Operación N°</TableHead>
                          <TableHead>Producto Origen</TableHead>
                          <TableHead>Producto Destino</TableHead>
                          <TableHead className="text-right">Cant. Origen</TableHead>
                          <TableHead className="text-right">Cant. Teórica</TableHead>
                          <TableHead className="text-right">Cant. Obtenida</TableHead>
                          <TableHead className="text-right">Merma</TableHead>
                          <TableHead className="text-right">Costo Unit. Hijo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itemsHistorial.map((it) => (
                          <TableRow key={it.operacionId}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {formatFechaISO(it.fraccionadoAt)}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-700">
                              {it.operacionId.slice(0, 8)}...
                            </TableCell>
                            <TableCell className="font-medium text-slate-800">
                              {it.productoOrigenNombre}
                            </TableCell>
                            <TableCell className="font-medium text-slate-800">
                              {it.productoDestinoNombre}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {it.cantidadOrigen}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {it.cantidadTeorica}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold text-slate-900">
                              {it.cantidadObtenida}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {it.merma > 0 ? (
                                <span className="text-amber-700 font-semibold">{it.merma}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              ${it.costoUnitarioHijo.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableScrollContainer>

                  {/* Paginación */}
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-muted-foreground">
                      Página {metaHistorial.page} · Total: {metaHistorial.total} operaciones
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pageHistorial <= 1}
                        onClick={() => setPageHistorial((p) => Math.max(1, p - 1))}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={itemsHistorial.length < PAGE_SIZE_HISTORIAL}
                        onClick={() => setPageHistorial((p) => p + 1)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── DIÁLOGO CONFIRMATORIO §2.1 ─────────────────────────────────────── */}
      <AlertDialog open={dialogConfirmarOpen} onOpenChange={setDialogConfirmarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fraccionar el lote</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-slate-700">
                <p>
                  Se descuentan <strong className="text-slate-900">{cantidadOrigenNum} {unidadOrigenTexto}</strong> del lote{" "}
                  <strong className="text-slate-900">{loteSeleccionado?.codigoLote || "S/L"}</strong> y se crea el lote{" "}
                  <strong className="text-slate-900">{codigoLoteDestino.trim()}</strong> con{" "}
                  <strong className="text-slate-900">{cantidadObtenidaNum} {unidadDestinoTexto}</strong>.
                </p>
                <p>
                  La merma de <strong className="text-slate-900">{mermaReal}</strong> queda registrada como tal. Los movimientos
                  quedan asentados en el libro de stock y <strong>no se pueden deshacer</strong>. No se puede revertir.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* RN §2.1: El error del backend se muestra DENTRO del diálogo sin cerrarlo */}
          {dialogError && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{dialogError}</span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmando}
              onClick={(e) => {
                e.preventDefault();
                void ejecutarFraccionamiento();
              }}
              className="bg-orange-700 hover:bg-orange-800 text-white"
            >
              {confirmando ? "Fraccionando..." : "Confirmar fraccionamiento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── ATAJO: DIÁLOGO CREAR DERIVADO (SOLO MANAGE_PRODUCTS) ───────────── */}
      {tieneManageProducts && productoOrigen && (
        <CrearDerivadoModal
          open={dialogDerivadoOpen}
          onOpenChange={setDialogDerivadoOpen}
          productoOrigen={productoOrigen}
          unidadesMedida={unidadesMedida}
          onCreated={async (conversion) => {
            // Recargar conversiones y preseleccionar la nueva
            const convRes = await listarConversiones({ productoOrigenId: productoOrigen.id, activo: true });
            setConversiones(convRes.items);
            const nueva = convRes.items.find((c) => c.id === conversion.id);
            if (nueva) setConversionSeleccionada(nueva);
            try {
              const p = await obtenerProducto(conversion.productoDestinoId);
              setProductosDestinoMap((prev) => new Map(prev).set(p.id, p));
            } catch {
              // Silencioso
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Modal para Crear Producto Derivado y Conversión ─────────────────────────
interface CrearDerivadoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productoOrigen: Producto;
  unidadesMedida: UnidadMedida[];
  onCreated: (conversion: Conversion) => void;
}

function CrearDerivadoModal({
  open,
  onOpenChange,
  productoOrigen,
  unidadesMedida,
  onCreated,
}: CrearDerivadoModalProps) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [unidadMedidaId, setUnidadMedidaId] = useState("");
  const [factorTeorico, setFactorTeorico] = useState("");
  const [mermaEsperada, setMermaEsperada] = useState("0");
  const [vidaUtilDias, setVidaUtilDias] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const factorNum = Number(factorTeorico);
  const mermaNum = Number(mermaEsperada);
  const formValido =
    codigo.trim().length >= 1 &&
    nombre.trim().length >= 3 &&
    unidadMedidaId !== "" &&
    !isNaN(factorNum) &&
    factorNum > 0 &&
    !isNaN(mermaNum) &&
    mermaNum >= 0 &&
    mermaNum <= 100;

  async function handleGuardar() {
    if (!formValido) return;
    setGuardando(true);
    setErrorModal(null);
    try {
      const input: CrearDerivadoInput = {
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        unidadMedidaId,
        factorTeorico: factorNum,
        mermaEsperadaPorcentaje: mermaNum,
        vidaUtilPostAperturaDias: vidaUtilDias.trim() ? Number(vidaUtilDias) : null,
        precioVenta: precioVenta.trim() ? Number(precioVenta) : null,
        descripcion: descripcion.trim() || null,
      };

      const res = await crearDerivado(productoOrigen.id, input);
      toast.success("Producto derivado y conversión creados correctamente");
      onCreated(res.conversion);
      onOpenChange(false);
    } catch (err: unknown) {
      setErrorModal(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Error al crear producto derivado",
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear Producto Derivado</DialogTitle>
          <DialogDescription>
            Crea un nuevo producto hijo y su conversión a partir de {productoOrigen.nombre}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          {errorModal && (
            <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
              {errorModal}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="der-codigo">Código *</Label>
              <Input
                id="der-codigo"
                placeholder="Ej: AMX-500-FRAC"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="der-nombre">Nombre *</Label>
              <Input
                id="der-nombre"
                placeholder="Ej: Amoxicilina 500mg Dosis"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="der-unidad">Unidad de medida destino *</Label>
            <Select value={unidadMedidaId} onValueChange={setUnidadMedidaId}>
              <SelectTrigger id="der-unidad">
                <SelectValue placeholder="Seleccione unidad..." />
              </SelectTrigger>
              <SelectContent>
                {unidadesMedida.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nombre} ({u.abreviatura})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="der-factor">Factor teórico *</Label>
              <Input
                id="der-factor"
                type="number"
                step="any"
                min="0.001"
                placeholder="Ej: 10"
                value={factorTeorico}
                onChange={(e) => setFactorTeorico(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="der-merma">Merma esperada (%)</Label>
              <Input
                id="der-merma"
                type="number"
                min="0"
                max="100"
                value={mermaEsperada}
                onChange={(e) => setMermaEsperada(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="der-vidautil">Vida útil post-apertura (días)</Label>
              <Input
                id="der-vidautil"
                type="number"
                min="1"
                placeholder="Opcional"
                value={vidaUtilDias}
                onChange={(e) => setVidaUtilDias(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="der-precio">Precio venta ($)</Label>
              <Input
                id="der-precio"
                type="number"
                min="0"
                step="0.01"
                placeholder="Opcional"
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="der-descripcion">Descripción</Label>
            <Input
              id="der-descripcion"
              placeholder="Opcional..."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleGuardar()}
            disabled={!formValido || guardando}
            className="bg-orange-700 hover:bg-orange-800 text-white"
          >
            {guardando ? "Creando..." : "Crear derivado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
