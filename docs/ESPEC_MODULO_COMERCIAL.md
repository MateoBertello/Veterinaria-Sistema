# Especificación — Módulo Comercial (stock, costos y caja)

**Versión:** 1.0 — reescrita contra el repositorio real
**Estado:** BORRADOR PARA REVISIÓN DEL DUEÑO DEL PRODUCTO
**Alcance del entregable:** análisis y diseño. No se escribió código de producción, no se
crearon migraciones y no se modificó ningún archivo del repositorio.
**Destino sugerido:** `/docs/ESPEC_MODULO_COMERCIAL.md`

> **Diferencia con las versiones 0.1 y 0.2:** aquellas se escribieron sin acceso al
> repositorio y llevaban diez asunciones marcadas. Esta se escribió **después de leer**
> `CLAUDE.md`, el Documento Maestro v1.0, el Addendum v1.1, `PLAN_ETAPAS.md`,
> `MATRIZ_RN_TESTS.md`, las 29 migraciones, `shared/` completo, los 15 módulos de la Edge
> Function y las 20 suites de test. **No quedan asunciones.** Las secciones 4, 5, 6, 7, 8, 9
> y 10 cambiaron sustancialmente; las decisiones de diseño se mantienen salvo D-11 y D-17,
> corregidas contra la arquitectura real.

---

## 0. Cómo leer este documento

| Sección | Contenido | A quién le sirve |
|---|---|---|
| 1 | Glosario del dominio | Todos. Es la sección que evita bugs por ambigüedad. |
| 2 | Decisiones de diseño (D-01 … D-18) | Dueño del producto. Cada una marca si necesita confirmación. |
| 3 | Contexto normativo a verificar | Dueño del producto. |
| 4 | Modelo de datos | Implementación. |
| 5 | RPCs transaccionales | Implementación. |
| 6 | Reglas de negocio (90 RN) | Implementación y QA. |
| 7–10 | ErrorCodes, permisos, ENUMs, integración | Implementación. |
| 11 | Corte en etapas | Planificación. |
| 12 | Riesgos | Todos. |
| 13 | Fuera de alcance | Dueño del producto. |
| 14 | Matriz RN → test | QA. |
| 15 | **Las preguntas que no puedo contestar** | Dueño del producto. |

**DECISIÓN DE PRODUCTO** = el dueño la confirma antes de implementar.
**DECISIÓN TÉCNICA** = se toma acá; se puede objetar, no requiere confirmación.

---

## 0.1. Base verificada del repositorio

Todo lo que sigue **se leyó, no se supuso**. Es el contrato al que este módulo se integra.

### Arquitectura de acceso a datos — el punto que más cambió respecto de la v0.2

| Hecho verificado | Dónde | Consecuencia |
|---|---|---|
| El `tenant_id` sale del JWT (`app_metadata.tenant_id`) en `tenantContext`, que **verifica la firma** y lo deja en `c.get('tenantId')`. Cualquier `tenant_id` de body o query se ignora. | `middleware/tenantContext.ts` | El Service lo recibe por contexto. Sigue valiendo la regla 1 de `CLAUDE.md`. |
| Los Services escriben con **`getServiceDb()`** — `service_role`, que **bypasea RLS** — y filtran `tenant_id` explícitamente. `getDb(authHeader)` (JWT + RLS) se usa solo en middlewares, `/auth`, `/modulos` y dashboard, y **solo para leer**. | `shared/db.ts` + los 15 services | **En el camino de escritura el aislamiento lo garantiza el filtro explícito, no RLS.** Toda consulta del módulo lleva `.eq('tenant_id', tenantId)` sin excepción. |
| `authenticated` **perdió INSERT/UPDATE/DELETE** sobre todo `public`; las políticas RLS de negocio son **`FOR SELECT`** y exigen `usuario_activo()` y `tiene_permiso('<permiso>')`. `anon` no tiene ningún privilegio. | `20260725000003_hardening_authenticated_rls.sql`, `20260706000001_revoke_anon_grants.sql` | Las tablas nuevas llevan RLS con política **de solo lectura** y su permiso. No se crean políticas de escritura. |
| Los RPC son `SECURITY DEFINER`, reciben **`p_tenant_id` por parámetro** y terminan con `REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO service_role`. | `registrar_eutanasia`, `crear_estadia_con_cupo`, `20260710000001_revoke_execute_funciones.sql` | Los RPC del módulo hacen lo mismo. `p_tenant_id` viene de `ctx.tenantId`, que viene del JWT. |
| Toda migración que crea o cambia un RPC termina con `NOTIFY pgrst, 'reload schema';`. | Convención declarada en `registrar_eutanasia` | Se repite en cada migración de RPC. Sin eso PostgREST sirve la firma vieja desde caché. |
| `ALTER DEFAULT PRIVILEGES` ya deja las tablas futuras con `SELECT` para `authenticated` y DML para `service_role`. | migraciones 20260622 / 20260706 / 20260725000003 | Las tablas nuevas **no necesitan `GRANT` propio**. |
| Los errores de negocio viajan del RPC al Service como `RAISE EXCEPTION '<CODIGO>'`, y el Service los mapea a `DomainError`. | `registrar_eutanasia` + `historial.service.ts` | Mismo mecanismo acá. |

### Convenciones verificadas

| Tema | Realidad del repo |
|---|---|
| **ErrorCode** | Enum en `shared/errors.ts`, `SCREAMING_SNAKE`, **en inglés**, con excepciones de sustantivo local (`MASCOTA_NOT_FOUND`, `TURNO_SOLAPADO`, `CUPO_GUARDERIA_AGOTADO`). `DomainError(code, statusCode, message, details)`. |
| **Auditoría** | `recordAudit(db, payload)` en `shared/audit.ts`. `action` ∈ `CREATE/UPDATE/DELETE/CANCEL/LOGIN/LOGOUT/VIEW/EXPORT`. `module` ∈ `modulo_auditoria`. Tabla `registros_auditoria (action, module, entity_id TEXT, old_values, new_values, details, ip_address, "timestamp")`. **No existe** ninguna función SQL `registrar_auditoria()`: los RPC hacen `INSERT INTO registros_auditoria` a mano. |
| **Envelope** | `ok(data, meta?)` / `fail(code, message, statusCode, details)` en `shared/envelope.ts`. |
| **Permisos** | 12 filas. Nombre `verbo_recurso` **en inglés** (`manage_users`, `view_medical_history`…). Columna `module` con el mismo vocabulario que `modulo_auditoria`. |
| **Roles** | Exactamente tres, creados por `on_tenant_created()`: `admin`, `veterinario`, `recepcionista`. El admin recibe **todos** los permisos con `SELECT p.id FROM permisos p`, así que un permiso nuevo le llega solo. |
| **Módulos vendibles** | `modulo_vendible` = `historial_clinico | turnos | guarderia`; `modulos_contratados` + `requireModule` → `403 MODULE_NOT_LICENSED`. El plan (`basico/profesional/premium`) decide qué se habilita en `on_tenant_created()`. |
| **Numeración de RN** | **No hay correlativo global**: hay un prefijo por subdominio (`RN-TU`, `RN-GU`, `RN-EC`, `RN-PV`, `RN-SV`…). Este documento sigue esa convención. |
| **Nombres de test** | Un archivo por módulo (`tests/unit/<modulo>.service.test.ts`, `tests/integration/<modulo>.integration.test.ts`) con el código RN citado en el título del `it()`. Matriz: `\| RN-xx \| ✅ \| ruta \|`. |
| **Migraciones** | `AAAAMMDD` + secuencia de 6 dígitos. Nunca se edita una aplicada. |
| **Scripts** | `npm test` = unit; `test:integration`; `test:e2e`; `typecheck` corre `tsc` sobre API y web. |
| **Concurrencia** | El patrón ya existe: `tests/integration/guarderia.integration.test.ts` dispara dos `.rpc()` con `Promise.all` contra un `FOR UPDATE` y verifica que gane exactamente una, con guard `rpcReallyRan()` contra el falso verde por función inexistente. **Este módulo lo copia, no lo inventa.** |

### Lo que el repo NO tiene y este módulo necesita

1. **No hay precios en ningún lado.** `servicios` tiene `nombre`, `descripcion`,
   `duracion_minutos`, `requiere_profesional`, `tipo`, `activo` — nada más. Ninguna tabla del
   sistema tiene precio, tarifa ni arancel. Ver D-10 y P-06.
2. **`configuracion_tenant` es híbrida:** columnas tipadas (`cupo_maximo_diario`,
   `dias_aviso_vacuna`) más `parametros_extra JSONB NOT NULL DEFAULT '{}'`.
3. **`notificaciones.origen`** es un ENUM de dos valores con
   `UNIQUE (tenant_id, origen, referencia_id, canal)`. Ver 10.6.
4. **`clientes` ya tiene `dni_cuit`** con `UNIQUE (tenant_id, dni_cuit)`. No se agrega otro
   documento.
5. **No hay dependencia `pg`.** **No hace falta:** `service_role` vía `supabase-js` puede
   intentar el `UPDATE` prohibido contra PostgREST y recibir el error del trigger, que es
   exactamente lo que las RN de inmutabilidad necesitan probar. Ver 12.3.

---

## 1. Glosario del dominio

Normativa. Los nombres de acá se usan igual en base, código, `ErrorCode`, UI y en el resto de
este documento. **Un concepto, un nombre.**

### 1.1. Catálogo

**Producto.** Ficha de catálogo de un bien físico con existencia. Es una identidad comercial,
no una sustancia: *"Alimento Balanceado Adulto — bolsa 15 kg"* y *"Alimento Balanceado
Adulto — suelto por kg"* son **dos productos distintos**. Ver D-06.

**Servicio.** Prestación sin existencia física. Vive en `servicios`, que ya existe y **no se
fusiona** con productos. Ver D-10.

**Artículo.** Término genérico que abarca *producto o servicio*, usado **únicamente** al
hablar de líneas de venta. **No existe ninguna tabla `articulo`.** Si aparece, algo se modeló
mal.

**Familia de producto.** Agrupación de catálogo con unidad base común, para reportes
agregados y para crear derivados desde plantilla.

**Unidad de medida.** Cómo se cuenta un producto: unidad, kilogramo, mililitro, comprimido,
blíster, bolsa. Declara si **admite fracción** y con qué escala decimal. Ver D-06.d.

**Unidad de compra / unidad de uso.** Términos del negocio, **no del modelo**. La bolsa de
15 kg y el kilo suelto son dos productos ligados por una **conversión**. Se documentan
justamente para que nadie los traduzca a dos columnas de la misma fila.

### 1.2. Existencias

**Lote.** Instancia física identificable de un producto, con **costo unitario propio**, fecha
de ingreso y, opcionalmente, número de lote del fabricante y fecha de vencimiento. Es la
unidad de trazabilidad y **el portador del costo**. Dos compras del mismo lote de fabricante
a distinto costo generan **dos lotes**: el número del fabricante es una etiqueta, no la
identidad.

**Lote padre / lote derivado.** Relación de trazabilidad que deja un fraccionamiento.

**Existencia.** Cantidad de un lote disponible en un momento dado. Es un valor **derivado del
libro mayor**, nunca un dato que se edita. Se dice *"la existencia del lote"*, no *"el stock
del lote"*.

**Stock.** Solo en sentido coloquial y agregado (*"el módulo de stock"*, *"stock mínimo"*).
Cuando hay que ser preciso, la palabra es **existencia**.

**Movimiento.** Asiento inmutable del libro mayor. Todo cambio de existencia **es** un
movimiento. No hay otra forma de que cambie una existencia.

**Operación.** Conjunto de movimientos generados por un mismo acto de negocio, agrupados por
`operacion_id`. Un fraccionamiento es **una** operación con **tres** movimientos.

### 1.3. Pérdidas y control

**Merma.** Pérdida de existencia sin contrapartida de venta ni consumo clínico. Tipos: *de
fraccionamiento*, *por vencimiento*, *por rotura*, *faltante de recuento*. Siempre con
motivo.

**Merma de fraccionamiento.** Diferencia entre rendimiento teórico y real de una conversión.
Es un dato de gestión: dice cuánto cuesta fraccionar. Ver D-06.a.

**Ajuste.** Corrección explícita de existencia con motivo obligatorio, visible como
corrección. Es el único mecanismo de corrección: **nada se borra ni se edita.**

**Recuento físico.** Conteo de existencias reales contra las del sistema. Al aplicarse genera
ajustes.

### 1.4. Caja

**Caja.** Punto de cobro. Una clínica chica tiene una.

**Sesión de caja.** Período entre apertura y cierre, con usuario responsable y saldo inicial.
Coloquialmente *"el turno"*.

**Arqueo.** Recuento del efectivo físico al cierre, contra el saldo teórico.

**Diferencia de arqueo.** Efectivo contado menos saldo teórico. Se registra siempre, incluso
en cero. Sobrante y faltante son ambos diferencias.

**Medio de pago.** Efectivo, transferencia, débito, crédito, QR. Solo el efectivo **afecta el
arqueo**.

**Cuenta corriente.** Saldo adeudado por un cliente. Ver D-08.

### 1.5. Comercial

**Venta.** Registro interno de una operación de venta. **No es un comprobante fiscal.** Ver
D-03.

**Compra.** Registro del ingreso de mercadería de un proveedor.

**Consumo clínico.** Salida de existencia por uso en un acto veterinario. No es venta ni
ajuste. Ver D-01.

**Costo efectivo.** Costo unitario que se **guarda** en el movimiento de salida cuando
ocurre. No se recalcula nunca.

**Costo de reposición.** Último costo de compra conocido. Sirve para fijar precios, **no**
para valuar movimientos. Ver D-04.

---

## 2. Decisiones de diseño

Formato: **decisión**, **por qué**, **qué se descartó**, y si necesita confirmación.

### D-01 — El consumo clínico es un movimiento de primera clase
**DECISIÓN TÉCNICA, con una consecuencia de producto a confirmar (P-04).**

Aplicar una vacuna, usar un sedante o gastar una jeringa descuenta existencia y **no es una
venta ni un ajuste**: es una salida atada a un evento clínico, con profesional responsable y
paciente. Se modela desde el día uno como `tipo = 'consumo_clinico'` en el libro mayor, con
FKs opcionales a `historial_clinico`, `plan_vacunacion` y `mascotas`.

**Por qué desde el día uno aunque se implemente en la etapa 6:** si el consumo clínico entra
después como un ajuste con motivo *"vacuna"*, se pierden tres cosas caras de reconstruir:
(1) el costo real de atender a un paciente; (2) la trazabilidad lote→animal, que es lo que
pide el contexto normativo de la sección 3; (3) la distinción entre *"se gastó atendiendo"* y
*"se perdió"*, que son dos números de gestión distintos. Agregar el tipo al ENUM y tres
columnas nullable ahora cuesta una migración. Reclasificar dos años de ajustes después cuesta
un proyecto.

**Encaje con el repo:** `historial_clinico` ya tiene `pet_id`, `professional_id` y
`service_id`. El movimiento apunta a `historial_clinico.id`; el módulo clínico no se entera.

**Descartado:** consumo clínico como venta a precio cero (rompe todos los reportes de venta y
obliga a un cliente ficticio); como ajuste (pierde el vínculo clínico).

### D-02 — Las existencias son un libro mayor append-only, no una columna
**DECISIÓN TÉCNICA.**

`movimiento_stock` es inmutable: se inserta, nunca se actualiza ni se borra. La existencia de
un lote es la suma firmada de sus movimientos.

**Argumento de concurrencia.** Una columna `stock_actual` obliga a leer-modificar-escribir.
Dos ventas simultáneas de la última unidad leen 1, ambas validan, ambas escriben 0, y se
vendió una unidad que no existía. Evitarlo requiere bloquear la fila del producto, lo que
serializa **todas** las operaciones de ese producto, incluso sobre lotes distintos. Con libro
mayor la operación natural es un `INSERT`, que no compite con otros `INSERT`, y la validación
se hace bajo bloqueo de grano fino sobre el lote puntual.

**Argumento de reconstrucción histórica.** Con una columna mutable, *"¿cuánto stock tenía el
31 de diciembre para valuar el inventario?"* no tiene respuesta: el dato se pisó. Con libro
mayor es un `WHERE created_at <= fecha`. Lo mismo con *"¿por qué faltan tres frascos?"*: la
columna dice que faltan; el libro mayor dice quién, cuándo y con qué motivo. Esto además hace
que la auditoría del módulo sea real y no un log paralelo que puede divergir: **el asiento es
el dato**.

**Argumento de conciliación.** Un valor derivado se puede recalcular y comparar. Un valor
almacenado que se desvió no tiene contra qué compararse.

**La caché, y por qué no es la columna prohibida.** Sumar todo el historial en cada consulta
es O(n) creciente. Se propone `existencia_lote`, saldo por lote mantenido **por trigger sobre
`movimiento_stock`, en la misma transacción**. Se distingue de una columna `stock_actual` en
tres cosas verificables:

1. **No es la fuente de la verdad.** Es un índice materializado del libro mayor.
2. **No se escribe desde la aplicación.** No hay endpoint, service ni permiso que la toque.
3. **Es reconstruible y auditable.** `recalcular_existencias()` la reconstruye;
   `verificar_existencias()` reporta desvíos. RN-MV11 exige el test que rompe la caché a mano
   y verifica que la verificación la detecta. Una columna `stock_actual` no puede tener ese
   test porque no hay contra qué verificarla.

**Alternativa sin caché:** sumar sobre `movimiento_stock` con índice `(tenant_id, lote_id)` y
una fila de saldo inicial por período. Funciona, es más puro, es más lento, y obliga a
bloquear el último asiento del lote —patrón más frágil que bloquear una fila de saldo—. **Se
recomienda la caché.**

### D-03 — Ventas: registro interno, cero facturación, con el IVA discriminado
**YA DECIDIDO POR EL DUEÑO. No se reabre.**

No hay ARCA, comprobantes fiscales, CAE ni punto de venta. Lo que sí se hace, porque es
barato ahora y carísimo después:

1. **Condición fiscal del cliente guardada** aunque no se use: `clientes.condicion_fiscal`.
   **No se agrega documento**: `clientes.dni_cuit` ya existe con `UNIQUE (tenant_id,
   dni_cuit)`. La venta copia condición fiscal y documento como *snapshot*, porque un cliente
   puede cambiar de categoría y el comprobante que se emita después debe reflejar la de ese
   momento.
2. **IVA discriminado por ítem.** La alícuota es atributo del **producto**
   (`producto.alicuota_iva`), no del comprobante, y se **copia** a la línea al registrarla.
   Los productos veterinarios no tienen todos la misma alícuota y las alícuotas cambian por
   norma: con una sola alícuota por venta, reconstruir el IVA de mil ventas pasadas es
   trabajo manual imposible de auditar.
3. **Lugar reservado en la venta**, nullable y sin uso: `comprobante_tipo`,
   `comprobante_punto_venta`, `comprobante_numero`, `cae`, `cae_vencimiento`,
   `facturacion_estado` (default `no_facturada`).

