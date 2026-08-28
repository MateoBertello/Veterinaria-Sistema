import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Power, Users } from "lucide-react";
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
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.tsx";
import { UsuarioFormSheet } from "../components/usuarios/UsuarioFormSheet.tsx";
import { DesactivarUsuarioDialog } from "../components/usuarios/DesactivarUsuarioDialog.tsx";
import {
  crearUsuario,
  editarUsuario,
  listarRoles,
  listarUsuarios,
} from "../api/usuarios.ts";
import { getRolMeta } from "../lib/roles.ts";
import { ApiError, type ApiMeta, type Rol, type Usuario } from "../types/index.ts";

const PAGE_SIZE = 20;

export function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [meta,     setMeta]     = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [page,     setPage]     = useState(1);

  const [roles, setRoles] = useState<Rol[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing,  setEditing]  = useState<Usuario | null>(null);
  const [toDesactivar, setToDesactivar] = useState<Usuario | null>(null);

  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, meta } = await listarUsuarios({ page, limit: PAGE_SIZE });
      setUsuarios(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los usuarios");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Catálogo de roles: para los badges de la tabla y el selector del formulario.
  useEffect(() => {
    let activo = true;
    listarRoles()
      .then((rs) => { if (activo) setRoles(rs); })
      .catch(() => { if (activo) setRoles([]); });
    return () => { activo = false; };
  }, []);

  function abrirNuevo()  { setEditing(null); setFormOpen(true); }
  function abrirEdicion(u: Usuario) { setEditing(u); setFormOpen(true); }

  async function activar(u: Usuario) {
    try {
      await editarUsuario(u.id, { active: true });
      void cargar();
    } catch {
      // El estado se refleja recargando; sin bloqueo adicional.
    }
  }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Users className="size-6" aria-hidden />
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground">
            Cuentas del personal de la clínica, sus roles y permisos de acceso.
          </p>
        </div>
        <Button onClick={abrirNuevo}>
          <Plus className="size-4" aria-hidden />
          Nuevo usuario
        </Button>
      </header>

      {/* Tabla */}
      <TableScrollContainer aria-label="Listado de usuarios">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Usuario</TableHead>
              <TableHead>Nombre completo</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead>Rol</TableHead>
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
            ) : usuarios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay usuarios. Creá el primero con “Nuevo usuario”.
                </TableCell>
              </TableRow>
            ) : (
              usuarios.map((u) => (
                <TableRow key={u.id} className={u.active ? undefined : "opacity-70"}>
                  <TableCell className="whitespace-normal font-medium">{u.username}</TableCell>
                  <TableCell className="whitespace-normal">{u.fullName}</TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <RolBadge usuario={u} rol={rolesById.get(u.rolId)} />
                  </TableCell>
                  <TableCell>
                    <EstadoBadge activo={u.active} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${u.username}`}
                            onClick={() => abrirEdicion(u)}
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
                            aria-label={u.active ? `Desactivar ${u.username}` : `Activar ${u.username}`}
                            onClick={() => (u.active ? setToDesactivar(u) : void activar(u))}
                          >
                            <Power className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{u.active ? "Desactivar" : "Activar"}</TooltipContent>
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
      {!loading && !error && usuarios.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} usuario{meta.total === 1 ? "" : "s"} · Página {meta.page} de {totalPages}
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

      {/* Sheet / Dialogs */}
      <UsuarioFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        usuario={editing}
        roles={roles}
        crear={crearUsuario}
        editar={editarUsuario}
        onSaved={() => void cargar()}
      />

      <DesactivarUsuarioDialog
        usuario={toDesactivar}
        open={Boolean(toDesactivar)}
        onOpenChange={(o) => !o && setToDesactivar(null)}
        desactivar={(id) => editarUsuario(id, { active: false })}
        onSuccess={() => void cargar()}
      />
    </div>
  );
}

function RolBadge({ usuario, rol }: { usuario: Usuario; rol: Rol | undefined }) {
  const meta = getRolMeta(rol?.name);
  const label = usuario.rolName || rol?.displayName || meta.displayName || "—";
  return <Badge className={meta.badgeClass}>{label}</Badge>;
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
