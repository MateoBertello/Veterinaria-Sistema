import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Package,
  RefreshCw,
  Save,
  Search,
  Tag,
  Wrench,
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Switch } from "../components/ui/switch.tsx";
import { Label } from "../components/ui/label.tsx";
import { Progress } from "../components/ui/progress.tsx";
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
import { cn } from "../components/ui/utils.ts";
import {
  actualizarProducto,
  listarFamilias,
  listarProductos,
} from "../api/comercial/productos.ts";
import { listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import { editarServicio, listarServicios } from "../api/servicios.ts";
import {
  ALICUOTAS_IVA,
  ApiError,
  type Familia,
  type Producto,
  type Servicio,
  type TipoServicio,
  type UnidadMedida,
} from "../types/index.ts";

interface FilaEdicion {
  precioStr: string;
  alicuotaIva: number;
  dirty: boolean;
  error?: string | null;
  exitoTemporal?: boolean;
}

interface ResumenGuardado {
  guardados: number;
  errores: number;
  total: number;
}

const TIPO_SERVICIO_LABEL: Record<TipoServicio, string> = {
  clinica: "Clínica",
  peluqueria: "Peluquería",
  guarderia: "Guardería",
  cirugia: "Cirugía",
  otro: "Otro",
};

function validarPrecio(val: string): { valido: boolean; error?: string } {
  const trimmed = val.trim();
  if (trimmed === "") return { valido: true };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      valido: false,
      error: "Debe ser un número mayor o igual a 0 (hasta 2 decimales)",
    };
  }
  const num = parseFloat(trimmed);
  if (isNaN(num) || num < 0) {
    return { valido: false, error: "Debe ser mayor o igual a 0" };
  }
  return { valido: true };
}