**Sobre el número interno.** La venta lleva `numero_operacion`, correlativo por tenant. **No
es un número de comprobante** y no se muestra con etiquetas que lo sugieran (*"Comprobante
N°"*, *"Factura N°"*): se muestra como *"Operación N°"*. Si mañana se terceriza la
facturación, el número fiscal lo asigna el tercero y va en `comprobante_numero`. Confundirlos
es la forma más común de que un registro interno termine pareciendo un comprobante.

### D-04 — Costeo: costo por lote con consumo FEFO. No promedio ponderado móvil
**DECISIÓN TÉCNICA.**

**La decisión ya está condicionada por el modelo de lotes.** Si el lote es el portador del
costo y el despacho es FEFO, el costo de una salida **es** el costo del lote del que salió:
identificación específica, familia FIFO, no promedio.

**Por qué no promedio ponderado móvil con inflación argentina.** El PPM mezcla costo viejo
barato con nuevo caro y produce un costo unitario que no corresponde a ninguna mercadería
real. Con inflación alta subestima el costo de lo vendido e **infla el margen contable**, que
es la forma clásica de descapitalizarse creyendo que se gana plata. Además es incompatible
con dos cosas que este módulo necesita: la trazabilidad por lote y la herencia proporcional
de costo del fraccionamiento (D-06.b), que solo funciona si el lote padre tiene costo propio.

**Por qué no último costo para valuar.** Revalúa hacia atrás mercadería comprada más barata e
inventa una ganancia que no ocurrió.

**Pero el último costo sí sirve para otra cosa, y ahí está la parte útil.** Bajo inflación hay
que separar dos números que suelen confundirse:

- **Costo efectivo del movimiento** (`movimiento_stock.costo_unitario`): el del lote que
  salió. Valúa y calcula el margen histórico real. Se **guarda**, no se recalcula jamás.
- **Costo de reposición** (`producto.costo_reposicion`): último costo de compra, actualizado
  en cada compra. Sirve para **fijar el precio de venta**, porque el precio tiene que cubrir
  reponer, no lo que se pagó hace seis meses.

Vender al costo histórico más un margen es como se funde un negocio con inflación. Vender al
costo de reposición más un margen es como se sobrevive. Los dos números conviven y se
muestran separados: el reporte de rentabilidad usa el primero, la pantalla de fijación de
precios el segundo.

**Composición del costo — punto para el dueño (P-05).** Si la clínica es monotributista, el
IVA de compra **no se recupera** y es parte del costo real; si es responsable inscripto, no.
Se guarda en el lote `costo_unitario_neto` y `costo_unitario_efectivo`, y una bandera de
configuración determina cuál valúa el libro mayor.

### D-05 — FEFO, no FIFO, con override motivado
**DECISIÓN TÉCNICA.**

Se sugiere el lote que **vence primero**, no el que entró primero. Orden: `fecha_vencimiento`
ascendente con nulos al final, luego `fecha_ingreso`, luego `id` para desempatar de forma
determinística.

- La sugerencia es automática y el usuario puede **elegir otro lote**, con motivo
  obligatorio. El movimiento guarda `fefo_respetado = false` y el motivo. No es burocracia:
  es el dato que después permite preguntar por qué queda mercadería vieja al fondo.
- **Un lote vencido no se despacha, y esto no es overrideable.** Ni venta, ni consumo
  clínico, ni fraccionamiento. La única salida posible es `merma_vencimiento`.
- Un lote a menos de N días del vencimiento genera advertencia y notificación, no bloqueo.

### D-06 — Fraccionamiento = conversión entre productos
**YA DECIDIDO POR EL DUEÑO. Acá se especifica, no se reabre.**

Abrir una bolsa **no** cambia la unidad de un producto: **convierte** un producto en otro.
Existen dos productos independientes, cada uno con su precio, vencimiento, existencia y
lotes, y una operación atómica que transforma existencia del primero en existencia del
segundo.

Se descarta el modelo *"un producto con varias unidades y un factor"*, porque se rompe en
cinco puntos concretos:

| Punto | Por qué el factor no alcanza |
|---|---|
| Precio | El kilo suelto no vale 1/15 de la bolsa de 15 kg. Casi siempre vale más. Un factor impone una relación aritmética entre precios que el negocio no respeta. |
| Vencimiento | La bolsa cerrada vence en 2027; abierta, el alimento se pone rancio en semanas. Un factor no sostiene dos fechas sobre la misma existencia. |
| Existencia separada | Hay que saber cuántas bolsas cerradas **y** cuántos kilos sueltos. Con un factor hay un solo número. |
| Irreversibilidad | Con unidades fungibles nada impide "reagrupar" 15 kilos sueltos en una bolsa cerrada, que físicamente no existe. |
| Trazabilidad | El lote derivado tiene que apuntar al lote padre. Con un factor no hay lote derivado. |

**Modelo: movimiento de conversión.** Una operación atómica, un solo RPC, una transacción,
que produce en el mismo libro mayor:

1. `salida_conversion` del lote origen, por la cantidad consumida.
2. Alta de un **lote nuevo** del producto destino, con `lote_padre_id` al lote origen.
3. `entrada_conversion` en el lote nuevo, por la **cantidad real obtenida**.
4. Si corresponde, `merma_fraccionamiento` por la diferencia contra el rendimiento teórico.

Los movimientos comparten `operacion_id`. **Multi-nivel sale gratis:** caja→blíster es una
conversión y blíster→comprimido es otra; no hay jerarquía de niveles ni columna `nivel`, y la
cadena se recorre siguiendo `lote_padre_id` con un CTE recursivo. Casos que el modelo tiene
que poder representar, y puede: bolsa de alimento 15 kg → suelto por kg; caja de comprimidos
→ blíster → comprimido individual.

#### D-06.a — El rendimiento real no es el teórico
Una bolsa de 15 kg no rinde 15 kg vendibles: hay derrame, queda el fondo, la balanza redondea.
**Si el sistema obliga a que rendimiento = factor, la gente falsea los recuentos para cuadrar
y el inventario deja de significar algo.** Es la forma más rápida de perder un sistema de
stock: no se rompe, se vuelve mentira.

La conversión registra **cantidad de origen** y **cantidad real obtenida**, las dos como
entrada del usuario. La diferencia se registra como `merma_fraccionamiento` con motivo, y es
un dato de gestión de primera clase: la merma acumulada dice **cuánto cuesta fraccionar**, y
si un producto rinde sistemáticamente 12 % menos, eso tiene que estar en el precio del
suelto.

El sistema **advierte** si el desvío supera un umbral configurable (default 10 %) y exige
motivo, pero **no bloquea**: el rendimiento real es un hecho, no una infracción.

#### D-06.b — El costo del padre se arrastra proporcionalmente, y el del hijo sube
```
costo_total_consumido = cantidad_origen × costo_unitario_lote_padre
costo_unitario_hijo   = costo_total_consumido / cantidad_real_obtenida
```
Con rendimiento menor al teórico el costo unitario del hijo **sube**, y está bien que suba:
el kilo suelto efectivamente cuesta más porque para obtenerlo hubo que perder producto.

**Consecuencia que hay que escribir para que nadie la implemente al revés:**
`merma_fraccionamiento` se registra **en cantidad, con costo total cero**. El costo ya se
reasignó íntegramente al lote hijo; si además se le imputara costo a la merma, el mismo peso
se contaría dos veces y el inventario quedaría sobrevaluado. El costo de fraccionar **no se
registra como pérdida**: se manifiesta como costo unitario más alto, y se reporta como
`(costo_unitario_hijo − costo_unitario_teórico) × cantidad_obtenida`.

#### D-06.c — No existe des-fraccionar
No hay conversión inversa. Nunca. Un error se corrige con **ajustes motivados** que quedan
visibles como corrección, no con una operación que finge que el fraccionamiento no ocurrió.
Es el criterio de la eutanasia (`CLAUDE.md` regla 8): una operación irreversible se compensa,
no se deshace. Físicamente además es la verdad: la bolsa abierta no se vuelve a cerrar.

#### D-06.d — Enteros y decimales
La **unidad de medida** declara si admite fracción y con qué escala:

- Comprimido: `admite_decimales = false`. Aunque el perro tome medio, del stock sale uno.
- Alimento suelto: `admite_decimales = true`, escala 3. `NUMERIC(14,3)` da resolución de
  1 gramo expresando en kg, que es lo que muestra la balanza del mostrador.
- Inyectables: `admite_decimales = true`, escala 3, en ml.

La validación va en la base, no solo en la aplicación.

#### D-06.e — El catálogo crece, y cómo se mitiga
Es el costo real del modelo y no se disimula. Mitigaciones: **familia de producto** para
búsqueda y reportes; **creación del derivado desde plantilla del padre** en un solo endpoint
que copia familia, alícuota, marca y condición de venta y crea la conversión; y **reporte
agregado en unidad base** usando el `factor_teorico`. **Ese reporte es exclusivamente para
reportar: jamás para descontar existencia** (RN-FR12). Un descuento que atraviese la
conversión rompe la trazabilidad de lote y es exactamente el modelo que se descartó.

### D-07 — Caja completa desde la primera tanda
**DECISIÓN TÉCNICA.**

Apertura con saldo inicial declarado, medios de pago con bandera `afecta_arqueo` —solo el
efectivo la tiene—, pago mixto en una venta, y cierre con efectivo contado y **diferencia
registrada siempre, aun en cero**. Registrar el cero distingue *"se arqueó y dio bien"* de
*"no se arqueó"*.

**El cierre es irreversible.** Una sesión cerrada no se reabre, no se edita y no admite
movimientos nuevos. Un error posterior se corrige con un movimiento en la sesión siguiente,
con motivo. Mismo criterio que la eutanasia y que el fraccionamiento.

### D-08 — Cuenta corriente: lugar reservado, sin implementar
**DECISIÓN TÉCNICA, con alcance a confirmar (P-03).**

El requisito es que **una venta no cobrada al contado no rompa el arqueo**, y se resuelve
estructuralmente: el saldo teórico suma **únicamente los pagos cuyo medio tiene
`afecta_arqueo = true`**. Una venta en cuenta corriente no genera pago en efectivo y el
arqueo cierra igual.

Se reserva desde el día uno: `venta.condicion_pago`, `venta.saldo_pendiente`,
`clientes.cuenta_corriente_habilitada`, `clientes.limite_credito`. No se implementa cobranzas,
resumen de cuenta ni mora.

### D-09 — Ajustes, mermas, devoluciones y recuento son tipos del mismo libro mayor
**DECISIÓN TÉCNICA.**

No hay tablas paralelas de ajustes: son `tipo` distintos de `movimiento_stock`, todos con
**motivo obligatorio** de longitud mínima —un motivo de tres caracteres es no tener motivo— y
todos inmutables.

El **recuento físico** sí tiene tabla propia, porque es un proceso con estado: se hace en
borrador mientras se cuenta y al aplicarse genera los ajustes en una sola operación. Aplicar
un recuento es irreversible.

Las **devoluciones de cliente** referencian la venta original, no pueden devolver más de lo
vendido, y la mercadería reingresa al lote del que salió salvo que se marque como no
revendible, en cuyo caso entra a un lote bloqueado.

### D-10 — Productos y servicios en la misma venta, sin fusionar los catálogos
**DECISIÓN TÉCNICA.**

La venta acepta líneas de producto y de servicio. La unión se hace **en la línea**, con
`venta_item.tipo_item` y dos FKs nullable excluyentes por CHECK. A `servicios` se le agregan
dos columnas y nada más (10.2).

**Por qué no unificar los catálogos:**

1. **Ciclo de vida distinto.** El producto tiene lote, vencimiento, existencia, costo,
   proveedor, unidad, conversión. El servicio tiene `duracion_minutos`,
   `requiere_profesional`, `tipo` y agenda. Fusionarlos produce una tabla ancha donde la
   mitad de las columnas está siempre en `NULL` según el tipo de fila.
2. **`servicios` está en producción y referenciada** por `turnos.servicio_id` (con
   `ON DELETE RESTRICT`) y por `historial_clinico.service_id`. Cambiarle la identidad pone en
   riesgo dos módulos que hoy funcionan a cambio de nada que el usuario perciba.
3. **La unión que el negocio necesita es en la venta, no en el catálogo.** Nadie pide "buscar
   en un catálogo unificado"; se pide "cobrar la consulta y la pipeta en el mismo ticket".
4. **Permisos y auditoría separados.** `manage_services` ya existe y es de otro dominio.
5. **Costo de reversión asimétrico.** Mantenerlos separados y unirlos después es una vista.
   Fusionarlos y separarlos después es una migración de datos en producción.

**Contrapartida honesta:** los reportes de *"lo más vendido"* atraviesan los dos catálogos. Se
resuelve con la vista `v_items_vendidos`. Ese es todo el costo de no unificar.

### D-11 — Concurrencia: RPC transaccional con bloqueo de fila
**DECISIÓN TÉCNICA. Corregida contra la arquitectura real del repo.**

Ninguna salida de existencia se calcula en el Service. El Service arma la intención y llama a
un RPC que, en una transacción:

1. `SELECT … FROM existencia_lote WHERE tenant_id = p_tenant_id AND lote_id = ANY($lotes)
   ORDER BY lote_id FOR UPDATE` — **ordenado por `lote_id`** para que dos operaciones que
   tocan los mismos lotes en distinto orden no se bloqueen mutuamente. Es la línea de defensa
   contra deadlocks y la que se olvida.
2. Valida existencia, estado de lote y vencimiento **contra el valor ya bloqueado**.
3. Inserta movimientos, cabecera y el asiento de auditoría.
4. Devuelve el resultado o hace `RAISE EXCEPTION '<ErrorCode>'`, que el Service mapea a
   `DomainError`.

**Corrección respecto de la v0.2:** aquella decía que el RPC leía el `tenant_id` del JWT. En
este repo eso no funciona: los Services usan `getServiceDb()` (service_role) y los RPC son
`SECURITY DEFINER`, contexto en el que `current_tenant_id()` devuelve `NULL`. El patrón real,
el de `registrar_eutanasia`, es **`p_tenant_id` como parámetro, tomado de `ctx.tenantId`**,
que a su vez viene del JWT verificado en `tenantContext`. El aislamiento se sostiene con dos
cosas: el filtro explícito por `p_tenant_id` en cada lectura y escritura del RPC, y el
`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`, que impide invocarlo desde
PostgREST con un token de usuario. Las dos son testeables (RN-SC1, RN-SC3).

### D-12 — El fraccionamiento es un hecho registrable, no una rutina
**DECISIÓN TÉCNICA derivada del contexto normativo. Ver sección 3.**

El diseño trata cada fraccionamiento como hecho puntual, atribuible y consultable —quién,
cuándo, qué lote origen, qué lote destino, qué rendimiento, con qué motivo— y no como un
detalle operativo que el sistema hace solo. El modelo ya pedido lo cumple sin cambios.

### D-13 — Trazabilidad lote→lote obligatoria desde la primera migración
**DECISIÓN TÉCNICA.**

`lote.lote_padre_id` existe desde la etapa que crea `lote`, **aunque el fraccionamiento se
implemente varias etapas después**. Retrofitear la cadena es reconstruir a mano qué salió de
qué con datos que ya no existen. La columna cuesta una línea hoy.

### D-14 — Receta y prescriptor: dos columnas hoy contra un rediseño mañana
**DECISIÓN TÉCNICA.**

`venta_item.receta_id`, `venta_item.profesional_prescriptor_id` y
`movimiento_stock.receta_id` existen desde el día uno, **nullable, sin validación y sin tabla
`receta`**. También `producto.condicion_venta`, que hoy solo alimenta una advertencia. El día
que el negocio decida exigir receta, se enciende una bandera de configuración y RN-CC3 pasa
de advertencia a bloqueo, sin migración.

### D-15 — No se integra con SIGTRAZAVET
**DECISIÓN TÉCNICA.**

Se reservan `producto.trazable`, `movimiento_stock.trazabilidad_estado` (default `no_aplica`)
y `movimiento_stock.trazabilidad_referencia_externa`. **No se construye ningún puente:** ni
cliente HTTP, ni cola de reintentos, ni mapeo de códigos, ni credenciales. Es una API externa
con cronograma propio; construir contra un contrato que no se puede leer es cómo se produce
código que hay que tirar entero.

### D-16 — Stock y ventas: dos módulos vendibles, con dependencia
**DECISIÓN DE PRODUCTO — requiere confirmación. Ver P-01.**

Propuesta: `modulo_vendible` suma **dos** valores, `stock` y `ventas`, donde `ventas` requiere
`stock` contratado.

**Por qué dos y no uno.** El acoplamiento es asimétrico: hay clínicas que quieren controlar
insumos y consumo clínico sin vender al público, y eso es un producto vendible por sí solo.
Vender productos sin controlar existencias no es un producto: es un cuaderno.

**Por qué es reversible en una dirección y no en la otra.** Empezar con dos y fusionar
después es sacar un valor del ENUM. Empezar con uno y separar después obliga a decidir
retroactivamente qué contrataron los tenants existentes. **Ante la duda, dos.**

**Consecuencia concreta en el repo:** hay que tocar `on_tenant_created()` para decidir qué
plan (`basico/profesional/premium`) los habilita, igual que hoy hace con
`historial_clinico`/`turnos`/`guarderia`. Esa asignación es decisión comercial (P-01).

### D-17 — Proveedor y cliente: tablas separadas, con vínculo opcional
**DECISIÓN DE PRODUCTO — requiere confirmación ANTES de la primera etapa. Ver P-10.**

Un proveedor y un cliente tienen casi la misma naturaleza: razón social, documento, condición
fiscal, contacto. Y hay solapamiento real: el criadero que trae animales **y** vende
cachorros o alimento, el colega veterinario que deriva pacientes y vende insumos.

**Verificado en el repo:** `clientes` **no** tiene estructura de entidad comercial. Tiene
`full_name`, `dni_cuit`, `phone`, `address`, `email`, `observations`, `deleted`, y de ella
cuelgan `mascotas`, `turnos`, `estadias` e `historial_clinico`. Las tres opciones siguen
abiertas.

| Modelo | Qué implica | Costo |
|---|---|---|
| **A. Tablas separadas** (recomendado) | `proveedor` independiente de `clientes`. | Datos duplicados para quien cumple los dos papeles. |
| **B. Entidad comercial con roles** | Tabla `entidad_comercial` con los datos de contacto, y `clientes` / `proveedor` como roles. Es el modelo normalizado correcto. | **Migra `clientes`, que está en producción con cuatro tablas colgando.** No es aditivo. |
| **C. Reusar `clientes` con bandera** | Una tabla, un flag. | El más barato de escribir y el que más rompe. |

**Se recomienda A, con `proveedor.cliente_id` nullable** para enlazar las dos fichas cuando
son el mismo sujeto real, sin fusionarlas.

**Por qué no C.** `clientes` acá no es "una persona": es **el dueño de una mascota**.
Meter proveedores adentro hace que un distribuidor de alimento aparezca en el selector de
`clientes` al cargar un turno, en `mascotas.client_id`, y en cualquier métrica de "clientes
activos" del dashboard. Esa última es la peor: es una cifra de negocio que se rompe **en
silencio**.

**Por qué no B, hoy.** Es el modelo correcto, y lo digo sin vueltas. El problema es el
momento: obliga a migrar una tabla viva de la que dependen cuatro tablas y tres módulos que
funcionan, a cambio de un beneficio que se cobra recién cuando haya cuentas corrientes de
clientes **y** de proveedores.

**La parte incómoda:** si la respuesta va a ser B, **hay que decidirlo antes de la primera
etapa**. Pasar de A a B con proveedores, compras y lotes cargados es migrar tres tablas más y
reescribir sus FKs compuestas.

### D-18 — Nombres de columna en español para las tablas nuevas
**DECISIÓN TÉCNICA, fácil de revertir antes de la etapa 1.**

El repo es mixto: el core está en inglés (`clientes.full_name`, `mascotas.name`,
`historial_clinico.pet_id`) y `servicios` —la tabla de negocio más reciente— está en español
(`nombre`, `descripcion`, `duracion_minutos`, `requiere_profesional`, `activo`).

**Se elige español** para las tablas nuevas, por tres razones: sigue el precedente más
reciente; el glosario de la sección 1 es en español y la sección 1 existe justamente para que
un concepto tenga un solo nombre en todas las capas; y el mapeo snake↔camel se hace en el
Service (`CLAUDE.md`), así que el nombre de la columna no se filtra a la API.

**Excepción explícita:** las FKs a tablas existentes conservan el nombre del **destino**
cuando eso evita ambigüedad — `mascota_id` apunta a `mascotas.id`, `cliente_id` a
`clientes.id`, `usuario_id` a `usuarios.id`, `historial_id` a `historial_clinico.id`. No se
usan `pet_id` ni `client_id` en tablas nuevas aunque las tablas viejas los usen: dentro del
módulo la consistencia interna vale más que la simetría con el core.

---

## 3. Contexto normativo a verificar con el Colegio Médico Veterinario de la Provincia de Córdoba

**Naturaleza de esta sección.** **No es asesoramiento legal ni una afirmación sobre el derecho
vigente.** Es un conjunto de puntos que aparecieron al relevar el dominio y que **chocan con
prácticas que el dueño describió como habituales**, por lo que tienen impacto de diseño.
Provienen de **resúmenes secundarios**: los textos oficiales no estuvieron accesibles. Dos
búsquedas independientes coincidieron, pero eso no los convierte en verdad legal establecida.

**Acción requerida antes de la etapa de fraccionamiento:** verificar los tres puntos con el
**Colegio Médico Veterinario de la Provincia de Córdoba**, interlocutor natural para un
establecimiento en Córdoba capital. Hasta entonces son hipótesis de contexto.

| # | Punto a verificar | Fuente citada por el relevamiento |
|---|---|---|
| N-1 | Entre las restricciones a la comercialización se prohibiría la **venta de productos veterinarios fraccionados**, junto con la de productos vencidos. | Resolución SENASA 11/2025 (B.O. 10/01/2025), artículo 40. |
| N-2 | Para **alimentos de animales**, la venta fraccionada del producto aprobado proveniente de envases autorizados estaría considerada infracción, y quien fracciona debería estar inscripto en el **Registro Nacional de Firmas de Alimentación Animal**. | Régimen de alimentos para animales. |
| N-3 | Se crearía **SIGTRAZAVET** y se incorporaría la **receta veterinaria electrónica obligatoria**, con mención explícita de animales de compañía. Todo movimiento entre depósitos o establecimientos debería ser informado por quien lo origina y confirmado por quien lo recibe. | Resolución SENASA 654/2026 (B.O. 21/07/2026). |

### 3.1. Qué hace este documento con eso — y nada más que esto

**a. No se decide si el dueño puede o no fraccionar.** No es decisión del analista ni del
sistema. El módulo no habilita ni impide una práctica comercial: registra lo que ocurre.

**b. El fraccionamiento pasa de rutina a hecho registrable.** No cambia el modelo, lo
confirma: movimiento inmutable con quién, cuándo, lote origen, lote destino, rendimiento real
y motivo. Cambia la **prioridad**: la trazabilidad pasa de buena práctica a requisito, y por
eso `lote_padre_id` está en la etapa que crea `lote`, no en la que implementa el
fraccionamiento.

**c. Trazabilidad lote→lote obligatoria.** Reconstruirla después es inviable: los datos de qué
salió de qué no se infieren de un saldo.

**d. Lugar para receta y prescriptor.** Columnas nullable en la línea de venta y en el
movimiento. Sin tabla `receta`, sin validación, sin flujo.

**e. No se integra con SIGTRAZAVET.** Se deja el lugar (D-15), no se construye el puente.

### 3.2. Lo que esto NO significa

- No significa que el sistema bloquee el fraccionamiento. **No lo bloquea.**
- No significa que exija receta. **No la exige**; deja las columnas.
- No significa que haya que registrarse en ningún registro. Eso es decisión del negocio (P-02).
- No significa que el módulo emita, valide o transmita nada a un organismo. **No lo hace.**

La única restricción dura que sí impone es la **prohibición de despachar mercadería vencida**
(RN-LO4), y esa no se apoya en la interpretación de una norma.

---

## 4. Modelo de datos

**Convenciones del módulo, alineadas con lo verificado en 0.1:**

- Toda tabla de negocio lleva `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
  —el mismo `ON DELETE` que usan todas las tablas del repo— y RLS **de solo lectura**.
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. `updated_at` solo en tablas mutables;
  **las del libro mayor no lo llevan porque no se actualizan.**
- PKs `UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- Nombres de columna en español (D-18); FKs a tablas existentes con el nombre del destino
  (`cliente_id`, `mascota_id`, `usuario_id`, `historial_id`, `servicio_id`).
- Las FKs internas del módulo hacia tablas con `tenant_id` son **compuestas** `(id, tenant_id)`,
  siguiendo `20260725000005_usuarios_integridad_referencial.sql`: el lado referenciado necesita
  su `UNIQUE (id, tenant_id)`, y la FK se declara `FOREIGN KEY (x_id, tenant_id) REFERENCES
  tabla(id, tenant_id)`.
- **Consecuencia conocida y ya resuelta en el repo:** las FKs compuestas rompen las pistas de
  embed de PostgREST que nombran una columna, y hay que embeber por **nombre de constraint**.
  Convención: `<tabla_hija>_<rol>_tenant_fkey`, igual que `usuarios_rol_tenant_fkey`.

### 4.1. Precisión numérica — y por qué cada una

**Nunca `float`.** Un total de venta que da `1499.9999999998` es un bug que aparece en el
ticket del cliente. El repo ya usa `NUMERIC` con precisión explícita
(`historial_clinico.weight_kg NUMERIC(6,2)`, `temperature_c NUMERIC(4,1)`).

| Concepto | Tipo | Por qué |
|---|---|---|
| Cantidades de existencia | `NUMERIC(14,3)` | 3 decimales dan **resolución de 1 gramo** expresando en kg, que es lo que muestra la balanza. Menos decimales obliga a expresar el alimento en gramos y a que el usuario tipee 1500 en vez de 1,5. |
| Precios e importes | `NUMERIC(14,2)` | El peso tiene dos decimales; 12 dígitos enteros aguantan la inflación durante la vida útil del sistema. |
| Costos unitarios | `NUMERIC(14,4)` | **4 decimales, no 2.** El costo unitario es un cociente: una bolsa de $45.000 que rinde 14,2 kg da $3.169,0141 por kg. Redondear a 2 en cada conversión acumula error, y en la cadena caja→blíster→comprimido el error se multiplica. |
| Alícuota de IVA | `NUMERIC(5,2)` | 21.00, 10.50, 27.00, 0.00. Como porcentaje, que es como se habla y como se lee. |
| Factor de conversión | `NUMERIC(14,4)` | Una caja de 10 blísters de 12 comprimidos tiene factores enteros; 1 kg → 0,0666 bolsas no. |
| Porcentajes | `NUMERIC(5,2)` | |

**Regla de redondeo del IVA (RN-VT1), definida acá porque después no se discute:** el precio
que se carga y se cobra es el **precio final con IVA incluido**, porque así se exhibe en el
mostrador. La descomposición se calcula por línea:

```
neto_unitario = round(precio_unitario / (1 + alicuota/100), 2)
iva_unitario  = precio_unitario - neto_unitario     -- por diferencia, nunca aparte
importe_linea = round(precio_unitario * cantidad, 2)
```

El IVA **se calcula por diferencia** para que `neto + iva = precio` sea exacto siempre. Si se
calculan y redondean los dos por separado, hay casos donde la suma da un centavo de más y el
total del ticket no cuadra con sus líneas. El total de la venta es la **suma de los importes
de línea ya redondeados**, nunca un recálculo desde los netos.

### 4.2. Catálogos globales

Sin `tenant_id`, en el seed, exactamente como `permisos`, `especies`, `razas` y
`tipos_vacuna`. RLS de solo lectura para autenticados (`auth.uid() IS NOT NULL`), escritura
solo `is_super_admin()`.

#### `unidades_medida`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `codigo` | `TEXT NOT NULL UNIQUE` | `unidad`, `kg`, `g`, `l`, `ml`, `comprimido`, `blister`, `bolsa`, `caja`, `dosis`, `pipeta` |
| `nombre` | `TEXT NOT NULL` | |
| `abreviatura` | `TEXT NOT NULL` | Lo que se muestra al lado de la cantidad. |
| `admite_decimales` | `BOOLEAN NOT NULL` | **Columna central de D-06.d.** |
| `escala_decimal` | `SMALLINT NOT NULL DEFAULT 0` | `CHECK (escala_decimal BETWEEN 0 AND 3)` y `CHECK (admite_decimales OR escala_decimal = 0)`. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

#### `medios_pago`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `codigo` | `TEXT NOT NULL UNIQUE` | `efectivo`, `transferencia`, `debito`, `credito`, `qr`, `cuenta_corriente` |
| `nombre` | `TEXT NOT NULL` | |
| `afecta_arqueo` | `BOOLEAN NOT NULL DEFAULT false` | **Solo `efectivo` en `true`.** Es la columna que hace que D-08 funcione sin implementar cuenta corriente. |
| `requiere_referencia` | `BOOLEAN NOT NULL DEFAULT false` | Transferencia y tarjeta piden número de operación. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

### 4.3. Catálogo del tenant

#### `familias_producto`
`id`, `tenant_id`, `nombre TEXT NOT NULL`, `unidad_base_id UUID NOT NULL REFERENCES
unidades_medida(id) ON DELETE RESTRICT`, `activo`, `created_at`.
`CREATE UNIQUE INDEX uq_familias_tenant_nombre ON familias_producto (tenant_id, lower(nombre))`
—mismo patrón que `uq_servicios_tenant_nombre`—. `UNIQUE (id, tenant_id)` para las FKs
compuestas.

#### `proveedores`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `razon_social` | `TEXT NOT NULL` | |
| `nombre_fantasia` | `TEXT NULL` | |
| `cuit` | `TEXT NULL` | Sin validación de dígito verificador en la primera etapa. |
| `condicion_fiscal` | `condicion_fiscal NULL` | |
| `telefono`, `email`, `direccion`, `contacto_nombre`, `observaciones` | `TEXT NULL` | |
| `cliente_id` | `UUID NULL` | FK compuesta → `clientes (id, tenant_id)`. `ON DELETE SET NULL`. **D-17: vincula, no fusiona.** |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

`UNIQUE INDEX (tenant_id, lower(razon_social))`. `UNIQUE INDEX (tenant_id, cuit) WHERE cuit IS NOT NULL`.
`UNIQUE (id, tenant_id)`. Un proveedor con compras no se borra: `ON DELETE RESTRICT` desde
`compras`, baja lógica con `activo` —igual que `clientes.deleted` y `servicios.activo`—.

#### `productos`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `codigo` | `TEXT NOT NULL` | SKU interno. `UNIQUE (tenant_id, codigo)`. |
| `nombre` | `TEXT NOT NULL` | Incluye la presentación: *"Alimento X Adulto bolsa 15 kg"*. |
| `descripcion` | `TEXT NULL` | |
| `familia_id` | `UUID NULL` | FK compuesta → `familias_producto`. `ON DELETE RESTRICT`. |
| `unidad_medida_id` | `UUID NOT NULL` | FK → `unidades_medida`. `ON DELETE RESTRICT`. **Inmutable tras el primer movimiento** (RN-PR5). |
| `marca` | `TEXT NULL` | |
| `alicuota_iva` | `NUMERIC(5,2) NOT NULL DEFAULT 21.00` | `CHECK (alicuota_iva IN (0, 10.50, 21, 27))`. |
| `condicion_venta` | `condicion_venta_producto NOT NULL DEFAULT 'libre'` | D-14. |
| `controla_lote` | `BOOLEAN NOT NULL DEFAULT true` | Ver 4.5. |
| `controla_vencimiento` | `BOOLEAN NOT NULL DEFAULT true` | |
| `vida_util_post_apertura_dias` | `INTEGER NULL` | **Resuelve el problema de la bolsa abierta.** Propone el vencimiento del hijo al fraccionar. |
| `precio_venta` | `NUMERIC(14,2) NULL` | Precio final con IVA incluido (4.1). `NULL` = no vendible al público. |
| `costo_reposicion` | `NUMERIC(14,4) NULL` | Último costo de compra. **No valúa movimientos** (D-04). |
| `margen_objetivo` | `NUMERIC(5,2) NULL` | Sugiere precio sobre costo de reposición. |
| `stock_minimo` | `NUMERIC(14,3) NULL` | Dispara notificación. |
| `es_vendible` | `BOOLEAN NOT NULL DEFAULT true` | Gasa y jeringa no se venden. |
| `es_consumible_clinico` | `BOOLEAN NOT NULL DEFAULT false` | Habilita seleccionarlo desde el historial clínico. |
| `requiere_frio` | `BOOLEAN NOT NULL DEFAULT false` | **Columna reservada.** Sección 13. |
| `trazable` | `BOOLEAN NOT NULL DEFAULT false` | **Columna reservada.** D-15. |
| `codigo_barras` | `TEXT NULL` | **Columna reservada.** `UNIQUE (tenant_id, codigo_barras) WHERE codigo_barras IS NOT NULL`. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

`UNIQUE (id, tenant_id)`. Índices: `(tenant_id, activo)`, `(tenant_id, lower(nombre))`,
`(tenant_id, familia_id)`. Un producto **nunca se borra**: `ON DELETE RESTRICT` desde todos
lados y baja lógica.

#### `producto_conversiones`
La relación padre→hijo. **Reemplaza al factor de unidad descartado en D-06.**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `producto_origen_id` | `UUID NOT NULL` | FK compuesta → `productos`. `ON DELETE RESTRICT`. |
| `producto_destino_id` | `UUID NOT NULL` | FK compuesta → `productos`. `ON DELETE RESTRICT`. |
| `factor_teorico` | `NUMERIC(14,4) NOT NULL` | `CHECK (> 0)`. Unidades de destino que rinde **una** de origen. Bolsa 15 kg → kg: `15.0000`. |
| `merma_esperada_porcentaje` | `NUMERIC(5,2) NOT NULL DEFAULT 0` | Pre-carga la cantidad obtenida y calcula el desvío. |
| `activo` | `BOOLEAN NOT NULL DEFAULT true` | |

- `UNIQUE (tenant_id, producto_origen_id, producto_destino_id)`.
- `CHECK (producto_origen_id <> producto_destino_id)`.
- **Trigger anti-ciclo (RN-FR2):** un CTE recursivo verifica que el destino no alcance al
  origen por ninguna cadena. Sin esto, el multi-nivel gratis de D-06 se vuelve un bucle
  infinito en el reporte de familia la primera vez que alguien cargue comprimido→caja por
  error.
- **No hay columna `nivel`.** La profundidad es una propiedad del grafo, no un atributo.

### 4.4. Existencias

#### `lotes`
Portador del costo y unidad de trazabilidad.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `producto_id` | `UUID NOT NULL` | FK compuesta. `ON DELETE RESTRICT`. |
| `codigo_lote` | `TEXT NULL` | Número del fabricante. **Etiqueta, no identidad.** |
| `fecha_vencimiento` | `DATE NULL` | Obligatoria si `productos.controla_vencimiento` (RN-LO2). |
| `fecha_ingreso` | `DATE NOT NULL DEFAULT CURRENT_DATE` | Desempate secundario de FEFO. |
| `costo_unitario_neto` | `NUMERIC(14,4) NOT NULL` | Sin IVA. |
| `costo_unitario_efectivo` | `NUMERIC(14,4) NOT NULL` | El que valúa los movimientos. Neto o neto+IVA según configuración (D-04). **Se congela al crear el lote.** |
| `lote_padre_id` | `UUID NULL` | FK compuesta autorreferencial. `ON DELETE RESTRICT`. **D-13.** |
| `origen` | `origen_lote NOT NULL` | `compra`, `conversion`, `ajuste`, `devolucion`, `inicial`. |
| `compra_item_id` | `UUID NULL` | FK compuesta. `ON DELETE RESTRICT`. |
| `proveedor_id` | `UUID NULL` | Denormalizado desde la compra: *"todos los lotes de este proveedor"* es la consulta de un retiro de mercadería y derivarla obliga a dos joins. |
| `estado` | `estado_lote NOT NULL DEFAULT 'disponible'` | `disponible`, `bloqueado`, `dado_de_baja`. |
| `motivo_bloqueo` | `TEXT NULL` | `CHECK (estado <> 'bloqueado' OR motivo_bloqueo IS NOT NULL)` — mismo patrón que el CHECK de `mascotas` para `deceased_date`. |
| `usuario_id` | `UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Decisiones deliberadas:**

- **No hay `UNIQUE` sobre `codigo_lote`.** Dos compras del mismo lote de fabricante a distinto
  costo generan **dos filas**, porque el lote es el portador del costo. El código se indexa
  para búsqueda, no para unicidad.
- **`vencido` y `agotado` no son estados.** Se derivan de `fecha_vencimiento < CURRENT_DATE` y
  de `existencia = 0`. Guardar un estado derivado es el mismo error que guardar `stock_actual`.
- `UNIQUE (id, tenant_id)`. Índices: `(tenant_id, producto_id, fecha_vencimiento)` para FEFO;
  `(tenant_id, codigo_lote)`; `(tenant_id, lote_padre_id)`;
  `(tenant_id, fecha_vencimiento) WHERE estado = 'disponible'`.

#### `movimientos_stock` — el libro mayor
**Append-only. Sin `UPDATE`. Sin `DELETE`. Sin excepciones.**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `operacion_id` | `UUID NOT NULL` | Agrupa los movimientos de un mismo acto. |
| `tipo` | `tipo_movimiento_stock NOT NULL` | Ver 9.1. |
| `producto_id` | `UUID NOT NULL` | Denormalizado desde el lote: ahorra un join en la tabla más grande del módulo. |
| `lote_id` | `UUID NOT NULL` | FK compuesta → `lotes`. `ON DELETE RESTRICT`. |
| `cantidad` | `NUMERIC(14,3) NOT NULL` | `CHECK (cantidad > 0)`. **Siempre positiva.** |
| `cantidad_con_signo` | `NUMERIC(14,3) GENERATED ALWAYS AS (cantidad * signo_movimiento(tipo)) STORED` | El signo lo determina el tipo, no quien inserta. Elimina la posibilidad de una "entrada negativa". |
| `costo_unitario` | `NUMERIC(14,4) NOT NULL DEFAULT 0` | **Costo efectivo, congelado.** |
| `costo_total` | `NUMERIC(14,2) NOT NULL DEFAULT 0` | `round(cantidad * costo_unitario, 2)`. Cero en `merma_fraccionamiento` (D-06.b). |
| `motivo` | `TEXT NULL` | Obligatorio según tipo (RN-AJ1). |
| `fefo_respetado` | `BOOLEAN NULL` | Solo en salidas. `false` exige motivo. |
| `venta_item_id`, `compra_item_id`, `recuento_id` | `UUID NULL` | FKs compuestas. `ON DELETE RESTRICT`. |
| `lote_destino_id` | `UUID NULL` | Solo en `salida_conversion`. Redundante con `lotes.lote_padre_id` y **deliberado**: permite recorrer la cadena en las dos direcciones sin invertir el índice. |
| `historial_id` | `UUID NULL` | → `historial_clinico`. Consumo clínico. |
| `plan_vacunacion_id` | `UUID NULL` | → `plan_vacunacion`. |
| `mascota_id` | `UUID NULL` | Denormalizado. Trazabilidad lote→animal (RN-CC4). |
| `receta_id`, `profesional_prescriptor_id` | `UUID NULL` | **Reservadas.** D-14. Sin FK hasta que exista la tabla. |
| `trazabilidad_estado` | `estado_trazabilidad NOT NULL DEFAULT 'no_aplica'` | **Reservada.** D-15. |
| `trazabilidad_referencia_externa` | `TEXT NULL` | **Reservada.** |
| `deposito_id` | `UUID NULL` | **Dimensión reservada.** Sección 13.1. |
| `usuario_id` | `UUID NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**CHECK de coherencia documental:** a lo sumo una de
`(venta_item_id, compra_item_id, recuento_id, historial_id)` puede estar presente, y tiene que
ser la que corresponde al `tipo`. Un `salida_venta` sin `venta_item_id` es un bug que la base
rechaza, no un caso a validar en el Service.

**Se eligieron FKs nullable explícitas en vez de un par polimórfico `(origen_tipo, origen_id)`**
porque las nullable conservan integridad referencial real —la base garantiza que el
`venta_item_id` existe y es del mismo tenant— mientras que un `origen_id` sin FK es una
promesa que nadie verifica. El costo es un puñado de columnas vacías por fila.

**Inmutabilidad, en dos capas:** (1) `authenticated` ya no tiene `UPDATE`/`DELETE` por el
hardening de julio; (2) un trigger `BEFORE UPDATE OR DELETE` que hace `RAISE EXCEPTION
'MOVEMENT_IMMUTABLE'`, **porque los Services escriben con `service_role`, que sí podría
actualizar**. La segunda capa no es redundante acá: es la única que frena al camino real de
escritura.

Índices: `(tenant_id, lote_id, created_at)` —el que sostiene la reconstrucción—,
`(tenant_id, producto_id, created_at)`, `(tenant_id, operacion_id)`,
`(tenant_id, tipo, created_at)`, `(tenant_id, historial_id) WHERE historial_id IS NOT NULL`.

#### `existencias_lote` — caché derivada
| Columna | Tipo | Notas |
|---|---|---|
| `lote_id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `producto_id` | `UUID NOT NULL` | Permite bloquear y consultar por producto sin join. |
| `cantidad` | `NUMERIC(14,3) NOT NULL DEFAULT 0` | `CHECK (cantidad >= 0)` — **la última red.** |
| `actualizado_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Mantenida **exclusivamente** por un trigger `AFTER INSERT ON movimientos_stock`.
- Es la fila que se bloquea con `FOR UPDATE` en los RPC (D-11).
- `recalcular_existencias(p_tenant_id, p_producto_id DEFAULT NULL)` la reconstruye;
  `verificar_existencias(p_tenant_id)` devuelve los lotes donde difiere de la suma.
- **RLS de solo lectura como todas.** No hay política de escritura para ningún rol; el trigger
  corre con los privilegios del `INSERT` sobre `movimientos_stock`.

### 4.5. Productos sin control de lote
Un collar no tiene lote ni vencimiento, pero el libro mayor necesita un `lote_id` para que no
haya dos caminos de descuento. Si `controla_lote = false`, cada compra crea un lote genérico
(`codigo_lote NULL`, `fecha_vencimiento NULL`) y todos los movimientos van ahí. **No se
"actualiza" el costo de un lote genérico existente**: el lote es inmutable en su costo, así que
cada compra a distinto costo crea uno nuevo. El usuario no ve la diferencia; el libro mayor
mantiene el costo correcto (RN-LO3).

### 4.6. Compras

#### `compras`
`id`, `tenant_id`, `proveedor_id` (FK compuesta, `ON DELETE RESTRICT`), `fecha DATE NOT NULL`,
`comprobante_proveedor_tipo TEXT NULL`, `comprobante_proveedor_numero TEXT NULL`,
`total_neto`, `total_iva`, `total` (`NUMERIC(14,2) NOT NULL DEFAULT 0`),
`estado estado_compra NOT NULL DEFAULT 'borrador'`, `genera_egreso_caja BOOLEAN NOT NULL DEFAULT false`,
`sesion_caja_id UUID NULL`, `observaciones TEXT NULL`, `usuario_id`, `created_at`, `updated_at`.

`UNIQUE INDEX (tenant_id, proveedor_id, comprobante_proveedor_numero) WHERE comprobante_proveedor_numero IS NOT NULL`
— evita cargar dos veces la misma factura, que es el error de carga más común.

**El borrador no mueve existencias.** Lotes y movimientos se crean al **confirmar**, en un solo
RPC. Una compra confirmada no se edita: se anula con contra-asientos, y solo si ningún lote
suyo tuvo salidas (RN-CM3).

#### `compras_items`
`id`, `tenant_id`, `compra_id` (FK compuesta, **`ON DELETE CASCADE` — el único CASCADE del
módulo**: un ítem de un borrador no tiene vida propia), `producto_id` (FK compuesta,
`ON DELETE RESTRICT`), `cantidad NUMERIC(14,3) CHECK (> 0)`,
`costo_unitario_neto NUMERIC(14,4) NOT NULL`, `alicuota_iva NUMERIC(5,2) NOT NULL`,
`codigo_lote TEXT NULL`, `fecha_vencimiento DATE NULL`,
`importe_neto`, `importe_iva`, `importe_total NUMERIC(14,2)`.

### 4.7. Ventas

#### `ventas`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id` | `UUID NOT NULL` | |
| `numero_operacion` | `BIGINT NOT NULL` | Correlativo por tenant. `UNIQUE (tenant_id, numero_operacion)`. **No es un número de comprobante** (D-03). |
| `cliente_id` | `UUID NULL` | `NULL` = venta de mostrador anónima. FK compuesta → `clientes`. `ON DELETE RESTRICT`. |
| `condicion_fiscal_snapshot` | `condicion_fiscal NULL` | Copiada del cliente. |
| `documento_snapshot` | `TEXT NULL` | Copia de `clientes.dni_cuit`. |
| `sesion_caja_id` | `UUID NOT NULL` | FK compuesta. `ON DELETE RESTRICT`. **Toda venta pertenece a una sesión**, aunque no mueva efectivo: es lo que responde *"qué se vendió en el turno de la tarde"*. |
| `condicion_pago` | `condicion_pago_venta NOT NULL DEFAULT 'contado'` | D-08. |
| `subtotal_neto`, `total_iva`, `descuento_importe`, `total`, `saldo_pendiente` | `NUMERIC(14,2) NOT NULL` | |
| `estado` | `estado_venta NOT NULL DEFAULT 'registrada'` | `registrada`, `anulada`. |
| `anulada_at`, `anulada_por_usuario_id`, `motivo_anulacion` | | |
| `comprobante_tipo`, `comprobante_punto_venta`, `comprobante_numero`, `cae`, `cae_vencimiento` | | **Reservadas, sin uso.** |
| `facturacion_estado` | `estado_facturacion NOT NULL DEFAULT 'no_facturada'` | **Reservada.** |
| `observaciones` | `TEXT NULL` | |
| `usuario_id`, `created_at` | | Sin `updated_at`: una venta registrada no se edita. |

**Sobre `numero_operacion`:** se implementa con una fila de contador
(`contadores_tenant (tenant_id, nombre, valor)`) bloqueada con `FOR UPDATE` dentro del mismo
RPC, **no con una `SEQUENCE`**. Motivo: una sequence no es transaccional y deja huecos cuando
una transacción falla, y un correlativo interno con huecos genera preguntas del tipo *"¿dónde
está la venta 341?"* que no tienen buena respuesta. **Costo aceptado:** las ventas de un mismo
tenant se serializan en ese contador; para una clínica con uno o dos mostradores es
irrelevante, y el día que se facture el correlativo sin huecos será un requisito.

#### `ventas_items`
`id`, `tenant_id`, `venta_id` (FK compuesta, `ON DELETE RESTRICT`),
`tipo_item tipo_item_venta NOT NULL`, `producto_id UUID NULL`, `servicio_id UUID NULL`,
`descripcion_snapshot TEXT NOT NULL`, `cantidad NUMERIC(14,3) CHECK (> 0)`,
`precio_unitario NUMERIC(14,2) NOT NULL` (con IVA incluido),
`alicuota_iva NUMERIC(5,2) NOT NULL` (**copiada, no referenciada**),
`descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0`,
`neto_unitario`, `iva_unitario`, `importe_total NUMERIC(14,2) NOT NULL`,
`costo_unitario_efectivo NUMERIC(14,4) NULL` (solo productos; promedio ponderado de los
movimientos de la línea, **guardado** para el reporte de margen),
`mascota_id UUID NULL`, `receta_id`, `profesional_prescriptor_id` (**reservadas**).

`CHECK ((tipo_item = 'producto' AND producto_id IS NOT NULL AND servicio_id IS NULL) OR
(tipo_item = 'servicio' AND servicio_id IS NOT NULL AND producto_id IS NULL))`.

**La línea no tiene `lote_id`, y es a propósito.** Una línea de 5 unidades puede resolverse
tomando 3 de un lote y 2 de otro por FEFO. La asignación vive en `movimientos_stock`, con N
movimientos por línea. Poner `lote_id` en la línea obligaría a partirla en dos y el cliente
vería dos renglones del mismo producto en su ticket sin entender por qué.

#### `ventas_pagos`
`id`, `tenant_id`, `venta_id` (FK compuesta, `ON DELETE RESTRICT`),
`medio_pago_id UUID NOT NULL REFERENCES medios_pago(id)`, `importe NUMERIC(14,2) CHECK (> 0)`,
`referencia TEXT NULL` (obligatoria si `medios_pago.requiere_referencia`), `created_at`.
Pago mixto = varias filas. `SUM(importe) + saldo_pendiente = ventas.total` (RN-CJ1).

### 4.8. Caja

#### `cajas`
`id`, `tenant_id`, `nombre`, `activa`. `UNIQUE INDEX (tenant_id, lower(nombre))`.
`UNIQUE (id, tenant_id)`. Una clínica chica tiene una fila; la tabla existe para no tener que
inventarla cuando abran el segundo mostrador.

#### `sesiones_caja`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id`, `caja_id` | | FK compuesta. `ON DELETE RESTRICT`. |
| `estado` | `estado_sesion_caja NOT NULL DEFAULT 'abierta'` | |
| `apertura_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `apertura_usuario_id` | `UUID NOT NULL` | |
| `saldo_inicial` | `NUMERIC(14,2) NOT NULL CHECK (>= 0)` | |
| `cierre_at`, `cierre_usuario_id` | | |
| `saldo_teorico_efectivo` | `NUMERIC(14,2) NULL` | Calculado y **congelado** al cerrar. |
| `efectivo_contado` | `NUMERIC(14,2) NULL` | Lo declarado por el usuario. |
| `diferencia` | `NUMERIC(14,2) NULL` | `efectivo_contado − saldo_teorico_efectivo`. **Se guarda siempre, incluso en cero.** |
| `motivo_diferencia`, `observaciones` | `TEXT NULL` | |

`CREATE UNIQUE INDEX uq_sesion_caja_abierta ON sesiones_caja (tenant_id, caja_id) WHERE estado = 'abierta'`
— **índice parcial único**: garantiza en la base, no en el Service, que no hay dos sesiones
abiertas en la misma caja. Es el mismo recurso que usa `uq_servicios_tenant_nombre`.

#### `movimientos_caja`
Libro mayor del efectivo. **Append-only, mismo criterio y mismo trigger.**
`id`, `tenant_id`, `sesion_caja_id` (FK compuesta, `ON DELETE RESTRICT`),
`tipo tipo_movimiento_caja NOT NULL`, `medio_pago_id UUID NOT NULL`,
`importe NUMERIC(14,2) CHECK (> 0)` (signo derivado del tipo),
`venta_id`, `compra_id UUID NULL`, `motivo TEXT NULL`, `usuario_id`, `created_at`.

Saldo teórico de efectivo: `saldo_inicial + SUM(importe * signo)` sobre los movimientos cuyo
medio de pago tiene `afecta_arqueo = true`. Los pagos con tarjeta se registran igual —hacen
falta para el total vendido— pero no entran al arqueo. Ahí D-08 se paga sola.

### 4.9. Recuento físico
`recuentos`: `id`, `tenant_id`, `fecha`, `estado estado_recuento NOT NULL DEFAULT 'borrador'`,
`familia_id`/`producto_id` opcionales como alcance, `usuario_id`, `aplicado_at`,
`aplicado_por_usuario_id`, `observaciones`.

`recuentos_detalle`: `id`, `tenant_id`, `recuento_id`, `lote_id`, `cantidad_sistema`
(congelada **al aplicar**, no al crear el borrador), `cantidad_contada`, `diferencia`, `motivo`.

**Sutileza que hay que implementar bien:** entre que se empieza a contar y que se aplica se
sigue vendiendo. Si `cantidad_sistema` se congela al abrir el borrador, se generan ajustes que
borran ventas reales. Se recalcula al aplicar y, si cambió respecto de lo que vio el usuario,
el RPC devuelve advertencia con los lotes que se movieron y exige confirmación (RN-AJ3).

### 4.10. Devoluciones
No hay tabla nueva. Una devolución es una **operación** que genera `entrada_devolucion` al lote
original —o a un lote nuevo bloqueado si no es revendible— y, si se reintegra dinero, un
`egreso_devolucion` en la caja. Se valida contra lo vendido (RN-AJ4).

### 4.11. `configuracion_tenant` — claves nuevas

El repo usa columnas tipadas (`cupo_maximo_diario`, `dias_aviso_vacuna`) más
`parametros_extra JSONB`. **Se proponen columnas tipadas**, por coherencia y porque todas se
leen en caminos de validación donde un `->>` sin tipo es una fuente de bugs silenciosos.

| Columna | Tipo | Default | Para qué |
|---|---|---|---|
| `iva_compras_es_costo` | `BOOLEAN NOT NULL` | `true` | D-04. Composición del costo del lote. |
| `dias_alerta_vencimiento` | `INTEGER NOT NULL CHECK (BETWEEN 1 AND 365)` | `60` | Alerta y notificación. |
| `tolerancia_rendimiento_porcentaje` | `NUMERIC(5,2) NOT NULL` | `10.00` | D-06.a. Umbral de advertencia. |
| `tolerancia_diferencia_arqueo` | `NUMERIC(14,2) NOT NULL` | `0.00` | Encima de esto, motivo obligatorio. |
| `permitir_venta_sin_existencia` | `BOOLEAN NOT NULL` | `false` | Que sea una bandera y no un parche. |
| `exigir_receta_bloqueante` | `BOOLEAN NOT NULL` | `false` | D-14. Advertencia → bloqueo, sin migración. |

**La zona horaria NO se agrega acá.** Es una decisión transversal del sistema (afecta también a
turnos y estadías) y no le corresponde a este módulo introducirla. Se anota como riesgo R-11.

### 4.12. Vistas

| Vista | Para qué | Advertencia |
|---|---|---|
| `v_existencia_producto` | Existencia total por producto sumando sus lotes disponibles. | |
| `v_lotes_por_vencer` | Lotes con existencia > 0 que vencen dentro de N días. | Alimenta notificaciones. |
| `v_items_vendidos` | `UNION ALL` de líneas de producto y de servicio, normalizadas. | Es todo el costo de no fusionar los catálogos (D-10). |
| `v_stock_familia_unidad_base` | *"¿Cuánta amoxicilina tengo en total?"*, sumando en la unidad base vía `factor_teorico`. | **SOLO REPORTE. Cualquier uso en un camino de escritura es un bug** (RN-FR12). Lleva `COMMENT ON VIEW` diciéndolo. |
| `v_costo_fraccionamiento` | Merma acumulada y sobrecosto por producto origen. | D-06.a. |
| `v_margen_venta` | Margen por línea usando el costo efectivo guardado. | Nunca recalcula costo. |

### 4.13. RLS de las tablas nuevas

Siguiendo `20260725000003_hardening_authenticated_rls.sql` al pie de la letra:

```sql
ALTER TABLE movimientos_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_movimientos_stock_lectura ON movimientos_stock FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id = current_tenant_id()
    AND usuario_activo()
    AND tiene_permiso('view_stock')
  );
