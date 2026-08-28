# Documento Maestro de Diseño de Sistema

## Sistema de Gestión Veterinaria "Leo" — Plataforma SaaS Modular

**Versión:** 1.0 **Tipo de documento:** Especificación funcional, arquitectura backend (API REST \+ MVC) y diseño UX/UI. **Stack objetivo:** React \+ Vite \+ Tailwind CSS v4 \+ Radix UI (frontend) · API REST \+ MVC sobre Supabase / PostgreSQL (backend). **Alcance:** Diseño funcional y técnico completo del sistema, módulo por módulo, incluyendo diagrama de clases UML y prompt de generación para Figma Make.

---

## Índice

0. **Preámbulo arquitectónico** — modelo de negocio SaaS, arquitectura REST+MVC, convenciones, reglas transversales.  
1. **Módulo Core Cliente-Mascota** — Registrar/Editar Cliente · Eliminar Cliente · Registrar/Editar Mascota · Cambiar Tutor · Marcar Fallecida.  
2. **Módulos Transversales**  
   - 2.1 Seguridad — Registrar/Editar Usuario · Autenticación · Recuperar Usuario/Contraseña.  
   - 2.2 Horarios de Atención — Gestionar Horarios de Profesional.  
   - 2.3 Auditoría — Consultar y Exportar Auditoría.  
3. **Módulo Historial Clínico** *(vendible)* — Consultar Historial · Registrar Evento Clínico · Exportar/Enviar.  
4. **Módulo Turnos** *(vendible)* — Agendar Turno · Modificar/Cancelar Turno · Gestionar Estado · Notificaciones.  
5. **Módulo Guardería** *(vendible)* — Registrar Estadía · Modificar/Cancelar Estadía · Check-in/Check-out.  
6. **Diagrama de Clases General (UML)** — Mermaid \+ relaciones \+ enumeraciones.  
7. **Prompt para Figma Make** — generación de pantallas (inglés).  
- **Anexo** — Trazabilidad con el prototipo existente.

---

## 0\. Preámbulo arquitectónico

### 0.1 Modelo de negocio (SaaS modular)

El sistema se comercializa como una **plataforma SaaS dividida en módulos vendibles de forma independiente**. La separación responde tanto a la facturación como a los límites de responsabilidad de cada dominio:

| Tipo | Módulo | Comercializable | Rol en la plataforma |
| :---- | :---- | :---- | :---- |
| **Núcleo** | Core Cliente-Mascota | No (incluido) | Nexo común. Sin él ningún módulo vendible funciona. |
| **Transversal** | Seguridad | No (incluido) | Identidad, roles, permisos y sesión. |
| **Transversal** | Horarios de Atención | No (incluido) | Disponibilidad de profesionales; alimenta Turnos. |
| **Transversal** | Auditoría | No (incluido) | Trazabilidad cross-cutting de todas las acciones. |
| **Vendible** | Historial Clínico | Sí | Registro clínico longitudinal de la mascota. |
| **Vendible** | Turnos | Sí | Agenda de clínica y peluquería. |
| **Vendible** | Guardería | Sí | Estadías por rango de fechas. |

**Regla de dependencia (RN-G1):** los tres módulos vendibles dependen del Core Cliente-Mascota y de los transversales Seguridad y Auditoría. Horarios de Atención es requisito *sólo* del módulo Turnos.

**Aprovisionamiento por tenant (RN-G2):** la disponibilidad de cada módulo vendible se resuelve por configuración de la suscripción del tenant. La UI oculta (no sólo deshabilita) los módulos no contratados, y el backend rechaza con `403 MODULE_NOT_LICENSED` cualquier endpoint de un módulo no contratado.

### 0.2 Arquitectura backend: API REST \+ MVC

El backend combina **API REST** con el patrón **MVC** reinterpretado para servicios sin vistas HTML:

- **Controller (Controlador):** orquesta la petición HTTP REST. Valida forma del request, resuelve autenticación/autorización, delega en el Servicio y serializa la respuesta. *No contiene reglas de negocio.*  
- **Model / Service (Modelo / Servicio):** ejecuta las reglas de negocio, valida invariantes de dominio e interactúa con la base de datos (Supabase/PostgreSQL). Es la única capa que toca la persistencia.  
- **View (Vista):** es el **payload JSON** retornado al frontend (DTO de respuesta). No hay plantillas; la "vista" es la representación serializada del recurso.

Cliente (React)  ──HTTP──▶  Controller  ──▶  Service  ──▶  Repositorio/Supabase

       ▲                        │              │                  │

       └────── JSON (View/DTO) ─┘◀─────────────┘◀── filas/entidades┘

### 0.3 Convenciones REST transversales

| Aspecto | Convención |
| :---- | :---- |
| Prefijo base | `/api/v1` |
| Estilo de recursos | Sustantivos en plural: `/clientes`, `/mascotas`, `/turnos`… |
| Verbos | `GET` (leer), `POST` (crear), `PUT`/`PATCH` (modificar), `DELETE` (baja) |
| Autenticación | `Authorization: Bearer <JWT>` en todo endpoint salvo login/recuperación |
| Autorización | Por permiso heredado del rol (ver Módulo Seguridad) |
| Idempotencia | `PUT` reemplaza, `PATCH` aplica cambios parciales |
| Paginación | `?page=1&pageSize=20`; respuesta `PaginatedResponse<T>` |
| Filtrado/búsqueda | Query params específicos por recurso (`?search=`, `?status=`, `?dateFrom=`) |
| Códigos | `200/201` éxito · `400` validación · `401` no autenticado · `403` sin permiso/módulo · `404` no encontrado · `409` conflicto de negocio · `422` regla de dominio |

**Sobre semántica (Vista/DTO) estándar:** toda respuesta se envuelve en `ApiResponse<T>`:

{ "success": true, "data": { }, "error": null, "message": "Operación exitosa" }

{ "success": false, "data": null, "error": "VALIDATION\_ERROR", "message": "El DNI/CUIT ya existe" }

`PaginatedResponse<T>` para listados:

{ "data": \[\], "total": 128, "page": 1, "pageSize": 20, "totalPages": 7 }

### 0.4 Reglas transversales de UX/UI

- **Sistema visual:** dashboard moderno, color primario naranja (`#f97316`), tarjetas con cabecera en degradado `from-orange-50 to-white`, tablas de datos interactivas, badges de estado por color, modales de confirmación (Radix `AlertDialog`) para toda acción destructiva.  
- **Mínimos clics (RN-UX1):** ninguna acción frecuente (agendar, registrar evento, alta de cliente) debe requerir más de 3 interacciones desde el dashboard. Los selects encadenados precargan el contexto (al elegir cliente se filtran sus mascotas).  
- **Feedback inmediato (RN-UX2):** toda operación dispara un *toast* (`sonner`) de éxito/error; las validaciones se muestran inline bajo el campo.  
- **Accesibilidad APA (RN-UX3):** panel global de preferencias (tamaño de fuente, densidad de tablas, alto contraste, reducción de movimiento) persistido por usuario.  
- **Auditoría implícita (RN-UX4):** toda operación de escritura registra automáticamente un evento de auditoría sin intervención del usuario.

### 0.5 Reglas de seguridad transversales

- **RN-S1:** las contraseñas se almacenan como `password_hash` (bcrypt/argon2). El backend nunca devuelve el hash ni la contraseña en ningún DTO.  
- **RN-S2:** todo endpoint valida el JWT y luego el permiso requerido antes de ejecutar lógica.  
- **RN-S3:** las acciones de escritura quedan registradas en Auditoría con usuario, módulo, acción, entidad, valores previos/nuevos y marca temporal.

---

# 1\. Módulo Core Cliente-Mascota

**Rol en el SaaS:** es el nexo que une los tres módulos vendibles. Modela a los **clientes** (propietarios), sus **mascotas**, la taxonomía **Especie → Raza**, los **cambios de propiedad** y el estado de **fallecimiento**. Ningún turno, historial o estadía puede existir sin una mascota y un cliente vigentes en este módulo.

---

## Caso de Uso: Registrar / Editar Cliente

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Permitir dar de alta un cliente con: nombre completo, DNI/CUIT, teléfono, dirección, email (opcional) y observaciones (opcional).  
- Permitir editar todos los campos de un cliente existente.  
- Listar y buscar clientes por nombre, DNI/CUIT o teléfono.  
- Exportar el listado filtrado a Excel y PDF.

**No Funcionales (reglas de negocio, validaciones, UX y rendimiento)**

- **RN-CL1 (obligatorios):** nombre completo, DNI/CUIT, teléfono y dirección son obligatorios; email y observaciones opcionales.  
- **RN-CL2 (formato DNI/CUIT):** sólo dígitos y guiones (`/^[\d\-]+$/`).  
- **RN-CL3 (unicidad):** el DNI/CUIT debe ser único entre clientes no eliminados; el backend responde `409 DUPLICATE_DNI` si se repite.  
- **RN-CL4 (formato teléfono):** sólo números, `+`, `-` y espacios.  
- **RN-CL5 (formato email):** si se informa, debe cumplir patrón de correo válido.  
- **RN-CL6 (validación dual):** la validación se aplica en frontend (inline, en tiempo real) y se reverifica en backend (fuente de verdad).  
- **RN-CL7 (auditoría):** el alta registra acción `CREATE` y la edición `UPDATE` en módulo `clients`.  
- **UX:** formulario de dos columnas; errores inline bajo cada campo; botón *Guardar/Actualizar* primario naranja; búsqueda con *debounce*.  
- **Rendimiento:** el listado se sirve paginado (20 por página) y la búsqueda usa índices sobre `full_name`, `dni_cuit`, `phone`.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador / Veterinario (permiso `manage_clients`).  
- **Actor secundario:** Módulo de Auditoría.  
- **Disparador:** el actor abre "Gestión de Clientes" y pulsa *Nuevo Cliente* o *Editar* sobre una fila.  
- **Precondiciones:** sesión iniciada; permiso `manage_clients`.

**Flujo normal (alta)**

