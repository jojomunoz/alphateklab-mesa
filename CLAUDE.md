# alphateklab Mesa · cómo trabajar aquí

QR y NFC por mesa para restaurantes: carta para pedir (`mesa.html`), cocina, salón, kiosco y panel del dueño.
Sitio estático para GitHub Pages (`https://jojomunoz.github.io/alphateklab-mesa/`): HTML + CSS + módulos ES, sin build.
Reglas comunes: `~/alphateklab/BRIEF.md`. Especificación: `~/alphateklab/ESPEC-mesa.md`. Guía de diseño:
`~/Documents/NovahWEB/conocimiento/GUIA-DISENO-SIN-SLOP.md`.

## Estructura

- `js/nucleo/*.mjs`: lógica pura (dinero, ITBMS, propina, división, estados, la caja, plano, mensajes). Sin DOM.
  Todo cambio de estado pasa por `aplicar()` de `caja.mjs`, idempotente por `id`.
- `js/ui/`: almacenamiento, caja local (localStorage + Web Locks + BroadcastChannel), relevo ntfy, piezas comunes.
- `js/vistas/`: una por página. `css/tokens.css` tiene TODOS los colores.
- Pruebas: `node --test pruebas/` (el `pruebas/index.js` hace que Node 22 acepte la carpeta). Recorrido en el
  navegador: `node herramientas/recorrido.mjs` con el servidor en marcha (ver README).

## Dirección visual (decidida el 3-oct-2026; no cambiarla sin motivo escrito)

- **El mundo del oficio: la comanda.** Pedidos, cocina, cuenta, comprobante y lista de precios se ven como tickets
  de papel: borde dentado arriba y abajo (`mask` con `conic-gradient`), renglón «2 × plato ……… importe» con puntos
  guía, cifras tabulares. Esa es la apuesta; lo demás va en calma (filetes, aire, sin tarjetas con sombra).
- **Color** (medido en `pruebas/contraste-textos.test.mjs`): fondo `#f3f5f1`, superficie `#fbfcfa`, tinta `#1b1f1c`;
  verde plátano `#1f5130` para el botón principal y los encabezados de categoría; pixbae `#d8452a` solo para la marca
  de la fonda y el contador del carrito (cifra en negrita de 19 px: pasa como texto grande, 4,25:1); estados
  `#1d7a3e` / `#a15c07` / `#b42318` con fondo suave. Modo oscuro completo en mesa, salón, admin, kiosco e inicio.
  La cocina siempre oscura: riel `#0b0f0c` con tickets de papel `#eef1ec` y banda de tiempo verde/ámbar/roja con texto.
- **Tipos** autoalojados en `fuentes/`: Bricolage Grotesque 700 (títulos, nombres de plato, números grandes) y
  Atkinson Hyperlegible Next 400/700 (todo lo demás). `tabular-nums` en precios.
- **Radios:** 0 en tickets, 6 px en controles, 999 px solo en el contador del carrito.
- **Movimiento:** solo responder (botón que se hunde 120 ms) y estado (ticket nuevo en cocina 220 ms, hoja que
  sube). Nada de fade-up. «Reducir movimiento» deja fundidos de 120 ms (`--mov-dist: 0`).
- **El estado de una mesa** se dice con forma + texto + color: borde punteado (libre), doble (pidió la cuenta),
  grueso con campana (llama), ícono de bolsa (pidió), check (pagada). Nada parpadea.

## Decisiones que no están en la especificación

- **Formato de dinero «B/. 1,234.50»** (punto decimal, coma de miles): así imprimen cartas y recibos en Panamá y
  así lo trae CLDR para es-PA. La especificación escribía «45,00»; cambiarlo es tocar solo `formatear()`.
- **Sin puntos guía en la carta** (sí en los tickets): con nombres largos que saltan de línea quedaban mal; la
  especificación pide tickets en pedidos, cocina y cuenta, no en la carta.
- **Las tasas de ITBMS no se editan en Ajustes**: las fija la ley (7 % y 10 %); cada plato elige la suya en la carta.
- La caja **solo acepta del relevo público** lo que hace un comensal (pedir, llamar, cuenta, avisar pago).
  Confirmar pagos, liberar mesas y cambiar la carta solo desde la computadora.

## Trampas

- `networkidle` de Playwright nunca llega en las páginas de la computadora (el EventSource de ntfy queda abierto):
  esperar a `load` y a un selector.
- Contextos distintos de Playwright no comparten localStorage ni BroadcastChannel: para «el teléfono y la
  computadora en la misma sala» usar dos páginas del mismo contexto; para el relevo real, dos `browser`.
- ntfy trata como adjunto todo mensaje de más de 4.096 bytes: el resumen de mesa se recorta (hay prueba).
- Un `grid-area` con nombre dentro de un grid que no lo define crea una columna implícita (pasó en el kiosco).
