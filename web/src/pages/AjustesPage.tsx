import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Package,
  Search,
  SlidersHorizontal,
  Unlock,
  X,
} from "lucide-react";
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
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
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
import { EstadoLoteBadge } from "./LotesPage.tsx";
import { BloquearLoteDialog } from "../components/comercial/BloquearLoteDialog.tsx";
import { DesbloquearLoteDialog } from "../components/comercial/DesbloquearLoteDialog.tsx";
import { formatFechaISO } from "../lib/fechas.ts";
import { ajustarExistencia } from "../api/comercial/ajustes.ts";
import { listarProductos } from "../api/comercial/productos.ts";
import { listarLotes, obtenerLote } from "../api/comercial/stock.ts";
import { ApiError } from "../types/index.ts";
import type { Lote, Producto, ResultadoAjuste, TipoAjuste } from "../types/index.ts";

export const TIPOS_AJUSTE: Array<{
  value: TipoAjuste;
  label: string;
  explicacion: string;
}> = [
  {
    value: "entrada_ajuste",
    label: "Entrada por ajuste",
    explicacion: "Aparece stock que el sistema no tenía.",
  },
  {
    value: "salida_ajuste",
    label: "Salida por ajuste",
    explicacion: "Falta stock que el sistema tenía.",
  },
  {
    value: "merma_rotura",
    label: "Merma por rotura",
    explicacion: "Se rompió o se perdió.",
  },
  {
    value: "merma_vencimiento",
    label: "Merma por vencimiento",
    explicacion: "Se descarta por vencido.",
  },
];

