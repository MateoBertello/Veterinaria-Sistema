# RESUMEN_CORRIDA.md — Módulo Comercial · Veterinaria Leo

**Cierre formal del desarrollo del Módulo Comercial (Etapas C1 a C8).**

---

## 1. Resumen Ejecutivo de las 8 Etapas

| Etapa | Nombre | Alcance / Entregables principales | Estado |
|---|---|---|:---:|
| **C1** | **Catálogo comercial** | ABM de productos, familias, conversiones y proveedores. CHECKs de escala, unidad y alícuota. Licenciamiento por módulos y roles del sistema. | ✅ Completa |
| **C2** | **Libro mayor y compras** | Tablas `lotes`, `movimientos_stock`, caché `existencias_lote`. RPCs `recalcular_existencias`, `verificar_existencias`, `confirmar_compra`. FEFO e inmutabilidad estricta. | ✅ Completa |
| **C3** | **Caja** | Tablas `cajas`, `sesiones_caja`, `movimientos_caja`. Apertura y cierre de caja transaccional, arqueo de efectivo con tolerancia, bloqueo concurrente anti-doble apertura. | ✅ Completa |
| **C4** | **Ventas y mostrador** | Tablas `ventas`, `ventas_items`, `ventas_pagos`. RPC `registrar_venta` con descuento FEFO concurrente (`FOR UPDATE`), cálculo exacto de IVA por diferencia, anulación atómica. | ✅ Completa |
| **C5** | **Ajustes, recuentos y devoluciones** | Tablas `recuentos`, `recuentos_detalle`. RPCs `ajustar_existencia`, `registrar_devolucion`, `aplicar_recuento`. Lotes bloqueados y mermas por vencimiento. | ✅ Completa |
| **C6** | **Fraccionamiento** | RPC `fraccionar_lote`, vistas `v_costo_fraccionamiento`, `v_stock_familia_unidad_base`, CTE recursivo `cadena_trazabilidad_lote`. Conservación de valor (RN-FR8) y merma tolerada. | ✅ Completa |
| **C7** | **Consumo clínico** | RPC `registrar_consumo_clinico` desde historial médico sin pasar por ventas ni caja. Trazabilidad lote ↔ mascota. Vista `v_atenciones_sin_consumo` (P-04). | ✅ Completa |
| **C8** | **Reportes comerciales y rendimiento** | Fixture de volumen versionado (`supabase/seeds/comercial_volumen_seed.sql`). 9 reportes comerciales (`valorizacion-fecha`, `rotacion`, `rentabilidad`, `fraccionamiento`, `ventas-usuario`, `ventas-sesion`, `ventas-medio-pago`, `consumo-profesional`, `consumo-especie`). Benchmark EXPLAIN e índice medido `idx_mov_mascota`. | ✅ Completa |

---

## 2. Estado de las 90 Reglas de Negocio (RN)

| Grupo | Total RN | Cubiertas ✅ | Pendientes |
|---|:---:|:---:|:---:|
| **RN-PR** — Productos, familias y unidades | 12 | 12 | 0 |
| **RN-PRV** — Proveedores | 3 | 3 | 0 |
| **RN-MV** — Movimientos y existencias | 12 | 12 | 0 |
| **RN-LO** — Lotes, vencimiento y FEFO | 8 | 8 | 0 |
| **RN-CM** — Compras | 5 | 5 | 0 |
| **RN-VT** — Ventas e IVA | 8 | 8 | 0 |
| **RN-CJ** — Caja | 9 | 9 | 0 |
| **RN-FR** — Fraccionamiento | 13 | 13 | 0 |
| **RN-AJ** — Ajustes, mermas, recuento y devoluciones | 7 | 7 | 0 |
| **RN-CC** — Consumo clínico y trazabilidad | 5 | 5 | 0 |
| **RN-SC** — Seguridad, permisos, auditoría y concurrencia | 8 | 8 | 0 |
| **TOTAL** | **90** | **90 (100%)** | **0** |

*Detalle exhaustivo de mapeo test ↔ regla en `MATRIZ_RN_TESTS_COMERCIAL.md`.*

---

## 3. Los Tres Guardrails de Integridad

| Guardrail | Archivo | Qué controla | Módulos bajo alcance |
|---|---|---|---|
| **G1** | `tests/unit/tenant-filter-guardrail.test.ts` | Analiza el código fuente de todos los `*.service.ts`. Falla si cualquier llamada `.from("tabla")` con `getServiceDb()` no incluye `.eq("tenant_id", ...)` en la misma cadena. | **Todos los módulos del backend** (Auth, Usuarios, Clientes, Mascotas, Servicios, Configuración, Doctores, Horarios, Auditoría, Historial, Turnos, Guardería, Vacunación, Productos, Proveedores, Stock, Compras, Caja, Ventas, Ajustes, Fraccionamiento, Consumo, Reportes). |
| **G2** | `tests/unit/audit-modulo-enum.test.ts` | Valida que cada módulo utilizado en `recordAudit` y dentro de RPCs de PostgreSQL pertenezca en sincronía estricta al `ENUM modulo_auditoria` de la DB y al tipo `AuditModule` de TypeScript (evita pérdida silenciosa de auditoría). | **Todos los módulos que escriben auditoría**, incluyendo los módulos comerciales (`products`, `suppliers`, `inventory`, `cash_register`, `sales`). |
| **G3** | `tests/integration/grants.integration.test.ts`<br>`tests/unit/stock-ledger-guardrail.test.ts` | **G3a:** Revisa que `anon` y `authenticated` no tengan privilegios de `EXECUTE` en ningún RPC sensible ni permisos de escritura directa en tablas de negocio.<br>**G3b:** Garantiza que ningún service escriba directamente en `existencias_lote` (el libro mayor es la única fuente de verdad). | **Todas las tablas y RPCs del módulo comercial y transversal.** |

