import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Filter,
  Plus,
  ShoppingBag,
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
import { Badge } from "../components/ui/badge.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Switch } from "../components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { formatFechaISO, hoyISO } from "../lib/fechas.ts";
import { compraNuevaEsquema, validarFormulario } from "../lib/validaciones/index.ts";
import { crearCompra, listarCompras } from "../api/comercial/compras.ts";
import { listarProveedores } from "../api/comercial/proveedores.ts";
import { formatMoneda } from "./LotesPage.tsx";
import type { ApiMeta, Compra, EstadoCompra, Proveedor } from "../types/index.ts";

const PAGE_SIZE = 20;

export function EstadoCompraBadge({ estado }: { estado: EstadoCompra | string }) {
  switch (estado) {
    case "borrador":
      return (
        <Badge
          variant="outline"
          className="bg-slate-100 text-slate-700 border-slate-300 font-medium"
        >
          Borrador
        </Badge>
      );
    case "confirmada":
      return (
        <Badge
          variant="outline"
          className="bg-emerald-50 text-emerald-700 border-emerald-300 font-medium"
        >
          Confirmada
        </Badge>
      );
    case "anulada":
      return (
        <Badge
          variant="outline"
          className="bg-rose-50 text-rose-700 border-rose-300 font-medium"
        >
          Anulada
        </Badge>
      );
    default:
      return <Badge variant="outline">{estado}</Badge>;
  }
}

