import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Boxes, Pencil, Plus, Power, Search } from "lucide-react";
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
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Label } from "../components/ui/label.tsx";
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
import {
  actualizarFamilia,
  cambiarEstadoFamilia,
  crearFamilia,
  listarFamilias,
} from "../api/comercial/productos.ts";
import { listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import { ApiError, type ApiMeta, type CrearFamiliaInput, type Familia, type UnidadMedida } from "../types/index.ts";

const PAGE_SIZE = 20;

function LoadingRows({ columnas }: { columnas: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columnas }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function Paginacion({
  meta,
  totalPages,
  page,
  setPage,
  singular,
  plural,
}: {
  meta: ApiMeta;
  totalPages: number;
  page: number;
  setPage: (f: (p: number) => number) => void;
  singular: string;
  plural: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {meta.total} {meta.total === 1 ? singular : plural} · Página {meta.page} de {totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export function FamiliasPage() {
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activoFilter, setActivoFilter] = useState<"true" | "false" | "">("");
  const [page, setPage] = useState(1);

  // Unidades de medida cargadas UNA sola vez (RN rendimiento / N+1)
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);

  // Diálogos
  const [dialogFormOpen, setDialogFormOpen] = useState(false);
  const [familiaEditar, setFamiliaEditar] = useState<Familia | null>(null);
  const [dialogBajaOpen, setDialogBajaOpen] = useState(false);
  const [familiaBaja, setFamiliaBaja] = useState<Familia | null>(null);

  // Debounce de búsqueda a 300 ms
  useEffect(() => {
    const t = setTimeout(() => {
      const limpio = searchInput.trim();
      if (limpio === search) return;
      setSearch(limpio);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  // Cargar catálogo de unidades de medida UNA sola vez
  useEffect(() => {
    let activo = true;
    async function cargarUnidades() {
      try {
        const res = await listarUnidadesMedida();
        if (!activo) return;
        setUnidades(res);
      } catch (err) {
        console.error("Error al cargar unidades de medida:", err);
      }
    }
    void cargarUnidades();
    return () => {
      activo = false;
    };
  }, []);

  const unidadesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of unidades) {
      map.set(u.id, u.abreviatura ? `${u.nombre} (${u.abreviatura})` : u.nombre);
    }
    return map;
  }, [unidades]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listarFamilias({
        search: search || undefined,
        activo: activoFilter ? activoFilter === "true" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setFamilias(res.items);
      setMeta(res.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las familias");
    } finally {
      setLoading(false);
    }
  }, [search, activoFilter, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function handleReactivar(fam: Familia) {
    try {
      await cambiarEstadoFamilia(fam.id, true);
      toast.success(`«${fam.nombre}» reactivada`);
      void cargar();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo reactivar la familia");
    }
  }

  const hayFiltros = Boolean(search || activoFilter);
  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Boxes className="size-6 text-orange-700" aria-hidden />
            Familias de Productos
          </h1>
          <p className="text-sm text-muted-foreground">
            Agrupación de productos y consolidación de existencias por unidad base.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
          onClick={() => {
            setFamiliaEditar(null);
            setDialogFormOpen(true);
          }}
        >
          <Plus className="size-4 mr-1.5" aria-hidden />
          Nueva familia
        </Button>
      </header>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por nombre..."
            aria-label="Buscar familias"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="w-44">
          <Select
            value={activoFilter || "__all__"}
            onValueChange={(val: string) => {
              setActivoFilter((val === "__all__" ? "" : val) as "true" | "false" | "");
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por estado">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos los estados</SelectItem>
              <SelectItem value="true">Activas</SelectItem>
              <SelectItem value="false">Dadas de baja</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla de listado */}
      <TableScrollContainer aria-label="Familias de productos">
        <Table>
          <TableHeader className="bg-orange-50/70">
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Unidad base</TableHead>
              <TableHead className="w-32">Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows columnas={4} />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="size-6 text-destructive" aria-hidden />
                    <p role="alert" className="text-sm text-destructive font-medium">
                      {error}
                    </p>
                    <Button variant="outline" size="sm" onClick={cargar} className="mt-2">
                      Reintentar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : familias.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay familias que coincidan con los filtros aplicados."
                    : "No hay familias de productos registradas."}
                </TableCell>
              </TableRow>
            ) : (
              familias.map((fam) => {
                const nombreUnidad = unidadesMap.get(fam.unidadBaseId) ?? "—";

                return (
                  <TableRow key={fam.id} className={fam.activo ? undefined : "opacity-60 bg-muted/30"}>
                    <TableCell className="font-medium text-foreground">
                      {fam.nombre}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {nombreUnidad}
                    </TableCell>
                    <TableCell>
                      {fam.activo ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>
                      ) : (
                        <Badge variant="secondary">Dada de baja</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Editar ${fam.nombre}`}
                              onClick={() => {
                                setFamiliaEditar(fam);
                                setDialogFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Editar</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={fam.activo ? `Dar de baja ${fam.nombre}` : `Reactivar ${fam.nombre}`}
                              onClick={() => {
                                if (fam.activo) {
                                  setFamiliaBaja(fam);
                                  setDialogBajaOpen(true);
                                } else {
                                  void handleReactivar(fam);
                                }
                              }}
                            >
                              <Power className="size-4" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{fam.activo ? "Dar de baja" : "Reactivar"}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableScrollContainer>

      {/* Paginación */}
      <Paginacion
        meta={meta}
        totalPages={totalPages}
        page={page}
        setPage={setPage}
        singular="familia"
        plural="familias"
      />

      {/* Diálogo de Alta / Edición */}
      <FamiliaFormDialog
        open={dialogFormOpen}
        onOpenChange={setDialogFormOpen}
        familia={familiaEditar}
        unidades={unidades}
        onSaved={() => {
          setDialogFormOpen(false);
          void cargar();
        }}
      />

      {/* Diálogo de Baja Lógica */}
      <DesactivarFamiliaDialog
        open={dialogBajaOpen}
        onOpenChange={setDialogBajaOpen}
        familia={familiaBaja}
        onSuccess={() => {
          setDialogBajaOpen(false);
          void cargar();
        }}
      />
    </div>
  );
}

// ─── Formulario de Alta / Edición (Dialog) ───────────────────────────────────

interface FamiliaFormValues {
  nombre: string;
  unidadBaseId: string;
}

const FAMILIA_FORM_VACIO: FamiliaFormValues = {
  nombre: "",
  unidadBaseId: "", // RN-PR8: obligatorio y sin default
};

function FamiliaFormDialog({
  open,
  onOpenChange,
  familia,
  unidades,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  familia?: Familia | null;
  unidades: UnidadMedida[];
  onSaved: () => void;
}) {
  const esEdicion = Boolean(familia);
  const [values, setValues] = useState<FamiliaFormValues>(FAMILIA_FORM_VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrores({});
    if (familia) {
      setValues({
        nombre: familia.nombre,
        unidadBaseId: familia.unidadBaseId,
      });
    } else {
      setValues(FAMILIA_FORM_VACIO);
    }
  }, [open, familia]);

  function handleChange(field: keyof FamiliaFormValues, val: string) {
    setValues((prev) => ({ ...prev, [field]: val }));
    if (errores[field]) {
      setErrores((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function validar(): boolean {
    const errs: Record<string, string> = {};
    const nom = values.nombre.trim();
    if (!nom) {
      errs.nombre = "El nombre es obligatorio";
    } else if (nom.length < 2) {
      errs.nombre = "El nombre debe tener al menos 2 caracteres";
    } else if (nom.length > 100) {
      errs.nombre = "El nombre no puede superar 100 caracteres";
    }

    if (!values.unidadBaseId) {
      errs.unidadBaseId = "Debe seleccionar una unidad base";
    }

    setErrores(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validar()) return;

    setSubmitting(true);
    try {
      const payload: CrearFamiliaInput = {
        nombre: values.nombre.trim(),
        unidadBaseId: values.unidadBaseId,
      };

      if (esEdicion && familia) {
        await actualizarFamilia(familia.id, payload);
        toast.success("Familia actualizada");
      } else {
        await crearFamilia(payload);
        toast.success("Familia creada");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "FAMILY_NAME_DUPLICATE") {
          setErrores((prev) => ({ ...prev, nombre: err.message }));
          return;
        }
        toast.error(err.message);
      } else {
        toast.error("Ocurrió un error inesperado al guardar la familia");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{esEdicion ? "Editar familia" : "Nueva familia"}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? "Modifique los datos de la familia de productos."
                : "Defina una nueva familia para agrupar productos y comparar existencias."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="familia-nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="familia-nombre"
                placeholder="Ej. Antibióticos inyectables"
                value={values.nombre}
                onChange={(e) => handleChange("nombre", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.nombre)}
              />
              {errores.nombre ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.nombre}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="familia-unidadBaseId">
                Unidad base <span className="text-destructive">*</span>
              </Label>
              <Select
                value={values.unidadBaseId}
                onValueChange={(val) => handleChange("unidadBaseId", val)}
                disabled={submitting}
              >
                <SelectTrigger
                  id="familia-unidadBaseId"
                  aria-label="Unidad base"
                  aria-invalid={Boolean(errores.unidadBaseId)}
                >
                  <SelectValue placeholder="Seleccionar unidad base..." />
                </SelectTrigger>
                <SelectContent>
                  {unidades.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nombre} {u.abreviatura ? `(${u.abreviatura})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errores.unidadBaseId ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.unidadBaseId}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Es la unidad de medida en la que se compara y consolida el stock de todos los productos pertenecientes a esta familia.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-orange-600 hover:bg-orange-700 text-white"
              disabled={submitting}
            >
              {submitting ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear familia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo de Baja Lógica (AlertDialog) ────────────────────────────────────

function DesactivarFamiliaDialog({
  open,
  onOpenChange,
  familia,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  familia?: Familia | null;
  onSuccess: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!familia) return;
    setLoading(true);
    setError(null);
    try {
      await cambiarEstadoFamilia(familia.id, false);
      toast.success(`«${familia.nombre}» dada de baja`);
      onSuccess();
      handleOpenChange(false);
    } catch (err) {
      // RN §2.1: el error del backend se muestra DENTRO del diálogo, sin cerrarlo
      setError(err instanceof ApiError ? err.message : "No se pudo dar de baja la familia");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dar de baja familia</AlertDialogTitle>
          <AlertDialogDescription>
            {familia
              ? `«${familia.nombre}» deja de ofrecerse al clasificar productos nuevos. Los productos que ya la usan la siguen mostrando.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive font-medium">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            onClick={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            {loading ? "Dando de baja..." : "Dar de baja"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
