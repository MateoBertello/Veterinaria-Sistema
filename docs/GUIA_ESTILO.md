# Referencia UI — Reconciliada con v1.1 \+ backend construido

⚠️ **Referencia ESTÉTICA y de LAYOUT, no contrato.**

## 0\. Patrones globales (sin cambios estéticos)

Se mantiene todo lo del prototipo: header de página (h1 \+ ícono lucide \+ `text-orange-800` \+ descripción), botones de export Excel (outline verde) / PDF (sólido naranja), cards con `CardHeader` degradado `from-orange-50 to-white`, tabs con `bg-orange-50`, tablas con header `bg-orange-50` y ocultamiento progresivo de columnas (`hidden md/lg/xl:table-cell`), `AlertDialog` para destructivo / `Dialog` para forms cortos, estados vacíos e iconografía.

**Semántica de badges:**

| Color | Significado |
| :---- | :---- |
| Naranja | Marca/primario, acción principal, clínica |
| Verde | Éxito, confirmado, activo, completado |
| Azul | Informativo, email |
| Rojo | Destructivo, cancelado, vencido, emergencia |
| Ámbar/Amarillo | Advertencia, pendiente, próximo a vencer |
| Gris | Neutral, inactivo, "Fallecida", deshabilitado |
| Púrpura | Categoría secundaria / eventos especiales |

### Cambios vs prototipo

- **Púrpura**: era "peluquería"; con el rol Peluquero eliminado del sistema, queda solo como "categoría secundaria / eventos especiales".  
- **Gris**: el ejemplo "Baja" se reemplaza por "Fallecida" (valor real del ENUM `estado_mascota`).

## Glosario de términos visibles

Estos términos aplican solo al copy visible en la UI (labels, columnas, placeholders, toasts). No renombran props, DTOs, columnas de base, enums, códigos de error ni rutas de API — esos siguen usando el término original.

| Término visible | Reemplaza a | Alcance |
| :---- | :---- | :---- |
| Pelaje | Color | Todo el sistema (campo `color` de Mascota) |
| Tutor | Dueño | Todo el sistema (relación cliente↔mascota) |
| Huésped | Mascota | Solo dentro de Guardería (OcupacionMes, OcupacionDia, RegistrarEstadiaPage). El resto del sistema —Mascotas, Historial Clínico, sidebar— sigue diciendo "mascota". |
