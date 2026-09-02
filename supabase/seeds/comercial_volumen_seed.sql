-- ============================================================================
-- FIXTURE DE VOLUMEN COMERCIAL (C8·T1)
-- Ubicación versionada: supabase/seeds/comercial_volumen_seed.sql
-- Proporciona datos sintéticos realistas y volumétricos en 3 tenants para:
-- 1. Pruebas de reportes (valorización a fecha, rotación, rentabilidad, etc.)
-- 2. Análisis EXPLAIN (ANALYZE, BUFFERS) con planes que eligen índices
-- 3. Reverificación de RN-MV6 (costo guardado) y RN-FR8 (conservación de valor)
-- ============================================================================

DO $$
DECLARE
  v_tenant_a UUID := '11111111-1111-1111-1111-111111111111';
  v_tenant_b UUID := '22222222-2222-2222-2222-222222222222';
  v_tenant_c UUID := '33333333-3333-3333-3333-333333333333';
  t_id UUID;
  v_u_unidad UUID;
  v_u_comp   UUID;
  v_u_blist  UUID;
  v_u_caja   UUID;
  v_u_kg     UUID;
  v_u_ml     UUID;
  v_u_dosis  UUID;
  v_mp_efectivo UUID;
  v_mp_debito   UUID;
  v_mp_credito  UUID;
  v_mp_transf   UUID;
  v_admin_uid UUID;
  v_vet_uid   UUID;
  v_recep_uid UUID;
