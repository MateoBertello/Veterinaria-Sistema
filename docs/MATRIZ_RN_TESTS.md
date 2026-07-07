# Matriz RN → Test — Etapa 9 / S1

**Fecha:** 2026-07-06 · **Generada por:** sub-sesión S1 (diagnóstico de hardening).

## Método

Se extrajeron todos los códigos `RN-xx` del Documento Maestro v1.0 + Addendum v1.1 y se
cruzaron contra los **títulos** de tests (`it(...)` / `test(...)` / `describe(...)`) de
`tests/unit`, `tests/integration` y `web/src/**/*.test.tsx`, siguiendo la convención de
CLAUDE.md (nombre del test = código RN). Una RN sin cita en título puede tener cobertura
implícita; esos casos se señalan en la clasificación de brechas.

## Estado de las suites al momento del corte (todas en verde)

| Suite | Resultado |
| :-- | :-- |
| Typecheck (`tsc` API + web) | ✅ sin errores |
| Unit (`vitest run tests/unit`) | ✅ 345 tests / 26 archivos |
| Integración (`vitest run tests/integration`, stack local) | ✅ 137 tests / 11 archivos (incluye RLS/aislamiento bloqueantes) |
| Componentes web (`vitest run` en `web/`) | ✅ 247 tests / 34 archivos |

## Resumen

Estado al corte de S1:

| Total RN en docs | Con test (título) | Sin test | Cobertura |
| :-: | :-: | :-: | :-: |
| 167 | 123 | 44 | 73,7 % |

**Actualizado en Etapa 9 — S5:** se escribieron/citaron los 36 RN del grupo A + RN-UX4 (cubierta
junto con RN-MA7 como caso representativo de A2, ver nota en esa sección) + los 2 del grupo C
(cita cruzada), 39 filas en total pasadas de ❌ a ✅. Quedan sin test los 4 del grupo B
(diferidos a S6/S8/S9) y RN-AUD4 del grupo D (diferida a S11).

**Actualizado en Etapa 9 — S6:** se cerró RN-NT5 (ejecución periódica del cron de
notificaciones): migración pg_cron/pg_net + endpoint interno del barrido + test de
integración que prueba "dispara y NO spamea" (UNIQUE de `notificaciones`) y el filtro por
módulo licenciado. 1 fila más pasada de ❌ a ✅:

| Total RN en docs | Con test (título) | Sin test | Cobertura |
| :-: | :-: | :-: | :-: |
| 167 | 163 | 4 | 97,6 % |

**Actualizado en Etapa 9 — S9:** se cerró RN-UX1 (≤3 clics por acción frecuente) con
`tests/e2e/rn-ux1.spec.ts` (alta de cliente, agendar turno y registrar evento clínico, contados
desde el aterrizaje post-login `/clientes` — la app no tiene una pantalla de "dashboard"
dedicada). RN-UX2/RN-UX3 ya habían quedado ✅ en S8 (ver sus filas en la tabla completa), así que
esta sub-sesión deja solo RN-AUD4 pendiente (grupo D, diferida a S11 por decisión de producto):

| Total RN en docs | Con test (título) | Sin test | Cobertura |
| :-: | :-: | :-: | :-: |
| 167 | 166 | 1 | 99,4 % |

---

## Tabla completa por prefijo

#### RN-AUD
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-AUD1 | ✅ | `tests/unit/auditoria.service.test.ts` |
| RN-AUD2 | ✅ | `tests/unit/auditoria.service.test.ts` |
| RN-AUD3 | ✅ | `tests/unit/auditoria.controller.test.ts` |
| RN-AUD4 | ❌ | — |
| RN-AUD5 | ✅ | `tests/unit/auditoria.service.test.ts` |

#### RN-AUT
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-AUT1 | ✅ | `tests/integration/auth.integration.test.ts`<br>`tests/unit/auth.service.test.ts` |
| RN-AUT2 | ✅ | `tests/unit/auth.service.test.ts` |
| RN-AUT3 | ✅ | `tests/unit/auth.service.test.ts` |
| RN-AUT4 | ✅ | `tests/integration/auth.integration.test.ts`<br>`tests/unit/auth.service.test.ts` |
| RN-AUT5 | ✅ | `tests/unit/auth.service.test.ts` |

