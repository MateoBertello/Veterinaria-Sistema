-- =====================================================================
-- MIGRACIÓN: los catálogos clínicos pasan a ser POR TENANT
-- =====================================================================
-- Decisión de producto: `especies`, `razas` y `tipos_vacuna` dejan de ser
-- catálogos globales compartidos y pasan a ser de cada clínica. Una veterinaria
-- de exóticos y una de pequeños animales no comparten ni la lista de especies
-- ni la de vacunas, y hasta hoy solo el Super Admin podía tocarlas.
--
-- `permisos` NO entra en el cambio: lo referencia `rol_permiso` y lo define el
-- sistema, no la clínica. Sigue siendo global.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Borra las filas globales de semilla (guardadas por una guarda previa:
--      aborta si alguien ya las está referenciando).
--   2. Agrega `tenant_id NOT NULL` a las tres tablas, con sus índices.
--   3. Mueve las UNIQUE globales a UNIQUE por tenant.
--   4. INTEGRIDAD CROSS-TENANT vía FK compuestas (ver abajo).
--   5. Reemplaza las políticas RLS: de "cualquier autenticado lee todo" a
--      aislamiento por tenant, como cualquier tabla de negocio.
--   6. Mueve el catálogo semilla de `20260614000004_seed_global.sql` a una
--      función por tenant, la engancha en `on_tenant_created` y la aplica a los
--      tenants que ya existen.
--   7. Agrega el permiso `manage_catalogs` (sin consumidor todavía: el CRUD y
--      las pantallas van en el PR siguiente).
--
-- POR QUÉ MIGRACIÓN NUEVA Y NO EDITAR EL DDL BASE
--   Se evaluó squashear `tables.sql` / `rls.sql` / `seed_global.sql` y hacer un
--   `db reset` —tentador porque la base todavía no tiene datos de negocio— y se
--   descartó: el Supabase de integración es remoto y compartido, resetearlo
--   exige coordinar con todos, y la regla del CLAUDE.md ("nunca editar
--   migraciones ya aplicadas; crear una nueva") existe justamente para eso. Con
--   la base vacía el trabajo hacia adelante es prácticamente el mismo.
--
-- LA PARTE QUE NO SE ABARATA POR TENER LA BASE VACÍA
--   Una FK simple a `especies(id)` no impide NUNCA que una mascota del tenant A
--   apunte a una especie del tenant B — haya datos o no. Se aplica el mismo
--   patrón que `20260725000005_usuarios_integridad_referencial.sql` usó para
--   `usuarios → roles`: UNIQUE (id, tenant_id) del lado referenciado, se dropea
--   la FK simple y se pone la compuesta sobre (fk_id, tenant_id). El Service
--   puede validar el tenant del catálogo, pero la regla pertenece a la base:
--   es exactamente lo que una FK compuesta expresa.
-- =====================================================================

-- ─── Guardas previas ─────────────────────────────────────────────────────
-- Convertir un catálogo compartido en catálogos por tenant significa que las
-- filas globales dejan de existir y cada clínica recibe SU copia (con ids
-- nuevos). Cualquier fila de negocio que hoy apunte a una de esas filas
-- globales quedaría huérfana o —peor— re-apuntada a la copia equivocada. La
-- migración de datos que eso exigiría (copiar el catálogo por tenant y
-- re-apuntar cada FK a la copia de SU tenant) NO está acá: se confirmó que la
-- base no tiene datos de negocio. Si eso dejara de ser cierto, esta guarda
-- frena la migración en vez de romper datos en silencio.
DO $$
DECLARE
  v_mascotas INT;
  v_dosis    INT;
BEGIN
  SELECT count(*) INTO v_mascotas FROM mascotas;
  SELECT count(*) INTO v_dosis    FROM plan_vacunacion;

  IF v_mascotas > 0 OR v_dosis > 0 THEN
    RAISE EXCEPTION
      'Hay datos de negocio referenciando los catálogos globales (mascotas=%, plan_vacunacion=%). Esta migración asume la base VACÍA de negocio: borra el catálogo global y lo recrea por tenant, así que esas filas quedarían apuntando a ids inexistentes. Antes de aplicarla hace falta una migración de datos que copie el catálogo por tenant y re-apunte cada FK a la copia de su propio tenant.',
      v_mascotas, v_dosis;
  END IF;
END $$;

-- ─── 1. Las filas globales se van ────────────────────────────────────────
-- En este orden por claridad; `razas.especie_id` es ON DELETE CASCADE, así que
-- borrar especies bastaría. Explícito sobrevive mejor al próximo refactor.
DELETE FROM razas;
DELETE FROM especies;
DELETE FROM tipos_vacuna;

-- ─── 2. tenant_id ────────────────────────────────────────────────────────
-- Sin filas, la columna entra NOT NULL de una: no hace falta el baile de
-- nullable → poblar → constraint.
ALTER TABLE especies
  ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE razas
  ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tipos_vacuna
  ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_especies_tenant     ON especies     (tenant_id);
CREATE INDEX idx_razas_tenant        ON razas        (tenant_id);
CREATE INDEX idx_tipos_vacuna_tenant ON tipos_vacuna (tenant_id);

-- ─── 3. La unicidad pasa a ser por tenant ────────────────────────────────
-- Dos clínicas distintas pueden tener ambas la especie "Perro"; lo que no puede
-- haber es dos "Perro" en la MISMA clínica.
ALTER TABLE especies     DROP CONSTRAINT IF EXISTS especies_name_key;
ALTER TABLE especies     ADD  CONSTRAINT especies_tenant_name_key UNIQUE (tenant_id, name);

ALTER TABLE tipos_vacuna DROP CONSTRAINT IF EXISTS tipos_vacuna_nombre_key;
ALTER TABLE tipos_vacuna ADD  CONSTRAINT tipos_vacuna_tenant_nombre_key UNIQUE (tenant_id, nombre);

-- `razas` no necesita cambio: su UNIQUE (especie_id, name) ya queda bien porque
-- `especie_id` pasa a ser del tenant.

-- ─── 4. INTEGRIDAD CROSS-TENANT (FK compuestas) ──────────────────────────
-- Paso 4.1: la UNIQUE que respalda la FK compuesta del lado referenciado.
-- `id` ya es PK en las tres, así que el par (id, tenant_id) es único por
-- construcción; la constraint existe para que la FK pueda apoyarse en ella.
ALTER TABLE especies     ADD CONSTRAINT especies_id_tenant_key     UNIQUE (id, tenant_id);
ALTER TABLE razas        ADD CONSTRAINT razas_id_tenant_key        UNIQUE (id, tenant_id);
ALTER TABLE tipos_vacuna ADD CONSTRAINT tipos_vacuna_id_tenant_key UNIQUE (id, tenant_id);

-- Paso 4.2: se dropean las FK simples y entran las compuestas.

-- Una raza pertenece a una especie DEL MISMO TENANT.
ALTER TABLE razas DROP CONSTRAINT IF EXISTS razas_especie_id_fkey;
ALTER TABLE razas
  ADD CONSTRAINT razas_especie_tenant_fkey
  FOREIGN KEY (especie_id, tenant_id) REFERENCES especies(id, tenant_id) ON DELETE CASCADE;

-- Una mascota apunta a una especie DE SU PROPIO TENANT.
ALTER TABLE mascotas DROP CONSTRAINT IF EXISTS mascotas_especie_id_fkey;
ALTER TABLE mascotas
  ADD CONSTRAINT mascotas_especie_tenant_fkey
  FOREIGN KEY (especie_id, tenant_id) REFERENCES especies(id, tenant_id) ON DELETE RESTRICT;

-- Ídem la raza. `ON DELETE SET NULL (raza_id)` con lista de columnas explícita
-- (PostgreSQL 15+): sin la lista, el SET NULL alcanzaría también a `tenant_id`,
-- que es NOT NULL, y el borrado de una raza fallaría siempre.
-- `raza_id` es nullable y la FK es MATCH SIMPLE: cuando no hay raza informada,
-- la constraint se da por satisfecha, que es lo que se busca.
ALTER TABLE mascotas DROP CONSTRAINT IF EXISTS mascotas_raza_id_fkey;
ALTER TABLE mascotas
  ADD CONSTRAINT mascotas_raza_tenant_fkey
  FOREIGN KEY (raza_id, tenant_id) REFERENCES razas(id, tenant_id) ON DELETE SET NULL (raza_id);

-- Una dosis programada apunta a un tipo de vacuna DE SU PROPIO TENANT.
ALTER TABLE plan_vacunacion DROP CONSTRAINT IF EXISTS plan_vacunacion_tipo_vacuna_id_fkey;
ALTER TABLE plan_vacunacion
  ADD CONSTRAINT plan_vacunacion_tipo_vacuna_tenant_fkey
  FOREIGN KEY (tipo_vacuna_id, tenant_id) REFERENCES tipos_vacuna(id, tenant_id) ON DELETE RESTRICT;

-- Paso 4.3: índices del lado de la FK. Sin ellos, cada borrado o actualización
-- del lado referenciado (RESTRICT / SET NULL / CASCADE) hace un scan de la
-- tabla referenciante para buscar filas que la apunten.
CREATE INDEX IF NOT EXISTS idx_razas_especie_tenant  ON razas           (especie_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_especie      ON mascotas        (especie_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_raza         ON mascotas        (raza_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_planvac_tipo          ON plan_vacunacion (tipo_vacuna_id, tenant_id);

-- ─── 5. RLS: de "cualquier autenticado" a aislamiento por tenant ─────────
-- Antes (20260614000003_rls.sql:41-59): SELECT para cualquier autenticado +
-- políticas FOR ALL de is_super_admin(). El hardening de
-- 20260725000003 excluyó estas tres tablas a propósito, porque eran catálogos
-- globales de solo lectura. Ya no lo son.
--
-- La lectura por PostgREST directo desde el frontend (excepción documentada en
-- CLAUDE.md) SIGUE VALIENDO: lo que cambia es que ahora queda aislada por
-- tenant en vez de abierta a cualquier autenticado. Misma forma que las tablas
-- sin gate de permiso del hardening (`servicios`, `doctores`): tenant + usuario
-- activo. Sin gate de permiso porque el catálogo lo consulta cualquiera que dé
-- de alta una mascota o programe una dosis, no solo quien lo administra.
--
-- Las políticas de escritura NO se recrean, igual que en el resto de las tablas
-- de negocio: `authenticated` ya perdió INSERT/UPDATE/DELETE con el REVOKE del
-- hardening, y las escrituras entran por la Edge Function con `service_role`.
DROP POLICY IF EXISTS p_especies_read      ON especies;
DROP POLICY IF EXISTS p_razas_read         ON razas;
DROP POLICY IF EXISTS p_tipos_vacuna_read  ON tipos_vacuna;
DROP POLICY IF EXISTS p_especies_admin     ON especies;
DROP POLICY IF EXISTS p_razas_admin        ON razas;
DROP POLICY IF EXISTS p_tipos_vacuna_admin ON tipos_vacuna;

CREATE POLICY p_especies_lectura ON especies FOR SELECT
  USING (tenant_id = current_tenant_id() AND usuario_activo());
CREATE POLICY p_razas_lectura ON razas FOR SELECT
  USING (tenant_id = current_tenant_id() AND usuario_activo());
CREATE POLICY p_tipos_vacuna_lectura ON tipos_vacuna FOR SELECT
  USING (tenant_id = current_tenant_id() AND usuario_activo());

-- ─── 6. El catálogo semilla se crea POR TENANT ───────────────────────────
-- Reemplaza a las filas globales de `20260614000004_seed_global.sql`, que queda
-- solo con `permisos`. Sin esto, la primera mascota de una clínica nueva no se
-- puede dar de alta: no habría ninguna especie para elegir.
--
-- Es una función y no SQL inline dentro de `on_tenant_created` porque la llaman
-- dos caminos: el alta de un tenant nuevo y el backfill de los ya existentes,
-- unas líneas más abajo. Idempotente (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.seed_catalogos_tenant(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO especies (tenant_id, name, description) VALUES
    (p_tenant_id, 'Perro',   'Canino doméstico'),
    (p_tenant_id, 'Gato',    'Felino doméstico'),
    (p_tenant_id, 'Ave',     'Aves de compañía'),
    (p_tenant_id, 'Conejo',  'Lagomorfo doméstico'),
    (p_tenant_id, 'Roedor',  'Hámster, cobayo, etc.'),
    (p_tenant_id, 'Reptil',  'Tortugas, iguanas, etc.'),
    (p_tenant_id, 'Otro',    'Otras especies')
  ON CONFLICT (tenant_id, name) DO NOTHING;

  INSERT INTO razas (tenant_id, especie_id, name)
  SELECT p_tenant_id, e.id, r.name
  FROM especies e
  JOIN (VALUES
    ('Perro',  'Mestizo'),
    ('Perro',  'Labrador Retriever'),
    ('Perro',  'Caniche'),
    ('Perro',  'Bulldog Francés'),
    ('Perro',  'Ovejero Alemán'),
    ('Perro',  'Golden Retriever'),
    ('Gato',   'Mestizo'),
    ('Gato',   'Siamés'),
    ('Gato',   'Persa'),
    ('Gato',   'Maine Coon'),
    ('Ave',    'Canario'),
    ('Ave',    'Loro'),
    ('Conejo', 'Enano Holandés'),
    ('Roedor', 'Hámster Sirio')
  ) AS r(especie, name) ON r.especie = e.name
  WHERE e.tenant_id = p_tenant_id
  ON CONFLICT (especie_id, name) DO NOTHING;

  INSERT INTO tipos_vacuna (tenant_id, nombre, especie_aplicable, meses_refuerzo_sugerido) VALUES
    (p_tenant_id, 'Antirrábica',                       NULL,     12),
    (p_tenant_id, 'Quíntuple Canina',                  'Perro',  12),
    (p_tenant_id, 'Séxtuple Canina',                   'Perro',  12),
    (p_tenant_id, 'Bordetella (Tos de las perreras)',  'Perro',  12),
    (p_tenant_id, 'Giardia',                           'Perro',  12),
    (p_tenant_id, 'Triple Felina',                     'Gato',   12),
    (p_tenant_id, 'Leucemia Felina',                   'Gato',   12),
    (p_tenant_id, 'Mixomatosis',                       'Conejo',  6)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_catalogos_tenant(UUID) IS
  'Crea el catálogo clínico semilla (especies, razas, tipos de vacuna) de un tenant. Idempotente. La llaman on_tenant_created y el backfill de tenants existentes.';

-- Mismo endurecimiento que el resto de las SECURITY DEFINER que reciben
-- p_tenant_id por parámetro (20260710000001): sin este REVOKE quedaría
-- ejecutable por `anon`/`authenticated` vía POST /rest/v1/rpc, es decir,
-- sembrable sobre cualquier tenant sin pasar por la Edge Function.
REVOKE ALL ON FUNCTION public.seed_catalogos_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_catalogos_tenant(UUID) TO service_role;

-- ─── 7. El seeder de Nivel 2 crea el catálogo del tenant nuevo ───────────
-- Igual a la versión vigente (20260725000001_permiso_clientes_veterinario.sql)
-- salvo: `manage_catalogs` en veterinario y recepcionista, y el paso 7 que
-- siembra el catálogo. CREATE OR REPLACE conserva el ACL acotado por
-- 20260710000001 (REVOKE de PUBLIC + GRANT a service_role).
CREATE OR REPLACE FUNCTION public.on_tenant_created(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol_admin UUID;
  v_rol_vet   UUID;
  v_rol_recep UUID;
  v_plan      plan_tenant;
BEGIN
  -- 1. Crear los tres roles del sistema
  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'admin', 'Administrador', 'Acceso total a la clínica', true)
  RETURNING id INTO v_rol_admin;

  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'veterinario', 'Veterinario', 'Gestión clínica y de pacientes', true)
  RETURNING id INTO v_rol_vet;

  INSERT INTO roles (tenant_id, name, display_name, description, is_system)
  VALUES (p_tenant_id, 'recepcionista', 'Recepcionista', 'Gestión de clientes, turnos y guardería', true)
  RETURNING id INTO v_rol_recep;

  -- 2. Admin: todos los permisos del sistema
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_admin, p.id FROM permisos p;

  -- 3. Veterinario: permisos clínicos, de agenda y de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_vet, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_medical_history',
    'manage_appointments',
    'manage_schedules',
    'manage_catalogs'
  );

  -- 4. Recepcionista: permisos de atención al cliente
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT v_rol_recep, p.id FROM permisos p
  WHERE p.name IN (
    'manage_clients',
    'manage_pets',
    'view_medical_history',
    'manage_appointments',
    'manage_daycare',
    'manage_catalogs'
  );

  -- 5. Configuración default del tenant (cupo 10, aviso 7 días)
  INSERT INTO configuracion_tenant (tenant_id, cupo_maximo_diario, dias_aviso_vacuna)
  VALUES (p_tenant_id, 10, 7);

  -- 6. Módulos según plan
  SELECT plan INTO v_plan FROM tenants WHERE id = p_tenant_id;

  INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta) VALUES
    (p_tenant_id, 'historial_clinico',
      true,
      CURRENT_DATE),
    (p_tenant_id, 'turnos',
      v_plan IN ('profesional', 'premium'),
      CASE WHEN v_plan IN ('profesional', 'premium') THEN CURRENT_DATE END),
    (p_tenant_id, 'guarderia',
      v_plan = 'premium',
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END);

  -- 7. Catálogo clínico semilla de la clínica (especies, razas, tipos de vacuna).
  -- Sin esto, la clínica nace sin ninguna especie y no puede dar de alta su
  -- primera mascota.
  PERFORM public.seed_catalogos_tenant(p_tenant_id);
END;
$$;

-- ─── 8. Permiso `manage_catalogs` ────────────────────────────────────────
-- Permiso NUEVO en vez de reusar `manage_tenant_settings`: cargar una raza o un
-- tipo de vacuna es tarea corriente de recepción o de un veterinario, mientras
-- que tocar la configuración de la clínica (cupos de guardería, días de aviso)
-- es cosa del Administrador. Meter las dos cosas bajo el mismo permiso obligaría
-- a elegir entre que nadie más cargue razas o que medio equipo pueda cambiar los
-- cupos.
--
-- Criterio de reparto elegido: admin (por regla general, recibe todos),
-- veterinario y recepcionista. Los tres roles del sistema, entonces — porque el
-- catálogo es insumo del trabajo diario de los tres y bloquearlo detrás del
-- Administrador convertiría "falta esta raza" en un pedido a otra persona.
--
-- Todavía no lo consume ningún endpoint: el CRUD y las pantallas van en el PR
-- siguiente. Entra acá porque el seeder de roles y el reparto a los tenants ya
-- existentes se tocan en esta misma migración; hacerlo después sería una segunda
-- migración de datos por lo mismo.
INSERT INTO permisos (name, display_name, module) VALUES
  ('manage_catalogs', 'Gestionar catálogos clínicos', 'catalogs')
ON CONFLICT (name) DO NOTHING;

-- Tenants ya existentes: se lo otorga a los tres roles del sistema.
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.name IN ('admin', 'veterinario', 'recepcionista')
  AND p.name = 'manage_catalogs'
ON CONFLICT DO NOTHING;

-- ─── 9. Backfill: los tenants que ya existen reciben su catálogo ─────────
-- El seeder del paso 7 solo corre en altas nuevas. Sin este backfill, toda
-- clínica creada antes de esta migración se quedaría sin especies y sin poder
-- registrar una mascota.
DO $$
DECLARE
  t UUID;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM public.seed_catalogos_tenant(t);
  END LOOP;
END $$;
