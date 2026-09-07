import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Pencil, Plus, Power, Search, Truck, X } from "lucide-react";
import { StockBreadcrumb } from "../components/comercial/StockBreadcrumb.tsx";
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
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.tsx";
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
  actualizarProveedor,
  cambiarEstadoProveedor,
  crearProveedor,
  listarProveedores,
} from "../api/comercial/proveedores.ts";
import { ClienteCombobox } from "../components/historial/ClienteCombobox.tsx";
import {
  ApiError,
  type ApiMeta,
  type Cliente,
  type CondicionFiscal,
  type CrearProveedorInput,
  type Proveedor,
} from "../types/index.ts";

const PAGE_SIZE = 20;

const CONDICION_FISCAL_OPCIONES: Array<{ value: CondicionFiscal; label: string }> = [
  { value: "consumidor_final", label: "Consumidor Final" },
  { value: "monotributista", label: "Monotributista" },
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "exento", label: "Exento" },
  { value: "no_alcanzado", label: "No Alcanzado" },
  { value: "sin_datos", label: "Sin Datos" },
];

const CONDICION_FISCAL_LABELS: Record<string, string> = {
  consumidor_final: "Consumidor Final",
  monotributista: "Monotributista",
  responsable_inscripto: "Resp. Inscripto",
  exento: "Exento",
  no_alcanzado: "No Alcanzado",
  sin_datos: "Sin Datos",
};

function CondicionFiscalBadge({ condicion }: { condicion?: string | null }) {
  if (!condicion) return <span className="text-muted-foreground text-xs">—</span>;
  const label = CONDICION_FISCAL_LABELS[condicion] ?? condicion;
  return (
    <Badge
      variant="outline"
      className="text-xs font-normal border-slate-300 text-slate-700 bg-slate-50 hover:bg-slate-50"
    >
      {label}
    </Badge>
  );
}

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

