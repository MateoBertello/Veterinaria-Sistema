import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listarProductos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  crearDerivado,
  listarFamilias,
  obtenerFamilia,
  crearFamilia,
  actualizarFamilia,
  cambiarEstadoFamilia,
  listarConversiones,
  crearConversion,
  actualizarConversion,
  cambiarEstadoConversion,
  listarProveedores,
  obtenerProveedor,
  crearProveedor,
  actualizarProveedor,
  cambiarEstadoProveedor,
  listarLotes,
  obtenerLote,
  kardex,
  trazabilidad,
  candidatosFefo,
  listarMovimientos,
  listarExistencias,
  valorizacion,
  listarCompras,
  obtenerCompra,
  crearCompra,
  actualizarCompra,
  agregarItem,
  actualizarItem,
  quitarItem,
  confirmarCompra,
  anularCompra,
  listarCajas,
  listarSesiones,
  sesionActual,
  obtenerSesion,
  resumenSesion,
  abrirSesion,
  registrarMovimiento,
  cerrarSesion,
  listarVentas,
  obtenerVenta,
  registrarVenta,
  anularVenta,
  reporteMargen,
  reporteItemsVendidos,
  ajustarExistencia,
  bloquearLote,
  desbloquearLote,
  crearRecuento,
  listarRecuentos,
  obtenerRecuento,
  guardarDetallesRecuento,
  aplicarRecuento,
  eliminarRecuento,
  registrarDevolucion,
  fraccionar,
  sugerirVencimiento,
  historial,
  registrar as registrarConsumo,
  porEvento as consumosPorEvento,
  disponibilidad as disponibilidadConsumo,
  valorizacionAFecha,
  rotacion,
  fraccionamiento as reporteFraccionamiento,
  consumoProfesional,
  consumoEspecie,
  rentabilidad,
  ventasUsuario,
  ventasSesion,
  ventasMedioPago,
} from "./index.ts";
import { ApiError } from "../../types/index.ts";

const fetchMock = vi.fn();

function envelopeOk(data: unknown, meta?: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => (meta !== undefined ? { success: true, data, meta } : { success: true, data }),
  };
}

function envelopeFail(code: string, message: string, statusCode = 400) {
  return {
    ok: false,
    status: statusCode,
    json: async () => ({
      success: false,
      error: { code, statusCode, message, details: [] },
    }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sb-token", "jwt-usuario-comercial");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("API Comercial - Productos, Familias y Conversiones", () => {
  it("listarProductos arma path y query omitiendo undefined, devuelve items y meta", async () => {
    fetchMock.mockResolvedValueOnce(
      envelopeOk([{ id: "prod-1", nombre: "Vacuna Rabia" }], { total: 1, page: 1, limit: 10, totalPages: 1 }),
    );

    const res = await listarProductos({ page: 1, limit: 10, search: "Vacuna", familiaId: undefined });
    expect(res.items).toHaveLength(1);
    expect(res.meta.total).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("/api/v1/productos?page=1&limit=10&search=Vacuna");
    expect(init?.method ?? "GET").toBe("GET");
    expect(url).not.toContain("undefined");
  });

  it("obtenerProducto arma el path correcto", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ id: "prod-1", nombre: "Pipeta" }));
    const prod = await obtenerProducto("prod-1");
    expect(prod.id).toBe("prod-1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/productos/prod-1");
  });

  it("crearProducto envía POST con body en JSON", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ id: "prod-nuevo" }));
    const body = {
      codigo: "P001",
      nombre: "Antiparasitario",
      unidadMedidaId: "um-1",
      precioVenta: 1500,
      costoReposicion: 900,
      alicuotaIva: 21,
      condicionVenta: "libre" as const,
      controlaLote: true,
      controlaVencimiento: true,
      esVendible: true,
      esConsumibleClinico: false,
    };
    await crearProducto(body);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/productos");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("actualizarProducto envía PUT con el body", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ id: "prod-1" }));
    await actualizarProducto("prod-1", { nombre: "Nombre Actualizado" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/productos/prod-1");
    expect(init.method).toBe("PUT");
  });

  it("cambiarEstadoProducto envía PATCH a /estado", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ id: "prod-1", activo: false }));
    await cambiarEstadoProducto("prod-1", false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/productos/prod-1/estado");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ activo: false });
  });

  it("crearDerivado envía POST a /derivado", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ derivado: { id: "der-1" } }));
    await crearDerivado("prod-padre", {
      codigo: "D001",
      nombre: "Derivado Frasco",
      unidadMedidaId: "um-ml",
      factorTeorico: 100,
      precioVenta: 200,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/productos/prod-padre/derivado");
    expect(init.method).toBe("POST");
  });

  it("CRUD familias y conversiones apuntan a sus endpoints", async () => {
    fetchMock.mockResolvedValue(envelopeOk({ id: "f-1" }));
    await listarFamilias();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/familias-producto");

    await obtenerFamilia("f-1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/familias-producto/f-1");

    await crearFamilia({ nombre: "Farmacia", unidadBaseId: "um-1" });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/familias-producto");

    await actualizarFamilia("f-1", { nombre: "Farmacia Editada" });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/familias-producto/f-1");

    await cambiarEstadoFamilia("f-1", false);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/familias-producto/f-1/estado");

    await listarConversiones({ productoOrigenId: "prod-1" });
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/producto-conversiones?productoOrigenId=prod-1");

    await crearConversion({ productoOrigenId: "p-1", productoDestinoId: "p-2", factorTeorico: 10 });
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/producto-conversiones");

    await actualizarConversion("c-1", { factorTeorico: 20 });
    expect(fetchMock.mock.calls[7][0]).toBe("/api/v1/producto-conversiones/c-1");

    await cambiarEstadoConversion("c-1", true);
    expect(fetchMock.mock.calls[8][0]).toBe("/api/v1/producto-conversiones/c-1/estado");
  });
});