BEGIN
  -- 1. Tenants
  INSERT INTO tenants (id, nombre, cuit_rut, email_contacto, plan, activo)
  VALUES
    (v_tenant_a, 'Veterinaria Leo Central', '30-91111111-1', 'central@vetleo.com', 'premium', true),
    (v_tenant_b, 'Veterinaria San Roque',   '30-92222222-2', 'contacto@sanroque.com', 'premium', true),
    (v_tenant_c, 'Consultorio Norte',       '30-93333333-3', 'norte@consultorios.com', 'profesional', true)
  ON CONFLICT (id) DO UPDATE SET activo = true, plan = EXCLUDED.plan, cuit_rut = EXCLUDED.cuit_rut;

  -- Unidades globales
  SELECT id INTO v_u_unidad FROM unidades_medida WHERE codigo = 'unidad';
  SELECT id INTO v_u_comp   FROM unidades_medida WHERE codigo = 'comprimido';
  SELECT id INTO v_u_blist  FROM unidades_medida WHERE codigo = 'blister';
  SELECT id INTO v_u_caja   FROM unidades_medida WHERE codigo = 'caja';
  SELECT id INTO v_u_kg     FROM unidades_medida WHERE codigo = 'kg';
  SELECT id INTO v_u_ml     FROM unidades_medida WHERE codigo = 'ml';
  SELECT id INTO v_u_dosis  FROM unidades_medida WHERE codigo = 'dosis';

  -- Medios de pago globales
  SELECT id INTO v_mp_efectivo FROM medios_pago WHERE codigo = 'efectivo';
  SELECT id INTO v_mp_debito   FROM medios_pago WHERE codigo = 'debito';
  SELECT id INTO v_mp_credito  FROM medios_pago WHERE codigo = 'credito';
  SELECT id INTO v_mp_transf   FROM medios_pago WHERE codigo = 'transferencia';

  -- 2. Poblar datos por tenant
  FOREACH t_id IN ARRAY ARRAY[v_tenant_a, v_tenant_b, v_tenant_c] LOOP
    -- Roles si no existen
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t_id AND name = 'admin') THEN
      INSERT INTO roles (tenant_id, name, display_name, description, is_system)
      VALUES (t_id, 'admin', 'Administrador', 'Acceso total a la clínica', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t_id AND name = 'veterinario') THEN
      INSERT INTO roles (tenant_id, name, display_name, description, is_system)
      VALUES (t_id, 'veterinario', 'Veterinario', 'Atención médica', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = t_id AND name = 'recepcionista') THEN
      INSERT INTO roles (tenant_id, name, display_name, description, is_system)
      VALUES (t_id, 'recepcionista', 'Recepcionista', 'Atención al público', true);
    END IF;

    -- Usuarios en auth.users y public.usuarios
    v_admin_uid := ('0000aaaa-0000-0000-0000-' || substr(t_id::text, 25, 12))::uuid;
    v_vet_uid   := ('0000bbbb-0000-0000-0000-' || substr(t_id::text, 25, 12))::uuid;
    v_recep_uid := ('0000cccc-0000-0000-0000-' || substr(t_id::text, 25, 12))::uuid;

    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
      (v_admin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@' || substr(t_id::text, 1, 4) || '.com', '$2a$10$dummyhash', now(), jsonb_build_object('tenant_id', t_id, 'provider', 'email'), '{}'::jsonb, now(), now()),
      (v_vet_uid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vet@' || substr(t_id::text, 1, 4) || '.com',   '$2a$10$dummyhash', now(), jsonb_build_object('tenant_id', t_id, 'provider', 'email'), '{}'::jsonb, now(), now()),
      (v_recep_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recep@' || substr(t_id::text, 1, 4) || '.com', '$2a$10$dummyhash', now(), jsonb_build_object('tenant_id', t_id, 'provider', 'email'), '{}'::jsonb, now(), now())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO usuarios (id, tenant_id, username, email, full_name, active, rol_id)
    VALUES
      (v_admin_uid, t_id, 'admin_' || substr(t_id::text, 1, 4), 'admin@' || substr(t_id::text, 1, 4) || '.com', 'Admin Principal', true, (SELECT id FROM roles WHERE tenant_id = t_id AND name = 'admin' LIMIT 1)),
      (v_vet_uid,   t_id, 'vet_' || substr(t_id::text, 1, 4),   'vet@' || substr(t_id::text, 1, 4) || '.com',   'Doctor García',   true, (SELECT id FROM roles WHERE tenant_id = t_id AND name = 'veterinario' LIMIT 1)),
      (v_recep_uid, t_id, 'recep_' || substr(t_id::text, 1, 4), 'recep@' || substr(t_id::text, 1, 4) || '.com', 'Ana Recepcionista', true, (SELECT id FROM roles WHERE tenant_id = t_id AND name = 'recepcionista' LIMIT 1))
    ON CONFLICT (id) DO NOTHING;

    -- Clientes
    FOR i IN 1..50 LOOP
      INSERT INTO clientes (id, tenant_id, full_name, dni_cuit, phone, email, condicion_fiscal, deleted)
      VALUES (
        gen_random_uuid(),
        t_id,
        'Cliente ' || i || ' (' || substr(t_id::text, 1, 4) || ')',
        '20-' || (10000000 + i * 13) || '-9',
        '11-4444-' || lpad(i::text, 4, '0'),
        'cliente' || i || '@test.com',
        'consumidor_final',
        false
      ) ON CONFLICT DO NOTHING;
    END LOOP;

    -- Especies y Razas por tenant si no existen
    IF NOT EXISTS (SELECT 1 FROM especies WHERE tenant_id = t_id LIMIT 1) THEN
      INSERT INTO especies (id, tenant_id, name, description, active)
      VALUES (gen_random_uuid(), t_id, 'Canino', 'Perros domésticos', true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM razas WHERE tenant_id = t_id LIMIT 1) THEN
      INSERT INTO razas (id, tenant_id, especie_id, name, description, active)
      VALUES (gen_random_uuid(), t_id, (SELECT id FROM especies WHERE tenant_id = t_id LIMIT 1), 'Labrador', 'Raza mediana/grande', true);
    END IF;

    -- Mascotas
    INSERT INTO mascotas (id, tenant_id, client_id, name, especie_id, raza_id, sex, tamano, birth_date, deleted)
    SELECT
      gen_random_uuid(),
      t_id,
      c.id,
      'Mascota ' || substr(c.full_name, 9, 3),
      (SELECT id FROM especies WHERE tenant_id = t_id LIMIT 1),
      (SELECT id FROM razas WHERE tenant_id = t_id LIMIT 1),
      CASE WHEN random() > 0.5 THEN 'Macho'::sexo_mascota ELSE 'Hembra'::sexo_mascota END,
      'Mediano'::tamano_mascota,
      CURRENT_DATE - (floor(random() * 2000)::int + 100),
      false
    FROM clientes c
    WHERE c.tenant_id = t_id;

    -- Familias de Producto
    INSERT INTO familias_producto (id, tenant_id, nombre, unidad_base_id, activo)
    VALUES
      (gen_random_uuid(), t_id, 'Antibióticos', v_u_comp, true),
      (gen_random_uuid(), t_id, 'Antiparasitarios', v_u_unidad, true),
      (gen_random_uuid(), t_id, 'Vacunas e Inmunización', v_u_dosis, true),
      (gen_random_uuid(), t_id, 'Alimentos Balanceados', v_u_kg, true),
      (gen_random_uuid(), t_id, 'Material Descartable', v_u_unidad, true)
    ON CONFLICT DO NOTHING;

    -- Proveedores
    INSERT INTO proveedores (id, tenant_id, razon_social, cuit, email, telefono, activo)
    VALUES
      (gen_random_uuid(), t_id, 'Droguería Veterinaria Sur S.A.', '30-55555555-1', 'ventas@survet.com', '11-5555-0001', true),
      (gen_random_uuid(), t_id, 'Distribuidora PetFood Argentina', '30-66666666-2', 'pedidos@petfood.com', '11-5555-0002', true),
      (gen_random_uuid(), t_id, 'Laboratorios Biogénesis Central', '30-77777777-3', 'info@biogenesis.com', '11-5555-0003', true),
      (gen_random_uuid(), t_id, 'Insumos Médicos Veterinarios SRL', '30-88888888-4', 'contacto@insumosmed.com', '11-5555-0004', true)
    ON CONFLICT (tenant_id, cuit) WHERE cuit IS NOT NULL DO NOTHING;

    -- Servicios
    INSERT INTO servicios (id, tenant_id, nombre, descripcion, duracion_minutos, tipo, precio, alicuota_iva, activo)
    VALUES
      (gen_random_uuid(), t_id, 'Consulta Médica General', 'Atención clínica veterinaria básica', 30, 'clinica', 3500.00, 21.00, true),
      (gen_random_uuid(), t_id, 'Aplicación de Vacuna', 'Acto profesional de inoculación', 15, 'clinica', 1500.00, 21.00, true),
      (gen_random_uuid(), t_id, 'Cirugía Menor', 'Procedimiento quirúrgico ambulatorio', 60, 'cirugia', 18000.00, 21.00, true),
      (gen_random_uuid(), t_id, 'Ecografía Abdominal', 'Diagnóstico por imágenes', 30, 'otro', 7500.00, 21.00, true)
    ON CONFLICT DO NOTHING;

    -- Productos
    -- 1. Amoxicilina (Padre e Hijos para fraccionamiento)
    INSERT INTO productos (id, tenant_id, codigo, nombre, familia_id, unidad_medida_id, alicuota_iva, costo_reposicion, precio_venta, es_vendible, es_consumible_clinico, activo)
    VALUES
      (gen_random_uuid(), t_id, 'AMOX-CAJA', 'Amoxicilina 500mg Caja 100 Comp', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'antibióticos' LIMIT 1), v_u_caja, 21.00, 8500.00, 14000.00, true, true, true),
      (gen_random_uuid(), t_id, 'AMOX-BLIST', 'Amoxicilina 500mg Blíster 10 Comp', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'antibióticos' LIMIT 1), v_u_blist, 21.00, 900.00, 1600.00, true, true, true),
      (gen_random_uuid(), t_id, 'AMOX-COMP', 'Amoxicilina 500mg Comprimido Suelto', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'antibióticos' LIMIT 1), v_u_comp, 21.00, 100.00, 200.00, true, true, true),
      -- 2. Vacunas
      (gen_random_uuid(), t_id, 'VAC-ANTIRRAB', 'Vacuna Antirrábica 1 Dosis', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'vacunas e inmunización' LIMIT 1), v_u_dosis, 21.00, 1200.00, 2500.00, true, true, true),
      (gen_random_uuid(), t_id, 'VAC-QUINTUP', 'Vacuna Quíntuple Canina', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'vacunas e inmunización' LIMIT 1), v_u_dosis, 21.00, 2800.00, 5200.00, true, true, true),
      -- 3. Antiparasitarios
      (gen_random_uuid(), t_id, 'ANTIP-PIP-M', 'Pipeta Antiparasitaria Perro 10-20kg', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'antiparasitarios' LIMIT 1), v_u_unidad, 21.00, 3200.00, 5800.00, true, true, true),
      (gen_random_uuid(), t_id, 'ANTIP-COMP-T', 'Total F Antiparasitario Interno', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'antiparasitarios' LIMIT 1), v_u_comp, 21.00, 450.00, 900.00, true, true, true),
      -- 4. Alimentos (Padre e Hijo fraccionado)
      (gen_random_uuid(), t_id, 'ALIM-PERRO-15K', 'Alimento Balanceado Premium Perro 15kg', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'alimentos balanceados' LIMIT 1), v_u_unidad, 21.00, 18000.00, 29000.00, true, false, true),
      (gen_random_uuid(), t_id, 'ALIM-PERRO-1KG', 'Alimento Balanceado Perro Suelto x Kg', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'alimentos balanceados' LIMIT 1), v_u_kg, 21.00, 1300.00, 2400.00, true, false, true),
      -- 5. Insumos descartables
      (gen_random_uuid(), t_id, 'DESC-JERINGA-3ML', 'Jeringa Descartable 3ml con Aguja', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'material descartable' LIMIT 1), v_u_unidad, 21.00, 120.00, 300.00, true, true, true),
      (gen_random_uuid(), t_id, 'DESC-SUERO-500', 'Solución Fisiológica 500ml', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'material descartable' LIMIT 1), v_u_unidad, 21.00, 850.00, 1800.00, true, true, true),
      -- 6. Producto sin movimiento para reporte de rotación
      (gen_random_uuid(), t_id, 'ACC-BOZAL-G', 'Bozal Canino Talle Grande', (SELECT id FROM familias_producto WHERE tenant_id = t_id AND lower(nombre) = 'material descartable' LIMIT 1), v_u_unidad, 21.00, 4000.00, 7500.00, true, false, true)
    ON CONFLICT (tenant_id, codigo) DO NOTHING;

    -- Conversiones
    INSERT INTO producto_conversiones (id, tenant_id, producto_origen_id, producto_destino_id, factor_teorico, merma_esperada_porcentaje, activo)
    VALUES
      (
        gen_random_uuid(), t_id,
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-CAJA'),
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-BLIST'),
        10, 2.00, true
      ),
      (
        gen_random_uuid(), t_id,
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-BLIST'),
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-COMP'),
        10, 0.00, true
      ),
      (
        gen_random_uuid(), t_id,
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'ALIM-PERRO-15K'),
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'ALIM-PERRO-1KG'),
        15, 5.00, true
      )
    ON CONFLICT (tenant_id, producto_origen_id, producto_destino_id) DO NOTHING;

    -- Cajas
    IF NOT EXISTS (SELECT 1 FROM cajas WHERE tenant_id = t_id AND lower(nombre) = 'caja principal mostrador') THEN
      INSERT INTO cajas (id, tenant_id, nombre, activa)
      VALUES (gen_random_uuid(), t_id, 'Caja Principal Mostrador', true);
    END IF;

  END LOOP;