1. El actor abre el módulo Clientes; el sistema muestra el formulario y la tabla de clientes.  
2. Completa los campos obligatorios; el sistema valida formato en tiempo real.  
3. Pulsa *Guardar*.  
4. El sistema reverifica en backend (formato \+ unicidad de DNI/CUIT).  
5. Persiste el cliente, registra auditoría y muestra *toast* de éxito.  
6. La tabla se actualiza incluyendo el nuevo registro.

**Flujos alternativos y excepciones**

- **2a.** Campo inválido → mensaje inline; el botón *Guardar* permanece operativo pero la operación se bloquea hasta corregir.  
- **4a.** DNI/CUIT duplicado → `409`; *toast* de error y foco en el campo.  
- **Edición:** el actor pulsa *Editar*, el formulario se precarga; al guardar se ejecuta `UPDATE` (la unicidad excluye el propio registro).

### C. Métodos y Gestores Propuestos (REST \+ MVC)

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Listar/buscar | `GET /api/v1/clientes?search=&page=&pageSize=` |
| Detalle | `GET /api/v1/clientes/{id}` |
| Crear | `POST /api/v1/clientes` |
| Editar | `PUT /api/v1/clientes/{id}` |

- **Controlador:** `ClienteController` → `listar()`, `obtener()`, `crear()`, `actualizar()`.  
- **Servicio:** `ClienteService` → `buscarPaginado(filtros)`, `obtenerPorId(id)`, `crearCliente(dto)` *(valida RN-CL2..CL5 \+ unicidad RN-CL3)*, `actualizarCliente(id, dto)`, `registrarAuditoria(...)`.

**Vista / DTO — body de creación**

{ "fullName": "María García", "dniCuit": "20-12345678-9", "phone": "+54 11 4567-8900", "address": "Av. Libertador 1234", "email": "maria@mail.com", "observations": "Cliente preferencial" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "fullName": "María García", "dniCuit": "20-12345678-9", "phone": "+54 11 4567-8900", "address": "Av. Libertador 1234", "email": "maria@mail.com", "observations": "Cliente preferencial", "createdAt": "2026-06-04T12:00:00Z", "createdBy": "uuid" }, "message": "Cliente registrado" }

---

## Caso de Uso: Eliminar Cliente

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Permitir eliminar (baja lógica) un cliente desde el formulario de edición.

**No Funcionales**

- **RN-CL8 (integridad referencial):** **no** se puede eliminar un cliente que posea al menos una mascota viva (no fallecida y no eliminada) asociada. El botón *Eliminar* se deshabilita con *tooltip* explicativo en la UI y el backend rechaza con `409 CLIENT_HAS_PETS`.  
- **RN-CL9 (baja lógica):** la eliminación marca `deleted=true`, `deletedAt`, `deletedBy`; no borra físicamente para preservar historial.  
- **RN-CL10 (confirmación):** la acción requiere modal de confirmación (Radix `AlertDialog`).  
- **RN-CL11 (auditoría):** registra acción `DELETE` en módulo `clients`.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador (permiso `manage_clients`).  
- **Disparador:** el actor pulsa *Eliminar cliente* en el formulario de edición.  
- **Precondiciones:** cliente seleccionado; sin mascotas vivas asociadas.

**Flujo normal**

1. El actor selecciona un cliente y pulsa *Eliminar*.  
2. El sistema verifica que no tenga mascotas vivas.  
3. Muestra modal de confirmación con el nombre del cliente.  
4. El actor confirma.  
5. El sistema aplica baja lógica, registra auditoría y muestra *toast*.

**Flujos alternativos y excepciones**

- **2a.** Tiene mascotas vivas → botón deshabilitado \+ *tooltip*; si llega al backend, `409 CLIENT_HAS_PETS`.  
- **4a.** El actor cancela → no se realiza ninguna acción.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Baja lógica | `DELETE /api/v1/clientes/{id}` |

- **Controlador:** `ClienteController.eliminar()`.  
- **Servicio:** `ClienteService.eliminarCliente(id, usuarioId)` → invoca `tieneMascotasVivas(id)` (RN-CL8) y, si procede, aplica baja lógica \+ auditoría.

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "deleted": true }, "message": "Cliente eliminado" }

**Error**

{ "success": false, "error": "CLIENT\_HAS\_PETS", "message": "No puede eliminar un cliente con mascotas vivas asociadas" }

---

## Caso de Uso: Registrar / Editar Mascota

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Dar de alta una mascota con: nombre, cliente asociado, especie, raza (opcional), sexo, fecha de nacimiento y color/observaciones.  
- Calcular y mostrar la **edad** automáticamente a partir de la fecha de nacimiento.  
- Editar la mascota; listar y buscar por nombre, especie, raza o tutor.  
- Filtros avanzados por especie, estado (activa/fallecida) y rango etario.  
- Exportar a Excel y PDF.

**No Funcionales**

- **RN-MA1 (obligatorios):** nombre, cliente, especie y sexo son obligatorios; raza, fecha de nacimiento y observaciones opcionales.  
- **RN-MA2 (taxonomía):** la raza debe pertenecer a la especie seleccionada; el select de raza se deshabilita hasta elegir especie.  
- **RN-MA3 (peso fuera de Mascota):** el **peso NO es un atributo de Mascota**; se registra por consulta en el Historial Clínico (seguimiento evolutivo). La ficha muestra el último peso conocido como dato derivado, no editable aquí.  
- **RN-MA4 (fecha de nacimiento inmutable):** una vez creada, la fecha de nacimiento no es editable (consistencia del historial etario).  
- **RN-MA5 (edad derivada):** la edad se calcula en tiempo real (años/meses) y no se persiste.  
- **RN-MA6 (baja lógica):** eliminar marca `deleted=true`.  
- **RN-MA7 (auditoría):** `CREATE`/`UPDATE` en módulo `pets`.  
- **UX:** selects encadenados Cliente→Mascota y Especie→Raza; aviso informativo de que el peso vive en el Historial Clínico.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Veterinario / Administrador (permiso `manage_pets`).  
- **Disparador:** *Nueva Mascota* o *Editar* en el módulo Mascotas.  
- **Precondiciones:** existe al menos un cliente; permiso `manage_pets`.

**Flujo normal (alta)**

1. El actor abre Mascotas y completa nombre y cliente.  
2. Selecciona especie; el sistema habilita y filtra las razas de esa especie.  
3. Selecciona sexo y, opcionalmente, fecha de nacimiento → el sistema muestra la edad calculada.  
4. Pulsa *Guardar*.  
5. El backend valida obligatorios y coherencia raza/especie, persiste, audita y muestra *toast*.

**Flujos alternativos y excepciones**

- **2a.** Sin especie seleccionada → el select de raza permanece deshabilitado.  
- **4a.** Faltan obligatorios → error inline; operación bloqueada.  
- **Edición:** la fecha de nacimiento aparece bloqueada (RN-MA4).

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Listar/buscar/filtrar | `GET /api/v1/mascotas?search=&especieId=&estado=&edad=&page=` |
| Detalle (con último peso) | `GET /api/v1/mascotas/{id}` |
| Crear | `POST /api/v1/mascotas` |
| Editar | `PUT /api/v1/mascotas/{id}` |
| Baja lógica | `DELETE /api/v1/mascotas/{id}` |
| Taxonomía especies | `GET /api/v1/especies` |
| Razas por especie | `GET /api/v1/especies/{id}/razas` |

- **Controlador:** `MascotaController` → `listar()`, `obtener()`, `crear()`, `actualizar()`, `eliminar()`; `EspecieController` → `listarEspecies()`, `listarRazas()`.  
- **Servicio:** `MascotaService` → `buscarPaginado(filtros)`, `obtenerPorId(id)` *(adjunta `ultimoPeso` consultando HistorialClinico)*, `crearMascota(dto)` *(valida RN-MA1, RN-MA2)*, `actualizarMascota(id, dto)` *(impide cambio de birthDate, RN-MA4)*, `eliminarMascota(id)`.

**Vista / DTO — body de creación**

{ "name": "Max", "clientId": "uuid", "speciesId": "sp\_perro", "breedId": "br\_lab", "sex": "Macho", "birthDate": "2020-05-15", "color": "Dorado", "observations": "Muy activo" }

**Vista / DTO — respuesta (detalle)**

{ "success": true, "data": { "id": "uuid", "name": "Max", "clientId": "uuid", "clientName": "María García", "speciesId": "sp\_perro", "speciesName": "Perro", "breedId": "br\_lab", "breedName": "Labrador", "sex": "Macho", "birthDate": "2020-05-15", "ageText": "6 años", "lastWeightKg": 30, "deceased": false } }

---

## Caso de Uso: Cambiar Tutor de Mascota

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Transferir una mascota de su cliente actual a otro cliente, con motivo y observaciones opcionales.  
- Registrar cada transferencia en un **historial de cambios de propiedad** consultable.

**No Funcionales**

- **RN-CD1 (cliente distinto):** el nuevo tutor debe ser diferente del actual; en caso contrario `422 SAME_OWNER`.  
- **RN-CD2 (trazabilidad):** cada cambio crea un registro `CambioPropietario` con tutor anterior, tutor nuevo, fecha, motivo, notas y usuario responsable.  
- **RN-CD3 (preservación clínica):** los registros del Historial Clínico ya creados conservan el "tutor vigente al momento" (`clientNameAtTime`); el cambio de tutor **no reescribe** la propiedad histórica.  
- **RN-CD4 (mascota activa):** sólo se puede transferir una mascota no fallecida y no eliminada.  
- **RN-CD5 (auditoría):** registra `UPDATE` en módulo `pets` con detalle del cambio.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador (permiso `manage_pets`).  
- **Disparador:** el actor pulsa el ícono *Cambiar tutor* en una fila de mascota.  
- **Precondiciones:** mascota activa; existe al menos otro cliente.

**Flujo normal**

1. El actor abre el diálogo "Cambiar Tutor"; el sistema muestra el tutor actual.  
2. Selecciona el nuevo tutor y, opcionalmente, motivo/notas.  
3. Confirma.  
4. El backend valida que sea distinto (RN-CD1), actualiza `clientId`, anexa el `CambioPropietario` y audita.  
5. *Toast* de éxito; la tabla refleja el nuevo tutor y un ícono de historial.

