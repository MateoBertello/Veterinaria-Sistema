-- =====================================================================
-- MIGRACIÓN 003: Row Level Security (RLS)
-- =====================================================================

-- =====================================================================
-- TABLAS DE PLATAFORMA: solo Super Admin + lectura propia del tenant
-- =====================================================================

ALTER TABLE tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulos_contratados ENABLE ROW LEVEL SECURITY;

-- Super Admin puede hacer todo en tenants
CREATE POLICY p_tenants_super ON tenants FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Un tenant puede leer su propia fila
CREATE POLICY p_tenants_self_read ON tenants FOR SELECT
  USING (auth.uid() IS NOT NULL AND id = current_tenant_id());

-- Super Admin puede hacer todo en modulos_contratados
CREATE POLICY p_modulos_super ON modulos_contratados FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Un tenant puede leer sus propios módulos
CREATE POLICY p_modulos_tenant_read ON modulos_contratados FOR SELECT
  USING (auth.uid() IS NOT NULL AND tenant_id = current_tenant_id());

-- =====================================================================
-- CATÁLOGOS GLOBALES: lectura autenticada; escritura Super Admin
-- =====================================================================

ALTER TABLE permisos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE especies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE razas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_vacuna ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_permisos_read ON permisos FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY p_especies_read ON especies FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY p_razas_read ON razas FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY p_tipos_vacuna_read ON tipos_vacuna FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY p_permisos_admin ON permisos FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
CREATE POLICY p_especies_admin ON especies FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
CREATE POLICY p_razas_admin ON razas FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
CREATE POLICY p_tipos_vacuna_admin ON tipos_vacuna FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- =====================================================================
-- TABLAS DE NEGOCIO: aislamiento por tenant_id
-- =====================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'configuracion_tenant', 'roles', 'usuarios', 'doctores', 'horarios_doctor',
    'clientes', 'mascotas', 'cambios_propietario', 'servicios', 'historial_clinico',
    'adjuntos_medicos', 'plan_vacunacion', 'turnos', 'notificaciones', 'estadias',
    'registros_auditoria'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY p_%s_tenant_isolation ON %I FOR ALL
         USING     (auth.uid() IS NOT NULL AND tenant_id = current_tenant_id())
         WITH CHECK(auth.uid() IS NOT NULL AND tenant_id = current_tenant_id());',
      t, t
    );
  END LOOP;
END $$;

-- =====================================================================
-- ROL_PERMISO: aislamiento por pertenencia al tenant
-- (no tiene tenant_id directo; se valida via roles)
-- =====================================================================

ALTER TABLE rol_permiso ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_rol_permiso_tenant ON rol_permiso FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = rol_id
        AND r.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = rol_id
        AND r.tenant_id = current_tenant_id()
    )
  );
