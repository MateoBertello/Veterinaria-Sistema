# MATRIZ_RN_TESTS_COMERCIAL.md — Módulo Comercial

**Esqueleto generado por la sesión de planificación.** Todas las filas nacen en `PENDIENTE` y
se van llenando tanda por tanda: **cada prompt de ejecución termina agregando las filas de sus
RN a este archivo**, con el estado real y la ruta del test que las cubre.

**Formato de la fila**, siguiendo `docs/MATRIZ_RN_TESTS.md`:

| Símbolo | Significado |
|---|---|
| `PENDIENTE` | Todavía no se escribió el test. |
| ✅ | Test escrito, cita el código RN en el título del `it()` y **pasa**. |
| ❌ | Test escrito y **falla**. Bloquea el cierre de la tanda. |
| `N/A` | Fuera del alcance de esta tanda de planificación. |

**Regla de nombre del test**, según `CLAUDE.md`: el título del `it()` empieza con el código
RN. Ejemplo: `it('RN-FR7: el costo del hijo se calcula sobre lo realmente obtenido', …)`.

**Alcance:** C1 a C8, las 90 RN.

**Las cinco filas RN-CC arrancan en `N/A` a propósito, y las activa la tanda C7·T1**, no antes.
Motivo concreto: los controles de cierre de C6·T4 cuentan exactamente cinco filas en `N/A` y
ninguna pendiente, y adelantar el cambio los rompería sin que nada haya salido mal. Mientras C7
no arranque, esas cinco RN efectivamente no están en el alcance de ninguna tanda en curso.

---

## Resumen

| Grupo | RN | Etapas | En alcance |
|---|:-:|---|:-:|
| RN-PR — Productos, familias y unidades | 12 | C1 | 12 |
| RN-PRV — Proveedores | 3 | C1 | 3 |
| RN-MV — Movimientos y existencias | 12 | C2 | 12 |
| RN-LO — Lotes, vencimiento y FEFO | 8 | C2, C4 | 8 |
| RN-CM — Compras | 5 | C2 | 5 |
| RN-VT — Ventas e IVA | 8 | C4 | 8 |
| RN-CJ — Caja | 9 | C3, C4 | 9 |
| RN-FR — Fraccionamiento | 13 | C1, C6 | 13 |
| RN-AJ — Ajustes, mermas, recuento y devoluciones | 7 | C5 | 7 |
| RN-CC — Consumo clínico y trazabilidad | 5 | C7 | 5 |
| RN-SC — Seguridad, permisos, auditoría y concurrencia | 8 | C1, C4 | 8 |
| **Total** | **90** | | **90** |

| Estado al corte de la planificación | Cantidad |
|---|:-:|
| ✅ con test que pasa | 39 |
| `PENDIENTE` | 46 |
| `N/A` — se activan en C7·T1 | 5 |

---

## RN-PR — Productos, familias y unidades (C1)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-PR1 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Código duplicado en un tenant falla; el mismo código en dos tenants funciona. |
| RN-PR2 | C1·T4 | ✅ | `tests/unit/productos.service.test.ts` | Borrar un producto no existe en API; la baja es lógica (cambiarEstado). |
| RN-PR3 | C1·T4 | ✅ | `tests/unit/productos.service.test.ts` | Producto inactivo rechazado en toda operación (assertProductoOperable); su historial sigue consultable. |
| RN-PR4 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Alta con alícuota 15,00 viola el CHECK. |
| RN-PR5 | C1·T4 | ✅ | `tests/unit/productos.service.test.ts` | Con un movimiento, el cambio de unidad falla; sin movimientos, se permite. |
| RN-PR6 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | `cantidad_valida_para_unidad()`: 1,5 comprimidos `false`; 1,5 kg `true`. Su aplicación en cada camino de escritura se reverifica en C2, C4, C5 y C6. |
| RN-PR7 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Escala 4 falla; `admite_decimales=false` con escala 2 falla. |
| RN-PR8 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Alta de familia sin `unidad_base_id` falla por NOT NULL. |
| RN-PR9 | C1·T4 | ✅ | `tests/unit/productos.service.test.ts` | Guard de producto sin `precio_venta` (assertProductoVendible). Se reverifica en la venta real en C4·T2. |
| RN-PR10 | C1·T4 | ✅ | `tests/unit/productos.service.test.ts` | Guard de `es_vendible = false` (assertProductoVendible). Se reverifica en C4·T2. |
| RN-PR11 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Dos productos con el mismo código de barras falla; varios con `NULL` funciona. |
| RN-PR12 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Dos productos activos con el mismo nombre falla → `PRODUCT_NAME_DUPLICATE` (resolución 0.4). |

