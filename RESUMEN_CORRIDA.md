# Resumen de Corrida — Módulo Comercial · Veterinaria Leo

**Fecha:** 2026-08-31  
**Rama:** `feat/modulo-comercial`  
**Estado:** ✅ **C1, C2 y C3 COMPLETOS** (Tandas C1·T1 a C3·T3 ejecutadas y verificadas)

---

## 1. Tandas Ejecutadas

### Etapa C1: Catálogo Comercial, Proveedores y Seguridad
| Tanda | Commit | Descripción y Entregables |
|---|---|---|
| **C1·T1** | `a261fd5` | **Enums, ErrorCodes y Auditoría**: Creación del ENUM `condicion_fiscal`, nuevos valores en `modulo_auditoria`, extensión de `AuditModule` y catálogo de `ErrorCode`s comerciales. |
| **C1·T2** | `1649baa` | **Permisos y Licenciamiento**: Permisos `manage_products`, `view_stock`, `manage_suppliers`, asignación por roles en `on_tenant_created`, registro del módulo `stock` en `modulos_disponibles`. |
| **C1·T3** | `15b5d8d` | **DDL de Catálogo Global y Tenant**: Migraciones SQL, tablas `unidades_medida`, `medios_pago`, `familias_producto`, `proveedores`, `productos`, `producto_conversiones`. |
| **C1·T4** | `7ec727a` | **CRUD de Productos, Familias y Conversiones**: DTOs, servicios `ProductoService`, `FamiliaService`, `ConversionService` y routers Hono. |
| **C1·T5** | `851070c` | **Proveedores y Guardrails G1 / G3**: `ProveedorService`, router `/proveedores`, ampliación y mutación de G1 y G3. |

### Etapa C2: Libro Mayor de Existencias, Lotes, FEFO y Compras
| Tanda | Commit | Descripción y Entregables |
|---|---|---|
| **C2·T1** | `223c7c2` | **Migración del Libro Mayor y Existencias**: `movimientos_stock`, `lotes`, `existencias_lote`, trigger inmutable y función `signo_movimiento`. |
| **C2·T2** | `0e3fc93` | **RPCs de Existencias y Reconstrucción**: `existencias_lote_aplicar_movimiento`, `verificar_existencias`, `recalcular_existencias` con mutaciones. |
| **C2·T3** | `5a54db5` | **Compras y Recepción de Mercadería**: DDL de `compras`, `compras_items`, RPC `confirmar_compra` transaccional con auditoría. |
| **C2·T4** | `c2ecdd9` | **Anulación de Compras y Services de Stock / Compras**: RPC `anular_compra`, `StockService`, `ComprasService`, DTOs y controllers. |
| **C2·T5** | `68a8e8a` | **Alertas de Vencimiento y Guardrail G4 (Libro Mayor)**: `stock-ledger-guardrail.test.ts`, notificaciones FEFO. |

### Etapa C3: Caja y Arqueo
| Tanda | Commit | Descripción y Entregables |
|---|---|---|
| **C3·T1** | `1f53fa3` | **Migración de Caja y Tests de Base**: `cajas`, `sesiones_caja`, `movimientos_caja`, índice parcial único `uq_sesion_caja_abierta`, `chk_sesion_cierre_completo`, `signo_movimiento_caja`, trigger `movimientos_caja_inmutable` y RLS select. Arreglo dinámico de G1. |
| **C3·T2** | `7e67005` | **RPCs de Caja y Concurrencia**: `abrir_sesion_caja`, `registrar_movimiento_caja`, `cerrar_sesion_caja` con `SECURITY DEFINER`, auditoría y NOTIFY. Tests concurrentes RN-CJ4 (200 repeticiones con `Promise.all` y `rpcReallyRan()`) y mutación. |
| **C3·T3** | `934ee0e` | **Service, Controller y Rutas de Caja**: `caja.schemas.ts`, `CajaService`, `cajaRouter` montado en `/caja` con `requireModule('ventas')` y `requirePermission('manage_cash')`, tests unitarios de service y controller. |

---

## 2. Guardrails del Módulo Comercial

1. **G1 — Filtro explícito `.eq('tenant_id', ...)`** (`tests/unit/tenant-filter-guardrail.test.ts`):
   - Escaneo AST dinámico automático de todos los módulos que toquen tablas comerciales (`productos`, `proveedores`, `stock`, `compras`, `caja`).
   - 25 tests unitarios en verde.
2. **G2 — Coherencia `AuditModule` ↔ ENUM DB** (`tests/unit/audit-modulo-enum.test.ts`):
   - 13 tests unitarios en verde.
3. **G3 — Permisos de ejecución en RPCs comerciales** (`tests/integration/grants.integration.test.ts`):
   - 39 tests de integración en verde verificando que ni `anon` ni `authenticated` puedan invocar RPCs comerciales directamente.
4. **G4 — Inmutabilidad del Libro Mayor** (`tests/unit/stock-ledger-guardrail.test.ts`):
   - 8 tests unitarios en verde garantizando que ninguna ruta de aplicación escriba directamente sobre `existencias_lote`.

---

## 3. Estado de la Suite de Tests al Cierre de C3

- **Unit tests (`npm test`)**:
  - **55 archivos** de test pasados.
  - **776 tests pasados** (0 fallos, 0 skipped).
- **Typecheck (`npm run typecheck`)**:
  - Limpio en API (Hono/Deno/TS) y Web (React/Vite/TS) con 0 errores.
- **Integration tests (`npm run test:integration`)**:
  - **23 archivos** de integración ejecutados contra Supabase local.
  - **322 tests pasados** (0 fallos, 0 skipped).
  - `tests/integration/caja.integration.test.ts`: **12 passed** (0 skipped).

---

## 4. Cobertura en `MATRIZ_RN_TESTS_COMERCIAL.md`

- **49 reglas de negocio en ✅**:
  - RN-PR (12/12): RN-PR1 a RN-PR12.
  - RN-PRV (3/3): RN-PRV1 a RN-PRV3.
  - RN-MV (12/12): RN-MV1 a RN-MV12.
  - RN-LO (7/8): RN-LO1 a RN-LO5, RN-LO7, RN-LO8 (RN-LO6 pendiente para C4·T2).
  - RN-CM (5/5): RN-CM1 a RN-CM5.
  - RN-CJ (7/9): RN-CJ2, RN-CJ4, RN-CJ5, RN-CJ6, RN-CJ7, RN-CJ8, RN-CJ9 (RN-CJ1 y RN-CJ3 son de C4).
  - RN-FR (1/13): RN-FR2.
  - RN-SC (7/8): RN-SC1 a RN-SC7 (RN-SC8 pendiente para C4·T5).
- **Pendientes**: 36
- **N/A (activación en C7·T1)**: 5

---

## 5. Próximo Paso

Etapa **C4**: Ventas de Mostrador, Medios de Pago e Integración Comercial (Tandas C4·T1 a C4·T5).

