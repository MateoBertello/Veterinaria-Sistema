# EXPLAIN de listados e índices — Etapa 9 / S10

Verificación de rendimiento de los listados grandes de cada módulo con datos a
volumen, y decisión de índices **guiada por los planes** (nada especulativo).
Cierra la parte de **índices** de DT-9 (TODO.md, RN-AUD4) y la verificación de
plan de **RN-HC5**. La política de **retención** de auditoría NO entra acá
(decisión de producto → S11).

## Metodología

- Stack local Supabase (Postgres 15, `:54322`). Datos sintéticos generados con un
  script fuera del repo (`scratchpad/s10_seed_volumen.sql`), **no versionado**.
- 3 tenants (el demo + `2222…` + `3333…`) para confirmar que cada plan aísla por
  `tenant_id` y no barre entre tenants.
- Volumen por tenant (≈ total): turnos 5.000 (~15k), estadías 4.000 (~11k),
  historial_clínico 7.000 (~21k), plan_vacunación 3.500 (~10,5k),
  registros_auditoria 13.000 (~39k). `ANALYZE` tras la carga.
- Se corrió `EXPLAIN (ANALYZE, BUFFERS)` sobre las queries **reales** de los
  services (embeds de PostgREST reproducidos como `LEFT JOIN` por PK del padre).
  Mediciones sobre tenant `2222…`.

## Resumen de decisión

| # | Listado (service) | Filtro / orden | Plan | Índice | Decisión |
|---|---|---|---|---|---|
| Q1 | Turnos agenda por fecha (`turnos.service`) | `tenant_id`,`date`,`status IN`; ord `date,start_time` | Bitmap Index Scan | `idx_turnos_tenant_fecha` | **Ya cubierto** |
| Q2a | Turnos rango mensual (sintético `date BETWEEN`) | `tenant_id`,`date` rango | Bitmap Index Scan | `idx_turnos_tenant_fecha` | **Ya cubierto** |
| Q2b | Barrido recordatorios turnos (`notificaciones.service`) | `tenant_id`,`status IN`,`date` rango | Bitmap Index Scan | `idx_turnos_tenant_fecha` | **Ya cubierto** |
| Q3 | Estadías por rango (`guarderia.service`) | `tenant_id`,`status IN`,`check_in≤`,`check_out≥` | Bitmap Index Scan | `idx_estadias_tenant_rango` | **Ya cubierto** |
| Q4a | Clientes listado (`clientes.service`) | `tenant_id`,`deleted`; ord `created_at` | Seq Scan + top-N | (embed count vía `idx_mascotas_cliente`) | **Seq scan aceptable** (cientos de filas/tenant) |
| Q4b | Clientes búsqueda ILIKE | `... OR ILIKE '%t%'` sobre 3 cols | Seq Scan + filtro | — | **Seq scan aceptable**; pg_trgm no justificado |
| Q5 | Mascotas búsqueda ILIKE (`mascotas.service`) | `name ILIKE '%t%'` | Seq Scan + filtro | — | **Seq scan aceptable**; pg_trgm no justificado |
| Q6 | Historial timeline por mascota (`historial.service`, **RN-HC5**) | `tenant_id`,`pet_id`,`deleted`; ord `date DESC` | Bitmap Index Scan | `idx_historial_pet_date` | **Ya cubierto — RN-HC5 verificado** |
| Q7a | Auditoría por fecha (`auditoria.service`, **RN-AUD4/5**) | `tenant_id`,`timestamp` rango; ord `timestamp DESC` | Index Scan | `idx_auditoria_tenant_ts` | **Ya cubierto** |
| Q7b | Auditoría por módulo | `tenant_id`,`module`; ord `timestamp DESC` | Index Scan `tenant_ts` + filtro | `idx_auditoria_tenant_ts` (+ `idx_auditoria_modulo` para conteos) | **Aceptable** (módulos ~1/8) |
| Q7c | **Auditoría por usuario** | `tenant_id`,`user_id`; ord `timestamp DESC` | Seq/Bitmap de toda la partición + Sort | **NUEVO `idx_auditoria_usuario`** | **Índice agregado** ✅ |
| Q8a | Barrido avisos vacunación (`notificaciones.service`, **RN-PV6/7**) | `tenant_id`,`estado`,`fecha_estimada` rango | Bitmap Index Scan | `idx_planvac_tenant_barrido` | **Ya cubierto** |
| Q8b | Plan vacunación por mascota (`vacunacion.service`) | `tenant_id`,`pet_id`; ord `fecha_estimada` | Bitmap Index Scan | `idx_planvac_pet` | **Ya cubierto** |

