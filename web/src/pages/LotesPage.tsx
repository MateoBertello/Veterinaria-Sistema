import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Layers, Lock, Unlock } from "lucide-react";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";
import { BloquearLoteDialog } from "../components/comercial/BloquearLoteDialog.tsx";
import { DesbloquearLoteDialog } from "../components/comercial/DesbloquearLoteDialog.tsx";
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
import { formatFechaISO } from "../lib/fechas.ts";
import { listarLotes } from "../api/comercial/stock.ts";
import type { EstadoLote, Lote } from "../types/index.ts";

const PAGE_SIZE = 20;

export function EstadoLoteBadge({ estado }: { estado: EstadoLote | string }) {
  switch (estado) {
    case "disponible":
      return (
        <Badge
          variant="outline"
          className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium"
        >
          Disponible
        </Badge>
      );
    case "cuarentena":
      return (
        <Badge
          variant="outline"
          className="bg-amber-50 text-amber-700 border-amber-300 font-medium"
        >
          Cuarentena
        </Badge>
      );
    case "bloqueado":
      return (
        <Badge
          variant="outline"
          className="bg-rose-50 text-rose-700 border-rose-300 font-medium"
        >
          Bloqueado
        </Badge>
      );
    case "vencido":
      return (
        <Badge
          variant="outline"
          className="bg-rose-50 text-rose-700 border-rose-300 font-medium"
        >
          Vencido
        </Badge>
      );
    case "agotado":
      return (
        <Badge
          variant="outline"
          className="bg-slate-100 text-slate-600 border-slate-300 font-medium"
        >
          Agotado
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {estado}
        </Badge>
      );
  }
}

export function formatMoneda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(valor)
    .replace(/\u00a0/g, " ");
}

interface LotesPageProps {
  productoId?: string;
  conExistenciaInicial?: "true" | "false";
  embedded?: boolean;
}

