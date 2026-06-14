-- =====================================================================
-- MIGRACIÓN 002: Tablas, Constraints e Índices
-- =====================================================================

-- =====================================================================
-- PLATAFORMA (Super Admin) — sin tenant_id
-- =====================================================================

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 3 AND 120),
  cuit_rut        TEXT NOT NULL UNIQUE,
  email_contacto  TEXT NOT NULL CHECK (email_contacto ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  plan            plan_tenant NOT NULL DEFAULT 'basico',
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenants_nombre ON tenants (lower(nombre));

CREATE TABLE modulos_contratados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  modulo      modulo_vendible NOT NULL,
  habilitado  BOOLEAN NOT NULL DEFAULT false,
  fecha_alta  DATE,
  UNIQUE (tenant_id, modulo)
);
CREATE INDEX idx_modulos_contratados_tenant ON modulos_contratados (tenant_id);

CREATE TABLE configuracion_tenant (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  cupo_maximo_diario  INTEGER NOT NULL DEFAULT 10 CHECK (cupo_maximo_diario BETWEEN 1 AND 500),
  dias_aviso_vacuna   INTEGER NOT NULL DEFAULT 7  CHECK (dias_aviso_vacuna  BETWEEN 1 AND 90),
  parametros_extra    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_configuracion_tenant_tenant ON configuracion_tenant (tenant_id);

-- =====================================================================
-- CATÁLOGOS GLOBALES (SIN tenant_id)
-- =====================================================================

CREATE TABLE permisos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  module        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE especies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE razas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  especie_id  UUID NOT NULL REFERENCES especies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (especie_id, name)
);
CREATE INDEX idx_razas_especie ON razas (especie_id);

CREATE TABLE tipos_vacuna (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                   TEXT NOT NULL UNIQUE,
  especie_aplicable        TEXT,
  meses_refuerzo_sugerido  INTEGER CHECK (meses_refuerzo_sugerido > 0),
  active                   BOOLEAN NOT NULL DEFAULT true
);

-- =====================================================================
-- SEGURIDAD (por tenant)
-- =====================================================================

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_roles_tenant ON roles (tenant_id);

CREATE TABLE rol_permiso (
  rol_id      UUID NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
  permiso_id  UUID NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuarios (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  rol_id      UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username),
  UNIQUE (tenant_id, email)
);
CREATE INDEX idx_usuarios_tenant ON usuarios (tenant_id);

CREATE TABLE doctores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  user_id         UUID REFERENCES usuarios(id)          ON DELETE SET NULL,
  name            TEXT NOT NULL,
  specialty       TEXT,
  license_number  TEXT,
  available       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doctores_tenant ON doctores (tenant_id);

CREATE TABLE horarios_doctor (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  doctor_id   UUID NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_horarios_doctor_tenant ON horarios_doctor (tenant_id);
CREATE INDEX idx_horarios_doctor_doctor ON horarios_doctor (doctor_id, day_of_week);

-- =====================================================================
-- CORE CLIENTE-MASCOTA
-- =====================================================================

CREATE TABLE clientes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  dni_cuit      TEXT,
  phone         TEXT,
  address       TEXT,
  email         TEXT,
  observations  TEXT,
  deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, dni_cuit)
);
CREATE INDEX idx_clientes_tenant ON clientes (tenant_id);
CREATE INDEX idx_clientes_nombre ON clientes (tenant_id, lower(full_name));

CREATE TABLE mascotas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  name            TEXT NOT NULL,
  client_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  especie_id      UUID NOT NULL REFERENCES especies(id) ON DELETE RESTRICT,
  raza_id         UUID REFERENCES razas(id)             ON DELETE SET NULL,
  sex             sexo_mascota   NOT NULL,
  tamano          tamano_mascota NOT NULL,
  alimento_dieta  TEXT CHECK (char_length(alimento_dieta) <= 500),
  birth_date      DATE,
  color           TEXT,
  observations    TEXT,
  estado          estado_mascota NOT NULL DEFAULT 'Activa',
  deceased_date   DATE,
  deceased_reason TEXT,
  deleted         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (estado = 'Activa' OR deceased_date IS NOT NULL)
);
CREATE INDEX idx_mascotas_tenant  ON mascotas (tenant_id);
CREATE INDEX idx_mascotas_cliente ON mascotas (tenant_id, client_id);
CREATE INDEX idx_mascotas_nombre  ON mascotas (tenant_id, lower(name));

