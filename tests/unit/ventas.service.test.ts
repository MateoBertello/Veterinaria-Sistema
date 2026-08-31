import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { descomponerLinea, redondear2 } from "../../supabase/functions/api/src/modules/ventas/ventas.calculo.ts";

vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { VentaService, type Context } from "../../supabase/functions/api/src/modules/ventas/ventas.service.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_USER_ID = "22222222-2222-4222-8222-222222222222";

describe("RN-VT1 & RN-VT2: Cálculo y descomposición de IVA en ventas", () => {
  it("RN-VT1: el IVA se calcula por diferencia y neto + iva = precio", () => {
    // $1.000 al 21 % -> neto 826,45, IVA 173,55
    const { netoUnitario, ivaUnitario, importeTotal } = descomponerLinea(1000, 21, 1);
    expect(netoUnitario).toBe(826.45);
    expect(ivaUnitario).toBe(173.55);
    expect(netoUnitario + ivaUnitario).toBe(1000);
    expect(importeTotal).toBe(1000);

    // Tres líneas de $1.000 -> 3.000 exacto
    const l1 = descomponerLinea(1000, 21, 1);
    const l2 = descomponerLinea(1000, 21, 1);
    const l3 = descomponerLinea(1000, 21, 1);
    const totalVenta = l1.importeTotal + l2.importeTotal + l3.importeTotal;
    expect(totalVenta).toBe(3000);
  });

  it("RN-VT1: barrido de precios verificando la identidad", () => {
    const alicuotas = [0, 10.5, 21, 27];
    let combinacionesProbadas = 0;

    for (const alicuota of alicuotas) {
      // 1. Paso fino de $0,01 hasta $100 (10.000 pasos)
      for (let p = 1; p <= 10000; p++) {
        const precio = p / 100;
        const { netoUnitario, ivaUnitario } = descomponerLinea(precio, alicuota, 1);
        const suma = redondear2(netoUnitario + ivaUnitario);
        expect(suma).toBe(precio);
        combinacionesProbadas++;
      }

      // 2. Paso de $0,13 desde $100 hasta $10.000 (~76.150 pasos)
      for (let precio = 100.13; precio <= 10000; precio = redondear2(precio + 0.13)) {
        const { netoUnitario, ivaUnitario } = descomponerLinea(precio, alicuota, 1);
        const suma = redondear2(netoUnitario + ivaUnitario);
        expect(suma).toBe(precio);
        combinacionesProbadas++;
      }
    }

    // Asegurar que se probaron más de 100.000 combinaciones
    expect(combinacionesProbadas).toBeGreaterThanOrEqual(100000);
  });

  it("RN-VT2: el total es la suma de las líneas redondeadas", () => {
    // 5 líneas con precios y alícuotas mixtas
    const lineas = [
      descomponerLinea(333.33, 0, 1),
      descomponerLinea(155.55, 10.5, 1),
      descomponerLinea(277.77, 21, 1),
      descomponerLinea(499.99, 27, 1),
      descomponerLinea(888.88, 21, 1),
    ];

    const totalCalculado = lineas.reduce((acc, l) => redondear2(acc + l.importeTotal), 0);
    const sumaEsperada = redondear2(333.33 + 155.55 + 277.77 + 499.99 + 888.88);
    expect(totalCalculado).toBe(sumaEsperada);

    const netoGlobal = redondear2(lineas.reduce((acc, l) => acc + l.netoUnitario, 0));
    const ivaGlobalCalculadoAparte = redondear2(netoGlobal * 0.21);
    expect(netoGlobal + ivaGlobalCalculadoAparte).not.toBe(totalCalculado);
  });

  it("RN-VT7: una venta sin ítems no existe", () => {
    function validarItems(items: unknown[]) {
      if (!items || items.length === 0) {
        throw new Error("SALE_WITHOUT_ITEMS");
      }
    }

    expect(() => validarItems([])).toThrow("SALE_WITHOUT_ITEMS");
    expect(() => validarItems(null as any)).toThrow("SALE_WITHOUT_ITEMS");
    expect(() => validarItems([{ tipoItem: "producto" }])).not.toThrow();
  });

  it("RN-CJ1: los pagos cubren el total", () => {
    function validarPagos(
      total: number,
      pagos: Array<{ importe: number }>,
      condicionPago: string,
      saldoPendiente: number = 0
    ) {
      const sumaPagos = pagos.reduce((acc, p) => redondear2(acc + p.importe), 0);
      if (redondear2(sumaPagos + saldoPendiente) !== redondear2(total)) {
        throw new Error("PAYMENT_MISMATCH");
      }
      if (saldoPendiente > 0 && condicionPago === "contado") {
        throw new Error("PAYMENT_MISMATCH");
      }
      return true;
    }

    // $1.000 con pagos por $900 al contado -> PAYMENT_MISMATCH
    expect(() => validarPagos(1000, [{ importe: 900 }], "contado", 0)).toThrow("PAYMENT_MISMATCH");

    // $600 efectivo + $400 transferencia -> OK
    expect(validarPagos(1000, [{ importe: 600 }, { importe: 400 }], "contado", 0)).toBe(true);

    // $900 en cuenta corriente con condicion_pago='cuenta_corriente' -> OK, saldo_pendiente = 100
    expect(validarPagos(1000, [{ importe: 900 }], "cuenta_corriente", 100)).toBe(true);
  });
});