```

- **Sin `FORCE ROW LEVEL SECURITY`.** Los RPC son `SECURITY DEFINER` y su dueño es el
  propietario de las tablas; forzar RLS los rompería. La v0.2 pedía `FORCE` por analogía con
  otro tipo de arquitectura; acá está mal y se corrige.
- **Sin políticas de escritura.** `authenticated` no tiene `INSERT/UPDATE/DELETE` desde el
  hardening; toda escritura pasa por la Edge Function con `service_role`.
- **Sin `GRANT` propio.** `ALTER DEFAULT PRIVILEGES` ya cubre las tablas nuevas.
- Cada tabla usa el permiso que le corresponde: `view_stock` para catálogo, lotes y
  movimientos; `manage_sales` para ventas; `manage_cash` para caja; `manage_suppliers` para
  proveedores y compras.

---

## 5. RPCs transaccionales

Todos siguen el patrón de `registrar_eutanasia`, que es el que el repo ya usa y probó:

- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`.
- **`p_tenant_id UUID` como primer parámetro**, tomado de `ctx.tenantId` en el Service.
  Filtrado explícito por él en **cada** lectura y escritura del cuerpo.
- `p_usuario_id UUID` del caller, para el asiento de auditoría.
- Errores de negocio con `RAISE EXCEPTION '<ERROR_CODE>'`; el Service los mapea a
  `DomainError`.