export function CargaPreciosPage() {
  const [tab, setTab] = useState<"productos" | "servicios">("productos");
  const [tabDestino, setTabDestino] = useState<"productos" | "servicios" | null>(null);

  // Catálogos auxiliares (cacheados en Map)
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);
  const [familiasMap, setFamiliasMap] = useState<Map<string, string>>(new Map());
  const [unidadesMap, setUnidadesMap] = useState<Map<string, string>>(new Map());

  // Datos de productos
  const [productos, setProductos] = useState<Producto[]>([]);
  const [prodCargando, setProdCargando] = useState(true);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodSearchInput, setProdSearchInput] = useState("");
  const [prodSearch, setProdSearch] = useState("");
  const [prodFamiliaId, setProdFamiliaId] = useState<string>("");
  const [prodSoloSinPrecio, setProdSoloSinPrecio] = useState(false);
  const [edicionesProductos, setEdicionesProductos] = useState<Record<string, FilaEdicion>>({});

  // Datos de servicios
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [servCargando, setServCargando] = useState(true);
  const [servError, setServError] = useState<string | null>(null);
  const [servSearchInput, setServSearchInput] = useState("");
  const [servSearch, setServSearch] = useState("");
  const [servSoloSinPrecio, setServSoloSinPrecio] = useState(false);
  const [edicionesServicios, setEdicionesServicios] = useState<Record<string, FilaEdicion>>({});

  // Estado de guardado secuencial
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [resumen, setResumen] = useState<ResumenGuardado | null>(null);

  // Debounce búsqueda productos (300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setProdSearch(prodSearchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [prodSearchInput]);

  // Debounce búsqueda servicios (300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setServSearch(servSearchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [servSearchInput]);

  // Cargar catálogos de soporte una sola vez
  useEffect(() => {
    let cancel = false;
    async function cargarCatalogos() {
      try {
        const [famRes, uniRes] = await Promise.all([
          listarFamilias({ limit: 100 }),
          listarUnidadesMedida(),
        ]);
        if (cancel) return;
        setFamilias(famRes.items);
        setUnidades(uniRes);

        const fMap = new Map<string, string>();
        famRes.items.forEach((f) => fMap.set(f.id, f.nombre));
        setFamiliasMap(fMap);

        const uMap = new Map<string, string>();
        uniRes.forEach((u) => uMap.set(u.id, u.abreviatura || u.nombre));
        setUnidadesMap(uMap);
      } catch (e) {
        console.error("Error al cargar catálogos auxiliares:", e);
      }
    }
    void cargarCatalogos();
    return () => {
      cancel = true;
    };
  }, []);

  // Cargar productos
  const cargarProductos = useCallback(async () => {
    setProdCargando(true);
    setProdError(null);
    try {
      const res = await listarProductos({
        search: prodSearch || undefined,
        familiaId: prodFamiliaId && prodFamiliaId !== "__all__" ? prodFamiliaId : undefined,
        limit: 100,
      });
      setProductos(res.items);
    } catch (err) {
      setProdError(
        err instanceof ApiError ? err.message : "Error al cargar el catálogo de productos",
      );
    } finally {
      setProdCargando(false);
    }
  }, [prodSearch, prodFamiliaId]);

  useEffect(() => {
    void cargarProductos();
  }, [cargarProductos]);

  // Cargar servicios
  const cargarServicios = useCallback(async () => {
    setServCargando(true);
    setServError(null);
    try {
      const res = await listarServicios({
        search: servSearch || undefined,
        limit: 100,
      });
      setServicios(res.items);
    } catch (err) {
      setServError(
        err instanceof ApiError ? err.message : "Error al cargar la lista de servicios",
      );
    } finally {
      setServCargando(false);
    }
  }, [servSearch]);

  useEffect(() => {
    void cargarServicios();
  }, [cargarServicios]);

  // Conteo de filas sucias
  const suciasProd = useMemo(
    () => Object.entries(edicionesProductos).filter(([_, e]) => e.dirty),
    [edicionesProductos],
  );
  const suciasServ = useMemo(
    () => Object.entries(edicionesServicios).filter(([_, e]) => e.dirty),
    [edicionesServicios],
  );

  const cantidadSuciasActual = tab === "productos" ? suciasProd.length : suciasServ.length;
  const hayFilasSuciasTotal = suciasProd.length > 0 || suciasServ.length > 0;

  // Advertencia beforeunload ante cambios sin guardar
  useEffect(() => {
    if (!hayFilasSuciasTotal) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hayFilasSuciasTotal]);

  // Intento de cambio de pestaña con confirmación
  const handleTabChangeIntent = (nuevoTab: string) => {
    const target = nuevoTab as "productos" | "servicios";
    if (target === tab) return;
    if (cantidadSuciasActual > 0) {
      setTabDestino(target);
    } else {
      setTab(target);
      setResumen(null);
    }
  };

  const confirmarCambioTab = () => {
    if (tabDestino) {
      if (tab === "productos") {
        setEdicionesProductos({});
      } else {
        setEdicionesServicios({});
      }
      setTab(tabDestino);
      setTabDestino(null);
      setResumen(null);
    }
  };

  // Manejo de edición de producto
  const handleProductoPrecioChange = (p: Producto, value: string) => {
    const origPrecio = p.precioVenta != null ? String(p.precioVenta) : "";
    const origAlicuota = p.alicuotaIva ?? 21;
    const ed = edicionesProductos[p.id];
    const currentAlicuota = ed ? ed.alicuotaIva : origAlicuota;

    const dirty = value !== origPrecio || currentAlicuota !== origAlicuota;
    const val = validarPrecio(value);

    setEdicionesProductos((prev) => ({
      ...prev,
      [p.id]: {
        precioStr: value,
        alicuotaIva: currentAlicuota,
        dirty,
        error: val.valido ? null : val.error,
        exitoTemporal: false,
      },
    }));
  };

  const handleProductoAlicuotaChange = (p: Producto, alicuotaStr: string) => {
    const newAlicuota = parseFloat(alicuotaStr);
    const origPrecio = p.precioVenta != null ? String(p.precioVenta) : "";
    const origAlicuota = p.alicuotaIva ?? 21;
    const ed = edicionesProductos[p.id];
    const currentPrecio = ed ? ed.precioStr : origPrecio;

    const dirty = currentPrecio !== origPrecio || newAlicuota !== origAlicuota;

    setEdicionesProductos((prev) => ({
      ...prev,
      [p.id]: {
        precioStr: currentPrecio,
        alicuotaIva: newAlicuota,
        dirty,
        error: ed?.error ?? null,
        exitoTemporal: false,
      },
    }));
  };

  // Manejo de edición de servicio
  const handleServicioPrecioChange = (s: Servicio, value: string) => {
    const origPrecio = s.precio != null ? String(s.precio) : "";
    const origAlicuota = s.alicuotaIva ?? 21;
    const ed = edicionesServicios[s.id];
    const currentAlicuota = ed ? ed.alicuotaIva : origAlicuota;

    const dirty = value !== origPrecio || currentAlicuota !== origAlicuota;
    const val = validarPrecio(value);

    setEdicionesServicios((prev) => ({
      ...prev,
      [s.id]: {
        precioStr: value,
        alicuotaIva: currentAlicuota,
        dirty,
        error: val.valido ? null : val.error,
        exitoTemporal: false,
      },
    }));
  };

  const handleServicioAlicuotaChange = (s: Servicio, alicuotaStr: string) => {
    const newAlicuota = parseFloat(alicuotaStr);
    const origPrecio = s.precio != null ? String(s.precio) : "";
    const origAlicuota = s.alicuotaIva ?? 21;
    const ed = edicionesServicios[s.id];
    const currentPrecio = ed ? ed.precioStr : origPrecio;

    const dirty = currentPrecio !== origPrecio || newAlicuota !== origAlicuota;

    setEdicionesServicios((prev) => ({
      ...prev,
      [s.id]: {
        precioStr: currentPrecio,
        alicuotaIva: newAlicuota,
        dirty,
        error: ed?.error ?? null,
        exitoTemporal: false,
      },
    }));
  };

  // Guardado secuencial
  const guardarCambios = async () => {
    const esProductos = tab === "productos";
    const sucias = esProductos ? suciasProd : suciasServ;
    if (sucias.length === 0 || guardando) return;

    setGuardando(true);
    setResumen(null);
    setProgreso({ actual: 0, total: sucias.length });

    let guardados = 0;
    let errores = 0;

    for (let i = 0; i < sucias.length; i++) {
      const [id, ed] = sucias[i];
      setProgreso({ actual: i + 1, total: sucias.length });

      // Validación previa
      const val = validarPrecio(ed.precioStr);
      if (!val.valido) {
        errores++;
        if (esProductos) {
          setEdicionesProductos((prev) => ({
            ...prev,
            [id]: { ...prev[id], error: val.error, dirty: true },
          }));
        } else {
          setEdicionesServicios((prev) => ({
            ...prev,
            [id]: { ...prev[id], error: val.error, dirty: true },
          }));
        }
        continue;
      }

      const precioNum =
        ed.precioStr.trim() === "" ? null : parseFloat(ed.precioStr);

      try {
        if (esProductos) {
          await actualizarProducto(id, {
            precioVenta: precioNum,
            alicuotaIva: ed.alicuotaIva,
          });
          // Actualizar producto base en memoria
          setProductos((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, precioVenta: precioNum, alicuotaIva: ed.alicuotaIva }
                : item,
            ),
          );
          setEdicionesProductos((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              dirty: false,
              error: null,
              exitoTemporal: true,
            },
          }));
        } else {
          await editarServicio(id, {
            precio: precioNum,
            alicuotaIva: ed.alicuotaIva,
          });
          // Actualizar servicio base en memoria
          setServicios((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, precio: precioNum, alicuotaIva: ed.alicuotaIva }
                : item,
            ),
          );
          setEdicionesServicios((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              dirty: false,
              error: null,
              exitoTemporal: true,
            },
          }));
        }
        guardados++;
      } catch (err: unknown) {
        errores++;
        const msg =
          err instanceof ApiError ? err.message : "Error al guardar el precio";
        if (esProductos) {
          setEdicionesProductos((prev) => ({
            ...prev,
            [id]: { ...prev[id], dirty: true, error: msg },
          }));
        } else {
          setEdicionesServicios((prev) => ({
            ...prev,
            [id]: { ...prev[id], dirty: true, error: msg },
          }));
        }
      }
    }

    setGuardando(false);
    setResumen({
      guardados,
      errores,
      total: sucias.length,
    });
  };

  // Filtrado de productos visibles
  const productosVisibles = useMemo(() => {
    return productos.filter((p) => {
      if (prodSoloSinPrecio) {
        return p.precioVenta === null;
      }
      return true;
    });
  }, [productos, prodSoloSinPrecio]);

  // Filtrado de servicios visibles
  const serviciosVisibles = useMemo(() => {
    return servicios.filter((s) => {
      if (servSoloSinPrecio) {
        return s.precio === null;
      }
      return true;
    });
  }, [servicios, servSoloSinPrecio]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <StockBreadcrumb
        items={[
          { label: "Productos", href: "/stock/productos" },
          { label: "Precios" },
        ]}
      />
      {/* Header */}
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-orange-800">
          <Tag className="size-6" aria-hidden />
          Carga Asistida de Precios
        </h1>
        <p className="text-sm text-muted-foreground">
          Actualización ágil de precios de venta para productos y servicios. Los
          valores cargados corresponden al <strong>precio final con IVA incluido</strong>{" "}
          (precio de góndola).
        </p>
      </header>

      {/* Pestañas */}
      <Tabs value={tab} onValueChange={handleTabChangeIntent}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <TabsList>
            <TabsTrigger value="productos" className="gap-2">
              <Package className="size-4" aria-hidden />
              Productos
              {suciasProd.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 bg-orange-100 text-orange-800 text-xs px-1.5 py-0"
                >
                  {suciasProd.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="servicios" className="gap-2">
              <Wrench className="size-4" aria-hidden />
              Servicios
              {suciasServ.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 bg-orange-100 text-orange-800 text-xs px-1.5 py-0"
                >
                  {suciasServ.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Resumen de Guardado */}
        {resumen && (
          <div
            role="alert"
            className={cn(
              "mt-4 p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm",
              resumen.errores > 0
                ? "bg-amber-50/80 border-amber-200 text-amber-900"
                : "bg-green-50/80 border-green-200 text-green-900",
            )}
          >
            <div className="flex items-center gap-2">
              {resumen.errores > 0 ? (
                <AlertTriangle className="size-5 shrink-0 text-amber-600" />
              ) : (
                <Check className="size-5 shrink-0 text-green-600" />
              )}
              <span>
                Se guardaron {resumen.guardados} de {resumen.total}.{" "}
                {resumen.errores > 0
                  ? `${resumen.errores} ${
                      resumen.errores === 1
                        ? "fila quedó con error."
                        : "filas quedaron con error."
                    }`
                  : "Todos los cambios se aplicaron exitosamente."}
              </span>
            </div>
            {resumen.errores > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="self-start sm:self-auto border-amber-300 hover:bg-amber-100 text-amber-900"
                onClick={guardarCambios}
                disabled={guardando}
              >
                Reintentar las que fallaron
              </Button>
            )}
          </div>
        )}

        {/* ─── Pestaña Productos ───────────────────────────────────────────── */}
        <TabsContent value="productos" className="space-y-4 mt-4">
          {/* Barra de filtros */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Buscar por código o nombre"
                aria-label="Buscar productos"
                className="pl-9"
                value={prodSearchInput}
                onChange={(e) => setProdSearchInput(e.target.value)}
              />
            </div>

            <Select
              value={prodFamiliaId}
              onValueChange={(v) => setProdFamiliaId(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-48" aria-label="Filtrar por familia">
                <SelectValue placeholder="Todas las familias" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las familias</SelectItem>
                {familias.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-card">
              <Switch
                id="prod-sin-precio"
                checked={prodSoloSinPrecio}
                onCheckedChange={setProdSoloSinPrecio}
              />
              <Label
                htmlFor="prod-sin-precio"
                className="text-sm cursor-pointer whitespace-nowrap"
              >
                Solo los que no tienen precio
              </Label>
            </div>
          </div>

          {/* Tabla Productos */}
          <TableScrollContainer aria-label="Precios de productos">
            <Table>
              <TableHeader className="bg-orange-50">
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden md:table-cell">Familia</TableHead>
                  <TableHead className="hidden sm:table-cell w-20">Unidad</TableHead>
                  <TableHead className="w-32">Alícuota IVA</TableHead>
                  <TableHead className="w-44">Precio final (c/IVA)</TableHead>
                  <TableHead className="w-32 text-right">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prodCargando ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : prodError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center">
                      <p className="text-sm text-destructive">{prodError}</p>
                      <Button
                        variant="outline"
                        className="mt-3"
                        onClick={cargarProductos}
                      >
                        Reintentar
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : productosVisibles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No se encontraron productos con los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  productosVisibles.map((p) => {
                    const origPrecioStr =
                      p.precioVenta != null ? String(p.precioVenta) : "";
                    const origAlicuota = p.alicuotaIva ?? 21;
                    const ed = edicionesProductos[p.id];
                    const currentPrecioStr = ed ? ed.precioStr : origPrecioStr;
                    const currentAlicuota = ed ? ed.alicuotaIva : origAlicuota;
                    const isDirty = Boolean(ed?.dirty);
                    const isSinPrecio = p.precioVenta == null && !isDirty;
                    const rowError = ed?.error;
                    const isExitoTemporal = Boolean(ed?.exitoTemporal);

                    return (
                      <TableRow
                        key={p.id}
                        className={cn(
                          "transition-colors",
                          isDirty && "border-l-4 border-l-orange-500 bg-orange-50/40",
                        )}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.codigo}
                        </TableCell>
                        <TableCell className="font-medium">
                          {p.nombre}
                          {rowError && (
                            <p className="text-xs text-destructive mt-1">
                              {rowError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {p.familiaId ? familiasMap.get(p.familiaId) ?? "—" : "—"}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {unidadesMap.get(p.unidadMedidaId) ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={String(currentAlicuota)}
                            onValueChange={(val) =>
                              handleProductoAlicuotaChange(p, val)
                            }
                            disabled={guardando}
                          >
                            <SelectTrigger
                              aria-label={`Alícuota IVA de ${p.nombre}`}
                              className="h-8 w-24 text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALICUOTAS_IVA.map((ali) => (
                                <SelectItem key={ali} value={String(ali)}>
                                  {ali}%
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              $
                            </span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Precio final con IVA de ${p.nombre}`}
                              placeholder="0.00"
                              value={currentPrecioStr}
                              onChange={(e) =>
                                handleProductoPrecioChange(p, e.target.value)
                              }
                              disabled={guardando}
                              className={cn(
                                "h-8 pl-6 text-sm font-mono",
                                rowError &&
                                  "border-destructive focus-visible:ring-destructive/30",
                              )}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {isDirty ? (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-300">
                              Sin guardar
                            </Badge>
                          ) : isSinPrecio ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-700 bg-amber-50"
                            >
                              Sin precio
                            </Badge>
                          ) : isExitoTemporal ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                              <Check className="size-3.5" /> Guardado
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Al día
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableScrollContainer>
        </TabsContent>

        {/* ─── Pestaña Servicios ────────────────────────────────────────────── */}
        <TabsContent value="servicios" className="space-y-4 mt-4">
          {/* Barra de filtros */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Buscar por nombre de servicio"
                aria-label="Buscar servicios"
                className="pl-9"
                value={servSearchInput}
                onChange={(e) => setServSearchInput(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-card">
              <Switch
                id="serv-sin-precio"
                checked={servSoloSinPrecio}
                onCheckedChange={setServSoloSinPrecio}
              />
              <Label
                htmlFor="serv-sin-precio"
                className="text-sm cursor-pointer whitespace-nowrap"
              >
                Solo los que no tienen precio
              </Label>
            </div>
          </div>

          {/* Tabla Servicios */}
          <TableScrollContainer aria-label="Precios de servicios">
            <Table>
              <TableHeader className="bg-orange-50">
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-36">Tipo</TableHead>
                  <TableHead className="w-32">Alícuota IVA</TableHead>
                  <TableHead className="w-44">Precio final (c/IVA)</TableHead>
                  <TableHead className="w-32 text-right">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servCargando ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : servError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center">
                      <p className="text-sm text-destructive">{servError}</p>
                      <Button
                        variant="outline"
                        className="mt-3"
                        onClick={cargarServicios}
                      >
                        Reintentar
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : serviciosVisibles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No se encontraron servicios con los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  serviciosVisibles.map((s) => {
                    const origPrecioStr =
                      s.precio != null ? String(s.precio) : "";
                    const origAlicuota = s.alicuotaIva ?? 21;
                    const ed = edicionesServicios[s.id];
                    const currentPrecioStr = ed ? ed.precioStr : origPrecioStr;
                    const currentAlicuota = ed ? ed.alicuotaIva : origAlicuota;
                    const isDirty = Boolean(ed?.dirty);
                    const isSinPrecio = s.precio == null && !isDirty;
                    const rowError = ed?.error;
                    const isExitoTemporal = Boolean(ed?.exitoTemporal);

                    return (
                      <TableRow
                        key={s.id}
                        className={cn(
                          "transition-colors",
                          isDirty && "border-l-4 border-l-orange-500 bg-orange-50/40",
                        )}
                      >
                        <TableCell className="font-medium">
                          {s.nombre}
                          {rowError && (
                            <p className="text-xs text-destructive mt-1">
                              {rowError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal text-xs">
                            {TIPO_SERVICIO_LABEL[s.tipo] ?? s.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={String(currentAlicuota)}
                            onValueChange={(val) =>
                              handleServicioAlicuotaChange(s, val)
                            }
                            disabled={guardando}
                          >
                            <SelectTrigger
                              aria-label={`Alícuota IVA de ${s.nombre}`}
                              className="h-8 w-24 text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALICUOTAS_IVA.map((ali) => (
                                <SelectItem key={ali} value={String(ali)}>
                                  {ali}%
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              $
                            </span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Precio final con IVA de ${s.nombre}`}
                              placeholder="0.00"
                              value={currentPrecioStr}
                              onChange={(e) =>
                                handleServicioPrecioChange(s, e.target.value)
                              }
                              disabled={guardando}
                              className={cn(
                                "h-8 pl-6 text-sm font-mono",
                                rowError &&
                                  "border-destructive focus-visible:ring-destructive/30",
                              )}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {isDirty ? (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-300">
                              Sin guardar
                            </Badge>
                          ) : isSinPrecio ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-700 bg-amber-50"
                            >
                              Sin precio
                            </Badge>
                          ) : isExitoTemporal ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                              <Check className="size-3.5" /> Guardado
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Al día
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableScrollContainer>
        </TabsContent>
      </Tabs>

      {/* Barra inferior fija de guardado */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-6 py-4 shadow-lg md:left-60">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {cantidadSuciasActual === 0 ? (
                <span className="text-muted-foreground">Sin cambios pendientes</span>
              ) : (
                <span className="text-orange-800 font-semibold">
                  {cantidadSuciasActual}{" "}
                  {cantidadSuciasActual === 1
                    ? "cambio pendiente de guardar"
                    : "cambios pendientes de guardar"}
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
            {guardando && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" />
                <span>
                  Guardando {progreso.actual} de {progreso.total}...
                </span>
                <Progress
                  value={(progreso.actual / Math.max(1, progreso.total)) * 100}
                  className="w-28 h-2"
                />
              </div>
            )}
            <Button
              onClick={guardarCambios}
              disabled={guardando || cantidadSuciasActual === 0}
              className="gap-2 bg-orange-600 hover:bg-orange-700 text-white w-full sm:w-auto"
            >
              <Save className="size-4" />
              {guardando
                ? `Guardando (${progreso.actual}/${progreso.total})...`
                : `Guardar cambios (${cantidadSuciasActual})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Diálogo de confirmación para descarte de cambios al cambiar de pestaña */}
      <AlertDialog
        open={Boolean(tabDestino)}
        onOpenChange={(open) => !open && setTabDestino(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-600" />
              ¿Descartar cambios sin guardar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Hay {cantidadSuciasActual}{" "}
              {cantidadSuciasActual === 1
                ? "cambio sin guardar en esta pestaña"
                : "cambios sin guardar en esta pestaña"}
              . Si cambiás de pestaña ahora, perderás estas modificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Permanecer aquí</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarCambioTab}
              className="bg-destructive hover:bg-destructive/90"
            >
              Descartar y cambiar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