export function AjustesPage() {
  const [searchParams] = useSearchParams();
  const loteIdParam = searchParams.get("loteId");

  // Buscador de productos
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [productosEncontrados, setProductosEncontrados] = useState<Producto[]>([]);
  const [buscandoProductos, setBuscandoProductos] = useState(false);

  // Selección
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [loteSeleccionado, setLoteSeleccionado] = useState<Lote | null>(null);
  const [cargandoLoteDirecto, setCargandoLoteDirecto] = useState(false);
  const [errorLoteDirecto, setErrorLoteDirecto] = useState<string | null>(null);

  // Formulario de ajuste
  const [tipo, setTipo] = useState<TipoAjuste>("entrada_ajuste");
  const [cantidad, setCantidad] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");

  // Diálogo de confirmación de ajuste
  const [dialogConfirmarOpen, setDialogConfirmarOpen] = useState(false);
  const [guardandoAjuste, setGuardandoAjuste] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [resultadoExito, setResultadoExito] = useState<ResultadoAjuste | null>(null);

  // Diálogos de bloqueo/desbloqueo
  const [loteParaBloqueo, setLoteParaBloqueo] = useState<Lote | null>(null);
  const [bloquearOpen, setBloquearOpen] = useState(false);
  const [desbloquearOpen, setDesbloquearOpen] = useState(false);

  // Carga directa si viene ?loteId=
  useEffect(() => {
    if (!loteIdParam) {
      return;
    }

    async function cargarDirecto() {
      setCargandoLoteDirecto(true);
      setErrorLoteDirecto(null);
      try {
        const l = await obtenerLote(loteIdParam!);
        setLoteSeleccionado(l);
        if (l.producto) {
          setProductoSeleccionado(l.producto as Producto);
          const res = await listarLotes({
            productoId: l.producto.id,
            conExistencia: "true",
            limit: 100,
          });
          setLotes(res.items);
        }
      } catch (err: unknown) {
        setErrorLoteDirecto(
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Error al cargar lote",
        );
      } finally {
        setCargandoLoteDirecto(false);
      }
    }

    void cargarDirecto();
  }, [loteIdParam]);

  // Búsqueda de productos
  const handleBuscarProductos = useCallback(async (query: string) => {
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

  // Seleccionar producto y cargar sus lotes
  const handleSeleccionarProducto = useCallback(async (prod: Producto) => {
    setProductoSeleccionado(prod);
    setLoteSeleccionado(null);
    setProductosEncontrados([]);
    setBusquedaProducto("");
    setCargandoLotes(true);
    try {
      // NOTA PLAN_FRONTEND_COMERCIAL.md §4.3: conExistencia filtra en memoria después de paginar. No usamos meta.total.
      const res = await listarLotes({
        productoId: prod.id,
        conExistencia: "true",
        limit: 100,
      });
      setLotes(res.items);
    } catch {
      setLotes([]);
    } finally {
      setCargandoLotes(false);
    }
  }, []);

  // Cálculos de existencia resultante
  const cantidadNum = Number(cantidad);
  const esCantidadInvalida = cantidad !== "" && (isNaN(cantidadNum) || cantidadNum <= 0);
  const cantidadValida = !isNaN(cantidadNum) && cantidadNum > 0;

  const esEntrada = tipo === "entrada_ajuste";
  const existenciaActual = loteSeleccionado ? Number(loteSeleccionado.cantidad) : 0;
  const existenciaResultante = cantidadValida
    ? esEntrada
      ? existenciaActual + cantidadNum
      : existenciaActual - cantidadNum
    : existenciaActual;

  const existenciaNegativa = cantidadValida && !esEntrada && existenciaResultante < 0;
  const motivoValido = motivo.trim().length >= 10;

  const puedeRegistrar =
    Boolean(loteSeleccionado) &&
    Boolean(tipo) &&
    cantidadValida &&
    motivoValido &&
    !guardandoAjuste;

  // Ejecutar el ajuste en el backend
  async function ejecutarAjuste() {
    if (!loteSeleccionado || !puedeRegistrar) return;
    setGuardandoAjuste(true);
    setDialogError(null);
    try {
      const res = await ajustarExistencia({
        loteId: loteSeleccionado.id,
        tipo,
        cantidad: cantidadNum,
        motivo: motivo.trim(),
      });
      setResultadoExito(res);
      setDialogConfirmarOpen(false);

      // Actualizar cantidad del lote en pantalla
      setLoteSeleccionado((prev) => (prev ? { ...prev, cantidad: res.existenciaFinal } : null));
      setLotes((prev) =>
        prev.map((l) => (l.id === loteSeleccionado.id ? { ...l, cantidad: res.existenciaFinal } : l)),
      );

      // Limpiar formulario
      setCantidad("");
      setMotivo("");
    } catch (err: unknown) {
      setDialogError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Error al registrar el ajuste",
      );
    } finally {
      setGuardandoAjuste(false);
    }
  }

  // Nombre legible del tipo seleccionado
  const tipoObj = useMemo(() => TIPOS_AJUSTE.find((t) => t.value === tipo), [tipo]);
  const codigoLoteTexto = loteSeleccionado?.codigoLote ?? "S/L";

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-orange-600" />
            Ajustes de Stock
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Registro de ajustes manuales de existencia, mermas por rotura o vencimiento, y bloqueo de lotes.
          </p>
        </div>
      </div>

      {/* Notificación de éxito */}
      {resultadoExito && (
        <div
          role="status"
          className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Ajuste registrado con éxito</p>
            <p className="text-xs text-emerald-700 mt-1">
              Nueva existencia del lote: <span className="font-bold">{resultadoExito.existenciaFinal}</span>.
              Movimiento registrado con ID de operación <span className="font-mono">{resultadoExito.operacionId}</span>.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setResultadoExito(null)}
            className="h-7 w-7 p-0 text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar</span>
          </Button>
        </div>
      )}

      {errorLoteDirecto && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <span>{errorLoteDirecto}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ─── COLUMNA IZQUIERDA: BÚSQUEDA Y SELECCIÓN DE LOTE ─── */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card de selección de producto */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-gradient-to-br from-orange-50/70 to-white border-b border-slate-100 pb-4">
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Search className="h-4 w-4 text-orange-600" />
                1. Seleccionar Producto y Lote
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Buscador de producto */}
              <div className="relative">
                <Label htmlFor="buscar-producto-input" className="text-xs font-semibold text-slate-700 block mb-1">
                  Buscar producto
                </Label>
                <div className="relative">
                  <Input
                    id="buscar-producto-input"
                    aria-label="Buscar producto"
                    placeholder="Escribí nombre o código del producto..."
                    value={busquedaProducto}
                    onChange={(e) => void handleBuscarProductos(e.target.value)}
                    className="h-10 pr-9"
                  />
                  <Search className="h-4 w-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>

                {/* Dropdown de productos encontrados */}
                {buscandoProductos && (
                  <p className="text-xs text-muted-foreground mt-2">Buscando productos...</p>
                )}
                {productosEncontrados.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {productosEncontrados.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void handleSeleccionarProducto(p)}
                        className="w-full text-left p-3 hover:bg-orange-50/80 border-b border-slate-100 last:border-b-0 transition-colors"
                      >
                        <p className="font-semibold text-sm text-slate-900">{p.nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono">Código: {p.codigo}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Producto actualmente seleccionado */}
              {productoSeleccionado && (
                <div className="p-3 bg-orange-50/60 border border-orange-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Package className="h-5 w-5 text-orange-600 shrink-0" />
                    <div>
                      <p className="font-bold text-sm text-slate-900">{productoSeleccionado.nombre}</p>
                      <p className="text-xs text-muted-foreground font-mono">Código: {productoSeleccionado.codigo}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setProductoSeleccionado(null);
                      setLoteSeleccionado(null);
                      setLotes([]);
                    }}
                    className="text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cambiar
                  </Button>
                </div>
              )}

              {/* Lista de lotes del producto */}
              {productoSeleccionado && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Lotes disponibles con existencia
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}
                    </span>
                  </div>

                  {cargandoLotes ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : lotes.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 text-center bg-slate-50 rounded border border-slate-200">
                      Este producto no tiene lotes con existencia registrados.
                    </p>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <TableScrollContainer aria-label="Tabla de lotes para ajuste">
                        <Table>
                          <TableHeader className="bg-orange-50/60">
                            <TableRow>
                              <TableHead className="text-xs">Lote</TableHead>
                              <TableHead className="text-xs">Vencimiento</TableHead>
                              <TableHead className="text-xs text-right">Existencia</TableHead>
                              <TableHead className="text-xs">Estado</TableHead>
                              <TableHead className="text-xs text-center">Acciones</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lotes.map((lote) => {
                              const esSeleccionado = loteSeleccionado?.id === lote.id;
                              return (
                                <TableRow
                                  key={lote.id}
                                  className={esSeleccionado ? "bg-orange-100/70 font-medium" : "hover:bg-slate-50/80"}
                                >
                                  <TableCell className="font-mono text-xs font-semibold">
                                    {lote.codigoLote ?? "S/L"}
                                  </TableCell>
                                  <TableCell className="text-xs text-slate-600">
                                    {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold text-slate-900">
                                    {lote.cantidad}
                                  </TableCell>
                                  <TableCell>
                                    <EstadoLoteBadge estado={lote.estado} />
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={esSeleccionado ? "default" : "outline"}
                                        onClick={() => setLoteSeleccionado(lote)}
                                        className="h-7 text-xs px-2"
                                      >
                                        {esSeleccionado ? "Elegido" : "Elegir"}
                                      </Button>
                                      {lote.estado === "bloqueado" ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          title="Desbloquear lote"
                                          onClick={() => {
                                            setLoteParaBloqueo(lote);
                                            setDesbloquearOpen(true);
                                          }}
                                          className="h-7 w-7 p-0 text-slate-600 hover:text-emerald-700"
                                        >
                                          <Unlock className="h-3.5 w-3.5" />
                                          <span className="sr-only">Desbloquear lote</span>
                                        </Button>
                                      ) : (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          title="Bloquear lote"
                                          onClick={() => {
                                            setLoteParaBloqueo(lote);
                                            setBloquearOpen(true);
                                          }}
                                          className="h-7 w-7 p-0 text-slate-600 hover:text-rose-700"
                                        >
                                          <Lock className="h-3.5 w-3.5" />
                                          <span className="sr-only">Bloquear lote</span>
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableScrollContainer>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ficha del lote seleccionado */}
          {loteSeleccionado && (
            <Card className="border-orange-300 bg-orange-50/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-orange-100/60 border-b border-orange-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-orange-700" />
                    <CardTitle className="text-sm font-bold text-orange-950">
                      Lote Seleccionado: <span className="font-mono">{codigoLoteTexto}</span>
                    </CardTitle>
                  </div>
                  <EstadoLoteBadge estado={loteSeleccionado.estado} />
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Producto</span>
                    <span className="font-semibold text-slate-900">
                      {loteSeleccionado.producto?.nombre ?? productoSeleccionado?.nombre ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Vencimiento</span>
                    <span className="font-semibold text-slate-900">
                      {loteSeleccionado.fechaVencimiento
                        ? formatFechaISO(loteSeleccionado.fechaVencimiento.slice(0, 10))
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Existencia actual</span>
                    <span className="text-base font-bold text-slate-950 font-mono">
                      {loteSeleccionado.cantidad}
                    </span>
                  </div>
                  <div className="flex items-end">
                    {loteSeleccionado.estado === "bloqueado" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLoteParaBloqueo(loteSeleccionado);
                          setDesbloquearOpen(true);
                        }}
                        className="h-8 text-xs gap-1 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        Desbloquear lote
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLoteParaBloqueo(loteSeleccionado);
                          setBloquearOpen(true);
                        }}
                        className="h-8 text-xs gap-1 border-rose-300 text-rose-800 hover:bg-rose-50"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Bloquear lote
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ─── COLUMNA DERECHA: FORMULARIO DE AJUSTE ─── */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-gradient-to-br from-orange-50/70 to-white border-b border-slate-100 pb-4">
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-orange-600" />
                2. Registrar Ajuste de Existencia
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {!loteSeleccionado ? (
                <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-muted-foreground text-sm space-y-1">
                  <Package className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="font-medium text-slate-700">Seleccioná un lote para ajustar</p>
                  <p className="text-xs">Buscá el producto y elegí el lote que querés ajustar.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Tipo de ajuste */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tipo-ajuste-select" className="text-xs font-semibold text-slate-700">
                      Tipo de ajuste
                    </Label>
                    <Select value={tipo} onValueChange={(val) => setTipo(val as TipoAjuste)}>
                      <SelectTrigger id="tipo-ajuste-select" aria-label="Tipo de ajuste" className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_AJUSTE.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            <span className="font-semibold">{t.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">— {t.explicacion}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {tipoObj && (
                      <p className="text-xs text-muted-foreground italic bg-slate-50 p-2 rounded border border-slate-100">
                        {tipoObj.explicacion}
                      </p>
                    )}
                  </div>

                  {/* Cantidad */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cantidad-ajuste-input" className="text-xs font-semibold text-slate-700">
                      Cantidad a ajustar (número positivo)
                    </Label>
                    <Input
                      id="cantidad-ajuste-input"
                      aria-label="Cantidad a ajustar"
                      type="number"
                      step="any"
                      min="0.001"
                      placeholder="0.00"
                      value={cantidad}
                      onChange={(e) => setCantidad(e.target.value)}
                      className="h-10"
                    />
                    {esCantidadInvalida && (
                      <p role="alert" className="text-xs text-destructive font-medium">
                        La cantidad debe ser mayor a 0
                      </p>
                    )}
                  </div>

                  {/* Visualización en vivo de la existencia resultante */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">Existencia actual:</span>
                      <span className="font-mono font-bold text-slate-900">{existenciaActual}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">Operación:</span>
                      <span className="font-semibold text-slate-900">
                        {esEntrada ? `+ ${cantidadValida ? cantidadNum : 0}` : `- ${cantidadValida ? cantidadNum : 0}`}
                      </span>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex items-center justify-between text-sm">
                      <span className="font-bold text-slate-800">Existencia resultante:</span>
                      <span
                        data-testid="existencia-resultante"
                        className={`font-mono font-bold text-base ${
                          existenciaNegativa ? "text-rose-600" : "text-slate-950"
                        }`}
                      >
                        {existenciaResultante}
                      </span>
                    </div>
                  </div>

                  {/* Advertencia si existencia resultante es negativa */}
                  {existenciaNegativa && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                      <span>
                        Advertencia: La existencia resultante sería negativa ({existenciaResultante}). El sistema rechazará este ajuste (RN-MV5).
                      </span>
                    </div>
                  )}

                  {/* Motivo del ajuste */}
                  <div className="space-y-1.5">
                    <Label htmlFor="motivo-ajuste-input" className="text-xs font-semibold text-slate-700">
                      Motivo del ajuste (obligatorio, mínimo 10 caracteres)
                    </Label>
                    <Textarea
                      id="motivo-ajuste-input"
                      aria-label="Motivo del ajuste"
                      placeholder="Explicá claramente la causa del ajuste de stock..."
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      className="min-h-20"
                    />
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{motivo.trim().length} / 10 caracteres (mínimo 10)</span>
                      {!motivoValido && motivo.length > 0 && (
                        <span className="text-amber-600 font-medium">Mínimo 10 caracteres</span>
                      )}
                    </div>
                  </div>

                  {/* Botón de acción */}
                  <Button
                    type="button"
                    disabled={!puedeRegistrar}
                    onClick={() => {
                      setDialogError(null);
                      setDialogConfirmarOpen(true);
                    }}
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold h-11 text-sm mt-2"
                  >
                    Registrar el ajuste
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── ALERT DIALOG IRREVERSIBLE DE CONFIRMACIÓN ─── */}
      <AlertDialog open={dialogConfirmarOpen} onOpenChange={setDialogConfirmarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Registrar el ajuste</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm text-slate-700">
              <span className="block">
                Se registra un movimiento de <strong>{tipo}</strong> por <strong>{cantidadNum}</strong> sobre el lote <strong>{codigoLoteTexto}</strong>.
                La existencia pasa de <strong>{existenciaActual}</strong> a <strong>{existenciaResultante}</strong>.
              </span>
              <span className="block font-medium text-slate-900">
                El movimiento queda asentado en el libro de stock y en la auditoría, y <strong>no se puede borrar</strong>: para corregirlo hay que registrar otro ajuste en sentido contrario.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {dialogError && (
            <p role="alert" className="text-sm text-destructive font-medium my-2">
              {dialogError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={guardandoAjuste}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={guardandoAjuste}
              onClick={(e) => {
                e.preventDefault();
                void ejecutarAjuste();
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {guardandoAjuste ? "Registrando..." : "Confirmar ajuste"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogos de bloqueo/desbloqueo */}
      <BloquearLoteDialog
        lote={loteParaBloqueo}
        open={bloquearOpen}
        onOpenChange={setBloquearOpen}
        onSuccess={({ estado }) => {
          if (loteParaBloqueo) {
            setLotes((prev) =>
              prev.map((l) => (l.id === loteParaBloqueo.id ? { ...l, estado: estado as any } : l)),
            );
            if (loteSeleccionado?.id === loteParaBloqueo.id) {
              setLoteSeleccionado((prev) => (prev ? { ...prev, estado: estado as any } : null));
            }
          }
        }}
      />

      <DesbloquearLoteDialog
        lote={loteParaBloqueo}
        open={desbloquearOpen}
        onOpenChange={setDesbloquearOpen}
        onSuccess={({ estado }) => {
          if (loteParaBloqueo) {
            setLotes((prev) =>
              prev.map((l) => (l.id === loteParaBloqueo.id ? { ...l, estado: estado as any } : l)),
            );
            if (loteSeleccionado?.id === loteParaBloqueo.id) {
              setLoteSeleccionado((prev) => (prev ? { ...prev, estado: estado as any } : null));
            }
          }
        }}
      />
    </div>
  );
}
export default AjustesPage;
