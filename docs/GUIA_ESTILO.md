# Referencia UI — Reconciliada con v1.1 \+ backend construido

⚠️ **Referencia ESTÉTICA y de LAYOUT, no contrato.**

## 0\. Patrones globales (sin cambios estéticos)

Se mantiene todo lo del prototipo: header de página (h1 \+ ícono lucide \+ `text-orange-800` \+ descripción), botones de export Excel (outline verde) / PDF (sólido naranja), cards con `CardHeader` degradado `from-orange-50 to-white`, tabs con `bg-orange-50`, tablas con header `bg-orange-50` y ocultamiento progresivo de columnas (`hidden md/lg/xl:table-cell`), `AlertDialog` para destructivo / `Dialog` para forms cortos, estados vacíos e iconografía.

**Excepción deliberada: los paneles del dashboard.** La tarjeta de bienvenida, "Turnos de hoy", "Ocupación de guardería" y "Accesos rápidos" (`DashboardPage.tsx` y `components/dashboard/`) **no** llevan el `CardHeader` degradado `from-orange-50` ni el título `text-orange-800` de este patrón global: son la superficie donde se aplicó la regla "el naranja es acento, no fondo" (§1.0) porque ahí es donde se concentraba el problema (banner a sangre, título+header+icono todos en naranja a la vez). El resto de las pantallas del sistema sigue el patrón de esta sección sin cambios.

**Semántica de badges:**

| Color | Significado |
| :---- | :---- |
| Naranja | Marca/primario, acción principal, clínica |
| Verde | Éxito, confirmado, activo, completado |
| Azul | Informativo, email |
| Rojo | Destructivo, cancelado, vencido, emergencia |
| Ámbar/Amarillo | Advertencia, pendiente, próximo a vencer |
| Gris | Neutral, inactivo, "Fallecida", deshabilitado |
| Púrpura | Categoría secundaria / eventos especiales |

### Cambios vs prototipo

- **Púrpura**: era "peluquería"; con el rol Peluquero eliminado del sistema, queda solo como "categoría secundaria / eventos especiales".  
- **Gris**: el ejemplo "Baja" se reemplaza por "Fallecida" (valor real del ENUM `estado_mascota`).

## 1\. Tokens del sistema visual (acentos, superficies y elevación)

Estos tokens viven en `web/src/components/styles/theme.css` y son la **única**
fuente de los acentos, superficies suaves y sombras del sistema. La regla
operativa: si un valor de color, radio, sombra o espaciado aparece dos veces,
deja de estar en el componente y pasa a ser un token. Ningún componente escribe
un literal de color de marca.

En Tailwind v4 el valor crudo se declara en `:root` y se mapea en `@theme inline`
para que existan las utilidades.

### 0.1 El logo de la marca

El logo vive en `web/public/logo-vetercor.png` y se usa **únicamente** a través de
`LogoMarca` (`web/src/components/shell/LogoMarca.tsx`), que es donde está la ruta:
la identidad aparece en tres superficies (sidebar, barra superior de mobile y
login) y la regla de §1 —si un valor aparece dos veces, es un token— también vale
para la ruta de un asset.

- **Es decorativo.** Va con `alt=""`. En las tres superficies el nombre del
  sistema ya está en el texto contiguo o en el `aria-label` del enlace que lo
  envuelve; un texto alternativo lo anunciaría dos veces.
- **Trae su propio fondo de marca**, así que no lleva la caja con degradado que
  envolvía al ícono anterior. El redondeo se pasa por `className`
  (`rounded-xl` en sidebar, `rounded-lg` en mobile, `rounded-2xl` en login).
- **El naranja del logo no es el token.** El archivo es `#F36326`; el naranja de
  identidad del sistema es `#f97316` y el `--primary` de controles es `#c2410c`.
  Son tres naranjas distintos y el logo queda al lado de los otros dos en el
  sidebar. Alinearlos es una decisión de marca pendiente, no un bug de la
  pantalla.
- **Tamaño del archivo.** Se sirve una versión de 256×256 con paleta de 32
  colores (26 KB). El original de 2048×2048 pesa 1,7 MB: no se referencia desde
  la app, porque se muestra a 40 px.

### 1.0 Regla del sistema: el naranja es acento, no fondo

El naranja de marca (`#f97316` como identidad, `#c2410c`/orange-700 como
`--primary` para controles sólidos) se reserva para **señales puntuales**: el
ítem activo de navegación, el botón/badge primario, y una o dos líneas de acento
por pantalla. **Nunca es el fondo de un bloque grande** (un banner a sangre, el
header completo de una card, todos los títulos de sección a la vez). Cuando el
naranja aparece en todos lados deja de señalar nada, y para que el texto blanco
sea legible encima hay que oscurecerlo hasta que deja de leerse como el naranja
del logo — es exactamente lo que le pasaba al banner de bienvenida original (ver
§1.1) y a los encabezados de sección del sidebar (ver §3).

