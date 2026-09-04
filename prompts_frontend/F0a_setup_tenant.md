# 0a — Setup del tenant de prueba
> **MANUAL. No hay código en esta tanda y no hay nada que pedirle a un modelo.**
> Está escrita como tanda porque si no se hace, todo lo demás parece roto.

## Por qué

Los endpoints comerciales pasan por `requireModule("stock")` o `requireModule("ventas")`. Si
el tenant no los tiene contratados, **todo devuelve `403 MODULE_NOT_LICENSED`** y desde el
frontend se ve como un bug de la pantalla.

## Pasos

1. Entrar a la consola Super Admin: `/admin/login`.
2. Tenants → el tenant de prueba → detalle.
3. Habilitar **Stock** y **Ventas** con los switches de módulos
   (`PUT /api/v1/admin/tenants/:id/modulos/:modulo`).
4. Cerrar sesión y entrar con un usuario **del tenant** (no el Super Admin).
5. Confirmar que el sidebar muestra **Stock** y **Ventas** bajo *Módulos contratados*.

## Verificación de que quedó bien

```
GET /api/v1/modulos-habilitados   → stock y ventas con habilitado: true
GET /api/v1/productos             → 200 (no 403)
GET /api/v1/caja/cajas            → 200 (no 403)
```

Si `GET /productos` da 200 y `GET /caja/cajas` da 403, falta habilitar **ventas**: son dos
módulos distintos y el mostrador necesita los dos.

## Lo que NO hay que hacer

- **No** tocar `web/src/lib/navigation.ts` ni `web/src/lib/planes.ts`. Los dos ya conocen
  `stock` y `ventas`, y `buildNavItems` ya oculta el módulo no contratado (RN-G2).
- **No** agregar un modo "módulo con candado". RN-G2 dice ocultar, no deshabilitar.
- **No** habilitar módulos escribiendo en `modulos_contratados` por SQL. El camino es la
  consola, que audita el cambio.
