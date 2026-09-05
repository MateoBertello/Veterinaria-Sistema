import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Coins,
  CreditCard,
  Layers,
  Lock,
  Package,
  PawPrint,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  User,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { useAuth } from "../auth/AuthContext.tsx";
import { sesionActual } from "../api/comercial/caja.ts";
import { listarFamilias, listarProductos } from "../api/comercial/productos.ts";
import { candidatosFefo } from "../api/comercial/stock.ts";
import { registrarVenta } from "../api/comercial/ventas.ts";
import { listarMediosPago, listarServiciosVendibles, listarUnidadesMedida } from "../api/catalogos-comercial.ts";
import { listarClientes } from "../api/clientes.ts";
import { listarMascotas } from "../api/mascotas.ts";
import { cn } from "../components/ui/utils.ts";
import type {
  Cliente,
  CondicionPago,
  Familia,
  LoteCandidato,
  Mascota,
  MedioPago,
  Producto,
  RegistrarVentaInput,
  ResultadoVenta,
  ServicioVendible,
  SesionCaja,
  UnidadMedida,
} from "../types/index.ts";

export interface FavoritoItem {
  id: string;
  tipo: "producto" | "servicio";
  nombre: string;
  codigo?: string | null;
  precio: number;
}

export interface CartItem {
  uid: string;
  tipoItem: "producto" | "servicio";
  productoId?: string | null;
  servicioId?: string | null;
  nombre: string;
  codigo?: string | null;
  precioUnitario: number;
  cantidad: number;
  descuentoPorcentaje: number;
  mascotaId?: string | null;
  unidadMedidaId?: string | null;
  admiteDecimales?: boolean;
  escalaDecimal?: number;
  // Campos de FEFO (F4·T2)
  candidatos?: LoteCandidato[];
  loadingLotes?: boolean;
  loteId?: string | null;
  motivoFefo?: string;
  loteSugeridoId?: string | null;
  sinStock?: boolean;
  stockInsuficiente?: boolean;
}

export interface PagoFormItem {
  id: string;
  medioPagoId: string;
  importe: number;
  referencia: string;
}