**Flujos alternativos y excepciones**

- **2a.** Selecciona el mismo tutor → `422 SAME_OWNER`.  
- **Consulta de historial:** el actor pulsa el ícono de historial y ve la línea de tiempo de transferencias.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Transferir | `POST /api/v1/mascotas/{id}/cambio-dueno` |
| Historial de cambios | `GET /api/v1/mascotas/{id}/cambios-dueno` |

- **Controlador:** `MascotaController` → `cambiarDueno()`, `listarCambiosDueno()`.  
- **Servicio:** `MascotaService.cambiarDueno(id, dto)` → valida RN-CD1/RN-CD4, persiste cambio de `clientId`, inserta `CambioPropietario`, audita.

**Vista / DTO — body**

{ "newClientId": "uuid", "reason": "Adopción", "notes": "Transferencia acordada por escrito" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "petId": "uuid", "previousClientName": "Carlos Fernández", "newClientName": "Ana Martínez", "changeDate": "2026-06-04T12:00:00Z" }, "message": "Tutor actualizado" }

---

## Caso de Uso: Marcar Mascota como Fallecida

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Registrar el fallecimiento de una mascota con fecha, motivo (obligatorio) y observaciones.  
- Bloquear el historial clínico de una mascota fallecida (sólo lectura).

**No Funcionales**

- **RN-MF1 (motivo obligatorio):** no se confirma el fallecimiento sin un motivo.  
- **RN-MF2 (bloqueo clínico):** una mascota fallecida no admite nuevos registros ni edición de historial; el backend rechaza altas clínicas con `422 PET_DECEASED`.  
- **RN-MF3 (irreversible en UI):** la acción es de alto impacto; requiere confirmación con advertencia explícita.  
- **RN-MF4 (visibilidad):** la mascota se marca visualmente (badge "Fallecida", ícono) y deja de aparecer como elegible para nuevos turnos/estadías.  
- **RN-MF5 (auditoría):** `UPDATE` en módulo `pets` con marca de fallecimiento.

### B. Ficha de Caso de Uso

- **Actor principal:** Veterinario / Administrador (permiso `manage_pets` o `manage_medical_history`).  
- **Disparador:** *Marcar Fallecida* desde la ficha de mascota o el Historial Clínico.  
- **Precondiciones:** mascota activa.

**Flujo normal**

1. El actor abre el diálogo de fallecimiento.  
2. Confirma fecha (por defecto hoy), ingresa motivo y observaciones.  
3. Confirma la acción tras leer la advertencia.  
4. El backend marca `deceased=true` con fecha/motivo, bloquea el historial y audita.  
5. *Toast* de éxito; la mascota queda en estado fallecida.

**Flujos alternativos y excepciones**

- **2a.** Motivo vacío → botón *Confirmar* deshabilitado (RN-MF1).  
- **Intento posterior de alta clínica:** `422 PET_DECEASED`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Marcar fallecida | `POST /api/v1/mascotas/{id}/fallecimiento` |

- **Controlador:** `MascotaController.marcarFallecida()`.  
- **Servicio:** `MascotaService.marcarFallecida(id, dto)` → valida RN-MF1, persiste estado de fallecimiento, audita. El bloqueo RN-MF2 se aplica en `HistorialClinicoService` al crear registros.

**Vista / DTO — body**

{ "deceasedDate": "2026-06-04", "deceasedReason": "Insuficiencia renal", "deceasedNotes": "Tratamiento paliativo previo" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "deceased": true, "deceasedDate": "2026-06-04" }, "message": "Mascota marcada como fallecida" }

---

# 2\. Módulos Transversales

Conjunto de módulos incluidos en toda suscripción que dan soporte a los módulos vendibles: **Seguridad** (identidad y autorización), **Horarios de Atención** (disponibilidad) y **Auditoría** (trazabilidad).

---

## 2.1 Submódulo: Seguridad

**Rol en el SaaS:** administra usuarios, **roles y permisos jerárquicos**, sesión y recuperación de credenciales. Es prerequisito de todos los módulos.

**Decisión de arquitectura (RN-SEC0 — Roles y permisos jerárquicos):** los usuarios **no** poseen permisos individuales. Se modela `Rol`, `Permiso` y la tabla intermedia `RolPermiso` (N:M). Al crear un usuario se selecciona **únicamente un rol**, y los permisos se **heredan** del rol. Esto reemplaza el esquema previo de permisos por usuario.

### Caso de Uso: Registrar / Editar Usuario

#### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Crear y editar usuarios con: usuario, contraseña, nombre completo, email, teléfono (opcional), rol y estado (activo/inactivo).  
- Mostrar de forma informativa los permisos que otorga el rol seleccionado.  
- Al crear un usuario con rol que atiende (veterinario/peluquero), generar automáticamente su **perfil de Profesional** (para Turnos y Horarios).

**No Funcionales**

- **RN-SEC1 (obligatorios):** usuario, contraseña, nombre completo, email y rol son obligatorios.  
- **RN-SEC2 (herencia de permisos):** al guardar, el sistema asigna el conjunto de permisos del rol (vía `RolPermiso`); los permisos no se editan individualmente.  
- **RN-SEC3 (hash de contraseña):** la contraseña se persiste como `password_hash`; nunca se devuelve (RN-S1).  
- **RN-SEC4 (unicidad):** `username` y `email` únicos; conflicto → `409 DUPLICATE_USER`.  
- **RN-SEC5 (perfil profesional automático):** si `rol ∈ {veterinario, peluquero}` y es alta, se crea un `Doctor` enlazado (`userId`) con especialidad por defecto y disponibilidad activa.  
- **RN-SEC6 (autoprotección):** un administrador no puede desactivarse ni quitarse el rol a sí mismo si es el último administrador activo → `409 LAST_ADMIN`.  
- **RN-SEC7 (auditoría):** `CREATE`/`UPDATE` en módulo `users`.  
- **UX:** toggle mostrar/ocultar contraseña; panel informativo de permisos del rol; aviso de configuración de horarios para roles que atienden.

#### B. Ficha de Caso de Uso

- **Actor principal:** Administrador (permiso `manage_users`).  
- **Actor secundario:** Submódulo Horarios (recibe el nuevo profesional), Auditoría.  
- **Disparador:** *Nuevo Usuario* o *Editar* en el Módulo de Seguridad.  
- **Precondiciones:** sesión de administrador.

**Flujo normal (alta)**

1. El administrador completa datos y selecciona un rol; el sistema muestra los permisos heredados.  
2. Pulsa *Crear Usuario*.  
3. El backend valida obligatorios y unicidad, hashea la contraseña, asigna permisos del rol y persiste.  
4. Si el rol atiende, crea el perfil `Doctor` (RN-SEC5).  
5. Audita y muestra *toast* (indicando si se generó perfil profesional).

**Flujos alternativos y excepciones**

- **2a.** Usuario/email duplicado → `409 DUPLICATE_USER`.  
- **Edición de sí mismo:** intento de auto-desactivación del último admin → `409 LAST_ADMIN`.

#### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Listar usuarios | `GET /api/v1/usuarios?page=` |
| Crear | `POST /api/v1/usuarios` |
| Editar | `PUT /api/v1/usuarios/{id}` |
| Catálogo de roles | `GET /api/v1/roles` |
| Permisos de un rol | `GET /api/v1/roles/{id}/permisos` |

- **Controlador:** `UsuarioController` → `listar()`, `crear()`, `actualizar()`; `RolController` → `listar()`, `permisosDeRol()`.  
- **Servicio:** `UsuarioService` → `crearUsuario(dto)` *(RN-SEC1..SEC5)*, `actualizarUsuario(id, dto)` *(RN-SEC6)*, `hashPassword(raw)`, `asignarPermisosDeRol(usuario, rol)`; `DoctorService.crearDesdeUsuario(usuario)`.

**Vista / DTO — body de creación**

{ "username": "mfernandez", "password": "••••••", "fullName": "Dra. María Fernández", "email": "maria@vet.com", "phone": "+54 11 2345-6789", "roleId": "rol\_veterinario", "active": true }

**Vista / DTO — respuesta (sin hash)**

{ "success": true, "data": { "id": "uuid", "username": "mfernandez", "fullName": "Dra. María Fernández", "email": "maria@vet.com", "roleId": "rol\_veterinario", "roleName": "Veterinario", "permissions": \["manage\_clients","manage\_pets","view\_medical\_history","manage\_medical\_history","view\_appointments","manage\_appointments"\], "active": true, "doctorProfileId": "uuid" }, "message": "Usuario creado y perfil profesional generado" }

---

### Caso de Uso: Autenticación (Iniciar / Cerrar Sesión)

#### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Autenticar por usuario y contraseña, devolviendo un token de sesión (JWT) y el perfil con permisos.  
- Cerrar sesión invalidando la sesión del cliente.

**No Funcionales**

- **RN-AUT1 (credenciales válidas):** sólo usuarios `active=true` con credenciales correctas pueden ingresar; en error, mensaje genérico ("Credenciales inválidas") sin revelar si falló usuario o contraseña.  
- **RN-AUT2 (token):** el login emite un JWT firmado con expiración; el frontend lo adjunta en `Authorization`.  
- **RN-AUT3 (permisos en sesión):** la respuesta incluye rol y permisos heredados para que el frontend muestre/oculte módulos.  
- **RN-AUT4 (auditoría):** `LOGIN`/`LOGOUT` en módulo `security` con usuario y marca temporal.  
- **RN-AUT5 (rate limiting):** se limita el número de intentos fallidos por usuario/IP para mitigar fuerza bruta.

#### B. Ficha de Caso de Uso

- **Actor principal:** cualquier usuario del sistema.  
- **Disparador:** envío del formulario de login / pulsar *Cerrar Sesión*.  
- **Precondiciones:** usuario existente y activo.

**Flujo normal**

1. El usuario ingresa credenciales y envía.  
2. El backend verifica hash y estado activo.  
3. Emite JWT y devuelve perfil \+ permisos.  
4. Audita `LOGIN`; el frontend guarda el token y renderiza según permisos.  
5. Al cerrar sesión, el frontend descarta el token y el backend audita `LOGOUT`.