describe("API Comercial - Proveedores", () => {
  it("CRUD de proveedores usa rutas correctas", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 10, totalPages: 0 }));
    await listarProveedores({ page: 1, activo: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/proveedores?page=1&activo=true");

    fetchMock.mockResolvedValue(envelopeOk({ id: "prov-1" }));
    await obtenerProveedor("prov-1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/proveedores/prov-1");

    await crearProveedor({ razonSocial: "Distribuidora Vet SA", condicionFiscal: "responsable_inscripto" });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/proveedores");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");

    await actualizarProveedor("prov-1", { telefono: "123456" });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/proveedores/prov-1");
    expect(fetchMock.mock.calls[3][1].method).toBe("PUT");

    await cambiarEstadoProveedor("prov-1", false);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/proveedores/prov-1/estado");
    expect(fetchMock.mock.calls[4][1].method).toBe("PATCH");
  });
});

describe("API Comercial - Stock y Lotes", () => {
  it("rutas de lotes, movimientos, existencias, trazabilidad y kardex", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 20, totalPages: 0 }));
    await listarLotes({ page: 1, conExistencia: "true", productoId: "p-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/lotes?page=1&conExistencia=true&productoId=p-1");

    fetchMock.mockResolvedValue(envelopeOk({}));
    await obtenerLote("lote-1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/lotes/lote-1");

    await kardex("lote-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/lotes/lote-1/kardex");

    await trazabilidad("lote-1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/lotes/lote-1/trazabilidad");

    await candidatosFefo({ productoId: "p-1", cantidad: 3 });
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/lotes/candidatos?productoId=p-1&cantidad=3");

    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 20, totalPages: 0 }));
    await listarMovimientos({ page: 1, loteId: "l-1" });
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/movimientos-stock?page=1&loteId=l-1");

    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 50, totalPages: 0 }));
    await listarExistencias({ page: 1, search: "vacuna" });
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/existencias?page=1&search=vacuna");

    fetchMock.mockResolvedValueOnce(envelopeOk({ totalValorizado: 0, productos: [] }));
    await valorizacion();
    expect(fetchMock.mock.calls[7][0]).toBe("/api/v1/existencias/valorizacion");
  });
});