- **Asiento de auditoría con `INSERT INTO registros_auditoria` dentro de la misma
  transacción** — no `recordAudit` posterior desde el Service, que es best-effort.
- Cierre de la migración: `REVOKE ALL ON FUNCTION … FROM PUBLIC;`
  `GRANT EXECUTE ON FUNCTION … TO service_role;` y **`NOTIFY pgrst, 'reload schema';`**.

**Regla transversal (D-11):** el Service arma la intención y llama. El Service **no** lee
existencias para decidir. Si en una revisión aparece un `SELECT` de existencia seguido de una
escritura desde TypeScript, es un defecto aunque pase las pruebas.

| RPC | Qué hace | Etapa |
|---|---|---|
| `confirmar_compra` | Crea lotes desde los ítems, inserta `entrada_compra`, actualiza `costo_reposicion`, genera egreso de caja si corresponde. | C2 |
| `registrar_venta` | Numera, valida, asigna lotes por FEFO, descuenta, cobra, mueve caja. | C3 |
| `anular_venta` | Contra-asientos de existencia y de caja. No borra nada. | C3 |
| `abrir_sesion_caja` / `cerrar_sesion_caja` / `registrar_movimiento_caja` | Caja. El cierre es irreversible. | C3 |
| `ajustar_existencia` | Ajustes y mermas con motivo obligatorio. | C4 |
| `aplicar_recuento` | Genera todos los ajustes en una operación. | C4 |
| `registrar_devolucion` | Devolución con reintegro opcional. | C4 |
| `fraccionar_lote` | **La operación central del módulo.** | C5 |
| `registrar_consumo_clinico` | Salida atada a un evento clínico. | C6 |
| `recalcular_existencias` / `verificar_existencias` | Mantenimiento y conciliación. | C2 |

### 5.1. `registrar_venta` — esqueleto

```
BEGIN
  -- 1. Validaciones sin bloqueo
  sesión de caja abierta y del tenant            -> CASH_SESSION_REQUIRED
  al menos un ítem                               -> SALE_WITHOUT_ITEMS
  productos activos y vendibles / servicios activos -> PRODUCT_INACTIVE
  medios de pago activos y referencias           -> PAYMENT_REFERENCE_REQUIRED

  -- 2. Asignación FEFO
  FOR cada ítem de tipo producto LOOP
      lotes candidatos ordenados por FEFO
      si el usuario forzó un lote distinto: exigir motivo -> FEFO_OVERRIDE_WITHOUT_REASON
  END LOOP;

  -- 3. BLOQUEO. Todos los lotes en un solo SELECT, ORDENADOS POR lote_id.
  SELECT ... FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = ANY(v_lotes)
   ORDER BY lote_id
     FOR UPDATE;

  -- 4. Validaciones sobre el valor ya bloqueado
  existencia suficiente por lote                 -> INSUFFICIENT_STOCK
  lote no vencido                                -> BATCH_EXPIRED
  lote no bloqueado                              -> BATCH_BLOCKED

  -- 5. Numeración: contador del tenant, bloqueado
  UPDATE contadores_tenant SET valor = valor + 1
   WHERE tenant_id = p_tenant_id AND nombre = 'venta'
  RETURNING valor INTO v_numero;

  -- 6. Escrituras
  INSERT ventas / ventas_items / movimientos_stock (uno por lote asignado) / ventas_pagos
  INSERT movimientos_caja por cada pago
  guardar ventas_items.costo_unitario_efectivo
  SUM(pagos) + saldo_pendiente = total          -> PAYMENT_MISMATCH

  -- 7. Auditoría, misma transacción
  INSERT INTO registros_auditoria (tenant_id, user_id, user_name, user_role,
    action, module, entity_id, new_values)
  VALUES (p_tenant_id, p_usuario_id, v_user_name, v_user_role,
    'CREATE', 'sales', v_venta_id::text, jsonb_build_object(...));

  RETURN QUERY SELECT ...;
END;
```

