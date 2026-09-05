import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  GitFork,
  History,
  Info,
  Layers,
  Package,
  TrendingDown,
  TrendingUp,
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
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { formatFechaISO } from "../lib/fechas.ts";
import { kardex, obtenerLote, trazabilidad } from "../api/comercial/stock.ts";
import { EstadoLoteBadge, formatMoneda } from "./LotesPage.tsx";
import type {
  ApiMeta,
  KardexMovimiento,
  Lote,
  TipoMovimientoStock,
  TrazabilidadNodo,
} from "../types/index.ts";

const PAGE_SIZE_KARDEX = 20;

function TipoMovimientoBadge({ tipo }: { tipo: TipoMovimientoStock | string }) {
  const esEntrada = tipo.startsWith("entrada_");

  const labelMap: Record<string, string> = {
    entrada_compra: "Compra",
    entrada_ajuste: "Ajuste (+)",
    entrada_fraccionamiento: "Fracc. (hijo)",
    entrada_inicial: "Stock Inicial",
    entrada_devolucion: "Devolución",
    salida_venta: "Venta",
    salida_consumo_clinico: "Consumo Clínico",
    salida_ajuste: "Ajuste (-)",
    salida_fraccionamiento: "Fracc. (origen)",
    salida_vencimiento: "Vencimiento",
    salida_merma: "Merma / Rotura",
  };

  const label = labelMap[tipo] ?? tipo;

  if (esEntrada) {
    return (
      <Badge
        variant="outline"
        className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium inline-flex items-center gap-1"
      >
        <TrendingUp className="h-3 w-3 text-emerald-600" />
        {label}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="bg-rose-50 text-rose-700 border-rose-300 font-medium inline-flex items-center gap-1"
    >
      <TrendingDown className="h-3 w-3 text-rose-600" />
      {label}
    </Badge>
  );
}

export function LoteDetallePage() {
  const { id } = useParams<{ id: string }>();

  // Bloque 1: Ficha del Lote
  const [lote, setLote] = useState<Lote | null>(null);
  const [loteCargando, setLoteCargando] = useState(true);
  const [loteError, setLoteError] = useState<string | null>(null);

  // Bloque 2: Kardex
  const [movimientos, setMovimientos] = useState<KardexMovimiento[]>([]);
  const [kardexMeta, setKardexMeta] = useState<ApiMeta | null>(null);
  const [kardexCargando, setKardexCargando] = useState(true);
  const [kardexError, setKardexError] = useState<string | null>(null);
  const [kardexPage, setKardexPage] = useState(1);

  // Bloque 3: Trazabilidad
  const [nodosTrazabilidad, setNodosTrazabilidad] = useState<TrazabilidadNodo[]>([]);
  const [trazabilidadCargando, setTrazabilidadCargando] = useState(true);
  const [trazabilidadError, setTrazabilidadError] = useState<string | null>(null);

  // Carga de ficha
  const cargarLote = useCallback(async () => {
    if (!id) return;
    setLoteCargando(true);
    setLoteError(null);
    try {
      const data = await obtenerLote(id);
      setLote(data);
    } catch (err: unknown) {
      setLoteError(err instanceof Error ? err.message : "Error al cargar ficha de lote");
    } finally {
      setLoteCargando(false);
    }
  }, [id]);

  // Carga de kardex
  const cargarKardex = useCallback(async () => {
    if (!id) return;
    setKardexCargando(true);
    setKardexError(null);
    try {
      const res = await kardex(id, { page: kardexPage, limit: PAGE_SIZE_KARDEX });
      setMovimientos(res.items);
      setKardexMeta(res.meta);
    } catch (err: unknown) {
      setKardexError(err instanceof Error ? err.message : "Error al cargar kardex");
    } finally {
      setKardexCargando(false);
    }
  }, [id, kardexPage]);

  // Carga de trazabilidad
  const cargarTrazabilidad = useCallback(async () => {
    if (!id) return;
    setTrazabilidadCargando(true);
    setTrazabilidadError(null);
    try {
      const data = await trazabilidad(id);
      setNodosTrazabilidad(data);
    } catch (err: unknown) {
      setTrazabilidadError(err instanceof Error ? err.message : "Error al cargar trazabilidad");
    } finally {
      setTrazabilidadCargando(false);
    }
  }, [id]);

  useEffect(() => {
    void cargarLote();
  }, [cargarLote]);

  useEffect(() => {
    void cargarKardex();
  }, [cargarKardex]);

  useEffect(() => {
    void cargarTrazabilidad();
  }, [cargarTrazabilidad]);

  // Nodos vinculados distintos al nodo actual
  const nodosVinculados = nodosTrazabilidad.filter((n) => n.loteId !== id);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-8">
      {/* Header con navegación de vuelta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/stock/existencias" className="hover:text-foreground">
              Existencias
            </Link>
            <span>/</span>
            <span>Detalle de Lote</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <Layers className="h-6 w-6 text-orange-600" />
            Detalle de Lote
          </h1>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5 self-start">
          <Link to="/stock/existencias">
            <ChevronLeft className="h-4 w-4" />
            Volver a Existencias
          </Link>
        </Button>
      </div>

      {/* Error general si falla la ficha */}
      {loteError && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <span>{loteError}</span>
        </div>
      )}

      {/* ─── BLOQUE 1: FICHA TÉCNICA ─── */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-orange-50/70 to-white border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100/70 rounded-lg text-orange-800">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold text-slate-900">
                  {loteCargando ? (
                    <Skeleton className="h-6 w-48" />
                  ) : (
                    <>
                      <span>Lote </span>
                      <span className="font-mono">{lote?.codigoLote ?? "Sin código"}</span>
                    </>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ID: <span className="font-mono">{id}</span>
                </p>
              </div>
            </div>
            {lote && <EstadoLoteBadge estado={lote.estado} />}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {loteCargando ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-32" />
                </div>
              ))}
            </div>
          ) : lote ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Producto
                </span>
                <p className="font-semibold text-slate-900">{lote.producto?.nombre ?? "—"}</p>
                <p className="text-xs text-muted-foreground font-mono">{lote.producto?.codigo}</p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Proveedor
                </span>
                <p className="font-medium text-slate-900">{lote.proveedor?.razonSocial ?? "—"}</p>
                <p className="text-xs text-muted-foreground capitalize">Origen: {lote.origen}</p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Fechas
                </span>
                <p className="text-sm text-slate-800">
                  <span className="text-muted-foreground text-xs">Ingreso: </span>
                  {lote.fechaIngreso ? formatFechaISO(lote.fechaIngreso.slice(0, 10)) : "—"}
                </p>
                <p className="text-sm text-slate-800">
                  <span className="text-muted-foreground text-xs">Vencimiento: </span>
                  {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">
                  Existencia y Costos
                </span>
                <p className="text-base font-bold text-slate-900">
                  {lote.cantidad}{" "}
                  <span className="text-xs font-normal text-muted-foreground">unidades</span>
                </p>
                <p className="text-xs text-slate-700 font-mono mt-0.5">
                  Costo efec: {formatMoneda(lote.costoUnitarioEfectivo)}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  Costo neto: {formatMoneda(lote.costoUnitarioNeto)}
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── BLOQUE 2: KARDEX DE MOVIMIENTOS ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="h-5 w-5 text-orange-600" />
            Kardex de Movimientos
          </h2>
          <span className="text-xs text-muted-foreground">
            {kardexMeta ? `${kardexMeta.total} movimientos registrados` : ""}
          </span>
        </div>

        {kardexError && (
          <div
            role="alert"
            className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{kardexError}</span>
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          <TableScrollContainer aria-label="Tabla de movimientos de kardex">
            <Table>
              <TableHeader className="bg-orange-50/70">
                <TableRow>
                  <TableHead className="font-semibold text-slate-700">Fecha y Hora</TableHead>
                  <TableHead className="font-semibold text-slate-700">Tipo de Movimiento</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Saldo Acumulado</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Costo Unitario</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right">Costo Total</TableHead>
                  {/* §2.6: Operación N°, nunca Comprobante ni Factura */}
                  <TableHead className="font-semibold text-slate-700">Operación N°</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kardexCargando ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : movimientos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                      No hay movimientos registrados en el kardex de este lote.
                    </TableCell>
                  </TableRow>
                ) : (
                  movimientos.map((m) => {
                    const esPositivo = m.cantidadConSigno > 0;
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50/80">
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                          {m.fecha ? new Date(m.fecha).toLocaleString("es-AR") : "—"}
                        </TableCell>
                        <TableCell>
                          <TipoMovimientoBadge tipo={m.tipo} />
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold ${
                            esPositivo ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {esPositivo ? `+${m.cantidadConSigno}` : m.cantidadConSigno}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-slate-900">
                          {m.saldoAcumulado}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-700">
                          {formatMoneda(m.costoUnitario)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-700">
                          {formatMoneda(m.costoTotal)}
                        </TableCell>
                        {/* §2.6: Referencia u Operación N° */}
                        <TableCell className="font-mono text-xs text-slate-800">
                          {m.motivo ? (
                            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {m.motivo}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableScrollContainer>

          {kardexMeta && kardexMeta.total > PAGE_SIZE_KARDEX && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 bg-slate-50/50">
              <span className="text-xs text-muted-foreground">
                Página {kardexPage} de {Math.ceil(kardexMeta.total / PAGE_SIZE_KARDEX)}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={kardexPage <= 1 || kardexCargando}
                  onClick={() => setKardexPage((p) => Math.max(1, p - 1))}
                  className="h-7 text-xs"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    kardexPage >= Math.ceil(kardexMeta.total / PAGE_SIZE_KARDEX) ||
                    kardexCargando
                  }
                  onClick={() => setKardexPage((p) => p + 1)}
                  className="h-7 text-xs"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── BLOQUE 3: CADENA DE TRAZABILIDAD (ÁRBOL) ─── */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <GitFork className="h-5 w-5 text-orange-600" />
          Cadena de Trazabilidad
        </h2>

        {trazabilidadError && (
          <div
            role="alert"
            className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{trazabilidadError}</span>
          </div>
        )}

        <Card className="border-slate-200 shadow-sm bg-white p-6">
          {trazabilidadCargando ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          ) : nodosVinculados.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200 text-sm text-slate-600">
              <Info className="h-5 w-5 text-slate-400 shrink-0" />
              <p>Este lote no tiene fraccionamientos vinculados (no es hijo ni padre de otros lotes).</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">
                Estructura de derivaciones y lotes vinculados por fraccionamiento clínico:
              </p>
              <div className="flex flex-col gap-2">
                {nodosTrazabilidad.map((nodo) => {
                  const esActual = nodo.loteId === id;
                  const esPadre = nodo.nivel < 0;
                  const esHijo = nodo.nivel > 0;

                  return (
                    <div
                      key={nodo.loteId}
                      className={`flex items-center justify-between p-3.5 rounded-lg border transition-colors ${
                        esActual
                          ? "bg-orange-50/80 border-orange-300 font-semibold text-orange-950"
                          : "bg-slate-50 border-slate-200 hover:bg-slate-100/80 text-slate-800"
                      }`}
                      style={{
                        marginLeft: `${Math.max(0, nodo.nivel + 1) * 20}px`,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        {esPadre && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            <ArrowDownLeft className="h-3 w-3 mr-1" /> Origen / Padre
                          </Badge>
                        )}
                        {esActual && (
                          <Badge className="bg-orange-600 text-white text-xs">
                            Lote Actual
                          </Badge>
                        )}
                        {esHijo && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                            <ArrowUpRight className="h-3 w-3 mr-1" /> Destino / Derivado
                          </Badge>
                        )}
                        <div>
                          <span className="font-mono text-sm">{nodo.codigoLote ?? "S/L"}</span>
                          <span className="text-xs text-muted-foreground ml-2 font-normal">
                            ({nodo.productoNombre})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-xs font-mono text-slate-600">
                          Costo: {formatMoneda(nodo.costoUnitarioEfectivo)}
                        </span>
                        {!esActual && (
                          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1">
                            <Link to={`/stock/lotes/${nodo.loteId}`}>
                              Ver lote
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
export default LoteDetallePage;