CREATE TABLE cambios_propietario (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  pet_id              UUID NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  previous_client_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  new_client_id       UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  change_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason              TEXT,
  notes               TEXT,
  recorded_by         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  CHECK (previous_client_id <> new_client_id)
);
CREATE INDEX idx_cambios_prop_tenant ON cambios_propietario (tenant_id);
CREATE INDEX idx_cambios_prop_pet    ON cambios_propietario (pet_id);

-- =====================================================================
-- SERVICIOS (por tenant)
-- =====================================================================

CREATE TABLE servicios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre                TEXT NOT NULL,
  descripcion           TEXT,
  duracion_minutos      INTEGER NOT NULL CHECK (
                          duracion_minutos BETWEEN 5 AND 480
                          AND duracion_minutos % 5 = 0
                        ),
  requiere_profesional  BOOLEAN NOT NULL DEFAULT true,
  tipo                  tipo_servicio NOT NULL,
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_servicios_tenant_nombre
  ON servicios (tenant_id, lower(nombre))
  WHERE activo;
CREATE INDEX idx_servicios_tenant_activo ON servicios (tenant_id, activo);

-- =====================================================================
-- HISTORIAL CLÍNICO
-- =====================================================================

CREATE TABLE historial_clinico (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  pet_id              UUID NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  professional_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  service_id          UUID REFERENCES servicios(id)         ON DELETE SET NULL,
  date                DATE NOT NULL,
  event_type          tipo_evento_clinico NOT NULL,
  description         TEXT NOT NULL,
  weight_kg           NUMERIC(6,2) CHECK (weight_kg     BETWEEN 0  AND 200),
  temperature_c       NUMERIC(4,1) CHECK (temperature_c BETWEEN 30 AND 45),
  diagnosis           TEXT,
  treatment           TEXT,
  medication          TEXT,
  notes               TEXT,
  client_id_at_time   UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  client_name_at_time TEXT NOT NULL,
  deleted             BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_historial_tenant   ON historial_clinico (tenant_id);
CREATE INDEX idx_historial_pet_date ON historial_clinico (pet_id, date DESC);

CREATE TABLE adjuntos_medicos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  medical_record_id  UUID NOT NULL REFERENCES historial_clinico(id) ON DELETE CASCADE,
  file_name          TEXT NOT NULL,
  file_type          TEXT NOT NULL CHECK (
                       file_type IN ('image/jpeg', 'image/png', 'image/gif', 'application/pdf')
                     ),
  file_size          INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  storage_path       TEXT NOT NULL,
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted            BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_adjuntos_tenant ON adjuntos_medicos (tenant_id);
CREATE INDEX idx_adjuntos_record ON adjuntos_medicos (medical_record_id);

-- Plan de Vacunación
CREATE TABLE plan_vacunacion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  pet_id                UUID NOT NULL REFERENCES mascotas(id)     ON DELETE CASCADE,
  tipo_vacuna_id        UUID NOT NULL REFERENCES tipos_vacuna(id) ON DELETE RESTRICT,
  evento_origen_id      UUID REFERENCES historial_clinico(id)     ON DELETE SET NULL,
  evento_aplicacion_id  UUID REFERENCES historial_clinico(id)     ON DELETE SET NULL,
  fecha_estimada        DATE NOT NULL,
  estado                estado_vacunacion NOT NULL DEFAULT 'Pendiente',
  notas                 TEXT,
  notified_at           TIMESTAMPTZ,
  created_by            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (estado <> 'Aplicada' OR evento_aplicacion_id IS NOT NULL)
);
CREATE INDEX idx_planvac_tenant_barrido
  ON plan_vacunacion (tenant_id, estado, fecha_estimada);
CREATE INDEX idx_planvac_pet ON plan_vacunacion (pet_id, fecha_estimada);

