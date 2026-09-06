import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileBox,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/AuthContext.tsx";
import {
  disponibilidad,
  porEvento,
  registrar,
} from "../../api/comercial/consumo.ts";
import { listarProductos } from "../../api/comercial/productos.ts";
import { candidatosFefo } from "../../api/comercial/stock.ts";
import { listarDoctores } from "../../api/doctores.ts";
import { SelectorLoteFefo } from "../comercial/SelectorLoteFefo.tsx";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import {
  ApiError,
  type Doctor,
  type LoteCandidato,
  type MovimientoStock,
  type Producto,
  type RegistrarConsumoInput,
} from "../../types/index.ts";

export interface ConsumoInsumosWidgetProps {
  historialId: string;
  profesionalPrescriptorId?: string | null;
  profesionalNombre?: string | null;
  planVacunacionId?: string | null;
}

interface ItemConsumoForm {
  uid: string;
  productoId: string;
  productoNombre: string;
  codigo?: string | null;
  cantidad: number;
  candidatos: LoteCandidato[];
  loadingLotes: boolean;
  sinStock: boolean;
  stockInsuficiente: boolean;
  loteId: string | null;
  loteSugeridoId: string | null;
  motivoFefo: string;
}

function formatearMensajeError(code?: string, fallback?: string): string {
  switch (code) {
    case "INSUFFICIENT_STOCK":
      return "Stock insuficiente para realizar el consumo clínico.";
    case "PRODUCT_NOT_FOUND":
      return "Producto no encontrado.";
    case "PRODUCT_INACTIVE":
      return "El producto se encuentra inactivo y no puede ser consumido.";
    default:
      return fallback || "Error al registrar el consumo clínico.";
  }
}