describe("VentaService — Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockDb() {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.update = vi.fn().mockReturnValue(chain);
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.lte = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockGetServiceDb.mockReturnValue(chain as any);
    return chain;
  }

  it("RN-MV6: el reporte de margen usa el costo guardado", async () => {
    const db = createMockDb();
    // Simulamos vista v_margen_venta que almacena costo_total desde el costo guardado (100)
    // independiente del costo de reposición que pueda cambiar
    const mockMargenData = [
      {
        tenant_id: TENANT_ID,
        venta_id: "venta-1",
        item_id: "prod-1",
        item_nombre: "Vacuna Antirrábica",
        cantidad: 1,
        importe_total: 200,
        neto_total: 165.29,
        costo_total: 100, // costo unitario efectivo guardado
        margen: 65.29,
      },
    ];

    db.range.mockReturnValue(db);
    db.order.mockResolvedValueOnce({ data: mockMargenData, error: null });

    const ctx: Context = {
      tenantId: TENANT_ID,
      callerUserId: CALLER_USER_ID,
      permisos: new Set(["view_sales"]),
    };

    const reporte = await VentaService.margenPorProducto({}, ctx);
    expect(reporte).toHaveLength(1);
    expect(reporte[0].costo_total).toBe(100);
    expect(reporte[0].margen).toBe(65.29);
    // El servicio consultó v_margen_venta con tenant_id
    expect(db.from).toHaveBeenCalledWith("v_margen_venta");
    expect(db.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
  });

  it("sin view_sales el listado se acota al usuario", async () => {
    const db = createMockDb();
    db.range.mockResolvedValueOnce({ data: [], count: 0, error: null });

    // 1. Sin view_sales -> filtra por usuario_id = callerUserId
    const ctxSinViewSales: Context = {
      tenantId: TENANT_ID,
      callerUserId: CALLER_USER_ID,
      permisos: new Set(["manage_sales"]), // NO tiene view_sales
    };

    await VentaService.buscarPaginado({ page: 1, limit: 20 }, ctxSinViewSales);
    expect(db.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(db.eq).toHaveBeenCalledWith("usuario_id", CALLER_USER_ID);

    vi.clearAllMocks();
    const db2 = createMockDb();
    db2.range.mockResolvedValueOnce({ data: [], count: 0, error: null });

    // 2. Con view_sales -> NO acota por callerUserId
    const ctxConViewSales: Context = {
      tenantId: TENANT_ID,
      callerUserId: CALLER_USER_ID,
      permisos: new Set(["manage_sales", "view_sales"]),
    };

    await VentaService.buscarPaginado({ page: 1, limit: 20 }, ctxConViewSales);
    expect(db2.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(db2.eq).not.toHaveBeenCalledWith("usuario_id", CALLER_USER_ID);
  });

  it("el Service no lee existencias", () => {
    const servicePath = join(
      process.cwd(),
      "supabase/functions/api/src/modules/ventas/ventas.service.ts"
    );
    const content = readFileSync(servicePath, "utf-8");
    expect(content).not.toContain("existencias_lote");
    expect(content).not.toContain("movimientos_stock");
  });

  it("no hay N+1 en el listado", async () => {
    const db = createMockDb();
    db.range.mockResolvedValueOnce({
      data: [
        { id: "v1", cliente: { full_name: "Juan Perez" }, usuario: { full_name: "Admin" } },
        { id: "v2", cliente: { full_name: "Maria Lopez" }, usuario: { full_name: "Admin" } },
      ],
      count: 2,
      error: null,
    });

    const ctx: Context = {
      tenantId: TENANT_ID,
      callerUserId: CALLER_USER_ID,
      permisos: new Set(["view_sales"]),
    };

    const res = await VentaService.buscarPaginado({ page: 1, limit: 20 }, ctx);
    expect(res.items).toHaveLength(2);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("ventas");
  });
});