---

## 4. Reverificación de RN-MV6 y RN-FR8 sobre Datos Reales

1. **RN-MV6 (Costo guardado inmutable):**
   - **Prueba realizada:** Se modificó `productos.costo_reposicion` multiplicándolo por 5 sobre el producto `AMOX-BLIST` en el tenant con datos de volumen.
   - **Resultado:** Tanto la reconstrucción histórica del inventario (`valorizacionAFecha`) como el reporte de margen histórico (`rentabilidad`) devolvieron valores **idénticos antes y después** del cambio. Los reportes toman el costo efectivo guardado en `lotes.costo_unitario_efectivo` y `ventas_items.costo_unitario_efectivo`, nunca recalculan contra catálogo actual.
2. **RN-FR8 (Conservación de valor en fraccionamiento):**
   - **Prueba realizada:** Se validaron las operaciones de fraccionamiento multietapa del fixture (`AMOX-CAJA` → `AMOX-BLIST` → `AMOX-COMP`).
   - **Resultado:** La suma algebraica de `costo_total` en cada operación de fraccionamiento (`salida_conversion` + `entrada_conversion` + `merma_fraccionamiento`) es exactamente **cero**, conservando el valor monetario global del inventario.

---

## 5. Medición EXPLAIN y Optimización de Índices

Se aplicó la metodología de `docs/EXPLAIN_INDICES.md` contra el fixture de volumen versionado (`supabase/seeds/comercial_volumen_seed.sql`):

- **Listados analizados:**
  - `Q_VAL` (Valorización de inventario): Index Scan `idx_mov_tipo` / `idx_mov_producto`.
  - `Q_SESION` (Ventas por sesión de caja): Index Scan `idx_ventas_tenant_sesion`.
  - `Q_MARGEN` (Rentabilidad y margen): Index Scan `idx_ventas_items_servicio` + `idx_ventas_tenant_cliente`.
  - `Q_TRAZ_PET` (Trazabilidad Mascota → Consumos clínicos): **Identificado cuello de botella**.
- **Optimización realizada:**
  - **Antes:** `Bitmap Heap Scan` usando `idx_mov_tipo` con filtro en memoria sobre `mascota_id` (`Rows Removed by Filter: 190`, `Execution Time: 0.156 ms`).
  - **Después:** Migración `20261020000001_comercial_indices_reportes.sql` agregando `idx_mov_mascota (tenant_id, mascota_id) WHERE mascota_id IS NOT NULL`.
  - **Resultado medido:** `Index Scan` directo, 0 filas descartadas por filtro, `Buffers: 5`, `Execution Time: 0.033 ms` (**~5x más rápido**).

---

## 6. Registro Completo de Observaciones y Decisiones de Diseño

Lista exhaustiva de hallazgos, decisiones y cosas que no se tocaron a lo largo de la corrida para preservar la arquitectura:

1. **Trazabilidad externa (SIGTRAZAVET / SENASA):**
   - Se preservaron las columnas reservadas (`trazabilidad_estado`, `trazabilidad_referencia_externa`) en `movimientos_stock` con valor por defecto `'no_aplica'`. No se implementaron clientes HTTP externos ni endpoints hacia organismos externos, respetando el alcance del módulo.
2. **Cuenta corriente (P-03 / Etapa C9 condicional):**
   - Las tablas `ventas` y `ventas_pagos` quedaron estructuradas con soporte para `condicion_pago = 'cuenta_corriente'` y `saldo_pendiente`. No se implementaron endpoints de imputación de pagos de cuenta corriente por ser condicional a requerimiento del cliente.
3. **Imposibilidad de reversiones destructivas:**
   - No se crearon endpoints para des-fraccionar, reabrir sesiones de caja cerradas o borrar movimientos del libro mayor. Las rectificaciones siempre generan contra-asientos auditables (`salida_ajuste` / `entrada_ajuste`).
4. **Relaciones compuestas con Tenant ID:**
   - Para soportar RLS y restricciones de integridad compuestas `(id, tenant_id)`, todas las consultas con embeds en Supabase PostgREST utilizan la sintaxis por nombre de constraint (`tabla!constraint_name(...)`).
5. **Fixture de Volumen Versionado:**
   - A diferencia de etapas anteriores donde el script de volumen residía en `scratchpad/`, el fixture completo quedó formalmente versionado en `supabase/seeds/comercial_volumen_seed.sql`.

---

## 7. Resultados Finales de la Suite de Tests

```
npm test                   --> 65 test files passed | 887 unit tests passed (0 failed, 0 skipped)
npm run typecheck          --> 0 TypeScript compilation errors (API + Web)
npm run test:integration   --> 28 test files passed | 423 integration tests passed (0 failed, 0 skipped)
```
