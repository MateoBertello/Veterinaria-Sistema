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

## §4.7 — `numero_operacion` se asigna al final del RPC

*(Pendiente — corrección 2.3, Bloque 2.)*

---

## §6.3 RN-MV4 — El signo del movimiento tiene tres valores

*(Pendiente — corrección 3.4, Bloque 3.)*

---

## Nueva — Un controller test que mockea el Service no prueba el endpoint

*(Pendiente — corrección 2.2, Bloque 2.)*
