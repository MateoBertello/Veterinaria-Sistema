import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceDb } from "../../shared/db.ts";
import { recordAudit } from "../../shared/audit.ts";
import { DomainError, ErrorCode } from "../../shared/errors.ts";
import type {
  CrearProductoDto,
  ActualizarProductoDto,
  ListarProductosQuery,
  CrearDerivadoDto,
  CrearFamiliaDto,
  ActualizarFamiliaDto,
  ListarFamiliasQuery,
  CrearConversionDto,
  ActualizarConversionDto,
  ListarConversionesQuery,
} from "./productos.schemas.ts";

export interface Context {
  tenantId:     string;
  callerUserId: string;
  callerName?:  string;
  callerRole?:  string;
}

export interface ProductoPublico {
  id:                          string;
  tenantId:                    string;
  codigo:                      string;
  nombre:                      string;
  descripcion:                 string | null;
  familiaId:                   string | null;
  unidadMedidaId:              string;
  marca:                       string | null;
  alicuotaIva:                 number;
  condicionVenta:              string;
  controlaLote:                boolean;
  controlaVencimiento:         boolean;
  vidaUtilPostAperturaDias:    number | null;
  precioVenta:                 number | null;
  costoReposicion:             number | null;
  margenObjetivo:              number | null;
  stockMinimo:                 number | null;
  esVendible:                  boolean;
  esConsumibleClinico:         boolean;
  requiereFrio:                boolean;
  trazable:                    boolean;
  codigoBarras:                string | null;
  activo:                      boolean;
  createdAt:                   string;
  updatedAt:                   string;
}

export interface FamiliaPublica {
  id:           string;
  tenantId:     string;
  nombre:       string;
  unidadBaseId: string;
  activo:       boolean;
  createdAt:    string;
}

export interface ConversionPublica {
  id:                        string;
  tenantId:                  string;
  productoOrigenId:          string;
  productoDestinoId:         string;
  factorTeorico:             number;
  mermaEsperadaPorcentaje:   number;
  activo:                    boolean;
  createdAt:                 string;
}

function toProductoPublic(r: Record<string, unknown>): ProductoPublico {
  return {
    id:                       r["id"] as string,
    tenantId:                 r["tenant_id"] as string,
    codigo:                   r["codigo"] as string,
    nombre:                   r["nombre"] as string,
    descripcion:              (r["descripcion"] as string | null) ?? null,
    familiaId:                (r["familia_id"] as string | null) ?? null,
    unidadMedidaId:           r["unidad_medida_id"] as string,
    marca:                    (r["marca"] as string | null) ?? null,
    alicuotaIva:              Number(r["alicuota_iva"]),
    condicionVenta:           r["condicion_venta"] as string,
    controlaLote:             r["controla_lote"] as boolean,
    controlaVencimiento:      r["controla_vencimiento"] as boolean,
    vidaUtilPostAperturaDias: (r["vida_util_post_apertura_dias"] as number | null) ?? null,
    precioVenta:              r["precio_venta"] != null ? Number(r["precio_venta"]) : null,
    costoReposicion:          r["costo_reposicion"] != null ? Number(r["costo_reposicion"]) : null,
    margenObjetivo:           r["margen_objetivo"] != null ? Number(r["margen_objetivo"]) : null,
    stockMinimo:              r["stock_minimo"] != null ? Number(r["stock_minimo"]) : null,
    esVendible:               r["es_vendible"] as boolean,
    esConsumibleClinico:      r["es_consumible_clinico"] as boolean,
    requiereFrio:             r["requiere_frio"] as boolean,
    trazable:                 r["trazable"] as boolean,
    codigoBarras:             (r["codigo_barras"] as string | null) ?? null,
    activo:                   r["activo"] as boolean,
    createdAt:                r["created_at"] as string,
    updatedAt:                r["updated_at"] as string,
  };
}

