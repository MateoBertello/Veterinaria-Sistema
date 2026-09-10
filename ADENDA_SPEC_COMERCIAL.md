# Adenda a la Especificación del Módulo Comercial

Enmiendas a `docs/ESPEC_MODULO_COMERCIAL.md` surgidas de la auditoría final del
módulo (veredicto RECHAZADO) y de las correcciones que la siguieron.

**Precedencia:** esta adenda tiene precedencia sobre la especificación base en
todo lo que redefine, del mismo modo que el Addendum v1.1 la tiene sobre el
Documento Maestro v1.0.

Cada enmienda dice qué decía la spec, qué dice ahora y por qué cambió. Ninguna
se decidió por conveniencia de implementación: las cinco salen de un defecto
concreto que la auditoría encontró y que la redacción anterior no impedía.

---

## §4.13 — Las vistas son superficie de ataque

**Decía:** §4.13 ("RLS de las tablas nuevas") fijaba RLS de solo lectura y
permisos por tabla, y §4.12 enumeraba las siete vistas de reporte sin decir nada
sobre su seguridad.

**Dice ahora — toda vista del módulo cumple las tres cosas:**

1. Se crea o se altera con `security_invoker = true`.
2. No tiene `SELECT` otorgado a `anon` ni a `authenticated`. Solo `service_role`.
3. Tiene cobertura en `tests/integration/rls.test.ts`, con el mismo criterio que
   una tabla: se siembra el tenant A y se verifica con el JWT de B que no
   devuelve ni una fila ajena.

**Por qué.** Una vista sin `security_invoker` se ejecuta con los privilegios de
su dueño —`postgres`, que tiene `BYPASSRLS`—, no con los de quien la consulta:
la RLS de las tablas de abajo **no se aplica**. Las siete vistas comerciales se
habían creado con `CREATE OR REPLACE VIEW` a secas y con `SELECT` para
`authenticated`, así que cualquier usuario logueado de cualquier clínica podía
pedirlas por PostgREST directo y leer las filas de todas las demás. No hacía
falta un bug en ningún Service: la fuga estaba en la definición de la vista.

Verificado antes de la corrección, en base limpia: las **siete** devolvieron
filas del tenant A a un JWT del tenant B.

Las dos primeras condiciones son controles distintos y los dos hacen falta. El
`security_invoker` es el de fondo: aunque mañana alguien vuelva a otorgar el
`SELECT`, no se filtra nada. El `REVOKE` cierra la superficie: estas vistas se
consumen por la API con `service_role`, y ningún JWT de usuario tiene motivo
para pedirlas.

La tercera condición es la que evita que esto vuelva a pasar sin que nadie se
entere. `rls.test.ts` probaba 30 tablas y cero vistas: una entidad fuera del
alcance del test es una entidad sin red.

**Implementación:** `20261027000001_comercial_hardening_vistas.sql`. Cobertura en
`rls.test.ts`, bloque `RLS-Vistas`.

---

## §4.4 — El libro mayor se va con la clínica