export function ConsumoInsumosWidget({
  historialId,
  profesionalPrescriptorId,
  profesionalNombre,
  planVacunacionId,
}: ConsumoInsumosWidgetProps) {
  const { user } = useAuth();
  const canViewStock = Boolean(user?.permissions?.includes("view_stock"));
  const canConsumeStock = Boolean(user?.permissions?.includes("consume_stock"));

  const [consumos, setConsumos] = useState<MovimientoStock[]>([]);
  const [loadingConsumos, setLoadingConsumos] = useState(false);
  const [errorConsumos, setErrorConsumos] = useState<string | null>(null);

  // Estado del formulario (Sheet)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Campos de formulario
  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [profesionalId, setProfesionalId] = useState<string | null>(
    profesionalPrescriptorId || null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Producto[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [items, setItems] = useState<ItemConsumoForm[]>([]);
  const [productoSinStockAviso, setProductoSinStockAviso] = useState<string | null>(null);

  // 1. Cargar consumos registrados
  const cargarConsumos = useCallback(async () => {
    if (!canViewStock || !historialId) return;
    setLoadingConsumos(true);
    setErrorConsumos(null);
    try {
      const data = await porEvento(historialId);
      setConsumos(data || []);
    } catch (err) {
      setErrorConsumos(
        err instanceof ApiError ? err.message : "Error al cargar consumos de la atención",
      );
    } finally {
      setLoadingConsumos(false);
    }
  }, [canViewStock, historialId]);

  useEffect(() => {
    if (canViewStock) {
      void cargarConsumos();
    }
  }, [canViewStock, cargarConsumos]);

  // Cargar doctores disponibles para el select opcional de profesional prescriptor
  useEffect(() => {
    if (!sheetOpen) return;
    listarDoctores({ professional: true, limit: 100 })
      .then((res) => {
        setDoctores(res.items);
        if (!profesionalId && profesionalNombre) {
          const doc = res.items.find((d) => d.name === profesionalNombre);
          if (doc?.userId) {
            setProfesionalId(doc.userId);
          }
        }
      })
      .catch(() => setDoctores([]));
  }, [sheetOpen, profesionalId, profesionalNombre]);

  // Búsqueda de consumibles clínicos en el cliente
  useEffect(() => {
    if (!sheetOpen) return;
    let cancel = false;
    setSearchingProducts(true);
    setProductoSinStockAviso(null);

    const timer = setTimeout(() => {
      // Filtrá en el cliente por esConsumibleClinico (la API no tiene ese filtro)
      listarProductos({ search: searchQuery.trim() || undefined, activo: true, limit: 50 })
        .then((res) => {
          if (cancel) return;
          const consumibles = res.items.filter((p) => Boolean(p.esConsumibleClinico));
          setSearchResults(consumibles);
        })
        .catch(() => {
          if (!cancel) setSearchResults([]);
        })
        .finally(() => {
          if (!cancel) setSearchingProducts(false);
        });
    }, 250);

    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [searchQuery, sheetOpen]);

  // Consultar candidatos FEFO para un ítem
  const consultarCandidatos = useCallback(
    async (productoId: string, cantidad: number, uid: string) => {
      try {
        const lotes = await candidatosFefo({ productoId, cantidad });
        setItems((prev) =>
          prev.map((it) => {
            if (it.uid !== uid) return it;
            if (!lotes || lotes.length === 0) {
              return {
                ...it,
                loadingLotes: false,
                candidatos: [],
                sinStock: true,
                loteId: null,
                loteSugeridoId: null,
                motivoFefo: "",
              };
            }
            const primerLote = lotes[0];
            const sumaStock = lotes.reduce(
              (acc, l) => acc + (Number(l.cantidadDisponible) || 0),
              0,
            );
            return {
              ...it,
              loadingLotes: false,
              candidatos: lotes,
              sinStock: false,
              stockInsuficiente: sumaStock < cantidad,
              loteId: primerLote.loteId,
              loteSugeridoId: primerLote.loteId,
              motivoFefo: "",
            };
          }),
        );
      } catch {
        setItems((prev) =>
          prev.map((it) => (it.uid === uid ? { ...it, loadingLotes: false } : it)),
        );
      }
    },
    [],
  );

  // Agregar producto al formulario
  const handleSeleccionarProducto = async (producto: Producto) => {
    setProductoSinStockAviso(null);
    setSubmitError(null);

    // Disponibilidad: GET /consumos/disponibilidad?productoId= antes de agregar
    try {
      const disp = await disponibilidad(producto.id);
      const totalDisponible = (disp || []).reduce(
        (acc, item) => acc + (Number(item.cantidad) || 0),
        0,
      );

      if (totalDisponible <= 0) {
        setProductoSinStockAviso(`El producto ${producto.nombre} no tiene stock disponible.`);
        // También marcamos en la lista si ya estaba o alertamos
        return;
      }
    } catch {
      // Si falla la verificación previa, se continúa y FEFO definirá existencia
    }

    const uid = `${producto.id}-${Date.now()}`;
    const nuevoItem: ItemConsumoForm = {
      uid,
      productoId: producto.id,
      productoNombre: producto.nombre,
      codigo: producto.codigo,
      cantidad: 1,
      candidatos: [],
      loadingLotes: true,
      sinStock: false,
      stockInsuficiente: false,
      loteId: null,
      loteSugeridoId: null,
      motivoFefo: "",
    };

    setItems((prev) => [...prev, nuevoItem]);
    void consultarCandidatos(producto.id, 1, uid);
  };

  const actualizarCantidad = (uid: string, cantidad: number) => {
    const it = items.find((i) => i.uid === uid);
    if (cantidad > 0 && it) {
      setItems((prev) =>
        prev.map((i) => (i.uid === uid ? { ...i, cantidad, loadingLotes: true } : i)),
      );
      void consultarCandidatos(it.productoId, cantidad, uid);
    } else {
      setItems((prev) =>
        prev.map((i) => (i.uid === uid ? { ...i, cantidad } : i)),
      );
    }
  };

  const seleccionarLote = (uid: string, loteId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.uid !== uid) return it;
        const esSugerido = it.loteSugeridoId === loteId;
        return {
          ...it,
          loteId,
          motivoFefo: esSugerido ? "" : it.motivoFefo || "",
        };
      }),
    );
  };

  const actualizarMotivoFefo = (uid: string, motivo: string) => {
    setItems((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, motivoFefo: motivo } : it)),
    );
  };

  const eliminarItem = (uid: string) => {
    setItems((prev) => prev.filter((it) => it.uid !== uid));
  };

  // Validación para el botón de registrar
  const hayItems = items.length > 0;
  const algunSinStock = items.some((it) => it.sinStock);
  const algunSinCantidad = items.some((it) => !it.cantidad || it.cantidad <= 0);
  const algunCargando = items.some((it) => it.loadingLotes);
  const algunFaltaMotivo = items.some(
    (it) =>
      it.loteId &&
      it.loteSugeridoId &&
      it.loteId !== it.loteSugeridoId &&
      (!it.motivoFefo || !it.motivoFefo.trim()),
  );

  const puedeRegistrar =
    hayItems &&
    !algunSinStock &&
    !algunSinCantidad &&
    !algunCargando &&
    !algunFaltaMotivo &&
    !submitting;

  // Cantidad y lotes para el diálogo de confirmación
  const totalUnidades = useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0),
    [items],
  );
  const totalLotes = useMemo(
    () => new Set(items.map((it) => it.loteId).filter(Boolean)).size || items.length,
    [items],
  );

  // Confirmar y enviar consumo clínico
  const handleConfirmarEnvio = async () => {
    setSubmitting(true);
    setSubmitError(null);

    // Body NO lleva tenantId
    const payload: RegistrarConsumoInput = {
      historialId,
      profesionalPrescriptorId: profesionalId || null,
      planVacunacionId: planVacunacionId || null,
      recetaId: null,
      items: items.map((it) => ({
        productoId: it.productoId,
        cantidad: it.cantidad,
        loteId: it.loteId || null,
        motivoFefo:
          it.loteId !== it.loteSugeridoId ? it.motivoFefo?.trim() || null : null,
      })),
    };

    try {
      await registrar(payload);
      toast.success("Consumo de insumos registrado correctamente");
      setConfirmOpen(false);
      setSheetOpen(false);
      setItems([]);
      setSearchQuery("");
      void cargarConsumos();
    } catch (err) {
      setConfirmOpen(false);
      // El formulario no se limpia ante un error
      if (err instanceof ApiError) {
        setSubmitError(formatearMensajeError(err.code, err.message));
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Ocurrió un error inesperado al registrar el consumo.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Sin view_stock, el widget no se renderiza
  if (!canViewStock) {
    return null;
  }

  return (
    <div className="rounded-md border bg-slate-50/50 p-3 space-y-3 mt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-orange-700" aria-hidden />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Insumos clínicos utilizados
          </h4>
        </div>
        {canConsumeStock && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-orange-300 text-orange-800 hover:bg-orange-50"
            onClick={() => {
              setSubmitError(null);
              setProductoSinStockAviso(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="size-3.5 mr-1" aria-hidden />
            Registrar insumos
          </Button>
        )}
      </div>

      {loadingConsumos ? (
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : errorConsumos ? (
        <div className="text-xs text-destructive flex items-center justify-between p-2 rounded bg-destructive/10">
          <span>{errorConsumos}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => void cargarConsumos()}
          >
            Reintentar
          </Button>
        </div>
      ) : consumos.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-1">
          No se registraron insumos en esta atención.
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          {consumos.map((c) => {
            const prodNombre =
              c.producto?.nombre ||
              (c as any).productos?.nombre ||
              (c as any).productoNombre ||
              "Insumo";
            const loteCodigo =
              c.lote?.codigoLote ||
              (c as any).lotes?.codigo_lote ||
              (c as any).lotes?.codigoLote ||
              (c as any).codigoLote ||
              "Sin lote";
            const motivoFefo = c.motivo || (c as any).motivoFefo || (c as any).motivo_fefo;

            return (
              <li
                key={c.id}
                className="p-2 rounded bg-white border border-slate-200 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{prodNombre}</span>
                  <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                    Cant: {c.cantidad}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
                  <span>Lote: <strong className="font-mono">{loteCodigo}</strong></span>
                </div>
                {motivoFefo && (
                  <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                    <span className="font-semibold">Motivo FEFO:</span> {motivoFefo}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sheet para registrar insumos clínicos */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto space-y-4">
          <SheetHeader>
            <SheetTitle className="text-lg font-semibold text-orange-800 flex items-center gap-2">
              <Package className="size-5" aria-hidden />
              Registrar consumo de insumos
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Registrá los medicamentos e insumos aplicados en esta consulta clínica.
            </SheetDescription>
          </SheetHeader>

          {/* Errores de API (el formulario no se limpia ante error) */}
          {submitError && (
            <Alert variant="destructive" role="alert" className="py-2 text-xs">
              <AlertCircle className="size-4" aria-hidden />
              <AlertTitle className="text-xs font-semibold">Error al registrar</AlertTitle>
              <AlertDescription className="text-xs">{submitError}</AlertDescription>
            </Alert>
          )}

          {/* Advertencia de producto sin stock */}
          {productoSinStockAviso && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="size-4" aria-hidden />
              <AlertDescription className="text-xs">{productoSinStockAviso}</AlertDescription>
            </Alert>
          )}

          {/* Contexto: Profesional prescriptor */}
          <div className="space-y-1">
            <Label htmlFor="profesional-prescriptor" className="text-xs font-medium text-slate-700">
              Profesional prescriptor (opcional)
            </Label>
            <Select
              value={profesionalId || "ninguno"}
              onValueChange={(val) => setProfesionalId(val === "ninguno" ? null : val)}
            >
              <SelectTrigger id="profesional-prescriptor" className="h-8 text-xs">
                <SelectValue placeholder="Seleccionar profesional prescriptor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguno">Sin prescriptor asignado</SelectItem>
                {doctores.map((doc) => (
                  <SelectItem key={doc.id} value={doc.userId || doc.id}>
                    {doc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Buscador de insumos consumibles */}
          <div className="space-y-2 border-t pt-3">
            <Label htmlFor="buscar-consumible" className="text-xs font-medium text-slate-700">
              Buscar insumo consumible
            </Label>
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden />
              <Input
                id="buscar-consumible"
                aria-label="Buscar producto consumible"
                type="text"
                placeholder="Buscar por nombre o código..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            {/* Resultados de búsqueda */}
            {searchingProducts ? (
              <div className="space-y-1 p-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="max-h-40 overflow-y-auto rounded-md border bg-white divide-y text-xs">
                {searchResults.map((prod) => (
                  <div
                    key={prod.id}
                    className="flex items-center justify-between p-2 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{prod.nombre}</p>
                      {prod.codigo && (
                        <p className="text-[10px] text-muted-foreground font-mono">{prod.codigo}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => void handleSeleccionarProducto(prod)}
                    >
                      <Plus className="size-3 mr-1" aria-hidden />
                      Agregar
                    </Button>
                  </div>
                ))}
              </div>
            ) : searchQuery.trim().length > 0 ? (
              <p className="text-xs text-muted-foreground p-2 text-center">
                No se encontraron consumibles clínicos activos.
              </p>
            ) : null}
          </div>

          {/* Lista de insumos a registrar */}
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Ítems a registrar ({items.length})
              </h5>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-6 border border-dashed rounded-md bg-slate-50/50">
                <FileBox className="size-6 text-muted-foreground mx-auto mb-1 opacity-50" aria-hidden />
                <p className="text-xs text-muted-foreground">
                  Buscá y seleccioná los insumos aplicados en la atención.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <Card key={item.uid} className="p-3 bg-white border border-slate-200">
                    <CardContent className="p-0 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">{item.productoNombre}</p>
                          {item.codigo && (
                            <p className="text-[10px] font-mono text-muted-foreground">{item.codigo}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => eliminarItem(item.uid)}
                          aria-label={`Eliminar ${item.productoNombre}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>

                      {/* Cantidad */}
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`cant-${item.uid}`} className="text-[11px] font-medium text-muted-foreground">
                          Cantidad:
                        </Label>
                        <Input
                          id={`cant-${item.uid}`}
                          aria-label={`Cantidad para ${item.productoNombre}`}
                          type="number"
                          min="0.001"
                          step="any"
                          value={item.cantidad || ""}
                          onChange={(e) => actualizarCantidad(item.uid, Number(e.target.value))}
                          className="h-7 w-24 text-xs font-mono"
                        />
                      </div>

                      {/* Selector de Lote con FEFO */}
                      <SelectorLoteFefo
                        candidatos={item.candidatos}
                        loadingLotes={item.loadingLotes}
                        sinStock={item.sinStock}
                        stockInsuficiente={item.stockInsuficiente}
                        loteId={item.loteId}
                        loteSugeridoId={item.loteSugeridoId}
                        motivoFefo={item.motivoFefo}
                        nombreProducto={item.productoNombre}
                        mensajeSinMotivo="Debés especificar un motivo para poder registrar el consumo."
                        onSeleccionarLote={(loteId) => seleccionarLote(item.uid, loteId)}
                        onActualizarMotivoFefo={(motivo) => actualizarMotivoFefo(item.uid, motivo)}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <SheetFooter className="border-t pt-3 flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSheetOpen(false)}
              disabled={submitting}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-orange-700 hover:bg-orange-800 text-white"
              disabled={!puedeRegistrar}
              onClick={() => setConfirmOpen(true)}
            >
              Registrar consumo
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Diálogo modal de confirmación (§1.5) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar consumo clínico</AlertDialogTitle>
            <AlertDialogDescription>
              Se descuentan {totalUnidades} unidades de {totalLotes} lotes y quedan registradas en
              esta atención. El movimiento queda asentado en el libro de stock.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              className="bg-orange-700 hover:bg-orange-800 text-white"
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmarEnvio();
              }}
            >
              {submitting ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Confirmar consumo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