describe("API Comercial - Compras", () => {
  it("flujo completo de compras con items, confirmación y anulación", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 20, totalPages: 0 }));
    await listarCompras({ page: 1, estado: "borrador" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/compras?page=1&estado=borrador");

    fetchMock.mockResolvedValue(envelopeOk({ id: "compra-1" }));
    await obtenerCompra("compra-1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/compras/compra-1");

    await crearCompra({ proveedorId: "prov-1", fecha: "2026-09-01" });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/compras");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");

    await actualizarCompra("compra-1", { observaciones: "Factura A 0001" });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/compras/compra-1");
    expect(fetchMock.mock.calls[3][1].method).toBe("PUT");

    await agregarItem("compra-1", {
      productoId: "p-1",
      cantidad: 10,
      costoUnitarioNeto: 500,
      alicuotaIva: 21,
    });
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/compras/compra-1/items");
    expect(fetchMock.mock.calls[4][1].method).toBe("POST");

    await actualizarItem("compra-1", "item-1", { cantidad: 12 });
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/compras/compra-1/items/item-1");
    expect(fetchMock.mock.calls[5][1].method).toBe("PUT");

    await quitarItem("compra-1", "item-1");
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/compras/compra-1/items/item-1");
    expect(fetchMock.mock.calls[6][1].method).toBe("DELETE");

    await confirmarCompra("compra-1");
    expect(fetchMock.mock.calls[7][0]).toBe("/api/v1/compras/compra-1/confirmar");
    expect(fetchMock.mock.calls[7][1].method).toBe("POST");

    await anularCompra("compra-1", "Error de carga");
    expect(fetchMock.mock.calls[8][0]).toBe("/api/v1/compras/compra-1/anular");
    expect(fetchMock.mock.calls[8][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[8][1].body)).toEqual({ motivo: "Error de carga" });
  });
});

