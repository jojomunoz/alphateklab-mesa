# alphateklab Mesa

QR y NFC en cada mesa de un restaurante: el comensal ve la carta con el precio final, pide, llama al mesero, pide
la cuenta, la divide, elige la propina y paga. La cocina recibe las comandas por estación, el salón ve el estado de
cada mesa, cobra y arma el borrador de factura, hay una pantalla táctil de autopedido y un panel para el dueño.

Es una demo con un restaurante **ficticio**, la Fonda Pixbae (cocina panameña, Ciudad de Panamá). Publicada en
`https://jojomunoz.github.io/alphateklab-mesa/`.

## Las vistas

| Archivo | Para quién | Qué hace |
|---|---|---|
| `index.html` | El dueño que evalúa | Qué es, cómo funciona, la prueba en vivo con el QR de la mesa 7, precios. |
| `mesa.html?sala=<código>&m=<n>` | El comensal | Carta (español/inglés), pedido con opciones y nota, avance de cada ronda, llamar al mesero, cuenta con ITBMS por tasa, división, propina, pago simulado, comprobante. |
| `cocina.html` | La cocina | Tickets por estación con hora de entrada y minutos (verde < 10, ámbar 10-20, rojo > 20, con texto). Tocar renglón = hecho; «Listo para servir»; deshacer; sonido opcional. |
| `salon.html` | Mesero y caja | Plano o lista de mesas con su estado, pendientes, aceptar o rechazar pedidos, atender avisos, cobrar (efectivo con vuelto, tarjeta, Yappy, mixto), confirmar pagos, borrador de factura, liberar mesa, pedidos del kiosco y editor del plano (arrastrar o flechas del teclado). |
| `kiosco.html` | Cliente en el local | Pantalla táctil vertical u horizontal: categorías, platos grandes, carrito siempre visible, una sugerencia, comer aquí o llevar, pago en caja o tarjeta simulada, número de orden. Vuelve al reposo a los 60 s sin uso (aviso a los 50). |
| `admin.html` | El dueño | Carta (platos, precios, ITBMS, alérgenos, opciones, agotado, exportar e importar JSON), mesas y hoja de placas para imprimir (cuatro por hoja carta), grabado de etiquetas NFC (`#nfc`) y ajustes. |

## Cómo se usa la demo

1. Abre `index.html` en la computadora. La primera vez se crea un **código de sala** de 10 caracteres (se guarda
   en ese navegador) y los datos de ejemplo: un servicio en curso con mesas ocupadas, una que llama, una que pidió
   la cuenta y tickets en la cocina. La mesa 7 queda libre.
2. Escanea el QR de la mesa 7 con un teléfono. El teléfono abre `mesa.html?sala=…&m=7` y habla con la
   computadora por el relevo. Sin teléfono, «Sin teléfono: abrir la mesa 7 aquí» abre la mesa en la misma
   computadora (entonces todo va por el mismo navegador).
3. Abre el salón y la cocina en otras pestañas y sigue el pedido: el salón lo acepta, la cocina lo marca listo,
   el comensal pide la cuenta, la divide, deja propina y «Simula el pago»; la caja pulsa «Pago recibido» y la mesa
   queda pagada.
4. «Restablecer datos de ejemplo» (barra de arriba) vuelve al servicio de ejemplo. Si el ejemplo se queda sin
   tocar más de 20 minutos, vuelve solo con horas de ahora (si no, la cocina mostraría tickets de ayer).

### En local

```sh
python3 -m http.server 4870 -d ~/alphateklab/repos
# abrir http://localhost:4870/alphateklab-mesa/
node --test pruebas/                       # lógica pura
node herramientas/recorrido.mjs            # recorrido con Playwright (servidor en marcha)
node herramientas/recorrido.mjs --relevo   # además, dos navegadores por el relevo ntfy.sh real
```

Desde `localhost` el QR apunta a `localhost` y un teléfono no puede abrirlo; la página lo avisa. Publicada en
GitHub Pages sí funciona.

## Lo que es simulado (y lo dice la pantalla)

- **El pago.** No hay pasarela. El botón dice «Simular pago (demo)», no hay pantalla de «procesando», el
  comprobante dice «Pago simulado» y la cuenta queda «pendiente de confirmar» hasta que la caja pulsa «Pago
  recibido». Nunca se piden datos de tarjeta. El QR de Yappy que aparece es de ejemplo: al escanearlo dice que no
  es un código de pago.
- **La factura.** El salón arma el borrador con la base y el ITBMS por tasa y deja copiar los datos en un formato
  ilustrativo. La factura electrónica válida la emite el PAC autorizado por la DGI; lo que se pide desde la mesa es
  una precuenta.
- **El relevo entre dispositivos.** Teléfono y computadora se hablan por `ntfy.sh`, un servidor público de pruebas,
  en el tema `atk-mesa-<sala>`. Cualquiera que conozca el código de sala puede leer y escribir ahí, por eso toda
  pantalla avisa «No escribas datos reales», y la caja solo acepta del relevo lo que hace un comensal (pedir, llamar,
  pedir o dividir la cuenta, avisar un pago); confirmar pagos, liberar mesas o cambiar la carta solo se hace en la
  computadora. Si ntfy no responde, todo sigue funcionando en el mismo navegador.
