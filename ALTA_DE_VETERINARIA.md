# Alta de una veterinaria en VeterCor

Runbook operativo para dar de alta **una clínica real** que va a cargar datos de
verdad. Está escrito para seguirse de arriba abajo, en orden, una sola vez por
clínica.

No es un documento de arquitectura. Cada paso trae el comando o la pantalla
exacta, cómo se ve que salió bien, y qué hacer si sale mal.

> **Leé la sección 0 completa antes de tocar nada.** Hoy el sistema en
> producción está varias versiones atrás del repositorio, y hay dos decisiones
> que tenés que tomar antes de crear la clínica, no después.

---

## Antes de empezar: qué necesitás tener a mano

| Cosa | De dónde sale |
| :--- | :--- |
| Supabase CLI, binario standalone | Ver `scripts/README.md` § Requisitos. En Linux **no** lo instales por npm. |
| Node 20+ y `npm install` corrido en la raíz | El repositorio |
| `service_role key` del proyecto de producción | Dashboard de Supabase → Settings → API. **Es la llave maestra: bypassea RLS entera.** No la pegues en un chat ni la dejes en el historial del shell. |
| `anon key` del proyecto de producción | El mismo lugar. Es pública por diseño. |
| Los datos fiscales de la clínica | El cliente: nombre, CUIT o RUT, email de contacto |
| Un email y una contraseña para el administrador de la clínica | Acordado con el cliente |

**Ensayá primero en local.** Todo este runbook funciona igual contra el stack
local (`supabase start` + `supabase db reset`, ver `scripts/README.md`), donde un
error no cuesta nada. Hacelo una vez de punta a punta antes de correrlo contra la
clínica real.

---

## 0. Poner el sistema en marcha y con los cambios aplicados

### 0.1 Dónde corre el sistema hoy

Hay un proyecto Supabase de producción y el repositorio ya está vinculado a él.

| | |
| :--- | :--- |
| Proyecto | `VeterinariaLeo` (aparece como `VeterCor--Produccion` en el vínculo local) |
| Referencia | `rvcbtcjsvhqchunribwl` |
| Región | `sa-east-1` |
| Estado | `ACTIVE_HEALTHY` |

El frontend se publica en Vercel; la configuración de SPA está en
`web/vercel.json`. La guía completa de despliegue es `docs/DEPLOY.md` y este
runbook no la reemplaza.

Confirmá el vínculo antes de seguir:

```bash
cd ~/Veterinaria-Sistema
supabase projects list
```

**Sale bien:** una fila con `"linked":true` y `"status":"ACTIVE_HEALTHY"`.

**Sale mal:** si no estás logueado, corré `supabase login`. Si el proyecto no
figura como vinculado, `supabase link --project-ref rvcbtcjsvhqchunribwl`.

### 0.2 Qué está desplegado y qué no — leer sí o sí

**Producción está 33 migraciones atrás del repositorio.** La última migración
aplicada allá es `20260828000002`. Todo lo que vino después está solo en tu
máquina, y eso incluye **el módulo comercial completo**: stock, compras, caja,
ventas, ajustes, recuentos, fraccionamiento, consumo clínico y reportes.

Verificalo vos mismo:

```bash
supabase migration list --linked
```

**Se lee así:** cada migración muestra `local` y `remote`. Las que tienen
`remote` vacío no están aplicadas en producción.

**Si la llamada devuelve un 502 de Cloudflare**, es transitorio. Esperá un
minuto y repetí.

Esto te obliga a decidir algo **antes** de crear la clínica:

- **Si la clínica solo va a usar historial clínico, turnos y guardería**, no
  hace falta desplegar nada nuevo. Salteá al paso 1.
- **Si la clínica va a usar stock o ventas**, hay que desplegar primero. Seguí
  con 0.3.

No crees la clínica y después despliegues. El orden correcto es esquema, después
función, después datos.

### 0.3 Desplegar el esquema (`supabase db push`)