## RN-PRV — Proveedores (C1)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-PRV1 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Razón social duplicada falla; mismo CUIT en otro tenant funciona. |
| RN-PRV2 | C1·T5 | ✅ | `tests/unit/proveedores.service.test.ts` | Desactivar y crear compra falla. Se reverifica en C2·T3. |
| RN-PRV3 | C1·T5 | ✅ | `tests/integration/compras.integration.test.ts` | Borrar un proveedor con una compra confirmada falla **por FK**. Se cierra en C2·T3. |

## RN-MV — Movimientos y existencias (C2)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-MV1 | C2·T5 | PENDIENTE | `tests/unit/stock-ledger-guardrail.test.ts` | Guardrail estático: ningún `.from("existencias_lote").update(` ni `.insert(` en `src/modules/`. |
| RN-MV2 | C2·T1 | ✅ | `tests/integration/stock.integration.test.ts` | Con el cliente `service_role`, `.update()` y `.delete()` sobre un movimiento devuelven `MOVEMENT_IMMUTABLE`. |
| RN-MV3 | C2·T1 | ✅ | `tests/integration/stock.integration.test.ts` | Insertar cantidad 0 o negativa viola el CHECK. |
| RN-MV4 | C2·T1 | ✅ | `tests/integration/stock.integration.test.ts` | `entrada_compra` da signo `+`, `salida_venta` da `−`; la columna generada no se puede escribir. |
| RN-MV5 | C2·T1 | ✅ | `tests/integration/stock.integration.test.ts` | Forzar existencia negativa por PostgREST viola el CHECK de `existencias_lote`. La validación bajo bloqueo se cierra en C4·T2. |
| RN-MV6 | C2·T4 | ✅ | `tests/unit/stock.service.test.ts` | Cambiar `costo_reposicion` no altera `movimientos_stock.costo_unitario` ya registrado. |
| RN-MV7 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Fallo a mitad de `confirmar_compra`: no queda ni el lote ni el movimiento. Se reverifica en C6·T1. |
| RN-MV8 | C2·T1 | ✅ | `tests/integration/stock.integration.test.ts` | `salida_venta` sin `venta_item_id` falla; `entrada_compra` con `venta_item_id` falla. |
| RN-MV9 | C2·T4 | ✅ | `tests/integration/compras.integration.test.ts` | La anulación genera movimientos nuevos y no borra los originales. |
| RN-MV10 | C2·T5 | PENDIENTE | `tests/unit/stock-ledger-guardrail.test.ts` | Guardrail estático: ninguna ruta de aplicación escribe `existencias_lote`. |
| RN-MV11 | C2·T2 | ✅ | `tests/integration/stock.integration.test.ts` | Adulterar la caché con `service_role`, `verificar_existencias` lo reporta, `recalcular_existencias` la reconstruye. **Es el test que justifica la caché (D-02).** |
| RN-MV12 | C2·T2 | ✅ | `tests/integration/stock.integration.test.ts` | 200 movimientos variados, recalcular, comparar fila por fila: sin diferencias. |

## RN-LO — Lotes, vencimiento y FEFO (C2, C4)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-LO1 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Dos compras del lote "L-993" a $100 y $130 producen dos filas con sus costos. |
| RN-LO2 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Confirmar compra sin fecha de vencimiento, con `controla_vencimiento`, falla. |
| RN-LO3 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Comprar y vender sin control de lote funciona sin pedir lote y genera `lote_id` no nulo. |
| RN-LO4 | C2·T4 | ✅ | `tests/unit/stock.service.test.ts` | Lote vencido rechazado **para los tres roles, incluido admin**. Se reverifica en C4·T2 and C6·T1. |
| RN-LO5 | C2·T4 | ✅ | `tests/unit/stock.service.test.ts` | 2026-01, 2026-03 y `NULL` → sugiere enero; dos de igual vencimiento dan orden estable. |
| RN-LO6 | C4·T2 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Sin motivo falla; con motivo, el movimiento queda con `fefo_respetado=false` y el texto. |
| RN-LO7 | C2·T4 | ✅ | `tests/unit/stock.service.test.ts` | Bloquear un lote y vender falla. El bloqueo/desbloqueo se implementa en C5·T2. |
| RN-LO8 | C2·T5 | PENDIENTE | `tests/integration/stock.integration.test.ts` | Lote a 30 días con umbral 60 genera notificación y **permite** la venta. |

