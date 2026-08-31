# Resumen de Ejecución — Etapa C5 (Ajustes, Mermas, Recuentos y Devoluciones)

**Fecha:** 2026-08-31
**Rama:** `feat/modulo-comercial`
**Estado final:** ✅ Completada y cerrada

---

## 1. Resumen Ejecutivo

La **Etapa C5 (Ajustes, Mermas, Recuentos y Devoluciones)** implementó los mecanismos transaccionales de corrección de stock, bloqueo de lotes, recuentos físicos con detección de concurrencia y devoluciones de ventas:

1. **C5·T1 (Esquema de BD para Recuentos):**
   - Migración `20260929000001_comercial_recuentos.sql` (`recuentos`, `recuentos_detalle`, `uq_recuento_borrador` parcial por tenant, `uq_recuento_lote`, `chk_recuento_aplicado_completo`, FKs compuestas `(id, tenant_id)`, FK diferida `movimientos_stock_recuento_tenant_fkey` con `ON DELETE RESTRICT`, RLS SELECT con `manage_stock`).
2. **C5·T2 (RPCs `ajustar_existencia`, `bloquear_lote`, `desbloquear_lote`, `registrar_devolucion`):**
   - Migración `20260929000002_comercial_ajustes_rpcs.sql`.
   - Helper `motivo_valido(p_motivo)`: validación estricta de motivo no nulo con `length(trim(motivo)) >= 10`.
   - `ajustar_existencia`: `ORDER BY lote_id FOR UPDATE`, respeta decimales de unidad, `RN-AJ7` (lote vencido solo admite `merma_vencimiento`), auditoría `inventory`.
   - `bloquear_lote` y `desbloquear_lote`: gestión de estado con preservación de `motivo_bloqueo` histórico (`RN-LO7`).
   - `registrar_devolucion`: acumulación de devoluciones previas por línea (`RN-AJ4`), derivación de no revendibles a lote `bloqueado` con `lote_padre_id` (`RN-AJ5`), y compensación de caja en sesión abierta (`egreso_devolucion`).
3. **C5·T3 (RPC `aplicar_recuento`):**
   - Migración `20260929000003_comercial_aplicar_recuento_rpc.sql`.
   - `RN-AJ3`: congelamiento de `cantidad_sistema` al momento exacto de aplicar. Detección de desvíos con `COUNT_STALE` y detalle JSON de lotes modificados en el interín, exigiendo confirmación explícita (`p_confirmar_desvios`).
   - `RN-AJ6`: irreversibilidad total de recuentos aplicados.
   - Bloqueo determinístico de lotes `ORDER BY lote_id FOR UPDATE` y agrupación atómica bajo un único `operacion_id`. Omisión de asientos sin diferencia (diferencia 0).
4. **C5·T4 (Services, Controllers y Endpoints):**
   - `AjustesService` y routers Hono (`ajustesRouter`, `lotesAjustesRouter`, `recuentosRouter`, `devolucionesRouter`) en `supabase/functions/api/src/modules/ajustes/`.
   - Mapeo de errores de dominio y DTOs con Zod schemas.
   - Integración al guardrail estático de aislamiento multi-tenant (`tenant-filter-guardrail.test.ts`).

---

## 2. Resultados de las Suites de Tests

### 2.1. Suite Unitaria (`npm test` / Vitest Unit)
- **59 archivos pasados (833 tests passed, 0 skipped, 0 failed)**
- Archivos clave de C5:
  - `tests/unit/ajustes.service.test.ts`: **19 passed** (mapeo exhaustivo de errores RPC a códigos de dominio, DTOs camelCase, validación de borrador en recuentos, llamadas RPC con parámetros tenant/user).
  - `tests/unit/ajustes.controller.test.ts`: **13 passed** (gates de autenticación, autorización por permisos `manage_stock` / `manage_sales`, módulos `stock` / `ventas`, validación Zod de motivos y DTOs).
  - `tests/unit/tenant-filter-guardrail.test.ts`: **25 passed** (descubrimiento automático de `src/modules/ajustes/` y verificación de `.eq('tenant_id', ...)` en todas las consultas del service).

### 2.2. Typecheck (`npm run typecheck`)
- **0 errores** en API (`supabase/functions/api/tsconfig.json`) y Web (`web/tsconfig.json`).

