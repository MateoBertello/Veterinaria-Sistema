# Prompt 0 — Planificación del Módulo Comercial
**v3 — reemplaza por completo a las versiones anteriores. Si tenés la v1 o la v2, descartalas.**

> **Cómo usar este archivo:** copiarlo entero como primer mensaje de una sesión **nueva y
> vacía** de Claude Code corriendo **Opus**, con `ESPEC_MODULO_COMERCIAL.md` (v1.0) en la raíz
> del repo. El resultado de esta sesión son **documentos y prompts**, no código.

---

## Rol

Sos el planificador del Módulo Comercial. Tu entregable es el plan de etapas y **el juego
completo de prompts** que van a ejecutar las sesiones siguientes.

**No implementás nada en esta sesión.** Ni una migración, ni un service, ni un endpoint.

## El esquema de trabajo que tenés que producir

El desarrollo se reparte entre tres roles, y cada prompt que escribas tiene que declarar cuál
es el suyo en su encabezado.

| Rol | Modelo | Qué hace | Cuántos |
|---|---|---|---|
| **Plan** | Opus | Esta sesión. Corta las etapas y escribe los prompts. | 1 |
| **Ejecución** | Sonnet o Gemini Flash | Implementa una tanda acotada de trabajo mecánico. | 3–4 por etapa |
| **Auditoría** | Opus | Revisa la etapa completa contra la spec y `CLAUDE.md`, y emite veredicto. | 1 por etapa |

**Por qué se reparte así.** Cuando la especificación es precisa, implementar es trabajo
mecánico: crear una tabla que ya está descripta columna por columna, escribir un service que
copia un patrón existente, agregar tests cuyos casos ya están redactados. Eso lo hace bien un
modelo rápido y sale mucho más barato. Lo que **no** es mecánico es darse cuenta de que un
filtro `tenant_id` falta en una consulta de siete, que un test pasa sin probar nada, o que una
decisión de implementación contradice una decisión de diseño tres secciones más arriba. Eso
necesita juicio y contexto largo, y ahí va Opus.

**La consecuencia para vos:** los prompts de ejecución tienen que ser **lo bastante explícitos
como para que no haga falta juicio**. Cada archivo con su ruta exacta, cada patrón con el
archivo del repo que hay que copiar, cada criterio de aceptación verificable con un comando.
Un prompt de ejecución que dice "implementá el service siguiendo las convenciones del repo"
está mal escrito: el modelo de ejecución no va a leer quince archivos para inferirlas.

---

## FASE 0 — Reconocimiento (corta, porque la spec ya está anclada)

`ESPEC_MODULO_COMERCIAL.md` v1.0 se escribió **leyendo este repositorio**: no tiene asunciones
pendientes y su sección 0.1 documenta la arquitectura real (service_role + filtro explícito,
RLS de solo lectura, RPC con `p_tenant_id`, `NOTIFY pgrst`, permisos en inglés, prefijos de RN
por subdominio). **No repitas ese trabajo.**

Lo que sí tenés que hacer, porque de esto dependen las rutas exactas que van a ir en los
prompts:

1. Leé `CLAUDE.md` completo.
2. Leé `docs/PLAN_ETAPAS.md` — vas a replicar su formato.
3. Leé `docs/MATRIZ_RN_TESTS.md` — vas a replicar su formato de fila.
4. Leé **un módulo entero** como plantilla: `supabase/functions/api/src/modules/servicios/`
   (`.controller.ts`, `.service.ts`, `.schemas.ts`) más `tests/unit/servicios.service.test.ts`.
   Es el CRUD más limpio y el que los prompts de ejecución van a citar como patrón a copiar.
5. Leé `supabase/functions/api/src/modules/guarderia/guarderia.service.ts` (llamada a RPC) y
   `tests/integration/guarderia.integration.test.ts` (patrón concurrente con
   `rpcReallyRan()`). Son el patrón de las operaciones transaccionales.
6. Leé `supabase/functions/api/src/main.ts` para saber **exactamente** cómo se registran las
   rutas y en qué orden se aplican `tenantContext`, `requireModule` y `requirePermission`.
7. Anotá el número de la última migración para que la numeración nueva siga la secuencia.

**Si algo de lo que leas contradice la spec, frená y reportalo.** La spec se escribió leyendo
el repo, pero pudo cambiar algo, o pude haberme equivocado. Una contradicción no se resuelve en
silencio.

---

## FASE 1 — Decisiones que bloquean etapas

La sección 15 de la spec tiene diez preguntas. Tres bloquean el arranque y **hay que
preguntarlas antes de escribir el plan**:

| Pregunta | Qué bloquea | Etapa |
|---|---|---|
| **P-01** — ¿uno o dos módulos vendibles, y qué plan los habilita? | valores de `modulo_vendible` y `on_tenant_created()` | C1 |
| **P-10** — ¿proveedor y cliente son la misma entidad? | tabla `proveedores` y sus FKs | C1 |
| **P-05** — ¿monotributista o responsable inscripto? | `iva_compras_es_costo` y la valuación de los lotes | C2 |

Las otras siete van con **default marcado** dentro del prompt de su etapa, con la ruta del
archivo a tocar si el dueño responde distinto. Un default sin marcar es una decisión que nadie
tomó y que nadie va a encontrar después.

Si el usuario ya te dio las respuestas en su mensaje, seguí. Si no, **pedilas y esperá**.

---

## FASE 2 — El plan de etapas

Escribí `PLAN_ETAPAS_COMERCIAL.md` en la raíz (**`/docs` es de solo lectura**), con el formato
de `docs/PLAN_ETAPAS.md`: objetivo, alcance, criterios de aceptación (RN), entregables.

Partí del corte de la sección 11 de la spec —C1 catálogo, C2 libro mayor y compras, C3 caja,
C4 ventas, C5 ajustes y recuento, C6 fraccionamiento, C7 consumo clínico, C8 reportes— y
**ajustalo si el repo te muestra algo que la spec no previó.** Si lo cambiás, decí por qué.

Restricciones de orden que no se negocian:

- **C5 (ajustes) antes que C6 (fraccionamiento).** D-06.c define que un fraccionamiento mal
  hecho se corrige con un ajuste motivado; si el fraccionamiento se habilita antes, el único
  camino de corrección no existe y el primer error se va a arreglar por SQL contra producción.
- **`lote_padre_id` en C2**, aunque no se use hasta C6 (D-13).
- **La migración de ENUMs en C1, en archivo propio**, y con los seis valores agregados también
  al tipo `AuditModule` de `shared/audit.ts`.

Para cada etapa, además de lo que pide el formato del repo, agregá **el corte en tandas de
ejecución**: cómo se reparte la etapa en 3 o 4 unidades de trabajo, y qué entrega cada una.

---

## FASE 3 — Los prompts

Un archivo por prompt en `prompts_etapas/`, y **además** un archivo único
`PROMPTS_ETAPAS.md` en la raíz con todos los prompts en bloques de código listos para copiar y
pegar, precedidos de una línea que diga cuándo usar cada uno y qué modelo le toca. Ese archivo
no lleva nada afuera de los bloques salvo esas líneas de encabezado.

### 3.1. Plantilla del prompt de EJECUCIÓN

```markdown
# ETAPA C<N> · TANDA <n>/<total> — <título>
> **Modelo:** Sonnet o Gemini Flash · **Rol:** ejecución
> **Precondición:** la tanda anterior está en verde (`npm test` + `npm run typecheck`).

## 0. Leé estos archivos antes de escribir código
<rutas exactas, con qué buscar en cada una:>
- CLAUDE.md — las 8 reglas de arquitectura
- ESPEC_MODULO_COMERCIAL.md §<secciones exactas>
- <ruta del archivo del repo que es el patrón a copiar> — copiá su estructura
- <ruta del test que es el patrón a copiar>

## 1. Qué construir
<lista cerrada de archivos a crear, con ruta completa>
<lista cerrada de archivos existentes a modificar, con qué se le agrega a cada uno>

## 2. Especificación exacta
<las tablas con sus columnas, o las firmas de las funciones, o los casos de los tests.
 COPIADO de la spec, no referenciado: el modelo de ejecución no debe tener que buscarlo.>

## 3. RN que cubre esta tanda
<código, enunciado en una línea, y el `it('RN-xx: ...')` que hay que escribir>

## 4. Orden de trabajo
1. Migración (si aplica). Numeración: <AAAAMMDD>0000<n>_<nombre>.sql
2. Tests de las RN de esta tanda. **Corrélos y verificá que fallan por el motivo correcto**
   antes de implementar. Un test que nunca estuvo en rojo no prueba nada.
3. Implementación.
4. `npm test && npm run typecheck` en verde.
5. Agregar las filas a MATRIZ_RN_TESTS_COMERCIAL.md.

## 5. Definición de hecho
<verificable con comandos, no "está listo">

## 6. Qué NO hacer
- No toques ningún archivo fuera de las listas de la sección 1.
- No refactorices código existente. Si ves algo mejorable, anotalo en el reporte.
- No agregues dependencias.
- No modifiques migraciones ya aplicadas: creá una nueva.
- No modifiques ESPEC_MODULO_COMERCIAL.md.
- Si algo de la spec no se puede implementar como está escrito, **frená y reportá**. No
  improvises una alternativa.

## 7. Reporte final (obligatorio, va al chat)
- Archivos creados y modificados.
- RN cubiertas y resultado de los tests.
- Qué quedó pendiente.
- Qué contradicción o duda apareció.
```