## RN-CM — Compras (C2)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-CM1 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Con la compra en borrador la existencia no cambió; al confirmar, sí. |
| RN-CM2 | C2·T4 | ✅ | `tests/unit/compras.service.test.ts` | Editar ítems de una compra confirmada falla. |
| RN-CM3 | C2·T4 | ✅ | `tests/integration/compras.integration.test.ts` | Anular sin salidas genera contra-asientos; con una venta de por medio, falla. |
| RN-CM4 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Segunda carga del mismo número de comprobante falla; número nulo no colisiona. |
| RN-CM5 | C2·T3 | ✅ | `tests/integration/compras.integration.test.ts` | Dos compras a distinto costo dejan el `costo_reposicion` de la segunda y los movimientos de la primera intactos. |

## RN-VT — Ventas e IVA (C4)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-VT1 | C4·T2 | PENDIENTE | `tests/unit/ventas.service.test.ts` | Tres líneas de $1.000 al 21 % → neto 826,45, IVA 173,55, total 3.000,00. Barrido de $0,01 a $10.000 verificando `neto + iva = precio`. |
| RN-VT2 | C4·T2 | PENDIENTE | `tests/unit/ventas.service.test.ts` | Cinco líneas de alícuotas mixtas: `total = SUM(importe_total)` al centavo. |
| RN-VT3 | C4·T1 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Con los dos IDs viola el CHECK; con ninguno, también. |
| RN-VT4 | C4·T3 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Anular devuelve la existencia a los lotes originales, genera el egreso, la venta sigue en el listado, y anular dos veces falla. |
| RN-VT5 | C4·T3 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Cerrar sesión, abrir otra, anular una venta de la primera → el movimiento pertenece a la segunda. |
| RN-VT6 | C4·T2 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Vender, renombrar el producto y cambiarle la alícuota: la línea vieja conserva los tres valores. |
| RN-VT7 | C4·T2 | PENDIENTE | `tests/unit/ventas.service.test.ts` | Registrar con arreglo de ítems vacío falla. |
| RN-VT8 | C4·T2 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Sin sesión de caja abierta, la venta falla. |

## RN-CJ — Caja (C3, C4)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-CJ1 | C4·T2 | PENDIENTE | `tests/unit/ventas.service.test.ts` | $1.000 con pagos por $900 al contado falla; $600 efectivo + $400 transferencia funciona; $900 en cuenta corriente deja saldo 100. |
| RN-CJ2 | C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | Saldo inicial 1.000, venta de 5.000 en transferencia y 2.000 en efectivo → teórico 3.000, no 8.000. |
| RN-CJ3 | C4·T4 | PENDIENTE | `tests/unit/caja.service.test.ts` | Saldo inicial 1.000 y una venta íntegra en cuenta corriente → teórico 1.000, diferencia 0. |
| RN-CJ4 | C3·T1 + C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | T1: el índice parcial único rechaza la segunda sesión abierta. T2: dos aperturas simultáneas con `Promise.all` y `rpcReallyRan()` → gana exactamente una. |
| RN-CJ5 | C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | Cerrar y registrar un movimiento falla; cerrar dos veces falla; no existe endpoint de reapertura. |
| RN-CJ6 | C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | Cerrar con el efectivo exacto guarda `diferencia = 0.00`, **no** `NULL`. |
| RN-CJ7 | C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | Con tolerancia 0, cerrar con $50 de faltante sin motivo falla; con motivo funciona y queda registrado. |
| RN-CJ8 | C3·T2 | PENDIENTE | `tests/integration/caja.integration.test.ts` | Cerrar, forzar un movimiento en la sesión cerrada, verificar que `saldo_teorico_efectivo` no cambió. |
| RN-CJ9 | C3·T2 | PENDIENTE | `tests/unit/caja.service.test.ts` | Transferencia sin referencia falla; efectivo sin referencia funciona. |