Consecuencia práctica: cualquier superficie nueva (banner, card, panel) arranca
neutra (`bg-card` / `bg-background` / la sidebar oscura de §3) y el naranja se
agrega después, deliberadamente, en el punto que de verdad necesita destacarse.

### 1.1 Bienvenida del dashboard

La tarjeta de bienvenida (`DashboardPage.tsx`) es una card neutra, no una
superficie de marca: `bg-card` con una línea de acento naranja a la izquierda
(el mismo patrón `border-l-metric-brand` que ya usan las tarjetas de métrica,
§1.3 — no es un token nuevo). El único otro naranja de la tarjeta es el badge de
rol, que usa la variante por defecto de `Badge` (`bg-primary`); el badge de
fecha es `variant="secondary"` (neutro).

**Tokens retirados.** Esta tarjeta usaba antes un degradado a sangre
(`--brand-gradient*`, `--brand-on-gradient*`, `--brand-chip-*`, más
`--elevation-brand`/`shadow-brand`). Se retiraron de `theme.css` al pasar la
tarjeta a superficie neutra: contradicen la regla de §1.0 (un degradado de marca
grande es exactamente el "fondo de naranja" que se está eliminando) y no tenían
otro consumidor en el código. Si una pantalla futura necesita algo parecido a un
degradado de marca, es una decisión de diseño nueva, no la reactivación de estos
tokens.

### 1.2 Mediciones de contraste

El contraste se **mide**, no se estima: para un chip translúcido o un fondo
oscuro hay que componer el color real (alpha sobre el fondo, o el par
texto/fondo exacto) antes de medir.

| Combinación | Contraste | Umbral |
| :---- | :---- | :---- |
| Tinta de icono sobre su superficie suave (la peor de las 5, §1.3) | **6.37:1** | 4.5:1 |
| Línea de acento sobre card blanca (la peor de las 5, §1.3) | **5.02:1** | 3:1 no-texto (SC 1.4.11) |
| Texto de ítem inactivo (`zinc-400`) sobre sidebar (`zinc-900`) | **6.91:1** | 4.5:1 texto |
| Encabezado de sección del sidebar sobre sidebar | **5.17:1** | 4.5:1 texto |
| Wordmark/nombre de usuario (`zinc-100`) sobre sidebar | **16.1:1** | 4.5:1 texto |
| Divisor del sidebar (`zinc-500`) sobre sidebar | **3.67:1** | 3:1 no-texto (SC 1.4.11) |

Referencia de lo que se reemplazó, para que no vuelva: el banner de bienvenida
con degradado (`from-orange-700 to-orange-800`) daba 5.18:1 con el título
blanco — pasaba WCAG, pero era exactamente el "naranja como fondo" que la regla
de §1.0 elimina. Antes de ese degradado hubo un header aún más oscuro
(`from-orange-500 to-orange-600`) que daba 2.80:1 con el título blanco, 2.64:1
con la bajada `text-orange-50` y 2.31:1 con el badge de rol sobre `bg-white/20`:
los tres fallaban WCAG directamente.

### 1.3 Acentos de métrica

Cinco acentos, uno por tarjeta. Cada uno tiene tres piezas: la línea del borde
izquierdo, la superficie del chip del icono y la tinta del icono. El reparto
respeta la semántica de badges de §0.

| Acento | Línea | Superficie | Tinta | Semántica (§0) |
| :---- | :---- | :---- | :---- | :---- |
| `marca` | `#c2410c` | `#ffedd5` | `#9a3412` | Marca / clínica |
| `ambar` | `#b45309` | `#fef3c7` | `#92400e` | Advertencia / seguimiento |
| `info` | `#1d4ed8` | `#dbeafe` | `#1e40af` | Informativo |
| `exito` | `#047857` | `#d1fae5` | `#065f46` | Confirmado / ocupado |
| `especial` | `#6d28d9` | `#ede9fe` | `#5b21b6` | Categoría secundaria |

Quien agrega una métrica elige una **clave** de esta lista (`MetricaAccent` en
`web/src/components/dashboard/MetricaCard.tsx`), no un color.

**El color no porta significado por sí solo.** La línea y el chip son decoración:
qué mide la tarjeta lo dicen la etiqueta, el número y el icono. Un usuario que no
distinga los tonos no pierde ninguna información.