-- =====================================================================
-- TURNOS
-- =====================================================================

CREATE TABLE turnos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  client_id            UUID NOT NULL REFERENCES clientes(id)  ON DELETE RESTRICT,
  pet_id               UUID NOT NULL REFERENCES mascotas(id)  ON DELETE RESTRICT,
  servicio_id          UUID NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT,
  doctor_id            UUID REFERENCES doctores(id)           ON DELETE SET NULL,
  date                 DATE NOT NULL,
  start_time           TIME NOT NULL,
  end_time             TIME NOT NULL,
  status               estado_turno NOT NULL DEFAULT 'Confirmado',
  reason               TEXT NOT NULL,
  notes                TEXT,
  cancellation_reason  TEXT,
  cancelled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (tenant_id, client_id, pet_id, date, start_time)
);

-- EXCLUDE: evita solapamiento de horarios del mismo doctor.
-- Usa timerange() (función auxiliar creada en migración 001) que convierte
-- TIME → int4range de segundos, compatible con btree_gist.
ALTER TABLE turnos ADD CONSTRAINT excl_turnos_solapados
  EXCLUDE USING gist (
    doctor_id WITH =,
    date      WITH =,
    timerange(start_time, end_time) WITH &&
  ) WHERE (doctor_id IS NOT NULL AND status IN ('Programado', 'Confirmado'));

CREATE INDEX idx_turnos_tenant_fecha ON turnos (tenant_id, date);
CREATE INDEX idx_turnos_doctor_fecha ON turnos (doctor_id, date);
CREATE INDEX idx_turnos_pet          ON turnos (pet_id);

-- Notificaciones (compartidas Turnos + Vacunación)
CREATE TABLE notificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  origen          origen_notificacion NOT NULL,
  referencia_id   UUID NOT NULL,
  canal           TEXT NOT NULL CHECK (canal IN ('email', 'whatsapp', 'sms')),
  estado          estado_notificacion NOT NULL DEFAULT 'pendiente',
  mensaje         TEXT,
  sent_at         TIMESTAMPTZ,
  failure_reason  TEXT,
  UNIQUE (tenant_id, origen, referencia_id, canal)
);
CREATE INDEX idx_notificaciones_tenant ON notificaciones (tenant_id, estado);

-- =====================================================================
-- GUARDERÍA
-- =====================================================================

CREATE TABLE estadias (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  client_id            UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  pet_id               UUID NOT NULL REFERENCES mascotas(id) ON DELETE RESTRICT,
  check_in_date        DATE NOT NULL,
  check_out_date       DATE NOT NULL,
  status               estado_estadia NOT NULL DEFAULT 'Reservada',
  reason               TEXT NOT NULL,
  notes                TEXT,
  checked_in_at        TIMESTAMPTZ,
  checked_out_at       TIMESTAMPTZ,
  cancellation_reason  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out_date >= check_in_date)
);

-- EXCLUDE: evita que la misma mascota tenga dos estadías solapadas.
-- daterange es un tipo built-in de PostgreSQL, no requiere función auxiliar.
ALTER TABLE estadias ADD CONSTRAINT excl_estadias_solapadas
  EXCLUDE USING gist (
    pet_id WITH =,
    daterange(check_in_date, check_out_date, '[]') WITH &&
  ) WHERE (status IN ('Reservada', 'EnCurso'));

CREATE INDEX idx_estadias_tenant_rango
  ON estadias (tenant_id, check_in_date, check_out_date, status);
CREATE INDEX idx_estadias_pet ON estadias (pet_id);

-- =====================================================================
-- AUDITORÍA
-- =====================================================================

CREATE TABLE registros_auditoria (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID,
  user_name   TEXT,
  user_role   TEXT,
  action      accion_auditoria NOT NULL,
  module      modulo_auditoria NOT NULL,
  entity_id   TEXT,
  old_values  JSONB,
  new_values  JSONB,
  details     TEXT,
  ip_address  TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_tenant_ts ON registros_auditoria (tenant_id, "timestamp" DESC);
CREATE INDEX idx_auditoria_modulo    ON registros_auditoria (tenant_id, module);