export function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activoFilter, setActivoFilter] = useState<"true" | "false" | "">("");
  const [page, setPage] = useState(1);

  // Sheet & Dialogs
  const [sheetOpen, setSheetOpen] = useState(false);
  const [proveedorEditar, setProveedorEditar] = useState<Proveedor | null>(null);
  const [dialogBajaOpen, setDialogBajaOpen] = useState(false);
  const [proveedorBaja, setProveedorBaja] = useState<Proveedor | null>(null);

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

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listarProveedores({
        search: search || undefined,
        activo: activoFilter ? activoFilter === "true" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setProveedores(res.items);
      setMeta(res.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los proveedores");
    } finally {
      setLoading(false);
    }
  }, [search, activoFilter, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function handleReactivar(prov: Proveedor) {
    try {
      await cambiarEstadoProveedor(prov.id, true);
      toast.success(`«${prov.razonSocial}» reactivado`);
      void cargar();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo reactivar el proveedor");
    }
  }

  const hayFiltros = Boolean(search || activoFilter);
  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StockBreadcrumb items={[{ label: "Gestión de Proveedores" }]} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Truck className="size-6 text-orange-700" aria-hidden />
            Proveedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestión de proveedores comerciales, datos fiscales y contactos de compra.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
          onClick={() => {
            setProveedorEditar(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="size-4 mr-1.5" aria-hidden />
          Nuevo proveedor
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
            placeholder="Buscar por razón social, fantasía o CUIT..."
            aria-label="Buscar proveedores"
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
              <SelectItem value="true">Activos</SelectItem>
              <SelectItem value="false">Dados de baja</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla de listado */}
      <TableScrollContainer aria-label="Proveedores">
        <Table>
          <TableHeader className="bg-orange-50/70">
            <TableRow>
              <TableHead>Razón social</TableHead>
              <TableHead className="hidden md:table-cell">Nombre de fantasía</TableHead>
              <TableHead>CUIT</TableHead>
              <TableHead>Condición fiscal</TableHead>
              <TableHead className="hidden lg:table-cell">Teléfono</TableHead>
              <TableHead className="hidden xl:table-cell">Email</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows columnas={8} />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center">
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
            ) : proveedores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay proveedores que coincidan con los filtros aplicados."
                    : "No hay proveedores registrados."}
                </TableCell>
              </TableRow>
            ) : (
              proveedores.map((prov) => (
                <TableRow key={prov.id} className={prov.activo ? undefined : "opacity-60 bg-muted/30"}>
                  <TableCell className="font-medium text-foreground">
                    {prov.razonSocial}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {prov.nombreFantasia || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {prov.cuit || "—"}
                  </TableCell>
                  <TableCell>
                    <CondicionFiscalBadge condicion={prov.condicionFiscal} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {prov.telefono || "—"}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                    {prov.email || "—"}
                  </TableCell>
                  <TableCell>
                    {prov.activo ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Dado de baja</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${prov.razonSocial}`}
                            onClick={() => {
                              setProveedorEditar(prov);
                              setSheetOpen(true);
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
                            aria-label={prov.activo ? `Dar de baja ${prov.razonSocial}` : `Reactivar ${prov.razonSocial}`}
                            onClick={() => {
                              if (prov.activo) {
                                setProveedorBaja(prov);
                                setDialogBajaOpen(true);
                              } else {
                                void handleReactivar(prov);
                              }
                            }}
                          >
                            <Power className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{prov.activo ? "Dar de baja" : "Reactivar"}</TooltipContent>
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
      <Paginacion
        meta={meta}
        totalPages={totalPages}
        page={page}
        setPage={setPage}
        singular="proveedor"
        plural="proveedores"
      />

      {/* Sheet de Alta / Edición */}
      <ProveedorFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        proveedor={proveedorEditar}
        onSaved={() => {
          setSheetOpen(false);
          void cargar();
        }}
      />

      {/* Diálogo de Baja Lógica */}
      <DesactivarProveedorDialog
        open={dialogBajaOpen}
        onOpenChange={setDialogBajaOpen}
        proveedor={proveedorBaja}
        onSuccess={() => {
          setDialogBajaOpen(false);
          void cargar();
        }}
      />
    </div>
  );
}

// ─── Componente: Formulario de Proveedor (Sheet) ─────────────────────────────

interface ProveedorFormValues {
  razonSocial: string;
  nombreFantasia: string;
  cuit: string;
  condicionFiscal: string;
  telefono: string;
  email: string;
  direccion: string;
  contactoNombre: string;
  observaciones: string;
  clienteId: string;
}

const PROVEEDOR_FORM_VACIO: ProveedorFormValues = {
  razonSocial: "",
  nombreFantasia: "",
  cuit: "",
  condicionFiscal: "",
  telefono: "",
  email: "",
  direccion: "",
  contactoNombre: "",
  observaciones: "",
  clienteId: "",
};

function ProveedorFormSheet({
  open,
  onOpenChange,
  proveedor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proveedor?: Proveedor | null;
  onSaved: () => void;
}) {
  const esEdicion = Boolean(proveedor);
  const [values, setValues] = useState<ProveedorFormValues>(PROVEEDOR_FORM_VACIO);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrores({});
    if (proveedor) {
      setValues({
        razonSocial: proveedor.razonSocial,
        nombreFantasia: proveedor.nombreFantasia ?? "",
        cuit: proveedor.cuit ?? "",
        condicionFiscal: proveedor.condicionFiscal ?? "",
        telefono: proveedor.telefono ?? "",
        email: proveedor.email ?? "",
        direccion: proveedor.direccion ?? "",
        contactoNombre: proveedor.contactoNombre ?? "",
        observaciones: proveedor.observaciones ?? "",
        clienteId: proveedor.clienteId ?? "",
      });
      if (proveedor.clienteId) {
        setClienteSeleccionado({
          id: proveedor.clienteId,
          fullName: "Cliente vinculado",
          dniCuit: null,
          phone: null,
          address: null,
          email: null,
          observations: null,
          createdAt: "",
          createdBy: null,
          livePetCount: 0,
        });
      } else {
        setClienteSeleccionado(null);
      }
    } else {
      setValues(PROVEEDOR_FORM_VACIO);
      setClienteSeleccionado(null);
    }
  }, [open, proveedor]);

  function handleChange(field: keyof ProveedorFormValues, val: string) {
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

    const rs = values.razonSocial.trim();
    if (!rs) {
      errs.razonSocial = "La razón social es obligatoria";
    } else if (rs.length < 2) {
      errs.razonSocial = "La razón social debe tener al menos 2 caracteres";
    } else if (rs.length > 150) {
      errs.razonSocial = "La razón social no puede superar 150 caracteres";
    }

    if (values.nombreFantasia && values.nombreFantasia.length > 150) {
      errs.nombreFantasia = "El nombre de fantasía no puede superar 150 caracteres";
    }

    // El CUIT NO se valida por dígito verificador en el frontend (solo max 20)
    if (values.cuit && values.cuit.trim().length > 20) {
      errs.cuit = "El CUIT no puede superar 20 caracteres";
    }

    if (values.telefono && values.telefono.length > 40) {
      errs.telefono = "El teléfono no puede superar 40 caracteres";
    }

    if (values.email && values.email.trim()) {
      const em = values.email.trim();
      if (em.length > 150) {
        errs.email = "El correo electrónico no puede superar 150 caracteres";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        errs.email = "El formato de correo electrónico no es válido";
      }
    }

    if (values.direccion && values.direccion.length > 200) {
      errs.direccion = "La dirección no puede superar 200 caracteres";
    }

    if (values.contactoNombre && values.contactoNombre.length > 120) {
      errs.contactoNombre = "El nombre de contacto no puede superar 120 caracteres";
    }

    if (values.observaciones && values.observaciones.length > 500) {
      errs.observaciones = "Las observaciones no pueden superar 500 caracteres";
    }

    setErrores(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validar()) return;

    setSubmitting(true);
    try {
      // Los campos vacíos van como null, no como "" (regla transversal). Sin tenantId.
      const payload: CrearProveedorInput = {
        razonSocial: values.razonSocial.trim(),
        nombreFantasia: values.nombreFantasia.trim() || null,
        cuit: values.cuit.trim() || null,
        condicionFiscal: (values.condicionFiscal as CondicionFiscal) || null,
        telefono: values.telefono.trim() || null,
        email: values.email.trim() || null,
        direccion: values.direccion.trim() || null,
        contactoNombre: values.contactoNombre.trim() || null,
        observaciones: values.observaciones.trim() || null,
        clienteId: values.clienteId || null,
      };

      if (esEdicion && proveedor) {
        await actualizarProveedor(proveedor.id, payload);
        toast.success("Proveedor actualizado");
      } else {
        await crearProveedor(payload);
        toast.success("Proveedor creado");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "PROVEEDOR_RAZON_SOCIAL_DUPLICATE") {
          setErrores((prev) => ({ ...prev, razonSocial: err.message }));
          return;
        }
        if (err.code === "CUIT_DUPLICATE") {
          setErrores((prev) => ({ ...prev, cuit: err.message }));
          return;
        }
        toast.error(err.message);
      } else {
        toast.error("Ocurrió un error inesperado al guardar el proveedor");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <SheetHeader>
            <SheetTitle>{esEdicion ? "Editar proveedor" : "Nuevo proveedor"}</SheetTitle>
            <SheetDescription>
              Complete los datos del proveedor para la gestión de compras y facturación.
            </SheetDescription>
          </SheetHeader>

          {/* 1. Datos Principales */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Identificación y Fiscal</h3>

            <div className="space-y-1">
              <Label htmlFor="prov-razonSocial" className="text-xs">
                Razón social <span className="text-destructive">*</span>
              </Label>
              <Input
                id="prov-razonSocial"
                placeholder="Ej. Distribuidora Veterinaria Sur S.A."
                value={values.razonSocial}
                onChange={(e) => handleChange("razonSocial", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.razonSocial)}
              />
              {errores.razonSocial ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.razonSocial}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="prov-nombreFantasia" className="text-xs">Nombre de fantasía</Label>
              <Input
                id="prov-nombreFantasia"
                placeholder="Ej. VetSur"
                value={values.nombreFantasia}
                onChange={(e) => handleChange("nombreFantasia", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.nombreFantasia)}
              />
              {errores.nombreFantasia ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.nombreFantasia}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="prov-cuit" className="text-xs">CUIT</Label>
                <Input
                  id="prov-cuit"
                  placeholder="30-12345678-9"
                  value={values.cuit}
                  onChange={(e) => handleChange("cuit", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.cuit)}
                />
                {errores.cuit ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.cuit}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prov-condicionFiscal" className="text-xs">Condición fiscal</Label>
                <Select
                  value={values.condicionFiscal || "__sin_definir__"}
                  onValueChange={(val) =>
                    handleChange("condicionFiscal", val === "__sin_definir__" ? "" : val)
                  }
                  disabled={submitting}
                >
                  <SelectTrigger id="prov-condicionFiscal" aria-label="Condición fiscal">
                    <SelectValue placeholder="Seleccionar condición..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__sin_definir__">Sin definir</SelectItem>
                    {CONDICION_FISCAL_OPCIONES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 2. Contacto */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Contacto</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="prov-telefono" className="text-xs">Teléfono</Label>
                <Input
                  id="prov-telefono"
                  placeholder="011 4444-5555"
                  value={values.telefono}
                  onChange={(e) => handleChange("telefono", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.telefono)}
                />
                {errores.telefono ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.telefono}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prov-email" className="text-xs">Email</Label>
                <Input
                  id="prov-email"
                  type="email"
                  placeholder="ventas@vetsur.com"
                  value={values.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.email)}
                />
                {errores.email ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.email}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="prov-contactoNombre" className="text-xs">Nombre del contacto</Label>
              <Input
                id="prov-contactoNombre"
                placeholder="Ej. Juan Pérez (Ejecutivo de cuentas)"
                value={values.contactoNombre}
                onChange={(e) => handleChange("contactoNombre", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.contactoNombre)}
              />
              {errores.contactoNombre ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.contactoNombre}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="prov-direccion" className="text-xs">Dirección</Label>
              <Input
                id="prov-direccion"
                placeholder="Av. Corrientes 1234, CABA"
                value={values.direccion}
                onChange={(e) => handleChange("direccion", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.direccion)}
              />
              {errores.direccion ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.direccion}
                </p>
              ) : null}
            </div>
          </div>

          {/* 3. Vínculo con Cliente (Decisión P-10) */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Vínculo con Cliente</h3>
            <p className="text-xs text-muted-foreground">
              Si este proveedor también es cliente de la clínica, vinculá su ficha. Las dos fichas siguen siendo independientes.
            </p>

            {clienteSeleccionado ? (
              <div className="flex items-center justify-between rounded-md border bg-white p-2.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{clienteSeleccionado.fullName}</p>
                  {clienteSeleccionado.dniCuit ? (
                    <p className="text-xs text-muted-foreground font-mono">
                      DNI/CUIT: {clienteSeleccionado.dniCuit}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Desvincular cliente"
                  onClick={() => {
                    setClienteSeleccionado(null);
                    handleChange("clienteId", "");
                  }}
                  disabled={submitting}
                >
                  <X className="size-4 mr-1" aria-hidden />
                  Desvincular
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <ClienteCombobox
                  value={clienteSeleccionado}
                  onChange={(c) => {
                    setClienteSeleccionado(c);
                    handleChange("clienteId", c.id);
                  }}
                />
              </div>
            )}
          </div>

          {/* 4. Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="prov-observaciones" className="text-xs">Observaciones</Label>
            <Textarea
              id="prov-observaciones"
              placeholder="Notas comerciales, condiciones de entrega o días de visita..."
              rows={3}
              value={values.observaciones}
              onChange={(e) => handleChange("observaciones", e.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errores.observaciones)}
            />
            {errores.observaciones ? (
              <p role="alert" className="text-xs text-destructive">
                {errores.observaciones}
              </p>
            ) : null}
          </div>

          <SheetFooter className="gap-2 sm:space-x-0">
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
              {submitting ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Diálogo de Baja Lógica (AlertDialog) ────────────────────────────────────

function DesactivarProveedorDialog({
  open,
  onOpenChange,
  proveedor,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proveedor?: Proveedor | null;
  onSuccess: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!proveedor) return;
    setLoading(true);
    setError(null);
    try {
      await cambiarEstadoProveedor(proveedor.id, false);
      toast.success(`«${proveedor.razonSocial}» dado de baja`);
      onSuccess();
      handleOpenChange(false);
    } catch (err) {
      // Error queda dentro del diálogo
      setError(err instanceof ApiError ? err.message : "No se pudo dar de baja el proveedor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dar de baja proveedor</AlertDialogTitle>
          <AlertDialogDescription>
            {proveedor
              ? `«${proveedor.razonSocial}» deja de ofrecerse al cargar compras nuevas. Las compras ya registradas lo siguen mostrando.`
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
