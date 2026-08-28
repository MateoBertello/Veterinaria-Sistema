-- =====================================================================
-- MIGRACIÓN: qué vacuna aplica a qué especie deja de ser texto libre
-- =====================================================================
-- PROBLEMA QUE CIERRA
--
-- `tipos_vacuna.especie_aplicable` era TEXT libre ('Perro', 'Gato', NULL).
-- Nada lo ataba al catálogo de especies, así que el "filtro por especie" era
-- un match de cadenas: se rompía con un typo, con un cambio de nombre de la
-- especie y —desde que los catálogos son por tenant
-- (20260827000001_catalogos_por_tenant.sql)— con cada clínica escribiendo el
-- nombre a su manera. En la práctica nadie lo usaba: el frontend pedía el
-- catálogo entero, así que al programar una dosis para un perro el combo
-- ofrecía las vacunas de gato, y el backend (RN-PV3) sólo verificaba que el
-- tipo existiera y estuviera activo. Una dosis felina para un canino entraba
-- sin resistencia y terminaba en el historial clínico como evento 'Vacunación'.
--
-- MODELO: N:M ENTRE ESPECIE Y TIPO DE VACUNA
--
-- La asociación es especie ↔ tipo de vacuna, muchos a muchos, con `tenant_id`.
-- Una vacuna aplica a varias especies (la antirrábica, a todos los mamíferos)
-- y una especie recibe varias vacunas (el calendario sanitario del perro).
--
-- POR QUÉ NO A NIVEL RAZA — Y DÓNDE SE ENGANCHARÍA SI ALGÚN DÍA HACE FALTA
--
-- Las vacunas del calendario sanitario son POR ESPECIE: un labrador y un
-- caniche reciben el mismo esquema. Atarlas a la raza obligaría a repetir las
-- mismas cinco vacunas en cada raza de perro y a mantenerlas sincronizadas a
-- mano para siempre.
--
-- La AUSENCIA de una tabla `raza_tipo_vacuna` es deliberada, no un olvido. Si
-- algún día aparece una vacuna que depende de la raza por predisposición, se
-- suma ENTONCES como una segunda tabla ADITIVA, sin tocar ni migrar ésta: el
-- punto de extensión es el único lugar donde hoy se calculan las vacunas
-- aplicables a una mascota —`VacunacionService.tiposVacunaAplicables()` y la
-- guarda RN-PV11 de `programarDosis()`, ambas en `vacunacion.service.ts`—,
-- donde la unión especie ∪ raza se resolvería en la misma consulta. Diferirla
-- no cuesta nada; construirla ahora son una tabla, una pantalla y un juego de
-- tests que nadie pidió.
--
-- SEMÁNTICA DEL CONJUNTO VACÍO
--
-- Un tipo de vacuna SIN especies asociadas no aplica a ninguna. Es la lectura
-- estricta a propósito: `especie_aplicable IS NULL` significaba a la vez
-- "universal" y "nadie la completó", y esa ambigüedad es justamente la que
-- dejaba pasar dosis equivocadas. La API exige al menos una especie al crear y
-- al reasociar (RN-CAT10), así que el conjunto vacío no es alcanzable por el
-- camino normal; la lectura estricta es la defensa para una fila que llegara
-- ahí por otra vía.
--
-- LA COLUMNA VIEJA SE VA, NO SE DEPRECA
--
-- `especie_aplicable` se DROPEA. La base no tiene dosis ni strings que migrar
-- (misma guarda que la migración anterior), y dejar un campo muerto "por las
-- dudas" es exactamente cómo se llega a dos fuentes de verdad discrepando.
-- =====================================================================

-- ─── Guarda previa ───────────────────────────────────────────────────────
-- Misma guarda que 20260827000001: esta migración asume la base VACÍA de
-- negocio. Si hubiera dosis registradas, dropear `especie_aplicable` y exigir
-- la relación nueva podría dejar dosis históricas apuntando a una vacuna que
-- el modelo nuevo considera inaplicable a su especie. No se romperían (la
-- regla valida al PROGRAMAR, no al leer), pero la semilla de asociaciones de
-- abajo no cubriría los tipos de vacuna que la clínica hubiera cargado a mano.
DO $$
DECLARE
  v_dosis INT;
