-- =====================================================================
-- MIGRACIÓN: UNIQUE (tenant_id, user_id) en doctores  [Etapa 9 — DT-1]
-- RN-SEC5: el perfil profesional es una extensión 1:1 del usuario que
-- atiende; el alta automática en usuarios.service pasa de INSERT a
-- UPSERT (onConflict tenant_id,user_id) apoyándose en este constraint.
--
-- Se usa un UNIQUE **constraint** plano y NO un índice parcial
-- (WHERE user_id IS NOT NULL) a propósito:
--   * Postgres trata los NULL como distintos en índices únicos, así que
--     los doctores sin usuario vinculado (user_id NULL, válidos para
--     Turnos/Horarios) no entran en conflicto entre sí.
--   * PostgREST resuelve `on_conflict=tenant_id,user_id` generando
--     `ON CONFLICT (tenant_id, user_id)` sin predicado, que NO matchea
--     índices parciales ("no unique or exclusion constraint matching").
-- =====================================================================

-- 1. Limpieza defensiva de duplicados preexistentes (el bug DT-1: editar
--    un usuario re-asignándole rol veterinario insertaba otra fila).
--    Se conserva la fila más antigua por (tenant_id, user_id) y se
--    repuntan las únicas dos FKs que referencian doctores(id):
--    horarios_doctor.doctor_id y turnos.doctor_id.
--    Si dos duplicados tuvieran turnos activos solapados, el EXCLUDE de
--    turnos hará fallar la migración a propósito: eso requiere decisión
--    manual, no un merge silencioso.
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT
      d.tenant_id,
      d.user_id,
      (array_agg(d.id ORDER BY d.created_at, d.id))[1] AS keeper_id,
      array_agg(d.id ORDER BY d.created_at, d.id)      AS all_ids
    FROM doctores d
    WHERE d.user_id IS NOT NULL
    GROUP BY d.tenant_id, d.user_id
    HAVING count(*) > 1
  LOOP
    UPDATE horarios_doctor
      SET doctor_id = dup.keeper_id
      WHERE doctor_id = ANY (dup.all_ids) AND doctor_id <> dup.keeper_id;

    UPDATE turnos
      SET doctor_id = dup.keeper_id
      WHERE doctor_id = ANY (dup.all_ids) AND doctor_id <> dup.keeper_id;

    DELETE FROM doctores
      WHERE id = ANY (dup.all_ids) AND id <> dup.keeper_id;
  END LOOP;
END $$;

-- 2. El constraint que hace imposible volver a duplicar.
ALTER TABLE doctores
  ADD CONSTRAINT doctores_tenant_user_unique UNIQUE (tenant_id, user_id);

-- 3. PostgREST cachea los constraints y `on_conflict` los necesita en el
--    schema cache (gotcha conocido del proyecto).
NOTIFY pgrst, 'reload schema';