## RN-FR — Fraccionamiento (C1, C6)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-FR1 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Sin relación de conversión falla; con la relación desactivada, también. |
| RN-FR2 | C1·T3 | ✅ | `tests/integration/catalogo-comercial.integration.test.ts` | Con A→B y B→C cargadas, crear C→A falla por el trigger; A→A falla por CHECK. |
| RN-FR3 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Provocar el fallo después de la salida: no queda el lote hijo ni el movimiento. |
| RN-FR4 | C6·T1 + C6·T3 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Todo lote de origen `conversion` tiene padre; el CTE recursivo devuelve los tres niveles caja→blíster→comprimido. |
| RN-FR5 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Bolsa con factor 15 declarando 15,5 kg obtenidos falla. |
| RN-FR6 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Factor 15 obteniendo 14,2 genera merma de 0,8; desvío 20 % con tolerancia 10 % sin motivo falla, con motivo funciona. |
| RN-FR7 | C6·T1 | PENDIENTE | `tests/unit/fraccionamiento.service.test.ts` | Bolsa de $45.000, factor 15, rendimiento 14,2 → costo del hijo $3.169,0141/kg y **no** $3.000,0000/kg. |
| RN-FR8 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | La suma de `costo_total` de la operación es **cero** y el valor total del inventario no cambió. |
| RN-FR9 | C6·T2 | PENDIENTE | `tests/unit/fraccionamiento.service.test.ts` | No existe ruta que genere la conversión inversa; registrar la relación inversa falla por RN-FR2. |
| RN-FR10 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Bolsa que vence 2027-03-01 con hijo declarado 2027-06-01 falla. |
| RN-FR11 | C6·T1 | PENDIENTE | `tests/unit/fraccionamiento.service.test.ts` | Bolsa que vence en 2027 con 30 días de vida útil sugiere hoy + 30. |
| RN-FR12 | C6·T3 | PENDIENTE | `tests/unit/fraccionamiento.service.test.ts` | Vender comprimidos con existencia 0 en "comprimido" y positiva en "caja" **falla**, aunque exista la conversión. |
| RN-FR13 | C6·T1 | PENDIENTE | `tests/integration/fraccionamiento.integration.test.ts` | Fraccionar 0,5 cajas falla si "caja" no admite decimales, aunque el destino sí. |

## RN-AJ — Ajustes, mermas, recuento y devoluciones (C5)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-AJ1 | C5·T2 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | Sin motivo falla; con `"error"` (5 caracteres) falla; con motivo descriptivo funciona. |
| RN-AJ2 | C5·T2 | PENDIENTE | `tests/unit/ajustes.service.test.ts` | No existe ruta de anulación de movimiento; el ajuste compensatorio queda visible en el historial del lote. |
| RN-AJ3 | C5·T3 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | Abrir recuento, vender del lote contado, aplicar sin confirmar → advertencia con los lotes movidos; con confirmación → el ajuste usa la cantidad al momento de aplicar. |
| RN-AJ4 | C5·T2 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | Vender 5, devolver 3, devolver 3 → falla la segunda. |
| RN-AJ5 | C5·T2 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | La devolución no revendible crea o usa un lote `bloqueado` con motivo, y ese lote no aparece entre los candidatos FEFO. |
| RN-AJ6 | C5·T3 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | Aplicar dos veces el mismo recuento falla. |
| RN-AJ7 | C5·T2 | PENDIENTE | `tests/integration/ajustes.integration.test.ts` | Con lote vencido, la merma por vencimiento funciona y cualquier otra salida falla. |

## RN-CC — Consumo clínico, receta y trazabilidad (C7)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-CC1 | C7·T1 | N/A | `tests/integration/consumo.integration.test.ts` | Aplicar una vacuna genera un movimiento `consumo_clinico` con `historial_id` y `mascota_id`, y **no** genera venta ni movimiento de caja. **C7·T1 la activa.** |
| RN-CC2 | C7·T1 | N/A | `tests/integration/consumo.integration.test.ts` | Consumir de un lote vencido falla; consumir más de lo disponible falla; el lote sugerido es el de FEFO. **C7·T1 la activa.** |
| RN-CC3 | C7·T2 | N/A | `tests/unit/consumo.service.test.ts` | Los dos escenarios de `exigir_receta_bloqueante`, cambiando **solo** la configuración del tenant, sin migración. **C7·T1 la activa.** |
| RN-CC4 | C7·T3 | N/A | `tests/integration/consumo.integration.test.ts` | Dado un lote, las mascotas que lo recibieron; dada una mascota, los lotes que recibió. Las dos consultas tras tres consumos sobre dos mascotas. **C7·T1 la activa.** |
| RN-CC5 | C7·T1 | N/A | `tests/integration/consumo.integration.test.ts` | Tras un ciclo completo de operaciones, ningún movimiento tiene `trazabilidad_estado` distinto de `no_aplica`. **Es un test de que NO se construyó el puente a SIGTRAZAVET.** **C7·T1 la activa.** |