END $$;

-- Generación de lotes con costos variables y movimientos masivos para volumen
DO $$
DECLARE
  v_rec_prod RECORD;
  v_rec_prov RECORD;
  v_lote_id UUID;
  v_costo_base NUMERIC(14,4);
  v_costo_efectivo NUMERIC(14,4);
  v_cant NUMERIC(14,3);
  v_fecha_venc DATE;
  v_fecha_ingreso TIMESTAMPTZ;
  v_usuario_id UUID;
  v_sesion_caja_id UUID;
  v_caja_id UUID;
  v_venta_id UUID;
  v_venta_item_id UUID;
  v_cliente_id UUID;
  v_cliente_nombre TEXT;
  v_mascota_id UUID;
  v_historial_id UUID;
  v_operacion_id UUID;
  v_mp_efectivo UUID;
  v_mp_debito UUID;
  v_mp_transf UUID;
  v_tenant_a UUID := '11111111-1111-1111-1111-111111111111';
  v_tenant_b UUID := '22222222-2222-2222-2222-222222222222';
  v_tenant_c UUID := '33333333-3333-3333-3333-333333333333';
  t_id UUID;
  v_num_op BIGINT := 1000;
BEGIN
  SELECT id INTO v_mp_efectivo FROM medios_pago WHERE codigo = 'efectivo';
  SELECT id INTO v_mp_debito   FROM medios_pago WHERE codigo = 'debito';
  SELECT id INTO v_mp_transf   FROM medios_pago WHERE codigo = 'transferencia';

  FOR v_rec_prod IN 
    SELECT p.id, p.tenant_id, p.codigo, COALESCE(p.costo_reposicion, 500.00) AS costo_reposicion, p.precio_venta, p.alicuota_iva
    FROM productos p 
    WHERE p.tenant_id IN (v_tenant_a, v_tenant_b, v_tenant_c)
    ORDER BY p.tenant_id, p.codigo 
  LOOP
    -- Obtener usuario y proveedor del tenant
    SELECT id INTO v_usuario_id FROM usuarios WHERE tenant_id = v_rec_prod.tenant_id AND rol_id = (SELECT id FROM roles WHERE tenant_id = v_rec_prod.tenant_id AND name = 'admin' LIMIT 1) LIMIT 1;
    SELECT id INTO v_rec_prov FROM proveedores WHERE tenant_id = v_rec_prod.tenant_id ORDER BY razon_social LIMIT 1;
    SELECT id INTO v_caja_id FROM cajas WHERE tenant_id = v_rec_prod.tenant_id LIMIT 1;
    SELECT id, full_name INTO v_cliente_id, v_cliente_nombre FROM clientes WHERE tenant_id = v_rec_prod.tenant_id LIMIT 1;
    SELECT id INTO v_mascota_id FROM mascotas WHERE tenant_id = v_rec_prod.tenant_id LIMIT 1;

    -- Crear 4 lotes por producto con costos progresivamente distintos (para verificar RN-MV6 con costos variantes)
    FOR l_idx IN 1..4 LOOP
      v_costo_base := v_rec_prod.costo_reposicion * (0.85 + (l_idx * 0.08)); -- variación de costo entre lotes
      v_costo_efectivo := round(v_costo_base, 4);
      v_cant := 100 + (l_idx * 25);
      v_fecha_venc := CURRENT_DATE + (90 * l_idx);
      v_fecha_ingreso := now() - ((120 - (l_idx * 25)) || ' days')::interval;
      v_lote_id := gen_random_uuid();
      v_operacion_id := gen_random_uuid();

      -- 1. Insertar Lote
      INSERT INTO lotes (
        id, tenant_id, producto_id, proveedor_id, codigo_lote,
        fecha_vencimiento, fecha_ingreso, costo_unitario_neto, costo_unitario_efectivo,
        estado, origen, usuario_id, created_at
      ) VALUES (
        v_lote_id, v_rec_prod.tenant_id, v_rec_prod.id, v_rec_prov.id,
        'L-' || substr(v_rec_prod.codigo, 1, 5) || '-T' || l_idx,
        v_fecha_venc, (v_fecha_ingreso)::date, round(v_costo_efectivo / 1.21, 4), v_costo_efectivo,
        'disponible', 'inicial', v_usuario_id, v_fecha_ingreso
      );

      -- 2. Movimiento Entrada Inicial
      INSERT INTO movimientos_stock (
        id, tenant_id, lote_id, producto_id, tipo, cantidad,
        costo_unitario, costo_total, operacion_id, usuario_id, created_at
      ) VALUES (
        gen_random_uuid(), v_rec_prod.tenant_id, v_lote_id, v_rec_prod.id,
        'entrada_inicial', v_cant, v_costo_efectivo, round(v_cant * v_costo_efectivo, 2),
        v_operacion_id, v_usuario_id, v_fecha_ingreso
      );

      -- Si el producto no es el producto sin movimiento ('ACC-BOZAL-G'), generar ventas y consumos
      IF v_rec_prod.codigo <> 'ACC-BOZAL-G' THEN
        -- Simular varias salidas (ajuste de salida) en distintas fechas
        FOR v_idx IN 1..3 LOOP
          DECLARE
            v_cant_venta NUMERIC(14,3) := 5 * v_idx;
            v_fecha_venta TIMESTAMPTZ := v_fecha_ingreso + ((v_idx * 15) || ' days')::interval;
          BEGIN
            INSERT INTO movimientos_stock (
              id, tenant_id, lote_id, producto_id, tipo, cantidad,
              costo_unitario, costo_total, operacion_id, usuario_id, created_at
            ) VALUES (
              gen_random_uuid(), v_rec_prod.tenant_id, v_lote_id, v_rec_prod.id,
              'salida_ajuste', v_cant_venta, v_costo_efectivo, round(v_cant_venta * v_costo_efectivo, 2),
              gen_random_uuid(), v_usuario_id, v_fecha_venta
            );
          END;
        END LOOP;

        -- Simular consumos clínicos si es vacuna o antibiótico
        IF v_rec_prod.codigo IN ('VAC-ANTIRRAB', 'VAC-QUINTUP', 'AMOX-COMP', 'DESC-JERINGA-3ML') THEN
          DECLARE
            v_cant_cons NUMERIC(14,3) := 2;
            v_fecha_cons TIMESTAMPTZ := v_fecha_ingreso + '20 days'::interval;
          BEGIN
            -- Crear registro de atención médica
            v_historial_id := gen_random_uuid();
            INSERT INTO historial_clinico (
              id, tenant_id, pet_id, professional_id, client_id_at_time, client_name_at_time, date, event_type, description, created_at
            ) VALUES (
              v_historial_id, v_rec_prod.tenant_id, v_mascota_id, v_usuario_id, v_cliente_id, v_cliente_nombre, (v_fecha_cons)::date,
              'Vacunación', 'Aplicación clínica en consulta programada', v_fecha_cons
            );

            INSERT INTO movimientos_stock (
              id, tenant_id, lote_id, producto_id, tipo, cantidad,
              costo_unitario, costo_total, operacion_id, mascota_id, historial_id, usuario_id, created_at
            ) VALUES (
              gen_random_uuid(), v_rec_prod.tenant_id, v_lote_id, v_rec_prod.id,
              'consumo_clinico', v_cant_cons, v_costo_efectivo, round(v_cant_cons * v_costo_efectivo, 2),
              gen_random_uuid(), v_mascota_id, v_historial_id, v_usuario_id, v_fecha_cons
            );
          END;
        END IF;

      END IF;

    END LOOP;
  END LOOP;

  -- 3. Crear sesiones de caja y ventas registradas estructuradas
  FOREACH t_id IN ARRAY ARRAY[v_tenant_a, v_tenant_b, v_tenant_c] LOOP
    SELECT id INTO v_caja_id FROM cajas WHERE tenant_id = t_id LIMIT 1;
    SELECT id INTO v_usuario_id FROM usuarios WHERE tenant_id = t_id AND rol_id = (SELECT id FROM roles WHERE tenant_id = t_id AND name = 'admin' LIMIT 1) LIMIT 1;
    SELECT id INTO v_cliente_id FROM clientes WHERE tenant_id = t_id LIMIT 1;

    -- Sesión de caja cerrada
    v_sesion_caja_id := gen_random_uuid();
    INSERT INTO sesiones_caja (
      id, tenant_id, caja_id, apertura_usuario_id, apertura_at, saldo_inicial,
      cierre_usuario_id, cierre_at, saldo_teorico_efectivo, efectivo_contado,
      diferencia, motivo_diferencia, estado
    ) VALUES (
      v_sesion_caja_id, t_id, v_caja_id, v_usuario_id, now() - '30 days'::interval, 5000.00,
      v_usuario_id, now() - '29 days'::interval, 25000.00, 25000.00, 0.00, null, 'cerrada'
    );

    -- Ventas en esa sesión
    FOR s_idx IN 1..10 LOOP
      v_venta_id := gen_random_uuid();
      v_venta_item_id := gen_random_uuid();
      v_num_op := v_num_op + 1;
      INSERT INTO ventas (
        id, tenant_id, numero_operacion, cliente_id, usuario_id, sesion_caja_id,
        condicion_pago, estado, subtotal_neto, total_iva, descuento_importe, total,
        saldo_pendiente, facturacion_estado, created_at
      ) VALUES (
        v_venta_id, t_id, v_num_op, v_cliente_id, v_usuario_id, v_sesion_caja_id,
        'contado', 'registrada', 8264.46, 1735.54, 0.00, 10000.00,
        0.00, 'no_facturada', now() - '30 days'::interval + ((s_idx * 2) || ' hours')::interval
      );

      -- Venta ítem
      INSERT INTO ventas_items (
        id, tenant_id, venta_id, producto_id, tipo_item, descripcion_snapshot, cantidad,
        precio_unitario, alicuota_iva, neto_unitario, iva_unitario, importe_total,
        costo_unitario_efectivo
      ) VALUES (
        v_venta_item_id, t_id, v_venta_id, (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-BLIST' LIMIT 1),
        'producto', 'Amoxicilina 500mg Blíster 10 Comp', 5,
        2000.00, 21.00, 1652.89, 347.11, 10000.00,
        950.0000
      );

      -- Salida por venta asociada al ítem de venta
      INSERT INTO movimientos_stock (
        id, tenant_id, lote_id, producto_id, tipo, cantidad,
        costo_unitario, costo_total, operacion_id, venta_item_id, usuario_id, created_at
      ) VALUES (
        gen_random_uuid(), t_id, (SELECT id FROM lotes WHERE tenant_id = t_id AND producto_id = (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-BLIST' LIMIT 1) LIMIT 1),
        (SELECT id FROM productos WHERE tenant_id = t_id AND codigo = 'AMOX-BLIST' LIMIT 1),
        'salida_venta', 5, 950.0000, 4750.00, v_venta_id, v_venta_item_id, v_usuario_id, now() - '30 days'::interval + ((s_idx * 2) || ' hours')::interval
      );

      -- Venta pago
      INSERT INTO ventas_pagos (
        id, tenant_id, venta_id, medio_pago_id, importe, created_at
      ) VALUES (
        gen_random_uuid(), t_id, v_venta_id,
        CASE WHEN s_idx % 3 = 0 THEN v_mp_transf WHEN s_idx % 2 = 0 THEN v_mp_debito ELSE v_mp_efectivo END,
        10000.00, now() - '30 days'::interval + ((s_idx * 2) || ' hours')::interval
      );
    END LOOP;

  END LOOP;

  -- 4. Sincronizar existencias_lote desde el libro mayor para todos los tenants
  PERFORM public.recalcular_existencias(v_tenant_a, null);
  PERFORM public.recalcular_existencias(v_tenant_b, null);
  PERFORM public.recalcular_existencias(v_tenant_c, null);

  -- 5. Actualizar estadísticas de PostgreSQL para EXPLAIN
  ANALYZE lotes;
  ANALYZE movimientos_stock;
  ANALYZE existencias_lote;
  ANALYZE productos;
  ANALYZE ventas;
  ANALYZE ventas_items;
  ANALYZE ventas_pagos;
  ANALYZE sesiones_caja;
  ANALYZE historial_clinico;
END $$;
