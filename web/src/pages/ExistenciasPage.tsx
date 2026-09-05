import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Boxes, ChevronLeft, ChevronRight, Layers, Package, Search, X } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.tsx";
import { listarExistencias, valorizacion } from "../api/comercial/stock.ts";
import { LotesPage, formatMoneda } from "./LotesPage.tsx";
import type { ExistenciaFila, ValorizacionStock } from "../types/index.ts";

const PAGE_SIZE_CLIENTE = 20;

export interface ProductoAgregado {
  productoId: string;
  codigo: string;
  nombre: string;
  unidadMedidaNombre: string;
  cantidadTotal: number;
  cantidadLotes: number;
  valorTotal: number | null;
}

/**
 * Agrega las existencias por producto sumando las cantidades de sus distintos lotes.
 *
 * NOTA PLAN_FRONTEND_COMERCIAL.md §4.1 y §4.2:
 * `GET /existencias` devuelve una fila por LOTE (existencias_lote) sin agrupar por producto.
 * Como consecuencia, un producto con 3 lotes retorna 3 veces y `meta.total` cuenta lotes.
 * Esta función es un rodeo en el frontend: agrupa en memoria por `productoId` y el
 * paginador opera sobre los productos únicos agregados, sin exponer el `meta.total` de la API.
 */
export function agregarExistenciasPorProducto(
  filas: ExistenciaFila[],
  mapaValorizacion: Map<string, number>,
): ProductoAgregado[] {
  const mapa = new Map<string, ProductoAgregado>();

  for (const fila of filas) {
    const prod = fila.producto;
    const prodId = fila.productoId;
    const existente = mapa.get(prodId);

    if (existente) {
      existente.cantidadTotal += fila.cantidad;
      existente.cantidadLotes += 1;
    } else {
      mapa.set(prodId, {
        productoId: prodId,
        codigo: prod?.codigo ?? "—",
        nombre: prod?.nombre ?? "Sin nombre",
        unidadMedidaNombre: prod?.unidad_medida?.nombre ?? prod?.unidad_medida?.codigo ?? "U",
        cantidadTotal: fila.cantidad,
        cantidadLotes: 1,
        valorTotal: mapaValorizacion.get(prodId) ?? null,
      });
    }
  }

  return Array.from(mapa.values());
}