> Las columnas que C7 necesita (`movimientos_stock.historial_id`, `plan_vacunacion_id`,
> `mascota_id`, `receta_id`, `profesional_prescriptor_id`) **ya se crearon en C2·T1**, junto con
> los `UNIQUE (id, tenant_id)` de `mascotas`, `historial_clinico` y `plan_vacunacion` que sus
> FKs compuestas necesitan, el índice `idx_mov_historial` y la cláusula del CHECK documental que
> exige `historial_id` para `consumo_clinico`. **C7 no crea ninguna tabla ni ninguna columna.**
> Eso es exactamente lo que §12.2 pedía al no dejarlas para después.

## C8 — Reportes comerciales

C8 **no agrega ninguna RN**. Verifica dos que ya están cubiertas, ahora **sobre datos reales**
del fixture de volumen versionado:

| RN reverificada | Tanda | Qué reverifica |
|---|---|---|
| **RN-MV6** | C8·T3 | El reporte de rentabilidad da lo mismo después de cambiar `costo_reposicion`, sobre miles de movimientos y no sobre tres. |
| **RN-FR8** | C8·T3 | La suma firmada de costos de toda operación de fraccionamiento del fixture es cero, y el valor del inventario no cambió por fraccionar. |

> Estas dos filas **no son filas de la matriz**: sus RN ya están contadas en RN-MV y RN-FR. Van
> en negrita a propósito, para que el recuento de 90 filas de C8·T3 siga dando 90.

## RN-SC — Seguridad, permisos, auditoría y concurrencia (C1, C4)

| RN | Tanda | Estado | Archivo previsto | Caso |
|---|---|---|---|---|
| RN-SC1 | C1·T5 | ✅ | `tests/unit/tenant-filter-guardrail.test.ts` (**G1**)<br>`tests/unit/productos.controller.test.ts`<br>`tests/unit/proveedores.controller.test.ts`<br>`tests/integration/aislamiento-api.integration.test.ts` | Guardrail G1 con su assert de cobertura sobre los services del módulo + enviar `tenantId` en el body no cambia el tenant afectado. Se reverifica en cada etapa. |
| RN-SC2 | C1·T3 + C2·T1 + C4·T1 | ✅ | `tests/integration/aislamiento-api.integration.test.ts` | Insertar con `service_role` una fila cuyo `x_id` pertenece a otro tenant falla **por FK compuesta**, no por validación de aplicación. |
| RN-SC3 | C1·T5 | ✅ | `tests/integration/grants.integration.test.ts` (**G3**) | Bloque que **enumera** las funciones creadas por las migraciones del módulo y verifica `has_function_privilege('anon'\|'authenticated', …) = false` para todas. Una función nueva entra sola al alcance. |
| RN-SC4 | C1·T3 | ✅ | `tests/integration/rls.test.ts` | Con dos tenants sembrados, ninguna consulta de A devuelve filas de B en las tablas del módulo. **Bloqueante desde la primera etapa.** Se extiende en cada migración. |
| RN-SC5 | C1·T5 | ✅ | `tests/unit/productos.service.test.ts`<br>`tests/unit/proveedores.service.test.ts` | Por tipo de operación, verificar el asiento con su `module`; si la operación falla, no queda asiento huérfano. Se reverifica en cada etapa. |
| RN-SC6 | C1·T1 | ✅ | `tests/unit/audit-modulo-enum.test.ts` (**G2**) | Todo `module:` de `recordAudit` existe en el ENUM `modulo_auditoria` **y** en el tipo `AuditModule`. La dirección TS es nueva y es la que hoy falta. |
| RN-SC7 | C1·T5 | ✅ | `tests/unit/productos.controller.test.ts`<br>`tests/unit/proveedores.controller.test.ts` | Matriz rol × endpoint con el 403 esperado; módulo no contratado → `MODULE_NOT_LICENSED`. Se reverifica en cada etapa. |
| RN-SC8 | C4·T5 | PENDIENTE | `tests/integration/ventas.integration.test.ts` | Dos `.rpc("registrar_venta")` en `Promise.all` sobre un lote con existencia 1, con `rpcReallyRan()`, N repeticiones (default 50). Una tiene éxito y la otra falla con `INSUFFICIENT_STOCK`; **nunca las dos**. |
