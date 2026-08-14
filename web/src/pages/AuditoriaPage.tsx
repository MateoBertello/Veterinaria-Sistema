import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Eye, History, Search, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
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
import { Label } from "../components/ui/label.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { TablePagination } from "../components/ui/TablePagination.tsx";
import { AuditoriaDetalleDialog } from "../components/auditoria/AuditoriaDetalleDialog.tsx";
import { exportarAuditoriaCsv, listarAuditoria, type FiltrosAuditoria } from "../api/auditoria.ts";
import { listarUsuarios } from "../api/usuarios.ts";
import { auditActionBadgeVariant, auditActionLabel, auditModuleLabel } from "../lib/auditoria.ts";
import {
  ApiError,
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  type ApiMeta,
  type RegistroAuditoria,
  type Usuario,
} from "../types/index.ts";

const PAGE_SIZE = 20;
const TABLE_HEIGHT = "600px";

function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditoriaPage() {
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [exporting, setExporting] = useState(false);
  const [detalle, setDetalle] = useState<RegistroAuditoria | null>(null);

  // Debounce de la búsqueda por texto (el backend la aplica sobre el nombre de usuario).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Catálogo de usuarios para el filtro "Usuario". Defensivo: si el rol no tiene
  // manage_users el pedido falla y el filtro queda vacío, sin romper la pantalla.
  useEffect(() => {
    let activo = true;
    listarUsuarios({ limit: 100 })
      .then(({ items }) => { if (activo) setUsuarios(items); })
      .catch(() => { if (activo) setUsuarios([]); });
    return () => { activo = false; };
  }, []);

  const filtros = useMemo<FiltrosAuditoria>(() => ({
    search:   search || undefined,
    module:   moduleFilter !== "all" ? moduleFilter : undefined,
    action:   actionFilter !== "all" ? actionFilter : undefined,
    userId:   userFilter   !== "all" ? userFilter   : undefined,
    // Los inputs son fecha-only; se amplían a inicio/fin de día en UTC para
    // cumplir el datetime-con-offset que exige el backend (ListarAuditoriaQuerySchema).
    dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
    dateTo:   dateTo   ? `${dateTo}T23:59:59.999Z`   : undefined,
  }), [search, moduleFilter, actionFilter, userFilter, dateFrom, dateTo]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarAuditoria({ ...filtros, page, limit: PAGE_SIZE });
      setRegistros(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la auditoría");
    } finally {
      setLoading(false);
    }
  }, [filtros, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function seleccionarModulo(v: string)  { setModuleFilter(v); setPage(1); }
  function seleccionarAccion(v: string)  { setActionFilter(v); setPage(1); }
  function seleccionarUsuario(v: string) { setUserFilter(v); setPage(1); }
  function cambiarDesde(v: string)       { setDateFrom(v); setPage(1); }
  function cambiarHasta(v: string)       { setDateTo(v); setPage(1); }

  const activeFiltersCount = [
    search,
    moduleFilter !== "all" ? moduleFilter : null,
    actionFilter !== "all" ? actionFilter : null,
    userFilter !== "all" ? userFilter : null,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  function limpiarFiltros() {
    setSearchInput("");
    setSearch("");
    setModuleFilter("all");
    setActionFilter("all");
    setUserFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const resultado = await exportarAuditoriaCsv(filtros);
      descargarBlob(resultado.blob, resultado.filename);
      if (resultado.truncated) {
        toast.warning(
          `La exportación se truncó a ${resultado.rowsExported} de ${resultado.totalMatching} ` +
          "registros que coinciden con los filtros. Achicá el rango o los filtros para exportar el resto.",
        );
      } else {
        toast.success("Exportación de auditoría descargada");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo exportar la auditoría");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <History className="size-6" aria-hidden />
            Auditoría
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro de acciones realizadas en el sistema: quién, cuándo y qué cambió.
          </p>
        </div>
        <Button onClick={() => void handleExport()} disabled={exporting} variant="outline">
          <Download className="size-4" aria-hidden />
          {exporting ? "Exportando…" : "Exportar CSV"}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base font-medium">
            <span>Filtros</span>
            {activeFiltersCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
                <X className="size-4" aria-hidden />
                Limpiar ({activeFiltersCount})
              </Button>
            ) : null}
          </CardTitle>
          <CardDescription>Combiná los filtros para acotar el listado.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="audit-search">Buscar por usuario</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="audit-search"
                  type="search"
                  placeholder="Nombre de usuario…"
                  className="pl-9"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-module">Módulo</Label>
              <Select value={moduleFilter} onValueChange={seleccionarModulo}>
                <SelectTrigger id="audit-module">
                  <SelectValue placeholder="Todos los módulos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los módulos</SelectItem>
                  {AUDIT_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>{auditModuleLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-action">Acción</Label>
              <Select value={actionFilter} onValueChange={seleccionarAccion}>
                <SelectTrigger id="audit-action">
                  <SelectValue placeholder="Todas las acciones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las acciones</SelectItem>
                  {AUDIT_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>{auditActionLabel(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-user">Usuario</Label>
              <Select value={userFilter} onValueChange={seleccionarUsuario}>
                <SelectTrigger id="audit-user">
                  <SelectValue placeholder="Todos los usuarios" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los usuarios</SelectItem>
                  {usuarios.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-date-from">Desde</Label>
              <Input
                id="audit-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => cambiarDesde(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-date-to">Hasta</Label>
              <Input
                id="audit-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => cambiarHasta(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla con scroll interno para evitar que se alargue excesivamente */}
      <div className="rounded-lg border" style={{ maxHeight: TABLE_HEIGHT }}>
        <ScrollArea className="h-full">
          <Table>
          <TableHeader>
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Fecha/Hora</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead className="hidden md:table-cell">Módulo</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead className="hidden lg:table-cell">Detalles</TableHead>
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
            ) : registros.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {activeFiltersCount > 0
                    ? "No hay registros de auditoría que coincidan con los filtros."
                    : "Todavía no hay registros de auditoría."}
                </TableCell>
              </TableRow>
            ) : (
              registros.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleString("es-AR")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.userName ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{auditModuleLabel(r.module)}</TableCell>
                  <TableCell>
                    <Badge variant={auditActionBadgeVariant(r.action)}>
                      {auditActionLabel(r.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate lg:table-cell" title={r.details ?? undefined}>
                    {r.details ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ver detalle del asiento de ${r.userName ?? "usuario desconocido"}`}
                          onClick={() => setDetalle(r)}
                        >
                          <Eye className="size-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Ver detalle</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </ScrollArea>
      </div>


      {/* Paginación completa con números de página */}
      {!loading && !error && registros.length > 0 ? (
        <TablePagination
          page={page}
          total={meta.total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          maxVisible={5}
        />
      ) : null}


      <AuditoriaDetalleDialog registro={detalle} onOpenChange={(o) => !o && setDetalle(null)} />
    </div>
  );
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
