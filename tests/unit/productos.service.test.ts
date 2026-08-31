import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ANTES de importar el módulo bajo prueba ────────────────────────────
vi.mock("../../supabase/functions/api/src/shared/db.ts", () => ({
  getDb: vi.fn(),
  getServiceDb: vi.fn(),
}));

vi.mock("../../supabase/functions/api/src/shared/audit.ts", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceDb } from "../../supabase/functions/api/src/shared/db.ts";
import { recordAudit } from "../../supabase/functions/api/src/shared/audit.ts";
import {
  ProductoService,
  FamiliaService,
  ConversionService,
  assertProductoOperable,
  assertProductoVendible,
} from "../../supabase/functions/api/src/modules/productos/productos.service.ts";
import { ErrorCode } from "../../supabase/functions/api/src/shared/errors.ts";

const mockGetServiceDb = vi.mocked(getServiceDb);
const mockRecordAudit = vi.mocked(recordAudit);

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PROD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNIDAD_ID_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNIDAD_ID_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctx = {
  tenantId: TENANT_ID,
  callerUserId: "22222222-2222-4222-8222-222222222222",
  callerName: "Admin Commercial",
  callerRole: "admin",
};

const dtoValido = {
  codigo: "SKU-UNIT-1",
  nombre: "Alimento Perro Adulto 15kg",
  unidadMedidaId: UNIDAD_ID_1,
  alicuotaIva: 21,
  precioVenta: 15000,
  esVendible: true,
};

function buildDbChain(overrides: {
  maybeSingleData?: unknown;
  singleData?: unknown;
  singleError?: { message: string; code?: string } | null;
  count?: number;
  data?: unknown[];
} = {}) {
  const chain: Record<string, unknown> = {};
  const defaultData = overrides.singleData ?? overrides.maybeSingleData ?? null;

  const singleFn = vi.fn().mockResolvedValue({
    data: overrides.singleData !== undefined ? overrides.singleData : defaultData,
    error: overrides.singleError ?? null,
  });
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: overrides.maybeSingleData !== undefined ? overrides.maybeSingleData : defaultData,
    error: overrides.singleError ?? null,
  });

  const rangeFn = vi.fn().mockResolvedValue({
    data: overrides.data ?? [],
    error: null,
    count: overrides.count ?? 0,
  });

  chain["from"] = vi.fn().mockReturnValue(chain);
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["insert"] = vi.fn().mockReturnValue(chain);
  chain["update"] = vi.fn().mockReturnValue(chain);
  chain["delete"] = vi.fn().mockReturnValue(chain);
  chain["eq"] = vi.fn().mockReturnValue(chain);
  chain["neq"] = vi.fn().mockReturnValue(chain);
  chain["ilike"] = vi.fn().mockReturnValue(chain);
  chain["order"] = vi.fn().mockReturnValue(chain);
  chain["range"] = rangeFn;
  chain["single"] = singleFn;
  chain["maybeSingle"] = maybeSingleFn;

  return chain;
}