### 3.2. Bloque de reglas transversales

Cada prompt de ejecución lo lleva **copiado textual**. Es repetitivo a propósito: es lo que se
olvida en la tanda número seis, y el modelo de ejecución no arrastra el contexto de las
anteriores.

```
- tenant_id SIEMPRE de ctx.tenantId (que viene del JWT vía tenantContext). Ningún handler
  lo lee del body, query o params.
- Los Services escriben con getServiceDb() y filtran .eq('tenant_id', tenantId) en TODA
  consulta, sin excepción. service_role bypasea RLS: el filtro es el aislamiento.
- Los RPC son SECURITY DEFINER, reciben p_tenant_id como primer parámetro y filtran por él
  en cada lectura y escritura. Cierran con REVOKE ALL ... FROM PUBLIC + GRANT EXECUTE ...
  TO service_role.
- Toda migración que cree o cambie un RPC termina con NOTIFY pgrst, 'reload schema';
- Envelope estándar: ok(data, meta?) / fail(code, message, statusCode, details).
- Los ErrorCode salen del enum central de shared/errors.ts. No inventar códigos.
- Errores de negocio en RPC: RAISE EXCEPTION '<ERROR_CODE>'; el Service los mapea a
  DomainError.
- Auditoría: recordAudit() desde el Service; INSERT INTO registros_auditoria DENTRO del RPC
  para operaciones transaccionales (patrón registrar_eutanasia).
- Toda escritura de existencia va por RPC con SELECT ... FOR UPDATE ordenado por lote_id.
  El Service NUNCA lee existencias para decidir.
- RLS de las tablas nuevas: ENABLE (sin FORCE), política FOR SELECT con usuario_activo() y
  tiene_permiso('<permiso>'). Sin políticas de escritura. Sin GRANT propio.
- NUMERIC con precisión explícita. Nunca float.
- Nada se borra ni se edita: se compensa con un asiento nuevo y motivo.
- Nombres del glosario (§1 de la spec) iguales en base, código, ErrorCode y UI.
```

### 3.3. Plantilla del prompt de AUDITORÍA

Uno por etapa, después de la última tanda.

```markdown
# AUDITORÍA — ETAPA C<N>
> **Modelo:** Opus · **Rol:** auditoría y control
> No implementás. Revisás, emitís veredicto y, si hace falta, escribís el prompt de
> corrección para la sesión de ejecución.

## 0. Material
- Diff completo de la etapa (`git diff <sha_inicio>..HEAD`).
- ESPEC_MODULO_COMERCIAL.md §<secciones de la etapa>
- CLAUDE.md
- Los reportes de las tandas <n> a <m>.

## 1. Controles obligatorios
<los ocho de la sección 4 de este documento, instanciados para esta etapa>

## 2. Controles específicos de esta etapa
<los modos de falla silenciosa que aplican, tomados de §12.1 de la spec>

## 3. Veredicto
Uno de tres, explícito:
- **APROBADA** — se avanza a la etapa siguiente.
- **APROBADA CON CORRECCIONES** — lista numerada de correcciones, cada una con archivo,
  qué está mal y qué tiene que decir. Al final, el prompt de corrección listo para pegar
  en una sesión de ejecución.
- **RECHAZADA** — qué decisión de diseño se violó y por qué rehacer es más barato que
  parchar.

## 4. Qué NO hacer
- No implementes las correcciones vos: escribí el prompt para que las haga la sesión de
  ejecución. La separación de roles es lo que mantiene el costo abajo.
- No apruebes con pendientes "menores". Un pendiente aprobado es deuda invisible.
```

---

## 4. Los ocho controles de auditoría

Todo prompt de auditoría los instancia. Una etapa no se aprueba si alguno queda sin verificar.