**Flujos alternativos y excepciones**

- **2a.** Credenciales incorrectas o usuario inactivo → `401`, mensaje genérico (RN-AUT1).  
- **2b.** Exceso de intentos → `429 TOO_MANY_ATTEMPTS` (RN-AUT5).

#### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Login | `POST /api/v1/auth/login` |
| Logout | `POST /api/v1/auth/logout` |
| Sesión actual | `GET /api/v1/auth/me` |

- **Controlador:** `AuthController` → `login()`, `logout()`, `me()`.  
- **Servicio:** `AuthService` → `autenticar(username, password)` *(RN-AUT1)*, `emitirToken(usuario)`, `cerrarSesion(usuario)`, `perfilActual(token)`.

**Vista / DTO — body de login**

{ "username": "admin", "password": "••••••" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "token": "eyJhbGci...", "user": { "id": "uuid", "username": "admin", "fullName": "Administrador Principal", "roleName": "Administrador", "permissions": \["..."\] } }, "message": "Sesión iniciada" }

---

### Caso de Uso: Recuperar Usuario / Contraseña

#### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Permitir recuperar el nombre de usuario a partir del email registrado.  
- Permitir iniciar el restablecimiento de contraseña enviando instrucciones al email.

**No Funcionales**

- **RN-REC1 (email válido):** se valida el formato del email antes de procesar.  
- **RN-REC2 (no enumeración):** por seguridad, la respuesta es genérica aun si el email no existe ("si la cuenta existe, recibirá un correo"), evitando revelar cuentas válidas.  
- **RN-REC3 (token de restablecimiento):** el reset genera `passwordResetToken` con expiración corta; nunca se envía la contraseña en claro.  
- **RN-REC4 (auditoría):** registra la solicitud de recuperación en módulo `security`.

#### B. Ficha de Caso de Uso

- **Actor principal:** usuario que olvidó sus credenciales.  
- **Disparador:** enlaces "¿Olvidaste tu usuario/contraseña?" en el login.  
- **Precondiciones:** ninguna (acceso público).

**Flujo normal (contraseña)**

1. El usuario ingresa su email registrado.  
2. El backend valida formato y busca la cuenta.  
3. Si existe, genera token de reset con expiración y envía instrucciones por email.  
4. Responde con mensaje genérico (RN-REC2) y audita la solicitud.

**Flujos alternativos y excepciones**

- **2a.** Formato inválido → error inline.  
- **2b.** Email inexistente → misma respuesta genérica (sin filtrar existencia).

#### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Recuperar usuario | `POST /api/v1/auth/recuperar-usuario` |
| Solicitar reset de contraseña | `POST /api/v1/auth/recuperar-password` |
| Confirmar nueva contraseña | `POST /api/v1/auth/reset-password` |

- **Controlador:** `AuthController` → `recuperarUsuario()`, `solicitarReset()`, `confirmarReset()`.  
- **Servicio:** `AuthService` → `recuperarUsuarioPorEmail(email)`, `generarTokenReset(email)` *(RN-REC3)*, `confirmarReset(token, nuevaPassword)`.

**Vista / DTO — body**

{ "email": "usuario@mail.com" }

**Vista / DTO — respuesta (genérica)**

{ "success": true, "message": "Si la cuenta existe, enviaremos las instrucciones al correo indicado" }

---

## 2.2 Submódulo: Horarios de Atención

**Rol en el SaaS:** define las **franjas horarias disponibles** de cada profesional por día de la semana. Es la fuente de verdad de los *slots* que el módulo Turnos ofrece para agendar.

### Caso de Uso: Gestionar Horarios de Profesional

#### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Seleccionar un profesional y agregar franjas (día de la semana, hora inicio, hora fin).  
- Activar/desactivar y eliminar franjas.  
- Ver la grilla de franjas por día y un resumen de disponibilidad de todos los profesionales.

**No Funcionales**

- **RN-HOR1 (rango válido):** la hora de inicio debe ser anterior a la hora de fin → en caso contrario `422 INVALID_RANGE`.  
- **RN-HOR2 (sin solapamiento):** no se permite una franja activa que se superponga con otra del mismo profesional y día → `409 SCHEDULE_OVERLAP`.  
- **RN-HOR3 (generación de slots):** los turnos disponibles se derivan dividiendo cada franja activa en intervalos (p. ej. 30 min); una franja inactiva no genera slots.  
- **RN-HOR4 (sólo profesionales):** sólo usuarios con perfil `Doctor` (veterinario/peluquero) tienen horarios.  
- **RN-HOR5 (acceso):** gestión restringida a Administrador.  
- **RN-HOR6 (auditoría):** `CREATE`/`UPDATE`/`DELETE` en módulo `security`/`system`.

#### B. Ficha de Caso de Uso

- **Actor principal:** Administrador (`manage_users`/admin).  
- **Actor secundario:** Módulo Turnos (consume las franjas).  
- **Disparador:** seleccionar un profesional y *Agregar Franja Horaria*.  
- **Precondiciones:** existe al menos un profesional.

**Flujo normal**

1. El admin selecciona un profesional.  
2. Elige día, hora inicio y hora fin; pulsa *Agregar*.  
3. El backend valida rango (RN-HOR1) y solapamiento (RN-HOR2).  
4. Persiste la franja, audita y la muestra en la grilla del día.  
5. Puede activar/desactivar o eliminar franjas existentes.

**Flujos alternativos y excepciones**

- **3a.** Inicio ≥ fin → `422 INVALID_RANGE`.  
- **3b.** Solapamiento con franja activa → `409 SCHEDULE_OVERLAP`.

#### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Franjas de un profesional | `GET /api/v1/doctores/{id}/horarios` |
| Crear franja | `POST /api/v1/doctores/{id}/horarios` |
| Activar/Desactivar | `PATCH /api/v1/horarios/{horarioId}` |
| Eliminar | `DELETE /api/v1/horarios/{horarioId}` |
| Resumen global | `GET /api/v1/doctores/horarios/resumen` |

- **Controlador:** `HorarioController` → `listarPorDoctor()`, `crear()`, `alternarActivo()`, `eliminar()`, `resumen()`.  
- **Servicio:** `HorarioService` → `crearFranja(doctorId, dto)` *(RN-HOR1, RN-HOR2)*, `alternarActivo(id)`, `eliminar(id)`, `slotsDisponibles(doctorId, fecha, duracion)` *(RN-HOR3, usada por Turnos)*.

**Vista / DTO — body**

{ "dayOfWeek": 1, "startTime": "09:00", "endTime": "13:00", "active": true }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "doctorId": "uuid", "dayOfWeek": 1, "startTime": "09:00", "endTime": "13:00", "active": true } }

---

## 2.3 Submódulo: Auditoría

**Rol en el SaaS:** registra de forma **cross-cutting** toda acción relevante del sistema y permite consultarla y exportarla. No es un módulo de captura manual: los eventos se generan automáticamente desde los demás servicios.

### Caso de Uso: Consultar y Exportar Auditoría

#### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Consultar el registro de auditoría con filtros por texto, módulo, acción, usuario y rango de fechas.  
- Exportar el resultado filtrado a CSV.

**No Funcionales**

- **RN-AUD1 (registro automático):** cada operación de escritura de los demás servicios invoca el registro de auditoría con: usuario, rol, acción, módulo, entidad, valores previos/nuevos (JSON), IP y marca temporal. *No existe un apartado de registro manual.*  
- **RN-AUD2 (inmutabilidad):** los registros de auditoría son de sólo lectura; no se editan ni eliminan desde la aplicación.  
- **RN-AUD3 (acceso restringido):** sólo Administrador (`view_audit`) puede consultar/exportar.  
- **RN-AUD4 (retención):** se conserva al menos el histórico definido por política (p. ej. últimos N registros / X meses) con índices por fecha, módulo y usuario.  
- **RN-AUD5 (rendimiento):** consultas paginadas e indexadas; los filtros se aplican en backend.

#### B. Ficha de Caso de Uso

- **Actor principal:** Administrador (`view_audit`).  
- **Disparador:** abrir "Auditoría del Sistema" o pulsar *Exportar CSV*.  
- **Precondiciones:** sesión de administrador.

**Flujo normal**

1. El admin abre Auditoría; el sistema lista los registros recientes paginados.  
2. Aplica filtros (texto, módulo, acción, usuario, fechas).  
3. El backend devuelve el subconjunto filtrado.  
4. El admin pulsa *Exportar CSV* y descarga el resultado.

**Flujos alternativos y excepciones**

- **3a.** Sin coincidencias → tabla vacía con mensaje informativo.  
- **Acceso indebido:** usuario sin `view_audit` → `403`.

#### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Consultar/filtrar | `GET /api/v1/auditoria?search=&module=&action=&userId=&dateFrom=&dateTo=&page=` |
| Exportar | `GET /api/v1/auditoria/export?format=csv&...` |

- **Controlador:** `AuditoriaController` → `listar()`, `exportar()`.  
- **Servicio:** `AuditoriaService` → `registrar(evento)` *(RN-AUD1, invocada por los demás servicios)*, `buscarPaginado(filtros)`, `exportarCSV(filtros)`.

**Vista / DTO — registro**

{ "id": "uuid", "userName": "Administrador Principal", "userRole": "admin", "action": "DELETE", "module": "clients", "entityId": "uuid", "details": "Cliente eliminado", "ipAddress": "127.0.0.1", "timestamp": "2026-06-04T12:00:00Z" }

---

# 3\. Módulo Historial Clínico *(vendible)*

**Rol en el SaaS:** registro **clínico longitudinal** de cada mascota: eventos (consulta, vacuna, cirugía, análisis, etc.), signos vitales (peso, temperatura), diagnóstico, tratamiento, medicación, adjuntos y evolución. Se apoya en el Core (mascota/cliente) y en Seguridad (profesional responsable). El **peso vive aquí**, no en la mascota (RN-MA3).

---

