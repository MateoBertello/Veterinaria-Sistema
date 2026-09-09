import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, BookMarked, Pencil, Plus, Power, Search, Syringe } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  EspecieFormSheet,
  EspeciesAplicablesSheet,
  RazaFormSheet,
  TipoVacunaFormSheet,
} from "../components/catalogos/CatalogoSheets.tsx";
import { DesactivarCatalogoDialog } from "../components/catalogos/DesactivarCatalogoDialog.tsx";
import {
  asociarEspeciesTipoVacuna,
  cambiarEstadoEspecie,
  cambiarEstadoRaza,
  cambiarEstadoTipoVacuna,
  crearEspecie,
  crearRaza,
  crearTipoVacuna,
  editarEspecie,
  editarRaza,
  editarTipoVacuna,
  listarEspeciesCatalogo,
  listarRazasCatalogo,
  listarTiposVacunaCatalogo,
} from "../api/catalogos.ts";
import {
  ApiError,
  type ApiMeta,
  type EspecieCatalogo,
  type RazaCatalogo,
  type TipoVacunaCatalogo,
} from "../types/index.ts";

const PAGE_SIZE = 20;

/**
 * Gestión del catálogo clínico de la clínica: especies, razas y tipos de vacuna.
 *
 * Va en "Operación" y no en "Administración" porque es core transversal de uso
 * frecuente —cargar una raza es tarea de recepción o del veterinario mientras
 * atiende—, no configuración esporádica de la clínica. Mismo criterio con el
 * que Servicios, Doctores y Horarios ya viven en esa sección.
 *
 * Tres pestañas en UNA pantalla y no tres ítems de sidebar: son el mismo
 * concepto, se administran en la misma sesión de trabajo y las razas no se
 * entienden sin sus especies.
 */
export function CatalogosPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <BookMarked className="size-6" aria-hidden />
          Catálogos clínicos
        </h1>
        <p className="text-sm text-muted-foreground">
          Especies, razas y tipos de vacuna de esta clínica. Alimentan el alta de
          mascotas y el plan de vacunación.
        </p>
      </header>

      <Tabs defaultValue="especies">
        <TabsList>
          <TabsTrigger value="especies">Especies</TabsTrigger>
          <TabsTrigger value="razas">Razas</TabsTrigger>
          <TabsTrigger value="tipos-vacuna">Tipos de vacuna</TabsTrigger>
        </TabsList>

        <TabsContent value="especies" className="mt-4">
          <EspeciesTab />
        </TabsContent>
        <TabsContent value="razas" className="mt-4">
          <RazasTab />
        </TabsContent>
        <TabsContent value="tipos-vacuna" className="mt-4">
          <TiposVacunaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Piezas compartidas por las tres pestañas ─────────────────────────────────

function EstadoBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>
    : <Badge variant="secondary">Dado de baja</Badge>;
}