**El bloqueo ordenado por `lote_id` no es un detalle de estilo.** Dos ventas simultáneas que
toquen los lotes A y B en orden inverso se bloquean mutuamente y una muere por deadlock.
Ordenar siempre por la misma clave lo elimina.

**Resolución del nombre y rol del usuario:** igual que `registrar_eutanasia`, con
`SELECT u.full_name, COALESCE(r.display_name, r.name) FROM usuarios u LEFT JOIN roles r …`,
que `SECURITY DEFINER` puede hacer sin RLS de por medio.

### 5.2. `fraccionar_lote` — la operación central

```
fraccionar_lote(
  p_tenant_id UUID, p_usuario_id UUID,
  p_lote_origen_id UUID, p_producto_destino_id UUID,
  p_cantidad_origen NUMERIC, p_cantidad_obtenida NUMERIC,
  p_fecha_vencimiento_destino DATE, p_codigo_lote_destino TEXT, p_motivo TEXT
) RETURNS TABLE (...)
```

```
BEGIN
  v_operacion := gen_random_uuid();

  conversión (origen -> destino) activa del tenant   -> CONVERSION_NOT_DEFINED
  decimales según la unidad de cada producto         -> UNIT_NO_DECIMALS

  SELECT ... FROM existencias_lote
   WHERE tenant_id = p_tenant_id AND lote_id = p_lote_origen_id FOR UPDATE;
  existencia suficiente                              -> INSUFFICIENT_STOCK
  lote origen no vencido ni bloqueado                -> BATCH_EXPIRED / BATCH_BLOCKED

  v_teorico := p_cantidad_origen * conversion.factor_teorico;
  p_cantidad_obtenida > 0 y <= v_teorico             -> INVALID_YIELD
      -- obtener MÁS que el teórico no es rendimiento: es error de carga o factor mal cargado

  v_desvio := (v_teorico - p_cantidad_obtenida) / v_teorico * 100;
  si v_desvio > tolerancia y p_motivo IS NULL        -> REASON_REQUIRED
      -- advierte, NO bloquea (D-06.a)

  -- Vencimiento del hijo
  v_sugerido := LEAST(lote_origen.fecha_vencimiento,
                      CURRENT_DATE + producto_destino.vida_util_post_apertura_dias);
  p_fecha_vencimiento_destino <= lote_origen.fecha_vencimiento -> EXPIRY_AFTER_PARENT

  -- Costo heredado (D-06.b)
  v_costo_consumido := p_cantidad_origen * lote_origen.costo_unitario_efectivo;
  v_costo_hijo      := v_costo_consumido / p_cantidad_obtenida;   -- sube si rindió menos

  INSERT INTO lotes (..., lote_padre_id = p_lote_origen_id,
                     costo_unitario_efectivo = v_costo_hijo, origen = 'conversion')
    RETURNING id INTO v_lote_hijo;

  INSERT movimientos_stock (tipo='salida_conversion', lote=origen,
    cantidad=p_cantidad_origen, costo_total=v_costo_consumido,
    lote_destino_id=v_lote_hijo, operacion_id=v_operacion);

  INSERT movimientos_stock (tipo='entrada_conversion', lote=v_lote_hijo,
    cantidad=p_cantidad_obtenida, costo_unitario=v_costo_hijo, operacion_id=v_operacion);

  IF p_cantidad_obtenida < v_teorico THEN
    INSERT movimientos_stock (tipo='merma_fraccionamiento', lote=v_lote_hijo,
      cantidad=v_teorico - p_cantidad_obtenida,
      costo_unitario=0, costo_total=0,          -- D-06.b
      motivo=p_motivo, operacion_id=v_operacion);
  END IF;

  INSERT INTO registros_auditoria (... action='CREATE', module='inventory',
    entity_id=v_operacion::text, new_values=jsonb_build_object(
      'lote_origen', p_lote_origen_id, 'lote_destino', v_lote_hijo,
      'cantidad_origen', p_cantidad_origen, 'cantidad_obtenida', p_cantidad_obtenida,
      'desvio_porcentaje', v_desvio, 'costo_unitario_hijo', v_costo_hijo));
END;
```

**Los dos puntos donde esto se implementa mal:**

1. Dividir el costo por `v_teorico` en vez de por `p_cantidad_obtenida`. Da un costo prolijo y
   equivocado, y hace desaparecer el costo de fraccionar.
2. Imputarle costo a la merma. Cuenta el mismo peso dos veces y sobrevalúa el inventario.

**La merma se registra sobre el lote hijo, en unidades de destino.** Es la única forma de que
la resta cierre y es donde el usuario la ve (*"esperaba 15 kg, saqué 14,2"*).

### 5.3. `cerrar_sesion_caja`

```
SELECT ... FROM sesiones_caja
 WHERE id = p_sesion_id AND tenant_id = p_tenant_id FOR UPDATE;
estado = 'abierta'                                   -> CASH_SESSION_CLOSED

v_teorico := saldo_inicial + SUM(mov.importe * signo_movimiento_caja(mov.tipo))
             FROM movimientos_caja mov JOIN medios_pago mp ON mp.id = mov.medio_pago_id
             WHERE mov.sesion_caja_id = p_sesion_id AND mp.afecta_arqueo;

v_diferencia := p_efectivo_contado - v_teorico;
IF abs(v_diferencia) > tolerancia AND p_motivo IS NULL -> REASON_REQUIRED

UPDATE sesiones_caja SET estado='cerrada', cierre_at=now(),
  saldo_teorico_efectivo=v_teorico, efectivo_contado=p_efectivo_contado,
  diferencia=v_diferencia, motivo_diferencia=p_motivo;

INSERT INTO registros_auditoria (... action='UPDATE', module='cash_register', ...);
```

`saldo_teorico_efectivo` se **congela**. Si mañana aparece un movimiento que faltaba cargar, el
teórico de esa sesión no cambia: el ajuste va a la sesión siguiente. Una cifra de arqueo que se
recalcula sola no sirve para controlar a nadie.

---

## 6. Reglas de negocio

**Formato del Documento Maestro**, con prefijo por subdominio como el resto del sistema
(`RN-TU`, `RN-GU`, `RN-EC`…). Prefijos nuevos, verificados como libres contra los 27 existentes:

| Prefijo | Subdominio | Rango |
|---|---|---|
| `RN-PR` | Productos, familias y unidades | 1–12 |
| `RN-PRV` | Proveedores | 1–3 |
| `RN-MV` | Movimientos y existencias | 1–12 |
| `RN-LO` | Lotes, vencimiento y FEFO | 1–8 |
| `RN-CM` | Compras | 1–5 |
| `RN-VT` | Ventas e IVA | 1–8 |
| `RN-CJ` | Caja | 1–9 |
| `RN-FR` | Fraccionamiento | 1–13 |
| `RN-AJ` | Ajustes, mermas, recuento y devoluciones | 1–7 |
| `RN-CC` | Consumo clínico, receta y trazabilidad | 1–5 |
| `RN-SC` | Seguridad, permisos, auditoría y concurrencia | 1–8 |

Cada RN incluye su test porque **una regla cuyo test no se sabe escribir está mal redactada** y
hay que reescribirla antes de implementarla. El nombre del test cita el código, según
`CLAUDE.md`.

### 6.1. Productos, familias y unidades

**RN-PR1 (código único).** Dos productos del mismo tenant no comparten `codigo`; dos tenants sí pueden usar el mismo. → `409 PRODUCT_CODE_DUPLICATE`
*Test:* duplicado en un tenant falla; en dos tenants distintos funciona.

**RN-PR2 (no se borra).** Un producto con movimientos, lotes o líneas de venta no se elimina; la baja es lógica (`activo = false`). → `409 PRODUCT_IN_USE`
*Test:* borrar un producto con un movimiento falla por FK.

**RN-PR3 (inactivo no opera).** Un producto inactivo no se vende, no se compra, no se consume y no se fracciona; su historia y sus reportes siguen intactos. → `422 PRODUCT_INACTIVE`
*Test:* desactivar con existencia → la venta falla y el reporte histórico sigue devolviendo sus movimientos.

**RN-PR4 (alícuota válida).** Obligatoria y dentro del conjunto admitido (0 · 10,50 · 21 · 27). → `422 INVALID_TAX_RATE`
*Test:* alta con alícuota 15,00 falla.

**RN-PR5 (unidad inmutable).** La unidad de medida no cambia después del primer movimiento del producto: cambiar de "unidad" a "kg" con existencias reinterpreta silenciosamente todo el historial. → `409 UNIT_IMMUTABLE`
*Test:* con un movimiento, el cambio falla; sin movimientos, se permite.

**RN-PR6 (decimales según unidad).** Si la unidad no admite fracción, toda cantidad —compra, venta, ajuste, conversión, recuento— es entera. Se valida en la base, no solo en la aplicación. → `422 UNIT_NO_DECIMALS`
*Test:* vender 1,5 comprimidos falla; 1,5 kg de alimento suelto funciona.

**RN-PR7 (escala coherente).** `escala_decimal` entre 0 y 3, y 0 cuando `admite_decimales = false`. → `422 UNIT_INVALID_SCALE`
*Test:* escala 4 falla; `admite_decimales=false` con escala 2 falla.

**RN-PR8 (familia con unidad base).** Sin unidad base no se puede agregar en reportes. → `422 FAMILY_WITHOUT_BASE_UNIT`
*Test:* alta de familia sin `unidad_base_id` falla.

**RN-PR9 (vendible con precio).** Un producto sin `precio_venta` no puede incluirse en una venta. → `422 PRODUCT_WITHOUT_PRICE`
*Test:* venta de un producto sin precio falla.

**RN-PR10 (no vendible).** Un producto con `es_vendible = false` no aparece en el buscador de venta y se rechaza si llega por API. → `422 PRODUCT_NOT_SELLABLE`
*Test:* venta de un insumo interno falla.

**RN-PR11 (código de barras único).** Cuando existe, único por tenant; varios `NULL` no colisionan. → `409 BARCODE_DUPLICATE`
*Test:* dos productos con el mismo código falla; varios con `NULL` funciona.

**RN-PR12 (nombre único por tenant).** Mismo patrón que `uq_servicios_tenant_nombre`: único entre los activos, insensible a mayúsculas. → `409 PRODUCT_CODE_DUPLICATE`
*Test:* dos productos activos con el mismo nombre falla; reactivar uno dado de baja con nombre repetido falla.

### 6.2. Proveedores

**RN-PRV1 (único por tenant).** Por razón social normalizada, y por CUIT cuando está informado. → `409 SUPPLIER_DUPLICATE`
*Test:* alta duplicada falla; mismo CUIT en otro tenant funciona.

**RN-PRV2 (inactivo no recibe compras).** Sus compras históricas se conservan. → `422 SUPPLIER_INACTIVE`
*Test:* desactivar y crear compra falla.

**RN-PRV3 (no se borra con compras).** → `409 SUPPLIER_IN_USE`
*Test:* borrar un proveedor con una compra confirmada falla por FK.

### 6.3. Movimientos y existencias

**RN-MV1 (todo cambio es un movimiento).** No existe ningún camino —endpoint, service, script o tarea— que cambie una existencia sin insertar en `movimientos_stock`.
*Test:* guardrail estático: ningún `.from('existencias_lote').update(` fuera del trigger.

**RN-MV2 (inmutabilidad).** Ni `UPDATE` ni `DELETE` sobre un movimiento, **tampoco con `service_role`**. → `409 MOVEMENT_IMMUTABLE`
*Test:* con el cliente `service_role` de los tests, `.update()` y `.delete()` sobre un movimiento devuelven error del trigger.

**RN-MV3 (cantidad positiva).** La dirección la da el tipo, no el signo.
*Test:* insertar 0 o negativo viola el CHECK.

**RN-MV4 (signo derivado).** `cantidad_con_signo` es columna generada a partir del tipo.
*Test:* `entrada_compra` da signo positivo, `salida_venta` negativo; la columna generada no se puede escribir.

**RN-MV5 (existencia nunca negativa).** Garantizado por validación bajo bloqueo y por CHECK en `existencias_lote`. → `409 INSUFFICIENT_STOCK`
*Test:* vender más de lo disponible falla; forzarlo por PostgREST viola el CHECK.

**RN-MV6 (el costo se guarda, no se recalcula).** Cambiar el costo de un lote o el `costo_reposicion` de un producto **no altera** los movimientos ya registrados.
*Test:* vender, cambiar `costo_reposicion`, verificar que `movimientos_stock.costo_unitario`, `ventas_items.costo_unitario_efectivo` y el reporte de margen no cambiaron.

**RN-MV7 (operación atómica).** Los movimientos de una operación comparten `operacion_id` y transacción; si uno falla, no queda ninguno.
*Test:* forzar el fallo del segundo movimiento de un fraccionamiento y verificar que no quedó ni el primero ni el lote hijo.

**RN-MV8 (coherencia tipo–documento).** Cada tipo exige el documento que le corresponde y prohíbe los demás.
*Test:* `salida_venta` sin `venta_item_id` falla; `entrada_compra` con `venta_item_id` falla.

**RN-MV9 (nada se borra: se compensa).** Una operación registrada se revierte con contra-asientos visibles.
*Test:* la anulación genera movimientos nuevos y no borra los originales.

**RN-MV10 (la caché solo la escribe el trigger).** Ninguna ruta de aplicación modifica `existencias_lote`.
*Test:* revisión de que no hay escrituras a esa tabla en `src/modules/`, más el test de reconciliación de RN-MV11.

**RN-MV11 (el desvío se detecta).** `verificar_existencias` devuelve cero filas en condiciones normales y reporta el lote cuando la caché fue adulterada.
*Test:* adulterar `existencias_lote` con el cliente `service_role`, verificar que la función lo reporta, correr `recalcular_existencias` y verificar que vuelve a cero. **Este test es el que justifica la existencia de la caché** (D-02).

**RN-MV12 (la caché es reconstruible).** `recalcular_existencias` produce exactamente los valores que mantuvo el trigger.
*Test:* 200 movimientos variados, recalcular, comparar fila por fila: sin diferencias.

### 6.4. Lotes, vencimiento y FEFO

**RN-LO1 (el lote es el portador del costo).** Dos ingresos del mismo `codigo_lote` a distinto costo generan dos lotes.
*Test:* dos compras del lote "L-993" a $100 y $130 producen dos filas con sus costos.

**RN-LO2 (vencimiento obligatorio).** Si `productos.controla_vencimiento`, ningún lote suyo tiene `fecha_vencimiento` nula. → `422 EXPIRY_REQUIRED`
*Test:* confirmar compra sin fecha falla.

**RN-LO3 (lote genérico automático).** Con `controla_lote = false` el usuario no elige lote y cada compra crea uno genérico; el libro mayor mantiene un único camino de descuento.
*Test:* comprar y vender un producto sin control de lote funciona sin pedir lote y genera movimientos con `lote_id` no nulo.

**RN-LO4 (prohibido despachar vencido).** Ni venta, ni consumo clínico, ni fraccionamiento. **No es overrideable por ningún rol, incluido `admin`.** → `422 BATCH_EXPIRED`
*Test:* la operación falla para los tres roles.

**RN-LO5 (FEFO determinístico).** Se sugiere el de menor `fecha_vencimiento` con nulos al final; desempate por `fecha_ingreso` y luego por `id`.
*Test:* con lotes de 2026-01, 2026-03 y `NULL` sugiere enero; con dos de igual vencimiento la sugerencia es estable entre ejecuciones.

**RN-LO6 (override motivado).** Elegir un lote distinto del sugerido guarda `fefo_respetado = false` y el motivo. → `422 FEFO_OVERRIDE_WITHOUT_REASON`
*Test:* sin motivo falla; con motivo el movimiento queda con la bandera y el texto.

**RN-LO7 (lote bloqueado).** Solo admite ajuste, merma o desbloqueo, todos con motivo. → `422 BATCH_BLOCKED`
*Test:* bloquear y vender falla.

**RN-LO8 (vencimiento próximo notifica, no bloquea).** Los lotes con existencia que vencen dentro de `dias_alerta_vencimiento` generan notificación y **permiten** la venta.
*Test:* lote a 30 días con umbral 60 genera notificación y la venta funciona.

### 6.5. Compras

**RN-CM1 (el borrador no mueve existencias).** Lotes y movimientos se crean al confirmar.
*Test:* con la compra en borrador la existencia no cambió; al confirmar, sí.

**RN-CM2 (una compra confirmada no se edita).** → `409 PURCHASE_ALREADY_CONFIRMED`
*Test:* editar ítems de una compra confirmada falla.

**RN-CM3 (anulación solo sin salidas).** Si algún lote de la compra ya tuvo salidas, la corrección es un ajuste motivado, no una anulación. → `409 PURCHASE_HAS_EXITS`
*Test:* anular sin salidas funciona y genera contra-asientos; con una venta de por medio, falla.

**RN-CM4 (comprobante de proveedor único).** No se carga dos veces la misma factura del mismo proveedor. → `409 SUPPLIER_INVOICE_DUPLICATE`
*Test:* segunda carga del mismo número falla; número nulo no colisiona.

**RN-CM5 (la compra actualiza el costo de reposición).** Confirmar actualiza `productos.costo_reposicion` con el costo de esta compra, **sin tocar** los movimientos anteriores.
*Test:* dos compras a distinto costo dejan el `costo_reposicion` de la segunda y los movimientos de la primera intactos.

### 6.6. Ventas e IVA

**RN-VT1 (IVA por línea, calculado por diferencia).** `neto = round(precio/(1+alicuota/100), 2)` y `iva = precio − neto`. `neto + iva = precio` en todos los casos.
*Test:* tres líneas de $1.000 al 21 % dan neto 826,45, IVA 173,55 y total exacto 3.000,00; barrido de precios de $0,01 a $10.000 verificando la identidad.

**RN-VT2 (el total es la suma de las líneas redondeadas).** Nunca un recálculo desde los netos.
*Test:* venta con cinco líneas de alícuotas mixtas: `total = SUM(importe_total)` al centavo.

**RN-VT3 (línea de producto o de servicio, nunca las dos).** → `422 INVALID_ITEM_TYPE`
*Test:* con los dos IDs viola el CHECK; con ninguno también.

**RN-VT4 (una venta registrada no se edita).** Se anula con motivo; la anulación genera contra-asientos de existencia y de caja y la venta queda visible como `anulada`. → `409 SALE_ALREADY_VOIDED`
*Test:* anular devuelve la existencia a los lotes originales, genera el egreso, la venta sigue en el listado y anular dos veces falla.

**RN-VT5 (la anulación no toca una sesión cerrada).** El egreso va a la sesión abierta actual.
*Test:* cerrar sesión, abrir otra, anular una venta de la primera → el movimiento pertenece a la segunda y el arqueo de la primera no cambia.

**RN-VT6 (snapshot de la línea).** Descripción, precio y alícuota se congelan; cambios posteriores del catálogo no alteran ventas registradas.
*Test:* vender, renombrar el producto y cambiarle la alícuota, verificar que la línea vieja conserva los tres valores.

**RN-VT7 (una venta sin ítems no existe).** → `422 SALE_WITHOUT_ITEMS`
*Test:* registrar con arreglo vacío falla.

**RN-VT8 (toda venta pertenece a una sesión abierta).** Aunque no genere movimiento de efectivo. → `409 CASH_SESSION_REQUIRED`
*Test:* sin sesión abierta, la venta falla.

