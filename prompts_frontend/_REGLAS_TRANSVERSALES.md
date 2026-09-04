# Reglas transversales del frontend comercial

> Este bloque va **incrustado en cada prompt**. Está acá aparte para poder corregirlo en un
> solo lugar; el prompt de cada tanda lo repite completo.

```
SUPERFICIE CERRADA
- El backend está auditado. NINGUNA tanda de frontend agrega endpoints, toca
  supabase/functions/api/src/modules/, ni modifica RPCs ni migraciones.
- Si una pantalla necesita un endpoint, un filtro o un campo que la API no expone:
  PARÁS Y REPORTÁS. No lo agregues. No busques un rodeo que escriba en la base.
- La lista de lo disponible está en PLAN_FRONTEND_COMERCIAL.md §1. Es exhaustiva.

TENANT
- El frontend NUNCA manda un tenant_id: ni en body, ni en query, ni en params. Sale del JWT
  en el backend (o de RLS en el camino PostgREST). Si escribís "tenantId" en un request,
  está mal.

DOS CAMINOS DE DATOS, SEPARADOS
- web/src/api/comercial/*.ts  → va por la API (apiClient / apiClientList de api/client.ts).
- web/src/api/catalogos-comercial.ts → va por PostgREST directo con el JWT
  (medios_pago, unidades_medida, servicios.precio). Patrón exacto: web/src/api/catalogos.ts.
- No los mezcles en un archivo. Son dos caminos de seguridad distintos.

ENVELOPE Y ERRORES
- apiClient<T>(path) devuelve data. apiClientList<T>(path) devuelve { items, meta }.
- Los errores llegan como ApiError con .code, .statusCode, .message. Se muestran por .code,
  no por status.
- 403 MODULE_NOT_LICENSED significa que el tenant no tiene el módulo. No es un bug de la
  pantalla: se muestra el mensaje del backend.

RENDIMIENTO
- UN fetch por listado. Prohibido llamar a la API dentro de un map/for sobre un resultado
  de listado (N+1).
- Los nombres de familia y unidad se resuelven con un Map cargado UNA vez, no por fila.

ESTILO (docs/GUIA_ESTILO.md — es referencia estética, no contrato)
- Header de página: h1 + ícono lucide + text-orange-800 + descripción.
- Cards con CardHeader degradado from-orange-50 to-white. Tablas con header bg-orange-50 y
  ocultamiento progresivo de columnas (hidden md/lg/xl:table-cell).
- AlertDialog para lo destructivo/irreversible. Dialog o Sheet para formularios.
- Badges: verde activo/confirmado, rojo anulado/vencido, ámbar próximo a vencer/pendiente,
  gris inactivo, naranja primario.
- Estados vacío / cargando (Skeleton) / error (role="alert") en TODA lista y TODO detalle.
- WCAG 2.1 AA. El kit de web/src/components/ui/ es heredado: NO se reescribe.

COPY OBLIGATORIO
- numero_operacion se muestra SIEMPRE como "Operación N°". Prohibido "Comprobante N°",
  "Factura N°", "Ticket N°", "Recibo N°" en cualquier label, columna, título, toast o
  impresión. No es un comprobante fiscal.
- Glosario visible (docs/GUIA_ESTILO.md): "Tutor" en vez de "Dueño", "Pelaje" en vez de
  "Color".

PRECIO E IVA
- productos.precio_venta y servicios.precio SON el precio final con IVA incluido. Eso es lo
  que se muestra. El neto y el IVA salen por diferencia y son secundarios: van en el detalle
  de la venta, nunca en el botón del producto ni en el total del carrito.

COSTO Y MARGEN
- El margen se gatea con el permiso view_sales.
- El costo NO se renderiza en el mostrador. Es decisión de UI y NO es barrera de seguridad:
  el costo viaja en el payload bajo view_stock, que la recepcionista tiene.

TESTS
- Vitest + Testing Library, archivo Xxx.test.tsx junto al componente.
- Todo test que cubre una regla de PLAN_FRONTEND_COMERCIAL.md §2 la cita en el it().
- Se corren con: cd web && npm run test:run

DEFINICIÓN DE TERMINADO
1. npm run typecheck en verde.
2. cd web && npm run test:run en verde.
3. npm test (unit de backend) sin cambios.
4. Un solo commit: feat(comercial-fe): <qué> [F<n>·T<n>]
```