export function ComprasPage() {
  const navigate = useNavigate();

  const [compras, setCompras] = useState<Compra[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [proveedorFiltro, setProveedorFiltro] = useState<string>("todos");
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoCompra | "todos">("todos");
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [page, setPage] = useState(1);

  // Proveedores para select
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  // Diálogo nueva compra
  const [modalNueva, setModalNueva] = useState(false);
  const [nuevoProveedorId, setNuevoProveedorId] = useState<string>("");
  const [nuevaFecha, setNuevaFecha] = useState<string>(hoyISO());
  const [nuevoTipoComp, setNuevoTipoComp] = useState<string>("Factura A");
  const [nuevoNroComp, setNuevoNroComp] = useState<string>("");
  const [nuevoGeneraEgreso, setNuevoGeneraEgreso] = useState<boolean>(false);
  const [nuevaObservacion, setNuevaObservacion] = useState<string>("");
  const [creandoCompra, setCreandoCompra] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [erroresModal, setErroresModal] = useState<Record<string, string>>({});

  // Cargar proveedores
  useEffect(() => {
    void listarProveedores({ activo: true, limit: 100 })
      .then((res) => setProveedores(res.items))
      .catch(() => {});
  }, []);

  // Cargar compras
  const cargarCompras = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await listarCompras({
        proveedorId: proveedorFiltro === "todos" ? undefined : proveedorFiltro,
        estado: estadoFiltro === "todos" ? undefined : estadoFiltro,
        desde: desde || undefined,
        hasta: hasta || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setCompras(res.items);
      setMeta(res.meta);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar compras");
    } finally {
      setCargando(false);
    }
  }, [proveedorFiltro, estadoFiltro, desde, hasta, page]);

  useEffect(() => {
    void cargarCompras();
  }, [cargarCompras]);

  const handleCrearCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    const validacion = validarFormulario(
      {
        proveedorId: nuevoProveedorId,
        fecha: nuevaFecha,
        comprobanteProveedorTipo: nuevoTipoComp || null,
        comprobanteProveedorNumero: nuevoNroComp || null,
        observaciones: nuevaObservacion || null,
      },
      compraNuevaEsquema,
    );

    if (!validacion.valido) {
      setErroresModal(validacion.errores as Record<string, string>);
      if (validacion.errores.proveedorId) {
        setErrorModal(validacion.errores.proveedorId);
      }
      const primerError = Object.keys(validacion.errores)[0];
      const el = document.getElementById(`compra-${primerError}`);
      el?.focus();
      return;
    }

    setErroresModal({});
    setCreandoCompra(true);
    setErrorModal(null);
    try {
      const nueva = await crearCompra({
        proveedorId: nuevoProveedorId,
        fecha: nuevaFecha,
        comprobanteProveedorTipo: nuevoTipoComp || undefined,
        comprobanteProveedorNumero: nuevoNroComp || undefined,
        generaEgresoCaja: nuevoGeneraEgreso,
        observaciones: nuevaObservacion || undefined,
      });
      setModalNueva(false);
      navigate(`/stock/compras/${nueva.id}`);
    } catch (err: unknown) {
      setErrorModal(err instanceof Error ? err.message : "Error al crear compra");
    } finally {
      setCreandoCompra(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <StockBreadcrumb items={[{ label: "Compras" }]} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-orange-600" />
            Compras
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recepción de mercadería de proveedores, carga de costos netos e ingreso a stock.
          </p>
        </div>

        <Button
          onClick={() => {
            setNuevoProveedorId(proveedores[0]?.id ?? "");
            setNuevaFecha(hoyISO());
            setNuevoTipoComp("Factura A");
            setNuevoNroComp("");
            setNuevoGeneraEgreso(false);
            setNuevaObservacion("");
            setErrorModal(null);
            setModalNueva(true);
          }}
          className="gap-1.5 bg-orange-600 hover:bg-orange-700 text-white self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Nueva compra
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
        <div className="w-56">
          <Select
            value={proveedorFiltro}
            onValueChange={(val) => {
              setProveedorFiltro(val);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por proveedor" className="h-9">
              <SelectValue placeholder="Proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los proveedores</SelectItem>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.razonSocial}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-44">
          <Select
            value={estadoFiltro}
            onValueChange={(val) => {
              setEstadoFiltro(val as EstadoCompra | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por estado" className="h-9">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="borrador">Borrador</SelectItem>
              <SelectItem value="confirmada">Confirmada</SelectItem>
              <SelectItem value="anulada">Anulada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Desde:</span>
          <Input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              setPage(1);
            }}
            className="h-9 w-36 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hasta:</span>
          <Input
            type="date"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              setPage(1);
            }}
            className="h-9 w-36 text-xs"
          />
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
        <TableScrollContainer aria-label="Tabla de compras registradas">
          <Table>
            <TableHeader className="bg-orange-50/80">
              <TableRow>
                <TableHead className="font-semibold text-slate-700">Fecha</TableHead>
                <TableHead className="font-semibold text-slate-700">Proveedor</TableHead>
                <TableHead className="font-semibold text-slate-700">Comprobante Proveedor</TableHead>
                <TableHead className="font-semibold text-slate-700">Estado</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Total Neto</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">IVA</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Total</TableHead>
                <TableHead className="font-semibold text-slate-700 text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} data-testid="compras-loading">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : compras.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    No se encontraron compras registradas.
                  </TableCell>
                </TableRow>
              ) : (
                compras.map((compra) => (
                  <TableRow key={compra.id} className="hover:bg-slate-50/80">
                    <TableCell className="text-sm font-medium text-slate-900">
                      {compra.fecha ? formatFechaISO(compra.fecha) : "—"}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-semibold text-slate-900">
                          {compra.proveedor?.razonSocial ?? "—"}
                        </p>
                        {compra.proveedor?.cuit && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {compra.proveedor.cuit}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-800">
                      {compra.comprobanteProveedorTipo ? (
                        <span>
                          {compra.comprobanteProveedorTipo}{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            {compra.comprobanteProveedorNumero ?? ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <EstadoCompraBadge estado={compra.estado} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">
                      {formatMoneda(compra.totalNeto)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-700">
                      {formatMoneda(compra.totalIva)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-slate-900">
                      {formatMoneda(compra.total)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                        <Link to={`/stock/compras/${compra.id}`}>
                          <Eye className="h-3.5 w-3.5 text-slate-600" />
                          {compra.estado === "borrador" ? "Editar" : "Ver"}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableScrollContainer>

        {meta && meta.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
            <span className="text-xs text-muted-foreground">
              Mostrando {(page - 1) * PAGE_SIZE + 1} a{" "}
              {Math.min(page * PAGE_SIZE, meta.total)} de {meta.total} compras
            </span>
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
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(meta.total / PAGE_SIZE) || cargando}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 gap-1 text-xs"
              >
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Crear Compra (Borrador inicial) */}
      <Dialog open={modalNueva} onOpenChange={setModalNueva}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCrearCompra}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg text-orange-950">
                <FileText className="h-5 w-5 text-orange-600" />
                Nueva Compra (Borrador)
              </DialogTitle>
              <DialogDescription>
                Inicia un borrador de compra para registrar comprobante y cargar los ítems recibidos.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {errorModal && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-md">
                  {errorModal}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="compra-proveedorId">Proveedor *</Label>
                <Select
                  value={nuevoProveedorId}
                  onValueChange={(val) => {
                    setNuevoProveedorId(val);
                    setErroresModal((prev) => {
                      const next = { ...prev };
                      delete next.proveedorId;
                      return next;
                    });
                  }}
                >
                  <SelectTrigger
                    id="compra-proveedorId"
                    aria-invalid={Boolean(erroresModal.proveedorId)}
                    aria-describedby={erroresModal.proveedorId ? "compra-proveedorId-error" : undefined}
                  >
                    <SelectValue placeholder="Seleccione proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {proveedores.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.razonSocial}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {erroresModal.proveedorId && (
                  <p id="compra-proveedorId-error" role="alert" className="text-sm text-destructive">
                    {erroresModal.proveedorId}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="compra-fecha">Fecha *</Label>
                <Input
                  id="compra-fecha"
                  type="date"
                  value={nuevaFecha}
                  onChange={(e) => {
                    setNuevaFecha(e.target.value);
                    setErroresModal((prev) => {
                      const next = { ...prev };
                      delete next.fecha;
                      return next;
                    });
                  }}
                  aria-invalid={Boolean(erroresModal.fecha)}
                  aria-describedby={erroresModal.fecha ? "compra-fecha-error" : undefined}
                />
                {erroresModal.fecha && (
                  <p id="compra-fecha-error" role="alert" className="text-sm text-destructive">
                    {erroresModal.fecha}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="compra-comprobanteProveedorTipo">Tipo Comprobante</Label>
                  <Input
                    id="compra-comprobanteProveedorTipo"
                    placeholder="Factura A, Remito..."
                    value={nuevoTipoComp}
                    onChange={(e) => {
                      setNuevoTipoComp(e.target.value);
                      setErroresModal((prev) => {
                        const next = { ...prev };
                        delete next.comprobanteProveedorTipo;
                        return next;
                      });
                    }}
                    aria-invalid={Boolean(erroresModal.comprobanteProveedorTipo)}
                    aria-describedby={erroresModal.comprobanteProveedorTipo ? "compra-tipo-error" : undefined}
                  />
                  {erroresModal.comprobanteProveedorTipo && (
                    <p id="compra-tipo-error" role="alert" className="text-sm text-destructive">
                      {erroresModal.comprobanteProveedorTipo}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compra-comprobanteProveedorNumero">N° Comprobante</Label>
                  <Input
                    id="compra-comprobanteProveedorNumero"
                    placeholder="0001-00012345"
                    value={nuevoNroComp}
                    onChange={(e) => {
                      setNuevoNroComp(e.target.value);
                      setErroresModal((prev) => {
                        const next = { ...prev };
                        delete next.comprobanteProveedorNumero;
                        return next;
                      });
                    }}
                    aria-invalid={Boolean(erroresModal.comprobanteProveedorNumero)}
                    aria-describedby={erroresModal.comprobanteProveedorNumero ? "compra-nro-error" : undefined}
                  />
                  {erroresModal.comprobanteProveedorNumero && (
                    <p id="compra-nro-error" role="alert" className="text-sm text-destructive">
                      {erroresModal.comprobanteProveedorNumero}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="compra-egreso" className="text-sm font-medium">
                    Genera egreso de caja
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Al confirmar, registra el egreso en la caja abierta.
                  </p>
                </div>
                <Switch
                  id="compra-egreso"
                  checked={nuevoGeneraEgreso}
                  onCheckedChange={setNuevoGeneraEgreso}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="compra-obs">Observaciones</Label>
                <Input
                  id="compra-obs"
                  placeholder="Notas adicionales..."
                  value={nuevaObservacion}
                  onChange={(e) => setNuevaObservacion(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalNueva(false)}
                disabled={creandoCompra}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={creandoCompra}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {creandoCompra ? "Creando..." : "Crear borrador"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default ComprasPage;