### 6.7. Caja

**RN-CJ1 (los pagos cubren el total).** `SUM(pagos) + saldo_pendiente = total`, al centavo; `saldo_pendiente > 0` solo si la condición de pago lo admite. → `422 PAYMENT_MISMATCH`
*Test:* $1.000 con pagos por $900 al contado falla; $600 efectivo + $400 transferencia funciona; $900 en cuenta corriente deja saldo 100.

**RN-CJ2 (solo el efectivo afecta el arqueo).**
*Test:* saldo inicial 1.000, venta de 5.000 en transferencia y 2.000 en efectivo → teórico 3.000, no 8.000.

**RN-CJ3 (la cuenta corriente no altera el arqueo).** Es el requisito de D-08 verificado como test y no como intención.
*Test:* saldo inicial 1.000 y una venta íntegra en cuenta corriente → teórico 1.000, diferencia 0.

**RN-CJ4 (una sola sesión abierta por caja).** Garantizado por índice único parcial. → `409 CASH_SESSION_ALREADY_OPEN`
*Test:* dos aperturas simultáneas en la misma caja: exactamente una gana. Mismo patrón concurrente que RN-GU4.

**RN-CJ5 (cerrar es irreversible).** No se reabre, no se edita, no admite movimientos nuevos. → `409 CASH_SESSION_CLOSED`
*Test:* cerrar y registrar un movimiento falla; cerrar dos veces falla; no existe endpoint de reapertura.

**RN-CJ6 (la diferencia se registra siempre, incluso en cero).**
*Test:* cerrar con el efectivo exacto guarda `diferencia = 0.00`, no `NULL`.

**RN-CJ7 (diferencia sobre la tolerancia exige motivo).** → `422 REASON_REQUIRED`
*Test:* con tolerancia 0, cerrar con $50 de faltante sin motivo falla; con motivo funciona y queda registrado.

**RN-CJ8 (el teórico se congela).**
*Test:* cerrar, forzar un movimiento en la sesión cerrada, verificar que `saldo_teorico_efectivo` no cambió.

**RN-CJ9 (referencia obligatoria según medio).** → `422 PAYMENT_REFERENCE_REQUIRED`
*Test:* transferencia sin referencia falla; efectivo sin referencia funciona.

### 6.8. Fraccionamiento

**RN-FR1 (solo por conversión definida y activa).** No hay fraccionamiento libre entre dos productos cualesquiera. → `422 CONVERSION_NOT_DEFINED`
*Test:* sin relación falla; con la relación desactivada, también.

**RN-FR2 (el grafo es acíclico).** Ninguna cadena de conversiones vuelve a su origen. → `409 CONVERSION_CYCLE`
*Test:* con A→B y B→C cargadas, crear C→A falla; A→A falla por CHECK.

**RN-FR3 (operación atómica).** Salida, alta del lote hijo, entrada y merma comparten `operacion_id` y transacción.
*Test:* provocar el fallo después de la salida y verificar que no quedó el lote hijo ni el movimiento.

**RN-FR4 (el hijo guarda su padre).** `lote_padre_id` obligatorio cuando `origen = 'conversion'`.
*Test:* todo lote de origen conversión tiene padre; el CTE recursivo devuelve los tres niveles de caja→blíster→comprimido.

**RN-FR5 (la cantidad obtenida no supera la teórica).** Obtener más que el factor es error de carga o factor mal definido. → `422 INVALID_YIELD`
*Test:* bolsa con factor 15 declarando 15,5 kg obtenidos falla.

**RN-FR6 (menos que el teórico es merma, no error).** El sistema advierte si el desvío supera la tolerancia y exige motivo, pero **registra**.
*Test:* factor 15 obteniendo 14,2 genera `merma_fraccionamiento` de 0,8; con desvío 20 % y tolerancia 10 %, sin motivo falla y con motivo funciona.

**RN-FR7 (el costo del hijo se calcula sobre lo realmente obtenido).**
*Test:* bolsa de $45.000, factor 15, rendimiento 14,2 → costo del hijo $3.169,0141/kg y **no** $3.000,0000/kg; el costo del hijo es **mayor** que el teórico.

**RN-FR8 (la merma de fraccionamiento tiene costo cero).** El costo ya se reasignó al hijo; imputarlo también a la merma contaría el mismo peso dos veces.
*Test:* la suma de `costo_total` de los movimientos de la operación es cero, y el valor total del inventario no cambió por fraccionar.

**RN-FR9 (no existe la conversión inversa).** No hay RPC, endpoint ni permiso de des-fraccionar. → `422 CONVERSION_REVERSE_NOT_ALLOWED`
*Test:* no existe ruta que genere una conversión de destino a origen; registrar la relación inversa falla por RN-FR2.

**RN-FR10 (el hijo no vence después que el padre).** El contenido no dura más que el envase del que salió. → `422 EXPIRY_AFTER_PARENT`
*Test:* bolsa que vence 2027-03-01 con hijo declarado 2027-06-01 falla.

**RN-FR11 (vencimiento sugerido por vida útil post apertura).** `LEAST(vencimiento_padre, hoy + vida_util_post_apertura_dias)`.
*Test:* bolsa que vence en 2027 con 30 días de vida útil sugiere hoy + 30.

**RN-FR12 (el factor no descuenta existencia. Nunca).** Se usa exclusivamente para reportes agregados. Ningún camino de escritura lee `v_stock_familia_unidad_base` ni multiplica por `factor_teorico` para resolver una salida. → `409 INSUFFICIENT_STOCK`
*Test:* vender comprimidos con existencia 0 en "comprimido" y positiva en "caja" **falla**, aunque exista la conversión. El sistema ofrece fraccionar, no descuenta de la caja.

**RN-FR13 (decimales por producto).** El origen se valida contra la unidad del origen y el destino contra la del destino. → `422 UNIT_NO_DECIMALS`
*Test:* fraccionar 0,5 cajas falla si "caja" no admite decimales, aunque el destino sí.

### 6.9. Ajustes, mermas, recuento y devoluciones

**RN-AJ1 (motivo obligatorio y sustantivo).** Los ajustes, las mermas, las devoluciones y todo override exigen `motivo` de al menos 10 caracteres. → `422 REASON_REQUIRED`
*Test:* sin motivo falla; con `"error"` falla; con motivo descriptivo funciona.

**RN-AJ2 (un ajuste no se revierte: se compensa).** No hay endpoint de "deshacer ajuste".
*Test:* no existe ruta de anulación de movimiento; el ajuste compensatorio queda visible en el historial del lote.

**RN-AJ3 (el recuento congela la cantidad de sistema al aplicar).** Si hubo movimientos entre el conteo y la aplicación, el RPC advierte y exige confirmación explícita. → `409 COUNT_STALE`
*Test:* abrir recuento, vender del lote contado, aplicar sin confirmar → advertencia con los lotes movidos; con confirmación → el ajuste usa la cantidad al momento de aplicar.

**RN-AJ4 (una devolución no excede lo vendido).** Se acumulan las devoluciones previas de la misma venta. → `422 RETURN_EXCEEDS_SOLD`
*Test:* vender 5, devolver 3, devolver 3 → falla la segunda.

**RN-AJ5 (devolución no revendible a lote bloqueado).**
*Test:* la devolución marcada como no revendible crea o usa un lote `bloqueado` con motivo, y ese lote no aparece entre los candidatos FEFO.

**RN-AJ6 (aplicar un recuento es irreversible).** → `409 COUNT_ALREADY_APPLIED`
*Test:* aplicar dos veces el mismo recuento falla.

**RN-AJ7 (la única salida de un lote vencido es la merma por vencimiento).** Complemento de RN-LO4.
*Test:* con lote vencido, la merma funciona y cualquier otra salida falla.

### 6.10. Consumo clínico, receta y trazabilidad

**RN-CC1 (el consumo clínico es un tipo propio).** No se registra como venta ni como ajuste.
*Test:* aplicar una vacuna desde el historial genera un movimiento `consumo_clinico` con `historial_id` y `mascota_id`, y **no** genera venta ni movimiento de caja.

**RN-CC2 (descuenta con las mismas reglas que la venta).** FEFO, bloqueo de fila, prohibición de vencidos, existencia no negativa.
*Test:* consumir de un lote vencido falla; consumir más de lo disponible falla; el lote sugerido es el de FEFO.

**RN-CC3 (la receta es opcional hoy y bloqueante por configuración).** Con `exigir_receta_bloqueante = false` un producto "bajo receta" se vende con advertencia; con la bandera en `true` se exige `receta_id`. → `422 PRESCRIPTION_REQUIRED`
*Test:* los dos escenarios cambiando solo la configuración del tenant, sin migración de por medio.

**RN-CC4 (trazabilidad lote↔animal consultable).** Dado un lote se listan las mascotas que lo recibieron; dada una mascota, los lotes que recibió.
*Test:* las dos consultas después de tres consumos sobre dos mascotas.

**RN-CC5 (las columnas de trazabilidad externa no se usan).** `trazabilidad_estado` queda en `no_aplica` mientras no exista integración.
*Test:* tras un ciclo completo de operaciones, ningún movimiento tiene otro valor. Es un test de que **no** se construyó el puente.

### 6.11. Seguridad, permisos, auditoría y concurrencia

**RN-SC1 (el tenant sale del JWT, nunca del payload).** Ningún handler del módulo lee `tenant_id` de body, query o params; los RPC lo reciben como `p_tenant_id` desde `ctx.tenantId`, y filtran por él en cada lectura y escritura.
*Test:* enviar `tenantId` en el body no cambia el tenant afectado; guardrail estático sobre `src/modules/comercial*`.

**RN-SC2 (ninguna fila referencia a otra de otro tenant).** Garantizado por las FKs compuestas.
*Test:* crear un movimiento cuyo `lote_id` pertenece a otro tenant falla **por FK**, no por validación de aplicación.

**RN-SC3 (los RPC solo los ejecuta `service_role`).** `REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO service_role` en cada uno.
*Test:* `has_function_privilege('anon', …)` y `('authenticated', …)` dan `false` para todos los RPC del módulo. Mismo patrón que `tests/integration/grants.integration.test.ts`.

**RN-SC4 (aislamiento de lectura por RLS).** Con dos tenants sembrados, ninguna consulta de A devuelve filas de B en ninguna tabla del módulo.
*Test:* se extiende `tests/integration/rls.test.ts` con las tablas nuevas. **Bloqueante desde la primera etapa**, según `CLAUDE.md`.

**RN-SC5 (toda escritura deja asiento, en la misma transacción).**
*Test:* por tipo de operación, verificar el asiento con su `module`; si la operación falla, no queda asiento huérfano.

**RN-SC6 (cada operación usa su módulo de auditoría).** Los valores nuevos de `modulo_auditoria` existen en el ENUM **antes** de que se escriba el primer service que los use.
*Test:* test parametrizado que recorre todos los valores usados por el módulo y verifica que están en el ENUM. **Esta regla existe por el bug conocido:** `recordAudit` loguea y sigue, así que un valor faltante hace perder los asientos en silencio, sin excepción y sin ningún test en rojo.

**RN-SC7 (cada endpoint exige su permiso y su módulo).** `requireModule` + `requirePermission` en todas las rutas del módulo.
*Test:* matriz rol × endpoint con el 403 esperado; módulo no contratado → `403 MODULE_NOT_LICENSED`.

**RN-SC8 (el descuento concurrente no sobrevende).** Dos operaciones simultáneas sobre la última unidad: una tiene éxito y la otra falla con `INSUFFICIENT_STOCK`. Nunca las dos.
*Test:* `Promise.all` de dos `.rpc()` sobre un lote con existencia 1, con el guard `rpcReallyRan()`, **copiando el patrón de `tests/integration/guarderia.integration.test.ts`**. Repetición configurable por variable de entorno, default 50 en local.

---

## 7. ErrorCodes nuevos

Para el enum central de `supabase/functions/api/src/shared/errors.ts`. **En inglés**, como el
95 % del enum actual. Se agrupan con el mismo estilo de comentarios que ya tiene el archivo.

```ts
  // ── Catálogo comercial ────────────────────────────────────────────
  PRODUCT_CODE_DUPLICATE   = "PRODUCT_CODE_DUPLICATE",
  PRODUCT_IN_USE           = "PRODUCT_IN_USE",
  PRODUCT_INACTIVE         = "PRODUCT_INACTIVE",
  PRODUCT_WITHOUT_PRICE    = "PRODUCT_WITHOUT_PRICE",
  PRODUCT_NOT_SELLABLE     = "PRODUCT_NOT_SELLABLE",
  BARCODE_DUPLICATE        = "BARCODE_DUPLICATE",
  INVALID_TAX_RATE         = "INVALID_TAX_RATE",
  UNIT_NO_DECIMALS         = "UNIT_NO_DECIMALS",
  UNIT_INVALID_SCALE       = "UNIT_INVALID_SCALE",
  UNIT_IMMUTABLE           = "UNIT_IMMUTABLE",
  FAMILY_WITHOUT_BASE_UNIT = "FAMILY_WITHOUT_BASE_UNIT",

  // ── Proveedores ───────────────────────────────────────────────────
  SUPPLIER_DUPLICATE = "SUPPLIER_DUPLICATE",
  SUPPLIER_INACTIVE  = "SUPPLIER_INACTIVE",
  SUPPLIER_IN_USE    = "SUPPLIER_IN_USE",

  // ── Existencias y lotes ───────────────────────────────────────────
  INSUFFICIENT_STOCK          = "INSUFFICIENT_STOCK",
  BATCH_NOT_FOUND             = "BATCH_NOT_FOUND",
  BATCH_EXPIRED               = "BATCH_EXPIRED",
  BATCH_BLOCKED               = "BATCH_BLOCKED",
  EXPIRY_REQUIRED             = "EXPIRY_REQUIRED",
  FEFO_OVERRIDE_WITHOUT_REASON = "FEFO_OVERRIDE_WITHOUT_REASON",
  MOVEMENT_IMMUTABLE          = "MOVEMENT_IMMUTABLE",
  REASON_REQUIRED             = "REASON_REQUIRED",
  INVALID_QUANTITY            = "INVALID_QUANTITY",
  STOCK_DRIFT_DETECTED        = "STOCK_DRIFT_DETECTED",

  // ── Compras ───────────────────────────────────────────────────────
  PURCHASE_ALREADY_CONFIRMED = "PURCHASE_ALREADY_CONFIRMED",
  PURCHASE_WITHOUT_ITEMS     = "PURCHASE_WITHOUT_ITEMS",
  PURCHASE_HAS_EXITS         = "PURCHASE_HAS_EXITS",
  SUPPLIER_INVOICE_DUPLICATE = "SUPPLIER_INVOICE_DUPLICATE",

  // ── Ventas ────────────────────────────────────────────────────────
  SALE_WITHOUT_ITEMS         = "SALE_WITHOUT_ITEMS",
  SALE_ALREADY_VOIDED        = "SALE_ALREADY_VOIDED",
  INVALID_ITEM_TYPE          = "INVALID_ITEM_TYPE",
  PAYMENT_MISMATCH           = "PAYMENT_MISMATCH",
  PAYMENT_REFERENCE_REQUIRED = "PAYMENT_REFERENCE_REQUIRED",
  PAYMENT_METHOD_DISABLED    = "PAYMENT_METHOD_DISABLED",
  RETURN_EXCEEDS_SOLD        = "RETURN_EXCEEDS_SOLD",
  RETURN_WITHOUT_SALE        = "RETURN_WITHOUT_SALE",

  // ── Caja ──────────────────────────────────────────────────────────
  CASH_SESSION_REQUIRED     = "CASH_SESSION_REQUIRED",
  CASH_SESSION_ALREADY_OPEN = "CASH_SESSION_ALREADY_OPEN",
  CASH_SESSION_CLOSED       = "CASH_SESSION_CLOSED",
  INVALID_OPENING_BALANCE   = "INVALID_OPENING_BALANCE",

  // ── Fraccionamiento ───────────────────────────────────────────────
  CONVERSION_NOT_DEFINED       = "CONVERSION_NOT_DEFINED",
  CONVERSION_CYCLE             = "CONVERSION_CYCLE",
  CONVERSION_REVERSE_NOT_ALLOWED = "CONVERSION_REVERSE_NOT_ALLOWED",
  INVALID_YIELD                = "INVALID_YIELD",
  EXPIRY_AFTER_PARENT          = "EXPIRY_AFTER_PARENT",

  // ── Recuento ──────────────────────────────────────────────────────
  COUNT_ALREADY_APPLIED = "COUNT_ALREADY_APPLIED",
  COUNT_STALE           = "COUNT_STALE",
  COUNT_WITHOUT_DETAIL  = "COUNT_WITHOUT_DETAIL",

  // ── Reservados (sin uso en la primera tanda) ──────────────────────
  PRESCRIPTION_REQUIRED   = "PRESCRIPTION_REQUIRED",
  CREDIT_ACCOUNT_DISABLED = "CREDIT_ACCOUNT_DISABLED",
  CREDIT_LIMIT_EXCEEDED   = "CREDIT_LIMIT_EXCEEDED",
```

`MODULE_NOT_LICENSED`, `VALIDATION_ERROR`, `FORBIDDEN` e `INTERNAL_ERROR` ya existen y se
reutilizan.

---

## 8. Permisos y roles

### 8.1. Diez permisos, no veinticinco

El sistema entero tiene **12 permisos para 8 módulos**. Una versión anterior de este documento
proponía 25 solo para el módulo comercial: es un orden de magnitud fuera de escala y habría
convertido la pantalla de roles en algo inmanejable. Se agregan **diez**, con la misma
granularidad que el resto: `verbo_recurso`, en inglés, con su `module`.

| `name` | `display_name` | `module` | Cubre |
|---|---|---|---|
| `view_stock` | Ver stock | `inventory` | Catálogo, existencias, lotes, movimientos, kárdex. |
| `manage_stock` | Gestionar stock | `inventory` | Ajustes, mermas, recuento, bloqueo y desbloqueo de lotes. |
| `split_stock` | Fraccionar productos | `inventory` | **Permiso propio.** No se deduce de `manage_stock`: es una operación irreversible con implicancias distintas. |
| `consume_stock` | Consumir insumos clínicos | `inventory` | Descontar desde un acto clínico. |
| `manage_products` | Gestionar productos | `products` | Catálogo, familias, precios, conversiones. |
| `manage_suppliers` | Gestionar proveedores | `suppliers` | Proveedores y compras. |
| `view_sales` | Ver ventas | `sales` | Listado y detalle, incluidas las de otros usuarios. |
| `manage_sales` | Registrar ventas | `sales` | Vender y registrar devoluciones. |
| `void_sales` | Anular ventas | `sales` | Anulación con motivo. |
| `manage_cash` | Gestionar caja | `cash_register` | Abrir, mover y cerrar sesión. |

**Precios junto al catálogo, no aparte.** Una versión anterior separaba `manage_prices`. En una
clínica de tres roles, quien carga el producto es quien le pone el precio; separarlo agrega una
pantalla de permisos sin resolver ningún conflicto real. Si el negocio crece, separarlo después
es aditivo.

### 8.2. Mapeo a roles

Los roles son exactamente tres y los crea `on_tenant_created()`. **El `admin` recibe todos los
permisos automáticamente** (`SELECT p.id FROM permisos p`), así que los diez le llegan sin
tocar nada. Los otros dos sí hay que modificarlos en la función.

| Permiso | admin | veterinario | recepcionista |
|---|:--:|:--:|:--:|
| `view_stock` | auto | ✅ | ✅ |
| `manage_stock` | auto | — | — |
| `split_stock` | auto | ✅ | ✅ |
| `consume_stock` | auto | ✅ | — |
| `manage_products` | auto | — | — |
| `manage_suppliers` | auto | — | ✅ |
| `view_sales` | auto | — | — |
| `manage_sales` | auto | ✅ | ✅ |
| `void_sales` | auto | — | — |
| `manage_cash` | auto | — | ✅ |