describe("API Comercial - Caja", () => {
  it("operaciones de caja y sesiones", async () => {
    fetchMock.mockResolvedValue(envelopeOk({ id: "caja-1" }));
    await listarCajas();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/caja/cajas");

    await listarSesiones({ estado: "abierta" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/caja/sesiones?estado=abierta");

    await sesionActual("caja-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/caja/sesiones/actual?cajaId=caja-1");

    await obtenerSesion("ses-1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/caja/sesiones/ses-1");

    await resumenSesion("ses-1");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/caja/sesiones/ses-1/resumen");

    await abrirSesion({ cajaId: "caja-1", saldoInicial: 5000 });
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/caja/sesiones");
    expect(fetchMock.mock.calls[5][1].method).toBe("POST");

    await registrarMovimiento("ses-1", {
      tipo: "ingreso_manual",
      importe: 1000,
      medioPagoId: "mp-efectivo",
      motivo: "Cambio inicial extra",
    });
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/caja/sesiones/ses-1/movimientos");
    expect(fetchMock.mock.calls[6][1].method).toBe("POST");

    await cerrarSesion("ses-1", {
      efectivoContado: 6000,
    });
    expect(fetchMock.mock.calls[7][0]).toBe("/api/v1/caja/sesiones/ses-1/cerrar");
    expect(fetchMock.mock.calls[7][1].method).toBe("POST");
  });
});

describe("API Comercial - Ventas y normalización snake_case -> camelCase", () => {
  const rowVentaSnake = {
    id: "v-123",
    tenant_id: "t-1",
    sesion_caja_id: "ses-1",
    cliente_id: "cli-1",
    usuario_id: "usr-1",
    numero_operacion: 42,
    condicion_pago: "contado" as const,
    subtotal_neto: 826.45,
    total_iva: 173.55,
    total: 1000.0,
    saldo_pendiente: 0.0,
    estado: "registrada" as const,
    observaciones: "Nota de venta",
    created_at: "2026-09-01T10:00:00Z",
    anulada_at: null,
    anulada_motivo: null,
    items: [
      {
        id: "vi-1",
        venta_id: "v-123",
        tipo_item: "producto" as const,
        producto_id: "p-1",
        servicio_id: null,
        lote_id: "l-1",
        motivo_fefo: null,
        mascota_id: null,
        cantidad: 2,
        precio_unitario: 500.0,
        subtotal_neto: 826.45,
        alicuota_iva: 21.0,
        importe_iva: 173.55,
        total_linea: 1000.0,
        costo_unitario_historico: 300.0,
      },
    ],
    pagos: [
      {
        id: "vp-1",
        venta_id: "v-123",
        medio_pago_id: "mp-1",
        importe: 1000.0,
        referencia: "TRANSF-999",
        created_at: "2026-09-01T10:00:00Z",
      },
    ],
  };

  it("listarVentas convierte filas de snake_case a camelCase", async () => {
    fetchMock.mockResolvedValueOnce(
      envelopeOk([rowVentaSnake], { total: 1, page: 1, limit: 10, totalPages: 1 }),
    );

    const res = await listarVentas({ page: 1, limit: 10, estado: "registrada" });
    expect(res.meta.total).toBe(1);
    const venta = res.items[0];

    expect(venta.id).toBe("v-123");
    expect(venta.numeroOperacion).toBe(42);
    expect(venta.clienteId).toBe("cli-1");
    expect(venta.subtotalNeto).toBe(826.45);
    expect(venta.totalIva).toBe(173.55);
    expect(venta.total).toBe(1000);
    expect(venta.saldoPendiente).toBe(0);
    expect(venta.usuarioId).toBe("usr-1");
    expect(venta.createdAt).toBe("2026-09-01T10:00:00Z");

    const item = venta.items[0];
    expect(item.id).toBe("vi-1");
    expect(item.tipoItem).toBe("producto");
    expect(item.productoId).toBe("p-1");
    expect(item.loteId).toBe("l-1");
    expect(item.cantidad).toBe(2);
    expect(item.precioUnitario).toBe(500);
    expect(item.alicuotaIva).toBe(21);
    expect(item.importeIva).toBe(173.55);
    expect(item.totalLinea).toBe(1000);
    expect(item.costoUnitarioHistorico).toBe(300);

    const pago = venta.pagos[0];
    expect(pago.id).toBe("vp-1");
    expect(pago.medioPagoId).toBe("mp-1");
    expect(pago.importe).toBe(1000);
    expect(pago.referencia).toBe("TRANSF-999");
  });

  it("obtenerVenta convierte fila individual a camelCase", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk(rowVentaSnake));
    const venta = await obtenerVenta("v-123");
    expect(venta.numeroOperacion).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/ventas/v-123");
  });

  it("registrarVenta envía POST a /api/v1/ventas y anularVenta envía POST a /anular", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ ventaId: "v-new", numeroOperacion: 43 }));
    await registrarVenta({
      clienteId: "cli-1",
      condicionPago: "contado",
      sesionCajaId: "ses-1",
      items: [{ tipoItem: "producto", productoId: "p-1", cantidad: 1, precioUnitario: 500 }],
      pagos: [{ medioPagoId: "mp-1", importe: 500 }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/ventas");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    fetchMock.mockResolvedValueOnce(envelopeOk({ ventaId: "v-123", operacionId: "op-1", estado: "anulada", anuladaAt: "2026-09-01" }));
    await anularVenta("v-123", { motivo: "Error de facturación" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/ventas/v-123/anular");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ motivo: "Error de facturación" });
  });

  it("reportes de ventas arman paths y query strings correctos", async () => {
    fetchMock.mockResolvedValue(envelopeOk([]));
    await reporteMargen({ desde: "2026-09-01", hasta: "2026-09-05" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/ventas/reportes/margen?desde=2026-09-01&hasta=2026-09-05");

    await reporteItemsVendidos({ desde: "2026-09-01" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/ventas/reportes/items-vendidos?desde=2026-09-01");
  });
});

describe("API Comercial - Ajustes, Bloqueos, Recuentos y Devoluciones", () => {
  it("ejecuta ajustes de stock y bloqueo/desbloqueo de lote", async () => {
    fetchMock.mockResolvedValue(envelopeOk({}));
    await ajustarExistencia({
      loteId: "l-1",
      tipo: "salida_ajuste",
      cantidad: 2,
      motivo: "Rotura de frasco",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/ajustes");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    await bloquearLote("l-1", "Falla de calidad");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/lotes/l-1/bloquear");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");

    await desbloquearLote("l-1", "Aprobado por laboratorio");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/lotes/l-1/desbloquear");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");
  });

  it("recuentos físicos y devoluciones de clientes", async () => {
    fetchMock.mockResolvedValueOnce(envelopeOk({ id: "rec-1" }));
    await crearRecuento("Inventario fin de mes");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/recuentos");

    fetchMock.mockResolvedValueOnce(envelopeOk([], { total: 0, page: 1, limit: 10, totalPages: 0 }));
    await listarRecuentos({ page: 1, estado: "borrador" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/recuentos?page=1&estado=borrador");

    fetchMock.mockResolvedValue(envelopeOk({ id: "rec-1" }));
    await obtenerRecuento("rec-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/recuentos/rec-1");

    await guardarDetallesRecuento("rec-1", [{ loteId: "l-1", cantidadContada: 8 }]);
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/recuentos/rec-1/detalles");
    expect(fetchMock.mock.calls[3][1].method).toBe("PUT");

    await aplicarRecuento("rec-1");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/recuentos/rec-1/aplicar");

    await eliminarRecuento("rec-1");
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/recuentos/rec-1");
    expect(fetchMock.mock.calls[5][1].method).toBe("DELETE");

    await registrarDevolucion({
      ventaId: "v-1",
      motivo: "Devolución",
      items: [{ ventaItemId: "vi-1", cantidad: 1, revendible: true }],
    });
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/devoluciones");
  });
});

describe("API Comercial - Fraccionamiento y Consumo Clínico", () => {
  it("fraccionamiento arma rutas correspondientes", async () => {
    fetchMock.mockResolvedValue(envelopeOk({}));
    await fraccionar({
      loteOrigenId: "l-orig",
      productoDestinoId: "p-dest",
      cantidadOrigen: 1,
      cantidadObtenida: 10,
      codigoLoteDestino: "L-FRAC-1",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/fraccionamiento");

    await sugerirVencimiento({ loteOrigenId: "l-orig", productoDestinoId: "p-dest" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/fraccionamiento/sugerir-vencimiento?loteOrigenId=l-orig&productoDestinoId=p-dest");

    await historial({ page: 1 });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/fraccionamiento/historial?page=1");
  });

  it("consumo clínico arma rutas correspondientes", async () => {
    fetchMock.mockResolvedValue(envelopeOk({}));
    await registrarConsumo({
      historialId: "evt-100",
      items: [{ productoId: "p-1", loteId: "l-1", cantidad: 2 }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/consumos");

    await consumosPorEvento("evt-100");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/consumos/evento/evt-100");

    await disponibilidadConsumo("p-1");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/consumos/disponibilidad?productoId=p-1");
  });
});

describe("API Comercial - Reportes", () => {
  it("las 9 consultas de reportes arman sus endpoints exactos", async () => {
    fetchMock.mockResolvedValue(envelopeOk([]));

    await valorizacionAFecha({ productoId: "prod-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/reportes/valorizacion-fecha?productoId=prod-1");

    await rotacion({ diasSinMovimiento: 30 });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/reportes/rotacion?diasSinMovimiento=30");

    await reporteFraccionamiento({ desde: "2026-09-01" });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/reportes/fraccionamiento?desde=2026-09-01");

    await consumoProfesional({ profesionalId: "prof-1" });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/reportes/consumo-profesional?profesionalId=prof-1");

    await consumoEspecie({ especieId: "esp-1" });
    expect(fetchMock.mock.calls[4][0]).toBe("/api/v1/reportes/consumo-especie?especieId=esp-1");

    await rentabilidad({ familiaId: "fam-1" });
    expect(fetchMock.mock.calls[5][0]).toBe("/api/v1/reportes/rentabilidad?familiaId=fam-1");

    await ventasUsuario({ usuarioId: "usr-1" });
    expect(fetchMock.mock.calls[6][0]).toBe("/api/v1/reportes/ventas-usuario?usuarioId=usr-1");

    await ventasSesion({ cajaId: "caja-1" });
    expect(fetchMock.mock.calls[7][0]).toBe("/api/v1/reportes/ventas-sesion?cajaId=caja-1");

    await ventasMedioPago({ medioPagoId: "mp-1" });
    expect(fetchMock.mock.calls[8][0]).toBe("/api/v1/reportes/ventas-medio-pago?medioPagoId=mp-1");
  });
});

describe("API Comercial - Envelope y Manejo de Errores", () => {
  it("un error del envelope con success: false se convierte en ApiError con su code", async () => {
    fetchMock.mockResolvedValueOnce(
      envelopeFail("INSUFFICIENT_STOCK", "No hay stock disponible para el lote indicado", 400),
    );

    await expect(
      ajustarExistencia({ loteId: "l-1", tipo: "salida_ajuste", cantidad: 50, motivo: "Ajuste" }),
    ).rejects.toThrow(ApiError);

    fetchMock.mockResolvedValueOnce(
      envelopeFail("INSUFFICIENT_STOCK", "No hay stock disponible para el lote indicado", 400),
    );
    try {
      await ajustarExistencia({ loteId: "l-1", tipo: "salida_ajuste", cantidad: 50, motivo: "Ajuste" });
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("INSUFFICIENT_STOCK");
      expect(apiErr.statusCode).toBe(400);
      expect(apiErr.message).toBe("No hay stock disponible para el lote indicado");
    }
  });
});

describe("API Comercial - Test Anti-fuga de Tenant", () => {
  it("ninguna llamada comercial envía tenantId o tenant_id en URL o body", async () => {
    fetchMock.mockResolvedValue(
      envelopeOk([{ id: "item-1", numero_operacion: 1, items: [], pagos: [] }], {
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    // Disparamos una selección representativa de métodos GET, POST, PUT, PATCH, DELETE
    await listarProductos({ page: 1 });
    await obtenerProducto("p-1");
    await crearProducto({
      codigo: "P",
      nombre: "N",
      unidadMedidaId: "u",
      precioVenta: 10,
      costoReposicion: 5,
      alicuotaIva: 21,
      condicionVenta: "libre",
      controlaLote: false,
      controlaVencimiento: false,
      esVendible: true,
      esConsumibleClinico: false,
    });
    await actualizarProducto("p-1", { nombre: "N2" });
    await cambiarEstadoProducto("p-1", true);
    await listarProveedores();
    await crearProveedor({ razonSocial: "Prov", condicionFiscal: "consumidor_final" });
    await listarLotes();
    await kardex("l-1");
    await trazabilidad("l-1");
    await listarMovimientos();
    await listarExistencias();
    await valorizacion();
    await listarCompras();
    await crearCompra({ proveedorId: "pr-1", fecha: "2026-09-01" });
    await confirmarCompra("c-1");
    await anularCompra("c-1", "m");
    await listarCajas();
    await abrirSesion({ cajaId: "c-1", saldoInicial: 100 });
    await cerrarSesion("s-1", { efectivoContado: 100 });
    await listarVentas();
    await obtenerVenta("v-1");
    await registrarVenta({ clienteId: "cli", sesionCajaId: "s-1", condicionPago: "contado", items: [], pagos: [] });
    await anularVenta("v-1", { motivo: "m" });
    await ajustarExistencia({ loteId: "l-1", tipo: "salida_ajuste", cantidad: 1, motivo: "m" });
    await bloquearLote("l-1", "m");
    await desbloquearLote("l-1", "m");
    await crearRecuento("d");
    await guardarDetallesRecuento("r-1", []);
    await aplicarRecuento("r-1");
    await eliminarRecuento("r-1");
    await registrarDevolucion({ ventaId: "v-1", motivo: "m", items: [] });
    await fraccionar({ loteOrigenId: "l-1", productoDestinoId: "p-2", cantidadOrigen: 1, cantidadObtenida: 5, codigoLoteDestino: "L-FRAC-2" });
    await sugerirVencimiento({ loteOrigenId: "l-1", productoDestinoId: "p-2" });
    await registrarConsumo({ historialId: "e-1", items: [] });
    await consumosPorEvento("e-1");
    await disponibilidadConsumo("p-1");
    await valorizacionAFecha();
    await rotacion();
    await reporteFraccionamiento();
    await consumoProfesional();
    await consumoEspecie();
    await rentabilidad();
    await ventasUsuario();
    await ventasSesion();
    await ventasMedioPago();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(30);

    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit | undefined][]) {
      const lowerUrl = url.toLowerCase();
      expect(lowerUrl).not.toContain("tenantid");
      expect(lowerUrl).not.toContain("tenant_id");

      if (init?.body) {
        const bodyStr = String(init.body).toLowerCase();
        expect(bodyStr).not.toContain("tenantid");
        expect(bodyStr).not.toContain("tenant_id");
      }

      if (init?.headers) {
        const headersStr = JSON.stringify(init.headers).toLowerCase();
        expect(headersStr).not.toContain("tenantid");
        expect(headersStr).not.toContain("tenant_id");
      }
    }
  });
});
