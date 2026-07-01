import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  PawPrint,
  Pencil,
  Plus,
  Search,
  Skull,
  Stethoscope,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { MascotaFormDialog } from "../components/mascotas/MascotaFormDialog.tsx";
import { CambiarDuenoDialog } from "../components/mascotas/CambiarDuenoDialog.tsx";
import { MarcarFallecidaDialog } from "../components/mascotas/MarcarFallecidaDialog.tsx";
import {
  cambiarDueno,
  crearMascota,
  editarMascota,
  listarMascotas,
  marcarFallecida,
} from "../api/mascotas.ts";
import { listarEspecies } from "../api/catalogos.ts";
import {
  ApiError,
  type EdadCat,
  type Especie,
  type EstadoMascota,
  type Mascota,
  type ApiMeta,
} from "../types/index.ts";

const PAGE_SIZE = 20;

export function MascotasPage() {
  const navigate = useNavigate();

  const [mascotas, setMascotas] = useState<Mascota[]>([]);
  const [meta,     setMeta]     = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(1);

  const [especieFilter, setEspecieFilter] = useState<string>("");
  const [estadoFilter,  setEstadoFilter]  = useState<EstadoMascota | "">("");
  const [edadFilter,    setEdadFilter]    = useState<EdadCat | "">("");

  const [especies, setEspecies] = useState<Especie[]>([]);

  const [formOpen,  setFormOpen]  = useState(false);
  const [editing,   setEditing]   = useState<Mascota | null>(null);
  const [toChangeDueno,   setToChangeDueno]   = useState<Mascota | null>(null);
  const [toMarcarFallecida, setToMarcarFallecida] = useState<Mascota | null>(null);

  // Debounce búsqueda libre
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cargar catálogo de especies para el filtro (una sola vez)
  useEffect(() => {
    listarEspecies()
      .then(setEspecies)
      .catch(() => { /* silencioso: sin filtro de especie */ });
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarMascotas({
        search:    search || undefined,
        especieId: especieFilter || undefined,
        estado:    (estadoFilter as EstadoMascota) || undefined,
        edadCat:   (edadFilter as EdadCat) || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setMascotas(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las mascotas");
    } finally {
      setLoading(false);
    }
  }, [search, especieFilter, estadoFilter, edadFilter, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function resetPage() { setPage(1); }

  function abrirNueva() { setEditing(null); setFormOpen(true); }
  function abrirEdicion(m: Mascota) { setEditing(m); setFormOpen(true); }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const hayFiltros = Boolean(search || especieFilter || estadoFilter || edadFilter);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <PawPrint className="size-6" aria-hidden />
            Mascotas
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro de mascotas. Alta, edición, cambio de dueño y fallecimiento.
          </p>
        </div>
        <Button onClick={abrirNueva}>
          <Plus className="size-4" aria-hidden />
          Nueva mascota
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
            placeholder="Buscar por nombre o dueño"
            aria-label="Buscar mascotas"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <Select
          value={especieFilter}
          onValueChange={(v) => { setEspecieFilter(v === "__all__" ? "" : v); resetPage(); }}
        >
          <SelectTrigger className="w-40" aria-label="Filtrar por especie">
            <SelectValue placeholder="Especie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las especies</SelectItem>
            {especies.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={estadoFilter}
          onValueChange={(v) => {
            setEstadoFilter((v === "__all__" ? "" : v) as EstadoMascota | "");
            resetPage();
          }}
        >
          <SelectTrigger className="w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los estados</SelectItem>
            <SelectItem value="Activa">Activa</SelectItem>
            <SelectItem value="Fallecida">Fallecida</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={edadFilter}
          onValueChange={(v) => {
            setEdadFilter((v === "__all__" ? "" : v) as EdadCat | "");
            resetPage();
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filtrar por edad">
            <SelectValue placeholder="Edad" />
          </SelectTrigger>
          <SelectContent>
            {/* Convención de presentación (no RN del Documento Maestro): <1 / 1-7 / >7 años */}
            <SelectItem value="__all__">Todas las edades</SelectItem>
            <SelectItem value="cachorro">Cachorro (&lt;1 año)</SelectItem>
            <SelectItem value="adulto">Adulto (1–7 años)</SelectItem>
            <SelectItem value="senior">Senior (+7 años)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead>Dueño</TableHead>
              <TableHead>Especie</TableHead>
              <TableHead className="hidden md:table-cell">Raza</TableHead>
              <TableHead className="hidden lg:table-cell">Tamaño</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : mascotas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay mascotas que coincidan con los filtros aplicados."
                    : "Todavía no hay mascotas. Registrá la primera con “Nueva mascota”."}
                </TableCell>
              </TableRow>
            ) : (
              mascotas.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.ownerName ?? "—"}</TableCell>
                  <TableCell>{m.especieName ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{m.razaName ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{m.tamano}</TableCell>
                  <TableCell>
                    <EstadoBadge estado={m.estado} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ver historial clínico de ${m.name}`}
                            onClick={() => navigate(`/historial/${m.id}`)}
                          >
                            <Stethoscope className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Historial clínico</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${m.name}`}
                            onClick={() => abrirEdicion(m)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar</TooltipContent>
                      </Tooltip>

                      {m.estado === "Activa" ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Cambiar dueño de ${m.name}`}
                                onClick={() => setToChangeDueno(m)}
                              >
                                <ArrowLeftRight className="size-4" aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Cambiar dueño</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Marcar ${m.name} como fallecida`}
                                className="text-destructive hover:text-destructive"
                                onClick={() => setToMarcarFallecida(m)}
                              >
                                <Skull className="size-4" aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Marcar fallecida</TooltipContent>
                          </Tooltip>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      {!loading && !error && mascotas.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} mascota{meta.total === 1 ? "" : "s"} · Página {meta.page} de {totalPages}
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

      {/* Dialogs */}
      <MascotaFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mascota={editing}
        crear={crearMascota}
        editar={editarMascota}
        onSaved={() => void cargar()}
      />

      <CambiarDuenoDialog
        mascota={toChangeDueno}
        open={Boolean(toChangeDueno)}
        onOpenChange={(o) => !o && setToChangeDueno(null)}
        cambiarDueno={cambiarDueno}
        onSuccess={() => void cargar()}
      />

      <MarcarFallecidaDialog
        mascota={toMarcarFallecida}
        open={Boolean(toMarcarFallecida)}
        onOpenChange={(o) => !o && setToMarcarFallecida(null)}
        marcarFallecida={marcarFallecida}
        onSuccess={() => void cargar()}
      />
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === "Activa") {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activa</Badge>;
  }
  return <Badge variant="secondary">Fallecida</Badge>;
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 7 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