export function ExistenciasPage() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filasRaw, setFilasRaw] = useState<ExistenciaFila[]>([]);
  const [datosValorizacion, setDatosValorizacion] = useState<ValorizacionStock | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Lote sheet para ver los lotes de un producto
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoAgregado | null>(null);

  // Debounce búsqueda
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // 1. Cargar valorización global
      const valPromise = valorizacion().catch(() => null);

      // 2. Traer todas las existencias con limit 100
      let todasLasFilas: ExistenciaFila[] = [];
      let paginaActual = 1;
      let totalPaginas = 1;

      do {
        const res = await listarExistencias({
          search: search || undefined,
          page: paginaActual,
          limit: 100,
        });
        todasLasFilas = todasLasFilas.concat(res.items);
        const limit = res.meta?.limit || 100;
        const total = res.meta?.total || 0;
        totalPaginas = Math.ceil(total / limit) || 1;
        paginaActual++;
      } while (paginaActual <= totalPaginas && todasLasFilas.length < 2000); // Límite seguro

      const valRes = await valPromise;
      if (valRes) {
        setDatosValorizacion(valRes);
      }
      setFilasRaw(todasLasFilas);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar existencias");
    } finally {
      setCargando(false);
    }
  }, [search]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Mapa de valorización por productoId
  const mapaVal = useMemo(() => {
    const map = new Map<string, number>();
    if (datosValorizacion?.productos) {
      for (const p of datosValorizacion.productos) {
        if (p.producto?.id) {
          map.set(p.producto.id, p.valorTotal);
        }
      }
    }
    return map;
  }, [datosValorizacion]);

  // Agregación cliente (§4.1 y §4.2)
  const productosAgregados = useMemo(() => {
    return agregarExistenciasPorProducto(filasRaw, mapaVal);
  }, [filasRaw, mapaVal]);

  // Paginación cliente sobre la lista agregada
  const totalProductos = productosAgregados.length;
  const totalPaginasCliente = Math.max(1, Math.ceil(totalProductos / PAGE_SIZE_CLIENTE));
  const productosPaginados = useMemo(() => {
    const inicio = (page - 1) * PAGE_SIZE_CLIENTE;
    return productosAgregados.slice(inicio, inicio + PAGE_SIZE_CLIENTE);
  }, [productosAgregados, page]);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <Boxes className="h-6 w-6 text-orange-600" />
            Existencias de Stock
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inventario consolidado por producto con desglose de lotes y valorización de existencias.
          </p>
        </div>
      </div>

      {/* Tarjeta de Valorización Global */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-orange-50/60 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-orange-800 uppercase tracking-wider">
              Valorización Total del Inventario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {formatMoneda(datosValorizacion?.totalValorizado ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Valuado al costo efectivo de cada lote
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Productos con Existencia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {cargando ? <Skeleton className="h-8 w-16" /> : totalProductos}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Productos activos en inventario
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Lotes Totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {cargando ? <Skeleton className="h-8 w-16" /> : filasRaw.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lotes con existencia positiva
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtro de búsqueda */}
      <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código o nombre de producto..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 pr-8 h-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <TableScrollContainer aria-label="Tabla de existencias de stock">
          <Table>
            <TableHeader className="bg-orange-50/80">
              <TableRow>
                <TableHead className="font-semibold text-slate-700">Producto</TableHead>
                <TableHead className="font-semibold text-slate-700">Unidad</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Cantidad total</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Lotes</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Valorización</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} data-testid="existencias-loading">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : productosPaginados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No hay existencias registradas.
                  </TableCell>
                </TableRow>
              ) : (
                productosPaginados.map((item) => (
                  <TableRow key={item.productoId} className="hover:bg-slate-50/80">
                    <TableCell>
                      <div>
                        <p className="font-medium text-slate-900">{item.nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono">{item.codigo}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {item.unidadMedidaNombre}
                    </TableCell>
                    <TableCell className="text-right font-bold text-slate-900">
                      {item.cantidadTotal}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className="font-normal text-xs bg-slate-100 text-slate-700 hover:bg-slate-100"
                      >
                        {item.cantidadLotes} {item.cantidadLotes === 1 ? "lote" : "lotes"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-slate-800">
                      {formatMoneda(item.valorTotal)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-xs border-orange-200 text-orange-800 hover:bg-orange-50 hover:text-orange-900"
                        onClick={() => setProductoSeleccionado(item)}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Ver lotes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollContainer>

        {/* Paginación cliente sobre totalProductos (§4.2) */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-muted-foreground">
            Mostrando {totalProductos === 0 ? 0 : (page - 1) * PAGE_SIZE_CLIENTE + 1} a{" "}
            {Math.min(page * PAGE_SIZE_CLIENTE, totalProductos)} de{" "}
            <span className="font-semibold text-slate-900">{totalProductos} productos</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || cargando}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground px-1">
              Pág. {page} de {totalPaginasCliente}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPaginasCliente || cargando}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 gap-1 text-xs"
            >
              Siguiente
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sheet de Lotes del Producto Seleccionado */}
      <Sheet
        open={productoSeleccionado !== null}
        onOpenChange={(open) => {
          if (!open) setProductoSeleccionado(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-2xl w-full p-6 overflow-y-auto">
          {productoSeleccionado && (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-xl text-orange-950">
                  <Package className="h-5 w-5 text-orange-600" />
                  Lotes de {productoSeleccionado.nombre}
                </SheetTitle>
                <SheetDescription>
                  Código: <span className="font-mono">{productoSeleccionado.codigo}</span> ·{" "}
                  Existencia total:{" "}
                  <span className="font-bold text-slate-900">
                    {productoSeleccionado.cantidadTotal} {productoSeleccionado.unidadMedidaNombre}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="pt-2">
                <LotesPage
                  productoId={productoSeleccionado.productoId}
                  conExistenciaInicial="true"
                  embedded
                />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
export default ExistenciasPage;