- **Los datos** viven en el `localStorage` de la computadora (con versión de esquema). Sin almacenamiento
  (ventana privada) la demo funciona pero cada pestaña va por su cuenta.

## Reglas de negocio (y dónde están probadas)

- Dinero en centésimos enteros. Los precios de la carta **ya traen el ITBMS** (Ley 473 de 2025, en vigor desde el
  19-jun-2026); la cuenta desglosa el impuesto contenido por tasa, `monto × tasa / (100 + tasa)`, redondeado al
  centésimo «mitad hacia arriba» una vez por renglón: 7 % comida y bebidas sin alcohol, 10 % bebidas alcohólicas
  (DGI). Ningún cargo extra para el comensal. → `pruebas/dinero.test.mjs`
- Propina voluntaria (ACODECO, mayo de 2026): 10, 15, 20 %, otra cifra o sin propina, **ninguna marcada**; sin
  elegir no se puede pagar. Se calcula sobre lo consumido y la pantalla lo dice («10 % de B/. 45.00 = B/. 4.50»).
  → `pruebas/propina-division.test.mjs`
- División en N partes iguales sin perder centésimos (el resto, de a 1 en las primeras) o por platos, con platos
  compartidos. Si alguien ya pagó, la división no se cambia; si se agregan platos después, queda «desfasada».
- Estados del pedido, del aviso, de la mesa y del pago con transiciones válidas; las demás se rechazan.
  → `pruebas/estados.test.mjs`, `pruebas/caja.test.mjs`
- **Contra pedidos falsos:** por defecto cada pedido por QR entra «por aceptar» en el salón y pasa a cocina cuando
  el mesero lo acepta (como el modo manual de Qamarero). Ajustes: solo el primero de cada mesa, o ninguno. Opcional:
  PIN de 3 cifras impreso en la placa. Y no más de 3 pedidos esperando por mesa. El caso que lo justifica: en
  Kunming (China), la foto de una mesa publicada en redes dejó a la vista su QR y otros lo usaron para hacer
  pedidos falsos ([China Daily, 4-dic-2023](https://www.chinadaily.com.cn/a/202312/04/WS656dd404a31090682a5f15f7.html)).
- Cada mensaje se aplica una sola vez por su `id` aunque llegue por BroadcastChannel y por ntfy.
  → `pruebas/resumen-mensajes.test.mjs`
- Contraste de cada par de colores usado, medido desde `css/tokens.css`. → `pruebas/contraste-textos.test.mjs`

## El camino a producción

1. **Servidor propio** con la cola de pedidos y avisos en tiempo real (por ejemplo PocketBase con SSE), en el
   dominio del restaurante. El relevo público y el `localStorage` son solo para la demo.
2. **Pasarela con webhook.** Sin servidor: el QR estático de Yappy Comercial del local (1 % + ITBMS) y el cajero
   confirma lo que ve en su app. Con servidor: botón de pago de Yappy por API o enlace de pago de una pasarela
   panameña; la mesa pasa a «pagada» cuando llega el webhook de confirmación, nunca antes.
3. **Factura electrónica** con el PAC del restaurante (obligatoria desde el 1-ene-2026 para quien factura más de
   B/. 36,000 al año o más de 100 documentos al mes): el borrador del salón es lo que se le enviaría.
4. **Placas** atornilladas o en acrílico, QR al dominio propio, revisión en cada turno; etiquetas NFC NTAG 424 DNA
   (SUN) para probar que el teléfono está en la mesa, que necesitan ese servidor.
5. **Hosting propio.** GitHub Pages sirve para mostrar la demo; sus términos no permiten usarlo como sistema de un
   negocio ni para transacciones sensibles.
6. Datos personales: ver la carta y pedir no pide ninguno. Si se agregan (nombre, teléfono para avisos), aviso de
   privacidad y consentimiento según la Ley 81 de 2019.

## Estructura

```
index.html  mesa.html  cocina.html  salon.html  kiosco.html  admin.html
css/        tokens.css (colores y tipos), base.css (ticket, botones, diálogos) y una hoja por vista
js/nucleo/  lógica pura con pruebas (dinero, carta, cuenta, caja, plano, mensajes, textos…)
js/ui/      almacenamiento, caja local, relevo ntfy, puente caja↔teléfonos, piezas comunes
js/vistas/  una por página
datos/      carta.json (la carta de ejemplo)
fuentes/    Bricolage Grotesque y Atkinson Hyperlegible Next (woff2, latin + latin-ext, de Google Fonts)
img/        íconos (sprite SVG), favicon y el QR de Yappy de ejemplo
sw.js       service worker: la carta queda guardada para verla con mala señal
pruebas/    node --test
herramientas/ recorrido con Playwright y el generador del QR de ejemplo
```

Librería externa: `qrcode-generator@1.4.4` (MIT) desde jsDelivr, con `integrity`, solo en las páginas que dibujan QR.
