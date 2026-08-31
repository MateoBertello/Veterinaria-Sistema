# Resumen de Ejecución — Etapa C4 (Ventas)

**Fecha:** 2026-08-31
**Rama:** `feat/modulo-comercial`
**Estado final:** ✅ Completada y cerrada

---

## 1. Resumen Ejecutivo

La **Etapa C4 (Ventas)** implementó el núcleo comercial de facturación, caja, descuento atómico de stock e inmutabilidad:

1. **C4·T1 (Esquema de BD):**
   - Migración `20260922000001_comercial_ventas.sql` (`ventas`, `ventas_items`, `ventas_pagos`, `contadores_tenant`, `UNIQUE(id, tenant_id)` en `servicios`, FKs compuestas, RLS SELECT).
2. **C4·T2 (RPC `registrar_venta`):**
   - Cálculo de IVA por diferencia (`neto = round(precio/(1+alicuota/100), 2)`, `iva = precio - neto`), barrido de >100.000 precios sin descalce.
   - Descuento atómico FEFO con pre-bloqueo `ORDER BY lote_id FOR UPDATE`.
   - Congelamiento de snapshots (`descripcion_snapshot`, `precio_unitario`, `alicuota_iva`, `costo_unitario_efectivo`).
   - Generación de asientos de caja por medio de pago y alerta de stock mínimo por flanco.
3. **C4·T3 (RPC `anular_venta`):**
   - Restitución íntegra de stock (`entrada_devolucion`) y egreso de caja (`egreso_devolucion`).
   - Anulación sobre sesión cerrada rutea el reintegro a la sesión abierta actual del tenant (`RN-VT5`).
   - Inmutabilidad estricta: asientos nuevos, sin `UPDATE` ni `DELETE` de movimientos.
4. **C4·T4 (Services, Vistas y REST):**
   - Vistas `v_items_vendidos` y `v_margen_venta` (con `COMMENT` formal y costo guardado en `ventas_items`, sin recalcular contra `productos.costo_reposicion`).
   - `VentaService` y `ventasRouter` (`manage_sales`, `void_sales`, `view_sales`, sin métodos `PUT`/`PATCH`/`DELETE`).
   - Búsqueda por `codigoBarras` en catálogo de productos.
5. **C4·T5 (Concurrencia RN-SC8):**
   - Cuatro casos de concurrencia: dos ventas simultáneas de la última unidad, prevención de deadlock por orden inverso, 10 ventas simultáneas sobre 3 unidades y anulación concurrente.
   - Verificaciones por mutación validadas con 200 repeticiones.

---

## 2. Resultados de las Suites de Tests

### 2.1. Suite Unitaria (`npm test` / Vitest Unit)
- **57 archivos pasados (801 tests passed, 0 skipped, 0 failed)**
- Archivos clave de C4:
  - `tests/unit/ventas.service.test.ts`: **9 passed** (RN-VT1 >100k sweep, RN-VT2, RN-VT7, RN-CJ1, RN-MV6, scoping por permisos, no-read de existencias, no N+1).
  - `tests/unit/ventas.controller.test.ts`: **15 passed** (matriz de permisos y roles admin/vet/recep, 403 MODULE_NOT_LICENSED, RN-SC1 ignores tenantId, inmutabilidad estructural).
  - `tests/unit/caja.service.test.ts`: **7 passed** (incluyendo RN-CJ3 de cuenta corriente y cálculo de saldo teórico al vuelo).
  - `tests/unit/tenant-filter-guardrail.test.ts`: **25 passed** (incluyendo detección y escaneo automático de `ventas.service.ts`).

### 2.2. Typecheck (`npm run typecheck`)
- **0 errores** en API (`supabase/functions/api/tsconfig.json`) y Web (`web/tsconfig.json`).

