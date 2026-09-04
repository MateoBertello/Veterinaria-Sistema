# F1 · TANDA 3 — Familias de producto y Proveedores
> **Modelo:** Gemini Flash · **Rol:** ejecución
> **Precondición:** F1·T1 en verde. F1·T2 conviene, para reusar sus piezas.

## 0. Leé estos archivos

| Archivo | Qué buscar |
|---|---|
| `PLAN_FRONTEND_COMERCIAL.md` §1.1, §1.10, §2.8 | Superficie y permisos. |
| `web/src/pages/CatalogosPage.tsx` | El molde de tabla + filtros + paginación. |
| `web/src/pages/ProductosPage.tsx` (F1·T2) | Piezas reutilizables (badges de estado, diálogo de baja). |
| `supabase/functions/api/src/modules/productos/productos.schemas.ts` | `CrearFamiliaSchema`: **solo** `nombre` y `unidadBaseId`. |
| `supabase/functions/api/src/modules/proveedores/proveedores.schemas.ts` | `CrearProveedorSchema` completo. |

## R. Reglas transversales

```
SUPERFICIE CERRADA — no se toca supabase/. Si falta algo: PARÁS Y REPORTÁS.
TENANT — el frontend NUNCA manda tenant_id.
RENDIMIENTO — un fetch por listado. Unidades por Map, cargado una vez.
ESTILO — docs/GUIA_ESTILO.md. Estados vacío/cargando/error. WCAG 2.1 AA.
PERMISOS — familias exige manage_products; proveedores exige manage_suppliers TAMBIÉN PARA
  LEER (el requirePermission está en el middleware compartido del router). El veterinario
  no puede listar proveedores.
TESTS — cd web && npm run test:run
```

## 1. Qué construir — dos pantallas separadas

Son dos rutas y dos permisos distintos, así que **no van en tabs de una misma pantalla**
(a diferencia de `CatalogosPage`, donde los tres catálogos comparten `manage_catalogs`).

### 1.1 — `web/src/pages/FamiliasPage.tsx` en `/stock/familias` (`manage_products`)

Listado con `GET /familias-producto` (`search`, `activo`, `page`, `limit`).
Columnas: nombre, **unidad base** (por `Map` desde `listarUnidadesMedida()`), estado, acciones.

Alta/edición en `Dialog` (son dos campos, no justifica un `Sheet`): `nombre` (2–100) y
`unidadBaseId` (Select, **obligatorio y sin default** — RN-PR8).

Baja lógica con `PATCH /:id/estado` y `AlertDialog`: *"«{nombre}» deja de ofrecerse al
clasificar productos nuevos. Los productos que ya la usan la siguen mostrando."* El error del
backend queda **dentro** del diálogo.

> **Por qué la unidad base importa y hay que explicarlo en la UI:** es la unidad en la que se
> compara el stock de toda la familia. Poné un texto de ayuda bajo el Select.

### 1.2 — `web/src/pages/ProveedoresPage.tsx` en `/stock/proveedores` (`manage_suppliers`)

Listado con `GET /proveedores` (`search`, `activo`, `page`, `limit`).
Columnas: razón social, nombre de fantasía (`hidden md:table-cell`), CUIT, condición fiscal
(badge), teléfono (`hidden lg:table-cell`), email (`hidden xl:table-cell`), estado, acciones.

Alta/edición en `Sheet` con todos los campos de `CrearProveedorSchema`: `razonSocial`,
`nombreFantasia`, `cuit`, `condicionFiscal` (Select con los seis valores del ENUM), `telefono`,
`email`, `direccion`, `contactoNombre`, `observaciones`, `clienteId`.

**`clienteId` es el campo delicado.** Vincula la ficha de proveedor con una de cliente cuando
son el mismo sujeto real (decisión P-10, opción A). **No las fusiona.** Va como un buscador de
clientes opcional, con texto de ayuda: *"Si este proveedor también es cliente de la clínica,
vinculá su ficha. Las dos fichas siguen siendo independientes."*

**El CUIT no se valida por dígito verificador**: el backend solo valida formato y longitud
(máx. 20). No agregues una validación que el backend no hace — rechazarías datos que la API
acepta.

Baja lógica con `AlertDialog`: *"«{razonSocial}» deja de ofrecerse al cargar compras nuevas.
Las compras ya registradas lo siguen mostrando."*

## 2. Tests obligatorios

`FamiliasPage.test.tsx`:
- Estados vacío, cargando, error.
- La unidad base sale del `Map`: cantidad de fetch constante con N filas.
- El alta **no manda** la familia sin `unidadBaseId` (RN-PR8).
- `RN §2.1: la baja pide confirmación y el error queda dentro del diálogo`.

`ProveedoresPage.test.tsx`:
- Estados vacío, cargando, error, y el caso **403** (un rol sin `manage_suppliers` ve el
  mensaje del backend, no una tabla vacía).
- El alta manda exactamente los campos del schema; los vacíos van como `null`, no como `""`.
- Un CUIT con formato raro pero dentro de 20 caracteres **se manda** (no lo bloquea el cliente).
- Ningún request lleva `tenantId`.

## 3. Prohibido

```
- Fusionar proveedor y cliente en una sola ficha. clienteId ENLAZA, no fusiona (P-10).
- Validar el dígito verificador del CUIT.
- Meter las dos pantallas en tabs de una sola ruta: son permisos distintos.
- Borrado físico. Tocar supabase/.
```

## 4. Definición de terminado

1. `npm run typecheck`. 2. `cd web && npm run test:run`. 3. `npm test` sin cambios.
4. Alta, edición y baja probadas en las dos pantallas.
5. Un commit: `feat(comercial-fe): ABM de familias y proveedores [F1·T3]`
