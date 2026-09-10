import {
  email,
  enValores,
  maxLongitud,
  minLongitud,
  regex,
  requerido,
} from "./reglas.ts";
import type { EsquemaValidacion } from "./types.ts";

export interface TenantFormValues {
  nombre: string;
  cuitRut: string;
  emailContacto: string;
  plan: "basico" | "profesional" | "premium";
}

// Discrepancia identificada en inventario: cuitRut max 20 en frontend vs max 50 en backend
export const tenantEsquema: EsquemaValidacion<TenantFormValues> = {
  nombre: [
    requerido("El nombre es requerido"),
    minLongitud(3, "El nombre debe tener al menos 3 caracteres"),
    maxLongitud(120, "Máximo 120 caracteres"),
  ],
  cuitRut: [
    requerido("El CUIT/RUT es requerido"),
    // Discrepancia: Frontend restringe a max 20, backend tiene max 50
    maxLongitud(20, "Máximo 20 caracteres"),
  ],
  emailContacto: [
    requerido("El email de contacto es requerido"),
    email("Formato de email inválido"),
  ],
  plan: [
    requerido("El plan es requerido"),
    enValores(["basico", "profesional", "premium"]),
  ],
};

export interface PlatformLoginFormValues {
  email: string;
  password: string;
}

export const platformLoginEsquema: EsquemaValidacion<PlatformLoginFormValues> = {
  email: [
    requerido("El email es requerido"),
    // No se valida formato email por seguridad: cualquier identificador viaja al backend y cuenta para rate limit
  ],
  password: [
    requerido("La contraseña es requerida"),
  ],
};
