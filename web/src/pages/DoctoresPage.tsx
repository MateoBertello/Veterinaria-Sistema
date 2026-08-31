import { useCallback, useEffect, useState } from "react";
import { Pencil, Search, Stethoscope } from "lucide-react";
import {
  Table,
  TableScrollContainer,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { DoctorEditDialog } from "../components/doctores/DoctorEditDialog.tsx";
import { editarDoctor, listarDoctores } from "../api/doctores.ts";
import { ApiError, type ApiMeta, type Doctor } from "../types/index.ts";

const PAGE_SIZE = 20;
const COLUMNS = 6;

export function DoctoresPage() {
  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [meta,     setMeta]     = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(1);

  const [availableFilter, setAvailableFilter] = useState<"true" | "false" | "">("");

  const [editing, setEditing] = useState<Doctor | null>(null);

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
      const { items, meta } = await listarDoctores({
        search: search || undefined,
        available: availableFilter ? availableFilter === "true" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setDoctores(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los doctores");
    } finally {
      setLoading(false);
    }
  }, [search, availableFilter, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function resetPage() { setPage(1); }

  function abrirEdicion(d: Doctor) { setEditing(d); }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const hayFiltros = Boolean(search || availableFilter);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Stethoscope className="size-6" aria-hidden />
          Doctores
        </h1>
        <p className="text-sm text-muted-foreground">
          Profesionales del tenant. El alta se genera al crear un usuario veterinario.
        </p>
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
            aria-label="Buscar doctores"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <Select
          value={availableFilter}
          onValueChange={(v) => {
            setAvailableFilter((v === "__all__" ? "" : v) as "true" | "false" | "");
            resetPage();
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filtrar por disponibilidad">
            <SelectValue placeholder="Disponibilidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            <SelectItem value="true">Disponible</SelectItem>
            <SelectItem value="false">No disponible</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <TableScrollContainer aria-label="Listado de doctores">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Especialidad</TableHead>
              <TableHead className="hidden lg:table-cell">Matrícula</TableHead>
              <TableHead className="hidden xl:table-cell">Usuario</TableHead>
              <TableHead>Disponibilidad</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="py-10 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : doctores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay doctores que coincidan con los filtros aplicados."
                    : "Todavía no hay doctores. Se generan al crear un usuario con rol veterinario."}
                </TableCell>
              </TableRow>
            ) : (
              doctores.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-normal font-medium">{d.name}</TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell">
                    {d.specialty ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {d.licenseNumber ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal xl:table-cell">
                    {d.usuario ? d.usuario.username : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <DisponibilidadBadge available={d.available} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${d.name}`}
                            onClick={() => abrirEdicion(d)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScrollContainer>

      {/* Paginación */}
      {!loading && !error && doctores.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} doctor{meta.total === 1 ? "" : "es"} · Página {meta.page} de {totalPages}
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
      ) : null}

      <DoctorEditDialog
        doctor={editing}
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        editar={editarDoctor}
        onSaved={() => void cargar()}
      />
    </div>
  );
}

function DisponibilidadBadge({ available }: { available: boolean }) {
  if (available) {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Disponible</Badge>;
  }
  return <Badge variant="secondary">No disponible</Badge>;
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUMNS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
