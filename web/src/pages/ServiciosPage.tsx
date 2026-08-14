import { useCallback, useEffect, useState } from "react";
import { Check, Minus as MinusIcon, Pencil, Plus, Power, Search, Wrench } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { TablePagination } from "../components/ui/TablePagination.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { ServicioFormSheet } from "../components/servicios/ServicioFormSheet.tsx";
import { DesactivarServicioDialog } from "../components/servicios/DesactivarServicioDialog.tsx";
import {
  cambiarEstadoServicio,
  crearServicio,
  editarServicio,
  listarServicios,
} from "../api/servicios.ts";
import { ApiError, type ApiMeta, type Servicio, type TipoServicio } from "../types/index.ts";

const PAGE_SIZE = 20;
const TABLE_HEIGHT = "600px";

const TIPO_LABEL: Record<TipoServicio, string> = {
  clinica: "Clínica",
  peluqueria: "Peluquería",
  guarderia: "Guardería",
  cirugia: "Cirugía",
  otro: "Otro",
};

const TIPO_BADGE_CLASS: Record<TipoServicio, string> = {
  clinica: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  peluqueria: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  guarderia: "bg-teal-100 text-teal-800 hover:bg-teal-100",
  cirugia: "bg-red-100 text-red-800 hover:bg-red-100",
  otro: "bg-gray-100 text-gray-800 hover:bg-gray-100",
};

export function ServiciosPage() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [meta,      setMeta]      = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(1);

  const [tipoFilter,   setTipoFilter]   = useState<TipoServicio | "">("");
  const [activoFilter, setActivoFilter] = useState<"true" | "false" | "">("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing,  setEditing]  = useState<Servicio | null>(null);
  const [toDesactivar, setToDesactivar] = useState<Servicio | null>(null);

  // Debounce búsqueda libre
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarServicios({
        search: search || undefined,
        tipo:   (tipoFilter as TipoServicio) || undefined,
        activo: activoFilter ? activoFilter === "true" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setServicios(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los servicios");
    } finally {
      setLoading(false);
    }
  }, [search, tipoFilter, activoFilter, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function resetPage() { setPage(1); }

  function abrirNuevo() { setEditing(null); setFormOpen(true); }
  function abrirEdicion(s: Servicio) { setEditing(s); setFormOpen(true); }

  async function activar(s: Servicio) {
    try {
      await cambiarEstadoServicio(s.id, true);
      void cargar();
    } catch {
      // El estado de error se refleja recargando la fila; sin bloqueo adicional.
    }
  }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const hayFiltros = Boolean(search || tipoFilter || activoFilter);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Wrench className="size-6" aria-hidden />
            Servicios
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de servicios que alimenta Turnos e Historial Clínico.
          </p>
        </div>
        <Button onClick={abrirNuevo}>
          <Plus className="size-4" aria-hidden />
          Nuevo servicio
        </Button>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por nombre"
            aria-label="Buscar servicios"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <Select
          value={tipoFilter}
          onValueChange={(v) => {
            setTipoFilter((v === "__all__" ? "" : v) as TipoServicio | "");
            resetPage();
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filtrar por tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los tipos</SelectItem>
            {(Object.keys(TIPO_LABEL) as TipoServicio[]).map((t) => (
              <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activoFilter}
          onValueChange={(v) => {
            setActivoFilter((v === "__all__" ? "" : v) as "true" | "false" | "");
            resetPage();
          }}
        >
          <SelectTrigger className="w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los estados</SelectItem>
            <SelectItem value="true">Activo</SelectItem>
            <SelectItem value="false">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      {/* Tabla con scroll interno para evitar que se alargue excesivamente */}
      <div className="rounded-lg border" style={{ maxHeight: TABLE_HEIGHT }}>
        <ScrollArea className="h-full">
          <Table>
          <TableHeader>
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead className="hidden md:table-cell">Requiere profesional</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : servicios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay servicios que coincidan con los filtros aplicados."
                    : "Todavía no hay servicios. Creá el primero con “Nuevo servicio”."}
                </TableCell>
              </TableRow>
            ) : (
              servicios.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.nombre}</TableCell>
                  <TableCell>
                    <Badge className={TIPO_BADGE_CLASS[s.tipo]}>{TIPO_LABEL[s.tipo]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.duracionMinutos} min</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.requiereProfesional ? (
                      <Check className="size-4 text-green-700" aria-label="Sí" />
                    ) : (
                      <MinusIcon className="size-4 text-muted-foreground" aria-label="No" />
                    )}
                  </TableCell>
                  <TableCell>
                    <EstadoBadge activo={s.activo} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${s.nombre}`}
                            onClick={() => abrirEdicion(s)}
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
                            aria-label={s.activo ? `Desactivar ${s.nombre}` : `Activar ${s.nombre}`}
                            onClick={() => (s.activo ? setToDesactivar(s) : void activar(s))}
                          >
                            <Power className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{s.activo ? "Desactivar" : "Activar"}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </ScrollArea>
      </div>

      {/* Paginación */}

      {/* Paginación completa con números de página */}
      {!loading && !error && servicios.length > 0 ? (
        <TablePagination
          page={page}
          total={meta.total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          maxVisible={5}
        />
      ) : null}


      {/* Sheet / Dialogs */}
      <ServicioFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        servicio={editing}
        crear={crearServicio}
        editar={editarServicio}
        onSaved={() => void cargar()}
      />

      <DesactivarServicioDialog
        servicio={toDesactivar}
        open={Boolean(toDesactivar)}
        onOpenChange={(o) => !o && setToDesactivar(null)}
        cambiarEstado={cambiarEstadoServicio}
        onSuccess={() => void cargar()}
      />
    </div>
  );
}

function EstadoBadge({ activo }: { activo: boolean }) {
  if (activo) {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>;
  }
  return <Badge variant="secondary">Inactivo</Badge>;
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