`db push` aplica contra producción todas las migraciones pendientes, en orden, y
**no toca los datos existentes**. Es distinto de `db reset`, que es lo que venís
usando: `db reset` **destruye la base local**, reaplica todo desde cero y corre
los seeds. `db reset` nunca se corre contra producción.

| Comando | Dónde | Qué hace |
| :--- | :--- | :--- |
| `supabase db reset` | Solo local | Borra la base, reaplica todas las migraciones, corre los seeds |
| `supabase db push` | Producción | Aplica solo las migraciones pendientes, conserva los datos |

Mirá primero, aplicá después:

```bash
supabase db push --dry-run
supabase db push
```

**Sale bien:** el `--dry-run` lista las 33 migraciones pendientes y el push las
aplica sin error. Repetí `supabase migration list --linked` y ninguna debería
quedar con `remote` vacío.

**Sale mal:** si una migración falla a mitad de camino, las anteriores ya quedaron
aplicadas. **No edites la migración que falló** — es una regla del proyecto y
además rompería el historial. Leé el error, y si hace falta un cambio, creá una
migración nueva.

### 0.4 Desplegar la Edge Function

En **local** la función corre sola: `supabase start` levanta el edge runtime como
un contenedor más. No hace falta `supabase functions serve`. Si alguna vez ves el
runtime como `stopped`, el síntoma es un `503` con `{"message":"name resolution
failed"}` en `/functions/v1/*`.

En **producción** hay que desplegarla a mano, y no con el comando crudo:

```bash
export SUPABASE_PROJECT_REF=rvcbtcjsvhqchunribwl
scripts/deploy-api.sh --dry-run
scripts/deploy-api.sh
```

El script existe porque `supabase functions deploy api` empaqueta **los archivos
que hay en disco**, no los del commit en el que creés estar parado. Ya pasó una
vez que se subió a producción un módulo a medio desarrollar. `deploy-api.sh`
materializa `origin/main` en un worktree descartable y despliega desde ahí.

> **Guarda que te va a frenar si vas a usar stock o ventas.** El script tiene una
> lista de módulos bloqueados y hoy es `BLOQUEADOS=(stock ventas)`. Con esa lista
> puesta, el deploy **aborta** al encontrar esos identificadores en el código.
> Es a propósito: son módulos que nunca se desplegaron. Para liberarlos, sacalos
> del array `BLOQUEADOS` en `scripts/deploy-api.sh`, commiteá ese cambio, y
> recién ahí desplegá. Hacelo como una decisión consciente, no para "pasar el
> error".

**Sale bien:** el script termina con su smoke test en verde. `/health` responde
`200` y `/especies` responde `401` — cuatrocientos uno, no cuatrocientos cuatro.
El `401` prueba que la ruta existe y está detrás de la autenticación.

**Sale mal:** si `/especies` da `404`, el deploy no tomó. Si da `200`, la
autenticación no está gateando y hay que parar todo.

### 0.5 Desplegar el frontend

En **local**, no hace falta build:

```bash
npm --prefix web run dev
```

Vite levanta en `http://localhost:5173` y proxea `/api/v1` y `/rest/v1` al stack
local. La configuración está en `web/vite.config.ts`.

En **producción**, el front se buildea y se sube a Vercel con root `web/`, build
`npm run build` y output `dist/`. El build **falla a propósito** si no le decís
cómo llega a la API. Tenés que tener seteadas en Vercel, como mínimo:

- `VITE_API_URL` = `https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1`
- `VITE_SUPABASE_URL` = `https://rvcbtcjsvhqchunribwl.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = la anon key del proyecto

El detalle completo, incluida la variante con reverse proxy, está en
`docs/DEPLOY.md` § 4.

**Sale mal:** si el build aborta con "BUILD ABORTADO — falta VITE_API_URL", es
exactamente esta guarda. No la desactives: sin ella el login falla en silencio en
producción, devolviendo el HTML del index en vez de la respuesta de la API.

### 0.6 Nada de esto está automatizado

Confirmado: `.github/workflows/ci.yml` corre **solo** typecheck y tests
unitarios. **No despliega nada.** Cada `db push`, cada `deploy-api.sh` y cada
build del front es manual y lo corre una persona desde su máquina.

### 0.7 Backups: hueco abierto

**El repositorio no documenta ningún procedimiento de backup ni de restauración.**
Busqué y no hay script, no hay sección en `docs/DEPLOY.md`, no hay job.

Si esta clínica va a cargar datos reales, resolvelo **antes** de que cargue el
primer cliente, no después:

1. Entrá al Dashboard de Supabase → Database → Backups y anotá qué te da el plan
   actual del proyecto: frecuencia de los backups automáticos, cuántos días se
   retienen, y si hay recuperación a un punto en el tiempo.
2. Probá una restauración **una vez**, sobre un proyecto de prueba. Un backup que
   nunca se restauró no es un backup.
3. Escribí lo que averiguaste en `docs/DEPLOY.md`, para que la próxima persona no
   tenga que volver a averiguarlo.

Mientras eso no exista, la respuesta honesta a "qué pasa si se pierde la base" es
que depende enteramente de lo que ofrezca el plan de Supabase y nadie lo verificó.

---

## 1. Crear el Super Admin y obtener su token

Sin Super Admin no podés hacer nada de lo que sigue.

### 1.1 Qué es un Super Admin

No es una columna, ni una tabla, ni un rol de la clínica. Es **un usuario de
Supabase Auth que tiene el claim `app_metadata.platform_role = "super_admin"`**.
No pertenece a ninguna clínica, no tiene fila en la tabla `usuarios`, y su token
no lleva `tenant_id`.

Eso es lo que verifica el middleware que protege `/api/v1/admin/*`, y lo mismo
que mira la función SQL `is_super_admin()`.

### 1.2 Cómo se crea el primero

**No hay problema del huevo y la gallina, y no hace falta SQL a mano.** El claim
solo se puede escribir con la `service_role key`, y para eso está el script
`scripts/crear-super-admin.mjs`. Es idempotente: correrlo dos veces no rompe
nada, y sobre un email que ya existe re-setea la contraseña, la confirmación y el
claim, conservando el resto de la metadata.

```bash
cd ~/Veterinaria-Sistema
export SUPABASE_URL="https://rvcbtcjsvhqchunribwl.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key del dashboard>"
export SUPABASE_ANON_KEY="<anon key del dashboard>"
export SUPER_ADMIN_EMAIL="super@tu-dominio.com"
export SUPER_ADMIN_PASSWORD="<una contraseña fuerte y propia>"
node scripts/crear-super-admin.mjs
```

**Sale bien:** el script imprime `✓ Verificado`. Con la anon key presente, además
de crear la cuenta inicia sesión y comprueba que el token que devuelve trae el
claim. No imprime ningún token.

**Sale mal:** si falta la anon key, el script crea la cuenta igual pero no
verifica el login. Si falla la escritura, casi siempre es la service role key mal
copiada.

**En local** no hace falta ni siquiera esto: `supabase db reset` deja creado
`super@leo.local` con contraseña `Super1234!`, desde `supabase/seed.sql`. Esa
cuenta es **solo de desarrollo**; no la lleves a producción.

### 1.3 Ver quién tiene acceso de plataforma

El dashboard de Supabase no muestra `app_metadata` en su listado de usuarios, así
que para esto hay un script:

```bash
node scripts/super-admins.mjs list
node scripts/super-admins.mjs revoke viejo@tu-dominio.com   # saca el claim, deja la cuenta
node scripts/super-admins.mjs delete viejo@tu-dominio.com   # borra la cuenta de Auth
```

Casi siempre lo que querés es `revoke`, no `delete`: deja la cuenta en pie, así
que los identificadores que aparezcan en la auditoría siguen siendo resolubles.
Ninguno de los dos te deja quedarte sin **ningún** Super Admin, porque no hay
forma de recuperar el acceso desde la aplicación.

### 1.4 Entrar y obtener el token

**Por pantalla**, que es lo normal: abrí `/admin/login` en el front desplegado.
Con el email y la contraseña del paso 1.2. La sesión de plataforma vive en su
propio lugar del navegador, separada de la de la clínica, y se renueva sola.

**Por comando**, si preferís usar la API a mano:

```bash
curl -s -X POST \
  https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"super@tu-dominio.com","password":"<la contraseña>"}'
```

**Este login no necesita la anon key.** La Edge Function atiende el login sin
token, así que alcanza con el cuerpo. La anon key la vas a necesitar solo si
hablás directo con PostgREST o con GoTrue, y sale del Dashboard → Settings → API
(en local la imprimen `supabase start` y `supabase status`).

**Sale bien:** un envelope `{"success":true,"data":{"token":"eyJ..."}}`. Guardá
ese token en una variable de shell:

```bash
export SA_TOKEN="<el token>"
```

**Sale mal:** un `401 Credenciales inválidas`. Ese mismo mensaje sale tanto si la
contraseña está mal como si la cuenta existe pero **no tiene el claim** — es a
propósito, para no filtrar cuál de las dos cosas falló. Si dudás, corré
`node scripts/super-admins.mjs list` y fijate si el email aparece.

El token dura una hora. Si te vence a mitad del runbook, volvé a pedirlo con el
mismo comando.

---

## 2. Crear la clínica

### 2.1 Elegir el plan

El plan decide qué módulos quedan habilitados en el momento del alta:

| Plan | Módulos habilitados |
| :--- | :--- |
| `basico` | historial clínico |
| `profesional` | historial clínico, turnos, stock |
| `premium` | historial clínico, turnos, guardería, stock, ventas |

Si no ponés plan, queda `basico`. Se puede cambiar después (paso 5), así que no
te trabes acá.

> Recordá lo de la sección 0.2: elegir `profesional` o `premium` habilita stock y
> ventas **en los datos**, pero si el código de esos módulos no está desplegado,
> las pantallas no van a estar. Habilitar el módulo y desplegar el módulo son dos
> cosas distintas.

### 2.2 Dar el alta

**Por pantalla**, que es el camino recomendado: entrá a `/admin/tenants` y usá
el botón **Nuevo tenant**. El formulario pide los mismos cuatro campos y te avisa
que el plan define los módulos que quedan habilitados.

**Por comando:**

```bash
curl -s -X POST \
  https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "nombre": "Veterinaria San Martín",
        "cuitRut": "30-12345678-9",
        "emailContacto": "contacto@sanmartin.com",
        "plan": "premium"
      }'
```

Los cuatro campos son los únicos que acepta. El nombre necesita al menos 3
caracteres, el email tiene que tener formato de email, y el CUIT o RUT no puede
estar repetido.

**Nunca des el alta con un `INSERT INTO tenants` directo.** El alta por la API
llama al RPC `crear_tenant`, que a su vez dispara `on_tenant_created()`, y eso es
lo que aprovisiona toda la estructura de la clínica. Un INSERT directo se saltea
todo eso y deja la clínica a medias: sin permisos, sin configuración y sin
módulos.

**Sale bien:** un `201` con el envelope y el `id` de la clínica nueva. Anotalo,
lo vas a usar en los pasos siguientes:

```bash
export TENANT_ID="<el id que devolvió>"
```

**Sale mal:**

- `409 TENANT_DUPLICATE_TAXID` — ya existe una clínica con ese CUIT o RUT.
  Buscala con `GET /api/v1/admin/tenants?q=<cuit>` antes de crear otra.
- `422 VALIDATION_ERROR` — mirá `error.details`, dice qué campo está mal.
- `403` — tu token no acredita `platform_role`. Volvé al paso 1.4.
- `401` — el token venció. Pedilo de nuevo.

### 2.3 Qué se creó solo

`on_tenant_created()` deja, en una sola transacción:

- **Tres roles del sistema**: `admin`, `veterinario`, `recepcionista`
- **Los permisos de cada rol**: el rol admin recibe los 22 permisos del sistema;
  veterinario y recepcionista reciben subconjuntos fijos
- **La configuración de la clínica**: cupo diario de guardería 10, aviso de
  vacunas 7 días
- **Las cinco filas de módulos contratados**, habilitadas según el plan
- **El catálogo clínico semilla**: especies, razas y tipos de vacuna de esta
  clínica

**Qué NO se crea:** ningún usuario, ninguna familia de producto, ningún producto,
ningún precio, ningún proveedor y ninguna caja. Todo eso es el paso 6.

---

## 3. El usuario administrador de la clínica

La clínica que creaste en el paso 2 no tiene ningún usuario todavía. El alta deja
los roles, los permisos, la configuración y los módulos, pero nadie con quien
entrar. Este paso lo resuelve.

**El sistema no manda ningún mail de invitación.** El alta de la clínica no crea
ninguna cuenta y el email de contacto es solo un dato comercial. Si venís de una
versión anterior y esperabas ese mail, ya no existe: creaba una cuenta que nunca
podía entrar y quedaba dando vueltas en Supabase Auth.

El camino es corto: creás el administrador con una contraseña inicial que elegís
vos, se la pasás, y él la cambia al entrar.

### 3.1 Crear el administrador por la API

Es el camino principal. Con el token de plataforma del paso 1.4 y el
identificador de la clínica del paso 2.2:

```bash
curl -s -X POST \
  "https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants/$TENANT_ID/admin" \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "email": "admin@sanmartin.com",
        "fullName": "María González",
        "rol": "admin",
        "password": "<contraseña inicial, mínimo 8 caracteres>",
        "username": "admin_sanmartin"
      }'
```

| Campo | Obligatorio | Detalle |
| :--- | :--- | :--- |
| `email` | sí | Identifica la cuenta. Queda confirmada, sin mail de por medio. |
| `fullName` | sí | Nombre de la persona, hasta 150 caracteres |
| `rol` | no | `admin`, `veterinario` o `recepcionista`. Por defecto `admin`. |
| `password` | sí | Mínimo 8 caracteres. **No vuelve en la respuesta**, así que elegila vos y entregala por el canal que ya usás con el cliente. |
| `username` | no | Con esto se loguea. Si no lo mandás, se deriva del email y se desambigua dentro de la clínica. |

La contraseña se pide en vez de generarse a propósito: una contraseña generada
tendría que volver en la respuesta, y ahí queda en el scrollback de la terminal y
en el historial del cliente HTTP, un rastro que nadie borra.

Qué hace, en una sola operación: crea la cuenta en Supabase Auth con el
`tenant_id` en el lugar que la API realmente lee, crea la fila en `usuarios` con
el rol pedido, crea la fila en `doctores` si el rol es veterinario, y deja el
asiento de auditoría en el módulo `users` de la clínica.

**Sale bien:** un `201` con el usuario, incluido el `username` que quedó.

**Sale mal:**

- `200` en vez de `201` — el usuario ya existía en esa clínica. Es la respuesta
  idempotente y devuelve la fila que ya estaba, sin pisarle la contraseña ni el
  nombre de usuario. Repetir la llamada es seguro.
- `404 TENANT_NOT_FOUND` — el identificador de la clínica está mal. Revisalo con
  `GET /api/v1/admin/tenants`.
- `422 VALIDATION_ERROR` con "La clínica no tiene el rol" — la clínica no pasó
  por `crear_tenant`. Es el síntoma de un alta hecha por SQL directo. Volvé al
  paso 2.
- `409 DUPLICATE_USER` con "ya pertenece a otra cuenta" — ese email ya es de otra
  clínica o de un Super Admin. Usá otro email.
- `403` — tu token no acredita `platform_role`. Volvé al paso 1.4.

### 3.1b Alternativa de bootstrap: el script

`scripts/crear-usuario-tenant.mjs` hace lo mismo escribiendo con la service-role
key, sin pasar por la API. Sirve en dos situaciones: cuando la Edge Function
todavía no está desplegada, y cuando la API no responde y hace falta entrar
igual.

```bash
cd ~/Veterinaria-Sistema
export SUPABASE_URL="https://rvcbtcjsvhqchunribwl.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
export TENANT_CUIT="30-12345678-9"          # o TENANT_ID="$TENANT_ID"
export USUARIO_ROL="admin"
export USUARIO_EMAIL="admin@sanmartin.com"
export USUARIO_USERNAME="admin_sanmartin"    # con esto se loguea
export USUARIO_NOMBRE="María González"
export USUARIO_PASSWORD="<contraseña inicial, mínimo 8 caracteres>"
node scripts/crear-usuario-tenant.mjs
```

**Sale bien:** el script imprime que creó el usuario de Auth, la fila en
`usuarios`, y cierra con el nombre de usuario para loguearse.

> **Por qué no es el camino principal:** el script **no deja asiento en la
> auditoría**. El alta del administrador no figuraría en el registro de la
> clínica. Con el endpoint del paso 3.1 sí figura. Usá el script solo cuando el
> endpoint no esté disponible.

### 3.2 La primera entrada

Pasale al cliente:

- La dirección del front desplegado
- El **nombre de usuario**, no el email. El login de clínica es por nombre de
  usuario, aunque también acepta el email.
- La contraseña inicial, por un canal que no sea el mismo mail

**Sale bien:** entra y ve el panel de inicio de su clínica.

**Sale mal:**

- `401 Credenciales inválidas` — el nombre de usuario o la contraseña están mal.
  Pedile que **tipee** el usuario en vez de pegarlo, y probá otra combinación de
  mayúsculas: la comparación no distingue mayúsculas, pero un espacio pegado sí
  rompe.
- Al sexto intento fallido seguido contra la misma cuenta, la respuesta es un
  `429 RATE_LIMITED`. Es el límite de intentos y se libera solo. Esperá.
- Entra pero todas las pantallas dan error de módulo: mirá el paso 4.

### 3.3 Si el cliente pierde la contraseña

La recuperación por email desde la pantalla de login funciona si el envío de
mails del proyecto está configurado.

Si no, el reseteo lo hace el script: `crear-usuario-tenant.mjs` con el mismo
email y una contraseña nueva la resetea sin duplicar nada. **El endpoint del paso
3.1 no sirve para esto**: al ser idempotente devuelve el usuario que ya está y no
le toca la contraseña, que es justamente lo que se quiere de un alta pero no lo
que se necesita de un reseteo.

---

## 4. Verificar que la clínica quedó bien

Hacelo siempre, antes de darle el sistema al cliente. Con el token de plataforma:

```bash
curl -s -H "Authorization: Bearer $SA_TOKEN" \
  "https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants/$TENANT_ID"

curl -s -H "Authorization: Bearer $SA_TOKEN" \
  "https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants/$TENANT_ID/modulos"
```

Tiene que dar esto:

| Qué | Valor esperado |
| :--- | :--- |
| Roles de la clínica | 3: `admin`, `veterinario`, `recepcionista` |
| Permisos del rol admin | 22, o sea todos los del sistema |
| Configuración de la clínica | Existe, con cupo 10 y aviso 7 |
| Módulos contratados | 5 filas, habilitadas según el plan del paso 2.1 |
| Catálogo clínico | Especies, razas y tipos de vacuna sembrados |
| Estado | `activo: true` |

Por pantalla, la ficha de la clínica en `/admin/tenants/<id>` muestra los datos
comerciales y el panel de módulos.

**La señal de alarma:** si la clínica tiene **cero módulos contratados**, cero
permisos en el rol admin o ninguna configuración, es que se creó salteando
`on_tenant_created()`. No lo parchees insertando filas: dale de baja y volvé a
hacer el alta por el paso 2.

También verificalo desde adentro: entrá con el administrador del paso 3 y mirá
que el menú lateral muestre los módulos que corresponden al plan.

---

## 5. Ajustar los módulos

Si el plan no dio los módulos que querías, se corrigen de a uno.

**Por pantalla:** en `/admin/tenants/<id>` hay un panel de módulos con un
interruptor por módulo.

**Por comando:**

```bash
curl -s -X PUT \
  "https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants/$TENANT_ID/modulos/guarderia" \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"habilitado": true}'
```

Los identificadores válidos son `historial_clinico`, `turnos`, `guarderia`,
`stock` y `ventas`.

**Sale bien:** `200` con el estado nuevo del módulo. El cambio se ve en la
aplicación del cliente enseguida.

**Sale mal:** `422 MODULE_UNKNOWN` significa que escribiste mal el identificador
en la URL. Fijate que sean exactamente esos cinco, en minúsculas y con guion
bajo.

Cambiar el plan de la clínica con `PUT /admin/tenants/<id>` edita el dato
comercial pero **no re-aprovisiona los módulos**. Si cambiás el plan, ajustá los
módulos a mano acá.

---

## 6. Qué cargar antes de poder operar

En este orden. Cada paso depende del anterior. Todo esto lo hace el
administrador de la clínica desde la aplicación, ya logueado.

Los pasos 6.2 en adelante requieren el módulo de stock habilitado; el 6.6,
el de ventas.

### 6.1 Unidades de medida y medios de pago — no hay que cargar nada

Son catálogos globales del sistema y ya vienen sembrados por las migraciones. No
se cargan por clínica y no hay pantalla para tocarlos. Si en algún momento el
sistema se queja de que no hay unidades, el problema es que faltan migraciones,
no datos.

### 6.2 Familias de producto

Pantalla: **Stock → Familias** (`/stock/familias`).

Son las categorías con las que después vas a agrupar los productos. Cargá al
menos una antes de crear el primer producto.

**Sale bien:** las familias aparecen en el listado y en el selector de la
pantalla de productos.

### 6.3 Productos

Pantalla: **Stock → Productos** (`/stock/productos`).

Cada producto necesita su familia, su unidad de medida y si es vendible al
público o es de uso clínico interno.

### 6.4 Precios — sin esto el mostrador no vende

Pantalla: **Stock → Productos → Precios** (`/stock/productos/precios`), que es la
carga de precios en tanda.

**Este es el paso que más se olvida.** Un producto sin precio de venta no se
puede vender: el mostrador lo rechaza. Es una validación explícita del sistema,
no un descuido.

**Sale bien:** todos los productos vendibles tienen precio de venta cargado.

**Sale mal:** al intentar vender, el sistema rechaza el producto con
`PRODUCT_WITHOUT_PRICE`. Volvé a esta pantalla y completá el precio.

### 6.5 Proveedores

Pantalla: **Stock → Proveedores** (`/stock/proveedores`).

Necesitás al menos uno para poder registrar la primera compra.

### 6.6 Primera compra: es lo que crea el stock

Pantalla: **Stock → Compras** (`/stock/compras`).

Acá está el punto que sorprende: **cargar un producto no crea existencias.** El
stock nace de una compra confirmada, que es la que genera los lotes y los
movimientos. Mientras no confirmes una compra, todos los productos están en cero
y no se puede vender nada.

1. Creá la compra con su proveedor y sus renglones
2. **Confirmala.** Una compra en borrador no mueve stock.

**Sale bien:** después de confirmar, los productos aparecen con existencias en
`/stock/existencias` y sus lotes en `/stock/lotes`.

**Sale mal:** si las existencias siguen en cero, la compra quedó sin confirmar.

### 6.7 Apertura de caja

Pantalla: **Ventas → Caja** (`/ventas/caja`).

Abrí la sesión de caja con su monto inicial. **Sin caja abierta no se puede
registrar una venta.**

**Sale bien:** la sesión figura abierta y el mostrador (`/ventas/mostrador`)
deja registrar.

**Sale mal:** el mostrador rechaza la venta con `CASH_SESSION_REQUIRED`. Volvé
acá y abrí la sesión.

### 6.8 Lo demás, cuando haga falta

Servicios, doctores, horarios de atención, clientes y mascotas se cargan desde
sus propias pantallas y no bloquean nada de lo anterior. Los usuarios adicionales
de la clínica (veterinarios, recepcionistas) los crea el administrador desde
**Usuarios**, y **esos sí quedan auditados**, a diferencia del administrador
inicial del paso 3.

---

## 7. Dar de baja o suspender una clínica

**No existe borrado de clínica, y es a propósito.** Lo que hay es baja lógica:
la clínica queda suspendida, sus datos siguen ahí, y se puede reactivar.

**Por pantalla:** en `/admin/tenants/<id>` hay un diálogo de cambio de estado.

**Por comando:**

```bash
curl -s -X PATCH \
  "https://rvcbtcjsvhqchunribwl.supabase.co/functions/v1/api/v1/admin/tenants/$TENANT_ID/estado" \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"activo": false}'
```

**Sale bien:** `200` con `activo: false`. El efecto es inmediato: cualquier
usuario de esa clínica recibe un `403 TENANT_SUSPENDED` en toda la API. No es lo
mismo que un módulo no licenciado, y el front lo distingue.

Para reactivar, el mismo comando con `"activo": true`.

**Si de verdad hace falta eliminar los datos** — un pedido de borrado, una
clínica de prueba en producción — no hay camino por la aplicación y hay que
hacerlo por base de datos con mucho cuidado. No lo improvises: escribilo,
revisalo con alguien y hacé un backup antes.

---

## Huecos conocidos

Cosas que este runbook rodea porque hoy no funcionan.

### Cuentas huérfanas de altas anteriores

El flujo de invitación por mail **se sacó del sistema**: `TenantService.crear` ya
no llama a `inviteUserByEmail`, la ruta de reintento no existe más, y la columna
`tenants.admin_invitado` pasó a significar **la clínica ya tiene
administrador** — la pone en true el alta del administrador del paso 3.1. El
nombre de la columna quedó viejo y no se renombró: eso exigiría una migración
nueva sobre producción sin cambiar ningún comportamiento.

Lo que queda es el rastro: **cada alta hecha antes de este cambio dejó una cuenta
en Supabase Auth sin fila en `usuarios`**, creada por la invitación. No rompen
nada, pero no las ve ninguna herramienta que recorra tablas de negocio, y son
cuentas de correo reales de tus clientes.

Contalas antes de decidir qué hacer. Contra la base del entorno que quieras
revisar, en el SQL Editor del Dashboard:

```sql
SELECT au.email,
       au.invited_at,
       au.raw_user_meta_data->>'tenant_id' AS tenant_de_la_invitacion
FROM auth.users au
LEFT JOIN public.usuarios u ON u.id = au.id
WHERE u.id IS NULL
  AND COALESCE(au.raw_app_meta_data->>'platform_role', '') <> 'super_admin'
ORDER BY au.created_at;
```

En la base local de desarrollo hoy son **cero**, porque el último `db reset` la
reconstruyó. En producción hay que correr la consulta para saberlo.

Con la lista en la mano hay dos caminos limpios, y ninguno pasa por borrar filas
a mano:

1. **Adoptarlas.** Si la cuenta es del administrador que esa clínica iba a tener,
   corré el alta del paso 3.1 con **ese mismo email**. El endpoint detecta la
   cuenta huérfana, la adopta, le pone el `tenant_id` donde la API lo lee, le
   asigna la contraseña que elijas y le crea la fila en `usuarios`. Queda
   utilizable en vez de tirada.
2. **Borrarlas.** Si esa clínica ya tiene administrador por otro email, o la
   cuenta no corresponde a nadie, la baja va por la API de administración de
   Supabase Auth (`DELETE /auth/v1/admin/users/<id>` con la service-role key), no
   por SQL: así se lleva también las identidades asociadas.

Revisá la lista antes de borrar nada. Una de esas cuentas puede ser el email de
un cliente real.

### El módulo comercial no está en producción

Descrito en 0.2 y 0.4. Requiere `db push` de 33 migraciones y sacar `stock` y
`ventas` de la lista de bloqueados del script de deploy. Ninguna de las dos cosas
se hizo nunca contra producción.

### No hay procedimiento de backup

Descrito en 0.7.