**Tres decisiones de este mapeo, para discutir con el dueño (P-07):**

1. **El veterinario puede fraccionar.** Abrir una caja de comprimidos ocurre al atender, no
   cuando el administrador está disponible. Si se restringe, se fracciona igual y se registra
   mal o no se registra, que es peor.
2. **El veterinario no ajusta stock.** Ajustar es corregir el inventario; consumir no lo es.
   Separarlo es lo que le da sentido al consumo clínico como tipo propio.
3. **La recepcionista maneja caja pero no ve `view_sales`.** Ve las ventas que registra ella
   (filtradas por `usuario_id` en el listado); auditar el turno de otro es `view_sales`, que va
   solo al admin.

### 8.3. Migración de permisos

Dos partes, como `20260725000001_permiso_clientes_veterinario.sql`, que es el precedente exacto:

1. `INSERT INTO permisos … ON CONFLICT (name) DO NOTHING` con las diez filas.
2. `CREATE OR REPLACE FUNCTION on_tenant_created()` con los permisos nuevos en los arreglos de
   veterinario y recepcionista, **y el `INSERT` de `modulos_contratados` extendido** con los
   valores nuevos de `modulo_vendible` (D-16).
3. **Otorgamiento a los tenants ya creados**, idempotente: los tenants existentes no pasan por
   `on_tenant_created()`, así que sin este paso el módulo queda invisible para ellos. Es
   exactamente el error que la migración de `manage_clients` documenta.

---

## 9. ENUMs

### 9.1. ENUMs nuevos

```sql
CREATE TYPE tipo_movimiento_stock AS ENUM (
  'entrada_compra', 'entrada_ajuste', 'entrada_devolucion', 'entrada_conversion',
  'entrada_inicial', 'sobrante_recuento',
  'salida_venta', 'salida_ajuste', 'salida_conversion', 'salida_devolucion_proveedor',
  'consumo_clinico', 'merma_fraccionamiento', 'merma_vencimiento', 'merma_rotura',
  'faltante_recuento'
);

CREATE TYPE estado_lote            AS ENUM ('disponible','bloqueado','dado_de_baja');
CREATE TYPE origen_lote            AS ENUM ('compra','conversion','ajuste','devolucion','inicial');
CREATE TYPE condicion_fiscal       AS ENUM ('consumidor_final','monotributista',
                                            'responsable_inscripto','exento',
                                            'no_alcanzado','sin_datos');
CREATE TYPE condicion_venta_producto AS ENUM ('libre','bajo_receta',
                                              'bajo_receta_archivada','uso_profesional');
CREATE TYPE tipo_item_venta        AS ENUM ('producto','servicio');
CREATE TYPE estado_venta           AS ENUM ('registrada','anulada');
CREATE TYPE condicion_pago_venta   AS ENUM ('contado','cuenta_corriente','mixto');
CREATE TYPE estado_facturacion     AS ENUM ('no_facturada','pendiente','facturada','anulada');
CREATE TYPE estado_compra          AS ENUM ('borrador','confirmada','anulada');
CREATE TYPE estado_sesion_caja     AS ENUM ('abierta','cerrada');
CREATE TYPE tipo_movimiento_caja   AS ENUM (
  'ingreso_venta','ingreso_cobro_cuenta_corriente','ingreso_manual',
  'egreso_pago_proveedor','egreso_devolucion','egreso_manual','egreso_retiro'
);
CREATE TYPE estado_recuento        AS ENUM ('borrador','aplicado','anulado');
CREATE TYPE estado_trazabilidad    AS ENUM ('no_aplica','pendiente','informado','confirmado');
```

**Por qué ENUM y no tabla de catálogo para `tipo_movimiento_stock`.** El conjunto es cerrado por
diseño: agregar un tipo no es cargar un dato, es cambiar el modelo —hay que decidir su signo, si
exige motivo, qué documento lo respalda y cómo lo tratan los reportes—. Un ENUM obliga a que eso
pase por migración y revisión, que es lo que se quiere. Y es la convención de la casa: los 14
ENUMs existentes hacen lo mismo.

El signo y la obligatoriedad del motivo viven en funciones inmutables, no en columnas:

```sql
CREATE FUNCTION public.signo_movimiento(p_tipo tipo_movimiento_stock)
RETURNS SMALLINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_tipo IN ('entrada_compra','entrada_ajuste','entrada_devolucion',
                              'entrada_conversion','entrada_inicial','sobrante_recuento')
              THEN 1 ELSE -1 END;
$$;
```

`signo_movimiento` **tiene que ser `IMMUTABLE`** porque la columna generada
`cantidad_con_signo` la usa; marcarla `STABLE` hace fallar la migración. Y como toda función
nueva, necesita su `REVOKE`/`GRANT` explícito: desde `20260710000001`, las funciones no nacen
ejecutables por `PUBLIC`.

### 9.2. `modulo_vendible` — valores nuevos

Los valores actuales están en **español**, así que los nuevos también:

```sql
ALTER TYPE modulo_vendible ADD VALUE 'stock';
ALTER TYPE modulo_vendible ADD VALUE 'ventas';
```

Dependencia funcional (D-16): `ventas` requiere `stock`. Se valida en el service de
contratación, no en la base: es una regla comercial, no una restricción de integridad. **Sujeto
a P-01**; si el dueño decide un solo módulo, el valor es `comercial`.

Además hay que decidir **qué plan los habilita** en `on_tenant_created()`, igual que hoy hace
con `historial_clinico` (siempre), `turnos` (profesional+) y `guarderia` (premium). Eso es
decisión comercial, no técnica.

### 9.3. `modulo_auditoria` — valores nuevos. **NO OMITIR ESTE PASO.**

Los valores actuales están en **inglés**, así que los nuevos también. La incoherencia idiomática
entre este ENUM y el dominio es preexistente; **este documento la respeta en vez de
corregirla**, porque un ENUM a medias en dos idiomas es peor que uno consistente en el idioma
equivocado.

```sql
ALTER TYPE modulo_auditoria ADD VALUE 'products';       -- catálogo, familias, unidades, conversiones
ALTER TYPE modulo_auditoria ADD VALUE 'suppliers';      -- proveedores
ALTER TYPE modulo_auditoria ADD VALUE 'purchases';      -- compras
ALTER TYPE modulo_auditoria ADD VALUE 'inventory';      -- lotes, movimientos, ajustes, recuentos, fraccionamiento
ALTER TYPE modulo_auditoria ADD VALUE 'sales';          -- ventas y devoluciones
ALTER TYPE modulo_auditoria ADD VALUE 'cash_register';  -- caja
```

**Los mismos seis valores hay que agregarlos al tipo `AuditModule` de `shared/audit.ts`**, que
es una unión de literales de TypeScript y no se entera sola. Si se agrega al ENUM y no al tipo,
el typecheck lo frena; si se agrega al tipo y no al ENUM, **`recordAudit` loguea el error en
consola y sigue**, y todas las escrituras pierden su asiento en silencio. Es el modo de falla
que RN-SC6 existe para cubrir.

**Nota de operación:** `ALTER TYPE … ADD VALUE` no puede usarse en la misma transacción en la
que se agregó el valor. La migración de ENUMs va en **archivo separado** del que crea las tablas
que los usan.

### 9.4. `tipo_servicio` — no se extiende

**Propuesta: no agregar ningún valor.** El módulo comercial no crea servicios: los consume desde
`servicios` para armar líneas de venta. Los valores actuales (`clinica`, `peluqueria`,
`guarderia`, `cirugia`, `otro`) cubren todo lo que la venta necesita referenciar.

El único escenario donde haría falta es si el dueño quiere cobrar la *aplicación* como servicio
separado del producto —"vacuna $X + aplicación $Y"—. Hoy eso entra en `otro`. Si se vuelve
habitual y se quiere reportar aparte, conviene un valor `aplicacion`. Es aditivo: no hay motivo
para adelantarlo. Ver P-06.

---

## 10. Integración con los módulos existentes

Cambios sobre tablas en producción. Se listan aparte porque **cada uno es un riesgo distinto al
de crear tablas nuevas**: hay datos vivos.

### 10.1. `clientes` — tres columnas, todas aditivas con default

| Columna | Tipo | Motivo |
|---|---|---|
| `condicion_fiscal` | `condicion_fiscal NOT NULL DEFAULT 'consumidor_final'` | D-03. |
| `cuenta_corriente_habilitada` | `BOOLEAN NOT NULL DEFAULT false` | D-08. Reservada. |
| `limite_credito` | `NUMERIC(14,2) NULL` | D-08. Reservada. |

**No se agrega documento.** `clientes.dni_cuit` ya existe con `UNIQUE (tenant_id, dni_cuit)`. La
venta lo copia como snapshot. Duplicar el documento del cliente en dos columnas es la clase de
decisión que se paga tres meses después.

### 10.2. `servicios` — dos columnas

| Columna | Tipo | Motivo |
|---|---|---|
| `precio` | `NUMERIC(14,2) NULL` | **La tabla no tiene precio, y ninguna del sistema lo tiene.** Sin esto no se puede cobrar una consulta en el mismo ticket que una pipeta. Nullable porque hay servicios sin precio fijo; la línea de venta lo copia como snapshot y admite edición. |
| `alicuota_iva` | `NUMERIC(5,2) NOT NULL DEFAULT 21.00` | Consecuencia directa de D-03: si el IVA se discrimina por ítem y una venta puede tener líneas de servicio, el servicio necesita su alícuota. Sin esto, la mitad de las líneas quedaría sin IVA discriminado y D-03 se cumpliría a medias, que en la práctica es no cumplirse. |

**Nada más se toca de `servicios`.** No se le agrega stock, ni unidad, ni lote, ni se fusiona con
`productos` (D-10).

**Advertencia de alcance para el dueño:** agregar la columna es una línea de migración; **cargar
la lista de precios de todos los servicios es una tarea de datos** que hoy no existe en ningún
lado y que tiene que estar hecha antes de que la etapa de ventas sirva para algo. Ver P-06.

### 10.3. `historial_clinico` y `plan_vacunacion` — sin cambios

La relación es **desde el movimiento hacia el evento clínico**:
`movimientos_stock.historial_id` y `movimientos_stock.plan_vacunacion_id`. Deliberado:

- El módulo clínico **no depende** del comercial. Un tenant sin `stock` contratado usa el
  historial exactamente igual que hoy.
- La dirección inversa —una columna `producto_id` en `historial_clinico`— obligaría al módulo
  clínico a conocer el catálogo y rompería la independencia de módulos vendibles, que es lo que
  `requireModule` protege.
- Para mostrar "qué se le aplicó" en la ficha se consulta `movimientos_stock` filtrando por
  `historial_id`, que está indexado.

### 10.4. `mascotas` — sin cambios
`movimientos_stock.mascota_id` es una FK de solo lectura, denormalizada para trazabilidad
(RN-CC4).

### 10.5. `configuracion_tenant` — seis columnas nuevas
Ver 4.11. Todas con `NOT NULL DEFAULT`, todas aditivas. `on_tenant_created()` no necesita
cambios para esto: el `INSERT` existente toma los defaults.

### 10.6. `notificaciones` — dos disparadores, y una sutileza del ENUM

`origen` es `origen_notificacion AS ENUM ('turno','vacunacion')`, con
`UNIQUE (tenant_id, origen, referencia_id, canal)`. Hacen falta dos valores nuevos:

```sql
ALTER TYPE origen_notificacion ADD VALUE 'vencimiento_lote';
ALTER TYPE origen_notificacion ADD VALUE 'stock_minimo';
```

**La sutileza está en el `UNIQUE`.** Con `referencia_id = lote_id`, la restricción da
exactamente lo que se quiere para vencimientos: **una notificación por lote, para siempre**.
Nadie necesita que le avisen dos veces que el mismo lote está por vencer.

Para stock mínimo, en cambio, `referencia_id = producto_id` daría una notificación por producto
**para siempre**, y el segundo faltante no avisaría nunca. La solución **no requiere migración**:
la notificación es **por flanco, no por nivel**. Se crea cuando la existencia cruza hacia abajo
el mínimo, y **se elimina cuando lo cruza hacia arriba**, de modo que el `UNIQUE` deja de
bloquear y el próximo faltante vuelve a avisar. Se evalúa dentro del RPC, después de cada
movimiento, no por tarea programada: así la alerta llega cuando pasa y no al día siguiente.

Esto también resuelve el problema opuesto —una alerta por venta en un producto que oscila
alrededor del mínimo— sin lógica de deduplicación por fecha: mientras siga por debajo, la fila
ya existe y el `UNIQUE` la absorbe.

### 10.7. Auditoría
`recordAudit` para las escrituras del Service; `INSERT INTO registros_auditoria` **dentro del
RPC** para las operaciones transaccionales, como hace `registrar_eutanasia`. Ese es el punto que
hace que la auditoría del módulo sea confiable y no best-effort: si el asiento se inserta en la
misma transacción, o están la operación y el asiento, o no está ninguno de los dos.

### 10.8. Frontend
Fuera del alcance de esta especificación en cuanto a diseño de pantallas: el lenguaje visual lo
manda `docs/GUIA_ESTILO.md` y el kit heredado de `web/src/components/ui/` no se reescribe. Lo
único que este documento fija es que **el sidebar tiene que ocultar el módulo si no está
contratado**, como ya hace con los otros tres (RN-G2), y que **la pantalla de venta necesita
búsqueda por familia desde el primer día** si el catálogo va a tener cientos de derivados
(P-09).

---

## 11. Corte en etapas

Formato de `docs/PLAN_ETAPAS.md`. Se numeran **C1…C8** (C de comercial) para no colisionar con
las etapas 1–9 del plan existente, que ya están cerradas.

**Criterio de tamaño:** una etapa tiene que poder implementarse **y testearse completa**. Una
etapa terminada es la que cumple lo que `CLAUDE.md` ya exige: sus RN tienen test que pasa, los
tests de RLS siguen en verde, y el usuario revisó los diffs.

### Etapa C1 — Fundaciones comerciales y catálogo
**Dependencias:** ninguna.
**Entregable:** el tenant carga productos, familias, unidades y proveedores. Sin existencias.

- Migración de ENUMs **en archivo propio** (9.1, 9.2, 9.3) + los seis valores en el tipo
  `AuditModule` de `shared/audit.ts`.
- `unidades_medida` y `medios_pago` en el seed global, idempotentes con `ON CONFLICT`.
- `familias_producto`, `productos`, `producto_conversiones`, `proveedores`, con RLS de solo
  lectura y `UNIQUE (id, tenant_id)` para las FKs compuestas.
- Trigger anti-ciclo de `producto_conversiones`.
- Diez permisos + `on_tenant_created()` actualizada + otorgamiento a tenants existentes.
- ErrorCodes nuevos en `shared/errors.ts`.
- Módulos `stock`/`ventas` en `modulo_vendible` y en `modulos_contratados`.
- CRUD completo: controller + service + schemas Zod, con `requireModule` y `requirePermission`.

**RN:** RN-PR1…12, RN-PRV1…3, RN-FR2, RN-SC1…7.
**Definición de hecho:** un tenant nuevo carga 50 productos, dos familias y una conversión; todo
queda auditado con `module = 'products'`; `tests/integration/rls.test.ts` sigue en verde con las
tablas nuevas.

### Etapa C2 — Libro mayor, lotes y compras
**Dependencias:** C1.
**Entregable:** entra mercadería y el sistema sabe cuánta hay, de qué lote y a qué costo.

- `lotes` **con `lote_padre_id` desde esta migración** (D-13), aunque no se use hasta C5.
- `movimientos_stock` con **todas** sus columnas reservadas (receta, trazabilidad, depósito).
- `signo_movimiento()` con su `REVOKE`/`GRANT`; triggers de inmutabilidad y de caché.
- `existencias_lote`, `recalcular_existencias`, `verificar_existencias`.
- `compras`, `compras_items`, RPC `confirmar_compra` con `NOTIFY pgrst`.
- Kárdex por lote, valorización de inventario, `v_lotes_por_vencer` y notificación de
  vencimiento próximo.

**RN:** RN-MV1…12, RN-LO1…8, RN-CM1…5.
**Definición de hecho:** compra de 20 ítems confirmada, existencia cuadrada,
`verificar_existencias` devuelve cero filas, el kárdex reconstruye el saldo y el test de
adulteración de caché (RN-MV11) pasa.

### Etapa C3 — Caja
**Dependencias:** C2.
**Entregable:** se abre, se mueve y se cierra la caja. Todavía no se vende.

- `cajas`, `sesiones_caja`, `movimientos_caja`, `medios_pago` habilitados.
- Índice parcial único de sesión abierta.
- RPC `abrir_sesion_caja`, `registrar_movimiento_caja`, `cerrar_sesion_caja`.

**RN:** RN-CJ2, CJ4…CJ9.
**Definición de hecho:** apertura, tres ingresos y dos egresos manuales, cierre con diferencia y
motivo. El test concurrente de doble apertura (RN-CJ4) pasa.

> **Por qué la caja va antes que las ventas y no junto con ellas.** Ventas + caja + FEFO +
> concurrencia, con todos sus tests, es demasiado para una etapa, y la caja es la mitad que se
> puede entregar y probar sola: el arqueo se verifica con movimientos manuales, sin necesidad
> de que exista una venta. Partirlas deja dos etapas cerradas en verde en vez de una que
> arrastra pendientes.

### Etapa C4 — Ventas
**Dependencias:** C3.
**Entregable:** se vende en el mostrador. **Es la etapa que el negocio percibe como "el
módulo".**

- `ventas`, `ventas_items` con productos **y servicios** (D-10), `ventas_pagos`.
- `servicios.precio` y `servicios.alicuota_iva` (10.2).
- `contadores_tenant` para el correlativo.
- RPC `registrar_venta` y `anular_venta`.
- Asignación FEFO con override motivado; descomposición de IVA por línea.
- Vistas `v_items_vendidos` y `v_margen_venta`.

**RN:** RN-VT1…8, RN-CJ1, RN-CJ3, RN-LO5, RN-LO6, RN-SC8.
**Definición de hecho:** un turno completo —abrir caja, seis ventas con pago mixto y con
servicios, una anulación, cierre con arqueo— cuadra, y el test concurrente de RN-SC8 pasa las
repeticiones configuradas.

### Etapa C5 — Ajustes, mermas, recuento y devoluciones
**Dependencias:** C4.
**Entregable:** el inventario se puede corregir sin mentir.

- RPC `ajustar_existencia`, `aplicar_recuento`, `registrar_devolucion`.
- `recuentos`, `recuentos_detalle`. Bloqueo y desbloqueo de lotes.

**RN:** RN-AJ1…7.
**Definición de hecho:** recuento del depósito aplicado con ajustes en una sola operación y la
advertencia de RN-AJ3 funcionando.

### Etapa C6 — Fraccionamiento
**Dependencias:** C2 y C5.
**Entregable:** la operación central del módulo (D-06).

- RPC `fraccionar_lote`: atomicidad, rendimiento real, merma con costo cero, costo heredado,
  vencimiento del hijo, trazabilidad padre–hijo.
- Creación de producto derivado desde plantilla del padre.
- `v_costo_fraccionamiento` y `v_stock_familia_unidad_base` con su `COMMENT ON VIEW`.
- Consulta de cadena de trazabilidad con CTE recursivo.

**RN:** RN-FR1…13.
**Definición de hecho:** los dos casos reales del dueño funcionan de punta a punta —bolsa de
15 kg → kilos sueltos con rendimiento 14,2, y caja → blíster → comprimido con la cadena completa
en tres niveles— y RN-FR8 verifica que el valor del inventario no cambió por fraccionar.

