# Resumen de Corrida — Etapa C1: Catálogo Comercial, Proveedores y Seguridad

**Fecha:** 2026-08-30  
**Rama:** `feat/modulo-comercial`  
**Estado:** ✅ **C1 COMPLETO** (Tandas C1·T1 a C1·T5 ejecutadas y verificadas)

---

## 1. Tandas Ejecutadas

| Tanda | Commit | Descripción y Entregables |
|---|---|---|
| **C1·T1** | `a261fd5` | **Enums, ErrorCodes y Auditoría**: Creación del ENUM `condicion_fiscal`, nuevos valores en `modulo_auditoria` (`products`, `suppliers`, `sales`, `purchases`, `cash_register`, `inventory`), extensión de `AuditModule` y catálogo de 18 `ErrorCode`s comerciales. |
| **C1·T2** | `1649baa` | **Permisos y Licenciamiento**: Permisos `manage_products`, `view_stock`, `manage_suppliers`, asignación por roles en `on_tenant_created`, registro del módulo `stock` en `modulos_disponibles` y habilitación en `on_tenant_created` (demo) + frontend `/admin/modulos`. Tests de licenciamiento en `comercial-licenciamiento.integration.test.ts`. |
| **C1·T3** | `15b5d8d` | **DDL de Catálogo Global y Tenant**: Migraciones `20260901000003_comercial_catalogos_globales.sql` y `20260901000004_comercial_catalogo_tenant.sql`. Tablas creadas: `unidades_medida`, `medios_pago`, `familias_producto`, `proveedores`, `productos`, `producto_conversiones`. Trigger `trg_producto_conversiones_sin_ciclo` y función `cantidad_valida_para_unidad`. Tests de integración en `catalogo-comercial.integration.test.ts`, `aislamiento-api.integration.test.ts` y `rls.test.ts`. |
| **C1·T4** | `7ec727a` | **CRUD de Productos, Familias y Conversiones**: DTOs en `productos.schemas.ts`, servicios `ProductoService`, `FamiliaService`, `ConversionService` con guards `assertProductoOperable` y `assertProductoVendible`. Routers Hono montados en `/productos`, `/familias-producto`, `/producto-conversiones`. Tests unitarios de service y controller. |
| **C1·T5** | `851070c` | **Proveedores y Guardrails G1 / G3**: DTOs y service `ProveedorService` con guard `assertProveedorActivo`. Router `/proveedores` con permisos `manage_suppliers` y módulo `stock`. Guardrail G1 ampliado con aserción de cobertura y verificado por mutación. Guardrail G3 con enumerador dinámico `@modulo: comercial` y verificado por mutación. Matriz rol × endpoint validada. |

---

## 2. Guardrails del Módulo Comercial (C1)

Los 3 guardrails de seguridad de C1 están implementados, activos y probados contra mutaciones:

1. **G1 — Filtro explícito `.eq('tenant_id', ...)`** (`tests/unit/tenant-filter-guardrail.test.ts`):
   - Escaneo AST estático de todos los services que utilizan `getServiceDb()`.
   - Assert de cobertura explícito para `MODULOS_COMERCIALES = ["productos", "proveedores"]` y tablas `productos`, `familias_producto`, `producto_conversiones`, `proveedores`.
   - **Verificación por mutación**: Al omitir intencionalmente un `.eq('tenant_id', ...)` en `proveedores.service.ts`, el test falló señalando archivo y línea exacta.

2. **G2 — Coherencia `AuditModule` ↔ ENUM DB** (`tests/unit/audit-modulo-enum.test.ts`):
   - Verifica bidireccionalmente que todos los módulos de auditoría en TypeScript existan en el ENUM `modulo_auditoria` de PostgreSQL y viceversa.

3. **G3 — Permisos de ejecución en RPCs comerciales** (`tests/integration/grants.integration.test.ts`):
   - Enumerador dinámico basado en la cabecera `-- @modulo: comercial` en migraciones SQL.
   - Detecta funciones (`cantidad_valida_para_unidad`, `on_tenant_created`, `producto_conversiones_sin_ciclo`) y verifica que ni `anon` ni `authenticated` puedan invocarlas directamente vía PostgREST.
   - **Verificación por mutación**: Al remover la marca `-- @modulo: comercial`, el test falló impidiendo falsos verdes.

---

## 3. Estado de la Suite de Tests

- **Unit tests (`npm test`)**:
  - **49 archivos** de test ejecutados.
  - **740 tests pasados** (0 fallos).
- **Typecheck (`npm run typecheck`)**:
  - Limpio en API (Hono/Deno/TS) y Web (React/Vite/TS).
- **Integration tests (`npm run test:integration`)**:
  - **20 archivos** de integración ejecutados contra Supabase local.
  - **250 tests pasados** (0 fallos, 0 skipped).

---

## 4. Cobertura en `MATRIZ_RN_TESTS_COMERCIAL.md`

- **RNs de C1 marcadas con ✅**:
  - **RN-PR (12/12)**: RN-PR1 a RN-PR12.
  - **RN-PRV (2/3)**: RN-PRV1 y RN-PRV2 completadas (RN-PRV3 queda PENDIENTE hasta la creación de tablas de compras en C2·T3 como estaba previsto).
  - **RN-FR (1/1 de C1)**: RN-FR2 (factores de conversión estrictamente positivos y trigger anti-ciclos).
  - **RN-SC (7/7 de C1)**: RN-SC1 (aislamiento tenant), RN-SC2 (FKs compuestas), RN-SC3 (G3 grants RPCs), RN-SC4 (RLS select), RN-SC5 (asiento de auditoría por módulo), RN-SC6 (G2 enum auditoría), RN-SC7 (matriz de permisos y licenciamiento `stock`).
- **Total RNs en verde**: **22 reglas de negocio** verificadas.

---

## 5. Próximo Paso

Etapa **C2**: Libro mayor de existencias, lotes, FEFO y compras (Tandas C2·T1 a C2·T5).
