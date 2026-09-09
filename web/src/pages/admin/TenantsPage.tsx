import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Pencil, Plus, Power, Search, SquareArrowOutUpRight } from "lucide-react";
import {
  Table,
  TableScrollContainer,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { TenantFormSheet } from "../../components/admin/TenantFormSheet.tsx";
import { CambiarEstadoTenantDialog } from "../../components/admin/CambiarEstadoTenantDialog.tsx";
import { getPlanMeta } from "../../lib/planes.ts";
import {
  cambiarEstadoTenant,
  crearTenant,
  editarTenant,
  listarTenants,
} from "../../api/admin.ts";
import {
  ApiError,
  PLANES_TENANT,
  type ApiMeta,
  type EstadoTenantFiltro,
  type PlanTenant,
  type Tenant,
} from "../../types/index.ts";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

/** Valor de los Select de filtro para "sin filtrar" (Radix no admite value=""). */
const TODOS = "todos";

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [meta,    setMeta]    = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [page,    setPage]    = useState(1);

  // Filtros: el texto se debouncea para no pegarle al backend en cada tecla.
  const [q,       setQ]       = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [plan,    setPlan]    = useState<PlanTenant | typeof TODOS>(TODOS);
  const [estado,  setEstado]  = useState<EstadoTenantFiltro | typeof TODOS>(TODOS);

  const [formOpen, setFormOpen] = useState(false);
  const [editing,  setEditing]  = useState<Tenant | null>(null);
  const [aCambiarEstado, setACambiarEstado] = useState<Tenant | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);

  // Cambiar cualquier filtro vuelve a la primera página: la paginación anterior
  // no aplica al nuevo conjunto de resultados.
  useEffect(() => {
    setPage(1);
  }, [qDebounced, plan, estado]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarTenants({
        page,
        limit: PAGE_SIZE,
        ...(qDebounced ? { q: qDebounced } : {}),
        ...(plan   !== TODOS ? { plan } : {}),
        ...(estado !== TODOS ? { estado } : {}),
      });
      setTenants(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las clínicas");
    } finally {
      setLoading(false);
    }
  }, [page, qDebounced, plan, estado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const hayFiltros = qDebounced !== "" || plan !== TODOS || estado !== TODOS;
  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  function abrirNuevo() { setEditing(null); setFormOpen(true); }
  function abrirEdicion(t: Tenant) { setEditing(t); setFormOpen(true); }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Building2 className="size-6" aria-hidden />
            Tenants
          </h1>
          <p className="text-sm text-muted-foreground">
            Clínicas de la plataforma: plan contratado, estado y módulos habilitados.
          </p>
        </div>
        <Button onClick={abrirNuevo}>
          <Plus className="size-4" aria-hidden />
          Nuevo tenant
        </Button>
      </header>

      {/* Filtros */}
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="filtro-q">Buscar</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="filtro-q"
              className="pl-8"
              placeholder="Nombre o CUIT/RUT…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filtro-plan">Plan</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as PlanTenant | typeof TODOS)}>
            <SelectTrigger id="filtro-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los planes</SelectItem>
              {PLANES_TENANT.map((p) => (
                <SelectItem key={p} value={p}>{getPlanMeta(p).label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filtro-estado">Estado</Label>
          <Select
            value={estado}
            onValueChange={(v) => setEstado(v as EstadoTenantFiltro | typeof TODOS)}
          >
            <SelectTrigger id="filtro-estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los estados</SelectItem>
              <SelectItem value="activo">Activo</SelectItem>
              <SelectItem value="suspendido">Suspendido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      <TableScrollContainer aria-label="Listado de clínicas">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Clínica</TableHead>
              <TableHead className="hidden md:table-cell">Email de contacto</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="hidden lg:table-cell">Administrador</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p role="alert" className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void cargar()}>
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "Ninguna clínica coincide con los filtros aplicados."
                    : "Todavía no hay clínicas. Creá la primera con “Nuevo tenant”."}
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((t) => (
                <TableRow key={t.id} className={t.activo ? undefined : "opacity-70"}>
                  <TableCell className="whitespace-normal">
                    <Link
                      to={`/admin/tenants/${t.id}`}
                      className="font-medium text-orange-800 underline-offset-4 hover:underline"
                    >
                      {t.nombre}
                    </Link>
                    <p className="text-xs text-muted-foreground">{t.cuitRut}</p>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell text-muted-foreground">
                    {t.emailContacto}
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={t.plan} />
                  </TableCell>
                  <TableCell>
                    <EstadoBadge activo={t.activo} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {t.adminInvitado ? (
                      <span className="text-sm text-muted-foreground">Con administrador</span>
                    ) : (
                      <Badge variant="secondary">Sin administrador</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" asChild>
                            <Link to={`/admin/tenants/${t.id}`} aria-label={`Ver detalle de ${t.nombre}`}>
                              <SquareArrowOutUpRight className="size-4" aria-hidden />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ver detalle</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${t.nombre}`}
                            onClick={() => abrirEdicion(t)}
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
                            aria-label={
                              t.activo ? `Suspender ${t.nombre}` : `Reactivar ${t.nombre}`
                            }
                            onClick={() => setACambiarEstado(t)}
                          >
                            <Power className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t.activo ? "Suspender" : "Reactivar"}</TooltipContent>
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
      {!loading && !error && tenants.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} clínica{meta.total === 1 ? "" : "s"} · Página {meta.page} de {totalPages}
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

      <TenantFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        tenant={editing}
        crear={crearTenant}
        editar={editarTenant}
        onSaved={() => void cargar()}
      />

      <CambiarEstadoTenantDialog
        tenant={aCambiarEstado}
        open={Boolean(aCambiarEstado)}
        onOpenChange={(o) => !o && setACambiarEstado(null)}
        cambiarEstado={cambiarEstadoTenant}
        onSuccess={() => void cargar()}
      />
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const meta = getPlanMeta(plan);
  return <Badge className={meta.badgeClass}>{meta.label}</Badge>;
}

function EstadoBadge({ activo }: { activo: boolean }) {
  if (activo) {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>;
  }
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Suspendido</Badge>;
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