function LoadingRows({ columnas }: { columnas: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columnas }).map((__, j) => (
            <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Botones de fila: editar, alternar estado (RN-CAT4: nunca borrar) y, opcionalmente, una acción propia de la pestaña. */
function AccionesFila({
  nombre, active, onEditar, onAlternar, extra,
}: {
  nombre: string;
  active: boolean;
  onEditar: () => void;
  onAlternar: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex justify-end gap-1">
      {extra}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Editar ${nombre}`} onClick={onEditar}>
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
            aria-label={active ? `Dar de baja ${nombre}` : `Reactivar ${nombre}`}
            onClick={onAlternar}
          >
            <Power className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{active ? "Dar de baja" : "Reactivar"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Estado de búsqueda + filtro por estado + paginación, común a las tres pestañas. */
function useCatalogoTab<T>(
  cargarPagina: (params: {
    search?: string; active?: boolean; page: number; limit: number;
  }) => Promise<{ items: T[]; meta: ApiMeta }>,
  mensajeError: string,
) {
  const [items, setItems]     = useState<T[]>([]);
  const [meta, setMeta]       = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [searchInput, setSearchInput]   = useState("");
  const [search, setSearch]             = useState("");
  const [activeFilter, setActiveFilter] = useState<"true" | "false" | "">("");
  const [page, setPage]                 = useState(1);

  // Debounce de la búsqueda. La paginación se resetea SOLO si el término
  // realmente cambió: el temporizador que queda pendiente del montaje vence a
  // los 300 ms, y si para entonces el usuario ya paginó, un `setPage(1)`
  // incondicional lo devuelve a la página 1 sin que haya tocado la búsqueda.
  useEffect(() => {
    const t = setTimeout(() => {
      const limpio = searchInput.trim();
      if (limpio === search) return;
      setSearch(limpio);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await cargarPagina({
        search: search || undefined,
        active: activeFilter ? activeFilter === "true" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setMeta(res.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : mensajeError);
    } finally {
      setLoading(false);
    }
  }, [cargarPagina, search, activeFilter, page, mensajeError]);

  useEffect(() => { void cargar(); }, [cargar]);

  return {
    items, meta, loading, error, cargar,
    searchInput, setSearchInput,
    activeFilter, setActiveFilter,
    page, setPage,
    hayFiltros: Boolean(search || activeFilter),
    totalPages: Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE))),
  };
}

function BarraFiltros({
  etiquetaBusqueda, searchInput, onSearch, activeFilter, onActive, extra,
}: {
  etiquetaBusqueda: string;
  searchInput: string;
  onSearch: (v: string) => void;
  activeFilter: string;
  onActive: (v: "true" | "false" | "") => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="relative flex-1 min-w-48">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Buscar por nombre"
          aria-label={etiquetaBusqueda}
          className="pl-9"
          value={searchInput}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {extra}
      <Select
        value={activeFilter}
        onValueChange={(v) => onActive((v === "__all__" ? "" : v) as "true" | "false" | "")}
      >
        <SelectTrigger className="w-40" aria-label="Filtrar por estado">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todos los estados</SelectItem>
          <SelectItem value="true">Activo</SelectItem>
          <SelectItem value="false">Dado de baja</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function Paginacion({
  meta, totalPages, page, setPage, singular, plural,
}: {
  meta: ApiMeta; totalPages: number; page: number;
  setPage: (f: (p: number) => number) => void;
  singular: string; plural: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {meta.total} {meta.total === 1 ? singular : plural} · Página {meta.page} de {totalPages}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

/**
 * Fila de estado (cargando / error / vacío) o `null` si hay datos que pintar.
 *
 * Se INVOCA como función (`filaEstado({...})`), no se renderiza como
 * `<FilaEstado/>`: un elemento JSX nunca es `null`, así que con la forma de
 * componente el `?? filas` de abajo jamás caía del lado de las filas y la tabla
 * se quedaba pintando el esqueleto de carga para siempre.
 */
function filaEstado({
  loading, error, vacio, columnas, hayFiltros, textoVacio, onReintentar,
}: {
  loading: boolean; error: string | null; vacio: boolean;
  columnas: number; hayFiltros: boolean; textoVacio: string;
  onReintentar: () => void;
}) {
  if (loading) return LoadingRows({ columnas });
  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={columnas} className="py-10">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={onReintentar}>Reintentar</Button>
            </AlertDescription>
          </Alert>
        </TableCell>
      </TableRow>
    );
  }
  if (vacio) {
    return (
      <TableRow>
        <TableCell colSpan={columnas} className="py-10 text-center text-sm text-muted-foreground">
          {hayFiltros ? "No hay resultados para los filtros aplicados." : textoVacio}
        </TableCell>
      </TableRow>
    );
  }
  return null;
}

// ─── Pestaña: Especies ────────────────────────────────────────────────────────

function EspeciesTab() {
  const t = useCatalogoTab<EspecieCatalogo>(listarEspeciesCatalogo, "No se pudieron cargar las especies");
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<EspecieCatalogo | null>(null);
  const [aDarDeBaja, setADarDeBaja] = useState<EspecieCatalogo | null>(null);

  async function reactivar(e: EspecieCatalogo) {
    try { await cambiarEstadoEspecie(e.id, true); void t.cargar(); } catch { /* la fila se recarga */ }
  }

  const estado = filaEstado({
    loading: t.loading, error: t.error, vacio: t.items.length === 0, columnas: 4,
    hayFiltros: t.hayFiltros, onReintentar: () => void t.cargar(),
    textoVacio: "Todavía no hay especies. Creá la primera con “Nueva especie”.",
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditando(null); setFormOpen(true); }}>
          <Plus className="size-4" aria-hidden /> Nueva especie
        </Button>
      </div>

      <BarraFiltros
        etiquetaBusqueda="Buscar especies"
        searchInput={t.searchInput} onSearch={t.setSearchInput}
        activeFilter={t.activeFilter}
        onActive={(v) => { t.setActiveFilter(v); t.setPage(1); }}
      />

      <TableScrollContainer aria-label="Listado de especies del catálogo">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Descripción</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estado ?? t.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-normal font-medium">{e.name}</TableCell>
                <TableCell className="hidden whitespace-normal text-muted-foreground md:table-cell">
                  {e.description ?? "—"}
                </TableCell>
                <TableCell><EstadoBadge active={e.active} /></TableCell>
                <TableCell>
                  <AccionesFila
                    nombre={e.name} active={e.active}
                    onEditar={() => { setEditando(e); setFormOpen(true); }}
                    onAlternar={() => (e.active ? setADarDeBaja(e) : void reactivar(e))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScrollContainer>

      {!t.loading && !t.error && t.items.length > 0 ? (
        <Paginacion meta={t.meta} totalPages={t.totalPages} page={t.page} setPage={t.setPage}
          singular="especie" plural="especies" />
      ) : null}

      <EspecieFormSheet
        open={formOpen} onOpenChange={setFormOpen} especie={editando}
        crear={crearEspecie} editar={editarEspecie} onSaved={() => void t.cargar()}
      />
      <DesactivarCatalogoDialog
        nombre={aDarDeBaja?.name ?? null} entidad="la especie"
        open={Boolean(aDarDeBaja)} onOpenChange={(o) => !o && setADarDeBaja(null)}
        desactivar={() => cambiarEstadoEspecie(aDarDeBaja!.id, false)}
        onSuccess={() => void t.cargar()}
      />
    </div>
  );
}

// ─── Pestaña: Razas ───────────────────────────────────────────────────────────

function RazasTab() {
  const [especieFilter, setEspecieFilter] = useState("");
  const [especies, setEspecies] = useState<EspecieCatalogo[]>([]);

  const cargarPagina = useCallback(
    (params: { search?: string; active?: boolean; page: number; limit: number }) =>
      listarRazasCatalogo({ ...params, especieId: especieFilter || undefined }),
    [especieFilter],
  );

  const t = useCatalogoTab<RazaCatalogo>(cargarPagina, "No se pudieron cargar las razas");
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<RazaCatalogo | null>(null);
  const [aDarDeBaja, setADarDeBaja] = useState<RazaCatalogo | null>(null);

  useEffect(() => {
    listarEspeciesCatalogo({ active: true, limit: 100 })
      .then(({ items }) => setEspecies(items))
      .catch(() => setEspecies([]));
  }, []);

  async function reactivar(r: RazaCatalogo) {
    try { await cambiarEstadoRaza(r.id, true); void t.cargar(); } catch { /* la fila se recarga */ }
  }

  const estado = filaEstado({
    loading: t.loading, error: t.error, vacio: t.items.length === 0, columnas: 4,
    hayFiltros: t.hayFiltros || Boolean(especieFilter), onReintentar: () => void t.cargar(),
    textoVacio: "Todavía no hay razas. Creá la primera con “Nueva raza”.",
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditando(null); setFormOpen(true); }}>
          <Plus className="size-4" aria-hidden /> Nueva raza
        </Button>
      </div>

      <BarraFiltros
        etiquetaBusqueda="Buscar razas"
        searchInput={t.searchInput} onSearch={t.setSearchInput}
        activeFilter={t.activeFilter}
        onActive={(v) => { t.setActiveFilter(v); t.setPage(1); }}
        extra={
          <Select
            value={especieFilter}
            onValueChange={(v) => { setEspecieFilter(v === "__all__" ? "" : v); t.setPage(1); }}
          >
            <SelectTrigger className="w-44" aria-label="Filtrar por especie">
              <SelectValue placeholder="Especie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas las especies</SelectItem>
              {especies.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <TableScrollContainer aria-label="Listado de razas del catálogo">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead>Especie</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estado ?? t.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-normal font-medium">{r.name}</TableCell>
                {/* Viene embebido en el mismo listado: sin request por fila. */}
                <TableCell>{r.especieName ?? "—"}</TableCell>
                <TableCell><EstadoBadge active={r.active} /></TableCell>
                <TableCell>
                  <AccionesFila
                    nombre={r.name} active={r.active}
                    onEditar={() => { setEditando(r); setFormOpen(true); }}
                    onAlternar={() => (r.active ? setADarDeBaja(r) : void reactivar(r))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScrollContainer>

      {!t.loading && !t.error && t.items.length > 0 ? (
        <Paginacion meta={t.meta} totalPages={t.totalPages} page={t.page} setPage={t.setPage}
          singular="raza" plural="razas" />
      ) : null}

      <RazaFormSheet
        open={formOpen} onOpenChange={setFormOpen} raza={editando}
        especieIdSugerida={especieFilter || undefined}
        crear={crearRaza} editar={editarRaza} onSaved={() => void t.cargar()}
      />
      <DesactivarCatalogoDialog
        nombre={aDarDeBaja?.name ?? null} entidad="la raza"
        open={Boolean(aDarDeBaja)} onOpenChange={(o) => !o && setADarDeBaja(null)}
        desactivar={() => cambiarEstadoRaza(aDarDeBaja!.id, false)}
        onSuccess={() => void t.cargar()}
      />
    </div>
  );
}

// ─── Pestaña: Tipos de vacuna ─────────────────────────────────────────────────

function TiposVacunaTab() {
  const t = useCatalogoTab<TipoVacunaCatalogo>(
    listarTiposVacunaCatalogo,
    "No se pudieron cargar los tipos de vacuna",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<TipoVacunaCatalogo | null>(null);
  const [aDarDeBaja, setADarDeBaja] = useState<TipoVacunaCatalogo | null>(null);
  const [asociando, setAsociando] = useState<TipoVacunaCatalogo | null>(null);

  async function reactivar(tv: TipoVacunaCatalogo) {
    try { await cambiarEstadoTipoVacuna(tv.id, true); void t.cargar(); } catch { /* la fila se recarga */ }
  }

  const estado = filaEstado({
    loading: t.loading, error: t.error, vacio: t.items.length === 0, columnas: 5,
    hayFiltros: t.hayFiltros, onReintentar: () => void t.cargar(),
    textoVacio: "Todavía no hay tipos de vacuna. Creá el primero con “Nuevo tipo de vacuna”.",
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditando(null); setFormOpen(true); }}>
          <Plus className="size-4" aria-hidden /> Nuevo tipo de vacuna
        </Button>
      </div>

      <BarraFiltros
        etiquetaBusqueda="Buscar tipos de vacuna"
        searchInput={t.searchInput} onSearch={t.setSearchInput}
        activeFilter={t.activeFilter}
        onActive={(v) => { t.setActiveFilter(v); t.setPage(1); }}
      />

      <TableScrollContainer aria-label="Listado de tipos de vacuna del catálogo">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Especies aplicables</TableHead>
              <TableHead>Refuerzo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estado ?? t.items.map((tv) => (
              <TableRow key={tv.id}>
                <TableCell className="whitespace-normal font-medium">{tv.nombre}</TableCell>
                {/* Vienen embebidas en el mismo listado: sin request por fila. */}
                <TableCell className="hidden whitespace-normal md:table-cell">
                  {tv.especies.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {tv.especies.map((e) => (
                        <Badge key={e.id} variant="secondary">{e.name}</Badge>
                      ))}
                    </span>
                  ) : (
                    // RN-CAT10: sin especies no aplica a ninguna mascota. La API
                    // no deja llegar ahí, pero si una fila lo estuviera, se dice.
                    <span className="text-destructive">Ninguna</span>
                  )}
                </TableCell>
                <TableCell>
                  {tv.mesesRefuerzoSugerido
                    ? <Badge variant="outline">{tv.mesesRefuerzoSugerido} meses</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell><EstadoBadge active={tv.active} /></TableCell>
                <TableCell>
                  <AccionesFila
                    nombre={tv.nombre} active={tv.active}
                    onEditar={() => { setEditando(tv); setFormOpen(true); }}
                    onAlternar={() => (tv.active ? setADarDeBaja(tv) : void reactivar(tv))}
                    extra={
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Especies aplicables a ${tv.nombre}`}
                            onClick={() => setAsociando(tv)}
                          >
                            <Syringe className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Especies aplicables</TooltipContent>
                      </Tooltip>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScrollContainer>

      {!t.loading && !t.error && t.items.length > 0 ? (
        <Paginacion meta={t.meta} totalPages={t.totalPages} page={t.page} setPage={t.setPage}
          singular="tipo de vacuna" plural="tipos de vacuna" />
      ) : null}

      <TipoVacunaFormSheet
        open={formOpen} onOpenChange={setFormOpen} tipo={editando}
        crear={crearTipoVacuna} editar={editarTipoVacuna} onSaved={() => void t.cargar()}
      />
      <EspeciesAplicablesSheet
        open={Boolean(asociando)} onOpenChange={(o) => !o && setAsociando(null)}
        tipo={asociando} guardar={asociarEspeciesTipoVacuna}
        onSaved={() => void t.cargar()}
      />
      <DesactivarCatalogoDialog
        nombre={aDarDeBaja?.nombre ?? null} entidad="el tipo de vacuna"
        open={Boolean(aDarDeBaja)} onOpenChange={(o) => !o && setADarDeBaja(null)}
        desactivar={() => cambiarEstadoTipoVacuna(aDarDeBaja!.id, false)}
        onSuccess={() => void t.cargar()}
      />
    </div>
  );
}