#### RN-CD
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-CD1 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |
| RN-CD2 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |
| RN-CD3 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-CD4 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-CD5 | ✅ | `tests/unit/mascotas.service.test.ts` |

#### RN-CF
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-CF1 | ✅ | `tests/unit/configuracion.service.test.ts`<br>`web/src/pages/ConfiguracionPage.test.tsx` |
| RN-CF2 | ✅ | `tests/unit/configuracion.service.test.ts`<br>`web/src/pages/ConfiguracionPage.test.tsx` |
| RN-CF3 | ✅ | `tests/unit/configuracion.service.test.ts`<br>`web/src/pages/ConfiguracionPage.test.tsx` |
| RN-CF4 | ✅ | `tests/unit/configuracion.controller.test.ts` |
| RN-CF5 | ✅ | `tests/unit/configuracion.service.test.ts` |

#### RN-CK
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-CK1 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-CK2 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-CK3 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-CK4 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-CK5 | ✅ | `tests/unit/guarderia.controller.test.ts` |
| RN-CK6 | ✅ | `tests/unit/guarderia.service.test.ts` |

#### RN-CL
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-CL1 | ✅ | `tests/unit/clientes.service.test.ts`<br>`web/src/components/clientes/ClienteFormDialog.test.tsx` |
| RN-CL2 | ✅ | `tests/unit/clientes.service.test.ts`<br>`web/src/components/clientes/ClienteFormDialog.test.tsx` |
| RN-CL3 | ✅ | `tests/unit/clientes.service.test.ts`<br>`web/src/components/clientes/ClienteFormDialog.test.tsx` |
| RN-CL4 | ✅ | `tests/unit/clientes.service.test.ts` |
| RN-CL5 | ✅ | `tests/unit/clientes.service.test.ts` |
| RN-CL6 | ✅ | `tests/unit/clientes.service.test.ts<br>web/src/components/clientes/ClienteFormDialog.test.tsx` |
| RN-CL7 | ✅ | `tests/unit/clientes.service.test.ts` |
| RN-CL8 | ✅ | `tests/unit/clientes.service.test.ts`<br>`web/src/components/clientes/DeleteClienteDialog.test.tsx`<br>`web/src/pages/ClientesPage.test.tsx` |
| RN-CL9 | ✅ | `tests/unit/clientes.service.test.ts` |
| RN-CL10 | ✅ | `web/src/components/clientes/DeleteClienteDialog.test.tsx` |
| RN-CL11 | ✅ | `tests/unit/clientes.service.test.ts` |