function toFamiliaPublic(r: Record<string, unknown>): FamiliaPublica {
  return {
    id:           r["id"] as string,
    tenantId:     r["tenant_id"] as string,
    nombre:       r["nombre"] as string,
    unidadBaseId: r["unidad_base_id"] as string,
    activo:       r["activo"] as boolean,
    createdAt:    r["created_at"] as string,
  };
}

function toConversionPublic(r: Record<string, unknown>): ConversionPublica {
  return {
    id:                      r["id"] as string,
    tenantId:                r["tenant_id"] as string,
    productoOrigenId:        r["producto_origen_id"] as string,
    productoDestinoId:       r["producto_destino_id"] as string,
    factorTeorico:           Number(r["factor_teorico"]),
    mermaEsperadaPorcentaje: Number(r["merma_esperada_porcentaje"] ?? 0),
    activo:                  r["activo"] as boolean,
    createdAt:               r["created_at"] as string,
  };
}

// ─── Guards Exportados ────────────────────────────────────────────────────────

/** RN-PR3: un producto inactivo no se vende, no se compra, no se consume y no se fracciona. */
export async function assertProductoOperable(productoId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("productos")
    .select("id, activo")
    .eq("id", productoId)
    .eq("tenant_id", tenantId) // service role: sin esto, el producto de otra clínica pasa
    .maybeSingle();

  if (!data) {
    throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado en este tenant");
  }
  if (!(data as { activo: boolean }).activo) {
    throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto está inactivo");
  }
}

/** RN-PR9 y RN-PR10: guard de vendibilidad. Lo llama el RPC de venta en C4. */
export async function assertProductoVendible(productoId: string, tenantId: string): Promise<void> {
  const db = getServiceDb();
  const { data } = await db
    .from("productos")
    .select("id, activo, es_vendible, precio_venta")
    .eq("id", productoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) {
    throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado en este tenant");
  }
  const p = data as { activo: boolean; es_vendible: boolean; precio_venta: number | null };

  if (!p.activo) {
    throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto está inactivo");
  }
  if (!p.es_vendible) {
    throw new DomainError(ErrorCode.PRODUCT_NOT_SELLABLE, 422, "El producto no es vendible al público");
  }
  if (p.precio_venta === null) {
    throw new DomainError(ErrorCode.PRODUCT_WITHOUT_PRICE, 422, "El producto no tiene precio de venta");
  }
}

// ─── ProductoService ──────────────────────────────────────────────────────────

