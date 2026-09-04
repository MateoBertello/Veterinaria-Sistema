-- @modulo: comercial
-- =====================================================================
-- CORRECCIÓN 2.6 (auditoría final del Módulo Comercial)
-- El libro mayor se va con la clínica: la única excepción a la inmutabilidad
-- =====================================================================
--
-- EL CONFLICTO QUE RESUELVE
--
-- El módulo tiene DOS libros mayores con el mismo patrón —`movimientos_stock`
-- (20260908000001) y `movimientos_caja` (20260915000001)— y los dos arrastran
-- el mismo conflicto. La auditoría nombró solo el primero; el segundo apareció
-- al probar la corrección y se corrige igual, porque es el mismo bug.
--
-- Cada una de esas migraciones declara dos cosas incompatibles sobre su tabla:
--
--   * `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
--     — el libro mayor se va con la clínica.
--   * `CREATE TRIGGER trg_movimientos_stock_inmutable BEFORE UPDATE OR DELETE
--     ... RAISE EXCEPTION 'MOVEMENT_IMMUTABLE'` — ninguna fila sale nunca.
--
-- La segunda gana siempre, así que el `ON DELETE CASCADE` era código muerto:
-- nunca pudo ejecutarse. La consecuencia no es cosmética — un tenant con UN
-- movimiento de stock no se podía dar de baja jamás, ni en producción ni en los
-- tests. Es la causa de los 168 tenants residuales que encontró la auditoría:
-- cada corrida de las suites de integración dejaba su clínica de prueba
-- enterrada para siempre, y con ella una cuenta de Auth huérfana que rompía la
-- corrida siguiente por email duplicado.
--
-- QUÉ CAMBIA, Y QUÉ NO
--
-- El trigger SIGUE ACTIVO y sigue corriendo en cada fila. Lo único que se le
-- agrega es la excepción que la propia FK ya declaraba: si la clínica dueña del
-- asiento ya no existe, el asiento se va con ella.
--
-- Lo que NO se abre:
--   * `UPDATE` sigue prohibido, siempre, sin excepción.
--   * Un `DELETE` con la clínica viva sigue dando MOVEMENT_IMMUTABLE — que es
--     el 100% de lo que puede intentar un Service, un RPC o un JWT robado.
--     Ningún camino de la aplicación borra tenants.
--   * No hay borrado por fila, por operación ni por lote. La única llave es la
--     baja de la clínica entera, que es una operación de plataforma.
--
-- Decidido con el dueño del producto al aparecer el conflicto (la spec dice las
-- dos cosas y había que elegir una). Ver §4.4 en ADENDA_SPEC_COMERCIAL.md.

CREATE OR REPLACE FUNCTION public.movimientos_stock_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Única excepción: la cascada de la baja del tenant. Cuando el DELETE llega
  -- acá por `movimientos_stock_tenant_id_fkey ON DELETE CASCADE`, la fila de
  -- `tenants` ya fue borrada en la misma sentencia y no es visible. Con la
  -- clínica viva —o sea, en cualquier camino de la aplicación— esta condición
  -- es falsa y se levanta la excepción de siempre.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

COMMENT ON FUNCTION public.movimientos_stock_inmutable() IS
  'Inmutabilidad del libro mayor (D-02). UPDATE: prohibido siempre. DELETE: prohibido siempre, salvo la cascada de la baja del tenant — la que `movimientos_stock_tenant_id_fkey ON DELETE CASCADE` ya declaraba y el trigger volvía inejecutable. Con la clínica viva no hay ninguna vía de borrado.';

-- Mismo tratamiento para el libro mayor de caja.
CREATE OR REPLACE FUNCTION public.movimientos_caja_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'MOVEMENT_IMMUTABLE';
END;
$$;

COMMENT ON FUNCTION public.movimientos_caja_inmutable() IS
  'Inmutabilidad del libro mayor de caja. Mismo contrato que movimientos_stock_inmutable(): UPDATE prohibido siempre, DELETE solo por la cascada de la baja del tenant.';

-- ─── Baja de una clínica ─────────────────────────────────────────────────────
--
-- No se puede borrar tabla por tabla desde afuera ni delegar todo en la cascada:
--
--   * Los dos libros mayores SOLO pueden irse en la cascada del DELETE de
--     `tenants` (es la excepción de arriba), y referencian con RESTRICT casi
--     todo el resto del módulo — lotes, productos, ventas_items, compras_items,
--     recuentos, historial_clinico, plan_vacunacion, mascotas, sesiones_caja,
--     compras. Nada de eso puede salir antes que ellos.
--   * Y la cascada sola tampoco alcanza: PostgreSQL dispara las acciones
--     referenciales de `tenants` en el orden en que se crearon las constraints,
--     o sea en orden de MIGRACIÓN. `servicios` es de la Etapa 4 y `turnos` de la
--     Etapa 6, así que la cascada libera `servicios` primero y
--     `turnos_servicio_id_fkey` (RESTRICT, que se chequea de inmediato) aborta
--     el DELETE entero. Verificado: ése es el error que aparece.
--
-- De ahí las dos fases. La primera es un punto fijo: intenta borrar cada tabla
-- con `tenant_id` y, si alguna FK o el trigger de inmutabilidad la frenan, la
-- deja para la pasada siguiente; repite mientras haya progreso. Eso resuelve
-- solo el orden hijo → padre, sin lista escrita a mano —una tabla nueva entra
-- sola— y sin depender de ningún orden implícito. Lo que queda al final es
-- exactamente el subárbol que los libros mayores bloquean.
--
-- La segunda borra la fila de `tenants`: recién ahí los libros mayores se
-- pueden ir, y su cascada arrastra ese subárbol.
CREATE OR REPLACE FUNCTION public.dar_de_baja_tenant(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendientes TEXT[];
  v_restantes  TEXT[];
  v_tabla      TEXT;
  v_progreso   BOOLEAN;
BEGIN
  -- Toda tabla de negocio del esquema public con columna `tenant_id`. Se deriva
  -- del catálogo, no de una lista: es la misma razón por la que el guardrail de
  -- tenant deriva su esquema del DDL.
  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_pendientes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                     AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind = 'r';

  -- ── Fase 1: punto fijo ────────────────────────────────────────────────────
  LOOP
    v_progreso  := false;
    v_restantes := ARRAY[]::TEXT[];

    FOREACH v_tabla IN ARRAY v_pendientes LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_tabla)
          USING p_tenant_id;
        v_progreso := true;
      EXCEPTION
        -- Cualquier error significa "todavía no": se reintenta en la pasada
        -- siguiente. Los tres casos reales son
        --   * foreign_key_violation — todavía hay filas hijas;
        --   * raise_exception — el trigger de inmutabilidad de un libro mayor;
        --   * check_violation — un ON DELETE SET NULL que rompe un CHECK de la
        --     tabla que apunta. Pasa de verdad: borrar `historial_clinico`
        --     anula `plan_vacunacion.evento_aplicacion_id` y eso viola
        --     `plan_vacunacion_check` (estado 'Aplicada' exige el evento). En
        --     la pasada siguiente `plan_vacunacion` ya no está y sale limpio.
        -- Se atrapa OTHERS y no una lista cerrada porque el próximo caso va a
        -- ser otro sqlstate y el efecto correcto es siempre el mismo: postergar.
        -- El bucle no se cuelga: termina cuando una pasada entera no avanza, y
        -- si algo queda de verdad trabado, el DELETE final lo dice con su error.
        WHEN OTHERS THEN
          v_restantes := v_restantes || v_tabla;
      END;
    END LOOP;

    v_pendientes := v_restantes;
    EXIT WHEN NOT v_progreso OR array_length(v_pendientes, 1) IS NULL;
  END LOOP;

  -- ── Fase 2: la fila de tenants ────────────────────────────────────────────
  DELETE FROM tenants WHERE id = p_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.dar_de_baja_tenant(UUID) IS
  'Baja completa de una clínica, en dos fases: un punto fijo que borra las tablas con tenant_id en el orden que las FKs permitan, y después la fila de `tenants`, cuya cascada arrastra los libros mayores y el subárbol que bloquean. Operación de plataforma: solo service_role.';

REVOKE ALL     ON FUNCTION public.dar_de_baja_tenant(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dar_de_baja_tenant(UUID) TO   service_role;

NOTIFY pgrst, 'reload schema';