> **C5 va antes que C6, y no es negociable.** D-06.c define que un fraccionamiento mal hecho se
> corrige con un ajuste motivado. Si el fraccionamiento se habilita antes de que exista el
> ajuste, el único camino de corrección no existe y el primer error de carga se va a "arreglar"
> por SQL directo contra producción.

### Etapa C7 — Consumo clínico
**Dependencias:** C2 como mínimo; C6 si se consume producto fraccionado.
**Entregable:** aplicar una vacuna descuenta el frasco.

- RPC `registrar_consumo_clinico`; integración desde historial clínico y plan de vacunación.
- Trazabilidad lote↔animal; campos de receta y prescriptor sin validación (D-14).
- Reporte de costo de insumos por atención.

**RN:** RN-CC1…5.
**Definición de hecho:** aplicar una vacuna desde el historial descuenta el lote correcto por
FEFO, deja el movimiento con mascota y evento, y **no** genera venta ni movimiento de caja.

### Etapa C8 — Reportes comerciales
**Dependencias:** C4, C6, C7.

- Valorización de inventario a una fecha (desde el libro mayor, no desde la caché).
- Rotación y productos sin movimiento; rentabilidad por producto y familia con el costo
  efectivo guardado; costo de fraccionamiento; ventas por usuario, sesión y medio de pago;
  consumo clínico por profesional y especie.
- **`EXPLAIN` de los listados nuevos**, con el método de `docs/EXPLAIN_INDICES.md`.

**RN:** ninguna nueva; verifica RN-MV6 y RN-FR8 sobre datos reales.

### Etapa C9 (condicional) — Cuenta corriente
**Solo si el dueño la pide (P-03).** El modelo ya le dejó lugar.

### Grafo de dependencias

```
C1 Catálogo
 └─ C2 Libro mayor + compras
     ├─ C3 Caja
     │   └─ C4 Ventas
     │       └─ C5 Ajustes + recuento + devoluciones
     │           └─ C6 Fraccionamiento
     │               └─ C8 Reportes
     └─ C7 Consumo clínico   (necesita C6 solo si se consume fraccionado)

C9 Cuenta corriente ── depende de C4, condicional
```

---

## 12. Riesgos

### 12.1. Lo más fácil de hacer mal

| # | Riesgo | Por qué pasa | Mitigación |
|---|---|---|---|
| R-01 | **Descontar existencia desde el Service.** Leer, validar en TypeScript, escribir. | Es lo natural viniendo de un CRUD, y funciona perfecto en desarrollo, donde nunca hay dos operaciones a la vez. | RN-SC8 con el patrón de `guarderia.integration.test.ts`. **Sin ese test, esto se va a producción.** |
| R-02 | **Agregar `stock_actual` "por performance".** | Aparece cuando una consulta va lenta y materializar es la solución obvia. | La caché ya existe y es reconstruible. RN-MV1 y RN-MV10. |
| R-03 | **Recalcular el costo en vez de guardarlo.** | Un join a `productos.costo_reposicion` en el reporte de margen es más corto de escribir. | RN-MV6: el reporte tiene que dar lo mismo después de cambiar el costo del producto. |
| R-04 | **Redondear el IVA por separado.** | Calcular neto e IVA cada uno con su `round` es lo intuitivo, y da un centavo de diferencia en una fracción de los casos. | RN-VT1, con barrido de precios. |
| R-05 | **Imputarle costo a la merma de fraccionamiento.** | Parece contable: "se perdió producto, se perdió plata". | D-06.b y RN-FR8: la suma de costos de la operación es cero. Fraccionar no cambia el valor del inventario. |
| R-06 | **Agregar `modulo_auditoria` al ENUM y olvidarse del tipo `AuditModule`, o al revés.** | Son dos archivos distintos y el error es asimétrico: el typecheck frena un caso y el otro **falla en silencio**. | RN-SC6 y la migración de ENUMs en C1, antes de cualquier service. |
| R-07 | **Descontar atravesando el factor de conversión.** | El usuario pide un comprimido, hay cajas, "y total es lo mismo". | RN-FR12: el sistema ofrece fraccionar, no descuenta de la caja. |
| R-08 | **Permitir des-fraccionar "porque es obvio".** | El pedido llega la primera vez que alguien carga mal. | D-06.c y RN-FR9: no hay RPC, no hay permiso, y la relación inversa falla por el anti-ciclo. |
| R-09 | **Reabrir una caja cerrada "solo para el admin".** | El pedido va a llegar el primer mes. | RN-CJ5 y RN-CJ8. La corrección va a la sesión siguiente. |
| R-10 | **Obligar a que el rendimiento sea igual al teórico.** | Simplifica la pantalla y "cuadra". | Es la forma más rápida de perder el inventario: la gente falsea los recuentos. D-06.a. |
| R-11 | **Zona horaria en el corte de caja.** | El sistema no tiene hoy una zona horaria configurable, y un turno que cruza la medianoche con `now()` en UTC parte el día en dos. | **Este módulo no la introduce** —es transversal y afecta también a turnos y estadías—, pero el cierre de caja es el primer lugar donde el problema se vuelve visible. Anotarlo como deuda del sistema y probar el caso de una sesión que abre 21:00 y cierra 01:30. |
| R-12 | **Embed de PostgREST roto por las FKs compuestas.** | Costo conocido del patrón, que se descubre a mitad de camino. | Nombrar constraints en C1 y embeber por nombre, como ya hace `usuarios_rol_tenant_fkey`. |
| R-13 | **Explosión del catálogo sin control.** | Cada fraccionamiento crea productos; a los seis meses hay 400 fichas y nadie encuentra nada. | Familias, creación desde plantilla, búsqueda por familia y baja lógica agresiva (D-06.e, P-09). |
| R-14 | **Olvidar `NOTIFY pgrst, 'reload schema'`.** | Se nota tarde y el síntoma engaña: el RPC "no existe" aunque la migración se aplicó. | Está en la convención de la casa y el guard `rpcReallyRan()` de los tests lo detecta como falso verde. |
| R-15 | **Un lote genérico por compra para productos sin control de lote.** | Puede sorprender ver 12 lotes de un collar. | Es correcto: cada uno tiene su costo. La UI los agrupa; el libro mayor no. |

### 12.2. Qué decisión sería más cara de revertir en la etapa de fraccionamiento

Las tres primeras son irrecuperables sin reconstruir datos que para entonces no van a existir.

**1. No poner `lote_padre_id` en la migración de C2.** La más cara. La cadena de trazabilidad no
se puede inferir después: dado un lote de kilos sueltos creado hace ocho meses, **no hay dato en
el sistema que diga de qué bolsa salió**. No es un `UPDATE` costoso: es información que no
existe. **Costo hoy: una columna. Costo después: imposible para los datos históricos.**

**2. Modelar el fraccionamiento como producto + unidad + factor.** Si C2 permite que un producto
tenga varias unidades y un factor, C6 no es una feature: es una migración que tiene que decidir,
para cada existencia histórica, cuánto era bolsa y cuánto suelto —cuando el sistema nunca guardó
esa distinción—. Precios, vencimientos y costos quedan mezclados sin forma de separarlos.

**3. Guardar el costo en el producto en vez de en el lote.** La herencia proporcional (D-06.b)
solo funciona si el lote padre tiene costo propio. Con el costo en el producto, todos los
movimientos anteriores quedan valuados mal sin forma de recomponerlos.

**4. No tener `operacion_id`.** Sin él, los tres o cuatro movimientos de un fraccionamiento son
asientos sueltos que nadie puede volver a agrupar, y la pantalla de "historial de
fraccionamientos" se vuelve un ejercicio de adivinación por `created_at`.

**5. `NUMERIC` sin escala para gramos.** Con `NUMERIC(14,2)` en cantidades, 14,235 kg se redondea
y la merma se contamina con error de redondeo. Cambiar la escala después es una migración de la
tabla más pesada del módulo, con recálculo de toda la caché.

**6. Unidades sin `admite_decimales`.** Sin esa bandera, en C6 no hay forma de distinguir "medio
comprimido no existe" de "medio kilo sí existe", y la validación termina siendo una lista de
nombres de unidades codificada en el service.

**7. `tipo_movimiento_stock` sin los valores de conversión desde C1.** Agregar valores a un ENUM
es barato, pero si C4 se implementa asumiendo que solo hay entradas y salidas, los reportes, los
filtros y las pantallas se escriben sobre esa premisa y hay que revisarlos todos.

**Resumen para el dueño:** el fraccionamiento se **implementa** en C6, pero se **decide** en C2.

### 12.3. Sobre testear las reglas que dependen de la base

Varias RN no dicen "el sistema hace X" sino "**la base rechaza X**": RN-MV2 (inmutabilidad),
RN-MV5 (existencia no negativa), RN-MV11 (adulteración de la caché), RN-SC2 (FK compuesta
cross-tenant). Un test que revisa el código fuente y verifica que no aparece cierta cadena de
texto **no prueba esas reglas**: pasa en verde aunque el trigger no exista.

**Buena noticia verificada en el repo: no hace falta la dependencia `pg`.** Los tests de
integración ya usan un cliente `service_role` de `supabase-js` (`serviceDb` en
`guarderia.integration.test.ts`), y ese cliente **puede intentar la operación prohibida contra
PostgREST y recibir el error del trigger o del CHECK**:

```ts
const { error } = await serviceDb
  .from("movimientos_stock")
  .update({ cantidad: 999 })
  .eq("id", movimientoId);
expect(error?.message).toMatch(/MOVEMENT_IMMUTABLE/);
```

Eso cubre RN-MV2, RN-MV5, RN-MV11 y RN-SC2 con la infraestructura que ya existe.

**Lo que sí falta y hay que presupuestar:**

1. **Arnés de repetición** para RN-SC8 y la doble apertura de RN-CJ4. El patrón existente corre
   **una** iteración; una condición de carrera no falla siempre, falla a veces. El número de
   ciclos va por variable de entorno con default 50, **no editando el test**: el final clásico
   de esta historia es que en CI tarda, alguien lo comenta "por ahora", y no vuelve nunca.
2. **Fixture de volumen versionado** para el `EXPLAIN` de C8. `docs/EXPLAIN_INDICES.md` deja
   constancia de que el seed de volumen de la Etapa 9 vivió en `scratchpad/` y **no se
   versionó**. Verificar que una consulta usa índice contra una tabla de 12 filas no significa
   nada: con esos datos Postgres hace scan secuencial porque es más rápido.

---

## 13. Qué queda afuera, y por qué

### 13.1. Fuera de alcance, con la dimensión reservada

Tres de las cuatro exclusiones pedidas se mantienen **como features**, pero se recomienda
reservar la columna. El criterio es el mismo: **la columna cuesta una línea hoy; el retrofit
cuesta una migración sobre la tabla más grande del módulo.** Es la lógica de `lote_padre_id`,
ya aceptada.

**Depósitos múltiples — feature afuera, columna adentro.** No se implementa nada: ni depósitos,
ni transferencias, ni stock por ubicación, ni pantallas. Se recomienda
`movimientos_stock.deposito_id` y `lotes.deposito_id`. Dos motivos: agregar una dimensión al
libro mayor después obliga a reescribir todas las consultas de existencia y a decidir
retroactivamente dónde estaba cada cosa; y el punto N-3 del contexto normativo menciona
movimientos entre depósitos o establecimientos. **Esto amplía levemente el alcance pedido, así
que lo decide el dueño (P-08).** Es la exclusión más defendible de las tres.

**Cadena de frío — feature afuera, columna adentro.** No hay registro de temperatura, sensores,
alertas ni bitácora. Se recomienda `productos.requiere_frio` para mostrar un aviso en la
recepción de mercadería y poder filtrar. Una columna booleana contra una tabla de mediciones que
nadie pidió.

**Códigos de barras — lectura sí, el resto afuera.** Se deja `productos.codigo_barras` con
índice único parcial, porque **una pantalla de venta que no permite buscar por código es lenta
de usar desde el primer día** y agregar la columna después obliga a recargar el catálogo a mano.
Queda afuera: integración con lector, impresión de etiquetas, generación de códigos internos y
códigos por lote. Un lector estándar se comporta como un teclado, así que el campo de búsqueda
funciona con lector sin escribir una línea de integración.

### 13.2. Fuera de alcance, completo

**Órdenes de compra con circuito de aprobación.** Totalmente afuera y **sin reservar nada**. Una
clínica de este tamaño compra por WhatsApp al proveedor; un circuito de aprobación agrega
fricción sin resolver ningún problema actual. Y a diferencia de las tres anteriores,
incorporarlo después **no requiere migrar datos**: es una tabla nueva más un estado en `compras`.

| Excluido | Motivo |
|---|---|
| Facturación electrónica, ARCA, CAE | Decidido por el dueño (D-03). El lugar está reservado. |
| Integración con SIGTRAZAVET | D-15. Contrato externo en movimiento. |
| Tabla `receta` y circuito de recetas | D-14. Solo las columnas. |
| Cuenta corriente operativa | D-08. Solo el modelo. |
| Listas de precios múltiples y precios por cliente | Nadie lo pidió. Aditivo. |
| Promociones, combos y descuentos por volumen | Aditivo sobre `ventas_items`. |
| Prorrateo de flete y percepciones en el costo | Aditivo: `compras.costos_adicionales` cuando haga falta. |
| Reserva de stock para pedidos | No hay pedidos en el alcance. |
| Multi-moneda | La clínica opera en pesos. |
| Impresión de tickets | Capa de presentación. |
| Zona horaria configurable | Transversal al sistema, no de este módulo. Ver R-11. |

---

## 14. Matriz RN → test

Para `docs/MATRIZ_RN_TESTS.md`, con su formato (`| RN | ✅ | archivo |`). Los tests van en el
archivo del módulo con el código citado en el título del `it()`, según `CLAUDE.md`. Primeras
filas como referencia:

| RN | Etapa | Archivo | Caso |
|---|---|---|---|
| RN-PR5 | C1 | `tests/unit/productos.service.test.ts` | Cambio de unidad con y sin movimientos previos. |
| RN-SC4 | C1 | `tests/integration/rls.test.ts` | Aislamiento de las tablas nuevas. **Bloqueante.** |
| RN-SC6 | C1 | `tests/unit/audit.test.ts` | Todos los `module` usados existen en el ENUM y en `AuditModule`. |
| RN-MV2 | C2 | `tests/integration/stock.integration.test.ts` | `UPDATE` y `DELETE` con `service_role` rebotan contra el trigger. |
| RN-MV11 | C2 | `tests/integration/stock.integration.test.ts` | Caché adulterada, detectada y reconstruida. |
| RN-LO4 | C2 | `tests/unit/stock.service.test.ts` | Lote vencido rechazado para los tres roles. |
| RN-CJ4 | C3 | `tests/integration/caja.integration.test.ts` | Doble apertura simultánea: gana una. |
| RN-VT1 | C4 | `tests/unit/ventas.service.test.ts` | Barrido de precios verificando `neto + iva = precio`. |
| RN-CJ3 | C4 | `tests/unit/caja.service.test.ts` | Venta en cuenta corriente que no altera el arqueo. |
| RN-SC8 | C4 | `tests/integration/ventas.integration.test.ts` | Dos `.rpc()` sobre un lote con existencia 1, N repeticiones. |
| RN-FR7 | C6 | `tests/unit/fraccionamiento.service.test.ts` | Costo del hijo sobre la cantidad obtenida, no la teórica. |
| RN-FR8 | C6 | `tests/integration/fraccionamiento.integration.test.ts` | Suma de costos de la operación igual a cero. |
| RN-FR12 | C6 | `tests/unit/fraccionamiento.service.test.ts` | No se descuenta atravesando el factor. |

---

## 15. Las preguntas que no puedo contestar

Decisiones de negocio. Ninguna se resuelve leyendo el código.

**P-01 — ¿Stock y ventas se venden como un módulo o como dos?** La propuesta técnica es dos
(`stock` y `ventas`, con dependencia), porque controlar insumos sin vender al público es un
producto vendible por sí solo. Dos preguntas atadas: si es uno, el valor es `comercial` y es el
**cuarto** de `modulo_vendible`; si son dos, son el cuarto y el quinto. Y en cualquier caso hay
que decidir **qué plan los habilita** en `on_tenant_created()` —hoy `basico` da historial,
`profesional` suma turnos y `premium` suma guardería—. **Bloquea la etapa C1.**

**P-02 — ¿Cómo se posiciona el negocio frente al fraccionamiento y la receta electrónica?** Los
tres puntos de la sección 3 chocan con prácticas descritas como habituales y salen de fuentes
secundarias a verificar con el Colegio Médico Veterinario de la Provincia de Córdoba. El sistema
no toma partido: registra el fraccionamiento como hecho trazable y deja las columnas de receta
vacías. Tres decisiones son del negocio: si el fraccionamiento sigue siendo práctica y bajo qué
condiciones; si corresponde alguna inscripción registral; y si la receta pasa a ser requisito
operativo y cuándo.

**P-03 — ¿Hace falta cuenta corriente en la primera tanda?** El modelo le deja lugar y el arqueo
ya está protegido (D-08), así que no es urgente. La pregunta real es si hoy existen clientes que
se llevan mercadería y pagan después. Si existen aunque sean tres, cambia la prioridad de C9, no
el modelo.

**P-04 — ¿Aplicar una vacuna va a exigir que el insumo esté cargado en stock?** Consecuencia
práctica de D-01; cambia el flujo de los veterinarios. Si el insumo no está cargado hay tres
opciones: bloquear, permitir el consumo con existencia negativa —que este documento prohíbe— o
permitir el acto clínico sin descontar y marcarlo como pendiente de regularizar. **La tercera es
la única compatible con el modelo**, pero hay que decidir si se ofrece. Afecta C7.

**P-05 — ¿La clínica es monotributista o responsable inscripta?** Determina
`iva_compras_es_costo` (D-04). Un módulo que valúa el inventario sin el IVA cuando el IVA no se
recupera subestima el costo un 21 % y todos los márgenes salen inflados. **Bloquea C2.**

**P-06 — Precios de servicios: ¿existen, y quién los carga?** El sistema **no tiene ninguna
columna de precio hoy**. Agregar `servicios.precio` es una línea; cargar la lista de todos los
servicios de la clínica es una tarea de datos que alguien tiene que hacer antes de que C4 sirva
para algo. Atado: si "vacuna + aplicación" se cobra como dos líneas, conviene un valor propio en
`tipo_servicio` (9.4).

**P-07 — ¿Quién puede fraccionar y quién puede ver las ventas de los demás?** La propuesta de
8.2 le da `split_stock` al veterinario y a la recepcionista, y reserva `view_sales` para el
admin. Si preferís que fraccionar sea operación controlada, se saca el permiso, asumiendo que a
veces se va a fraccionar sin registrar hasta que pase el administrador.

**P-08 — ¿Se reserva la dimensión de depósito?** Sección 13.1. Es la única recomendación de este
documento que **amplía** el alcance pedido, aunque sea por una columna.

**P-09 — ¿Cuántos productos derivados va a haber realmente?** No cambia el modelo, cambia la UI.
Con 80 fichas la búsqueda simple alcanza; con 400 porque casi todo se fracciona, la pantalla de
venta necesita búsqueda por familia y favoritos desde C4, no desde C8.

**P-10 — ¿Proveedor y cliente son la misma entidad con dos papeles?** Ver D-17. Verificado que
`clientes` no tiene estructura comercial, así que las tres opciones siguen abiertas. La
propuesta es no migrar `clientes` ahora, pero **esta decisión vence en C1**: pasar a entidad
compartida con proveedores y compras cargados cuesta muchísimo más. Las preguntas concretas:
¿cuántos sujetos reales son cliente y proveedor a la vez? Y si son más que un par, ¿alcanza con
enlazar las fichas o querés una sola ficha con dos roles?

---

*Fin del documento. Ninguna de estas decisiones está implementada: esto es una propuesta para
revisar, discutir y cortar en etapas.*