export const ProductoService = {
  async crear(dto: CrearProductoDto, ctx: Context): Promise<ProductoPublico> {
    const db = getServiceDb();

    // RN-PR1: Pre-query de código duplicado
    const { data: codeExistente } = await db
      .from("productos")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("codigo", dto.codigo)
      .maybeSingle();

    if (codeExistente) {
      throw new DomainError(ErrorCode.PRODUCT_CODE_DUPLICATE, 409, "Ya existe un producto con ese código");
    }

    // RN-PR12: Pre-query de nombre duplicado activo
    const { data: nombreExistente } = await db
      .from("productos")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .ilike("nombre", dto.nombre)
      .eq("activo", true)
      .maybeSingle();

    if (nombreExistente) {
      throw new DomainError(ErrorCode.PRODUCT_NAME_DUPLICATE, 409, "Ya existe un producto activo con ese nombre");
    }

    const payload = {
      tenant_id:                       ctx.tenantId,
      codigo:                          dto.codigo,
      nombre:                          dto.nombre,
      descripcion:                     dto.descripcion ?? null,
      familia_id:                      dto.familiaId ?? null,
      unidad_medida_id:                dto.unidadMedidaId,
      marca:                           dto.marca ?? null,
      alicuota_iva:                    dto.alicuotaIva,
      condicion_venta:                 dto.condicionVenta,
      controla_lote:                   dto.controlaLote,
      controla_vencimiento:            dto.controlaVencimiento,
      vida_util_post_apertura_dias:    dto.vidaUtilPostAperturaDias ?? null,
      precio_venta:                    dto.precioVenta ?? null,
      costo_reposicion:                dto.costoReposicion ?? null,
      margen_objetivo:                 dto.margenObjetivo ?? null,
      stock_minimo:                    dto.stockMinimo ?? null,
      es_vendible:                     dto.esVendible,
      es_consumible_clinico:           dto.esConsumibleClinico,
      requiere_frio:                   dto.requiereFrio,
      trazable:                        dto.trazable,
      codigo_barras:                   dto.codigoBarras ?? null,
    };

    const { data, error } = await db
      .from("productos")
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        if (error.message.includes("codigo") || error.message.includes("uq_productos_tenant_codigo")) {
          throw new DomainError(ErrorCode.PRODUCT_CODE_DUPLICATE, 409, "Ya existe un producto con ese código");
        }
        if (error.message.includes("nombre") || error.message.includes("uq_productos_tenant_nombre")) {
          throw new DomainError(ErrorCode.PRODUCT_NAME_DUPLICATE, 409, "Ya existe un producto activo con ese nombre");
        }
        if (error.message.includes("barras") || error.message.includes("uq_productos_tenant_barras")) {
          throw new DomainError(ErrorCode.BARCODE_DUPLICATE, 409, "Ya existe un producto con ese código de barras");
        }
      }
      if (error?.code === "23503") {
        if (error.message.includes("familia")) {
          throw new DomainError(ErrorCode.FAMILY_NOT_FOUND, 404, "Familia no encontrada");
        }
        if (error.message.includes("unidad")) {
          throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Unidad de medida no encontrada");
        }
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al crear producto");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "CREATE",
      module:    "products",
      entityId:  data["id"] as string,
      newValues: dto as Record<string, unknown>,
    });

    return toProductoPublic(data as Record<string, unknown>);
  },

  async crearDerivado(
    padreId: string,
    dto: CrearDerivadoDto,
    ctx: Context,
  ): Promise<{ producto: ProductoPublico; conversion: ConversionPublica }> {
    const db = getServiceDb();

    // 1. Obtener producto padre
    const { data: padre, error: errPadre } = await db
      .from("productos")
      .select("*")
      .eq("id", padreId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (errPadre || !padre) {
      throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto padre no encontrado");
    }
    if (!padre.activo) {
      throw new DomainError(ErrorCode.PRODUCT_INACTIVE, 422, "El producto padre está inactivo");
    }

    // 2. Crear producto derivado heredando atributos del padre (D-06.e)
    const productoHijoPayload: CrearProductoDto = {
      codigo:                   dto.codigo,
      nombre:                   dto.nombre,
      descripcion:              dto.descripcion ?? padre.descripcion,
      familiaId:                padre.familia_id,
      unidadMedidaId:           dto.unidadMedidaId,
      marca:                    padre.marca,
      alicuotaIva:              Number(padre.alicuota_iva),
      condicionVenta:           padre.condicion_venta,
      controlaLote:             padre.controla_lote,
      controlaVencimiento:      padre.controla_vencimiento,
      vidaUtilPostAperturaDias: dto.vidaUtilPostAperturaDias ?? padre.vida_util_post_apertura_dias,
      precioVenta:              dto.precioVenta ?? null,
      costoReposicion:          null,
      margenObjetivo:           null,
      stockMinimo:              dto.stockMinimo ?? null,
      esVendible:               padre.es_vendible,
      esConsumibleClinico:      padre.es_consumible_clinico,
      requiereFrio:             padre.requiere_frio,
      trazable:                 padre.trazable,
    };

    const productoHijo = await ProductoService.crear(productoHijoPayload, ctx);

    // 3. Crear conversión padre -> hijo
    const conversion = await ConversionService.crear(
      {
        productoOrigenId:        padreId,
        productoDestinoId:       productoHijo.id,
        factorTeorico:           dto.factorTeorico,
        mermaEsperadaPorcentaje: dto.mermaEsperadaPorcentaje,
      },
      ctx,
    );

    return { producto: productoHijo, conversion };
  },

  async obtenerPorId(id: string, ctx: Context): Promise<ProductoPublico> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("productos")
      .select()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado");
    }

    return toProductoPublic(data as Record<string, unknown>);
  },

  async buscarPaginado(
    query: ListarProductosQuery,
    ctx: Context,
  ): Promise<{ items: ProductoPublico[]; total: number; page: number; limit: number }> {
    const db = getServiceDb();
    let q = db
      .from("productos")
      .select("*", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    if (query.search) {
      q = q.or(`nombre.ilike.%${query.search}%,codigo.ilike.%${query.search}%,codigo_barras.ilike.%${query.search}%`);
    }
    if (query.familiaId) {
      q = q.eq("familia_id", query.familiaId);
    }
    if (query.codigoBarras) {
      q = q.eq("codigo_barras", query.codigoBarras);
    }
    if (query.activo !== undefined) {
      q = q.eq("activo", query.activo);
    }
    if (query.vendible !== undefined) {
      q = q.eq("es_vendible", query.vendible);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await q.order("nombre", { ascending: true }).range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) => toProductoPublic(r as Record<string, unknown>));
    return { items, total: count ?? 0, page: query.page, limit: query.limit };
  },

  async actualizar(id: string, dto: ActualizarProductoDto, ctx: Context): Promise<ProductoPublico> {
    const db = getServiceDb();
    const actual = await ProductoService.obtenerPorId(id, ctx);

    if (dto.codigo && dto.codigo !== actual.codigo) {
      const { data: codeExistente } = await db
        .from("productos")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("codigo", dto.codigo)
        .neq("id", id)
        .maybeSingle();

      if (codeExistente) {
        throw new DomainError(ErrorCode.PRODUCT_CODE_DUPLICATE, 409, "Ya existe un producto con ese código");
      }
    }

    if (dto.nombre && dto.nombre !== actual.nombre) {
      const { data: nombreExistente } = await db
        .from("productos")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .ilike("nombre", dto.nombre)
        .eq("activo", true)
        .neq("id", id)
        .maybeSingle();

      if (nombreExistente) {
        throw new DomainError(ErrorCode.PRODUCT_NAME_DUPLICATE, 409, "Ya existe un producto activo con ese nombre");
      }
    }

    // RN-PR5: la unidad no cambia si hay movimientos
    if (dto.unidadMedidaId && dto.unidadMedidaId !== actual.unidadMedidaId) {
      // La tabla llega en C2·T1. Hasta entonces esta consulta no tiene contra qué correr
      // en integración; el unit test la mockea con y sin movimientos para cubrir las dos
      // ramas de RN-PR5. Mismo criterio que el guard de turnos futuros de
      // ServicioService.cambiarEstado, que se escribió en E4 con la tabla `turnos` vacía.
      const { count } = await db
        .from("movimientos_stock")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.tenantId)
        .eq("producto_id", id);

      if ((count ?? 0) > 0) {
        throw new DomainError(
          ErrorCode.UNIT_IMMUTABLE,
          409,
          "No se puede cambiar la unidad de medida de un producto que ya tiene movimientos",
        );
      }
    }

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.codigo !== undefined)                   payload["codigo"] = dto.codigo;
    if (dto.nombre !== undefined)                   payload["nombre"] = dto.nombre;
    if (dto.descripcion !== undefined)              payload["descripcion"] = dto.descripcion;
    if (dto.familiaId !== undefined)                payload["familia_id"] = dto.familiaId;
    if (dto.unidadMedidaId !== undefined)           payload["unidad_medida_id"] = dto.unidadMedidaId;
    if (dto.marca !== undefined)                    payload["marca"] = dto.marca;
    if (dto.alicuotaIva !== undefined)              payload["alicuota_iva"] = dto.alicuotaIva;
    if (dto.condicionVenta !== undefined)           payload["condicion_venta"] = dto.condicionVenta;
    if (dto.controlaLote !== undefined)             payload["controla_lote"] = dto.controlaLote;
    if (dto.controlaVencimiento !== undefined)      payload["controla_vencimiento"] = dto.controlaVencimiento;
    if (dto.vidaUtilPostAperturaDias !== undefined) payload["vida_util_post_apertura_dias"] = dto.vidaUtilPostAperturaDias;
    if (dto.precioVenta !== undefined)              payload["precio_venta"] = dto.precioVenta;
    if (dto.costoReposicion !== undefined)          payload["costo_reposicion"] = dto.costoReposicion;
    if (dto.margenObjetivo !== undefined)           payload["margen_objetivo"] = dto.margenObjetivo;
    if (dto.stockMinimo !== undefined)              payload["stock_minimo"] = dto.stockMinimo;
    if (dto.esVendible !== undefined)               payload["es_vendible"] = dto.esVendible;
    if (dto.esConsumibleClinico !== undefined)      payload["es_consumible_clinico"] = dto.esConsumibleClinico;
    if (dto.requiereFrio !== undefined)             payload["requiere_frio"] = dto.requiereFrio;
    if (dto.trazable !== undefined)                 payload["trazable"] = dto.trazable;
    if (dto.codigoBarras !== undefined)             payload["codigo_barras"] = dto.codigoBarras;

    const { data, error } = await db
      .from("productos")
      .update(payload)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        if (error.message.includes("codigo") || error.message.includes("uq_productos_tenant_codigo")) {
          throw new DomainError(ErrorCode.PRODUCT_CODE_DUPLICATE, 409, "Ya existe un producto con ese código");
        }
        if (error.message.includes("nombre") || error.message.includes("uq_productos_tenant_nombre")) {
          throw new DomainError(ErrorCode.PRODUCT_NAME_DUPLICATE, 409, "Ya existe un producto activo con ese nombre");
        }
        if (error.message.includes("barras") || error.message.includes("uq_productos_tenant_barras")) {
          throw new DomainError(ErrorCode.BARCODE_DUPLICATE, 409, "Ya existe un producto con ese código de barras");
        }
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al actualizar producto");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: actual as unknown as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
    });

    return toProductoPublic(data as Record<string, unknown>);
  },

  async cambiarEstado(id: string, activo: boolean, ctx: Context): Promise<ProductoPublico> {
    const db = getServiceDb();
    const actual = await ProductoService.obtenerPorId(id, ctx);

    if (activo && !actual.activo) {
      // Reactivar: verificar que el nombre no colisione con otro activo
      const { data: nombreColision } = await db
        .from("productos")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .ilike("nombre", actual.nombre)
        .eq("activo", true)
        .neq("id", id)
        .maybeSingle();

      if (nombreColision) {
        throw new DomainError(
          ErrorCode.PRODUCT_NAME_DUPLICATE,
          409,
          "No se puede reactivar: ya existe un producto activo con ese nombre",
        );
      }
    }

    const { data, error } = await db
      .from("productos")
      .update({ activo, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError(
          ErrorCode.PRODUCT_NAME_DUPLICATE,
          409,
          "No se puede reactivar: ya existe un producto activo con ese nombre",
        );
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al cambiar estado de producto");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: { activo: actual.activo },
      newValues: { activo },
    });

    return toProductoPublic(data as Record<string, unknown>);
  },
};

