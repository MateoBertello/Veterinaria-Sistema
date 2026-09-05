import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  DollarSign,
  FileText,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
  Truck,
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
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
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
import { formatFechaISO } from "../lib/fechas.ts";
import {
  actualizarCompra,
  agregarItem,
  anularCompra,
  confirmarCompra,
  obtenerCompra,
  quitarItem,
} from "../api/comercial/compras.ts";
import { listarProductos } from "../api/comercial/productos.ts";
import { EstadoCompraBadge } from "./ComprasPage.tsx";
import { formatMoneda } from "./LotesPage.tsx";
import type { Compra, CompraItem, Producto } from "../types/index.ts";

export function CompraDetallePage() {
  const { id } = useParams<{ id: string }>();

  const [compra, setCompra] = useState<Compra | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Catálogo de productos para agregar ítems
  const [productos, setProductos] = useState<Producto[]>([]);

  // Diálogo de agregar ítem
  const [modalItem, setModalItem] = useState(false);
  const [itemProductoId, setItemProductoId] = useState<string>("");
  const [itemCantidad, setItemCantidad] = useState<string>("1");
  const [itemCostoNeto, setItemCostoNeto] = useState<string>("");
  const [itemAlicuota, setItemAlicuota] = useState<string>("21");
  const [itemCodigoLote, setItemCodigoLote] = useState<string>("");
  const [itemFechaVenc, setItemFechaVenc] = useState<string>("");
  const [guardandoItem, setGuardandoItem] = useState(false);
  const [errorModalItem, setErrorModalItem] = useState<string | null>(null);

  // Diálogo Confirmar Compra (§2.1)
  const [modalConfirmar, setModalConfirmar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);

  // Diálogo Anular Compra (§1.4)
  const [modalAnular, setModalAnular] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState<string>("");
  const [anulando, setAnulando] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);

  // Carga de compra
  const cargarCompra = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    setError(null);
    try {
      const data = await obtenerCompra(id);
      setCompra(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar compra");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargarCompra();
  }, [cargarCompra]);

  // Cargar productos vendibles o consumibles para agregar ítems
  useEffect(() => {
    void listarProductos({ activo: true, limit: 100 })
      .then((res) => setProductos(res.items))
      .catch(() => {});
  }, []);

  // Producto seleccionado actualmente en el modal
  const productoActual = useMemo(() => {
    return productos.find((p) => p.id === itemProductoId) ?? null;
  }, [productos, itemProductoId]);

  // Cuando cambia el producto seleccionado en el modal, sugerir valores
  const handleSeleccionarProducto = (prodId: string) => {
    setItemProductoId(prodId);
    const prod = productos.find((p) => p.id === prodId);
    if (prod) {
      setItemAlicuota(String(prod.alicuotaIva ?? 21));
      if (prod.costoReposicion !== null && prod.costoReposicion !== undefined) {
        setItemCostoNeto(String(prod.costoReposicion));
      }
    }
  };

  // Agregar ítem
  const handleAgregarItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    if (!itemProductoId) {
      setErrorModalItem("Seleccione un producto");
      return;
    }

    const cant = parseFloat(itemCantidad);
    if (isNaN(cant) || cant <= 0) {
      setErrorModalItem("La cantidad debe ser mayor a 0");
      return;
    }

    const costo = parseFloat(itemCostoNeto);
    if (isNaN(costo) || costo < 0) {
      setErrorModalItem("El costo unitario neto debe ser mayor o igual a 0");
      return;
    }

    const alic = parseFloat(itemAlicuota);
    if (isNaN(alic) || alic < 0) {
      setErrorModalItem("Alícuota de IVA inválida");
      return;
    }

    if (productoActual?.controlaLote && !itemCodigoLote.trim()) {
      setErrorModalItem("El producto requiere código de lote");
      return;
    }

    if (productoActual?.controlaVencimiento && !itemFechaVenc) {
      setErrorModalItem("El producto requiere fecha de vencimiento");
      return;
    }

    setGuardandoItem(true);
    setErrorModalItem(null);
    try {
      await agregarItem(id, {
        productoId: itemProductoId,
        cantidad: cant,
        costoUnitarioNeto: costo,
        alicuotaIva: alic,
        codigoLote: itemCodigoLote.trim() || null,
        fechaVencimiento: itemFechaVenc || null,
      });

      setModalItem(false);
      // Reset form
      setItemProductoId("");
      setItemCantidad("1");
      setItemCostoNeto("");
      setItemAlicuota("21");
      setItemCodigoLote("");
      setItemFechaVenc("");
      await cargarCompra();
    } catch (err: unknown) {
      setErrorModalItem(err instanceof Error ? err.message : "Error al agregar ítem");
    } finally {
      setGuardandoItem(false);
    }
  };

  // Eliminar ítem
  const handleQuitarItem = async (itemId: string) => {
    if (!id) return;
    try {
      await quitarItem(id, itemId);
      await cargarCompra();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al quitar ítem");
    }
  };

  // Confirmar Compra
  const handleConfirmar = async () => {
    if (!id) return;
    setConfirmando(true);
    setErrorConfirmar(null);
    try {
      await confirmarCompra(id);
      setModalConfirmar(false);
      await cargarCompra();
    } catch (err: unknown) {
      // Error queda dentro del diálogo sin cerrarlo (§2.1)
      setErrorConfirmar(err instanceof Error ? err.message : "Error al confirmar compra");
    } finally {
      setConfirmando(false);
    }
  };

  // Anular Compra
  const handleAnular = async () => {
    if (!id) return;
    if (motivoAnulacion.trim().length < 10) return;
    setAnulando(true);
    setErrorAnular(null);
    try {
      await anularCompra(id, motivoAnulacion.trim());
      setModalAnular(false);
      await cargarCompra();
    } catch (err: unknown) {
      setErrorAnular(err instanceof Error ? err.message : "Error al anular compra");
    } finally {
      setAnulando(false);
    }
  };

  const esBorrador = compra?.estado === "borrador";
  const esConfirmada = compra?.estado === "confirmada";
  const items = compra?.items ?? [];

  // Totales calculados sobre los ítems
  const totalNetoCalculado = useMemo(() => {
    return items.reduce((sum, it) => sum + (it.importeNeto ?? it.cantidad * it.costoUnitarioNeto), 0);
  }, [items]);

  const totalIvaCalculado = useMemo(() => {
    return items.reduce(
      (sum, it) => sum + (it.importeIva ?? (it.cantidad * it.costoUnitarioNeto * it.alicuotaIva) / 100),
      0,
    );
  }, [items]);

  const totalGeneralCalculado = totalNetoCalculado + totalIvaCalculado;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/stock/compras" className="hover:text-foreground">
              Compras
            </Link>
            <span>/</span>
            <span>Detalle</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-orange-600" />
            Detalle de Compra
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/stock/compras">
              <ChevronLeft className="h-4 w-4" />
              Volver a compras
            </Link>
          </Button>

          {/* Acciones según estado */}
          {esBorrador && (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setMotivoAnulacion("");
                  setErrorAnular(null);
                  setModalAnular(true);
                }}
                className="gap-1.5"
              >
                <Ban className="h-4 w-4" />
                Anular compra
              </Button>

              <Button
                size="sm"
                onClick={() => {
                  setErrorConfirmar(null);
                  setModalConfirmar(true);
                }}
                disabled={items.length === 0}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirmar compra
              </Button>
            </>
          )}

          {esConfirmada && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setMotivoAnulacion("");
                setErrorAnular(null);
                setModalAnular(true);
              }}
              className="gap-1.5"
            >
              <Ban className="h-4 w-4" />
              Anular compra
            </Button>
          )}
        </div>
      </div>

      {/* Error general */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Cabecera de la Compra */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-orange-50/70 to-white border-b border-slate-100 py-4 px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100/70 rounded-lg text-orange-800">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-slate-900">
                  {cargando ? (
                    <Skeleton className="h-6 w-48" />
                  ) : (
                    compra?.proveedor?.razonSocial ?? "Proveedor sin nombre"
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  CUIT: <span className="font-mono">{compra?.proveedor?.cuit ?? "—"}</span> · ID Compra:{" "}
                  <span className="font-mono">{id}</span>
                </p>
              </div>
            </div>
            {compra && <EstadoCompraBadge estado={compra.estado} />}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {cargando ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-32" />
                </div>
              ))}
            </div>
          ) : compra ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Fecha
                </span>
                <p className="font-semibold text-slate-900">
                  {compra.fecha ? formatFechaISO(compra.fecha) : "—"}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Comprobante Proveedor
                </span>
                <p className="font-medium text-slate-900">
                  {compra.comprobanteProveedorTipo ? (
                    <span>
                      {compra.comprobanteProveedorTipo}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {compra.comprobanteProveedorNumero ?? ""}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Caja y Egreso
                </span>
                <p className="text-sm font-medium text-slate-900">
                  {compra.generaEgresoCaja ? (
                    <span className="text-amber-800 font-semibold flex items-center gap-1">
                      <DollarSign className="h-4 w-4 text-amber-600" />
                      Registra egreso en caja
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Sin egreso de caja</span>
                  )}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Observaciones
                </span>
                <p className="text-sm text-slate-700">{compra.observaciones ?? "Sin observaciones"}</p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Ítems de la Compra */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-orange-600" />
              Ítems Recibidos ({items.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Mercadería declarada en el comprobante y datos para alta de lotes.
            </p>
          </div>

          {/* Botón agregar ítem solo en BORRADOR */}
          {esBorrador && (
            <Button
              onClick={() => {
                setItemProductoId(productos[0]?.id ?? "");
                setItemCantidad("1");
                setItemCostoNeto(String(productos[0]?.costoReposicion ?? ""));
                setItemAlicuota(String(productos[0]?.alicuotaIva ?? 21));
                setItemCodigoLote("");
                setItemFechaVenc("");
                setErrorModalItem(null);
                setModalItem(true);
              }}
              size="sm"
              className="gap-1.5 bg-orange-600 hover:bg-orange-700 text-white self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" />
              Agregar ítem
            </Button>
          )}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          <TableScrollContainer aria-label="Tabla de ítems de la compra">
            <Table>
              <TableHeader className="bg-orange-50/80">
                <TableRow>
                  <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Costo Neto Unit.</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Alícuota IVA</TableHead>
                  <TableHead className="font-semibold text-slate-700">Lote a Crear</TableHead>
                  <TableHead className="font-semibold text-slate-700">Vencimiento</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Subtotal Neto</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Total c/IVA</TableHead>
                  {esBorrador && (
                    <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: esBorrador ? 9 : 8 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={esBorrador ? 9 : 8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      No se han cargado ítems en este borrador de compra.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((it) => (
                    <TableRow key={it.id} className="hover:bg-slate-50/80">
                      <TableCell>
                        <div>
                          <p className="font-semibold text-slate-900">{it.producto?.nombre ?? "—"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{it.producto?.codigo}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {it.cantidad}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-800">
                        {formatMoneda(it.costoUnitarioNeto)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">
                        {it.alicuotaIva}%
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-slate-800">
                        {it.codigoLote ?? <span className="text-muted-foreground font-normal">S/L</span>}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {it.fechaVencimiento ? formatFechaISO(it.fechaVencimiento.slice(0, 10)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">
                        {formatMoneda(it.importeNeto)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-900">
                        {formatMoneda(it.importeTotal)}
                      </TableCell>
                      {esBorrador && (
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleQuitarItem(it.id)}
                            className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            title="Quitar ítem"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Quitar ítem</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableScrollContainer>

          {/* Resumen de totales al pie de la tabla */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border-t border-slate-200 bg-slate-50/70">
            <span className="text-xs text-muted-foreground">
              Precios expresados en moneda nacional (ARS). Costos cargados en valor neto.
            </span>
            <div className="flex flex-wrap items-center gap-6 self-end sm:self-auto">
              <div className="text-right">
                <span className="text-xs text-muted-foreground block">Subtotal Neto</span>
                <span className="text-sm font-semibold font-mono text-slate-800">
                  {formatMoneda(totalNetoCalculado)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-muted-foreground block">Total IVA</span>
                <span className="text-sm font-semibold font-mono text-slate-800">
                  {formatMoneda(totalIvaCalculado)}
                </span>
              </div>
              <div className="text-right border-l pl-6 border-slate-300">
                <span className="text-xs text-slate-600 font-semibold block uppercase tracking-wider">
                  Total Compra
                </span>
                <span className="text-lg font-bold font-mono text-slate-900">
                  {formatMoneda(totalGeneralCalculado)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Agregar Ítem */}
      <Dialog open={modalItem} onOpenChange={setModalItem}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleAgregarItem}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg text-orange-950">
                <Plus className="h-5 w-5 text-orange-600" />
                Agregar Ítem a la Compra
              </DialogTitle>
              <DialogDescription>
                Cargue el producto, la cantidad y los datos del lote que se creará al confirmar.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {errorModalItem && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-md">
                  {errorModalItem}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="item-producto">Producto *</Label>
                <Select value={itemProductoId} onValueChange={handleSeleccionarProducto}>
                  <SelectTrigger id="item-producto" aria-label="Producto">
                    <SelectValue placeholder="Seleccione un producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {productos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre} ({p.codigo})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {productoActual && (
                  <div className="flex gap-2 text-[11px] text-muted-foreground pt-0.5">
                    {productoActual.controlaLote && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-300">
                        Controla lote
                      </Badge>
                    )}
                    {productoActual.controlaVencimiento && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-300">
                        Controla vencimiento
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="item-cantidad">Cantidad *</Label>
                  <Input
                    id="item-cantidad"
                    type="number"
                    step="any"
                    min="0.001"
                    value={itemCantidad}
                    onChange={(e) => setItemCantidad(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="item-costo">Costo Unit. Neto *</Label>
                  <Input
                    id="item-costo"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={itemCostoNeto}
                    onChange={(e) => setItemCostoNeto(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="item-alicuota">Alícuota IVA</Label>
                  <Select value={itemAlicuota} onValueChange={setItemAlicuota}>
                    <SelectTrigger id="item-alicuota" aria-label="Alícuota IVA">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="10.5">10.5%</SelectItem>
                      <SelectItem value="21">21%</SelectItem>
                      <SelectItem value="27">27%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1.5">
                  <Label htmlFor="item-lote">
                    Código de lote {productoActual?.controlaLote ? "*" : ""}
                  </Label>
                  <Input
                    id="item-lote"
                    placeholder="LOT-..."
                    value={itemCodigoLote}
                    onChange={(e) => setItemCodigoLote(e.target.value)}
                    required={productoActual?.controlaLote}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="item-venc">
                    Fecha de vencimiento {productoActual?.controlaVencimiento ? "*" : ""}
                  </Label>
                  <Input
                    id="item-venc"
                    type="date"
                    value={itemFechaVenc}
                    onChange={(e) => setItemFechaVenc(e.target.value)}
                    required={productoActual?.controlaVencimiento}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalItem(false)}
                disabled={guardandoItem}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={guardandoItem}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {guardandoItem ? "Guardando..." : "Guardar ítem"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AlertDialog Confirmar Compra (§2.1 Operación Irreversible) */}
      <AlertDialog open={modalConfirmar} onOpenChange={setModalConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">¿Confirmar ingreso de compra?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-slate-700">
              <span className="block">
                Se van a crear {items.length} {items.length === 1 ? "lote" : "lotes"} con las cantidades y
                vencimientos cargados, y sus movimientos de entrada en el libro de stock. La compra
                queda confirmada y sus ítems no se pueden volver a editar. No se puede deshacer.
              </span>
              {compra?.generaEgresoCaja && (
                <span className="block font-semibold text-amber-800">
                  Además se registra el egreso de {formatMoneda(totalGeneralCalculado)} en la caja abierta.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errorConfirmar && (
            <p role="alert" className="text-sm font-medium text-rose-600 bg-rose-50 p-3 rounded border border-rose-200">
              {errorConfirmar}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmando}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmar();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {confirmando ? "Confirmando..." : "Confirmar ingreso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog Anular Compra (§1.4) */}
      <AlertDialog open={modalAnular} onOpenChange={setModalAnular}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-900">Anular compra</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-slate-700">
              <span className="block">
                Se revierten los movimientos de stock de esta compra. Los lotes creados quedan sin
                existencia. No se puede deshacer.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="motivo-anular" className="text-xs font-semibold text-slate-700">
              Motivo de anulación (mínimo 10 caracteres) *
            </Label>
            <Textarea
              id="motivo-anular"
              placeholder="Describa el motivo de anulación (mínimo 10 caracteres)..."
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              className="h-20 text-xs"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Mínimo 10 caracteres requeridos</span>
              <span
                className={
                  motivoAnulacion.trim().length >= 10
                    ? "text-emerald-600 font-semibold"
                    : "text-amber-700"
                }
              >
                {motivoAnulacion.trim().length} / 10 caracteres
              </span>
            </div>
          </div>

          {errorAnular && (
            <p role="alert" className="text-sm font-medium text-rose-600 bg-rose-50 p-3 rounded border border-rose-200">
              {errorAnular}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={anulando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={anulando || motivoAnulacion.trim().length < 10}
              onClick={(e) => {
                e.preventDefault();
                void handleAnular();
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {anulando ? "Anulando..." : "Confirmar anulación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
export default CompraDetallePage;
