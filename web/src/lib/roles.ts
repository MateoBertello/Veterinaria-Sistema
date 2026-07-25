/**
 * roles.ts — metadatos visuales de los roles (badge y etiqueta), adaptado del
 * ROLE_META de la UI de referencia. Es presentación pura: el color se elige por
 * el `name` de máquina del rol (admin | veterinario | …); la etiqueta real la
 * manda el `displayName`/`rolName` que devuelve el backend. Un rol desconocido
 * cae en el estilo neutro por defecto.
 */

export interface RolMeta {
  displayName: string;
  /** Clases del Badge (color estable en hover, como el resto del kit). */
  badgeClass:  string;
  description: string;
}

export const ROLE_META: Record<string, RolMeta> = {
  admin: {
    displayName: "Administrador",
    badgeClass:  "bg-orange-100 text-orange-800 hover:bg-orange-100",
    description: "Acceso completo al sistema",
  },
  veterinario: {
    displayName: "Veterinario",
    badgeClass:  "bg-blue-100 text-blue-800 hover:bg-blue-100",
    description: "Gestión clínica y de turnos",
  },
  recepcionista: {
    displayName: "Recepcionista",
    badgeClass:  "bg-green-100 text-green-800 hover:bg-green-100",
    description: "Atención al cliente y agenda",
  },
  peluquero: {
    displayName: "Peluquero",
    badgeClass:  "bg-purple-100 text-purple-800 hover:bg-purple-100",
    description: "Servicios de peluquería",
  },
};

const META_POR_DEFECTO: RolMeta = {
  displayName: "",
  badgeClass:  "bg-gray-100 text-gray-800 hover:bg-gray-100",
  description: "",
};

/** Metadatos visuales de un rol por su `name` de máquina (con fallback neutro). */
export function getRolMeta(name: string | undefined | null): RolMeta {
  return (name && ROLE_META[name]) || META_POR_DEFECTO;
}