// ─── FamiliaService ───────────────────────────────────────────────────────────

export const FamiliaService = {
  async crear(dto: CrearFamiliaDto, ctx: Context): Promise<FamiliaPublica> {
    const db = getServiceDb();

    const { data: existente } = await db
      .from("familias_producto")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .ilike("nombre", dto.nombre)
      .maybeSingle();

    if (existente) {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, 409, "Ya existe una familia con ese nombre");
    }

    const { data, error } = await db
      .from("familias_producto")
      .insert({
        tenant_id:      ctx.tenantId,
        nombre:         dto.nombre,
        unidad_base_id: dto.unidadBaseId,
      })
      .select()
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 409, "Ya existe una familia con ese nombre");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al crear familia");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "CREATE",
      module:    "products",
      entityId:  data["id"] as string,
      newValues: dto as Record<string, unknown>,
    });

    return toFamiliaPublic(data as Record<string, unknown>);
  },

  async obtenerPorId(id: string, ctx: Context): Promise<FamiliaPublica> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("familias_producto")
      .select()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      throw new DomainError(ErrorCode.FAMILY_NOT_FOUND, 404, "Familia no encontrada");
    }

    return toFamiliaPublic(data as Record<string, unknown>);
  },

  async buscarPaginado(
    query: ListarFamiliasQuery,
    ctx: Context,
  ): Promise<{ items: FamiliaPublica[]; total: number; page: number; limit: number }> {
    const db = getServiceDb();
    let q = db
      .from("familias_producto")
      .select("*", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    if (query.search) {
      q = q.ilike("nombre", `%${query.search}%`);
    }
    if (query.activo !== undefined) {
      q = q.eq("activo", query.activo);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await q.order("nombre", { ascending: true }).range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) => toFamiliaPublic(r as Record<string, unknown>));
    return { items, total: count ?? 0, page: query.page, limit: query.limit };
  },

  async actualizar(id: string, dto: ActualizarFamiliaDto, ctx: Context): Promise<FamiliaPublica> {
    const db = getServiceDb();
    const actual = await FamiliaService.obtenerPorId(id, ctx);

    if (dto.nombre && dto.nombre !== actual.nombre) {
      const { data: existente } = await db
        .from("familias_producto")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .ilike("nombre", dto.nombre)
        .neq("id", id)
        .maybeSingle();

      if (existente) {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 409, "Ya existe una familia con ese nombre");
      }
    }

    const payload: Record<string, unknown> = {};
    if (dto.nombre !== undefined)       payload["nombre"] = dto.nombre;
    if (dto.unidadBaseId !== undefined) payload["unidad_base_id"] = dto.unidadBaseId;

    const { data, error } = await db
      .from("familias_producto")
      .update(payload)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al actualizar familia");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: actual as unknown as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
    });

    return toFamiliaPublic(data as Record<string, unknown>);
  },

  async cambiarEstado(id: string, activo: boolean, ctx: Context): Promise<FamiliaPublica> {
    const db = getServiceDb();
    const actual = await FamiliaService.obtenerPorId(id, ctx);

    const { data, error } = await db
      .from("familias_producto")
      .update({ activo })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al cambiar estado de familia");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: { activo: actual.activo },
      newValues: { activo },
    });

    return toFamiliaPublic(data as Record<string, unknown>);
  },
};