describe("ProductoService & Guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RN-PR2: no existe método de borrado; la baja es lógica", async () => {
    expect((ProductoService as Record<string, unknown>).eliminar).toBeUndefined();
    expect((ProductoService as Record<string, unknown>).delete).toBeUndefined();

    const filaDb = {
      id: PROD_ID,
      tenant_id: TENANT_ID,
      codigo: "SKU-1",
      nombre: "Alimento",
      unidad_medida_id: UNIDAD_ID_1,
      activo: false,
      created_at: "2026-09-01T00:00:00Z",
    };
    const db = buildDbChain({ singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    const res = await ProductoService.cambiarEstado(PROD_ID, false, ctx);
    expect(res.activo).toBe(false);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        module: "products",
        action: "UPDATE",
        entityId: PROD_ID,
      }),
    );
  });

  it("RN-PR3: un producto inactivo no opera", async () => {
    // 1. Activo false -> lanza PRODUCT_INACTIVE
    const dbInactivo = buildDbChain({ maybeSingleData: { id: PROD_ID, activo: false } });
    mockGetServiceDb.mockReturnValue(dbInactivo as never);
    await expect(assertProductoOperable(PROD_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_INACTIVE,
      statusCode: 422,
    });

    // 2. Activo true -> no lanza
    const dbActivo = buildDbChain({ maybeSingleData: { id: PROD_ID, activo: true } });
    mockGetServiceDb.mockReturnValue(dbActivo as never);
    await expect(assertProductoOperable(PROD_ID, TENANT_ID)).resolves.toBeUndefined();

    // 3. No encontrado en tenant -> lanza PRODUCT_NOT_FOUND
    const dbNotFound = buildDbChain({ maybeSingleData: null });
    mockGetServiceDb.mockReturnValue(dbNotFound as never);
    await expect(assertProductoOperable(PROD_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("RN-PR5: la unidad no cambia si hay movimientos", async () => {
    // Producto actual tiene UNIDAD_ID_1
    const filaDb = {
      id: PROD_ID,
      tenant_id: TENANT_ID,
      codigo: "SKU-1",
      nombre: "Alimento",
      unidad_medida_id: UNIDAD_ID_1,
      activo: true,
      created_at: "2026-09-01T00:00:00Z",
    };

    // Caso 1: Hay 1 movimiento y se intenta cambiar la unidad a UNIDAD_ID_2 -> lanza UNIT_IMMUTABLE
    let callCount = 0;
    const db: Record<string, unknown> = {};
    db["from"] = vi.fn().mockReturnValue(db);
    db["select"] = vi.fn().mockImplementation((_cols, opts) => {
      if (opts?.head) {
        // consulta de movimientos_stock
        return db;
      }
      return db;
    });
    db["update"] = vi.fn().mockReturnValue(db);
    db["eq"] = vi.fn().mockReturnValue(db);
    db["neq"] = vi.fn().mockReturnValue(db);
    let isDuplicateCheck = false;
    db["ilike"] = vi.fn().mockImplementation(() => {
      isDuplicateCheck = true;
      return db;
    });
    db["single"] = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({ data: filaDb, error: null });
    });
    db["maybeSingle"] = vi.fn().mockImplementation(() => {
      if (isDuplicateCheck) {
        isDuplicateCheck = false;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: filaDb, error: null });
    });

    // Mock count = 1 para movimientos
    const countFn = vi.fn().mockResolvedValue({ count: 1, error: null });
    mockGetServiceDb.mockReturnValue({
      ...db,
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "movimientos_stock") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: countFn,
              }),
            }),
          };
        }
        return db;
      }),
    } as never);

    await expect(
      ProductoService.actualizar(PROD_ID, { unidadMedidaId: UNIDAD_ID_2 }, ctx),
    ).rejects.toMatchObject({
      code: ErrorCode.UNIT_IMMUTABLE,
      statusCode: 409,
    });

    // Caso 2: Misma unidad (UNIDAD_ID_1) con movimientos (count = 1) -> permite la edición
    await expect(
      ProductoService.actualizar(PROD_ID, { unidadMedidaId: UNIDAD_ID_1, nombre: "Nuevo Nombre" }, ctx),
    ).resolves.toBeDefined();

    // Caso 3: Sin movimientos (count = 0) y cambio de unidad a UNIDAD_ID_2 -> funciona
    countFn.mockResolvedValueOnce({ count: 0, error: null });
    await expect(
      ProductoService.actualizar(PROD_ID, { unidadMedidaId: UNIDAD_ID_2 }, ctx),
    ).resolves.toBeDefined();
  });

  it("RN-PR9: un producto sin precio no se vende", async () => {
    const db = buildDbChain({
      maybeSingleData: { id: PROD_ID, activo: true, es_vendible: true, precio_venta: null },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(assertProductoVendible(PROD_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_WITHOUT_PRICE,
      statusCode: 422,
    });
  });

  it("RN-PR10: un producto no vendible no se vende", async () => {
    const db = buildDbChain({
      maybeSingleData: { id: PROD_ID, activo: true, es_vendible: false, precio_venta: 100 },
    });
    mockGetServiceDb.mockReturnValue(db as never);

    await expect(assertProductoVendible(PROD_ID, TENANT_ID)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_NOT_SELLABLE,
      statusCode: 422,
    });
  });

  it("RN-PR1: el código duplicado se rechaza con 409", async () => {
    // 1. Pre-query encuentra código
    const dbPre = buildDbChain({ maybeSingleData: { id: "otro-id", codigo: "SKU-UNIT-1" } });
    mockGetServiceDb.mockReturnValue(dbPre as never);

    await expect(ProductoService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_CODE_DUPLICATE,
      statusCode: 409,
    });

    // 2. Pre-query no encuentra pero INSERT da 23505 en codigo
    const dbDbErr = buildDbChain({
      maybeSingleData: null,
      singleError: { message: "duplicate key value violates unique constraint uq_productos_tenant_codigo", code: "23505" },
    });
    mockGetServiceDb.mockReturnValue(dbDbErr as never);

    await expect(ProductoService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_CODE_DUPLICATE,
      statusCode: 409,
    });
  });

  it("RN-PR12: el nombre duplicado se rechaza con 409", async () => {
    // 1. Pre-query encuentra nombre
    let call = 0;
    const dbPre: Record<string, unknown> = {};
    dbPre["from"] = vi.fn().mockReturnValue(dbPre);
    dbPre["select"] = vi.fn().mockReturnValue(dbPre);
    dbPre["eq"] = vi.fn().mockReturnValue(dbPre);
    dbPre["ilike"] = vi.fn().mockReturnValue(dbPre);
    dbPre["maybeSingle"] = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ data: null, error: null }); // codigo check ok
      return Promise.resolve({ data: { id: "otro-id", nombre: dtoValido.nombre }, error: null }); // nombre check colisiona
    });
    mockGetServiceDb.mockReturnValue(dbPre as never);

    await expect(ProductoService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_NAME_DUPLICATE,
      statusCode: 409,
    });

    // 2. Pre-query no encuentra pero INSERT da 23505 en nombre
    const dbDbErr = buildDbChain({
      maybeSingleData: null,
      singleError: { message: "duplicate key value violates unique constraint uq_productos_tenant_nombre_activo", code: "23505" },
    });
    mockGetServiceDb.mockReturnValue(dbDbErr as never);

    await expect(ProductoService.crear(dtoValido, ctx)).rejects.toMatchObject({
      code: ErrorCode.PRODUCT_NAME_DUPLICATE,
      statusCode: 409,
    });
  });

  it("RN-SC5: toda escritura deja asiento con module products", async () => {
    const filaDb = {
      id: PROD_ID,
      tenant_id: TENANT_ID,
      codigo: "SKU-1",
      nombre: "Alimento",
      unidad_medida_id: UNIDAD_ID_1,
      activo: true,
      created_at: "2026-09-01T00:00:00Z",
    };

    const db = buildDbChain({ maybeSingleData: null, singleData: filaDb });
    mockGetServiceDb.mockReturnValue(db as never);

    await ProductoService.crear(dtoValido, ctx);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ module: "products", action: "CREATE" }),
    );

    mockRecordAudit.mockClear();

    // Si falla el INSERT, no se llama recordAudit
    const dbFail = buildDbChain({
      maybeSingleData: null,
      singleError: { message: "DB Error", code: "50000" },
    });
    mockGetServiceDb.mockReturnValue(dbFail as never);

    await expect(ProductoService.crear(dtoValido, ctx)).rejects.toThrow();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  describe("C6·T2: ProductoService.crearDerivado (Plantilla y Conversión)", () => {
    it("hereda atributos del padre y crea producto + conversión", async () => {
      const padreDb = {
        id: PROD_ID,
        tenant_id: TENANT_ID,
        codigo: "PADRE-1",
        nombre: "Bolsa 15kg",
        descripcion: "Alimento balanceado",
        familia_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        unidad_medida_id: UNIDAD_ID_1,
        marca: "Premium Dog",
        alicuota_iva: 21,
        condicion_venta: "libre",
        controla_lote: true,
        controla_vencimiento: true,
        vida_util_post_apertura_dias: 60,
        precio_venta: 45000,
        es_vendible: true,
        es_consumible_clinico: false,
        requiere_frio: false,
        trazable: false,
        activo: true,
      };

      const hijoDb = {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        tenant_id: TENANT_ID,
        codigo: "HIJO-1",
        nombre: "Suelto por kg",
        descripcion: "Alimento balanceado",
        familia_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        unidad_medida_id: UNIDAD_ID_2,
        marca: "Premium Dog",
        alicuota_iva: 21,
        condicion_venta: "libre",
        controla_lote: true,
        controla_vencimiento: true,
        vida_util_post_apertura_dias: 30, // sobreescrito en el DTO
        precio_venta: 3500,
        costo_reposicion: null,
        margen_objetivo: null,
        stock_minimo: 10,
        es_vendible: true,
        es_consumible_clinico: false,
        requiere_frio: false,
        trazable: false,
        activo: true,
        created_at: "2026-10-06T00:00:00Z",
        updated_at: "2026-10-06T00:00:00Z",
      };

      const convDb = {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        tenant_id: TENANT_ID,
        producto_origen_id: PROD_ID,
        producto_destino_id: hijoDb.id,
        factor_teorico: 15,
        merma_esperada_porcentaje: 5,
        activo: true,
        created_at: "2026-10-06T00:00:00Z",
      };

      let callCount = 0;
      const db = buildDbChain();
      db["maybeSingle"] = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: padreDb, error: null }); // get padre
        if (callCount === 2) return Promise.resolve({ data: null, error: null }); // check codigo hijo
        if (callCount === 3) return Promise.resolve({ data: null, error: null }); // check nombre hijo
        return Promise.resolve({ data: null, error: null });
      });

      let insertCount = 0;
      db["single"] = vi.fn().mockImplementation(() => {
        insertCount++;
        if (insertCount === 1) return Promise.resolve({ data: hijoDb, error: null }); // insert producto hijo
        if (insertCount === 2) return Promise.resolve({ data: convDb, error: null }); // insert conversion
        return Promise.resolve({ data: null, error: null });
      });

      mockGetServiceDb.mockReturnValue(db as never);

      const dtoDerivado = {
        codigo: "HIJO-1",
        nombre: "Suelto por kg",
        unidadMedidaId: UNIDAD_ID_2,
        factorTeorico: 15,
        mermaEsperadaPorcentaje: 5,
        precioVenta: 3500,
        vidaUtilPostAperturaDias: 30,
        stockMinimo: 10,
      };

      const resultado = await ProductoService.crearDerivado(PROD_ID, dtoDerivado, ctx);

      expect(resultado.producto.id).toBe(hijoDb.id);
      expect(resultado.producto.familiaId).toBe(padreDb.familia_id);
      expect(resultado.producto.marca).toBe(padreDb.marca);
      expect(resultado.producto.alicuotaIva).toBe(21);
      expect(resultado.producto.costoReposicion).toBeNull();
      expect(resultado.producto.precioVenta).toBe(3500);
      expect(resultado.producto.vidaUtilPostAperturaDias).toBe(30);

      expect(resultado.conversion.id).toBe(convDb.id);
      expect(resultado.conversion.factorTeorico).toBe(15);
      expect(resultado.conversion.mermaEsperadaPorcentaje).toBe(5);
    });

    it("falla si el producto padre no existe -> PRODUCT_NOT_FOUND (404)", async () => {
      const db = buildDbChain({ maybeSingleData: null });
      mockGetServiceDb.mockReturnValue(db as never);

      await expect(
        ProductoService.crearDerivado("00000000-0000-0000-0000-000000000000", {
          codigo: "HIJO-1",
          nombre: "Derivado",
          unidadMedidaId: UNIDAD_ID_2,
          factorTeorico: 10,
          mermaEsperadaPorcentaje: 0,
        }, ctx),
      ).rejects.toMatchObject({
        code: ErrorCode.PRODUCT_NOT_FOUND,
        statusCode: 404,
      });
    });

    it("falla si el producto padre está inactivo -> PRODUCT_INACTIVE (422)", async () => {
      const padreInactivo = {
        id: PROD_ID,
        tenant_id: TENANT_ID,
        activo: false,
      };
      const db = buildDbChain({ maybeSingleData: padreInactivo });
      mockGetServiceDb.mockReturnValue(db as never);

      await expect(
        ProductoService.crearDerivado(PROD_ID, {
          codigo: "HIJO-1",
          nombre: "Derivado",
          unidadMedidaId: UNIDAD_ID_2,
          factorTeorico: 10,
          mermaEsperadaPorcentaje: 0,
        }, ctx),
      ).rejects.toMatchObject({
        code: ErrorCode.PRODUCT_INACTIVE,
        statusCode: 422,
      });
    });
  });
});