## Caso de Uso: Consultar Historial Clínico

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Seleccionar paciente mediante selects encadenados Cliente → Mascota.  
- Mostrar un resumen del paciente (especie, raza, sexo, último peso y estado).  
- Listar los registros clínicos ordenados del más reciente al más antiguo.  
- Ver el detalle completo de un registro (signos vitales, diagnóstico, tratamiento, medicación, adjuntos, tutor vigente al momento).

**No Funcionales**

- **RN-HC1 (orden cronológico):** los registros se devuelven ordenados por fecha descendente.  
- **RN-HC2 (último peso derivado):** el resumen calcula el último peso a partir del registro clínico más reciente que lo contenga.  
- **RN-HC3 (tutor histórico):** cada registro muestra `clientNameAtTime` (tutor vigente al momento del registro); si difiere del tutor actual, se marca como "previo" (vínculo con RN-CD3).  
- **RN-HC4 (permiso de lectura):** requiere `view_medical_history`.  
- **RN-HC5 (rendimiento):** historial paginado por mascota con índice sobre `(pet_id, date)`.  
- **UX:** vista de tabla con badges de color por tipo de evento; acceso al detalle en un clic (ícono ojo) que abre modal.

### B. Ficha de Caso de Uso

- **Actor principal:** Veterinario / Recepcionista / Administrador (`view_medical_history`).  
- **Disparador:** abrir Historial Clínico y seleccionar cliente \+ mascota.  
- **Precondiciones:** existe la mascota; permiso de lectura.

**Flujo normal**

1. El actor selecciona cliente; el sistema filtra sus mascotas.  
2. Selecciona la mascota; el sistema muestra el resumen del paciente y la lista de registros.  
3. Pulsa el ícono de detalle de un registro.  
4. El sistema abre el modal con todo el contenido clínico y los adjuntos.

**Flujos alternativos y excepciones**

- **2a.** Mascota sin registros → estado vacío con acción rápida "Agregar primer registro" (si tiene permiso de gestión).  
- **2b.** Mascota fallecida → se muestra el historial completo en modo lectura con aviso.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Historial por mascota | `GET /api/v1/mascotas/{petId}/historial?page=` |
| Detalle de registro | `GET /api/v1/historial/{id}` |
| Resumen de paciente | `GET /api/v1/mascotas/{petId}/resumen-clinico` |

- **Controlador:** `HistorialClinicoController` → `listarPorMascota()`, `obtener()`, `resumenPaciente()`.  
- **Servicio:** `HistorialClinicoService` → `listarPorMascota(petId, page)` *(RN-HC1)*, `obtenerPorId(id)`, `resumenPaciente(petId)` *(RN-HC2)*.

**Vista / DTO — ítem de historial**

{ "id": "uuid", "date": "2026-03-03", "eventType": "Consulta", "professionalName": "Dra. María Fernández", "weightKg": 4.1, "temperatureC": 38.0, "diagnosis": "Control sin hallazgos", "clientNameAtTime": "Juan Pérez", "hasAttachments": true }

---

## Caso de Uso: Registrar Evento Clínico (con adjuntos)

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Registrar un evento clínico con: fecha, tipo de evento, profesional responsable, descripción/anamnesis, y opcionalmente peso, temperatura, diagnóstico, tratamiento, medicación y observaciones.  
- Adjuntar archivos clínicos (radiografías, análisis, fotos): JPG, PNG, GIF, PDF.  
- Opcionalmente enviar un resumen del registro al email del cliente al guardar.

**No Funcionales**

- **RN-EC1 (obligatorios):** tipo de evento, profesional y descripción son obligatorios; peso y temperatura opcionales.  
- **RN-EC2 (peso en historial):** el peso se registra aquí (RN-MA3) y alimenta el seguimiento evolutivo y el "último peso".  
- **RN-EC3 (mascota viva):** no se permiten registros en mascotas fallecidas → `422 PET_DECEASED` (vínculo RN-MF2).  
- **RN-EC4 (adjuntos):** tipos permitidos JPG/PNG/GIF/PDF; tamaño máximo 10 MB por archivo; se rechazan otros tipos.  
- **RN-EC5 (tutor vigente):** al crear, se persiste `clientIdAtTime`/`clientNameAtTime` con el tutor actual (RN-HC3/RN-CD3).  
- **RN-EC6 (rangos clínicos):** temperatura y peso aceptan rangos plausibles (p. ej. peso 0–200 kg, temperatura 30–45 °C) con validación suave.  
- **RN-EC7 (permiso de gestión):** requiere `manage_medical_history`.  
- **RN-EC8 (auditoría):** `CREATE` en módulo `medical_records`; el envío por email registra `EXPORT`.  
- **RN-EC9 (email condicional):** si se solicita envío y el cliente no tiene email, se avisa y no se envía.  
- **UX:** formulario seccionado (datos del evento → signos vitales → clínica → adjuntos → notificación); contador de caracteres; previsualización de archivos cargados.

### B. Ficha de Caso de Uso

- **Actor principal:** Veterinario / Administrador (`manage_medical_history`).  
- **Actor secundario:** servicio de email; Auditoría.  
- **Disparador:** pestaña "Agregar Registro" con un paciente vivo seleccionado.  
- **Precondiciones:** mascota viva; permiso de gestión.

**Flujo normal**

1. Con el paciente seleccionado, el actor completa tipo de evento, profesional y descripción.  
2. Opcionalmente ingresa peso/temperatura, diagnóstico, tratamiento, medicación y observaciones.  
3. Adjunta archivos válidos.  
4. Marca (opcional) "enviar resumen al cliente".  
5. Pulsa *Registrar*.  
6. El backend valida (RN-EC1, RN-EC3, RN-EC4), persiste el registro con `clientNameAtTime`, asocia adjuntos, audita y, si corresponde, envía el email.  
7. *Toast* de éxito; el nuevo registro encabeza el historial.

**Flujos alternativos y excepciones**

- **5a.** Falta un obligatorio → error inline; operación bloqueada.  
- **5b.** Mascota fallecida → `422 PET_DECEASED`.  
- **3a.** Archivo inválido o \> 10 MB → rechazo con *toast*.  
- **6a.** Email solicitado sin correo de cliente → aviso, registro igualmente guardado (RN-EC9).

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Crear registro | `POST /api/v1/mascotas/{petId}/historial` |
| Subir adjunto | `POST /api/v1/historial/{id}/adjuntos` |
| Descargar adjunto | `GET /api/v1/adjuntos/{adjuntoId}` |
| Enviar por email | `POST /api/v1/historial/{id}/enviar-email` |

- **Controlador:** `HistorialClinicoController` → `crear()`, `subirAdjunto()`, `descargarAdjunto()`, `enviarEmail()`.  
- **Servicio:** `HistorialClinicoService` → `crearRegistro(petId, dto)` *(RN-EC1, RN-EC3, RN-EC5, RN-EC6)*, `adjuntarArchivo(recordId, file)` *(RN-EC4)*, `enviarResumenEmail(recordId)` *(RN-EC9)*; `MascotaService.verificarViva(petId)`.

**Vista / DTO — body de creación**

{ "date": "2026-06-04", "eventType": "Consulta", "professionalId": "uuid", "description": "Control anual, buen estado general", "weightKg": 30, "temperatureC": 38.5, "diagnosis": "Sano", "treatment": "—", "medication": "—", "notes": "Próximo control en 12 meses", "sendEmailToClient": true }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "petId": "uuid", "date": "2026-06-04", "eventType": "Consulta", "clientNameAtTime": "María García", "attachmentsCount": 2, "emailSent": true }, "message": "Registro agregado al historial clínico" }

---

## Caso de Uso: Exportar / Enviar Historial

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Exportar el historial completo de una mascota a Excel y PDF.  
- Generar el PDF con cabecera del paciente y propietario actual.

**No Funcionales**

- **RN-EX1 (datos no vacíos):** sólo se exporta si hay registros; en caso contrario, aviso.  
- **RN-EX2 (PDF imprimible):** el PDF se genera como documento maquetado (cabecera, datos del paciente, total de registros) listo para impresión/descarga.  
- **RN-EX3 (consistencia):** las columnas exportadas reflejan fecha, tipo, profesional, peso, temperatura, descripción/diagnóstico.  
- **RN-EX4 (auditoría):** registra `EXPORT` en módulo `medical_records`.  
- **RN-EX5 (permiso):** requiere al menos `view_medical_history`.

### B. Ficha de Caso de Uso

- **Actor principal:** Veterinario / Administrador / Recepcionista (`view_medical_history`).  
- **Disparador:** botones *Excel* / *PDF* en la vista de historial.  
- **Precondiciones:** mascota con al menos un registro.

**Flujo normal**

1. El actor visualiza el historial de una mascota con registros.  
2. Pulsa *Excel* o *PDF*.  
3. El backend compone el archivo con los registros y la cabecera del paciente.  
4. Se descarga el archivo y se audita la exportación.

**Flujos alternativos y excepciones**

