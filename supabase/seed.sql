-- =====================================================================
-- SEED DE DESARROLLO (B0.4)
-- Ubicación versionada: supabase/seed.sql
-- Ejecutado automáticamente por `supabase db reset`.
-- Crea UN tenant premium por la vía normal (crear_tenant -> on_tenant_created)
-- y aprovisiona su admin (admin_demo / Demo1234!) y el Super Admin de plataforma.
-- =====================================================================

DO $$
DECLARE
  v_tenant_id UUID;
  v_admin_id UUID := '0000aaaa-0000-0000-0000-999999999999';
  v_rol_admin_id UUID;
  v_super_admin_id UUID := '00005555-0000-0000-0000-999999999999';
BEGIN
  -- 1. Tenant demo creado por la vía normal (RPC crear_tenant -> on_tenant_created)
  SELECT id INTO v_tenant_id FROM public.tenants WHERE cuit_rut = '20-99999999-9';
  IF v_tenant_id IS NULL THEN
    SELECT id INTO v_tenant_id FROM public.crear_tenant(
      'Veterinaria Demo',
      '20-99999999-9',
      'contacto@demo.local',
      'premium'
    );
  END IF;

  -- 2. Rol admin del tenant
  SELECT id INTO v_rol_admin_id FROM public.roles WHERE tenant_id = v_tenant_id AND name = 'admin' LIMIT 1;

  -- 3. Usuario Admin en auth.users con contraseña conocida: Demo1234!
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@demo.local') THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@demo.local',
      crypt('Demo1234!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'tenant_id', v_tenant_id),
      '{}'::jsonb,
      now(),
      now(),
      '', '', '', ''
    );
  ELSE
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@demo.local';
    UPDATE auth.users
    SET encrypted_password = crypt('Demo1234!', gen_salt('bf')),
        email_confirmed_at = now(),
        raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', array['email'], 'tenant_id', v_tenant_id)
    WHERE id = v_admin_id;
  END IF;

  -- 4. Registro en public.usuarios
  INSERT INTO public.usuarios (
    id, tenant_id, username, email, full_name, active, rol_id
  )
  VALUES (
    v_admin_id,
    v_tenant_id,
    'admin_demo',
    'admin@demo.local',
    'Admin Demo',
    true,
    v_rol_admin_id
  )
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = v_tenant_id,
    username = 'admin_demo',
    email = 'admin@demo.local',
    full_name = 'Admin Demo',
    active = true,
    rol_id = v_rol_admin_id;

  -- 5. Super Admin de plataforma (para /admin/login): super@leo.local / Super1234!
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'super@leo.local') THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    VALUES (
      v_super_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'super@leo.local',
      crypt('Super1234!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'platform_role', 'super_admin'),
      '{}'::jsonb,
      now(),
      now(),
      '', '', '', ''
    );
  ELSE
    SELECT id INTO v_super_admin_id FROM auth.users WHERE email = 'super@leo.local';
    UPDATE auth.users
    SET encrypted_password = crypt('Super1234!', gen_salt('bf')),
        email_confirmed_at = now(),
        raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', array['email'], 'platform_role', 'super_admin')
    WHERE id = v_super_admin_id;
  END IF;

END $$;