**Si una métrica futura agrega variación** (una flecha de tendencia, un "+12%
vs. la semana pasada"), la misma regla aplica ahí: el color no puede ser el
único portador. La flecha (↑/↓) y el signo (+/−) tienen que decir lo mismo que
el color, para que un usuario que no distinga los tonos siga viendo si la
métrica subió o bajó. Hoy ninguna tarjeta muestra variación — es una regla para
cuando exista, no un cambio pendiente.

### 1.4 Elevación y radio

| Token | Para qué |
| :---- | :---- |
| `--shadow-card` | Tarjeta en reposo |
| `--shadow-card-hover` | Tarjeta enlazada, en hover |
| `--radius-surface` | `--radius + 0.5rem`; un escalón sobre la card, para que un panel destacado (p. ej. la bienvenida del dashboard, §1.1) lea como panel y no como una tarjeta más |

### 1.5 Modo oscuro

Los tokens nuevos tienen contraparte en el bloque `.dark`, con el mismo criterio
del kit heredado (que ya trae variantes `dark:`). **Hoy es código inalcanzable**:
nada en la app agrega la clase `.dark` al `<html>` — no hay `ThemeProvider`
montado, ver `web/src/main.tsx`. Se definen para que el bloque de tokens no quede
a medias, pero **no están medidos**: si algún día se enciende el modo oscuro, hay
que volver a medir contraste antes de darlo por bueno.

### 1.6 Paleta de gráficos

Los tokens `--chart-1` a `--chart-5` (`theme.css`) son la paleta categórica para
gráficos de barras (hoy: `TurnosHoyCard`, `OcupacionGuarderiaCard`). Están
deliberadamente **desaturados** (chroma ~0.05–0.09 en OKLCH): antes `--chart-1`
era un naranja de máxima saturación (chroma 0.222, el mismo tono que la marca) y
el resto rondaba chroma 0.12–0.19, mucho peso visual para datos de rutina.

**El naranja de marca no forma parte de esta paleta.** Es un acento (§1.0): se
reserva para cuando un dato puntual de un gráfico necesite destacarse frente al
resto (una barra fuera de rango, un valor crítico), no para colorear series
comunes. Hoy ningún gráfico del dashboard tiene ese caso — si aparece, se agrega
como un override puntual sobre la serie que lo necesita, no cambiando la paleta
por defecto.

## 2\. Iconografía: vectores, nunca emoji

Todo icono de la UI sale de `lucide-react`, que ya es dependencia del proyecto. No
se usan emoji como icono: se dibujan distinto en cada sistema operativo, no
heredan el color del tema y no escalan con el texto.

Esto ya se cumple en toda la app. Auditado sobre `web/src` (todos los `.tsx`,
`.ts`, `.css`, `.html`), re-confirmado en la tanda de acento naranja / sidebar
oscura: **cero emoji**. Las columnas "Acciones" usan
`Button variant="ghost" size="icon"` con un icono lucide de `size-4`, `aria-label`
descriptivo y `Tooltip`; el de eliminar va en `text-destructive`, el resto en
neutro heredado del botón.

Los únicos pictogramas presentes en `web/src` son las flechas `→` y `↔`, y son
**texto**, no iconos: viven en comentarios, en nombres de test y en dos frases de
la UI que describen un flujo ("Programado → Confirmado → Completado" en
`FlujoEstadosHelp.tsx`, "Catálogos clínicos → Tipos de vacuna" en
`ProgramarDosisDialog.tsx`). Son copy y no se tocan.

**Ojo con el prototipo de referencia.** `docs/_ref-ui/veterinarialeo/` sí tiene
emoji (🐕 🐾 🐱 en `ParametrosModule`, `ReportsModule`, `resendService`). Ese árbol
es referencia histórica de solo lectura y **no** es la app: no se toma de ahí
ningún patrón de iconografía.

## 3\. Navegación

La navegación es un **sidebar vertical** (`<aside>` sticky de 240px en `md+`,
`web/src/App.tsx`), que en mobile colapsa a una barra superior con `Sheet`. No es
una barra horizontal.

### 3.1 Fondo oscuro, neutro

El sidebar (`--sidebar` y el resto de los tokens `--sidebar-*` en `theme.css`)
es gris casi negro (`#18181b`, zinc-900) — **neutro, no naranja oscuro**. El
naranja queda para el ítem activo y el chip del logo (§1.0); todo lo demás del
sidebar es gris.

| Elemento | Token | Valor | Contraste sobre `--sidebar` |
| :---- | :---- | :---- | :---- |
| Texto de ítem inactivo | `--sidebar-foreground` | `#a1a1aa` (zinc-400) | **6.91:1** (≥ 4.5:1) |
| Encabezado de sección ("CLÍNICA"...) | `--sidebar-heading` | `#8a8a92` | **5.17:1** — más discreto que el ítem, pero igual pasa 4.5:1 |
| Wordmark / nombre de usuario | `--sidebar-accent-foreground` | `#f4f4f5` (zinc-100) | **16.1:1** |
| Fondo de hover | `--sidebar-accent` | `#27272a` (zinc-800) | — (un escalón sobre el fondo, no es texto) |
| Divisor interno (sobre la cuenta de usuario) | `--sidebar-border` | `#71717a` (zinc-500) | **3.67:1** (≥ 3:1 no-texto, SC 1.4.11) |

El ítem activo sigue siendo una píldora sólida: `bg-primary text-primary-foreground`,
es decir blanco sobre `#c2410c` = **5.18:1**. No cambia: es el indicador de "estás
acá" más fuerte disponible, cumple contraste de texto y no depende solo del color
(también cambia el peso visual del bloque).

**Ojo con `border-t`/`border-b` simples dentro del sidebar.** El `--border`
global (`rgba(0,0,0,0.1)`) está pensado para fondos claros: sobre `--sidebar`
compone a **1.02:1**, prácticamente invisible. Cualquier divisor *dentro* del
sidebar (no el borde que lo separa del contenido, que ya se ve por el cambio de
color de fondo) tiene que usar `border-sidebar-border` explícito, no `border-t`/
`border-b` a secas.

**Ojo con los botones `ghost` dentro del sidebar.** La variante `ghost` del kit
(`hover:bg-accent hover:text-accent-foreground`) usa los tokens globales
`--accent`/`--accent-foreground`, pensados para fondos claros — sobre el sidebar
oscuro un hover así se ve como un parche claro fuera de lugar, y un botón sin
color de texto explícito (p. ej. el disparador del menú mobile) hereda
`--foreground` global y queda oscuro sobre oscuro, invisible. Cualquier `Button
variant="ghost"` dentro del sidebar necesita su color de texto y su hover
explícitos: `text-sidebar-foreground hover:bg-sidebar-accent
hover:text-sidebar-accent-foreground` (ver `SidebarNav.tsx` y `App.tsx`).

Referencia de lo que se reemplazó: el sidebar anterior era casi blanco
(`oklch(0.985 0 0)`) con encabezados de sección en naranja
(`text-orange-700/80`), que competían visualmente con el ítem activo —también
naranja. La regla nueva (§1.0) reserva el naranja para una sola señal por
sidebar: el ítem activo.

### 3.2 Pendiente de decisión: navegación con scroll

El `<nav>` de `SidebarNav.tsx` ya tiene ~15 ítems con `overflow-y-auto` propio, y
va a crecer con cada tanda comercial nueva. Es un cambio de **estructura**, no de
color, así que no se implementa en esta tanda — queda para que el usuario elija
una dirección:

- **Secciones colapsables** (`Accordion` del kit, ya instalado en
  `web/src/components/ui/accordion.tsx` — no requiere componente nuevo): cada
  grupo de `groupNavItems` (Clínica, Módulos contratados, Operación,
  Administración) se pliega/despliega, con el grupo de la ruta activa abierto por
  default. Costo bajo (reusa el agrupamiento existente), pero agrega un estado de
  abierto/cerrado por grupo que hay que persistir (¿por sesión? ¿por usuario, como
  las preferencias de accesibilidad?).
- **Reagrupar antes de colapsar**: si la lista crece porque entran módulos
  comerciales, separarlos en su propio nivel (p. ej. un grupo "Comercial" que
  agrupe Stock/Ventas en vez de listarlos sueltos) reduce el scroll sin agregar
  interacción. Se puede combinar con la opción anterior.
- **Riel de iconos con flyout**: colapsar todo el sidebar a solo iconos y mostrar
  las etiquetas en un flyout al hover/foco. Es el cambio de mayor alcance (afecta
  el layout de `App.tsx`, el `<aside>` sticky y el comportamiento en mobile) y el
  kit no trae ese patrón armado — antes de encararlo habría que decidir si vale
  la pena frente a las dos opciones anteriores.

## Glosario de términos visibles

Estos términos aplican solo al copy visible en la UI (labels, columnas, placeholders, toasts). No renombran props, DTOs, columnas de base, enums, códigos de error ni rutas de API — esos siguen usando el término original.

| Término visible | Reemplaza a | Alcance |
| :---- | :---- | :---- |
| Pelaje | Color | Todo el sistema (campo `color` de Mascota) |
| Tutor | Dueño | Todo el sistema (relación cliente↔mascota) |
| Huésped | Mascota | Solo dentro de Guardería (OcupacionMes, OcupacionDia, RegistrarEstadiaPage). El resto del sistema —Mascotas, Historial Clínico, sidebar— sigue diciendo "mascota". |