export function formatMoneda(valor: number): string {
  return "$ " + valor.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function obtenerFavoritos(userId: string): FavoritoItem[] {
  try {
    const raw = localStorage.getItem(`leo:mostrador:favoritos:${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function guardarFavoritos(userId: string, items: FavoritoItem[]): void {
  try {
    localStorage.setItem(`leo:mostrador:favoritos:${userId}`, JSON.stringify(items));
  } catch {
    // Ignorar excepciones de modo incógnito o cuota excedida
  }
}

export function MostradorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id || "anon";
  const tieneManageCash = Boolean(user?.permissions?.includes("manage_cash"));

  // Guardia de caja
  const [cajaLoading, setCajaLoading] = useState(true);
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [errorCaja, setErrorCaja] = useState<string | null>(null);

  // Catálogos auxiliares
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);
  const [mediosPago, setMediosPago] = useState<MedioPago[]>([]);

  // Búsqueda y catálogo de productos
  const [activeTab, setActiveTab] = useState<"productos" | "servicios">("productos");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFamiliaId, setSelectedFamiliaId] = useState<string | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loadingProductos, setLoadingProductos] = useState(false);

  // Catálogo de servicios
  const [servicios, setServicios] = useState<ServicioVendible[]>([]);
  const [loadingServicios, setLoadingServicios] = useState(false);

  // Favoritos
  const [favoritos, setFavoritos] = useState<FavoritoItem[]>(() => obtenerFavoritos(userId));

  // Carrito
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [condicionPago, setCondicionPago] = useState<CondicionPago>("contado");
  const [descuentoGlobal, setDescuentoGlobal] = useState<number>(0);
  const [clienteMascotas, setClienteMascotas] = useState<Mascota[]>([]);

  // Búsqueda de cliente en combobox
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteQuery, setClienteQuery] = useState("");
  const [clientesSugeridos, setClientesSugeridos] = useState<Cliente[]>([]);

  // Modal de cobro (F4·T2)
  const [cobroDialogOpen, setCobroDialogOpen] = useState(false);
  const [pagos, setPagos] = useState<PagoFormItem[]>([]);
  const [observacionesVenta, setObservacionesVenta] = useState("");
  const [submittingVenta, setSubmittingVenta] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);

  // Modal de éxito (F4·T2)
  const [exitoDialogOpen, setExitoDialogOpen] = useState(false);
  const [resultadoVenta, setResultadoVenta] = useState<ResultadoVenta | null>(null);

  // 1. Cargar sesión de caja inicial
  const verificarCaja = useCallback(async () => {
    setCajaLoading(true);
    setErrorCaja(null);
    try {
      const act = await sesionActual();
      setSesion(act);
    } catch (err: any) {
      setErrorCaja(err?.message || "Error al verificar la sesión de caja.");
    } finally {
      setCajaLoading(false);
    }
  }, []);

  useEffect(() => {
    verificarCaja();
  }, [verificarCaja]);

  // 2. Debounce de búsqueda de productos (250 ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // 3. Cargar familias, unidades de medida y medios de pago (una sola vez si hay caja)
  useEffect(() => {
    if (!sesion) return;
    Promise.all([
      listarFamilias({ activo: true, limit: 100 }),
      listarUnidadesMedida(),
      listarMediosPago(),
    ])
      .then(([famRes, uniRes, medRes]) => {
        setFamilias(famRes.items);
        setUnidades(uniRes);
        setMediosPago(medRes);
      })
      .catch(() => {
        // Fallback silencioso
      });
  }, [sesion]);

  // 4. Cargar productos según búsqueda y familia
  useEffect(() => {
    if (!sesion) return;
    let cancel = false;
    setLoadingProductos(true);

    listarProductos({
      search: debouncedSearch.trim() || undefined,
      familiaId: selectedFamiliaId || undefined,
      vendible: true,
      activo: true,
      limit: 50,
    })
      .then((res) => {
        if (!cancel) {
          setProductos(res.items);
        }
      })
      .catch(() => {
        if (!cancel) setProductos([]);
      })
      .finally(() => {
        if (!cancel) setLoadingProductos(false);
      });

    return () => {
      cancel = true;
    };
  }, [sesion, debouncedSearch, selectedFamiliaId]);

  // 5. Cargar servicios vendibles
  useEffect(() => {
    if (!sesion) return;
    let cancel = false;
    setLoadingServicios(true);

    listarServiciosVendibles()
      .then((res) => {
        if (!cancel) setServicios(res);
      })
      .catch(() => {
        if (!cancel) setServicios([]);
      })
      .finally(() => {
        if (!cancel) setLoadingServicios(false);
      });

    return () => {
      cancel = true;
    };
  }, [sesion]);

  // 6. Cargar mascotas del cliente si se selecciona
  useEffect(() => {
    if (!cliente) {
      setClienteMascotas([]);
      return;
    }
    listarMascotas({ clientId: cliente.id, limit: 50 })
      .then((res) => setClienteMascotas(res.items))
      .catch(() => setClienteMascotas([]));
  }, [cliente]);

  // 7. Búsqueda de clientes para combobox
  useEffect(() => {
    if (!clienteOpen) return;
    listarClientes({ search: clienteQuery.trim() || undefined, limit: 10 })
      .then((res) => setClientesSugeridos(res.items))
      .catch(() => setClientesSugeridos([]));
  }, [clienteOpen, clienteQuery]);

  // Función para consultar candidatos FEFO para un producto
  const consultarLotesFefo = useCallback(async (productoId: string, cantidad: number, uid: string) => {
    setCart((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, loadingLotes: true } : it)),
    );
    try {
      const lotes = await candidatosFefo({ productoId, cantidad });
      setCart((prev) =>
        prev.map((it) => {
          if (it.uid !== uid) return it;
          if (lotes.length === 0) {
            return {
              ...it,
              loadingLotes: false,
              candidatos: [],
              sinStock: true,
              loteId: null,
              loteSugeridoId: null,
              motivoFefo: "",
            };
          }
          const primerLote = lotes[0];
          const sumaStock = lotes.reduce((acc, l) => acc + l.cantidadDisponible, 0);
          return {
            ...it,
            loadingLotes: false,
            candidatos: lotes,
            sinStock: false,
            stockInsuficiente: sumaStock < cantidad,
            loteId: primerLote.loteId,
            loteSugeridoId: primerLote.loteId,
            motivoFefo: "",
          };
        }),
      );
    } catch {
      setCart((prev) =>
        prev.map((it) => (it.uid === uid ? { ...it, loadingLotes: false } : it)),
      );
    }
  }, []);

  // Guardar favoritos al cambiar
  const toggleFavorito = (item: FavoritoItem) => {
    const yaExiste = favoritos.some((f) => f.id === item.id);
    const nuevos = yaExiste ? favoritos.filter((f) => f.id !== item.id) : [...favoritos, item];
    setFavoritos(nuevos);
    guardarFavoritos(userId, nuevos);
  };

  // Agregar producto al carrito
  const agregarProducto = (prod: Producto) => {
    if (prod.precioVenta == null) return;
    const u = unidades.find((uni) => uni.id === prod.unidadMedidaId);
    const uid = `${prod.id}-${Date.now()}`;

    setCart((prev) => {
      const index = prev.findIndex((it) => it.productoId === prod.id);
      if (index >= 0) {
        const itemActual = prev[index];
        const nuevaCantidad = itemActual.cantidad + 1;
        const copy = [...prev];
        copy[index] = { ...itemActual, cantidad: nuevaCantidad };
        consultarLotesFefo(prod.id, nuevaCantidad, itemActual.uid);
        return copy;
      }
      const nuevoItem: CartItem = {
        uid,
        tipoItem: "producto",
        productoId: prod.id,
        nombre: prod.nombre,
        codigo: prod.codigo,
        precioUnitario: prod.precioVenta!,
        cantidad: 1,
        descuentoPorcentaje: 0,
        unidadMedidaId: prod.unidadMedidaId,
        admiteDecimales: u?.admite_decimales ?? false,
        escalaDecimal: u?.escala_decimal ?? 0,
        loadingLotes: true,
      };
      consultarLotesFefo(prod.id, 1, uid);
      return [...prev, nuevoItem];
    });
  };

  // Agregar servicio al carrito
  const agregarServicio = (serv: ServicioVendible) => {
    if (serv.precio == null) return;
    setCart((prev) => {
      const index = prev.findIndex((it) => it.servicioId === serv.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = { ...copy[index], cantidad: copy[index].cantidad + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          uid: `${serv.id}-${Date.now()}`,
          tipoItem: "servicio",
          servicioId: serv.id,
          nombre: serv.nombre,
          precioUnitario: serv.precio!,
          cantidad: 1,
          descuentoPorcentaje: 0,
        },
      ];
    });
  };

  // Quitar del carrito
  const quitarDelCarrito = (uid: string) => {
    setCart((prev) => prev.filter((it) => it.uid !== uid));
  };

  // Actualizar cantidad de ítem (re-consulta FEFO si es producto)
  const actualizarCantidad = (uid: string, cant: number) => {
    const item = cart.find((it) => it.uid === uid);
    if (cant > 0 && item && item.tipoItem === "producto" && item.productoId) {
      consultarLotesFefo(item.productoId, cant, uid);
    }
    setCart((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, cantidad: cant } : it)),
    );
  };

  // Cambiar lote en la línea del carrito (FEFO §2.2)
  const seleccionarLoteLinea = (uid: string, loteId: string) => {
    setCart((prev) =>
      prev.map((it) => {
        if (it.uid !== uid) return it;
        const esSugerido = it.loteSugeridoId === loteId;
        return {
          ...it,
          loteId,
          // Si vuelve al sugerido, el motivo se limpia; si elige otro, mantiene o pide motivo
          motivoFefo: esSugerido ? "" : it.motivoFefo || "",
        };
      }),
    );
  };

  // Actualizar motivo FEFO
  const actualizarMotivoFefo = (uid: string, motivo: string) => {
    setCart((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, motivoFefo: motivo } : it)),
    );
  };

  // Actualizar descuento por línea (%)
  const actualizarDescuentoLinea = (uid: string, desc: number) => {
    const d = Math.max(0, Math.min(100, isNaN(desc) ? 0 : desc));
    setCart((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, descuentoPorcentaje: d } : it)),
    );
  };

  // Actualizar mascota asociada al ítem
  const actualizarMascotaLinea = (uid: string, mascotaId: string | null) => {
    setCart((prev) =>
      prev.map((it) => (it.uid === uid ? { ...it, mascotaId: mascotaId || null } : it)),
    );
  };

  // Cálculos del carrito
  const subtotalLineas = useMemo(() => {
    return cart.reduce((acc, it) => {
      const precioBruto = it.precioUnitario * it.cantidad;
      const desc = precioBruto * (it.descuentoPorcentaje / 100);
      return acc + (precioBruto - desc);
    }, 0);
  }, [cart]);

  const totalFinal = useMemo(() => {
    const neto = subtotalLineas - Math.max(0, descuentoGlobal);
    return Math.max(0, neto);
  }, [subtotalLineas, descuentoGlobal]);

  // Validación de cobro: FEFO y stock resueltos
  const puedeCobrar = useMemo(() => {
    if (cart.length === 0) return false;
    for (const it of cart) {
      if (it.cantidad <= 0) return false;
      if (it.tipoItem === "producto") {
        if (it.sinStock) return false;
        if (!it.loteId) return false;
        // Si no es el lote sugerido, motivoFefo es REQUERIDO y no puede estar vacío
        if (it.loteSugeridoId && it.loteId !== it.loteSugeridoId) {
          if (!it.motivoFefo || !it.motivoFefo.trim()) return false;
        }
      }
    }
    return true;
  }, [cart]);

  // Si no hay cliente seleccionado, no se permite cuenta_corriente
  const handleCondicionPagoChange = (val: CondicionPago) => {
    if (val === "cuenta_corriente" && !cliente) return;
    setCondicionPago(val);
  };

  // Si se remueve el cliente y estaba en cuenta corriente, volver a contado
  const limpiarCliente = () => {
    setCliente(null);
    if (condicionPago === "cuenta_corriente") {
      setCondicionPago("contado");
    }
  };

  // Servicios filtrados por texto
  const serviciosFiltrados = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return servicios;
    return servicios.filter((s) => s.nombre.toLowerCase().includes(q));
  }, [servicios, debouncedSearch]);

  // ─── LÓGICA DE COBRO (F4·T2) ───────────────────────────────────────────────

  // Abrir panel de cobro
  const iniciarCobro = () => {
    if (!puedeCobrar) return;
    const medioDefecto =
      mediosPago.find((m) => m.codigo === "efectivo") || mediosPago[0];

    setPagos([
      {
        id: `pago-${Date.now()}`,
        medioPagoId: medioDefecto?.id || "",
        importe: totalFinal,
        referencia: "",
      },
    ]);
    setErrorCobro(null);
    setCobroDialogOpen(true);
  };

  // Atajo: pagar todo en efectivo
  const pagarTodoEnEfectivo = () => {
    const medioEfectivo =
      mediosPago.find((m) => m.codigo === "efectivo") || mediosPago[0];
    if (!medioEfectivo) return;

    setPagos([
      {
        id: `pago-${Date.now()}`,
        medioPagoId: medioEfectivo.id,
        importe: totalFinal,
        referencia: "",
      },
    ]);
  };

  // Agregar medio de pago a la lista
  const agregarMedioPago = () => {
    const sumaActual = pagos.reduce((acc, p) => acc + (p.importe || 0), 0);
    const faltante = Math.max(0, totalFinal - sumaActual);
    const medioDefecto = mediosPago[0];

    setPagos((prev) => [
      ...prev,
      {
        id: `pago-${Date.now()}`,
        medioPagoId: medioDefecto?.id || "",
        importe: faltante,
        referencia: "",
      },
    ]);
  };

  // Quitar medio de pago
  const quitarMedioPago = (id: string) => {
    setPagos((prev) => prev.filter((p) => p.id !== id));
  };

  // Actualizar línea de pago
  const actualizarPago = (id: string, campo: "medioPagoId" | "importe" | "referencia", val: any) => {
    setPagos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [campo]: val } : p)),
    );
  };

  // Cálculos de pagos
  const sumaPagos = useMemo(() => {
    return pagos.reduce((acc, p) => acc + (Number(p.importe) || 0), 0);
  }, [pagos]);

  const saldoFaltante = Math.max(0, totalFinal - sumaPagos);

  // Validación de confirmación de cobro
  const puedeConfirmarCobro = useMemo(() => {
    if (submittingVenta) return false;
    if (pagos.length === 0) return false;

    // Con contado, debe cubrir la totalidad
    if (condicionPago === "contado" && sumaPagos < totalFinal) {
      return false;
    }

    // Cada pago debe tener importe > 0 y si requiere referencia, no estar vacía
    for (const p of pagos) {
      if (p.importe <= 0) return false;
      const m = mediosPago.find((x) => x.id === p.medioPagoId);
      if (m?.requiere_referencia && !p.referencia?.trim()) {
        return false;
      }
    }
    return true;
  }, [submittingVenta, pagos, condicionPago, sumaPagos, totalFinal, mediosPago]);

  // Enviar venta a la API
  const handleConfirmarVenta = async () => {
    if (!puedeConfirmarCobro || !sesion) return;

    setSubmittingVenta(true);
    setErrorCobro(null);

    const payload: RegistrarVentaInput = {
      sesionCajaId: sesion.id,
      clienteId: cliente?.id || null,
      condicionPago,
      descuento: descuentoGlobal,
      observaciones: observacionesVenta.trim() || null,
      // NOTA CRÍTICA: NO MANDAR precioUnitario para respetar alícuota del catálogo
      items: cart.map((it) => ({
        tipoItem: it.tipoItem,
        productoId: it.tipoItem === "producto" ? it.productoId : null,
        servicioId: it.tipoItem === "servicio" ? it.servicioId : null,
        cantidad: it.cantidad,
        descuentoPorcentaje: it.descuentoPorcentaje,
        loteId: it.tipoItem === "producto" ? it.loteId : null,
        motivoFefo:
          it.tipoItem === "producto" && it.loteId !== it.loteSugeridoId
            ? it.motivoFefo?.trim() || null
            : null,
        mascotaId: it.mascotaId || null,
      })),
      pagos: pagos
        .filter((p) => p.importe > 0)
        .map((p) => ({
          medioPagoId: p.medioPagoId,
          importe: p.importe,
          referencia: p.referencia?.trim() || null,
        })),
    };

    try {
      const res = await registrarVenta(payload);
      setResultadoVenta(res);
      setCobroDialogOpen(false);
      setExitoDialogOpen(true);
    } catch (err: any) {
      const code = err?.code || "";
      let msg = err?.message || "Error al registrar la operación de venta.";

      if (code === "PRODUCT_WITHOUT_PRICE") {
        msg = "Uno de los productos no tiene precio configurado en el catálogo.";
      } else if (code === "PRODUCT_NOT_SELLABLE") {
        msg = "El producto no está habilitado para la venta.";
      } else if (code === "PRODUCT_INACTIVE") {
        msg = "El producto se encuentra inactivo.";
      } else if (code === "UNIT_NO_DECIMALS") {
        msg = "La cantidad no respeta la escala decimal permitida para la unidad de medida.";
      } else if (code === "INSUFFICIENT_STOCK") {
        msg = "Stock insuficiente en los lotes seleccionados para completar la venta.";
      } else if (code === "CASH_SESSION_NOT_FOUND") {
        msg = "No se encontró una sesión de caja abierta válida para registrar la operación.";
      }

      setErrorCobro(msg);
      // El carrito NO se vacía ante un error
    } finally {
      setSubmittingVenta(false);
    }
  };

  // Resetear para nueva venta
  const reiniciarVenta = () => {
    setCart([]);
    setCliente(null);
    setCondicionPago("contado");
    setDescuentoGlobal(0);
    setObservacionesVenta("");
    setExitoDialogOpen(false);
    setResultadoVenta(null);
  };

  // ─── RENDER: Guardia de caja ───────────────────────────────────────────────
  if (cajaLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
          <ShoppingCart className="size-6 text-orange-600" aria-hidden />
          Mostrador de Ventas
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (errorCaja) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
          <ShoppingCart className="size-6 text-orange-600" aria-hidden />
          Mostrador de Ventas
        </h1>
        <Card className="border-destructive/30 bg-destructive/5 max-w-lg mx-auto">
          <CardHeader className="text-center">
            <AlertCircle className="size-8 text-destructive mx-auto" aria-hidden />
            <CardTitle className="text-destructive">Error al consultar caja</CardTitle>
            <CardDescription>{errorCaja}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button variant="outline" onClick={verificarCaja}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sesion) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
          <ShoppingCart className="size-6 text-orange-600" aria-hidden />
          Mostrador de Ventas
        </h1>
        <Card className="max-w-md mx-auto border-amber-300 bg-amber-50/50 shadow-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Wallet className="size-6" aria-hidden />
            </div>
            <CardTitle className="text-amber-900">Caja cerrada</CardTitle>
            <CardDescription className="text-amber-800 text-sm">
              No hay una caja abierta. Las ventas necesitan una sesión de caja.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pt-2">
            {tieneManageCash ? (
              <Button asChild className="bg-orange-600 hover:bg-orange-700 text-white">
                <Link to="/ventas/caja">
                  <Wallet className="size-4 mr-2" aria-hidden />
                  Ir a Caja para abrir sesión
                </Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground bg-white/80 p-3 rounded-md border border-amber-200">
                Pedí a un usuario con permisos que abra la caja.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── RENDER: Mostrador Operativo ───────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Encabezado principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-orange-950 flex items-center gap-2">
            <ShoppingCart className="size-6 text-orange-600" aria-hidden />
            Mostrador de Ventas
          </h1>
          <p className="text-sm text-muted-foreground">
            Sesión de caja: <span className="font-semibold text-foreground">{sesion.cajaNombre || "Principal"}</span> | Cajero: {user?.fullName || "Usuario"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/ventas/historial">Historial de Ventas</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/ventas/caja">Ver Caja</Link>
          </Button>
        </div>
      </div>

      {/* Layout de dos columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Columna Izquierda: Buscador, Favoritos y Catálogo */}
        <div className="lg:col-span-7 space-y-4">
          {/* Grilla de Favoritos (P-09) */}
          <Card className="shadow-sm border-orange-200">
            <CardHeader className="py-3 px-4 bg-orange-50/50 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-orange-950">
                  <Star className="size-4 text-amber-500 fill-amber-400" aria-hidden />
                  Accesos rápidos favoritos
                </div>
                <span className="text-xs text-muted-foreground">
                  {favoritos.length} {favoritos.length === 1 ? "ítem" : "ítems"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {favoritos.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center italic">
                  Marcá productos o servicios con la estrella para tenerlos a mano.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {favoritos.map((fav) => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => {
                        if (fav.tipo === "producto") {
                          const prodEnLista = productos.find((x) => x.id === fav.id);
                          if (prodEnLista) {
                            agregarProducto(prodEnLista);
                          } else {
                            const uid = `${fav.id}-${Date.now()}`;
                            consultarLotesFefo(fav.id, 1, uid);
                            setCart((prev) => {
                              const idx = prev.findIndex((it) => it.productoId === fav.id);
                              if (idx >= 0) {
                                const copy = [...prev];
                                copy[idx] = { ...copy[idx], cantidad: copy[idx].cantidad + 1 };
                                return copy;
                              }
                              return [
                                ...prev,
                                {
                                  uid,
                                  tipoItem: "producto",
                                  productoId: fav.id,
                                  nombre: fav.nombre,
                                  codigo: fav.codigo,
                                  precioUnitario: fav.precio,
                                  cantidad: 1,
                                  descuentoPorcentaje: 0,
                                  loadingLotes: true,
                                },
                              ];
                            });
                          }
                        } else {
                          agregarServicio({
                            id: fav.id,
                            nombre: fav.nombre,
                            precio: fav.precio,
                            alicuota_iva: 21,
                            tipo: "general",
                          });
                        }
                      }}
                      className="group relative flex flex-col justify-between p-2 rounded-lg border bg-card hover:bg-orange-50/80 hover:border-orange-300 text-left transition-colors shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-1 w-full">
                        <span className="text-xs font-medium text-foreground line-clamp-2 leading-tight">
                          {fav.nombre}
                        </span>
                        <button
                          type="button"
                          aria-label={`Quitar ${fav.nombre} de favoritos`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorito(fav);
                          }}
                          className="text-amber-500 hover:text-muted-foreground p-0.5"
                        >
                          <Star className="size-3.5 fill-amber-400" aria-hidden />
                        </button>
                      </div>
                      <div className="mt-2 text-xs font-bold text-orange-950">
                        {formatMoneda(fav.precio)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Buscador y Catálogo con Tabs */}
          <Card className="shadow-sm">
            <CardHeader className="p-4 pb-2">
              {/* Barra de Búsqueda por Texto */}
              <div className="relative w-full mb-3">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  placeholder="Buscar por nombre, código o código de barras..."
                  aria-label="Buscar productos o servicios"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Pestañas Productos / Servicios */}
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "productos" | "servicios")}
                className="w-full"
              >
                <div className="flex items-center justify-between gap-2 border-b pb-2">
                  <TabsList className="grid grid-cols-2 w-56">
                    <TabsTrigger value="productos" className="text-xs">
                      Productos
                    </TabsTrigger>
                    <TabsTrigger value="servicios" className="text-xs">
                      Servicios
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Contenido Pestaña Productos */}
                <TabsContent value="productos" className="space-y-3 pt-3">
                  {/* Chips de Familias (P-09) */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Familias
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-1">
                      <Button
                        type="button"
                        variant={selectedFamiliaId === null ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "h-7 text-xs rounded-full px-3",
                          selectedFamiliaId === null && "bg-orange-600 hover:bg-orange-700 text-white",
                        )}
                        onClick={() => setSelectedFamiliaId(null)}
                      >
                        Todas
                      </Button>
                      {familias.map((fam) => {
                        const active = selectedFamiliaId === fam.id;
                        return (
                          <Button
                            key={fam.id}
                            type="button"
                            variant={active ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "h-7 text-xs rounded-full px-3",
                              active && "bg-orange-600 hover:bg-orange-700 text-white",
                            )}
                            onClick={() => setSelectedFamiliaId(active ? null : fam.id)}
                          >
                            {fam.nombre}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Lista de Resultados de Productos */}
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {loadingProductos ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-md" />
                      ))
                    ) : productos.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No se encontraron productos vendibles.
                      </div>
                    ) : (
                      productos.map((prod) => {
                        const sinPrecio = prod.precioVenta == null;
                        const esFav = favoritos.some((f) => f.id === prod.id);

                        return (
                          <div
                            key={prod.id}
                            className={cn(
                              "flex items-center justify-between p-2.5 rounded-lg border bg-card transition-colors",
                              sinPrecio
                                ? "opacity-60 bg-muted/30"
                                : "hover:border-orange-300 hover:bg-orange-50/30",
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <button
                                type="button"
                                aria-label={`Favorito ${prod.nombre}`}
                                onClick={() =>
                                  toggleFavorito({
                                    id: prod.id,
                                    tipo: "producto",
                                    nombre: prod.nombre,
                                    codigo: prod.codigo,
                                    precio: prod.precioVenta ?? 0,
                                  })
                                }
                                className="text-muted-foreground hover:text-amber-500 shrink-0"
                              >
                                <Star
                                  className={cn(
                                    "size-4",
                                    esFav ? "text-amber-500 fill-amber-400" : "text-muted-foreground",
                                  )}
                                  aria-hidden
                                />
                              </button>
                              <div className="min-w-0">
                                <div className="font-medium text-sm text-foreground truncate">
                                  {prod.nombre}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-mono">{prod.codigo}</span>
                                  {prod.marca && <span>• {prod.marca}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 ml-2">
                              {sinPrecio ? (
                                <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                                  Sin precio
                                </Badge>
                              ) : (
                                <span className="font-bold text-sm text-orange-950">
                                  {formatMoneda(prod.precioVenta!)}
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={sinPrecio}
                                onClick={() => agregarProducto(prod)}
                                className="h-8 text-xs border-orange-300 text-orange-900 hover:bg-orange-100"
                              >
                                <Plus className="size-3.5 mr-1" aria-hidden />
                                Agregar
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </TabsContent>

                {/* Contenido Pestaña Servicios */}
                <TabsContent value="servicios" className="space-y-3 pt-3">
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {loadingServicios ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-md" />
                      ))
                    ) : serviciosFiltrados.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No se encontraron servicios disponibles.
                      </div>
                    ) : (
                      serviciosFiltrados.map((serv) => {
                        const sinPrecio = serv.precio == null;
                        const esFav = favoritos.some((f) => f.id === serv.id);

                        return (
                          <div
                            key={serv.id}
                            className={cn(
                              "flex items-center justify-between p-2.5 rounded-lg border bg-card transition-colors",
                              sinPrecio
                                ? "opacity-60 bg-muted/30"
                                : "hover:border-orange-300 hover:bg-orange-50/30",
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <button
                                type="button"
                                aria-label={`Favorito ${serv.nombre}`}
                                onClick={() =>
                                  toggleFavorito({
                                    id: serv.id,
                                    tipo: "servicio",
                                    nombre: serv.nombre,
                                    precio: serv.precio ?? 0,
                                  })
                                }
                                className="text-muted-foreground hover:text-amber-500 shrink-0"
                              >
                                <Star
                                  className={cn(
                                    "size-4",
                                    esFav ? "text-amber-500 fill-amber-400" : "text-muted-foreground",
                                  )}
                                  aria-hidden
                                />
                              </button>
                              <div className="min-w-0">
                                <div className="font-medium text-sm text-foreground truncate">
                                  {serv.nombre}
                                </div>
                                <span className="text-xs text-muted-foreground capitalize">
                                  {serv.tipo}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 ml-2">
                              {sinPrecio ? (
                                <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                                  Sin precio
                                </Badge>
                              ) : (
                                <span className="font-bold text-sm text-orange-950">
                                  {formatMoneda(serv.precio!)}
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={sinPrecio}
                                onClick={() => agregarServicio(serv)}
                                className="h-8 text-xs border-orange-300 text-orange-900 hover:bg-orange-100"
                              >
                                <Plus className="size-3.5 mr-1" aria-hidden />
                                Agregar
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardHeader>
          </Card>
        </div>

        {/* Columna Derecha: Carrito de Venta */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="shadow-md border-orange-200">
            <CardHeader className="py-3 px-4 bg-orange-50/60 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="size-5 text-orange-700" aria-hidden />
                  <CardTitle className="text-base font-semibold text-orange-950">
                    Carrito de Venta
                  </CardTitle>
                </div>
                <Badge variant="secondary" className="font-mono text-xs">
                  {cart.length} {cart.length === 1 ? "línea" : "líneas"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
              {/* Selector opcional de Cliente */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                  Cliente (opcional)
                </Label>
                {cliente ? (
                  <div className="flex items-center justify-between p-2 rounded-md bg-orange-50 border border-orange-200 text-sm">
                    <div className="flex items-center gap-2 truncate">
                      <User className="size-4 text-orange-700 shrink-0" aria-hidden />
                      <div className="truncate">
                        <span className="font-medium text-foreground">{cliente.fullName}</span>
                        {cliente.dniCuit && (
                          <span className="text-xs text-muted-foreground ml-1.5">({cliente.dniCuit})</span>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={limpiarCliente}
                      aria-label="Quitar cliente"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <Popover open={clienteOpen} onOpenChange={setClienteOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={clienteOpen}
                        aria-label="Seleccionar cliente"
                        className="w-full justify-between text-left font-normal text-muted-foreground text-xs h-9"
                      >
                        Buscar cliente (mostrador anónimo si está vacío)...
                        <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" aria-hidden />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Buscar por nombre o DNI..."
                          value={clienteQuery}
                          onValueChange={setClienteQuery}
                        />
                        <CommandList>
                          <CommandEmpty>Sin resultados.</CommandEmpty>
                          <CommandGroup>
                            {clientesSugeridos.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={c.id}
                                onSelect={() => {
                                  setCliente(c);
                                  setClienteOpen(false);
                                }}
                              >
                                <Check
                                  className="mr-2 size-4 opacity-0"
                                  aria-hidden
                                />
                                <div>
                                  <div className="font-medium">{c.fullName}</div>
                                  {c.dniCuit && (
                                    <div className="text-xs text-muted-foreground">{c.dniCuit}</div>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Lista de Líneas del Carrito */}
              <div className="space-y-3 min-h-36 max-h-96 overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    El carrito está vacío.
                    <br />
                    Agregá productos o servicios del catálogo.
                  </div>
                ) : (
                  cart.map((item) => {
                    const step = item.admiteDecimales
                      ? Math.pow(10, -(item.escalaDecimal || 3))
                      : 1;
                    const precioBruto = item.precioUnitario * item.cantidad;
                    const desc = precioBruto * (item.descuentoPorcentaje / 100);
                    const totalLinea = precioBruto - desc;
                    const esProducto = item.tipoItem === "producto";
                    const noEsSugerido =
                      esProducto &&
                      item.loteId &&
                      item.loteSugeridoId &&
                      item.loteId !== item.loteSugeridoId;

                    return (
                      <div
                        key={item.uid}
                        className="p-3 rounded-lg border bg-card space-y-2 shadow-2xs"
                      >
                        {/* Fila 1: Nombre, Tipo y Eliminar */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium text-sm text-foreground leading-tight block">
                              {item.nombre}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Unitario: {formatMoneda(item.precioUnitario)} con IVA
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Eliminar ${item.nombre} del carrito`}
                            onClick={() => quitarDelCarrito(item.uid)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>

                        {/* Selector de Lote con FEFO (§2.2) para Productos */}
                        {esProducto && (
                          <div className="space-y-1.5 pt-1">
                            {item.loadingLotes ? (
                              <Skeleton className="h-8 w-full" />
                            ) : item.sinStock ? (
                              <div className="rounded bg-destructive/10 p-2 text-xs font-medium text-destructive border border-destructive/20 flex items-center gap-1.5">
                                <AlertCircle className="size-4 shrink-0" aria-hidden />
                                Sin stock disponible
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase">
                                    Lote (criterio FEFO)
                                  </Label>
                                  {item.stockInsuficiente && (
                                    <span className="text-[10px] text-amber-600 font-medium">
                                      Stock disponible menor al pedido
                                    </span>
                                  )}
                                </div>
                                <Select
                                  value={item.loteId || ""}
                                  onValueChange={(val) => seleccionarLoteLinea(item.uid, val)}
                                >
                                  <SelectTrigger
                                    aria-label={`Lote para ${item.nombre}`}
                                    className="h-8 text-xs font-mono"
                                  >
                                    <SelectValue placeholder="Seleccionar lote..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(item.candidatos || []).map((cand, idx) => {
                                      const esSugerido = idx === 0;
                                      return (
                                        <SelectItem key={cand.loteId} value={cand.loteId}>
                                          <div className="flex items-center gap-2">
                                            <span>{cand.codigoLote || "Sin código"}</span>
                                            {cand.fechaVencimiento && (
                                              <span className="text-muted-foreground text-[10px]">
                                                (vence: {cand.fechaVencimiento})
                                              </span>
                                            )}
                                            <span className="text-muted-foreground text-[10px]">
                                              Disp: {cand.cantidadDisponible}
                                            </span>
                                            {esSugerido && (
                                              <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px] px-1 py-0 hover:bg-green-100">
                                                Sugerido (vence antes)
                                              </Badge>
                                            )}
                                          </div>
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>

                                {/* Campo motivoFefo en la misma línea (§2.2) */}
                                {noEsSugerido && (
                                  <div className="pt-1 space-y-1 bg-amber-50/70 p-2 rounded-md border border-amber-200">
                                    <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-900">
                                      <AlertTriangle className="size-3.5 text-amber-600" aria-hidden />
                                      Motivo de desvío de FEFO (requerido)
                                    </div>
                                    <Input
                                      type="text"
                                      placeholder="Explicá por qué elegís este lote en vez del sugerido..."
                                      aria-label={`Motivo FEFO para ${item.nombre}`}
                                      value={item.motivoFefo || ""}
                                      onChange={(e) => actualizarMotivoFefo(item.uid, e.target.value)}
                                      className="h-7 text-xs bg-white border-amber-300"
                                      required
                                    />
                                    {!item.motivoFefo?.trim() && (
                                      <span className="text-[10px] text-destructive block">
                                        Debés especificar un motivo para poder cobrar.
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Fila 2: Cantidad, Descuento e Importe */}
                        <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t">
                          {/* Cantidad */}
                          <div className="col-span-4">
                            <Label className="text-[10px] text-muted-foreground block mb-0.5">
                              Cant.
                            </Label>
                            <Input
                              type="number"
                              min={step}
                              step={step}
                              aria-label={`Cantidad para ${item.nombre}`}
                              value={item.cantidad === 0 ? "" : item.cantidad}
                              onChange={(e) => {
                                const val = e.target.value === "" ? 0 : parseFloat(e.target.value);
                                actualizarCantidad(item.uid, isNaN(val) ? 0 : val);
                              }}
                              className="h-8 text-xs font-mono text-center"
                            />
                          </div>

                          {/* Descuento (%) */}
                          <div className="col-span-4">
                            <Label className="text-[10px] text-muted-foreground block mb-0.5">
                              Desc. %
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              aria-label={`Descuento para ${item.nombre}`}
                              value={item.descuentoPorcentaje}
                              onChange={(e) =>
                                actualizarDescuentoLinea(item.uid, parseFloat(e.target.value) || 0)
                              }
                              className="h-8 text-xs font-mono text-center"
                            />
                          </div>

                          {/* Importe Línea */}
                          <div className="col-span-4 text-right">
                            <Label className="text-[10px] text-muted-foreground block mb-0.5">
                              Importe
                            </Label>
                            <div className="h-8 flex items-center justify-end font-bold text-sm text-orange-950">
                              {formatMoneda(totalLinea)}
                            </div>
                          </div>
                        </div>

                        {/* Selector opcional de Mascota */}
                        {clienteMascotas.length > 0 && (
                          <div className="pt-1">
                            <Select
                              value={item.mascotaId || "ninguna"}
                              onValueChange={(val) =>
                                actualizarMascotaLinea(item.uid, val === "ninguna" ? null : val)
                              }
                            >
                              <SelectTrigger aria-label={`Mascota para ${item.nombre}`} className="h-7 text-xs">
                                <div className="flex items-center gap-1.5 truncate">
                                  <PawPrint className="size-3 text-muted-foreground shrink-0" aria-hidden />
                                  <SelectValue placeholder="Asignar paciente..." />
                                </div>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ninguna">Sin mascota asociada</SelectItem>
                                {clienteMascotas.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name} ({m.especieName || "Mascota"})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totales y Cierre */}
              <div className="border-t pt-4 space-y-3">
                {/* Condición de Pago */}
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium text-foreground">Condición de pago</Label>
                  <Select
                    value={condicionPago}
                    onValueChange={(v) => handleCondicionPagoChange(v as CondicionPago)}
                  >
                    <SelectTrigger aria-label="Condición de pago" className="h-8 text-xs w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contado">Contado</SelectItem>
                      <SelectItem
                        value="cuenta_corriente"
                        disabled={!cliente}
                      >
                        Cuenta corriente {!cliente ? "(requiere cliente)" : ""}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Descuento Global */}
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium text-foreground">Descuento global ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Descuento global"
                    value={descuentoGlobal === 0 ? "" : descuentoGlobal}
                    placeholder="0.00"
                    onChange={(e) => setDescuentoGlobal(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="h-8 text-xs w-32 text-right font-mono"
                  />
                </div>

                {/* Total Final */}
                <div className="rounded-lg bg-orange-50/80 p-3 border border-orange-200 flex items-baseline justify-between">
                  <div className="space-y-0.5">
                    <span className="text-sm font-bold text-orange-950 uppercase tracking-wide">
                      Total a pagar
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      (IVA incluido)
                    </span>
                  </div>
                  <div className="text-2xl font-black text-orange-950">
                    {formatMoneda(totalFinal)}
                  </div>
                </div>

                {/* Botón Cobrar (F4·T2) */}
                <Button
                  type="button"
                  disabled={!puedeCobrar}
                  onClick={iniciarCobro}
                  className="w-full h-11 text-base font-semibold bg-orange-600 hover:bg-orange-700 text-white shadow-sm"
                >
                  Cobrar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── MODAL DE COBRO (F4·T2) ───────────────────────────────────────────── */}
      <Dialog open={cobroDialogOpen} onOpenChange={setCobroDialogOpen}>
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-orange-950 flex items-center gap-2">
              <CreditCard className="size-5 text-orange-600" aria-hidden />
              Registro de Cobro
            </DialogTitle>
            <DialogDescription>
              Seleccioná los medios de pago para registrar la operación en la sesión de caja abierta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Banner de Total */}
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200 flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground uppercase font-semibold">Total a cobrar</span>
                <div className="text-2xl font-black text-orange-950">
                  {formatMoneda(totalFinal)}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pagarTodoEnEfectivo}
                className="text-xs border-orange-300 text-orange-900 hover:bg-orange-100"
              >
                <Coins className="size-3.5 mr-1 text-orange-700" aria-hidden />
                Pagar todo en efectivo
              </Button>
            </div>

            {/* Error de RPC si hubo */}
            {errorCobro && (
              <div
                role="alert"
                className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
                <div>{errorCobro}</div>
              </div>
            )}

            {/* Medios de Pago */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">
                  Medios de pago ({pagos.length})
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={agregarMedioPago}
                  className="h-7 text-xs text-orange-700 hover:text-orange-900"
                >
                  <Plus className="size-3.5 mr-1" aria-hidden />
                  Agregar otro medio
                </Button>
              </div>

              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {pagos.map((p, idx) => {
                  const medioSeleccionado = mediosPago.find((m) => m.id === p.medioPagoId);
                  const exigeReferencia = medioSeleccionado?.requiere_referencia;

                  return (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-lg border bg-muted/20 space-y-2"
                    >
                      <div className="grid grid-cols-12 gap-2 items-center">
                        {/* Selector de medio */}
                        <div className="col-span-6">
                          <Label className="text-[10px] text-muted-foreground block mb-0.5">
                            Medio #{idx + 1}
                          </Label>
                          <Select
                            value={p.medioPagoId}
                            onValueChange={(val) => actualizarPago(p.id, "medioPagoId", val)}
                          >
                            <SelectTrigger aria-label={`Medio de pago ${idx + 1}`} className="h-8 text-xs">
                              <SelectValue placeholder="Elegir medio..." />
                            </SelectTrigger>
                            <SelectContent>
                              {mediosPago.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.nombre}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Importe */}
                        <div className="col-span-5">
                          <Label className="text-[10px] text-muted-foreground block mb-0.5">
                            Importe ($)
                          </Label>
                          <Input
                            type="number"
                            min={0.01}
                            step={0.01}
                            aria-label={`Importe pago ${idx + 1}`}
                            value={p.importe || ""}
                            onChange={(e) =>
                              actualizarPago(p.id, "importe", parseFloat(e.target.value) || 0)
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </div>

                        {/* Botón quitar */}
                        <div className="col-span-1 flex items-end justify-center pt-3">
                          {pagos.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Eliminar pago ${idx + 1}`}
                              onClick={() => quitarMedioPago(p.id)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Campo Referencia */}
                      <div>
                        <Input
                          type="text"
                          placeholder={
                            exigeReferencia
                              ? "N° de cupón, autorización o transferencia (requerido)..."
                              : "Referencia opcional..."
                          }
                          aria-label={`Referencia pago ${idx + 1}`}
                          value={p.referencia}
                          onChange={(e) => actualizarPago(p.id, "referencia", e.target.value)}
                          className={cn(
                            "h-7 text-xs",
                            exigeReferencia && !p.referencia?.trim() && "border-amber-400 bg-amber-50/50",
                          )}
                          required={exigeReferencia}
                        />
                        {exigeReferencia && !p.referencia?.trim() && (
                          <span className="text-[10px] text-amber-700 block mt-0.5">
                            Este medio de pago requiere ingresar un número de referencia.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Indicador en vivo de saldo faltante o saldo a cuenta corriente */}
              <div className="p-2.5 rounded-md bg-muted/40 border text-xs flex items-center justify-between">
                <span className="font-medium text-muted-foreground">Total ingresado:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatMoneda(sumaPagos)}
                </span>
              </div>

              {saldoFaltante > 0 && condicionPago === "contado" && (
                <div className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <AlertCircle className="size-3.5" aria-hidden />
                  Faltan cubrir {formatMoneda(saldoFaltante)} para completar el pago al contado.
                </div>
              )}

              {saldoFaltante > 0 && condicionPago === "cuenta_corriente" && (
                <div className="text-xs font-medium text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                  Saldo pendiente a cuenta corriente de {cliente?.fullName}:{" "}
                  <span className="font-bold font-mono">{formatMoneda(saldoFaltante)}</span>
                </div>
              )}
            </div>

            {/* Observaciones */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Observaciones (opcional)
              </Label>
              <Textarea
                placeholder="Notas internas sobre la venta..."
                aria-label="Observaciones de venta"
                value={observacionesVenta}
                onChange={(e) => setObservacionesVenta(e.target.value)}
                rows={2}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCobroDialogOpen(false)}
              disabled={submittingVenta}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!puedeConfirmarCobro}
              onClick={handleConfirmarVenta}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {submittingVenta ? "Registrando..." : "Confirmar venta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL DE ÉXITO POST-VENTA (F4·T2) ───────────────────────────────── */}
      <Dialog open={exitoDialogOpen} onOpenChange={setExitoDialogOpen}>
        <DialogContent className="max-w-md text-center sm:text-left">
          <DialogHeader className="text-center sm:text-left">
            <div className="mx-auto sm:mx-0 mb-2 flex size-12 items-center justify-center rounded-full bg-green-100 text-green-700">
              <CheckCircle2 className="size-7" aria-hidden />
            </div>
            {/* NOTA CRÍTICA: "Operación N°", nunca "Comprobante", "Factura", "Ticket", "Recibo" */}
            <DialogTitle className="text-xl font-bold text-foreground">
              Operación N° {resultadoVenta?.numeroOperacion}
            </DialogTitle>
            <DialogDescription>
              La venta fue registrada con éxito en el sistema.
            </DialogDescription>
          </DialogHeader>

          {resultadoVenta && (
            <div className="space-y-3 py-2 text-sm border-y my-2">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal neto:</span>
                <span className="font-mono">{formatMoneda(resultadoVenta.subtotalNeto)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>IVA:</span>
                <span className="font-mono">{formatMoneda(resultadoVenta.totalIva)}</span>
              </div>
              <div className="flex justify-between font-bold text-base text-foreground pt-1 border-t">
                <span>Total pagado:</span>
                <span className="font-mono text-orange-950">{formatMoneda(resultadoVenta.total)}</span>
              </div>
              {resultadoVenta.saldoPendiente > 0 && (
                <div className="flex justify-between text-amber-800 bg-amber-50 p-2 rounded text-xs font-semibold">
                  <span>Saldo pendiente:</span>
                  <span className="font-mono">{formatMoneda(resultadoVenta.saldoPendiente)}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={reiniciarVenta}
              className="w-full sm:w-auto"
            >
              Nueva venta
            </Button>
            {resultadoVenta && (
              <Button
                type="button"
                asChild
                className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Link to={`/ventas/${resultadoVenta.ventaId}`}>
                  Ver detalle
                  <ArrowRight className="size-4 ml-1" aria-hidden />
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
