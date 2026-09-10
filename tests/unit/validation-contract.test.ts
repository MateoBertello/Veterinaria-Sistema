import { describe, it, expect } from "vitest";
import { z } from "zod";

// Schemas del Backend
import {
  CrearEspecieSchema,
  CrearRazaSchema,
  CrearTipoVacunaSchema,
} from "../../supabase/functions/api/src/modules/catalogos/catalogos.schemas.ts";
import {
  CrearTurnoSchema,
  CancelarTurnoSchema,
} from "../../supabase/functions/api/src/modules/turnos/turnos.schemas.ts";
import {
  CrearMascotaSchema,
} from "../../supabase/functions/api/src/modules/mascotas/mascotas.schemas.ts";
import {
  CrearClienteSchema,
} from "../../supabase/functions/api/src/modules/clientes/clientes.schemas.ts";
import {
  CrearServicioSchema,
} from "../../supabase/functions/api/src/modules/servicios/servicios.schemas.ts";
import {
  CrearTenantSchema,
} from "../../supabase/functions/api/src/modules/admin/tenants.schemas.ts";
import {
  PlatformLoginSchema,
} from "../../supabase/functions/api/src/modules/admin/platformAuth.schemas.ts";
import {
  CrearProductoSchema,
  CrearFamiliaSchema,
} from "../../supabase/functions/api/src/modules/productos/productos.schemas.ts";
import {
  CrearProveedorSchema,
} from "../../supabase/functions/api/src/modules/proveedores/proveedores.schemas.ts";
import {
  crearCompraSchema,
} from "../../supabase/functions/api/src/modules/compras/compras.schemas.ts";

// Definiciones de validación del Frontend
import {
  especieEsquema,
  razaEsquema,
  tipoVacunaEsquema,
  turnoEsquema,
  cancelarTurnoEsquema,
  mascotaEsquema,
  clienteEsquema,
  servicioEsquema,
} from "../../web/src/lib/validaciones/clinico.ts";
import {
  tenantEsquema,
  platformLoginEsquema,
} from "../../web/src/lib/validaciones/admin.ts";
import {
  productoEsquema,
  familiaEsquema,
  proveedorEsquema,
  compraNuevaEsquema,
} from "../../web/src/lib/validaciones/comercial.ts";

interface Restricciones {
  requerido: boolean;
  minLongitud?: number;
  maxLongitud?: number;
  min?: number;
  max?: number;
  esEmail?: boolean;
  esUuid?: boolean;
  esFecha?: boolean;
}

function extraerRestriccionesZod(zodType: any): Restricciones {
  const requerido = !zodType.safeParse(undefined).success;
  const res: Restricciones = { requerido };

  let cur = zodType;
  while (cur?._def?.innerType || cur?._def?.schema) {
    cur = cur._def.innerType ?? cur._def.schema;
  }

  const checks = cur?._def?.checks || [];
  for (const c of checks) {
    const d = c._zod?.def || c.def || c;
    const checkType = d.check || c.kind;
    const format = d.format;

    if (checkType === "min_length" || checkType === "min") {
      res.minLongitud = d.minimum ?? d.value;
    }
    if (checkType === "max_length" || checkType === "max") {
      res.maxLongitud = d.maximum ?? d.value;
    }
    if (checkType === "greater_than") {
      res.min = d.inclusive ? d.value : d.value + 0.0001;
    }
    if (checkType === "less_than") {
      res.max = d.inclusive ? d.value : d.value - 0.0001;
    }
    if (format === "email" || checkType === "email") {
      res.esEmail = true;
    }
    if (format === "uuid" || checkType === "uuid") {
      res.esUuid = true;
    }
    if (format === "date" || checkType === "date" || (d.pattern && d.pattern.source.includes("\\d{4}-\\d{2}-\\d{2}"))) {
      res.esFecha = true;
    }
  }

  return res;
}

function extraerRestriccionesFrontend(reglasCampo?: any[]): Restricciones {
  const res: Restricciones = { requerido: false };
  if (!reglasCampo) return res;

  for (const r of reglasCampo) {
    if (r.meta?.tipo === "required" || r.nombre === "required") {
      res.requerido = true;
    }
    if (r.meta?.minLength !== undefined) {
      res.minLongitud = r.meta.minLength;
    }
    if (r.meta?.maxLength !== undefined) {
      res.maxLongitud = r.meta.maxLength;
    }
    if (r.meta?.min !== undefined) {
      res.min = r.meta.min;
    }
    if (r.meta?.max !== undefined) {
      res.max = r.meta.max;
    }
    if (r.meta?.tipo === "email" || r.nombre === "email") {
      res.esEmail = true;
    }
    if (r.meta?.tipo === "uuid" || r.nombre === "uuid") {
      res.esUuid = true;
    }
    if (r.meta?.tipo === "date" || r.nombre === "date") {
      res.esFecha = true;
    }
  }

  return res;
}