| # | Control | Cómo se verifica |
|---|---|---|
| 1 | **RN cubiertas** | Toda RN de la etapa tiene test que cita su código en el `it()`, y pasa. Ninguna fila de la matriz queda en `PENDIENTE`. |
| 2 | **Filtro de tenant en cada consulta** | Recorrer **todas** las consultas nuevas y verificar `.eq('tenant_id', tenantId)`. Con `service_role` no hay RLS que salve el olvido: una consulta sin filtro devuelve datos de todos los tenants y **no da error**. |
| 3 | **Aislamiento** | `tests/integration/rls.test.ts` extendido con las tablas nuevas, en verde. Y el test de FK compuesta: una fila que referencia a otra de otro tenant falla **por FK**, no por validación de aplicación. |
| 4 | **Auditoría** | Cada operación deja asiento con su `module` correcto; si la operación falla no queda asiento huérfano. **Verificar que el valor está en el ENUM `modulo_auditoria` Y en el tipo `AuditModule` de `shared/audit.ts`**: si falta en el ENUM, `recordAudit` loguea y sigue, y los asientos se pierden en silencio. |
| 5 | **Permisos y licenciamiento** | Matriz rol × endpoint con el 403 esperado; módulo no contratado → `MODULE_NOT_LICENSED`. |
| 6 | **Concurrencia** | En las etapas que escriben existencia o caja: dos `.rpc()` en paralelo, con el guard `rpcReallyRan()`, N repeticiones configurables. Verificar que el `FOR UPDATE` existe y que el orden de bloqueo es por `lote_id`. |
| 7 | **Grants y PostgREST** | `has_function_privilege('anon'|'authenticated', …)` da `false` para todos los RPC nuevos. Toda migración de RPC termina con `NOTIFY pgrst`. |
| 8 | **Los tests prueban algo** | Buscar tests que pasarían aunque la funcionalidad no existiera: asserts sobre mocks propios, `expect(true)`, guardrails de texto donde correspondía probar contra la base. Ver §12.3 de la spec. |

---

## 5. Cómo repartir el trabajo en tandas

Criterio: **una tanda es una unidad que el modelo de ejecución puede completar sin tomar
decisiones de diseño.** En la práctica eso suele dar este corte:

| Tanda | Contenido típico |
|---|---|
| 1 | Migraciones: ENUMs, tablas, índices, RLS, triggers, seed. |
| 2 | RPC y funciones SQL, con sus grants y su `NOTIFY`. |
| 3 | Service + Controller + Schemas + rutas. |
| 4 | Tests de las RN + matriz. |

Con dos salvedades:

- **Los tests no se dejan siempre para el final.** En las etapas con reglas que la base tiene
  que rechazar —inmutabilidad, existencia no negativa, FK cross-tenant— el test va en la misma
  tanda que la migración que lo hace cumplir. Si no, la tanda 1 se da por buena sin que nadie
  haya comprobado que el trigger funciona.
- **Una tanda no mezcla migración con lógica de negocio.** Son dos modos de error distintos y
  conviene poder revisar el diff de la migración solo.

---

## 6. Qué NO hacer en esta sesión

- No implementar nada.
- No escribir en `/docs`. Todo va a la raíz o a `prompts_etapas/`.
- No modificar `ESPEC_MODULO_COMERCIAL.md`: si algo está mal, reportalo.
- No decidir P-01, P-05 ni P-10. Preguntalas.
- No escribir prompts de ejecución que dependan de juicio. Si al escribir uno te sale una
  instrucción del tipo "decidí lo que sea más apropiado", eso significa que la spec no cubre
  ese punto y hay que resolverlo acá, no ahí.

---

## 7. Entregables

1. `PLAN_ETAPAS_COMERCIAL.md` — con el corte en etapas y el corte en tandas.
2. `prompts_etapas/C<N>_T<n>_<slug>.md` — un prompt de ejecución por tanda.
3. `prompts_etapas/C<N>_AUDITORIA.md` — un prompt de auditoría por etapa.
4. `PROMPTS_ETAPAS.md` — todos los anteriores en bloques de código listos para copiar y
   pegar, con una línea de encabezado por prompt indicando **cuándo usarlo y qué modelo**.
5. `MATRIZ_RN_TESTS_COMERCIAL.md` — el esqueleto con las 90 RN, su etapa y el archivo de test
   previsto, todas en `PENDIENTE`. Se va llenando etapa por etapa.
6. Un resumen en el chat, de diez líneas o menos: cuántas etapas y cuántas tandas quedaron,
   qué cambiaste del corte de la spec y por qué, y qué te llamó la atención del repo que la
   spec no menciona.

---

## 8. Cuándo frenar y preguntar

Frená antes de escribir el plan si encontrás que algo de la spec no coincide con el repo, si
una etapa no se puede cortar en tandas sin que alguna requiera decisiones de diseño, o si
alguna de las tres preguntas bloqueantes sigue sin responder. Planificar ocho etapas sobre una
premisa falsa cuesta mucho más que una pregunta.
