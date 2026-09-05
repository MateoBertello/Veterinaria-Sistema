-- =====================================================================
-- MIGRACIÓN B0.3: on_tenant_created con módulos comerciales y backfill
-- =====================================================================

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
    'manage_catalogs',
    -- Módulo comercial (§8.2)
    'view_stock',
    'split_stock',
    'consume_stock',
    'manage_sales'
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
    'manage_catalogs',
    -- Módulo comercial (§8.2)
    'view_stock',
    'split_stock',
    'manage_suppliers',
    'manage_sales',
    'manage_cash'
  );

  -- 5. Configuración default del tenant (cupo 10, aviso 7 días)
  INSERT INTO configuracion_tenant (tenant_id, cupo_maximo_diario, dias_aviso_vacuna)
  VALUES (p_tenant_id, 10, 7);

  -- 6. Módulos según plan (P-01b)
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
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END),
    (p_tenant_id, 'stock',
      v_plan IN ('profesional', 'premium'),
      CASE WHEN v_plan IN ('profesional', 'premium') THEN CURRENT_DATE END),
    (p_tenant_id, 'ventas',
      v_plan = 'premium',
      CASE WHEN v_plan = 'premium' THEN CURRENT_DATE END);

  -- 7. Catálogo clínico semilla de la clínica
  PERFORM public.seed_catalogos_tenant(p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.on_tenant_created(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.on_tenant_created(UUID) TO service_role;

-- ─── Backfill idempotente de modulos_contratados para tenants existentes ───
INSERT INTO modulos_contratados (tenant_id, modulo, habilitado, fecha_alta)
SELECT
  t.id AS tenant_id,
  m.modulo,
  CASE
    WHEN m.modulo = 'historial_clinico' THEN true
    WHEN m.modulo = 'turnos'            THEN t.plan IN ('profesional', 'premium')
    WHEN m.modulo = 'guarderia'         THEN t.plan = 'premium'
    WHEN m.modulo = 'stock'             THEN t.plan IN ('profesional', 'premium')
    WHEN m.modulo = 'ventas'            THEN t.plan = 'premium'
  END AS habilitado,
  CASE
    WHEN m.modulo = 'historial_clinico' THEN CURRENT_DATE
    WHEN m.modulo = 'turnos'    AND t.plan IN ('profesional', 'premium') THEN CURRENT_DATE
    WHEN m.modulo = 'guarderia' AND t.plan = 'premium' THEN CURRENT_DATE
    WHEN m.modulo = 'stock'     AND t.plan IN ('profesional', 'premium') THEN CURRENT_DATE
    WHEN m.modulo = 'ventas'    AND t.plan = 'premium' THEN CURRENT_DATE
    ELSE NULL
  END AS fecha_alta
FROM tenants t
CROSS JOIN (
  VALUES
    ('historial_clinico'::modulo_vendible),
    ('turnos'::modulo_vendible),
    ('guarderia'::modulo_vendible),
    ('stock'::modulo_vendible),
    ('ventas'::modulo_vendible)
) AS m(modulo)
ON CONFLICT (tenant_id, modulo) DO NOTHING;

NOTIFY pgrst, 'reload schema';