### 2.3. Suite de Integración (`npm run test:integration`)
- **25 archivos pasados (384 tests passed, 0 skipped, 0 failed)**
- Desglose por archivo:
  1. `tests/integration/ajustes.integration.test.ts`: **21 passed**
     - C5·T1: 6 tests (restricciones DB, unicidad de borrador, integridad referencial compuesta cross-tenant, CASCADE vs RESTRICT).
     - C5·T2: 8 tests (RN-AJ1 validación motivo en todos los RPCs, RN-AJ2 compensación en kárdex vs inmutabilidad, RN-AJ4 acumulador de devoluciones, RN-AJ5 lotes bloqueados excluidos de FEFO, RN-AJ7 mermas de vencimiento, RN-LO7 ajustes sobre lotes bloqueados, persistencia de motivo de bloqueo).
     - C5·T3: 7 tests (RN-AJ3 congelamiento de sistema en aplicación con detección de `COUNT_STALE` y reajuste con confirmación, sin desvíos, preservación de ventas previas en kárdex, RN-AJ6 irreversibilidad, recuentos vacíos, agrupación por `operacion_id`, omisión de asientos con diferencia cero).
  2. `tests/integration/rls.test.ts`: **60 passed** (incluye RLS de `recuentos` y `recuentos_detalle`).
  3. `tests/integration/grants.integration.test.ts`: **55 passed** (incluye verificación de ejecución acotada a `service_role` para `ajustar_existencia`, `bloquear_lote`, `desbloquear_lote`, `registrar_devolucion`, `aplicar_recuento`, `motivo_valido`).
  4. `tests/integration/ventas.integration.test.ts`: **19 passed**
  5. `tests/integration/caja.integration.test.ts`: **12 passed**
  6. `tests/integration/catalogo-comercial.integration.test.ts`: **9 passed**
  7. `tests/integration/stock.integration.test.ts`: **14 passed**
  8. `tests/integration/compras.integration.test.ts`: **14 passed**
  9. `tests/integration/comercial-licenciamiento.integration.test.ts`: **7 passed**
  10. `tests/integration/aislamiento-api.integration.test.ts`: **28 passed**
  11. `tests/integration/guarderia.integration.test.ts`: **27 passed**
  12. `tests/integration/vacunacion.integration.test.ts`: **21 passed**
  13. `tests/integration/dashboard.integration.test.ts`: **15 passed**
  14. `tests/integration/mascotas.integration.test.ts`: **13 passed**
  15. `tests/integration/hardening-authenticated.integration.test.ts`: **13 passed**
  16. `tests/integration/historial-storage.integration.test.ts`: **11 passed**
  17. `tests/integration/auth.integration.test.ts`: **9 passed**
  18. `tests/integration/modulos.integration.test.ts`: **8 passed**
  19. `tests/integration/admin.integration.test.ts`: **6 passed**
  20. `tests/integration/eutanasia.integration.test.ts`: **6 passed**
  21. `tests/integration/vacunacion-avisos.integration.test.ts`: **4 passed**
  22. `tests/integration/notificaciones-cron.integration.test.ts`: **3 passed**
  23. `tests/integration/auditoria-retencion.integration.test.ts`: **3 passed**
  24. `tests/integration/turnos.integration.test.ts`: **3 passed**
  25. `tests/integration/doctores.integration.test.ts`: **3 passed**

---

## 3. Matriz de Reglas de Negocio (`MATRIZ_RN_TESTS_COMERCIAL.md`)

- **Total RN en alcance:** 90
- **Total RN en ✅ (cumplidas con tests en verde):** 72 (100% de las etapas C1 a C5)
- **Total RN PENDIENTES:** 13 (C6 Fraccionamiento: RN-FR1 a RN-FR13)
- **Total RN en N/A (se activan en C7·T1):** 5 (C7 Consumo Clínico: RN-CC1 a RN-CC5)

---

## 4. Verificaciones por Mutación y Hallazgos Registrados

1. **RN-AJ4 (Acumulación de devoluciones previas):**
   - Al simular una mutación eliminando `v_ya_devuelto` (comparando únicamente `v_item.cantidad > v_linea.cantidad`), dos devoluciones consecutivas de 3 unidades sobre una venta original de 5 unidades pasaron ambas erróneamente. Con la acumulación real, la segunda devolución falló correctamente con `RETURN_EXCEEDS_SOLD` (3 + 3 = 6 > 5).
2. **RN-AJ3 (Detección de ventas concurrentes durante recuentos):**
   - Al abrir un recuento con existencia 10 y registrar una venta intermedia de 3 unidades, el RPC detectó el desvío y retornó `COUNT_STALE` con el detalle JSON del lote afectado (`cantidadVistaPorElUsuario: 10`, `cantidadActual: 7`). Al confirmar el desvío, generó el ajuste exacto (+3 unidades) llevando el stock al conteo físico (10) sin sobrescribir ni revertir la venta previa.
3. **RN-AJ5 (Aislamiento de lotes no revendibles en FEFO):**
   - Las devoluciones marcadas como no revendibles crearon lotes en estado `bloqueado` con `lote_padre_id` apuntando al lote vendido original. La consulta de candidatos FEFO (`estado = 'disponible'`) ignoró estrictamente estos lotes devueltos.
