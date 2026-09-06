import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Plus,
  Trash2,
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
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
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
import { crearRecuento, eliminarRecuento, listarRecuentos } from "../api/comercial/ajustes.ts";
import { ApiError } from "../types/index.ts";
import type { ApiMeta, EstadoRecuento, Recuento } from "../types/index.ts";

const PAGE_SIZE = 20;

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

export function EstadoRecuentoBadge({ estado }: { estado: EstadoRecuento | string }) {
  switch (estado) {
    case "borrador":
      return (
        <Badge
          variant="outline"
          className="bg-slate-100 text-slate-700 border-slate-300 font-medium"
        >
          Borrador
        </Badge>
      );
    case "aplicado":
      return (
        <Badge
          variant="outline"
          className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium"
        >
          Aplicado
        </Badge>
      );
    default:
      return <Badge variant="outline">{estado}</Badge>;
  }
}

export function RecuentosPage() {
  const navigate = useNavigate();

  const [recuentos, setRecuentos] = useState<Recuento[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoRecuento | "todos">("todos");
  const [page, setPage] = useState(1);

  // Modal nuevo recuento
  const [dialogNuevoOpen, setDialogNuevoOpen] = useState(false);
  const [observacionesNuevo, setObservacionesNuevo] = useState("");
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  // Modal eliminar recuento en borrador
  const [recuentoAEliminar, setRecuentoAEliminar] = useState<Recuento | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const cargarRecuentos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await listarRecuentos({
        estado: estadoFiltro === "todos" ? undefined : estadoFiltro,
        page,
        limit: PAGE_SIZE,
      });
      setRecuentos(res.items);
      setMeta(res.meta);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al cargar los recuentos",
      );
    } finally {
      setCargando(false);
    }
  }, [estadoFiltro, page]);

  useEffect(() => {
    void cargarRecuentos();
  }, [cargarRecuentos]);

  // Manejador para crear recuento
  async function handleCrearRecuento(e: React.FormEvent) {
    e.preventDefault();
    setCreando(true);
    setErrorCrear(null);
    try {
      const res = await crearRecuento(observacionesNuevo.trim() || undefined);
      setDialogNuevoOpen(false);
      setObservacionesNuevo("");
      navigate(`/stock/recuentos/${res.id}`);
    } catch (err: unknown) {
      setErrorCrear(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al crear el recuento",
      );
    } finally {
      setCreando(false);
    }
  }

  // Manejador para eliminar recuento
  async function handleEliminarRecuento() {
    if (!recuentoAEliminar) return;
    setEliminando(true);
    setErrorEliminar(null);
    try {
      await eliminarRecuento(recuentoAEliminar.id);
      setRecuentoAEliminar(null);
      void cargarRecuentos();
    } catch (err: unknown) {
      setErrorEliminar(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error al eliminar el recuento",
      );
    } finally {
      setEliminando(false);
    }
  }

  const totalPages = meta ? Math.ceil(meta.total / PAGE_SIZE) : 1;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-orange-600" />
            Recuentos de Inventario
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control periódico de stock físico, conciliación y generación de ajustes automáticos.
          </p>
        </div>
        <Button
          onClick={() => {
            setObservacionesNuevo("");
            setErrorCrear(null);
            setDialogNuevoOpen(true);
          }}
          className="bg-orange-600 hover:bg-orange-700 text-white self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nuevo recuento
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4 bg-slate-50/50 p-4 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2">
          <Label htmlFor="filtro-estado" className="text-sm font-medium text-slate-700">
            Estado:
          </Label>
          <Select
            value={estadoFiltro}
            onValueChange={(val) => {
              setEstadoFiltro(val as EstadoRecuento | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger id="filtro-estado" aria-label="Filtrar por estado" className="w-36 bg-white">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="borrador">Borrador</SelectItem>
              <SelectItem value="aplicado">Aplicado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Estado Error */}
      {error && (
        <div role="alert" className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Tabla de recuentos */}
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
        <TableScrollContainer aria-label="Listado de recuentos de inventario">
          <Table>
            <TableHeader className="bg-orange-50/60 border-b border-slate-200">
              <TableRow>
                <TableHead className="font-semibold text-slate-900">Fecha</TableHead>
                <TableHead className="font-semibold text-slate-900">Creado por</TableHead>
                <TableHead className="font-semibold text-slate-900">Estado</TableHead>
                <TableHead className="font-semibold text-slate-900">Observaciones</TableHead>
                <TableHead className="text-right font-semibold text-slate-900">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : recuentos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No se encontraron recuentos de inventario.
                  </TableCell>
                </TableRow>
              ) : (
                recuentos.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50/80">
                    <TableCell className="font-medium text-slate-900">
                      {formatFecha(r.fecha || r.createdAt)}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {r.usuario?.nombre || "—"}
                    </TableCell>
                    <TableCell>
                      <EstadoRecuentoBadge estado={r.estado} />
                    </TableCell>
                    <TableCell className="text-slate-600 max-w-xs truncate" title={r.observaciones || undefined}>
                      {r.observaciones || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8 px-2 text-slate-700 hover:text-orange-950"
                        >
                          <Link to={`/stock/recuentos/${r.id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            {r.estado === "borrador" ? "Continuar" : "Ver"}
                          </Link>
                        </Button>
                        {r.estado === "borrador" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Eliminar borrador"
                            aria-label={`Eliminar recuento ${r.id}`}
                            onClick={() => {
                              setErrorEliminar(null);
                              setRecuentoAEliminar(r);
                            }}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
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
      </div>

      {/* Paginación */}
      {meta && meta.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>
            Mostrando {recuentos.length} de {meta.total} recuentos
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || cargando}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <span>
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || cargando}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Modal Nuevo Recuento */}
      <Dialog open={dialogNuevoOpen} onOpenChange={setDialogNuevoOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCrearRecuento}>
            <DialogHeader>
              <DialogTitle>Nuevo Recuento de Inventario</DialogTitle>
              <DialogDescription>
                Se creará un nuevo recuento en estado borrador con los lotes que tienen existencia disponible.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="observaciones-nuevo">Observaciones (opcional)</Label>
                <Textarea
                  id="observaciones-nuevo"
                  placeholder="Ej: Conteo sector farmacia estante A..."
                  value={observacionesNuevo}
                  onChange={(e) => setObservacionesNuevo(e.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </div>

              {errorCrear && (
                <p role="alert" className="text-sm text-destructive font-medium">
                  {errorCrear}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogNuevoOpen(false)}
                disabled={creando}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={creando}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {creando ? "Creando..." : "Crear recuento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AlertDialog Eliminar Recuento en Borrador */}
      <AlertDialog
        open={Boolean(recuentoAEliminar)}
        onOpenChange={(open) => !open && setRecuentoAEliminar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar recuento en borrador</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará este borrador de recuento y los registros de conteo ingresados hasta el momento. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errorEliminar && (
            <p role="alert" className="text-sm text-destructive font-medium my-2">
              {errorEliminar}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={eliminando}
              onClick={(e) => {
                e.preventDefault();
                void handleEliminarRecuento();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {eliminando ? "Eliminando..." : "Eliminar recuento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RecuentosPage;