BEGIN
  SELECT count(*) INTO v_dosis FROM plan_vacunacion;

  IF v_dosis > 0 THEN
    RAISE EXCEPTION
      'Hay % dosis en plan_vacunacion. Esta migración asume la base VACÍA de negocio: antes de aplicarla hace falta decidir, tipo de vacuna por tipo de vacuna, a qué especies se asocia (la columna especie_aplicable que se dropea acá es texto libre y no se puede mapear sola).',
      v_dosis;
  END IF;
END $$;

-- ─── 1. La tabla de asociación ───────────────────────────────────────────
-- PK compuesta y sin id surrogado, igual que `rol_permiso`: la fila ES la
-- relación, no tiene identidad propia ni nadie la referencia.
--
-- `tenant_id` participa de las DOS FKs compuestas. Ése es el punto: una fila
-- sólo puede unir una especie y una vacuna que compartan tenant, porque las
-- dos constraints leen la MISMA columna `tenant_id`. Asociar la especie de una
-- clínica con la vacuna de otra es irrepresentable, no "algo que el Service se
-- acuerda de validar".
CREATE TABLE especie_tipo_vacuna (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  especie_id      UUID NOT NULL,
  tipo_vacuna_id  UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, especie_id, tipo_vacuna_id),

  CONSTRAINT especie_tipo_vacuna_especie_fkey
    FOREIGN KEY (especie_id, tenant_id)
    REFERENCES especies (id, tenant_id) ON DELETE CASCADE,

  CONSTRAINT especie_tipo_vacuna_tipo_fkey
    FOREIGN KEY (tipo_vacuna_id, tenant_id)
    REFERENCES tipos_vacuna (id, tenant_id) ON DELETE CASCADE
);

COMMENT ON TABLE especie_tipo_vacuna IS
  'Qué tipos de vacuna aplican a qué especies, por tenant (RN-CAT10). Reemplaza al TEXT libre tipos_vacuna.especie_aplicable. Deliberadamente NO hay equivalente a nivel raza: ver el comentario de 20260828000001_vacunas_por_especie.sql.';

-- Índices del lado de la FK, uno por cada una. Sin ellos, cada borrado del
-- lado referenciado (las dos son ON DELETE CASCADE) hace un scan de esta tabla
-- buscando filas que lo apunten. El de especie NO es redundante con la PK: la
-- PK arranca por `tenant_id`, y la verificación de la FK busca por el par en el
-- orden (especie_id, tenant_id).
CREATE INDEX idx_esp_tv_especie ON especie_tipo_vacuna (especie_id, tenant_id);
CREATE INDEX idx_esp_tv_tipo    ON especie_tipo_vacuna (tipo_vacuna_id, tenant_id);

-- ─── 2. RLS ──────────────────────────────────────────────────────────────
-- `authenticated` conserva SELECT a nivel tabla por los grants heredados
-- (20260622000001 + los REVOKE de 20260706000001 / 20260725000003 sobre las
-- tablas futuras), así que sin RLS habilitada cualquier usuario logueado
-- leería las asociaciones de todas las clínicas. Con RLS, sólo las suyas.
--
-- La aplicación NO depende de esta política: las vacunas aplicables se piden
-- por la API (`GET /mascotas/:petId/tipos-vacuna-aplicables`), que resuelve
-- con service role. La política existe por consistencia con las tres tablas de
-- catálogo hermanas y para que la tabla no quede abierta si mañana alguien la
-- lee por PostgREST directo.
ALTER TABLE especie_tipo_vacuna ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_especie_tipo_vacuna_lectura ON especie_tipo_vacuna FOR SELECT
  USING (tenant_id = current_tenant_id() AND usuario_activo());

