import { useCallback, useEffect, useState } from "react";
import { Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";
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
import { ClienteFormDialog } from "../components/clientes/ClienteFormDialog.tsx";
import { DeleteClienteDialog } from "../components/clientes/DeleteClienteDialog.tsx";
import { crearCliente, editarCliente, eliminarCliente, listarClientes } from "../api/clientes.ts";
import { ApiError, type ApiMeta, type Cliente } from "../types/index.ts";

const PAGE_SIZE = 20;
const NO_DELETE_MSG = "No se puede eliminar: el cliente tiene mascotas vivas";

export function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [toDelete, setToDelete] = useState<Cliente | null>(null);

  // Debounce de la búsqueda (RN: búsqueda por nombre/DNI/teléfono).
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
      const { items, meta } = await listarClientes({ search: search || undefined, page, limit: PAGE_SIZE });
      setClientes(items);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los clientes");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrirNuevo() {
    setEditing(null);
    setFormOpen(true);
  }

  function abrirEdicion(cliente: Cliente) {
    setEditing(cliente);
    setFormOpen(true);
  }

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Users className="size-6" aria-hidden />
            Clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestión de clientes de la veterinaria. Alta, edición y baja lógica.
          </p>
        </div>
        <Button onClick={abrirNuevo}>
          <UserPlus className="size-4" aria-hidden />
          Nuevo cliente
        </Button>
      </header>

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Buscar por nombre, DNI/CUIT o teléfono"
          aria-label="Buscar clientes"
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-orange-50 hover:bg-orange-50">
              <TableHead>Nombre</TableHead>
              <TableHead>DNI/CUIT</TableHead>
              <TableHead className="hidden md:table-cell">Teléfono</TableHead>
              <TableHead className="hidden lg:table-cell">Email</TableHead>
              <TableHead className="hidden xl:table-cell">Dirección</TableHead>
              <TableHead className="hidden md:table-cell">Mascotas</TableHead>
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
            ) : clientes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {search
                    ? "No hay clientes que coincidan con la búsqueda."
                    : "Todavía no hay clientes. Creá el primero con “Nuevo cliente”."}
                </TableCell>
              </TableRow>
            ) : (
              clientes.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-medium">{cliente.fullName}</TableCell>
                  <TableCell>{cliente.dniCuit}</TableCell>
                  <TableCell className="hidden md:table-cell">{cliente.phone}</TableCell>
                  <TableCell className="hidden lg:table-cell">{cliente.email ?? "—"}</TableCell>
                  <TableCell className="hidden xl:table-cell">{cliente.address}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={cliente.livePetCount > 0 ? "secondary" : "outline"}>
                      {cliente.livePetCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${cliente.fullName}`}
                        onClick={() => abrirEdicion(cliente)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <DeleteButton cliente={cliente} onDelete={setToDelete} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && clientes.length > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {meta.total} cliente{meta.total === 1 ? "" : "s"} · Página {meta.page} de {totalPages}
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

      <ClienteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        cliente={editing}
        crear={crearCliente}
        editar={editarCliente}
        onSaved={() => void cargar()}
      />

      <DeleteClienteDialog
        cliente={toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        eliminar={eliminarCliente}
        onDeleted={() => void cargar()}
      />
    </div>
  );
}

/** Botón Eliminar: deshabilitado + tooltip cuando hay mascotas vivas (RN-CL8). */
function DeleteButton({
  cliente,
  onDelete,
}: {
  cliente: Cliente;
  onDelete: (cliente: Cliente) => void;
}) {
  const bloqueado = cliente.livePetCount > 0;

  if (!bloqueado) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Eliminar ${cliente.fullName}`}
        className="text-destructive hover:text-destructive"
        onClick={() => onDelete(cliente)}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span envoltorio: un botón deshabilitado no emite eventos de hover. */}
        <span title={NO_DELETE_MSG} tabIndex={0}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Eliminar ${cliente.fullName}`}
            disabled
            className="text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{NO_DELETE_MSG}</TooltipContent>
    </Tooltip>
  );
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