- **2a.** Historial vacío → aviso; no se genera archivo.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Exportar historial | \`GET /api/v1/mascotas/{petId}/historial/export?format=pdf |

- **Controlador:** `HistorialClinicoController.exportar()`.  
- **Servicio:** `HistorialClinicoService.exportar(petId, formato)` *(RN-EX1..EX3)*, `registrarAuditoriaExport(...)`.

**Vista / DTO — respuesta** Binario (`application/pdf` o `application/vnd.ms-excel`) con `Content-Disposition: attachment`, o `{ "success": false, "error": "EMPTY_HISTORY" }` si no hay registros.

---

# 4\. Módulo Turnos *(vendible)*

**Rol en el SaaS:** agenda de **clínica** y **peluquería**. Ofrece *slots* derivados de Horarios de Atención, evita solapamientos y fechas pasadas, gestiona el ciclo de vida del turno (Programado → Confirmado → Completado / Cancelado) y dispara recordatorios automáticos. Se apoya en Core (cliente/mascota), Seguridad (profesional) y Horarios.

**Nota de alcance:** las **estadías de guardería** se modelan en el módulo Guardería (sección 5\) como entidad propia `Estadía`, no como un turno. Turnos cubre servicios puntuales con fecha y hora.

---

## Caso de Uso: Agendar Turno

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Agendar un turno de clínica o peluquería seleccionando tipo de servicio, cliente, mascota, profesional, fecha y horario, con motivo y notas.  
- Mostrar sólo los horarios disponibles del profesional para la fecha elegida, marcando los ocupados.  
- Visualizar la agenda por fecha y la lista de próximos turnos.

**No Funcionales**

- **RN-TU1 (sin fechas pasadas):** no se permite agendar en fechas anteriores a hoy → `422 PAST_DATE`.  
- **RN-TU2 (slots desde Horarios):** los horarios ofrecidos provienen de las franjas activas del profesional (RN-HOR3); si no hay franjas ese día, no hay slots.  
- **RN-TU3 (sin doble reserva):** un mismo profesional no puede tener dos turnos en el mismo horario; el slot ocupado se deshabilita y el backend valida → `409 SLOT_TAKEN`.  
- **RN-TU4 (sin duplicado):** no se permite el mismo cliente+mascota+fecha+horario duplicado → `409 DUPLICATE_APPOINTMENT`.  
- **RN-TU5 (auto-confirmación):** al crear, el turno queda en estado **Confirmado** automáticamente (flujo de mínima fricción).  
- **RN-TU6 (mascota elegible):** la mascota debe estar viva y no eliminada.  
- **RN-TU7 (permiso):** requiere `manage_appointments`.  
- **RN-TU8 (auditoría):** `CREATE` en módulo `appointments`.  
- **UX (mínimos clics):** selects encadenados Cliente→Mascota; el horario se bloquea hasta elegir profesional; aviso de "sin horarios configurados" enlazando a Horarios; confirmación visual del auto-confirmado.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Veterinario / Administrador (`manage_appointments`).  
- **Actor secundario:** Horarios (provee slots); Auditoría; Notificaciones.  
- **Disparador:** pestaña "Agendar Turno".  
- **Precondiciones:** existen cliente, mascota viva y profesional con franjas para la fecha.

**Flujo normal**

1. El actor elige tipo de servicio (Clínica/Peluquería), cliente y mascota.  
2. Selecciona fecha (no anterior a hoy) y profesional.  
3. El sistema muestra los slots disponibles; el actor elige uno libre.  
4. Ingresa motivo (y notas opcionales) y pulsa *Agendar y Confirmar*.  
5. El backend valida RN-TU1/3/4/6, crea el turno en estado Confirmado, audita y muestra *toast*.  
6. El turno aparece en la agenda de la fecha.

**Flujos alternativos y excepciones**

- **2a.** Fecha pasada → bloqueada en el selector; si llega al backend, `422 PAST_DATE`.  
- **3a.** Profesional sin franjas ese día → mensaje "Sin horarios para este día".  
- **3b.** Slot ya ocupado → deshabilitado; `409 SLOT_TAKEN` si hay carrera.  
- **4a.** Duplicado exacto → `409 DUPLICATE_APPOINTMENT`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Agenda por fecha | `GET /api/v1/turnos?date=YYYY-MM-DD` |
| Próximos turnos | `GET /api/v1/turnos/proximos` |
| Slots disponibles | `GET /api/v1/turnos/slots?doctorId=&date=&serviceId=` |
| Crear turno | `POST /api/v1/turnos` |

- **Controlador:** `TurnoController` → `agendaPorFecha()`, `proximos()`, `slotsDisponibles()`, `crear()`.  
- **Servicio:** `TurnoService` → `slotsDisponibles(doctorId, fecha, servicio)` *(usa `HorarioService`, RN-TU2)*, `crearTurno(dto)` *(RN-TU1, RN-TU3, RN-TU4, RN-TU5, RN-TU6)*, `verificarDisponibilidad(...)`.

**Vista / DTO — body de creación**

{ "serviceType": "clinica", "clientId": "uuid", "petId": "uuid", "doctorId": "uuid", "date": "2026-06-10", "startTime": "10:00", "reason": "Control anual", "notes": "" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "serviceType": "clinica", "clientName": "María García", "petName": "Max", "doctorName": "Dra. María Fernández", "date": "2026-06-10", "startTime": "10:00", "endTime": "10:30", "status": "Confirmado" }, "message": "Turno agendado y confirmado" }

---

## Caso de Uso: Modificar / Cancelar Turno

*Caso de uso unificado (fusión de "Editar turno" y "Cancelar turno").*

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Modificar datos de un turno (fecha, horario, profesional, motivo, notas).  
- Cancelar un turno indicando motivo de cancelación.  
- Eliminar definitivamente un turno cuando corresponda (acción administrativa).

**No Funcionales**

- **RN-MC1 (estados editables):** los turnos **Completados** no se editan ni cancelan; los **Confirmados** requieren un cambio de estado previo o una política explícita antes de editarse (regla de bloqueo de edición), evitando alterar compromisos en firme.  
- **RN-MC2 (revalidación al mover):** al cambiar fecha/horario/profesional se revalidan RN-TU1 (no pasado), RN-TU3 (no doble reserva) y disponibilidad de slot.  
- **RN-MC3 (cancelación con motivo):** la cancelación registra `cancellationReason` y `cancelledAt`; el turno pasa a estado **Cancelado** y deja de ocupar el slot.  
- **RN-MC4 (cancelado ≠ visible en agenda):** los turnos cancelados se excluyen de la agenda activa pero permanecen para trazabilidad/reportes.  
- **RN-MC5 (confirmación destructiva):** cancelar/eliminar requiere modal de confirmación.  
- **RN-MC6 (permiso):** requiere `manage_appointments`.  
- **RN-MC7 (auditoría):** `UPDATE` (modificación), `UPDATE`/`CANCEL` (cancelación) y `DELETE` (eliminación) en módulo `appointments`.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador (`manage_appointments`).  
- **Disparador:** *Editar*, *Cancelar* o *Eliminar* sobre un turno.  
- **Precondiciones:** turno existente en estado modificable.

**Flujo normal (modificar)**

1. El actor abre un turno editable; el formulario se precarga.  
2. Cambia fecha/horario/profesional/motivo.  
3. El backend revalida disponibilidad y reglas de fecha.  
4. Persiste cambios, audita y muestra *toast*.

**Flujo normal (cancelar)**

1. El actor pulsa *Cancelar* y confirma en el modal, indicando motivo.  
2. El backend marca el turno como Cancelado con motivo y fecha de cancelación, libera el slot y audita.

**Flujos alternativos y excepciones**

- **1a (modificar).** Turno completado/confirmado bloqueado → `422 APPOINTMENT_LOCKED` (RN-MC1).  
- **3a.** Nuevo horario ocupado o fecha pasada → `409 SLOT_TAKEN` / `422 PAST_DATE`.  
- **Eliminar:** acción administrativa con confirmación → baja del turno.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Modificar | `PUT /api/v1/turnos/{id}` |
| Cancelar | `PATCH /api/v1/turnos/{id}/cancelar` |
| Eliminar | `DELETE /api/v1/turnos/{id}` |

- **Controlador:** `TurnoController` → `actualizar()`, `cancelar()`, `eliminar()`.  
- **Servicio:** `TurnoService` → `actualizarTurno(id, dto)` *(RN-MC1, RN-MC2)*, `cancelarTurno(id, motivo)` *(RN-MC3, RN-MC4)*, `eliminarTurno(id)`, `puedeEditar(turno)` / `puedeCancelar(turno)`.

**Vista / DTO — body de cancelación**

{ "cancellationReason": "El cliente reprogramará" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "status": "Cancelado", "cancelledAt": "2026-06-04T12:00:00Z" }, "message": "Turno cancelado" }

---

## Caso de Uso: Gestionar Estado del Turno

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Cambiar el estado de un turno entre los valores válidos del ciclo de vida.  
- Al marcar **Completado**, retirar el turno de la agenda activa.

**No Funcionales**

- **RN-ES1 (estados válidos):** el ciclo es `Programado → Confirmado → Completado` con `Cancelado` como terminal alternativo; no se permiten transiciones inválidas (p. ej. de Completado a Confirmado) → `422 INVALID_TRANSITION`.  
- **RN-ES2 (completado retira de agenda):** un turno Completado se excluye de la agenda activa y de las listas de próximos, pero se conserva para reportes.  
- **RN-ES3 (terminalidad):** Completado y Cancelado son estados terminales; no admiten edición posterior.  
- **RN-ES4 (permiso):** requiere `manage_appointments`.  
- **RN-ES5 (auditoría):** `UPDATE` en módulo `appointments` con el cambio de estado.

### B. Ficha de Caso de Uso

- **Actor principal:** Veterinario / Recepcionista / Administrador (`manage_appointments`).  
- **Disparador:** acción de cambio de estado sobre un turno de la agenda.  
- **Precondiciones:** turno en estado no terminal.

**Flujo normal**

1. El actor selecciona un nuevo estado válido para el turno.  
2. El backend valida la transición (RN-ES1).  
3. Persiste el estado; si es Completado, lo retira de la agenda; audita.  
4. *Toast* de confirmación.

**Flujos alternativos y excepciones**

- **2a.** Transición inválida → `422 INVALID_TRANSITION`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Cambiar estado | `PATCH /api/v1/turnos/{id}/estado` |

- **Controlador:** `TurnoController.cambiarEstado()`.  
- **Servicio:** `TurnoService.cambiarEstado(id, nuevoEstado)` *(RN-ES1, RN-ES2, RN-ES3)*.

**Vista / DTO — body**

{ "status": "Completado" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "status": "Completado", "removedFromAgenda": true }, "message": "Estado actualizado" }

---

## Caso de Uso: Notificaciones Automáticas de Turnos

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Enviar recordatorios automáticos al cliente N horas antes del turno (por defecto 24 h).  
- Configurar canales (email, WhatsApp, SMS), activación y antelación.  
- Mostrar el estado de las notificaciones (pendiente, enviada, fallida) y un resumen.

**No Funcionales**

- **RN-NT1 (ventana de envío):** se notifica sólo si el turno es futuro y está dentro de la ventana configurada (0 \< horas restantes ≤ antelación).  
- **RN-NT2 (estados excluidos):** turnos Cancelados o Completados no generan notificación.  
- **RN-NT3 (idempotencia):** no se reenvía una notificación ya enviada para el mismo turno (registro de enviadas).  
- **RN-NT4 (datos de contacto):** un canal sólo se usa si el cliente tiene el dato correspondiente (email/teléfono); si no, ese canal se omite.  
- **RN-NT5 (ejecución periódica):** el procesamiento corre periódicamente (tarea programada del backend) y también puede dispararse manualmente ("Verificar").  
- **RN-NT6 (auditoría):** registra el envío como evento del sistema.

### B. Ficha de Caso de Uso

- **Actor principal:** Sistema (tarea programada).  
- **Actor secundario:** Recepcionista/Administrador (configura y dispara verificación manual).  
- **Disparador:** ejecución periódica o botón *Verificar*.  
- **Precondiciones:** notificaciones activas; turnos futuros confirmados.

**Flujo normal**

1. La tarea recorre los turnos futuros confirmados.  
2. Filtra los que entran en la ventana de antelación y no fueron notificados.  
3. Compone el mensaje y lo envía por los canales habilitados con datos disponibles.  
4. Marca cada turno como notificado y registra el resultado.

**Flujos alternativos y excepciones**

- **3a.** Sin datos de contacto para ningún canal → notificación marcada como fallida con motivo.  
- **2a.** Ya notificado → se omite (RN-NT3).

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Procesar notificaciones | `POST /api/v1/turnos/notificaciones/procesar` |
| Obtener configuración | `GET /api/v1/turnos/notificaciones/config` |
| Guardar configuración | `PUT /api/v1/turnos/notificaciones/config` |

- **Controlador:** `NotificacionTurnoController` → `procesar()`, `obtenerConfig()`, `guardarConfig()`.  
- **Servicio:** `NotificacionTurnoService` → `procesarPendientes()` *(RN-NT1..NT4)*, `debeNotificar(turno, config)`, `enviar(turno, config)`, `marcarEnviada(turnoId)`.

**Vista / DTO — configuración**

{ "enabled": true, "hoursBeforeAppointment": 24, "sendEmail": true, "sendWhatsApp": true, "sendSMS": false }

**Vista / DTO — resultado de procesamiento**

{ "success": true, "data": { "processed": 12, "sent": 9, "failed": 1, "skipped": 2 }, "message": "Notificaciones procesadas" }

---

# 5\. Módulo Guardería *(vendible)*

**Rol en el SaaS:** gestiona **estadías** de mascotas por rango de fechas (hospedaje/guardería). A diferencia de Turnos, su unidad es la **Estadía** (`fechaIngreso`–`fechaEgreso`) con su propio ciclo de vida (Reservada → En Curso → Finalizada / Cancelada). Se apoya en el Core (cliente/mascota) y comparte con Turnos el panel de agenda para visualización combinada.

**Decisión de modelado:** se introduce la entidad `Estadia` en lugar de reutilizar `Turno`. Esto evita sobrecargar el turno con campos de rango y permite comercializar Guardería de forma independiente con sus propias reglas (capacidad, ocupación, check-in/out).

---

## Caso de Uso: Registrar Estadía

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Registrar una estadía con cliente, mascota, fecha de ingreso, fecha de egreso, motivo y notas (p. ej. alimentación especial).  
- Visualizar la ocupación por día y las estadías vigentes.

**No Funcionales**

- **RN-GU1 (rango válido):** la fecha de egreso debe ser posterior o igual a la de ingreso, y la de ingreso no puede ser anterior a hoy → `422 INVALID_RANGE` / `422 PAST_DATE`.  
- **RN-GU2 (sin superposición por mascota):** una misma mascota no puede tener dos estadías cuyo rango se superponga → `409 STAY_OVERLAP`.  
- **RN-GU3 (mascota elegible):** la mascota debe estar viva y no eliminada.  
- **RN-GU4 (capacidad, opcional por tenant):** si el tenant define capacidad máxima por día, no se permite exceder la ocupación → `409 CAPACITY_EXCEEDED`.  
- **RN-GU5 (estado inicial):** la estadía nace en estado **Reservada**.  
- **RN-GU6 (permiso):** requiere `manage_appointments` (o permiso específico `manage_daycare` si el tenant lo separa).  
- **RN-GU7 (auditoría):** `CREATE` en módulo `appointments`/`daycare`.  
- **UX:** selección de rango con dos calendarios; el calendario de egreso se limita a fechas ≥ ingreso; vista de ocupación por día.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador.  
- **Actor secundario:** Core (valida mascota viva); Auditoría.  
- **Disparador:** *Nueva Estadía* en el módulo Guardería.  
- **Precondiciones:** existe cliente y mascota viva.

**Flujo normal**

1. El actor selecciona cliente y mascota.  
2. Elige fecha de ingreso y de egreso (rango válido).  
3. Ingresa motivo y notas.  
4. Pulsa *Registrar Estadía*.  
5. El backend valida RN-GU1/2/3/4, crea la estadía en estado Reservada, audita y muestra *toast*.

**Flujos alternativos y excepciones**

- **2a.** Egreso \< ingreso o ingreso pasado → `422`.  
- **4a.** Superposición con otra estadía de la misma mascota → `409 STAY_OVERLAP`.  
- **4b.** Capacidad del día excedida (si aplica) → `409 CAPACITY_EXCEEDED`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Listar/ocupación | `GET /api/v1/estadias?date=` o `?dateFrom=&dateTo=` |
| Crear | `POST /api/v1/estadias` |
| Detalle | `GET /api/v1/estadias/{id}` |

- **Controlador:** `EstadiaController` → `listar()`, `crear()`, `obtener()`.  
- **Servicio:** `EstadiaService` → `crearEstadia(dto)` *(RN-GU1..GU5)*, `verificarSuperposicion(petId, rango)`, `ocupacionPorDia(fecha)`.

**Vista / DTO — body de creación**

{ "clientId": "uuid", "petId": "uuid", "checkInDate": "2026-07-01", "checkOutDate": "2026-07-07", "reason": "Viaje del propietario", "notes": "Dieta especial incluida" }

**Vista / DTO — respuesta**

{ "success": true, "data": { "id": "uuid", "clientName": "Laura Sánchez", "petName": "Coco", "checkInDate": "2026-07-01", "checkOutDate": "2026-07-07", "status": "Reservada" }, "message": "Estadía registrada" }

---

## Caso de Uso: Modificar / Cancelar Estadía

*Caso de uso unificado (modificación y cancelación de estadía).*

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Modificar fechas, motivo y notas de una estadía.  
- Cancelar una estadía indicando motivo.

**No Funcionales**

- **RN-ME1 (estados editables):** una estadía **Finalizada** no se modifica ni cancela; una **En Curso** sólo admite ajuste de fecha de egreso (no de ingreso).  
- **RN-ME2 (revalidación):** al cambiar el rango se revalidan RN-GU1 (fechas) y RN-GU2 (superposición).  
- **RN-ME3 (cancelación con motivo):** la cancelación marca estado **Cancelada** con motivo y fecha; libera la ocupación de esos días.  
- **RN-ME4 (confirmación):** cancelar requiere modal de confirmación.  
- **RN-ME5 (permiso):** requiere `manage_appointments`/`manage_daycare`.  
- **RN-ME6 (auditoría):** `UPDATE` (modificación/cancelación) en módulo `appointments`/`daycare`.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador.  
- **Disparador:** *Editar* o *Cancelar* sobre una estadía.  
- **Precondiciones:** estadía en estado modificable.

**Flujo normal (modificar)**

1. El actor abre una estadía editable; el formulario se precarga.  
2. Ajusta fechas/motivo/notas.  
3. El backend revalida rango y superposición.  
4. Persiste y audita.

**Flujo normal (cancelar)**

1. El actor pulsa *Cancelar* y confirma con motivo.  
2. El backend marca Cancelada, libera ocupación y audita.

**Flujos alternativos y excepciones**

- **1a.** Estadía finalizada → `422 STAY_LOCKED`.  
- **3a.** Nuevo rango se superpone → `409 STAY_OVERLAP`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Modificar | `PUT /api/v1/estadias/{id}` |
| Cancelar | `PATCH /api/v1/estadias/{id}/cancelar` |

- **Controlador:** `EstadiaController` → `actualizar()`, `cancelar()`.  
- **Servicio:** `EstadiaService` → `actualizarEstadia(id, dto)` *(RN-ME1, RN-ME2)*, `cancelarEstadia(id, motivo)` *(RN-ME3)*.

**Vista / DTO — respuesta de cancelación**

{ "success": true, "data": { "id": "uuid", "status": "Cancelada", "cancelledAt": "2026-06-04T12:00:00Z" }, "message": "Estadía cancelada" }

---

## Caso de Uso: Check-in / Check-out (Estado de Estadía)

### A. Requisitos Funcionales y No Funcionales

**Funcionales**

- Registrar el ingreso efectivo (check-in) y el egreso efectivo (check-out) de la mascota.  
- Reflejar el estado de la estadía en la ocupación y en los reportes.

**No Funcionales**

- **RN-CK1 (ciclo de vida):** transiciones válidas `Reservada → En Curso → Finalizada`, con `Cancelada` como alternativa terminal; transiciones inválidas → `422 INVALID_TRANSITION`.  
- **RN-CK2 (ch/eck-in):** el check-in pasa la estadía a **En Curso** y registra la marca temporal de ingreso real.  
- **RN-CK3 (check-out):** el check-out pasa a **Finalizada** y registra la marca temporal de egreso real; libera el cupo a partir de ese momento.  
- **RN-CK4 (terminalidad):** Finalizada y Cancelada no admiten reapertura.  
- **RN-CK5 (permiso):** requiere `manage_appointments`/`manage_daycare`.  
- **RN-CK6 (auditoría):** `UPDATE` en módulo `daycare`.

### B. Ficha de Caso de Uso

- **Actor principal:** Recepcionista / Administrador.  
- **Disparador:** botones *Check-in* / *Check-out* sobre una estadía.  
- **Precondiciones:** estadía en estado compatible con la transición.

**Flujo normal**

1. El actor pulsa *Check-in* el día de ingreso → estadía En Curso.  
2. Al retirar la mascota, pulsa *Check-out* → estadía Finalizada.  
3. El backend valida la transición y registra marcas temporales; audita.

**Flujos alternativos y excepciones**

- **1a/2a.** Transición no permitida (p. ej. check-out sin check-in) → `422 INVALID_TRANSITION`.

### C. Métodos y Gestores Propuestos

| Acción | Ruta / Endpoint |
| :---- | :---- |
| Check-in | `PATCH /api/v1/estadias/{id}/check-in` |
| Check-out | `PATCH /api/v1/estadias/{id}/check-out` |

- **Controlador:** `EstadiaController` → `checkIn()`, `checkOut()`.  
- **Servicio:** `EstadiaService` → `checkIn(id)` *(RN-CK2)*, `checkOut(id)` *(RN-CK3)*, `validarTransicion(actual, nuevo)` *(RN-CK1)*.

**Vista / DTO — respuesta de check-out**

{ "success": true, "data": { "id": "uuid", "status": "Finalizada", "checkedOutAt": "2026-07-07T11:30:00Z" }, "message": "Egreso registrado" }

---

# 6\. Diagrama de Clases General (UML)

Diagrama de clases que abarca **todo el sistema**: entidades del Core, transversales y módulos vendibles, con atributos tipados, métodos principales deducidos del diseño backend y relaciones con cardinalidad.

## 6.1 Diagrama (Mermaid)

classDiagram

direction LR

class Rol {

  \+UUID id

  \+String name

  \+String displayName

  \+String description

  \+Boolean isSystem

  \+Boolean active

  \+DateTime createdAt

  \+listarPermisos() Permiso\[\]

}

class Permiso {

  \+UUID id

  \+String name

  \+String displayName

  \+String module

  \+DateTime createdAt

}

class RolPermiso {

  \+UUID rolId

  \+UUID permisoId

  \+DateTime grantedAt

}

class Usuario {

  \+UUID id

  \+String username

  \+String passwordHash

  \+String email

  \+String fullName

  \+UUID rolId

  \+String phone

  \+Boolean active

  \+DateTime lastLogin

  \+DateTime createdAt

  \+autenticar(password) Boolean

  \+tienePermiso(nombre) Boolean

}

class Doctor {

  \+UUID id

  \+UUID userId

  \+String name

  \+String specialty

  \+String licenseNumber

  \+Boolean available

  \+DateTime createdAt

  \+slotsDisponibles(fecha) TimeSlot\[\]

}

class HorarioDoctor {

  \+UUID id

  \+UUID doctorId

  \+SmallInt dayOfWeek

  \+Time startTime

  \+Time endTime

  \+Boolean active

  \+DateTime createdAt

}

class Cliente {

  \+UUID id

  \+String fullName

  \+String dniCuit

  \+String phone

  \+String address

  \+String email

  \+Text observations

  \+Boolean deleted

  \+DateTime createdAt

  \+UUID createdBy

  \+tieneMascotasVivas() Boolean

}

class Especie {

  \+UUID id

  \+String name

  \+String description

  \+Boolean active

}

class Raza {

  \+UUID id

  \+UUID especieId

  \+String name

  \+String description

  \+Boolean active

}

class Mascota {

  \+UUID id

  \+String name

  \+UUID clientId

  \+UUID razaId

  \+Sexo sex

  \+Date birthDate

  \+String color

  \+Text observations

  \+Boolean deceased

  \+Date deceasedDate

  \+String deceasedReason

  \+Boolean deleted

  \+DateTime createdAt

  \+calcularEdad() String

  \+ultimoPeso() Decimal

}

class CambioPropietario {

  \+UUID id

  \+UUID petId

  \+UUID previousClientId

  \+UUID newClientId

  \+DateTime changeDate

  \+String reason

  \+Text notes

  \+UUID recordedBy

}

class Servicio {

  \+UUID id

  \+String name

  \+String description

  \+Int estimatedDuration

  \+Boolean requiresProfessional

  \+TipoServicio serviceType

  \+Boolean active

}

class HistorialClinico {

  \+UUID id

  \+UUID petId

  \+UUID professionalId

  \+UUID serviceId

  \+Date date

  \+TipoEvento eventType

  \+Text description

  \+Decimal weightKg

  \+Decimal temperatureC

  \+Text diagnosis

  \+Text treatment

  \+Text medication

  \+Text notes

  \+UUID clientIdAtTime

  \+String clientNameAtTime

  \+Boolean deleted

  \+DateTime createdAt

  \+exportar(formato) File

}

class AdjuntoMedico {

  \+UUID id

  \+UUID medicalRecordId

  \+String fileName

  \+String fileType

  \+Int fileSize

  \+String fileUrl

  \+DateTime uploadedAt

  \+Boolean deleted

}

class Turno {

  \+UUID id

  \+UUID clientId

  \+UUID petId

  \+UUID serviceId

  \+UUID doctorId

  \+Date date

  \+Time startTime

  \+Time endTime

  \+EstadoTurno status

  \+String reason

  \+Text notes

  \+String cancellationReason

  \+DateTime cancelledAt

  \+DateTime createdAt

  \+cambiarEstado(nuevo) void

}

class Estadia {

  \+UUID id

  \+UUID clientId

  \+UUID petId

  \+Date checkInDate

  \+Date checkOutDate

  \+EstadoEstadia status

  \+String reason

  \+Text notes

  \+DateTime checkedInAt

  \+DateTime checkedOutAt

  \+String cancellationReason

  \+DateTime createdAt

}

class RegistroAuditoria {

  \+UUID id

  \+UUID userId

  \+String userName

  \+String userRole

  \+AccionAuditoria action

  \+ModuloAuditoria module

  \+String entityId

  \+JSON oldValues

  \+JSON newValues

  \+Text details

  \+String ipAddress

  \+DateTime timestamp

}

class EstadoTurno {

  \<\<enumeration\>\>

  Programado

  Confirmado

  Completado

  Cancelado

}

class EstadoEstadia {

  \<\<enumeration\>\>

  Reservada

  EnCurso

  Finalizada

  Cancelada

}

class TipoServicio {

  \<\<enumeration\>\>

  clinica

  peluqueria

  guarderia

  cirugia

  otro

}

class Sexo {

  \<\<enumeration\>\>

  Macho

  Hembra

  Desconocido

}

Rol "1" \--\> "0..\*" Usuario : asignado a

Rol "1" \--\> "0..\*" RolPermiso

Permiso "1" \--\> "0..\*" RolPermiso

Usuario "1" \--\> "0..1" Doctor : perfil

Doctor "1" \--\> "0..\*" HorarioDoctor

Cliente "1" \--\> "0..\*" Mascota

Especie "1" \--\> "0..\*" Raza

Raza "1" \--\> "0..\*" Mascota

Mascota "1" \--\> "0..\*" HistorialClinico

Usuario "1" \--\> "0..\*" HistorialClinico : profesional

Servicio "0..1" \--\> "0..\*" HistorialClinico

HistorialClinico "1" \*-- "0..\*" AdjuntoMedico

Mascota "1" \--\> "0..\*" CambioPropietario

Cliente "1" \--\> "0..\*" Turno

Mascota "1" \--\> "0..\*" Turno

Servicio "1" \--\> "0..\*" Turno

Doctor "0..1" \--\> "0..\*" Turno

Cliente "1" \--\> "0..\*" Estadia

Mascota "1" \--\> "0..\*" Estadia

Usuario "1" \--\> "0..\*" RegistroAuditoria

## 6.2 Relaciones y cardinalidad (resumen textual)

| Relación | Cardinalidad | Descripción |
| :---- | :---- | :---- |
| Rol — Usuario | 1 : N | Un rol se asigna a muchos usuarios; cada usuario tiene exactamente un rol. |
| Rol — Permiso | N : M (via `RolPermiso`) | Permisos jerárquicos heredados por el rol. |
| Usuario — Doctor | 1 : 0..1 | Un usuario con rol que atiende posee un perfil profesional. |
| Doctor — HorarioDoctor | 1 : N | Cada profesional define varias franjas de atención. |
| Cliente — Mascota | 1 : N | Un cliente posee varias mascotas. |
| Especie — Raza | 1 : N | Cada especie agrupa varias razas. |
| Raza — Mascota | 1 : N | Cada mascota pertenece a una raza. |
| Mascota — HistorialClinico | 1 : N | Historial clínico longitudinal por mascota. |
| Usuario(profesional) — HistorialClinico | 1 : N | Profesional responsable de cada registro. |
| Servicio — HistorialClinico | 0..1 : N | Registro opcionalmente vinculado a un servicio. |
| HistorialClinico — AdjuntoMedico | 1 : N (composición) | Los adjuntos pertenecen al registro. |
| Mascota — CambioPropietario | 1 : N | Historial de transferencias de propiedad. |
| Cliente — Turno | 1 : N | Turnos de un cliente. |
| Mascota — Turno | 1 : N | Turnos de una mascota. |
| Servicio — Turno | 1 : N | Servicio prestado en el turno. |
| Doctor — Turno | 0..1 : N | Profesional asignado (opcional para guardería histórica). |
| Cliente — Estadia | 1 : N | Estadías de guardería de un cliente. |
| Mascota — Estadia | 1 : N | Estadías de una mascota. |
| Usuario — RegistroAuditoria | 1 : N | Acciones auditadas por usuario. |

## 6.3 Enumeraciones adicionales

- **TipoEvento** (HistorialClinico): `Consulta`, `Vacunación`, `Cirugía`, `Análisis`, `Radiografía`, `Ecografía`, `Desparasitación`, `Control`, `Emergencia`, `Internación`, `Otro`.  
- **AccionAuditoria**: `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `LOGOUT`, `VIEW`, `EXPORT`.  
- **ModuloAuditoria**: `clients`, `pets`, `medical_records`, `appointments`, `daycare`, `users`, `security`, `system`.

*Fin del documento maestro.*  