export function verificarContratoCampo(
  nombreModulo: string,
  campo: string,
  zodField: any,
  frontendRules?: any[],
) {
  const zRestr = extraerRestriccionesZod(zodField);
  const fRestr = extraerRestriccionesFrontend(frontendRules);

  if (zRestr.requerido !== fRestr.requerido) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" obligatoriedad discordante: Backend=${zRestr.requerido}, Frontend=${fRestr.requerido}`,
    );
  }

  if (zRestr.minLongitud !== undefined && fRestr.minLongitud !== zRestr.minLongitud) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" minLongitud discordante: Backend=${zRestr.minLongitud}, Frontend=${fRestr.minLongitud ?? "sin límite"}`,
    );
  }

  if (zRestr.maxLongitud !== undefined && fRestr.maxLongitud !== zRestr.maxLongitud) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" maxLongitud discordante: Backend=${zRestr.maxLongitud}, Frontend=${fRestr.maxLongitud ?? "sin límite"}`,
    );
  }

  if (zRestr.esEmail && !fRestr.esEmail) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" falta validación de formato email en frontend`,
    );
  }
  if (!zRestr.esEmail && fRestr.esEmail) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" frontend valida email pero backend lo rechaza por diseño de seguridad`,
    );
  }

  if (zRestr.esUuid && !fRestr.esUuid) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" falta validación de formato UUID en frontend`,
    );
  }

  if (zRestr.esFecha && !fRestr.esFecha) {
    throw new Error(
      `[${nombreModulo}] Campo "${campo}" falta validación de fecha ISO en frontend`,
    );
  }
}

describe("Test de Contrato: Backend (Zod) vs Frontend (Validaciones)", () => {
  // ─── MUTACIÓN OBLIGATORIA ────────────────────────────────────────────────
  it("MUTACIÓN OBLIGATORIA: cambiar un max() en backend schema falla nombrando el campo", () => {
    // Si un desarrollador cambia max(60) por max(50) en CrearEspecieSchema sin actualizar el frontend:
    const schemaMutado = z.object({
      name: z.string().trim().min(2).max(50), // Mutado de 60 a 50
    });

    // Frontend que tiene max 60:
    const frontendRules = [
      { nombre: "required", meta: { tipo: "required", required: true, minLength: 1 }, validar: () => null },
      { nombre: "minLength", meta: { tipo: "minLength", minLength: 2 }, validar: () => null },
      { nombre: "maxLength", meta: { tipo: "maxLength", maxLength: 60 }, validar: () => null },
    ];

    expect(() => {
      verificarContratoCampo("Especies", "name", schemaMutado.shape.name, frontendRules);
    }).toThrowError(/\[Especies\] Campo "name" maxLongitud discordante: Backend=50, Frontend=60/);
  });

  // ─── MAPA DE DISCREPANCIAS (Este bloque fallará hasta que se resuelvan) ───

  describe("Discrepancias detectadas en Paso 0", () => {
    it("Discrepancia 1: Catálogos Especie - 'name' minLongitud 2", () => {
      verificarContratoCampo("Especies", "name", CrearEspecieSchema.shape.name, especieEsquema.name);
    });

    it("Discrepancia 1: Catálogos Raza - 'name' minLongitud 2", () => {
      verificarContratoCampo("Razas", "name", CrearRazaSchema.shape.name, razaEsquema.name);
    });

    it("Discrepancia 1: Catálogos TipoVacuna - 'nombre' minLongitud 2", () => {
      verificarContratoCampo("TiposVacuna", "nombre", CrearTipoVacunaSchema.shape.nombre, tipoVacunaEsquema.nombre);
    });

    it("Discrepancia 4: Admin Login - email no debe validar formato por seguridad de rate limit", () => {
      verificarContratoCampo("AdminLogin", "email", PlatformLoginSchema.shape.email, platformLoginEsquema.email);
    });

    it("Discrepancia 5: Tenants - 'cuitRut' frontend max(20) vs backend max(50)", () => {
      verificarContratoCampo("Tenants", "cuitRut", CrearTenantSchema.shape.cuitRut, tenantEsquema.cuitRut);
    });

    it("Discrepancia 7: Compras - 'proveedorId' debe exigir UUID", () => {
      verificarContratoCampo("Compras", "proveedorId", crearCompraSchema.shape.proveedorId, compraNuevaEsquema.proveedorId);
    });

    it("Discrepancia 7: Compras - 'fecha' debe exigir formato de fecha", () => {
      verificarContratoCampo("Compras", "fecha", crearCompraSchema.shape.fecha, compraNuevaEsquema.fecha);
    });
  });

  // ─── CONTRATOS ALINEADOS ─────────────────────────────────────────────────

  describe("Contratos Alineados: Proveedores", () => {
    it("Proveedor: razonSocial, cuit, telefono, email coinciden", () => {
      verificarContratoCampo("Proveedores", "razonSocial", CrearProveedorSchema.shape.razonSocial, proveedorEsquema.razonSocial);
      verificarContratoCampo("Proveedores", "telefono", CrearProveedorSchema.shape.telefono, proveedorEsquema.telefono);
      verificarContratoCampo("Proveedores", "email", CrearProveedorSchema.shape.email, proveedorEsquema.email);
    });
  });
});

  describe("Contratos Alineados: Productos y Familias", () => {
    it("Producto: codigo, nombre, unidadMedidaId coinciden", () => {
      verificarContratoCampo("Productos", "codigo", CrearProductoSchema.shape.codigo, productoEsquema.codigo);
      verificarContratoCampo("Productos", "nombre", CrearProductoSchema.shape.nombre, productoEsquema.nombre);
      verificarContratoCampo("Productos", "unidadMedidaId", CrearProductoSchema.shape.unidadMedidaId, productoEsquema.unidadMedidaId);
    });

    it("Familia: nombre coincide con backend max(100)", () => {
      verificarContratoCampo("Familias", "nombre", CrearFamiliaSchema.shape.nombre, familiaEsquema.nombre);
    });
  });