export function LotesPage({
  productoId,
  conExistenciaInicial,
  embedded = false,
}: LotesPageProps) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [estadoFiltro, setEstadoFiltro] = useState<EstadoLote | "todos">("todos");
  const [conExistencia, setConExistencia] = useState<"todos" | "true" | "false">(
    conExistenciaInicial ?? "todos",
  );
  const [page, setPage] = useState(1);
  const [tieneSiguiente, setTieneSiguiente] = useState(false);

  const [loteParaAccion, setLoteParaAccion] = useState<Lote | null>(null);
  const [bloquearOpen, setBloquearOpen] = useState(false);
  const [desbloquearOpen, setDesbloquearOpen] = useState(false);

  // NOTA PLAN_FRONTEND_COMERCIAL.md §4.3:
  // Con `conExistencia`, el backend filtra en memoria después de paginar, por lo que
  // la página puede volver con menos ítems que `limit` y `meta.total` incluye lotes descartados.
  // No se usa `meta.total` para paginar. Se usa paginación simple Anterior/Siguiente y
  // "Siguiente" se deshabilita cuando la respuesta cruda trae menos de `limit` ítems.
  const cargarLotes = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await listarLotes({
        productoId: productoId || undefined,
        estado: estadoFiltro === "todos" ? undefined : estadoFiltro,
        conExistencia: conExistencia === "todos" ? undefined : conExistencia,
        page,
        limit: PAGE_SIZE,
      });

      setLotes(res.items);
      // Deshabilitar "Siguiente" cuando la respuesta trae menos de limit ítems
      setTieneSiguiente(res.items.length >= PAGE_SIZE);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar lotes");
    } finally {
      setCargando(false);
    }
  }, [productoId, estadoFiltro, conExistencia, page]);

  useEffect(() => {
    void cargarLotes();
  }, [cargarLotes]);

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto p-4 md:p-6 space-y-6"}>
      {!embedded && <StockBreadcrumb items={[{ label: "Lotes" }]} />}
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
              <Layers className="h-6 w-6 text-orange-600" />
              Lotes de Stock
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Control individual de lotes, trazabilidad, costos de ingreso y vencimientos.
            </p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="w-48">
          <Select
            value={estadoFiltro}
            onValueChange={(val) => {
              setEstadoFiltro(val as EstadoLote | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Estado de lote" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="disponible">Disponible</SelectItem>
              <SelectItem value="cuarentena">Cuarentena</SelectItem>
              <SelectItem value="bloqueado">Bloqueado</SelectItem>
              <SelectItem value="vencido">Vencido</SelectItem>
              <SelectItem value="agotado">Agotado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-52">
          <Select
            value={conExistencia}
            onValueChange={(val) => {
              setConExistencia(val as "todos" | "true" | "false");
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Existencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Con y sin existencia</SelectItem>
              <SelectItem value="true">Solo con existencia (&gt; 0)</SelectItem>
              <SelectItem value="false">Solo sin existencia (= 0)</SelectItem>
            </SelectContent>
          </Select>
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

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <TableScrollContainer aria-label="Tabla de lotes de stock">
          <Table>
            <TableHeader className="bg-orange-50/80">
              <TableRow>
                <TableHead className="font-semibold text-slate-700">Código de lote</TableHead>
                <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                <TableHead className="font-semibold text-slate-700">Proveedor</TableHead>
                <TableHead className="font-semibold text-slate-700">Ingreso</TableHead>
                <TableHead className="font-semibold text-slate-700">Vencimiento</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Cantidad</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Costo unit. efect.</TableHead>
                <TableHead className="font-semibold text-slate-700">Estado</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} data-testid="lotes-loading">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : lotes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                    No se encontraron lotes para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                lotes.map((lote) => (
                  <TableRow key={lote.id} className="hover:bg-slate-50/80">
                    <TableCell className="font-mono text-xs font-semibold text-slate-900">
                      {lote.codigoLote ?? "S/L"}
                    </TableCell>
                    <TableCell>
                      {lote.producto ? (
                        <div>
                          <p className="font-medium text-slate-900">{lote.producto.nombre}</p>
                          <p className="text-xs text-muted-foreground font-mono">{lote.producto.codigo}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {lote.proveedor?.razonSocial ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {lote.fechaIngreso ? formatFechaISO(lote.fechaIngreso.slice(0, 10)) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {lote.fechaVencimiento ? formatFechaISO(lote.fechaVencimiento.slice(0, 10)) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-slate-900">
                      {lote.cantidad}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-slate-800">
                      {formatMoneda(lote.costoUnitarioEfectivo)}
                    </TableCell>
                    <TableCell>
                      <EstadoLoteBadge estado={lote.estado} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Link to={`/stock/lotes/${lote.id}`} title="Ver detalle de lote">
                            <Eye className="h-4 w-4 text-slate-600 hover:text-orange-700" />
                            <span className="sr-only">Ver detalle de lote</span>
                          </Link>
                        </Button>
                        {lote.estado === "bloqueado" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-800"
                            title="Desbloquear lote"
                            onClick={() => {
                              setLoteParaAccion(lote);
                              setDesbloquearOpen(true);
                            }}
                          >
                            <Unlock className="h-4 w-4" />
                            <span className="sr-only">Desbloquear lote</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-slate-500 hover:text-rose-700"
                            title="Bloquear lote"
                            onClick={() => {
                              setLoteParaAccion(lote);
                              setBloquearOpen(true);
                            }}
                          >
                            <Lock className="h-4 w-4" />
                            <span className="sr-only">Bloquear lote</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollContainer>

        {/* Paginador respetando §4.3 (Anterior / Siguiente sin meta.total) */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-muted-foreground">
            Página <span className="font-medium">{page}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || cargando}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!tieneSiguiente || cargando}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 gap-1 text-xs"
            >
              Siguiente
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <BloquearLoteDialog
        lote={loteParaAccion}
        open={bloquearOpen}
        onOpenChange={setBloquearOpen}
        onSuccess={({ estado }) => {
          if (loteParaAccion) {
            setLotes((prev) =>
              prev.map((l) => (l.id === loteParaAccion.id ? { ...l, estado } : l)),
            );
          }
        }}
      />
      <DesbloquearLoteDialog
        lote={loteParaAccion}
        open={desbloquearOpen}
        onOpenChange={setDesbloquearOpen}
        onSuccess={({ estado }) => {
          if (loteParaAccion) {
            setLotes((prev) =>
              prev.map((l) => (l.id === loteParaAccion.id ? { ...l, estado } : l)),
            );
          }
        }}
      />
    </div>
  );
}
export default LotesPage;