-- ─── 3. El catálogo semilla siembra también la relación ──────────────────
-- Sin esto, una clínica nueva nacería con sus ocho vacunas y una tabla de
-- asociación vacía: es decir, con CERO vacunas aplicables a ninguna mascota, y
-- el combo de programar dosis vacío desde el día uno.
--
-- Idéntica a la versión de 20260827000001 salvo por dos cosas: el INSERT de
-- `tipos_vacuna` pierde `especie_aplicable` (que se dropea más abajo) y se
-- suma el bloque de asociaciones. Sigue siendo idempotente (ON CONFLICT DO
-- NOTHING en los tres INSERT), que es lo que permite reusarla como backfill.
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

  INSERT INTO tipos_vacuna (tenant_id, nombre, meses_refuerzo_sugerido) VALUES
    (p_tenant_id, 'Antirrábica',                      12),
    (p_tenant_id, 'Quíntuple Canina',                 12),
    (p_tenant_id, 'Séxtuple Canina',                  12),
    (p_tenant_id, 'Bordetella (Tos de las perreras)', 12),
    (p_tenant_id, 'Giardia',                          12),
    (p_tenant_id, 'Triple Felina',                    12),
    (p_tenant_id, 'Leucemia Felina',                  12),
    (p_tenant_id, 'Mixomatosis',                       6)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  -- El calendario sanitario de la clínica nueva, ya armado. La antirrábica va
  -- a los mamíferos de la lista (no a aves ni reptiles): "todas las especies"
  -- dejó de existir como valor, así que se enumera lo que corresponde.
  INSERT INTO especie_tipo_vacuna (tenant_id, especie_id, tipo_vacuna_id)
  SELECT p_tenant_id, e.id, tv.id
  FROM (VALUES
    ('Perro',  'Antirrábica'),
    ('Gato',   'Antirrábica'),
    ('Conejo', 'Antirrábica'),
    ('Roedor', 'Antirrábica'),
    ('Perro',  'Quíntuple Canina'),
    ('Perro',  'Séxtuple Canina'),
    ('Perro',  'Bordetella (Tos de las perreras)'),
    ('Perro',  'Giardia'),
    ('Gato',   'Triple Felina'),
    ('Gato',   'Leucemia Felina'),
    ('Conejo', 'Mixomatosis')
  ) AS rel(especie, vacuna)
  JOIN especies     e  ON e.name    = rel.especie AND e.tenant_id  = p_tenant_id
  JOIN tipos_vacuna tv ON tv.nombre = rel.vacuna  AND tv.tenant_id = p_tenant_id
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_catalogos_tenant(UUID) IS
  'Crea el catálogo clínico semilla de un tenant (especies, razas, tipos de vacuna) y las asociaciones especie↔vacuna que arman su calendario sanitario. Idempotente. La llaman on_tenant_created y el backfill de tenants existentes.';

-- El ACL acotado de 20260710000001 lo conserva CREATE OR REPLACE; se reafirma
-- por si esta migración corriera sobre una base donde la función no existía.
REVOKE ALL ON FUNCTION public.seed_catalogos_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_catalogos_tenant(UUID) TO service_role;

-- ─── 4. Backfill de los tenants que ya existen ───────────────────────────
-- Los tipos de vacuna ya están (los sembró 20260827000001); lo que falta son
-- sus asociaciones. Re-ejecutar la función alcanza: los tres primeros INSERT
-- no hacen nada y el cuarto crea la relación. No se intenta derivar nada del
-- `especie_aplicable` viejo — la guarda de arriba garantiza que no hay dosis, y
-- el CRUD que permitía cargar ese texto a mano todavía no está desplegado, así
-- que los únicos tipos de vacuna existentes son los ocho de la semilla.
DO $$
DECLARE
  t UUID;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM public.seed_catalogos_tenant(t);
  END LOOP;
END $$;

-- ─── 5. `especie_aplicable` se va ────────────────────────────────────────
-- Después del backfill: hasta acá la columna todavía existía por si el bloque
-- anterior hubiera querido leerla.
ALTER TABLE tipos_vacuna DROP COLUMN especie_aplicable;

-- Que PostgREST relea el esquema: tabla nueva, relaciones nuevas y una columna
-- menos. Sin esto, los embeds de `especie_tipo_vacuna` fallan con PGRST200 en
-- la primera llamada y el `select` de `tipos_vacuna` sigue prometiendo una
-- columna que ya no está.
NOTIFY pgrst, 'reload schema';