### 2.3. Suite de Integración (`npm run test:integration`)
- **24 archivos pasados (348 tests passed, 0 skipped, 0 failed)**
- Desglose por archivo:
  1. `tests/integration/ventas.integration.test.ts`: **19 passed** (RN-VT3, unicidad numero_operacion, FKs compuestas RN-SC2, RN-VT8, RN-VT6, RN-LO6, RN-LO4, RN-PR9, RN-PR10, pagos, alerta stock mínimo, RN-VT4, RN-VT5, RN-MV9, y los 4 casos de RN-SC8).
  2. `tests/integration/caja.integration.test.ts`: **12 passed**
  3. `tests/integration/catalogo-comercial.integration.test.ts`: **9 passed**
  4. `tests/integration/stock.integration.test.ts`: **14 passed**
  5. `tests/integration/compras.integration.test.ts`: **14 passed**
  6. `tests/integration/comercial-licenciamiento.integration.test.ts`: **7 passed**
  7. `tests/integration/rls.test.ts`: **57 passed**
  8. `tests/integration/grants.integration.test.ts`: **43 passed**
  9. `tests/integration/aislamiento-api.integration.test.ts`: **28 passed**
  10. `tests/integration/guarderia.integration.test.ts`: **27 passed**
  11. `tests/integration/vacunacion.integration.test.ts`: **21 passed**
  12. `tests/integration/dashboard.integration.test.ts`: **15 passed**
  13. `tests/integration/mascotas.integration.test.ts`: **13 passed**
  14. `tests/integration/hardening-authenticated.integration.test.ts`: **13 passed**
  15. `tests/integration/historial-storage.integration.test.ts`: **11 passed**
  16. `tests/integration/auth.integration.test.ts`: **9 passed**
  17. `tests/integration/modulos.integration.test.ts`: **8 passed**
  18. `tests/integration/admin.integration.test.ts`: **6 passed**
  19. `tests/integration/eutanasia.integration.test.ts`: **6 passed**
  20. `tests/integration/vacunacion-avisos.integration.test.ts`: **4 passed**
  21. `tests/integration/notificaciones-cron.integration.test.ts`: **3 passed**
  22. `tests/integration/auditoria-retencion.integration.test.ts`: **3 passed**
  23. `tests/integration/turnos.integration.test.ts`: **3 passed**
  24. `tests/integration/doctores.integration.test.ts`: **3 passed**

---

## 3. Matriz de Reglas de Negocio (`MATRIZ_RN_TESTS_COMERCIAL.md`)

- **Total RN en alcance:** 90
- **Total RN en ✅ (cumplidas con tests en verde):** 65 (100% de las etapas C1 a C4)
- **Total RN PENDIENTES:** 20 (C5 Ajustes: 7, C6 Fraccionamiento: 13)
- **Total RN en N/A (se activan en C7·T1):** 5 (C7 Consumo Clínico)

---

## 4. Verificaciones por Mutación Registradas

1. **RN-VT1 (IVA por diferencia vs por separado):**
   - Al mutar `descomponerLinea` para calcular neto e IVA por separado (`round(precio * 0.21, 2)`), el test falló en el precio **$0.05** ($0.04 neto + $0.01 IVA = $0.05 vs $0.0105 redondeado incorrectamente).
2. **RN-VT5 (Anulación en sesión cerrada hacia sesión abierta actual):**
   - Al mutar `anular_venta` para imputar el egreso en la sesión cerrada original, el test falló con `CASH_SESSION_CLOSED` (imposibilidad de registrar movimientos en sesión cerrada).
3. **RN-SC8 (Concurrencia de descuento de stock sin FOR UPDATE):**
   - Al remover el bloqueo `FOR UPDATE` y permitir carrera directa entre lecturas y escrituras, el test falló en la **repetición 0** con violación del CHECK de existencia no negativa (`new row for relation "existencias_lote" violates check constraint "existencias_lote_cantidad_check"`), demostrando que la serialización `FOR UPDATE ORDER BY lote_id` es indispensable para evitar sobreventas bajo concurrencia.
