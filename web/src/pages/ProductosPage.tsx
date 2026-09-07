import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Package, Pencil, Plus, Power, Search, Tag } from "lucide-react";
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
import { Switch } from "../components/ui/switch.tsx";
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
import { useAuth } from "../auth/AuthContext.tsx";
import {
  actualizarProducto,
  cambiarEstadoProducto,
  crearProducto,
  listarFamilias,
  listarProductos,
} from "../api/comercial/productos.ts";
import { listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import {
  ALICUOTAS_IVA,
  ApiError,
  type ApiMeta,
  type CondicionVenta,
  type CrearProductoInput,
  type Familia,
  type Producto,
  type UnidadMedida,
} from "../types/index.ts";

const PAGE_SIZE = 20;

function formatearMoneda(valor: number): string {
  return "$ " + valor.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calcularMargenPorcentaje(precio: number, costo: number): string {
  if (costo <= 0) return "0.0%";
  const m = ((precio - costo) / costo) * 100;
  return `${m.toFixed(1)}%`;
}

function CondicionVentaBadge({ condicion }: { condicion: string }) {
  if (condicion === "libre") return null;
  const labels: Record<string, string> = {
    bajo_receta: "Bajo receta",
    bajo_receta_archivada: "Bajo receta archivada",
    uso_profesional: "Uso profesional",
  };
  return (
    <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 text-xs font-normal">
      {labels[condicion] ?? condicion}
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

export function ProductosPage() {
  const { user } = useAuth();
  const tieneViewSales = Boolean(user?.permissions.includes("view_sales"));

  const [productos, setProductos] = useState<Producto[]>([]);
  const [meta, setMeta] = useState<ApiMeta>({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [familiaId, setFamiliaId] = useState<string>("");
  const [activoFilter, setActivoFilter] = useState<"true" | "false" | "">("");
  const [soloVendibles, setSoloVendibles] = useState(false);
  const [page, setPage] = useState(1);

  // Catálogos globales cargados UNA sola vez (RN rendimiento / N+1)
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);

  // Diálogos / Sheets
  const [sheetOpen, setSheetOpen] = useState(false);
  const [productoEditar, setProductoEditar] = useState<Producto | null>(null);
  const [dialogBajaOpen, setDialogBajaOpen] = useState(false);
  const [productoBaja, setProductoBaja] = useState<Producto | null>(null);

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

  // Cargar catálogos UNA sola vez en el montaje
  useEffect(() => {
    let activo = true;
    async function cargarCatalogos() {
      try {
        const [famRes, uniRes] = await Promise.all([
          listarFamilias({ limit: 100 }),
          listarUnidadesMedida(),
        ]);
        if (!activo) return;
        setFamilias(famRes.items);
        setUnidades(uniRes);
      } catch (err) {
        console.error("Error al cargar catálogos auxiliares:", err);
      }
    }
    void cargarCatalogos();
    return () => {
      activo = false;
    };
  }, []);

  const familiasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of familias) {
      map.set(f.id, f.nombre);
    }
    return map;
  }, [familias]);

  const unidadesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of unidades) {
      map.set(u.id, u.abreviatura || u.nombre);
    }
    return map;
  }, [unidades]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listarProductos({
        search: search || undefined,
        familiaId: familiaId || undefined,
        activo: activoFilter ? activoFilter === "true" : undefined,
        vendible: soloVendibles ? true : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setProductos(res.items);
      setMeta(res.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los productos");
    } finally {
      setLoading(false);
    }
  }, [search, familiaId, activoFilter, soloVendibles, page]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function handleReactivar(prod: Producto) {
    try {
      await cambiarEstadoProducto(prod.id, true);
      toast.success(`«${prod.nombre}» reactivado`);
      void cargar();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo reactivar el producto");
    }
  }

  const hayFiltros = Boolean(search || familiaId || activoFilter || soloVendibles);
  // Productos sin precio de venta. El conteo es sobre la página cargada: la API
  // de productos no expone un filtro "sin precio", así que un total del catálogo
  // exigiría paginarlo entero desde el cliente.
  const sinPrecio = useMemo(
    () => productos.filter((p) => p.precioVenta === null || p.precioVenta === undefined).length,
    [productos],
  );

  const totalPages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <StockBreadcrumb items={[{ label: "Productos" }]} />
      {sinPrecio > 0 && (
        <div
          role="status"
          aria-label="Productos sin precio"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>
            Hay <strong>{sinPrecio}</strong>{" "}
            {sinPrecio === 1 ? "producto sin precio" : "productos sin precio"} en esta página.
          </span>
          <Link
            to="/stock/productos/precios"
            className="font-semibold underline underline-offset-2 hover:text-amber-950"
          >
            Cargarlos en tanda
          </Link>
        </div>
      )}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
            <Package className="size-6 text-orange-700" aria-hidden />
            Catálogo de Productos
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo general de productos, precios y control de existencias.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/stock/productos/precios">
              <Tag className="size-4 mr-1.5" aria-hidden />
              Actualizar precios
            </Link>
          </Button>
          <Button
            size="sm"
            className="bg-orange-600 hover:bg-orange-700 text-white"
            onClick={() => {
              setProductoEditar(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="size-4 mr-1.5" aria-hidden />
            Nuevo producto
          </Button>
        </div>
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
            placeholder="Buscar por código o nombre..."
            aria-label="Buscar productos"
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="w-48">
          <Select
            value={familiaId || "todas"}
            onValueChange={(val) => {
              setFamiliaId(val === "todas" ? "" : val);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por familia">
              <SelectValue placeholder="Todas las familias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las familias</SelectItem>
              {familias.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

        <div className="flex items-center space-x-2 pl-2">
          <Switch
            id="filtro-vendibles"
            checked={soloVendibles}
            onCheckedChange={(checked) => {
              setSoloVendibles(checked);
              setPage(1);
            }}
          />
          <Label htmlFor="filtro-vendibles" className="text-sm font-normal cursor-pointer">
            Solo vendibles
          </Label>
        </div>
      </div>

      {/* Tabla de listado */}
      <TableScrollContainer aria-label="Catálogo de productos">
        <Table>
          <TableHeader className="bg-orange-50/70">
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Familia</TableHead>
              <TableHead className="hidden md:table-cell">Marca</TableHead>
              <TableHead className="hidden lg:table-cell">Unidad</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="hidden xl:table-cell text-right">Alícuota</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LoadingRows columnas={9} />
            ) : error ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center">
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
            ) : productos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  {hayFiltros
                    ? "No hay productos que coincidan con los filtros aplicados."
                    : "No hay productos registrados en el catálogo."}
                </TableCell>
              </TableRow>
            ) : (
              productos.map((prod) => {
                const nombreFamilia = prod.familiaId ? familiasMap.get(prod.familiaId) ?? "—" : "—";
                const nombreUnidad = unidadesMap.get(prod.unidadMedidaId) ?? "—";

                return (
                  <TableRow key={prod.id} className={prod.activo ? undefined : "opacity-60 bg-muted/30"}>
                    <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                      {prod.codigo}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">{prod.nombre}</span>
                        <div className="flex flex-wrap gap-1">
                          <CondicionVentaBadge condicion={prod.condicionVenta} />
                          {prod.requiereFrio ? (
                            <Badge variant="outline" className="text-blue-700 border-blue-300 text-[10px] px-1 py-0">
                              Frío
                            </Badge>
                          ) : null}
                          {prod.trazable ? (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px] px-1 py-0">
                              Trazable
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{nombreFamilia}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {prod.marca || "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {nombreUnidad}
                    </TableCell>
                    <TableCell className="text-right">
                      {prod.precioVenta !== null && prod.precioVenta !== undefined ? (
                        <div className="flex flex-col items-end">
                          <span className="font-medium">{formatearMoneda(prod.precioVenta)}</span>
                          {/*
                            No es una barrera de seguridad — costoReposicion y margenObjetivo viajan
                            en el payload de GET /productos bajo view_stock, que la recepcionista tiene.
                            Ver PLAN_FRONTEND_COMERCIAL.md §2.4.
                          */}
                          {tieneViewSales &&
                          prod.costoReposicion !== null &&
                          prod.costoReposicion !== undefined &&
                          prod.costoReposicion > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              Margen: {calcularMargenPorcentaje(prod.precioVenta, prod.costoReposicion)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">
                          Sin precio
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-right text-sm text-muted-foreground">
                      {prod.alicuotaIva}%
                    </TableCell>
                    <TableCell>
                      {prod.activo ? (
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
                              aria-label={`Editar ${prod.nombre}`}
                              onClick={() => {
                                setProductoEditar(prod);
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
                              aria-label={prod.activo ? `Dar de baja ${prod.nombre}` : `Reactivar ${prod.nombre}`}
                              onClick={() => {
                                if (prod.activo) {
                                  setProductoBaja(prod);
                                  setDialogBajaOpen(true);
                                } else {
                                  void handleReactivar(prod);
                                }
                              }}
                            >
                              <Power className="size-4" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{prod.activo ? "Dar de baja" : "Reactivar"}</TooltipContent>
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
        singular="producto"
        plural="productos"
      />

      {/* Sheet de Alta / Edición */}
      <ProductoFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        producto={productoEditar}
        familias={familias}
        unidades={unidades}
        tieneViewSales={tieneViewSales}
        onSaved={() => {
          setSheetOpen(false);
          void cargar();
        }}
      />

      {/* Diálogo de Baja Lógica */}
      <DesactivarProductoDialog
        open={dialogBajaOpen}
        onOpenChange={setDialogBajaOpen}
        producto={productoBaja}
        onSuccess={() => {
          setDialogBajaOpen(false);
          void cargar();
        }}
      />
    </div>
  );
}

// ─── Componente: Formulario de Producto (Alta / Edición en Sheet) ─────────────

interface FormValues {
  codigo: string;
  nombre: string;
  descripcion: string;
  marca: string;
  codigoBarras: string;
  familiaId: string;
  unidadMedidaId: string;
  condicionVenta: CondicionVenta;
  precioVenta: string;
  alicuotaIva: number;
  costoReposicion: string;
  margenObjetivo: string;
  controlaLote: boolean;
  controlaVencimiento: boolean;
  vidaUtilPostAperturaDias: string;
  stockMinimo: string;
  requiereFrio: boolean;
  trazable: boolean;
  esVendible: boolean;
  esConsumibleClinico: boolean;
}

const FORM_VACIO: FormValues = {
  codigo: "",
  nombre: "",
  descripcion: "",
  marca: "",
  codigoBarras: "",
  familiaId: "",
  unidadMedidaId: "",
  condicionVenta: "libre",
  precioVenta: "",
  alicuotaIva: 21,
  costoReposicion: "",
  margenObjetivo: "",
  controlaLote: true,
  controlaVencimiento: true,
  vidaUtilPostAperturaDias: "",
  stockMinimo: "",
  requiereFrio: false,
  trazable: false,
  esVendible: true,
  esConsumibleClinico: false,
};

function ProductoFormSheet({
  open,
  onOpenChange,
  producto,
  familias,
  unidades,
  tieneViewSales,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  producto?: Producto | null;
  familias: Familia[];
  unidades: UnidadMedida[];
  tieneViewSales: boolean;
  onSaved: () => void;
}) {
  const esEdicion = Boolean(producto);
  const [values, setValues] = useState<FormValues>(FORM_VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrores({});
    if (producto) {
      setValues({
        codigo: producto.codigo,
        nombre: producto.nombre,
        descripcion: producto.descripcion ?? "",
        marca: producto.marca ?? "",
        codigoBarras: producto.codigoBarras ?? "",
        familiaId: producto.familiaId ?? "",
        unidadMedidaId: producto.unidadMedidaId,
        condicionVenta: (producto.condicionVenta as CondicionVenta) ?? "libre",
        precioVenta: producto.precioVenta !== null && producto.precioVenta !== undefined ? String(producto.precioVenta) : "",
        alicuotaIva: producto.alicuotaIva,
        costoReposicion: producto.costoReposicion !== null && producto.costoReposicion !== undefined ? String(producto.costoReposicion) : "",
        margenObjetivo: producto.margenObjetivo !== null && producto.margenObjetivo !== undefined ? String(producto.margenObjetivo) : "",
        controlaLote: producto.controlaLote,
        controlaVencimiento: producto.controlaVencimiento,
        vidaUtilPostAperturaDias: producto.vidaUtilPostAperturaDias ? String(producto.vidaUtilPostAperturaDias) : "",
        stockMinimo: producto.stockMinimo !== null && producto.stockMinimo !== undefined ? String(producto.stockMinimo) : "",
        requiereFrio: producto.requiereFrio,
        trazable: producto.trazable,
        esVendible: producto.esVendible,
        esConsumibleClinico: producto.esConsumibleClinico,
      });
    } else {
      setValues({
        ...FORM_VACIO,
        unidadMedidaId: unidades[0]?.id ?? "",
      });
    }
  }, [open, producto, unidades]);

  function handleChange(field: keyof FormValues, val: unknown) {
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

    const cod = values.codigo.trim();
    if (!cod) {
      errs.codigo = "El código es obligatorio";
    } else if (cod.length > 50) {
      errs.codigo = "El código no puede superar 50 caracteres";
    }

    const nom = values.nombre.trim();
    if (!nom) {
      errs.nombre = "El nombre es obligatorio";
    } else if (nom.length < 3) {
      errs.nombre = "El nombre debe tener al menos 3 caracteres";
    } else if (nom.length > 150) {
      errs.nombre = "El nombre no puede superar 150 caracteres";
    }

    if (values.descripcion && values.descripcion.length > 500) {
      errs.descripcion = "La descripción no puede superar 500 caracteres";
    }

    if (values.marca && values.marca.length > 80) {
      errs.marca = "La marca no puede superar 80 caracteres";
    }

    if (values.codigoBarras && values.codigoBarras.length > 50) {
      errs.codigoBarras = "El código de barras no puede superar 50 caracteres";
    }

    if (!values.unidadMedidaId) {
      errs.unidadMedidaId = "Debe seleccionar una unidad de medida";
    }

    if (!ALICUOTAS_IVA.includes(values.alicuotaIva as 0 | 10.5 | 21 | 27)) {
      errs.alicuotaIva = "La alícuota debe ser 0, 10.50, 21 o 27";
    }

    if (values.precioVenta.trim() !== "") {
      const pv = Number(values.precioVenta);
      if (isNaN(pv) || pv < 0) {
        errs.precioVenta = "El precio debe ser un número mayor o igual a 0";
      }
    }

    if (values.costoReposicion.trim() !== "") {
      const cr = Number(values.costoReposicion);
      if (isNaN(cr) || cr < 0) {
        errs.costoReposicion = "El costo de reposición debe ser mayor o igual a 0";
      }
    }

    if (values.margenObjetivo.trim() !== "") {
      const mo = Number(values.margenObjetivo);
      if (isNaN(mo) || mo < 0 || mo > 999.99) {
        errs.margenObjetivo = "El margen objetivo debe estar entre 0 y 999.99%";
      }
    }

    if (values.stockMinimo.trim() !== "") {
      const sm = Number(values.stockMinimo);
      if (isNaN(sm) || sm < 0) {
        errs.stockMinimo = "El stock mínimo debe ser mayor o igual a 0";
      }
    }

    if (values.controlaVencimiento && values.vidaUtilPostAperturaDias.trim() !== "") {
      const vu = Number(values.vidaUtilPostAperturaDias);
      if (!Number.isInteger(vu) || vu < 1 || vu > 3650) {
        errs.vidaUtilPostAperturaDias = "Debe ser un número entero entre 1 y 3650 días";
      }
    }

    setErrores(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validar()) return;

    setSubmitting(true);
    try {
      // El payload contiene exactamente los campos admitidos por CrearProductoSchema, sin tenantId
      const payload: CrearProductoInput = {
        codigo: values.codigo.trim(),
        nombre: values.nombre.trim(),
        descripcion: values.descripcion.trim() || null,
        familiaId: values.familiaId || null,
        unidadMedidaId: values.unidadMedidaId,
        marca: values.marca.trim() || null,
        alicuotaIva: Number(values.alicuotaIva),
        condicionVenta: values.condicionVenta,
        controlaLote: values.controlaLote,
        controlaVencimiento: values.controlaVencimiento,
        vidaUtilPostAperturaDias:
          values.controlaVencimiento && values.vidaUtilPostAperturaDias.trim() !== ""
            ? Number(values.vidaUtilPostAperturaDias)
            : null,
        precioVenta: values.precioVenta.trim() !== "" ? Number(values.precioVenta) : null,
        costoReposicion: values.costoReposicion.trim() !== "" ? Number(values.costoReposicion) : null,
        margenObjetivo: values.margenObjetivo.trim() !== "" ? Number(values.margenObjetivo) : null,
        stockMinimo: values.stockMinimo.trim() !== "" ? Number(values.stockMinimo) : null,
        esVendible: values.esVendible,
        esConsumibleClinico: values.esConsumibleClinico,
        requiereFrio: values.requiereFrio,
        trazable: values.trazable,
        codigoBarras: values.codigoBarras.trim() || null,
      };

      if (esEdicion && producto) {
        await actualizarProducto(producto.id, payload);
        toast.success("Producto actualizado");
      } else {
        await crearProducto(payload);
        toast.success("Producto creado");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "PRODUCT_CODE_DUPLICATE") {
          setErrores((prev) => ({ ...prev, codigo: err.message }));
          return;
        }
        if (err.code === "PRODUCT_NAME_DUPLICATE") {
          setErrores((prev) => ({ ...prev, nombre: err.message }));
          return;
        }
        if (err.code === "BARCODE_DUPLICATE") {
          setErrores((prev) => ({ ...prev, codigoBarras: err.message }));
          return;
        }
        toast.error(err.message);
      } else {
        toast.error("Ocurrió un error inesperado al guardar el producto");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Margen calculado en tiempo real si se ingresan precio y costo
  const precioNum = Number(values.precioVenta);
  const costoNum = Number(values.costoReposicion);
  const margenCalculado =
    !isNaN(precioNum) &&
    !isNaN(costoNum) &&
    costoNum > 0 &&
    values.precioVenta.trim() !== "" &&
    values.costoReposicion.trim() !== ""
      ? calcularMargenPorcentaje(precioNum, costoNum)
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {/*
          noValidate: sin esto la validación nativa del navegador (los min/max de
          los inputs numéricos) bloquea el submit antes de handleSubmit, validar()
          nunca corre para esos campos y el usuario sólo ve el tooltip nativo en vez
          del mensaje con role="alert" del formulario. validar() cubre las mismas
          restricciones (precio, costo, margen, vida útil y stock mínimo).
        */}
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <SheetHeader>
            <SheetTitle>{esEdicion ? "Editar producto" : "Nuevo producto"}</SheetTitle>
            <SheetDescription>
              Complete los datos del producto para el catálogo y control de stock.
            </SheetDescription>
          </SheetHeader>

          {/* 1. Identificación */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Identificación</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="prod-codigo" className="text-xs">
                  Código <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="prod-codigo"
                  placeholder="Ej. AMOX-500"
                  value={values.codigo}
                  onChange={(e) => handleChange("codigo", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.codigo)}
                />
                {errores.codigo ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.codigo}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prod-marca" className="text-xs">Marca</Label>
                <Input
                  id="prod-marca"
                  placeholder="Ej. Laboratorio Richmond"
                  value={values.marca}
                  onChange={(e) => handleChange("marca", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.marca)}
                />
                {errores.marca ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.marca}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="prod-nombre" className="text-xs">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="prod-nombre"
                placeholder="Ej. Amoxicilina 500mg x 10 comp"
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
              <Label htmlFor="prod-codigoBarras" className="text-xs">Código de barras</Label>
              <Input
                id="prod-codigoBarras"
                placeholder="Ej. 7791234567890"
                value={values.codigoBarras}
                onChange={(e) => handleChange("codigoBarras", e.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(errores.codigoBarras)}
              />
              {errores.codigoBarras ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.codigoBarras}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="prod-descripcion" className="text-xs">Descripción</Label>
              <Textarea
                id="prod-descripcion"
                rows={2}
                placeholder="Detalle o composición del producto..."
                value={values.descripcion}
                onChange={(e) => handleChange("descripcion", e.target.value)}
                disabled={submitting}
              />
              {errores.descripcion ? (
                <p role="alert" className="text-xs text-destructive">
                  {errores.descripcion}
                </p>
              ) : null}
            </div>
          </div>

          {/* 2. Clasificación */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Clasificación</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="prod-familia" className="text-xs">Familia</Label>
                <Select
                  value={values.familiaId || "ninguna"}
                  onValueChange={(val) => handleChange("familiaId", val === "ninguna" ? "" : val)}
                  disabled={submitting}
                >
                  <SelectTrigger id="prod-familia" aria-label="Familia">
                    <SelectValue placeholder="Sin familia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Sin familia</SelectItem>
                    {familias.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="prod-unidad" className="text-xs">
                  Unidad de medida <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={values.unidadMedidaId}
                  onValueChange={(val) => handleChange("unidadMedidaId", val)}
                  disabled={submitting}
                >
                  <SelectTrigger id="prod-unidad" aria-label="Unidad de medida">
                    <SelectValue placeholder="Seleccionar unidad" />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.nombre} ({u.abreviatura})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errores.unidadMedidaId ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.unidadMedidaId}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="prod-condicionVenta" className="text-xs">Condición de venta</Label>
              <Select
                value={values.condicionVenta}
                onValueChange={(val: CondicionVenta) => handleChange("condicionVenta", val)}
                disabled={submitting}
              >
                <SelectTrigger id="prod-condicionVenta" aria-label="Condición de venta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="libre">Venta libre</SelectItem>
                  <SelectItem value="bajo_receta">Bajo receta</SelectItem>
                  <SelectItem value="bajo_receta_archivada">Bajo receta archivada</SelectItem>
                  <SelectItem value="uso_profesional">Uso profesional</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3. Precio y Costo */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Precio</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                {/* Regla §2.5: el label debe decir expresamente 'IVA incluido' */}
                <Label htmlFor="prod-precioVenta" className="text-xs">
                  Precio final (IVA incluido)
                </Label>
                <Input
                  id="prod-precioVenta"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={values.precioVenta}
                  onChange={(e) => handleChange("precioVenta", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.precioVenta)}
                />
                {errores.precioVenta ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.precioVenta}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prod-alicuotaIva" className="text-xs">Alícuota IVA</Label>
                <Select
                  value={String(values.alicuotaIva)}
                  onValueChange={(val) => handleChange("alicuotaIva", Number(val))}
                  disabled={submitting}
                >
                  <SelectTrigger id="prod-alicuotaIva" aria-label="Alícuota IVA">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALICUOTAS_IVA.map((a) => (
                      <SelectItem key={a} value={String(a)}>
                        {a}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errores.alicuotaIva ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.alicuotaIva}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="prod-costoReposicion" className="text-xs">Costo de reposición</Label>
                <Input
                  id="prod-costoReposicion"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={values.costoReposicion}
                  onChange={(e) => handleChange("costoReposicion", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.costoReposicion)}
                />
                {errores.costoReposicion ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.costoReposicion}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prod-margenObjetivo" className="text-xs">Margen objetivo (%)</Label>
                <Input
                  id="prod-margenObjetivo"
                  type="number"
                  step="any"
                  min="0"
                  max="999.99"
                  placeholder="Ej. 35"
                  value={values.margenObjetivo}
                  onChange={(e) => handleChange("margenObjetivo", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.margenObjetivo)}
                />
                {errores.margenObjetivo ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.margenObjetivo}
                  </p>
                ) : null}
              </div>
            </div>

            {/*
              No es una barrera de seguridad — costoReposicion y margenObjetivo viajan
              en el payload de GET /productos bajo view_stock, que la recepcionista tiene.
              Ver PLAN_FRONTEND_COMERCIAL.md §2.4.
            */}
            {tieneViewSales && margenCalculado !== null ? (
              <div className="rounded border bg-white p-2 text-xs flex justify-between items-center text-muted-foreground">
                <span>Margen real calculado:</span>
                <span className="font-semibold text-foreground">{margenCalculado}</span>
              </div>
            ) : null}
          </div>

          {/* 4. Control de Stock */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Control de stock</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-controlaLote"
                  checked={values.controlaLote}
                  onCheckedChange={(v) => handleChange("controlaLote", v)}
                  disabled={submitting}
                />
                <Label htmlFor="prod-controlaLote" className="text-xs cursor-pointer">
                  Controla lote
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-controlaVencimiento"
                  checked={values.controlaVencimiento}
                  onCheckedChange={(v) => {
                    handleChange("controlaVencimiento", v);
                    if (!v) handleChange("vidaUtilPostAperturaDias", "");
                  }}
                  disabled={submitting}
                />
                <Label htmlFor="prod-controlaVencimiento" className="text-xs cursor-pointer">
                  Controla vencimiento
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="prod-vidaUtilPostAperturaDias"
                  className={values.controlaVencimiento ? "text-xs" : "text-xs text-muted-foreground"}
                  title={values.controlaVencimiento ? undefined : "Requiere control de vencimiento activo"}
                >
                  Vida útil post-apertura (días)
                </Label>
                <Input
                  id="prod-vidaUtilPostAperturaDias"
                  type="number"
                  step="1"
                  min="1"
                  max="3650"
                  placeholder="Ej. 30"
                  value={values.vidaUtilPostAperturaDias}
                  onChange={(e) => handleChange("vidaUtilPostAperturaDias", e.target.value)}
                  disabled={submitting || !values.controlaVencimiento}
                  title={values.controlaVencimiento ? undefined : "Requiere control de vencimiento activo"}
                  aria-invalid={Boolean(errores.vidaUtilPostAperturaDias)}
                />
                {errores.vidaUtilPostAperturaDias ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.vidaUtilPostAperturaDias}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="prod-stockMinimo" className="text-xs">Stock mínimo</Label>
                <Input
                  id="prod-stockMinimo"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Ej. 5"
                  value={values.stockMinimo}
                  onChange={(e) => handleChange("stockMinimo", e.target.value)}
                  disabled={submitting}
                  aria-invalid={Boolean(errores.stockMinimo)}
                />
                {errores.stockMinimo ? (
                  <p role="alert" className="text-xs text-destructive">
                    {errores.stockMinimo}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-requiereFrio"
                  checked={values.requiereFrio}
                  onCheckedChange={(v) => handleChange("requiereFrio", v)}
                  disabled={submitting}
                />
                <Label htmlFor="prod-requiereFrio" className="text-xs cursor-pointer">
                  Requiere refrigeración / frío
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-trazable"
                  checked={values.trazable}
                  onCheckedChange={(v) => handleChange("trazable", v)}
                  disabled={submitting}
                />
                <Label htmlFor="prod-trazable" className="text-xs cursor-pointer">
                  Trazable (SENASA)
                </Label>
              </div>
            </div>
          </div>

          {/* 5. Uso */}
          <div className="space-y-3 rounded-md border p-3.5 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Uso del producto</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-esVendible"
                  checked={values.esVendible}
                  onCheckedChange={(v) => handleChange("esVendible", v)}
                  disabled={submitting}
                />
                <Label htmlFor="prod-esVendible" className="text-xs cursor-pointer">
                  Es vendible en mostrador
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="prod-esConsumibleClinico"
                  checked={values.esConsumibleClinico}
                  onCheckedChange={(v) => handleChange("esConsumibleClinico", v)}
                  disabled={submitting}
                />
                <Label htmlFor="prod-esConsumibleClinico" className="text-xs cursor-pointer">
                  Consumible clínico
                </Label>
              </div>
            </div>
          </div>

          <SheetFooter className="gap-2">
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
              {submitting ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear producto"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Componente: Diálogo de Baja Lógica (AlertDialog) ─────────────────────────

function DesactivarProductoDialog({
  open,
  onOpenChange,
  producto,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  producto?: Producto | null;
  onSuccess: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function confirmar() {
    if (!producto) return;
    setLoading(true);
    setError(null);
    try {
      await cambiarEstadoProducto(producto.id, false);
      toast.success(`«${producto.nombre}» dado de baja`);
      onSuccess();
      handleOpenChange(false);
    } catch (err) {
      // RN §2.1: el error del backend se muestra DENTRO del diálogo, sin cerrarlo
      setError(err instanceof ApiError ? err.message : "No se pudo dar de baja el producto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dar de baja producto</AlertDialogTitle>
          <AlertDialogDescription>
            {producto
              ? `«${producto.nombre}» deja de ofrecerse en ventas nuevas y en el mostrador. Los lotes y las ventas que ya lo usan lo siguen mostrando.`
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
