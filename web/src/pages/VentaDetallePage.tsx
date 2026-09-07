import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Calendar,
  User,
  CreditCard,
  Building2,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext.tsx";
import { obtenerVenta, anularVenta } from "../api/comercial/ventas.ts";
import { registrarDevolucion } from "../api/comercial/ajustes.ts";
import { sesionActual } from "../api/comercial/caja.ts";
import { listarMediosPago } from "../api/catalogos-comercial.ts";
import type {
  MedioPago,
  SesionCaja,
  Venta,
  VentaItem,
  VentaPago,
} from "../types/index.ts";
import { formatMoneda } from "./LotesPage.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";

interface ItemDevolucionState {
  ventaItemId: string;
  incluir: boolean;
  cantidad: number;
  maxCantidad: number;
  revendible: boolean;
  nombre: string;
  precioUnitario: number;
}

export default function VentaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canVoid = Boolean(user?.permissions?.includes("void_sales"));

  const [venta, setVenta] = useState<Venta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sesión de caja abierta actualmente (para imputar egresos de anulación/devolución)
  const [sesionAbierta, setSesionAbierta] = useState<SesionCaja | null>(null);
  const [mediosPago, setMediosPago] = useState<MedioPago[]>([]);

  // Estado del diálogo de Anular
  const [anularOpen, setAnularOpen] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");
  const [loadingAnular, setLoadingAnular] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);

  // Estado del Sheet de Devolución
  const [devolucionOpen, setDevolucionOpen] = useState(false);
  const [itemsDevolucion, setItemsDevolucion] = useState<ItemDevolucionState[]>([]);
  const [motivoDevolucion, setMotivoDevolucion] = useState("");
  const [reintegraEfectivo, setReintegraEfectivo] = useState(false);
  const [confirmarDevolucionOpen, setConfirmarDevolucionOpen] = useState(false);
  const [loadingDevolver, setLoadingDevolver] = useState(false);
  const [errorDevolver, setErrorDevolver] = useState<string | null>(null);

  // Cargar venta y datos complementarios
  const cargarVenta = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [v, sesion, mps] = await Promise.all([
        obtenerVenta(id),
        sesionActual().catch(() => null),
        listarMediosPago().catch(() => []),
      ]);
      setVenta(v);
      setSesionAbierta(sesion);
      setMediosPago(mps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el detalle de la venta");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargarVenta();
  }, [cargarVenta]);

  // Mapa de medios de pago por ID
  const mediosPagoMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const mp of mediosPago) {
      map.set(mp.id, mp.nombre);
    }
    return map;
  }, [mediosPago]);

  // Inicializar estado de ítems para devolución cuando se abre el sheet
  const abrirDevolucion = () => {
    if (!venta) return;
    const itemsState: ItemDevolucionState[] = (venta.items || []).map((it) => {
      const nombre =
        it.descripcionSnapshot ||
        (it.tipoItem === "producto" ? "Producto" : "Servicio");
      return {
        ventaItemId: it.id,
        incluir: false,
        cantidad: it.cantidad,
        maxCantidad: it.cantidad,
        revendible: true,
        nombre,
        precioUnitario: it.precioUnitario,
      };
    });
    setItemsDevolucion(itemsState);
    setMotivoDevolucion("");
    setReintegraEfectivo(Boolean(sesionAbierta));
    setErrorDevolver(null);
    setDevolucionOpen(true);
  };

  // Ítems seleccionados para devolución
  const itemsSeleccionados = useMemo(() => {
    return itemsDevolucion.filter((it) => it.incluir && it.cantidad > 0);
  }, [itemsDevolucion]);

  const totalUnidadesDevolver = useMemo(() => {
    return itemsSeleccionados.reduce((acc, it) => acc + it.cantidad, 0);
  }, [itemsSeleccionados]);

  const totalImporteDevolver = useMemo(() => {
    return itemsSeleccionados.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0);
  }, [itemsSeleccionados]);

  const unidadesRevendibles = useMemo(() => {
    return itemsSeleccionados.filter((it) => it.revendible).reduce((acc, it) => acc + it.cantidad, 0);
  }, [itemsSeleccionados]);

  const unidadesMerma = useMemo(() => {
    return itemsSeleccionados.filter((it) => !it.revendible).reduce((acc, it) => acc + it.cantidad, 0);
  }, [itemsSeleccionados]);

  // Confirmar Anulación
  const handleConfirmarAnulacion = async () => {
    if (!venta || !id) return;
    if (motivoAnulacion.trim().length < 10) {
      setErrorAnular("El motivo de anulación debe tener al menos 10 caracteres.");
      return;
    }
    if (!sesionAbierta) {
      setErrorAnular("Se requiere una sesión de caja abierta para registrar el egreso.");
      return;
    }

    setLoadingAnular(true);
    setErrorAnular(null);
    try {
      await anularVenta(id, {
        sesionCajaId: sesionAbierta.id,
        motivo: motivoAnulacion.trim(),
      });
      setAnularOpen(false);
      setMotivoAnulacion("");
      await cargarVenta();
    } catch (err: unknown) {
      const apiErr = err as { code?: string; message?: string };
      let msg = apiErr.message || "Error al anular la operación";
      if (apiErr.code === "CASH_SESSION_REQUIRED") {
        msg = "Se requiere una sesión de caja abierta para registrar el egreso.";
      } else if (apiErr.code === "ANULATION_REASON_REQUIRED") {
        msg = "El motivo de anulación debe tener al menos 10 caracteres.";
      } else if (apiErr.code === "SALE_ALREADY_VOIDED") {
        msg = "Esta operación ya fue anulada previamente.";
      }
      setErrorAnular(msg);
    } finally {
      setLoadingAnular(false);
    }
  };

  // Confirmar Devolución
  const handleConfirmarDevolucion = async () => {
    if (!venta || !id) return;
    if (itemsSeleccionados.length === 0) return;
    if (motivoDevolucion.trim().length < 10) return;

    setLoadingDevolver(true);
    setErrorDevolver(null);
    try {
      await registrarDevolucion({
        ventaId: id,
        items: itemsSeleccionados.map((it) => ({
          ventaItemId: it.ventaItemId,
          cantidad: it.cantidad,
          revendible: it.revendible,
        })),
        motivo: motivoDevolucion.trim(),
        reintegraEfectivo: reintegraEfectivo,
        sesionCajaId: reintegraEfectivo && sesionAbierta ? sesionAbierta.id : null,
      });

      setConfirmarDevolucionOpen(false);
      setDevolucionOpen(false);
      await cargarVenta();
    } catch (err: unknown) {
      const apiErr = err as { code?: string; message?: string };
      let msg = apiErr.message || "Error al registrar la devolución";
      if (apiErr.code === "CASH_SESSION_REQUIRED") {
        msg = "Se requiere una sesión de caja abierta para reintegrar efectivo.";
      } else if (apiErr.code === "RETURN_QUANTITY_EXCEEDED") {
        msg = "La cantidad a devolver supera la cantidad vendida.";
      }
      setErrorDevolver(msg);
    } finally {
      setLoadingDevolver(false);
    }
  };

  const esAnulada = venta?.estado === "anulada";
  const fechaFmt = venta
    ? new Date(venta.createdAt).toLocaleString("es-AR", {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "";

  return (
    <div className="space-y-6">
      {/* Botón Volver y Barra Superior */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to="/ventas/historial"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" />
              Volver al historial de ventas
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            Detalle de Venta
          </h1>
          {venta && (
            <p className="text-sm font-semibold text-orange-900 font-mono">
              Operación N° {venta.numeroOperacion}
            </p>
          )}
        </div>

        {/* Botones de acción: NO se renderizan si la venta está anulada o aún cargando */}
        {venta && !esAnulada && (
          <div className="flex items-center gap-2">
            {/* Anular: SOLO si tiene permiso void_sales (§1.2, §1.3) */}
            {canVoid && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setErrorAnular(null);
                  setMotivoAnulacion("");
                  setAnularOpen(true);
                }}
                disabled={!sesionAbierta}
                title={
                  !sesionAbierta
                    ? "Requiere una sesión de caja abierta para registrar el egreso"
                    : undefined
                }
              >
                <Ban className="size-4 mr-1.5" />
                Anular operación
              </Button>
            )}

            {/* Devolver */}
            <Button variant="outline" size="sm" onClick={abrirDevolucion}>
              <RotateCcw className="size-4 mr-1.5" />
              Devolver
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error || !venta ? (
        <div className="space-y-4 p-8 text-center">
          <AlertCircle className="size-10 text-destructive mx-auto" />
          <div className="text-lg font-semibold text-destructive">
            {error || "Operación no encontrada"}
          </div>
          <Button asChild variant="outline">
            <Link to="/ventas/historial">Volver al historial</Link>
          </Button>
        </div>
      ) : (
        <>

      {/* Banner de Operación Anulada */}
      {esAnulada && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <Ban className="size-5" />
            Operación Anulada
          </div>
          <p className="text-sm">
            Esta operación fue anulada
            {venta.anuladaAt
              ? ` el ${new Date(venta.anuladaAt).toLocaleString("es-AR")}`
              : ""}
            .
            {venta.anuladaMotivo && (
              <span className="block mt-1 font-medium">
                Motivo: {venta.anuladaMotivo}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Metadatos de la Venta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Calendar className="size-3.5" />
            Fecha y hora
          </div>
          <div className="text-sm font-medium">{fechaFmt}</div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <User className="size-3.5" />
            Cliente
          </div>
          <div className="text-sm font-medium">
            {venta.cliente?.full_name || "Mostrador (Anónimo)"}
          </div>
          {venta.cliente?.dni_cuit && (
            <div className="text-xs text-muted-foreground font-mono">
              DNI/CUIT: {venta.cliente.dni_cuit}
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <User className="size-3.5" />
            Vendedor
          </div>
          <div className="text-sm font-medium">{venta.usuario?.full_name || "—"}</div>
          {venta.usuario?.email && (
            <div className="text-xs text-muted-foreground">{venta.usuario.email}</div>
          )}
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="size-3.5" />
            Condición y Estado
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">
              {venta.condicionPago === "contado" ? "Contado" : "Cuenta Corriente"}
            </span>
            <Badge
              variant={esAnulada ? "destructive" : "default"}
              className={esAnulada ? "" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
            >
              {venta.estado}
            </Badge>
          </div>
        </Card>
      </div>

      {/* Detalle de Ítems */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Ítems de la Operación</CardTitle>
          <CardDescription>
            Detalle de productos y servicios incluidos en esta venta.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-semibold">Descripción</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Cant.</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Precio Unit.</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Desc. %</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Subtotal Neto</TableHead>
                  <TableHead className="text-xs font-semibold text-right">IVA</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {venta.items.map((item, idx) => {
                  // Sin fallbacks snake_case: toVenta (api/comercial/ventas.ts) normaliza
                  // estos cuatro campos incondicionalmente antes de que la fila llegue acá.
                  const desc =
                    item.descripcionSnapshot ||
                    (item.tipoItem === "producto" ? "Producto" : "Servicio");
                  const motivoFefo = item.motivoFefo || null;
                  const loteInfo = item.lote?.codigoLote || null;
                  const venceInfo = item.lote?.fechaVencimiento || null;

                  return (
                    <TableRow key={item.id || idx}>
                      <TableCell className="space-y-1">
                        <div className="font-medium text-sm text-foreground">{desc}</div>
                        {loteInfo && (
                          <div className="text-xs text-muted-foreground font-mono">
                            Lote: {loteInfo} {venceInfo ? `(Vence: ${venceInfo})` : ""}
                          </div>
                        )}
                        {/* §2.2: si la línea tiene motivo_fefo, se muestra claramente */}
                        {motivoFefo && (
                          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 inline-block">
                            <span className="font-semibold">Excepción FEFO:</span> {motivoFefo}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {item.cantidad}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {formatMoneda(item.precioUnitario)}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {item.descuentoPorcentaje ?? 0}%
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {formatMoneda(item.subtotalNeto)}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-right">
                        {formatMoneda(item.importeIva)}{" "}
                        <span className="text-muted-foreground">({item.alicuotaIva}%)</span>
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium text-right">
                        {formatMoneda(item.totalLinea)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Desglose de Totales y Pagos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Pagos Realizados */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Pagos Registrados</CardTitle>
            <CardDescription>
              Medios de pago utilizados en esta operación.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {venta.pagos.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No se registraron pagos inmediatos (operación a cuenta corriente).
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Medio de Pago</TableHead>
                    <TableHead className="text-xs font-semibold">Referencia</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {venta.pagos.map((p, idx) => {
                    const nombreMedio =
                      mediosPagoMap.get(p.medioPagoId) || "Medio de pago";
                    return (
                      <TableRow key={p.id || idx}>
                        <TableCell className="text-xs font-medium">{nombreMedio}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {p.referencia || "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold text-right">
                          {formatMoneda(p.importe)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Totales y Desglose Neto / IVA (§1.2) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Resumen de Importes</CardTitle>
            <CardDescription>
              Desglose impositivo y total final de la operación.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Subtotal Neto:</span>
              <span className="font-mono font-medium">{formatMoneda(venta.subtotalNeto)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Total IVA:</span>
              <span className="font-mono font-medium">{formatMoneda(venta.totalIva)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between items-baseline">
              <span className="text-base font-bold text-orange-950">Total con IVA:</span>
              <span className="text-2xl font-bold font-mono text-orange-900">
                {formatMoneda(venta.total)}
              </span>
            </div>
            {venta.saldoPendiente > 0 && (
              <div className="border-t pt-2 flex justify-between items-center text-sm">
                <span className="text-amber-700 font-medium">Saldo Pendiente:</span>
                <span className="font-mono font-bold text-amber-700">
                  {formatMoneda(venta.saldoPendiente)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Diálogo de Confirmación: Anular Operación (§1.3, §2.1) */}
      <AlertDialog open={anularOpen} onOpenChange={setAnularOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="size-5" />
              Anular la operación N° {venta.numeroOperacion}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm text-foreground">
              <p>
                Se reintegra el stock a los lotes de los que salió, se registra el egreso
                de {formatMoneda(venta.total)} en la caja abierta y la operación queda
                marcada como anulada. El motivo queda asentado en la auditoría.{" "}
                <strong>No se puede deshacer.</strong>
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="motivo-anulacion" className="text-xs font-medium">
                Motivo de anulación (mínimo 10 caracteres) *
              </Label>
              <Textarea
                id="motivo-anulacion"
                placeholder="Explicá el motivo de la anulación..."
                value={motivoAnulacion}
                onChange={(e) => setMotivoAnulacion(e.target.value)}
                rows={3}
                className="text-xs"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Mínimo 10 caracteres</span>
                <span
                  className={
                    motivoAnulacion.trim().length < 10
                      ? "text-destructive font-medium"
                      : "text-emerald-600 font-medium"
                  }
                >
                  {motivoAnulacion.trim().length} / 10
                </span>
              </div>
            </div>

            {/* Error dentro del diálogo (§2.1) */}
            {errorAnular && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorAnular}</span>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingAnular}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmarAnulacion()}
              disabled={loadingAnular || motivoAnulacion.trim().length < 10}
            >
              {loadingAnular ? "Anulando..." : "Confirmar anulación"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sheet de Devolución (§1.4) */}
      <Sheet open={devolucionOpen} onOpenChange={setDevolucionOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-orange-950 flex items-center gap-2">
              <RotateCcw className="size-5 text-orange-600" />
              Registrar Devolución
            </SheetTitle>
            <SheetDescription>
              Seleccioná los ítems a devolver de la Operación N° {venta.numeroOperacion}.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 py-4">
            {/* Lista de Ítems */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ítems de la venta
              </Label>
              <div className="space-y-3">
                {itemsDevolucion.map((it, idx) => (
                  <div
                    key={it.ventaItemId}
                    className="p-3 rounded-lg border bg-card space-y-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        id={`dev-check-${idx}`}
                        checked={it.incluir}
                        onCheckedChange={(ch) =>
                          setItemsDevolucion((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, incluir: Boolean(ch) } : item,
                            ),
                          )
                        }
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <Label
                          htmlFor={`dev-check-${idx}`}
                          className="font-medium text-xs text-foreground block cursor-pointer"
                        >
                          {it.nombre}
                        </Label>
                        <div className="text-[11px] text-muted-foreground">
                          Vendido: {it.maxCantidad} u. a {formatMoneda(it.precioUnitario)}
                        </div>
                      </div>
                    </div>

                    {it.incluir && (
                      <div className="pl-6 pt-2 border-t space-y-2">
                        {/* Cantidad */}
                        <div className="flex items-center gap-3">
                          <Label className="text-xs text-muted-foreground w-20">
                            Cantidad:
                          </Label>
                          <Input
                            type="number"
                            min={0.001}
                            max={it.maxCantidad}
                            step="any"
                            value={it.cantidad}
                            onChange={(e) => {
                              const val = Math.min(
                                it.maxCantidad,
                                Math.max(0, parseFloat(e.target.value) || 0),
                              );
                              setItemsDevolucion((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, cantidad: val } : item,
                                ),
                              );
                            }}
                            className="h-8 w-24 text-xs font-mono text-center"
                          />
                          <span className="text-xs text-muted-foreground">
                            / {it.maxCantidad} máx.
                          </span>
                        </div>

                        {/* Switch Revendible (§1.4) */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Revendible</Label>
                            <p className="text-[11px] text-muted-foreground leading-tight">
                              Revendible reintegra la unidad al stock. Si no lo es, se registra como merma.
                            </p>
                          </div>
                          <Switch
                            checked={it.revendible}
                            onCheckedChange={(val) =>
                              setItemsDevolucion((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, revendible: val } : item,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Motivo de devolución */}
            <div className="space-y-1">
              <Label htmlFor="motivo-devolucion" className="text-xs font-semibold">
                Motivo de devolución (mínimo 10 caracteres) *
              </Label>
              <Textarea
                id="motivo-devolucion"
                placeholder="Explicá el motivo de la devolución..."
                value={motivoDevolucion}
                onChange={(e) => setMotivoDevolucion(e.target.value)}
                rows={3}
                className="text-xs"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Mínimo 10 caracteres</span>
                <span
                  className={
                    motivoDevolucion.trim().length < 10
                      ? "text-destructive font-medium"
                      : "text-emerald-600 font-medium"
                  }
                >
                  {motivoDevolucion.trim().length} / 10
                </span>
              </div>
            </div>

            {/* Reintegrar efectivo desde caja abierta */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium">Reintegrar efectivo</Label>
                <p className="text-[11px] text-muted-foreground">
                  {sesionAbierta
                    ? `Registra el egreso de ${formatMoneda(totalImporteDevolver)} en la caja abierta.`
                    : "Requiere una sesión de caja abierta para reintegrar efectivo."}
                </p>
              </div>
              <Switch
                checked={reintegraEfectivo}
                onCheckedChange={setReintegraEfectivo}
                disabled={!sesionAbierta}
              />
            </div>

            {/* Error dentro del sheet */}
            {errorDevolver && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorDevolver}</span>
              </div>
            )}

            <Button
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => setConfirmarDevolucionOpen(true)}
              disabled={
                itemsSeleccionados.length === 0 ||
                motivoDevolucion.trim().length < 10
              }
            >
              Continuar a confirmación
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* AlertDialog de Confirmación de Devolución (§1.4, §2.1) */}
      <AlertDialog open={confirmarDevolucionOpen} onOpenChange={setConfirmarDevolucionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-orange-950 flex items-center gap-2">
              <RotateCcw className="size-5 text-orange-600" />
              Registrar la devolución
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm text-foreground">
              <p>
                Se devuelven {totalUnidadesDevolver} unidades de la operación N° {venta.numeroOperacion}.{" "}
                Las marcadas como revendibles vuelven al stock; las demás se registran como merma.{" "}
                {reintegraEfectivo && sesionAbierta && (
                  <span>
                    Se reintegran {formatMoneda(totalImporteDevolver)} en efectivo desde la caja abierta.{" "}
                  </span>
                )}
                La devolución queda asentada y <strong>no se puede deshacer</strong>.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Resumen cuantitativo */}
          <div className="bg-muted/40 p-3 rounded-lg space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unidades revendibles:</span>
              <span className="font-semibold text-emerald-700">{unidadesRevendibles}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unidades registradas como merma:</span>
              <span className="font-semibold text-amber-700">{unidadesMerma}</span>
            </div>
            {reintegraEfectivo && (
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Egreso efectivo a registrar:</span>
                <span className="font-mono text-orange-900">{formatMoneda(totalImporteDevolver)}</span>
              </div>
            )}
          </div>

          {errorDevolver && (
            <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2"
              >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorDevolver}</span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingDevolver}>Volver</AlertDialogCancel>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => void handleConfirmarDevolucion()}
              disabled={loadingDevolver}
            >
              {loadingDevolver ? "Registrando..." : "Confirmar devolución"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
      )}
    </div>
  );
}