#### RN-EC
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-EC1 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/components/historial/EventoClinicoFormDialog.test.tsx` |
| RN-EC2 | ✅ | `tests/unit/historial.service.test.ts` |
| RN-EC3 | ✅ | `tests/integration/historial-storage.integration.test.ts`<br>`tests/unit/historial.service.test.ts`<br>`web/src/components/historial/EutanasiaDialog.test.tsx`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-EC4 | ✅ | `tests/integration/historial-storage.integration.test.ts`<br>`tests/unit/historial.service.test.ts` |
| RN-EC5 | ✅ | `tests/unit/historial.service.test.ts` |
| RN-EC6 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/components/historial/EventoClinicoFormDialog.test.tsx` |
| RN-EC7 | ✅ | `tests/unit/historial.controller.test.ts` |
| RN-EC8 | ✅ | `tests/unit/historial.service.test.ts<br>tests/unit/historial-export.service.test.ts` |
| RN-EC9 | ✅ | `tests/unit/historial.service.test.ts` |
| RN-EC10 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/components/historial/EutanasiaDialog.test.tsx`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-EC11 | ✅ | `tests/unit/historial.service.test.ts` |
| RN-EC12 | ✅ | `tests/unit/mascotas.service.test.ts` |

#### RN-ES
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-ES1 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-ES2 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-ES3 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-ES4 | ✅ | `tests/unit/turnos.controller.test.ts` |
| RN-ES5 | ✅ | `tests/unit/turnos.service.test.ts` |

#### RN-EX
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-EX1 | ✅ | `tests/unit/historial-export.service.test.ts`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-EX2 | ✅ | `tests/unit/historial-export.service.test.ts`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-EX3 | ✅ | `tests/unit/historial-export.service.test.ts` |
| RN-EX4 | ✅ | `tests/unit/historial-export.service.test.ts` |
| RN-EX5 | ✅ | `tests/unit/historial.controller.test.ts` |

#### RN-G
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-G1 | ✅ | `web/src/lib/navigation.test.ts` |
| RN-G2 | ✅ | `tests/unit/navigation.test.ts`<br>`web/src/lib/navigation.test.ts` |

#### RN-GU
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-GU1 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-GU2 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-GU3 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-GU4 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-GU5 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-GU6 | ✅ | `tests/unit/guarderia.controller.test.ts` |
| RN-GU7 | ✅ | `tests/unit/guarderia.service.test.ts` |

#### RN-HC
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-HC1 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-HC2 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-HC3 | ✅ | `tests/unit/historial.service.test.ts`<br>`web/src/pages/HistorialClinicoPage.test.tsx` |
| RN-HC4 | ✅ | `tests/unit/historial.service.test.ts` |
| RN-HC5 | ✅ | `tests/unit/historial.service.test.ts` |

#### RN-HOR
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-HOR1 | ✅ | `tests/unit/horarios.service.test.ts`<br>`web/src/components/horarios/FranjaFormDialog.test.tsx` |
| RN-HOR2 | ✅ | `tests/unit/horarios.service.test.ts`<br>`web/src/components/horarios/FranjaFormDialog.test.tsx`<br>`web/src/pages/HorariosPage.test.tsx` |
| RN-HOR3 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-HOR4 | ✅ | `tests/unit/horarios.service.test.ts` |
| RN-HOR5 | ✅ | `tests/unit/horarios.controller.test.ts` |
| RN-HOR6 | ✅ | `tests/unit/horarios.service.test.ts` |

#### RN-MA
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-MA1 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA2 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA3 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA4 | ✅ | `tests/unit/mascotas.service.test.ts`<br>`web/src/components/mascotas/MascotaFormDialog.test.tsx` |
| RN-MA5 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA6 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA7 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA8 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |
| RN-MA9 | ✅ | `tests/unit/mascotas.service.test.ts` |
| RN-MA10 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |

#### RN-MC
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-MC1 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-MC2 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-MC3 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-MC4 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-MC5 | ✅ | `web/src/components/turnos/TurnoDetalleDialog.test.tsx` |
| RN-MC6 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-MC7 | ✅ | `tests/unit/turnos.service.test.ts` |

#### RN-ME
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-ME1 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-ME2 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-ME3 | ✅ | `tests/unit/guarderia.service.test.ts` |
| RN-ME4 | ✅ | `web/src/components/guarderia/OcupacionDia.test.tsx` |
| RN-ME5 | ✅ | `tests/unit/guarderia.controller.test.ts` |
| RN-ME6 | ✅ | `tests/unit/guarderia.service.test.ts` |

#### RN-MF
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-MF1 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |
| RN-MF2 | ✅ | `tests/integration/mascotas.integration.test.ts`<br>`tests/unit/mascotas.service.test.ts` |
| RN-MF3 | ✅ | `web/src/components/mascotas/MarcarFallecidaDialog.test.tsx` |
| RN-MF4 | ✅ | `tests/integration/mascotas.integration.test.ts` |
| RN-MF5 | ✅ | `tests/unit/mascotas.service.test.ts` |

#### RN-NT
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-NT1 | ✅ | `tests/unit/notificaciones.service.test.ts` |
| RN-NT2 | ✅ | `tests/unit/notificaciones.service.test.ts` |
| RN-NT3 | ✅ | `tests/unit/notificaciones.service.test.ts` |
| RN-NT4 | ✅ | `tests/unit/notificaciones.service.test.ts` |
| RN-NT5 | ✅ | `tests/integration/notificaciones-cron.integration.test.ts`<br>`tests/unit/notificaciones.service.test.ts` |
| RN-NT6 | ✅ | `tests/unit/notificaciones.service.test.ts` |

#### RN-PV
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-PV1 | ✅ | `tests/integration/vacunacion.integration.test.ts`<br>`tests/unit/vacunacion.service.test.ts` |
| RN-PV2 | ✅ | `tests/unit/vacunacion.service.test.ts` |
| RN-PV3 | ✅ | `tests/unit/vacunacion.service.test.ts` |
| RN-PV4 | ✅ | `tests/integration/vacunacion.integration.test.ts`<br>`tests/unit/historial.service.test.ts`<br>`tests/unit/vacunacion.service.test.ts` |
| RN-PV5 | ✅ | `tests/integration/vacunacion.integration.test.ts`<br>`tests/unit/vacunacion.service.test.ts` |
| RN-PV6 | ✅ | `tests/unit/vacunacion-avisos.service.test.ts` |
| RN-PV7 | ✅ | `tests/unit/vacunacion-avisos.service.test.ts` |
| RN-PV8 | ✅ | `tests/unit/vacunacion-avisos.service.test.ts` |
| RN-PV9 | ✅ | `tests/unit/vacunacion.service.test.ts` |

#### RN-REC
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-REC1 | ✅ | `tests/unit/auth.service.test.ts` |
| RN-REC2 | ✅ | `tests/unit/auth.service.test.ts` |
| RN-REC3 | ✅ | `tests/unit/auth.service.test.ts` |
| RN-REC4 | ✅ | `tests/unit/auth.service.test.ts` |

#### RN-S
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-S1 | ✅ | `tests/unit/auth.service.test.ts<br>tests/unit/usuarios.service.test.ts` |
| RN-S2 | ✅ | `tests/unit/requirePermission.test.ts` |
| RN-S3 | ✅ | `tests/unit/historial.service.test.ts` |

#### RN-SA
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-SA1 | ✅ | `tests/integration/admin.integration.test.ts`<br>`tests/unit/tenants.service.test.ts` |
| RN-SA2 | ✅ | `tests/integration/admin.integration.test.ts`<br>`tests/unit/tenants.service.test.ts` |
| RN-SA3 | ✅ | `tests/integration/admin.integration.test.ts`<br>`tests/unit/requireActiveTenant.test.ts` |
| RN-SA4 | ✅ | `tests/integration/admin.integration.test.ts`<br>`tests/unit/tenants.service.test.ts` |
| RN-SA5 | ✅ | `tests/unit/tenants.service.test.ts` |

#### RN-SEC
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-SEC0 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC1 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC2 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC3 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC4 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC5 | ✅ | `tests/unit/usuarios.service.test.ts`<br>`tests/integration/doctores.integration.test.ts` |
| RN-SEC6 | ✅ | `tests/unit/usuarios.service.test.ts` |
| RN-SEC7 | ✅ | `tests/unit/usuarios.service.test.ts` |

#### RN-SM
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-SM1 | ✅ | `tests/unit/requireModule.test.ts` |
| RN-SM2 | ✅ | `tests/integration/modulos.integration.test.ts`<br>`tests/unit/modulos.service.test.ts` |
| RN-SM3 | ✅ | `tests/integration/modulos.integration.test.ts`<br>`tests/unit/modulos.service.test.ts` |
| RN-SM4 | ✅ | `tests/integration/modulos.integration.test.ts`<br>`tests/unit/modulos.service.test.ts` |

#### RN-SV
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-SV1 | ✅ | `tests/unit/servicios.service.test.ts`<br>`web/src/components/servicios/ServicioFormSheet.test.tsx` |
| RN-SV2 | ✅ | `tests/unit/servicios.service.test.ts`<br>`web/src/components/servicios/ServicioFormSheet.test.tsx` |
| RN-SV3 | ✅ | `tests/unit/servicios.service.test.ts`<br>`web/src/components/servicios/DesactivarServicioDialog.test.tsx` |
| RN-SV4 | ✅ | `tests/unit/servicios.service.test.ts` |
| RN-SV5 | ✅ | `tests/unit/servicios.service.test.ts` |
| RN-SV6 | ✅ | `tests/unit/servicios.service.test.ts` |
| RN-SV7 | ✅ | `tests/unit/servicios.service.test.ts` |

#### RN-TU
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-TU1 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU2 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU3 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU4 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU5 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU6 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU7 | ✅ | `tests/unit/turnos.controller.test.ts` |
| RN-TU8 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU9 | ✅ | `tests/unit/turnos.service.test.ts` |
| RN-TU10 | ✅ | `tests/unit/turnos.service.test.ts`<br>`web/src/pages/AgendarTurnoPage.test.tsx` |

#### RN-UX
| RN | Test | Archivos |
| :-- | :-: | :-- |
| RN-UX1 | ✅ | `tests/e2e/rn-ux1.spec.ts` |
| RN-UX2 | ✅ | `web/src/components/historial/EutanasiaDialog.test.tsx`, `web/src/components/turnos/TurnoDetalleDialog.test.tsx`, `web/src/pages/PreferenciasPage.test.tsx` |
| RN-UX3 | ✅ | `web/src/preferences/PreferencesContext.test.tsx`, `web/src/pages/PreferenciasPage.test.tsx`, `web/src/lib/navigation.test.ts` |
| RN-UX4 | ✅ | `tests/unit/mascotas.service.test.ts` |

---

## Clasificación de las 44 brechas

### A. Test directo — se escriben en S5 (36 RN) — ✅ RESUELTA (Etapa 9 — S5)

**A1. Permisos por endpoint (11).** `requirePermission.ts` existe pero **no tiene unit test
propio**, y ningún test del repo ejercita el 403 por falta de permiso (RN-S2). Es la causa raíz
del grupo. Cobertura propuesta: un test paramétrico del middleware (RN-S2) + un caso 403 por
controller que cite la RN de su módulo.

| RN | Regla |
| :-- | :-- |
| RN-S2 | Todo endpoint valida JWT y luego el permiso del rol (middleware) |
| RN-AUD3 | Auditoría solo con `view_audit` |
| RN-CF4 | Configuración requiere `manage_tenant_settings` |
| RN-CK5 | Check-in/out requiere `manage_appointments`/`manage_daycare` |
| RN-EC7 | Evento clínico requiere `manage_medical_history` |
| RN-ES4 | Estados de turno requieren `manage_appointments` |
| RN-EX5 | Export requiere al menos `view_medical_history` |
| RN-GU6 | Guardería requiere `manage_appointments`/`manage_daycare` |
| RN-HOR5 | Horarios restringidos a Administrador |
| RN-ME5 | Modificar estadía requiere `manage_appointments`/`manage_daycare` |
| RN-TU7 | Turnos requieren `manage_appointments` |

**A2. Auditoría por módulo (5).** La escritura de `registros_auditoria` está implementada en
los services, pero ningún test la fija con el código RN: RN-CL11 (DELETE clients), RN-SV7
(services), RN-EC8 (CREATE medical_records + EXPORT del envío), RN-REC4 (solicitud de
recuperación en security), RN-UX4 (regla transversal — un test representativo). ✅ Cubierto en
S5: RN-EC8 confirmó estar ya implementado en `historial.service.ts:591` (no era un DT, solo
faltaba el test).

**A3. Recuperación de cuenta (3).** Los endpoints `POST /auth/recuperar-usuario` y
`POST /auth/recuperar-password` están implementados (`auth.controller.ts:63-86`) pero **sin
ningún test**: RN-REC1 (email válido), RN-REC2 (respuesta anti-enumeración), RN-REC3 (token
con expiración, nunca password en claro). ✅ Cubierto en S5 (`auth.service.test.ts`), sin
hallazgos de producto.

**A4. Reglas funcionales sin test (9).**

| RN | Regla | Dónde testearla |
| :-- | :-- | :-- |
| RN-EC2 / RN-MA3 | Peso vive en historial; ficha muestra "último peso" derivado | `historial.service` / `mascotas.service` |
| RN-MA5 | Edad derivada en tiempo real, no persistida | util de front + service |
| RN-EC12 | Irreversibilidad: NO existe vía para revertir `Fallecida` (test negativo) | integración eutanasia |
| RN-ES2 | Turno Completado se excluye de agenda activa | `turnos.service` |
| RN-MC4 | Turno Cancelado se excluye de agenda activa | `turnos.service` |
| RN-HC5 | Timeline paginado por mascota (índice `(pet_id, date)` existe en DDL; **plan verificado en S10** → `docs/EXPLAIN_INDICES.md` Q6: Bitmap Index Scan sobre `idx_historial_pet_date`) | `historial.service` |
| RN-CL6 | Validación dual front/back (un caso representativo Zod ↔ inline) | schema + component test |
| RN-G1 | Dependencia de módulos vendibles respecto del Core (gating de navegación) | `navigation.test` |

**A5. Confirmaciones destructivas en UI (4).** Los AlertDialog existen y varios tienen test,
pero sin citar la RN: RN-CL10 (eliminar cliente), RN-MC5 (cancelar/eliminar turno), RN-ME4
(cancelar estadía), RN-MF3 (marcar fallecida con advertencia explícita). Component tests.
✅ Cubierto en S5 — hallazgo: RN-MF3 requirió un archivo de test **nuevo**
(`MarcarFallecidaDialog.test.tsx`), ya que ese diálogo es distinto de `EutanasiaDialog` y no
tenía ningún test previo.

**A6. Modelo de seguridad (4).** RN-S1/RN-SEC3 (ningún DTO expone hash/password — test de
serialización), RN-SEC0/RN-SEC2 (permisos derivan del rol vía `RolPermiso`, no editables por
usuario), RN-AUT2 (login emite JWT con expiración — delegado a Supabase Auth; test de
integración liviano que decodifica `exp`). ✅ Cubierto en S5, sin hallazgos de producto.

### B. Cubiertas por otra sub-sesión (4) — ✅ RESUELTA (Etapa 9 — S9)

| RN | Sub-sesión | Nota |
| :-- | :-- | :-- |
| ~~RN-NT5~~ | ~~S6 (cron)~~ | ✅ RESUELTA en S6: cron pg_cron/pg_net + `notificaciones-cron.integration.test.ts` (dispara y no spamea) |
| ~~RN-UX2~~ | ~~S8~~ | ✅ RESUELTA en S8: toasts, asserts en component tests citando la RN |
| ~~RN-UX3~~ | ~~S8~~ | ✅ RESUELTA en S8: panel de preferencias + sus tests |
| ~~RN-UX1~~ | ~~S9~~ | ✅ RESUELTA en S9: `tests/e2e/rn-ux1.spec.ts` (alta cliente, agendar turno, registrar evento — ≤3 clics desde `/clientes`) |

### C. Cubiertas por cruce — solo renombrar/anotar (2) — ✅ RESUELTA (Etapa 9 — S5)

- **RN-HOR3** (generación de slots): implementada y testeada bajo **RN-TU2**
  (`turnos.service.test.ts`, `TurnoService.slotsDisponibles` y el test de `_assertBloqueEnFranja`).
  S5 agregó la cita cruzada en el título (`"RN-TU2/RN-HOR3: ..."`).
- **RN-SM1** (verificación por request): es exactamente `requireModule`, testeado en
  `tests/unit/requireModule.test.ts` y en integración de módulos bajo RN-SM2..4. S5 agregó la
  cita cruzada (`"RN-SM1: ..."`) en los dos primeros `it()` del archivo.

### D. No implementada — decisión de producto (1 restante tras S5)

- **RN-AUD4** (retención de auditoría): la parte de **índices** se **verificó en S10**
  (`docs/EXPLAIN_INDICES.md`): los de fecha (`idx_auditoria_tenant_ts`) y módulo ya cubrían;
  se agregó `idx_auditoria_usuario (tenant_id, user_id, "timestamp" DESC)` justificado por
  EXPLAIN (migración `20260707000001_indices_listados.sql`). La **política de retención**
  (N registros / X meses) sigue sin implementar (DT-9); decidir en S11 si entra al MVP o queda
  post-MVP documentada. La fila sigue ❌ porque la RN es la retención, no los índices.
- ~~RN-SEC0 figura también en A6~~ — ✅ resuelta en S5 dentro de A6: la parte modelada (roles
  N:M) ya estaba decidida: solo faltaba el test, escrito junto con RN-SEC2 en
  `usuarios.service.test.ts`.

## Verificaciones colaterales de esta sesión

- **No hay `console.log` de debug en tests** (unit, integración ni componentes): el ítem de
  limpieza que figuraba como deuda ya está resuelto — no se registra DT.
- **RN-EC9 (envío real de resumen por email) está implementado** (`CanalEmailResend` en
  `historial.service.ts`); la línea suelta de TODO.md era obsoleta y se eliminó.
- Ninguna RN citada en tests es inexistente en los docs (0 códigos inventados).

## Etapa 9 — S6 (cron de notificaciones — RN-NT5)

- **Migración** `20260706000003_cron_notificaciones.sql`: habilita `pg_cron` + `pg_net`,
  crea la función wrapper `public.disparar_notificaciones()` (lee URL + secreto de **Vault**,
  no hardcodeados) y programa el job `notificaciones-hourly` (`0 * * * *`). Frecuencia horaria
  = la ventana más fina (recordatorio de turno 24 h); el UNIQUE hace idempotente re-correr.
- **Decisión pg_net vs SQL:** se eligió **pg_net (HTTP)** para reusar la lógica del Edge
  Function (canales/Resend, config por tenant, auditoría), en vez de duplicarla en plpgsql.
- **Entrada del barrido:** nuevo endpoint interno `POST /internal/notificaciones/procesar`
  (guard `requireCronSecret` por `X-Cron-Secret`, fuera de `tenantContext`) que corre ambos
  barridos masivos. El barrido ahora **filtra por módulo licenciado** (`_tenantsActivosConModulo`,
  embed `!inner` sobre `modulos_contratados`, una sola consulta).
- **RN-NT5 fijada** por `tests/integration/notificaciones-cron.integration.test.ts`: dos
  corridas del barrido → cada aviso queda 1 sola vez (UNIQUE), el tenant sin el módulo no se
  notifica, y el endpoint interno responde 401 sin secreto / 200 con él.
- **Smoke real (stack local):** `SELECT disparar_notificaciones()` ×2 → pg_net POST al
  endpoint (HTTP 200 ×2) → `notificaciones` con 1 sola fila (el UNIQUE evitó el duplicado).
- **Deploy (S11):** setear el env `CRON_SECRET` del Edge Function y cargar en Vault los
  secrets `cron_notif_url` (URL del endpoint) y `cron_notif_secret` (== `CRON_SECRET`). Ver
  el comentario de setup en la migración.

## Etapa 9 — S9 (E2E Playwright — RN-UX1)

- **Setup:** `@playwright/test` instalado en la raíz, `playwright.config.ts` con
  `globalSetup` (login único como `admin_demo`, `storageState` compartido por el resto de los
  specs) y `webServer` que levanta `npm run dev --prefix web` si no está corriendo. Specs en
  `tests/e2e/`, selectores por rol/label accesible (S8 ya dejó el árbol de accesibilidad en
  buen estado).
- **Hallazgo de producto (no de test):** `EventoClinicoFormDialog.tsx` y `EutanasiaDialog.tsx`
  (Etapa 5) mandaban `null` explícito para los campos opcionales (peso, temperatura,
  diagnóstico, tratamiento, medicación, notas) vacíos; el schema Zod del backend los declara
  `.optional()` (acepta ausente, no `null`), así que **cualquier registro real con al menos un
  campo opcional vacío fallaba con 422 VALIDATION_ERROR** — el caso normal de uso. Nunca se
  detectó antes porque los component tests mockean la llamada a la API y los de integración
  llaman al Service con payloads bien formados. Corregido cambiando `: null` → `: undefined`
  en ambos diálogos (`JSON.stringify` omite las claves `undefined`); tests de componente
  actualizados.
- **UI mínima nueva:** el tab "Plan de Vacunación" (Etapa 8) era de solo lectura — se agregaron
  `ProgramarDosisDialog` y `MarcarAplicadaDialog` (con sus tests) para poder ejercitar el flujo
  completo en E2E, reusando los endpoints ya existentes del backend de Etapa 8.
- **Fixtures de seed:** `scripts/seed.mjs` ahora asegura también un servicio que requiere
  profesional y un horario semanal completo (L-D) para `vet_demo` — sin esto, "agendar turno"
  no tenía slots disponibles. Idempotente (verificado corriendo el seed dos veces).
- **RN-UX1** fijada por `tests/e2e/rn-ux1.spec.ts`: alta de cliente (1 clic), agendar turno
  (2 clics) y registrar evento clínico (3 clics), contados desde el aterrizaje post-login
  (`/clientes` — la app no tiene una pantalla de "dashboard" dedicada; `/` redirige ahí).
- **Especs por módulo** (`auth`, `clientes-mascotas`, `historial`, `turnos`, `guarderia`,
  `vacunacion`): un flujo feliz + 1-2 errores clave por módulo, incluyendo un caso genuino de
  condición de carrera para RN-TU3 (TURNO_SOLAPADO: dos pestañas del mismo browser context
  reservando el mismo horario del profesional) y RN-ES2/RN-MC4 confirmado empíricamente (los
  turnos nacen `Confirmado` por auto-confirmación RN-TU5, no `Programado` — el front nunca
  llega a mostrar esa transición para turnos creados por la UI estándar).
- Los datos creados por los specs no se limpian (la stack local no se resetea entre corridas);
  nombres/fechas llevan sufijos derivados de `Date.now()` para que la suite sea re-ejecutable
  sin colisionar consigo misma. Verificado corriendo `npx playwright test` completo dos veces
  seguidas en el mismo día calendario.
- Deuda de S8 encontrada de paso y corregida (no de esta sub-sesión, pero bloqueaba `npm test`):
  `tests/unit/navigation.test.ts` esperaba que `buildNavItems()` devolviera solo `BASE_NAV`,
  pero desde que existe el panel de Preferencias la función también anexa `USER_NAV` al final;
  el sidebar ya funcionaba bien, solo el test había quedado desactualizado.
- Suites en verde al cierre: `npm run typecheck`, `npm run test:unit` (417/36), 
  `npm run test:integration` (146/14), `web/` (286/39), `npx playwright test` (18/18, corrido
  dos veces).

## Etapa 9 — S5 (cierre de brechas grupo A + C)

- Se escribieron/renombraron tests para los 36 RN del grupo A + RN-UX4 (ver nota en A2) + los
  2 del grupo C, con `it()`/`describe()` citando el código RN en el título, siguiendo la
  convención de CLAUDE.md. Cero cambios de producto: no se detectó ningún bug de negocio que
  ameritara un nuevo DT (se verificó puntualmente RN-EC8, que ya estaba implementado).
- Único hallazgo de alcance de trabajo: RN-MF3 requirió crear
  `web/src/components/mascotas/MarcarFallecidaDialog.test.tsx` desde cero (componente sin test
  previo), a diferencia de los otros 3 ítems de A5 que solo necesitaron renombrar un test ya verde.
- Nuevo helper de test compartido (infraestructura de test, no de producto):
  `tests/unit/_helpers/permissionMock.ts`, reutilizado por los 7 archivos de tests de permisos
  (middleware + 6 controllers) para no duplicar el mock de la cadena
  `usuarios → roles → rol_permiso → permisos`.
- Grupos B (RN-NT5, RN-UX1/2/3) y D (RN-AUD4) quedan sin tocar, tal como estaba planificado.
- Suites en verde al cierre: `npm run test:unit` (395 tests / 33 archivos) y `web/` (253 tests /
  35 archivos).