**Único índice agregado:** `idx_auditoria_usuario (tenant_id, user_id, "timestamp" DESC)`
(migración `20260707000001_indices_listados.sql`).

---

## El gap justificado: auditoría por usuario (Q7c — RN-AUD4/AUD5)

`buscarPaginado` filtra por `user_id` y ordena por `timestamp DESC`. `user_id`
era la **única** columna de filtro del listado sin liderar ningún índice. El
efecto solo se ve con un usuario **poco activo**: para juntar la página (LIMIT 20
por `timestamp DESC`) el planner barre **toda la partición del tenant** y descarta
casi todo por filtro. Costo lineal en el total de auditoría del tenant — y RN-AUD4
hace crecer esa tabla sin límite (retención pendiente).

### ANTES (sin `idx_auditoria_usuario`) — usuario con ~60 filas entre 13k

```
Limit  (actual time=1.251..1.253 rows=20)
  Buffers: shared hit=283
  ->  Sort  (Sort Key: "timestamp" DESC)  Sort Method: top-N heapsort
        ->  Bitmap Heap Scan on registros_auditoria
              Recheck Cond: (tenant_id = '2222…')
              Filter: (user_id = '0000aaaa-…-000000000001')
              Rows Removed by Filter: 13000
              ->  Bitmap Index Scan on idx_auditoria_modulo (rows=13060)
  Execution Time: 1.311 ms
```

(Con un usuario de 1 sola fila el patrón es idéntico: `Rows Removed by Filter:
13.059`, `Buffers: 283`.)

### DESPUÉS (con `idx_auditoria_usuario`)

```
-- usuario ~60 filas
Limit  (actual time=0.060..0.063 rows=20)
  Buffers: shared hit=7 read=1
  ->  Sort (top-N heapsort)
        ->  Bitmap Heap Scan on registros_auditoria
              ->  Bitmap Index Scan on idx_auditoria_usuario  (rows=60)
                    Index Cond: (tenant_id = '2222…' AND user_id = '0000aaaa-…')

-- usuario 1 fila: Index Scan directo, sin Sort
Limit  (actual time=0.034..0.035 rows=1)
  Buffers: shared hit=1 read=3
  ->  Index Scan using idx_auditoria_usuario
        Index Cond: (tenant_id = '2222…' AND user_id = 'fc64a994-…')

-- usuario + rango de fecha (filtro combinado real): mismo índice
  ->  Bitmap Index Scan on idx_auditoria_usuario
        Index Cond: (tenant_id … AND user_id … AND "timestamp" >= now()-'180 days')
```

**Antes → después:** `Buffers 283 → 4–8`, `Rows Removed by Filter 13.000 → 0`. El
plan pasa de O(total auditoría del tenant) a O(filas del usuario). A 13k filas la
diferencia en tiempo ya es ~10×; crece de forma lineal con el volumen. El
`timestamp DESC` en el índice también sirve el `ORDER BY` (Index Scan sin Sort
para el caso de pocas filas).

---

## Lo que ya estaba cubierto (sin cambios)

- **Turnos (Q1/Q2a/Q2b):** `idx_turnos_tenant_fecha (tenant_id, date)` resuelve
  tanto la agenda de un día como el rango mensual y el barrido, todos por Bitmap
  Index Scan (0,8–1,1 ms). El `status IN` se aplica como filtro barato sobre el
  slice del día.