**Decía dos cosas incompatibles.** §4.4 sobre `movimientos_stock`:
*"Append-only. Sin `UPDATE`. Sin `DELETE`. Sin excepciones."* Y §4, sobre el
modelo de datos: *"Toda tabla de negocio lleva `tenant_id UUID NOT NULL
REFERENCES tenants(id) ON DELETE CASCADE` —el mismo `ON DELETE` que usan todas
las tablas del repo—."*

Las dos están en el DDL aplicado, y la segunda nunca pudo ejecutarse: el trigger
`BEFORE DELETE` gana siempre, así que el `ON DELETE CASCADE` era código muerto.

**Dice ahora:** el libro mayor es inmutable con una única excepción, la baja de
la clínica entera.

* `UPDATE`: prohibido siempre, sin excepción.
* `DELETE`: prohibido siempre **salvo** cuando la fila de `tenants` dueña del
  asiento ya no existe — es decir, la cascada de la baja del tenant, que es la
  que el propio DDL ya declaraba.
* No hay borrado por fila, por operación ni por lote, y ningún camino de la
  aplicación puede provocarlo: ningún Service ni RPC borra tenants.

Vale para los **dos** libros mayores del módulo: `movimientos_stock` y
`movimientos_caja`. La auditoría solo nombró el primero; el segundo tiene el
mismo patrón y el mismo conflicto.

**Por qué.** Con la redacción anterior, una clínica con un solo movimiento de
stock **no se podía dar de baja nunca** — ni en producción ni en los tests. El
síntoma que lo destapó fueron 168 tenants residuales acumulados en la base de
pruebas, cada uno con su cuenta de Auth huérfana rompiendo la corrida siguiente
por email duplicado. Pero el problema de fondo no es de tests: es que el sistema
no tenía forma de dar de baja a un cliente.

El argumento de D-02 —reconstrucción histórica, conciliación, "el asiento es el
dato"— vale mientras la clínica exista. Cuando se va, se lleva sus asientos: no
hay contra qué reconstruir ni a quién rendirle cuentas, y retenerlos es un
problema de datos personales, no una garantía de auditoría.

**Decidido con el dueño del producto** al aparecer el conflicto, por ser una
disyuntiva que la spec no resolvía.

**Implementación:** `20261027000003_ledger_borrado_por_baja_de_tenant.sql`. La
baja va por `dar_de_baja_tenant(p_tenant_id)`, `SECURITY DEFINER` y solo para
`service_role`.

---

## §6.11 RN-SC2 — Las FKs compuestas incluyen `(usuario_id, tenant_id)`

**Decía:** RN-SC2 exige FK compuesta con el tenant en la clave para las
referencias entre tablas del módulo. En la práctica se aplicó a producto, lote,
proveedor, cliente, sesión de caja, mascota e historial — pero **no** a las que
apuntan a `usuarios`, que quedaron como `REFERENCES usuarios(id)`.

**Dice ahora:** toda columna que referencia a un usuario desde una tabla con
`tenant_id` lleva FK compuesta `(<columna>, tenant_id) → usuarios(id, tenant_id)`.
Sin excepciones por ser "una columna reservada" o "una columna que todavía no
escribe nadie".

Son doce columnas: `lotes.usuario_id`, `movimientos_stock.usuario_id`,
`movimientos_stock.profesional_prescriptor_id`, `compras.usuario_id`,
`sesiones_caja.apertura_usuario_id`, `sesiones_caja.cierre_usuario_id`,
`movimientos_caja.usuario_id`, `ventas.usuario_id`,
`ventas.anulada_por_usuario_id`, `recuentos.usuario_id`,
`recuentos.aplicado_por_usuario_id` y `ventas_items.profesional_prescriptor_id`.

**Por qué.** Es el agujero que el CLAUDE.md describe textualmente: *"Un id que
llega en el body o en la URL no está validado por venir de una FK."* Con la FK
simple, un `usuario_id` de otra clínica entra sin que la base diga nada y queda
firmando un asiento del libro mayor, una venta o una sesión de caja — la firma
de quién hizo qué, que es justo lo que un libro mayor existe para sostener.

No era teórico: `movimientos_stock.profesional_prescriptor_id` lo escribe
`registrar_consumo_clinico` directo desde el parámetro del RPC, sin FK y sin
ninguna verificación de tenant en el Service.

**Sobre las columnas "reservadas" de D-14.** D-14 las dejó sin FK *"hasta que
exista la tabla"*, pensando en una tabla de recetas futura. Para el prescriptor
eso no aplica: la tabla que referencia hoy es `usuarios`, existe, y una de las
dos columnas ya se está escribiendo. Reservada no puede significar sin
integridad referencial cuando la referencia ya se usa.

**Implementación:** `20261027000002_comercial_fks_usuario_tenant.sql`. Regresión
en `aislamiento-api.integration.test.ts`, bloque *"Integridad cross-tenant en la
BASE"*: se inserta una fila de A firmada por el usuario de B en las doce columnas
y se exige rechazo con SQLSTATE `23503` — el código de violación de FK, no
cualquier error.

---

## §4.7 — `numero_operacion` se asigna después del descuento de stock

**Decía:** §4.7 definía el formato del identificador de operación para transacciones comerciales (ventas, compras, movimientos) generado habitualmente al inicio del procesamiento.

**Dice ahora:**
* El identificador `numero_operacion` en `ventas` es un `BIGINT` correlativo por tenant, gestionado atómicamente en la tabla `contadores_tenant` (con clave `(tenant_id, 'venta')`). La entidad `compras` no posee dicha columna.
* La asignación del número correlativo se realiza **después del bucle FEFO de descuento de stock y antes del registro de los pagos en caja**, no al final del RPC. En `20261028000003_venta_numeracion_al_final.sql`, la secuencia real es: la venta se inserta con `numero_operacion = NULL` (paso 5, líneas 285–321; por eso la línea 6 de esa misma migración le saca el `NOT NULL` a la columna), se recorren los ítems descontando stock y escribiendo `movimientos_stock` (paso 6, líneas 323–491), recién ahí se incrementa `contadores_tenant` y se hace `UPDATE ventas SET numero_operacion` (paso 7, líneas 493–505), y después se insertan `ventas_pagos` y `movimientos_caja` (paso 8, líneas 507–538), se evalúan las alertas de stock mínimo (paso 9) y se asienta la auditoría (paso 10).
* Entre la numeración y el retorno del RPC quedan validaciones que todavía pueden abortar la transacción: `VALIDATION_ERROR` si el `medioPagoId` de un pago no existe (línea 516) y `PAYMENT_REFERENCE_REQUIRED` por RN-CJ9 si falta la referencia de un medio que la exige (línea 521). La numeración **no** está después de "todas las validaciones de negocio".

**Por qué.** El motivo es acortar el tiempo de lock, y está escrito en el propio RPC: el comentario del paso 5 dice *"sin numero_operacion para no serializar"* (línea 285). El `UPDATE contadores_tenant ... SET valor = valor + 1` toma un lock de fila sobre `(tenant_id, 'venta')` que no se libera hasta el `COMMIT`; mientras esté tomado, toda otra venta del mismo tenant se serializa detrás de esa fila. El bucle FEFO es la parte cara de la transacción —`SELECT ... FOR UPDATE` sobre las existencias de cada lote (paso 3, líneas 243–253) más un `INSERT` en `movimientos_stock` por lote asignado—, así que hacer la numeración después del bucle deja el contador tomado sólo durante los pasos 7 a 10 en vez de durante toda la venta. En la versión anterior (`20260922000002_comercial_registrar_venta_rpc.sql`, paso 5, líneas 281–289) la numeración iba antes del `INSERT` de la venta y de todo el descuento de stock, y el contador quedaba bloqueado de punta a punta.

**Lo que no es el motivo.** No es evitar gaps. `contadores_tenant` es una tabla, no una `SEQUENCE`: el incremento es un `UPDATE` transaccional, así que un `RAISE` posterior lo revierte junto con el resto de la operación, esté la numeración donde esté. El RPC no tiene ningún bloque `EXCEPTION`, de modo que cualquier `RAISE` aborta la transacción entera y ni la venta ni el número sobreviven. La contigüidad la da que el contador viva en una tabla; la posición del paso 7 no compra contigüidad, compra concurrencia. (Con `nextval()` el argumento del gap sí valdría —una secuencia no revierte—, pero acá no se usa una secuencia.)

**Implementación:** `20261028000003_venta_numeracion_al_final.sql`. Cobertura en `tests/integration/ventas.integration.test.ts`.

---

## §6.3 RN-MV4 — El signo del movimiento tiene tres valores

**Decía:** RN-MV4 contemplaba únicamente dos direcciones de movimiento en `movimientos_stock`: positivo (`+1`) para entradas y negativo (`-1`) para salidas, reflejados en la columna generada `cantidad_con_signo`.

**Dice ahora:** La función `signo_movimiento()` y la regla RN-MV4 establecen **tres** valores posibles para `cantidad_con_signo`:
1. `+1` (Entradas): Incrementan el stock físico del lote (`entrada_compra`, `entrada_ajuste`, `entrada_devolucion`, `entrada_conversion`, `entrada_inicial`, `sobrante_recuento`).
2. `-1` (Salidas): Disminuyen el stock físico del lote (`salida_venta`, `salida_ajuste`, `salida_conversion`, `salida_devolucion_proveedor`, `consumo_clinico`, `merma_vencimiento`, `merma_rotura`, `faltante_recuento`).
3. `0` (Neutro): No altera la existencia física de mercadería ni la valuación contable del lote (`merma_fraccionamiento`).

**Por qué.** En el proceso de fraccionamiento de un lote padre en hijos (C6·T1), la `salida_conversion` ya descuenta la totalidad del producto padre consumido, y la `entrada_conversion` ingresa al lote hijo únicamente las unidades útiles realmente obtenidas. La diferencia entre el rendimiento teórico y el obtenido es la merma del fraccionamiento. Registrarla con signo `-1` descontaría unidades que nunca llegaron a existir físicamente en el lote hijo, resultando en existencias negativas o saldos desvirtuados. Asignarle signo neutro (`0`) permite registrar el asiento de auditoría y trazabilidad operativa en el libro mayor sin alterar las existencias de `existencias_lote`.

**Implementación:** `20261006000001_comercial_fraccionar_lote_rpc.sql`. Cobertura en `tests/integration/stock.integration.test.ts:228` (RN-MV4: verificación de los tres casos +1, -1 y 0).

---

## Nueva — Un controller test que mockea el Service no prueba el endpoint

**Decía:** La especificación no explicitaba el límite de responsabilidad entre los tests de controladores y los tests de servicios, lo que propiciaba pruebas unitarias de controllers que simulaban validar reglas de negocio (RN-xx) o constraints de base de datos a pesar de mockear el Service.

**Dice ahora:**
1. **Regla de oro de capas:** El Controller (ruta Hono) no contiene reglas de negocio. Su función se restringe a:
   - Validación sintáctica de esquemas Zod (body, query, params).
   - Verificación de contexto de tenant (`ctx.tenantId`), autenticación y permisos (`requireModule`, `requirePermission`).
   - Mapeo de parámetros y delegación al Service correspondiente (`snake_case` ↔ `camelCase`).
   - Formateo de respuesta mediante sobre estándar `ok()` o `fail()`.
2. **Alcance de los tests:**
   - Los tests de controller (`tests/unit/*.controller.test.ts`) mockean obligatoriamente el Service y prueban única y exclusivamente el transporte HTTP, la autorización y el contrato de entrada/salida.
   - Los tests de controller **no prueban ni pueden probar reglas de negocio**: un mock que simula el resultado del Service devuelve lo programado por el test, no lo que el sistema realmente computa.
   - Las reglas de negocio (RN-xx) se prueban en `tests/unit/*.service.test.ts`.
   - Las reglas que estipulan *"la base rechaza X"* se prueban contra PostgreSQL real en `tests/integration/*.integration.test.ts`.

**Por qué.** Un falso verde en un test de controller que mockea el Service oculta roturas graves en la lógica de negocio o en la base de datos. Mantener la frontera arquitectónica rigurosa asegura que cada suite valide lo que realmente le compete: transporte en controllers, lógica en services, e integridad transaccional y RLS en la base de datos.

**Implementación:** Estructura modular en `supabase/functions/api/src/modules/` y cobertura diferenciada entre suites unitarias e integrales.

---

## Deuda anotada — `movimientos_stock.mascota_id` se escribe y no se lee

`registrar_venta` y `registrar_consumo_clinico` escriben `movimientos_stock.mascota_id` (48 de 618 filas no nulas en la base de volumen) y ninguna consulta del sistema lo lee: la trazabilidad por mascota se resuelve por `v_consumo_clinico`, que proyecta `mascota_id` desde `historial_clinico.pet_id` y llega a los movimientos por `idx_mov_historial`. `idx_mov_mascota` se eliminó con razón en `20261029000001_eliminar_idx_mov_mascota_sin_consumidor.sql` —no lo usaba ningún plan—, pero queda anotado que un reporte futuro de trazabilidad por mascota que consulte `movimientos_stock` directo, en vez de la vista, quedaría sin índice. No se corrige ahora: no hay consumidor todavía.

---

## Deuda anotada — Inconsistencia de transporte en `/ventas`: snake_case vs camelCase

**Defecto de backend:**
CLAUDE.md y la arquitectura del sistema exigen que la capa Service realice siempre la normalización bidireccional entre `snake_case` (base de datos) y `camelCase` (cliente API).
Actualmente:
- `POST /ventas` devuelve `ResultadoVenta` en `camelCase` (`ventaId`, `numeroOperacion`, etc.).
- Sin embargo, `GET /ventas` y `GET /ventas/:id` devuelven filas crudas proyectadas desde PostgREST en `snake_case` (`subtotal_neto`, `total_iva`, `numero_operacion`, `items: ventas_items(*)`, `pagos: ventas_pagos(*)`).

**Parche temporal en frontend:**
Para no romper el contrato del backend auditado, el frontend implementó la normalización aislada mediante la función `toVenta(row: VentaRow): Venta` en [`web/src/api/comercial/ventas.ts`](file:///home/mateo/Veterinaria-Sistema/web/src/api/comercial/ventas.ts).
Queda documentado como deuda técnica del backend para unificar la salida de `GET /ventas` y `GET /ventas/:id` en `camelCase` directamente desde el Service, eliminando la necesidad de `toVenta()` en el cliente.

---

## Deuda anotada — `GET /caja/sesiones/:id` no devuelve la `referencia` de los movimientos

**Defecto de backend:**
`POST /caja/sesiones/:id/movimientos` acepta `referencia` (`caja.schemas.ts:25`) y la **exige** cuando el medio de pago tiene `requiere_referencia` (`caja.service.ts:270`, RN-CJ9), pero `GET /caja/sesiones/:id` no la devuelve: `mapMovimientoRow` (`caja.service.ts:135`) proyecta `id`, `sesionCajaId`, `tipo`, `medioPagoId`, `medioPago`, `importe`, `motivo`, `usuarioId` y `createdAt`, y deja afuera `referencia` aunque la consulta la traiga con `select("*")`. El dato se escribe, se guarda y no se puede leer.

**Qué hace el frontend mientras tanto:**
La tabla de movimientos de la sesión en [`web/src/pages/CajaPage.tsx`](file:///home/mateo/Veterinaria-Sistema/web/src/pages/CajaPage.tsx) **no tiene columna "Referencia"**. Antes existía, alimentada con un `(m as any).referencia` que resolvía a `undefined` y renderizaba `"—"` en todas las filas: una columna que informaba "sin referencia" justo donde el sistema había obligado al usuario a cargar una. El formulario de alta sí sigue pidiendo el dato, porque el POST lo exige.

**Por qué no se corrige ahora:**
La corrección es del backend —agregar `referencia` a `MovimientoCajaPublico` y a `mapMovimientoRow`—, y el backend del Módulo Comercial es superficie auditada y cerrada para este trabajo. Inventar el campo en el tipo del frontend no lo haría aparecer en la respuesta; sólo movería la mentira de lugar.

---

## Deuda anotada — `GET /productos` no tiene filtro `sinPrecio`

**Defecto de backend:**
`ListarProductosQuerySchema` (`productos.schemas.ts:47`) admite `search`, `familiaId`, `codigoBarras`, `activo`, `vendible`, `page` y `limit`. No hay forma de pedir al servidor sólo los productos con `precio_venta IS NULL`, que es exactamente la pregunta que hace la pantalla de carga de precios.

**Qué hace el frontend mientras tanto:**
[`CargaPreciosPage`](file:///home/mateo/Veterinaria-Sistema/web/src/pages/CargaPreciosPage.tsx) pide la lista con `limit: 100` (líneas 189 y 215) y filtra en el cliente: `productosVisibles` y `serviciosVisibles` (líneas 478 y 488) descartan las filas con precio cargado cuando el usuario activa "sólo sin precio", y las filas se marcan con `isSinPrecio` en el render (líneas 697 y 888). El filtro funciona, pero sólo sobre la página traída: con más de 100 productos, un producto sin precio que caiga fuera de la primera página no aparece aunque el filtro esté activo, y el usuario no tiene manera de saberlo.

**Por qué no se corrige ahora:**
Requiere agregar el parámetro al esquema Zod y la condición al Service del backend, superficie cerrada para este trabajo. El filtro en el cliente es un parche que no cambia el contrato.

---

## Deuda anotada — `GET /fraccionamiento/historial` no devuelve los lotes ni el usuario

**Defecto de backend:**
`FraccionamientoService.listarHistorial` (`fraccionamiento.service.ts:147`) lee la vista `v_costo_fraccionamiento`, que agrupa por `(tenant_id, operacion_id)` y proyecta productos, cantidades y costos (`20261006000002_comercial_vistas_fraccionamiento.sql`). No proyecta el **código del lote origen**, el **código del lote destino** ni el **usuario que fraccionó**, aunque `movimientos_stock` tiene las tres cosas (`lote_id`, `lote_destino_id`, `usuario_id`). Por eso `ItemHistorialFraccionamiento` (`web/src/types/comercial.ts:712`) tampoco las declara.

**Qué hace el frontend mientras tanto:**
La tabla de historial de [`FraccionamientoPage`](file:///home/mateo/Veterinaria-Sistema/web/src/pages/FraccionamientoPage.tsx) (líneas 959–971) muestra las nueve columnas que la vista sí devuelve —fecha, operación, productos origen y destino, cantidades, merma y costo unitario del hijo— y **no dibuja columnas de lote ni de usuario**, en vez de dibujarlas vacías. La trazabilidad lote a lote se sigue consultando desde la pantalla de trazabilidad del lote.

**Por qué no se corrige ahora:**
La corrección es una migración que amplíe la vista, más el mapeo en el Service: backend, superficie cerrada para este trabajo. Queda anotado que el dato existe en `movimientos_stock` y que la vista es el único punto donde se pierde.

---

## Decisión de arquitectura — No partir la Edge Function por `pdf-lib` y `xlsx`

**Propuesta evaluada:**
Partir la Edge Function monolítica de la API en dos funciones separadas (por ejemplo, `api` para la operativa diaria y una función dedicada para reportes pesados), extrayendo las librerías `pdf-lib` y `xlsx` bajo la presunción de que su peso penalizaba el arranque en frío (*cold start*) del router principal.

**Decisión tomada:**
**El corte NO se hace.** Se descarta de forma definitiva la partición de la Edge Function. Se conserva la arquitectura de función única con carga perezosa de controllers (`montarPerezoso`) e importación dinámica de librerías pesadas (`await import("pdf-lib")` / `await import("xlsx")` dentro de `buildPdf` y `buildXlsx`).

**Evidencia empírica de producción (medición del 2026-09-10, commit `e8e2740`):**
Cinco muestras consecutivas tomadas directamente en el entorno de producción con la sonda de latencia arrojaron:
* `graphBootMs`: 23.93 · 29.31 · 25.90 · 30.95 · 21.95 (mediana: **~26 ms**)
* `isolateAgeMs`: 34 a 48 ms
* `requestSeq`: 1 en las cinco muestras
* `middlewareMs`: 0.786 ms
* `handlerMs`: 0.079 ms
* `modulosCargados`: "ninguno" (en `/health`; en rutas de negocio evalúa únicamente su propio controller)

**Fundamento técnico:**
1. **El isolate se recrea en cada request:** `requestSeq` siempre 1 e `isolateAgeMs` de 34–48 ms confirman que el runtime no preserva isolates entre llamadas en el patrón de tráfico actual.
2. **El arranque del código propio insume apenas ~26 ms:**
   Todo el código de la aplicación (arranque de Hono, router raíz, middlewares de seguridad transversales y evaluación del controller demandado) suma únicamente **~27 ms**.
   Los restantes **~350 ms** hasta el total percibido por el cliente ocurren íntegramente en el gateway de la infraestructura y en el aprovisionamiento del worker por parte de Deno Deploy / Supabase, *antes* de que se ejecute la primera línea de código TypeScript de la aplicación.
3. **Relación costo-beneficio desfavorable:**
   Con un arranque propio de 26 ms, partir la función implicaría:
   - Duplicar el pipeline de CI/CD y despliegue de Edge Functions.
   - Gestionar y sincronizar un segundo juego de secrets de entorno (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, etc.).
   - Añadir una nueva entrada y configuración de CORS.
   - Manejar dos orígenes o URLs base en el cliente web o en el proxy reverso.
   Todo ese costo operativo se pagaría a cambio de arañar milisegundos imperceptibles en el arranque, sin alterar en absoluto los ~350 ms previos de la infraestructura.
4. **Desacople ya resuelto en tiempo de ejecución:**
   Tanto `pdf-lib` como `xlsx` ya se importan perezosamente dentro de sus métodos de generación (`historial.service.ts`), y la carga de controllers es diferida (`montarPerezoso`). Un request comercial estándar nunca evalúa ni compila estas librerías.

Queda asentado formalmente para descartar futuras iniciativas de partición sin nueva evidencia de infraestructura.