// ─── ConversionService ────────────────────────────────────────────────────────

export const ConversionService = {
  async crear(dto: CrearConversionDto, ctx: Context): Promise<ConversionPublica> {
    const db = getServiceDb();

    const { data, error } = await db
      .from("producto_conversiones")
      .insert({
        tenant_id:                  ctx.tenantId,
        producto_origen_id:         dto.productoOrigenId,
        producto_destino_id:        dto.productoDestinoId,
        factor_teorico:             dto.factorTeorico,
        merma_esperada_porcentaje:  dto.mermaEsperadaPorcentaje,
      })
      .select()
      .single();

    if (error || !data) {
      if (error?.message?.includes("CONVERSION_CYCLE") || error?.code === "P0001") {
        throw new DomainError(
          ErrorCode.CONVERSION_CYCLE,
          409,
          "La conversión generaría un ciclo en el árbol de fraccionamiento",
        );
      }
      if (error?.code === "23505") {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 409, "Ya existe una conversión entre estos productos");
      }
      if (error?.code === "23503") {
        throw new DomainError(ErrorCode.PRODUCT_NOT_FOUND, 404, "Producto no encontrado");
      }
      if (error?.code === "23514") {
        throw new DomainError(ErrorCode.VALIDATION_ERROR, 422, "Conversión inválida o autorreferencial");
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al crear conversión");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "CREATE",
      module:    "products",
      entityId:  data["id"] as string,
      newValues: dto as Record<string, unknown>,
    });

    return toConversionPublic(data as Record<string, unknown>);
  },

  async obtenerPorId(id: string, ctx: Context): Promise<ConversionPublica> {
    const db = getServiceDb();
    const { data, error } = await db
      .from("producto_conversiones")
      .select()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      throw new DomainError(ErrorCode.CONVERSION_NOT_FOUND, 404, "Conversión no encontrada");
    }

    return toConversionPublic(data as Record<string, unknown>);
  },

  async buscarPaginado(
    query: ListarConversionesQuery,
    ctx: Context,
  ): Promise<{ items: ConversionPublica[]; total: number; page: number; limit: number }> {
    const db = getServiceDb();
    let q = db
      .from("producto_conversiones")
      .select("*", { count: "exact" })
      .eq("tenant_id", ctx.tenantId);

    if (query.productoOrigenId) {
      q = q.eq("producto_origen_id", query.productoOrigenId);
    }
    if (query.activo !== undefined) {
      q = q.eq("activo", query.activo);
    }

    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, to);

    if (error) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error.message);
    }

    const items = ((data as unknown[]) ?? []).map((r) => toConversionPublic(r as Record<string, unknown>));
    return { items, total: count ?? 0, page: query.page, limit: query.limit };
  },

  async actualizar(id: string, dto: ActualizarConversionDto, ctx: Context): Promise<ConversionPublica> {
    const db = getServiceDb();
    const actual = await ConversionService.obtenerPorId(id, ctx);

    const payload: Record<string, unknown> = {};
    if (dto.productoOrigenId !== undefined)        payload["producto_origen_id"] = dto.productoOrigenId;
    if (dto.productoDestinoId !== undefined)       payload["producto_destino_id"] = dto.productoDestinoId;
    if (dto.factorTeorico !== undefined)           payload["factor_teorico"] = dto.factorTeorico;
    if (dto.mermaEsperadaPorcentaje !== undefined) payload["merma_esperada_porcentaje"] = dto.mermaEsperadaPorcentaje;

    const { data, error } = await db
      .from("producto_conversiones")
      .update(payload)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      if (error?.message?.includes("CONVERSION_CYCLE") || error?.code === "P0001") {
        throw new DomainError(
          ErrorCode.CONVERSION_CYCLE,
          409,
          "La conversión generaría un ciclo en el árbol de fraccionamiento",
        );
      }
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al actualizar conversión");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: actual as unknown as Record<string, unknown>,
      newValues: dto as Record<string, unknown>,
    });

    return toConversionPublic(data as Record<string, unknown>);
  },

  async cambiarEstado(id: string, activo: boolean, ctx: Context): Promise<ConversionPublica> {
    const db = getServiceDb();
    const actual = await ConversionService.obtenerPorId(id, ctx);

    const { data, error } = await db
      .from("producto_conversiones")
      .update({ activo })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new DomainError(ErrorCode.INTERNAL_ERROR, 500, error?.message ?? "Error al cambiar estado de conversión");
    }

    await recordAudit(db as unknown as SupabaseClient, {
      tenantId:  ctx.tenantId,
      userId:    ctx.callerUserId,
      userName:  ctx.callerName ?? null,
      userRole:  ctx.callerRole ?? null,
      action:    "UPDATE",
      module:    "products",
      entityId:  id,
      oldValues: { activo: actual.activo },
      newValues: { activo },
    });

    return toConversionPublic(data as Record<string, unknown>);
  },
};