- **Estadías (Q3):** `idx_estadias_tenant_rango (tenant_id, check_in_date,
  check_out_date, status)` cubre el solape de fechas por Bitmap Index Scan.
- **Historial timeline / RN-HC5 (Q6):** `idx_historial_pet_date (pet_id, date DESC)`
  → Bitmap Index Scan, 0,07 ms. El `date DESC` sirve el orden del timeline y el
  `deleted=false` queda como filtro barato. **Plan de RN-HC5 verificado.**
- **Auditoría por fecha/módulo (Q7a/Q7b):** `idx_auditoria_tenant_ts
  (tenant_id, "timestamp" DESC)` sirve el listado ordenado por fecha y también la
  variante por módulo (walk + filtro + LIMIT), 0,12 ms — porque los módulos son
  frecuentes (~1/8). `idx_auditoria_modulo (tenant_id, module)` queda para
  agregados/conteos por módulo sin orden por fecha.
- **Vacunación (Q8a/Q8b):** `idx_planvac_tenant_barrido (tenant_id, estado,
  fecha_estimada)` cubre el barrido de avisos y `idx_planvac_pet (pet_id,
  fecha_estimada)` el listado por mascota.

## Búsquedas ILIKE `'%term%'` — pg_trgm NO justificado hoy

Las tres búsquedas con comodín inicial (clientes OR sobre `full_name/dni_cuit/
phone`, `mascotas.name`, `auditoria.user_name`) no pueden usar btree y caen a Seq
Scan. Al volumen real por tenant son sub-2 ms:

- Clientes ILIKE (Q4b): Seq Scan, 614 filas, **0,30 ms**.
- Mascotas ILIKE (Q5): Seq Scan, 2.017 filas (el mayor), **1,06 ms**.

Decisión (acordada): **no** se introduce la extensión `pg_trgm` ni índices GIN en
esta migración. Queda documentado como opción futura si el conteo por tenant de
clientes/mascotas llegara a decenas de miles y el escaneo se volviera dominante.

## Cobertura de FK en embeds — sin índices nuevos

Regla de CLAUDE.md: toda FK usada en embeds frecuentes con índice. En los planes,
los embeds de estos listados resuelven **por la PK del padre**, no por la columna
FK del hijo:

- Turnos/estadías/mascotas → `servicios/doctores/mascotas/clientes/especies/razas`:
  el padre entra por Hash Join de la tabla chica completa o por `*_pkey`
  (Nested Loop + Memoize). La FK del hijo (`turnos.servicio_id`, etc.) **no**
  aparece en ningún plan → indexarla sería especulativo.
- Embeds de **colección hija** (los que sí usan la FK del hijo): `clientes →
  mascotas!client_id(count)` usa `idx_mascotas_cliente (tenant_id, client_id)`, e
  `historial → adjuntos_medicos(count)` usa `idx_adjuntos_record`. Ambos ya
  existen.

Conclusión: **ninguna FK de embed nueva se justifica** por los planes. Las FK sin
índice quedan documentadas como no ejercitadas por los listados actuales.

## Nota de alcance — "rango mensual" de turnos

El backend no tiene endpoint de listado de turnos por rango mensual: `GET /turnos`
filtra un `date` puntual y la vista mensual se arma en el cliente. La única query
de turnos por rango es el barrido de recordatorios (Q2b). Para cubrir el patrón se
midió una query sintética `date BETWEEN` (Q2a) que confirma que
`idx_turnos_tenant_fecha` sirve también ese acceso. Construir el endpoint queda
fuera del alcance de S10 (perf/índices, no features).

---

## Reproducción

```bash
# desde ~/Veterinaria-Sistema, con el stack local arriba
PSQL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$PSQL" -f scratchpad/s10_seed_volumen.sql   # volumen sintético (no versionado)
psql "$PSQL" -f scratchpad/s10_explain.sql        # los EXPLAIN de arriba
```
