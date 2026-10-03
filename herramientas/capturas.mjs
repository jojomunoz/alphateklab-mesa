// Capturas de cada vista a 390×844 y 1280×800, en claro y oscuro (el kiosco también a 1080×1920 y 1920×1080),
// con estados reales (un pedido hecho, la cuenta dividida, el panel de una mesa abierto). Además mide, en cada
// captura: scroll horizontal del cuerpo, objetivos táctiles de menos de 44 px y foco visible al tabular.
//   node herramientas/capturas.mjs [carpeta]   (por omisión ./capturas, que está en .gitignore)

const PW = process.env.PLAYWRIGHT ?? '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const { mkdirSync } = await import('node:fs');
const BASE = process.env.BASE ?? 'http://localhost:4870/alphateklab-mesa/';
const DIR = process.argv[2] ?? 'capturas';
mkdirSync(DIR, { recursive: true });

const errores = [];
let limitados = 0;
const informe = [];

async function medir(page) {
  return page.evaluate(() => {
    const scrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    // El scroll del cuerpo no basta: un `overflow: clip` en html o body lo esconde y el contenido queda cortado
    // sin que nadie lo vea. Se mide cada elemento contra el ancho de la ventana (salvo los que viven dentro de
    // una franja con scroll propio, como las categorías de la carta).
    const ancho = document.documentElement.clientWidth;
    const desbordes = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[hidden], dialog:not([open]), .visualmente-oculto, svg')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= ancho + 1) continue;
      let p = el.parentElement;
      let enScroll = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
          enScroll = true;
          break;
        }
        p = p.parentElement;
      }
      if (!enScroll) desbordes.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''} hasta ${Math.round(r.right)} de ${ancho}`);
    }
    // Y el texto que se sale de su caja (una palabra larga con la letra grande): la caja mide bien, el texto no.
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const rango = document.createRange();
    while (recorrido.nextNode()) {
      const n = recorrido.currentNode;
      const padre = n.parentElement;
      if (!n.textContent.trim() || !padre || padre.closest('[hidden], dialog:not([open]), .visualmente-oculto')) continue;
      rango.selectNodeContents(n);
      const r = rango.getBoundingClientRect();
      if (r.width && r.right > ancho + 1) {
        let p = padre;
        let enScroll = false;
        while (p && p !== document.body) {
          if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) {
            enScroll = true;
            break;
          }
          p = p.parentElement;
        }
        if (!enScroll) desbordes.push(`texto «${n.textContent.trim().slice(0, 24)}» hasta ${Math.round(r.right)} de ${ancho}`);
      }
    }
    const chicos = [];
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="tab"], [role="switch"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || el.closest('[hidden], dialog:not([open]), .visualmente-oculto')) continue;
      // Enlaces dentro de un párrafo de texto: excepción de WCAG 2.5.8 (en línea).
      if (el.tagName === 'A' && el.closest('p, li span, td') && st.display === 'inline') continue;
      if (el.type === 'radio' || el.type === 'checkbox') {
        const caja = el.closest('label')?.getBoundingClientRect();
        if (caja && caja.height >= 44) continue;
      }
      if (r.height < 44 || r.width < 44) chicos.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(r.width)}×${Math.round(r.height)} «${(el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30)}»`);
    }
    return { scrollX, chicos, desbordes };
  });
}

async function focoVisible(page, n = 12) {
  let sinFoco = 0;
  const vistos = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      const visible = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2) || st.boxShadow !== 'none';
      return { visible, quien: `${el.tagName.toLowerCase()} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}»` };
    });
    if (!r) continue;
    vistos.push(r.quien);
    if (!r.visible) sinFoco++;
  }
  return { sinFoco, vistos: vistos.length };
}

async function preparar(browser, { ancho, alto, esquema, letra = 100 }) {
  const ctx = await browser.newContext({ locale: 'es-PA', viewport: { width: ancho, height: alto }, colorScheme: esquema });
  if (letra !== 100) await ctx.addInitScript((l) => document.addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = `${l}%`)), letra);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // 429 de ntfy.sh (límite por IP del relevo público): se cuenta aparte, no es un error de la página.
    if (/status of 429/.test(m.text()) && /ntfy\.sh/.test(m.location()?.url ?? '')) limitados++;
    else errores.push(`[${ancho}×${alto} ${esquema}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errores.push(`[${ancho}×${alto} ${esquema}] ${e.message}`));
  // Un servicio con la mesa 7 pidiendo y la cuenta dividida, para que cada vista tenga estados reales.
  await page.goto(`${BASE}salon.html`);
  await page.waitForSelector('.mesa-tile, .fila-mesa');
  const sala = await page.evaluate(() => JSON.parse(localStorage.getItem('atk-mesa:sala')));
  return { ctx, page, sala };
}

async function capturar(page, nombre, sufijo, { completa = false } = {}) {
  await page.waitForTimeout(250);
  const ruta = `${DIR}/${nombre}-${sufijo}.png`;
  await page.screenshot({ path: ruta, fullPage: completa });
  const m = await medir(page);
  informe.push({ captura: ruta, scrollX: m.scrollX, chicos: m.chicos, desbordes: m.desbordes });
}

async function vistas(page, sala, suf, ancho, esquema, { kiosco = true } = {}) {
  await page.goto(`${BASE}index.html`);
  await page.waitForSelector('.placa .qr', { timeout: 10000 });
  await capturar(page, 'inicio', suf);
  if (ancho === 390 && esquema === 'light') informe.push({ captura: `foco inicio ${suf}`, ...(await focoVisible(page)) });

  // Comensal: carta, pedido, mi mesa y cuenta
  await page.goto(`${BASE}mesa.html?sala=${sala}&m=7`);
  await page.waitForSelector('[data-plato=ropa-vieja]');
  await capturar(page, 'mesa-carta', suf);
  if (ancho === 390 && esquema === 'light') informe.push({ captura: `foco mesa ${suf}`, ...(await focoVisible(page)) });
  await page.click('[data-plato=churrasco]');
  await capturar(page, 'mesa-plato', suf);
  await page.locator('#dlg-plato input[value=medio]').check();
  await page.locator('#dlg-plato input[name=g-acomp][value=patacones]').check();
  await page.click('#dlg-plato button[type=submit]');
  await page.click('[data-plato=cerveza]');
  await page.click('#dlg-plato button[type=submit]');
  await page.click('#boton-carrito');
  await capturar(page, 'mesa-pedido', suf);
  await page.click('#dlg-carrito [data-foco=enviar]');
  await page.waitForSelector('#vista-mesa .ticket--pedido');
  await capturar(page, 'mesa-mimesa', suf);

  // Salón: acepta el pedido (con el panel abierto)
  await page.goto(`${BASE}salon.html${ancho < 1100 ? '' : '?m=7'}`);
  await page.waitForSelector('.mesa-tile, .fila-mesa');
  await capturar(page, 'salon', suf);
  if (ancho < 1100) await page.click('.fila-mesa:has-text("Mesa 7"), .mesa-tile[data-id=m7]');
  await page.click('button:has-text("Aceptar y enviar a cocina")');
  await capturar(page, 'salon-panel', suf);
  if (ancho === 1280 && esquema === 'light') informe.push({ captura: `foco salón ${suf}`, ...(await focoVisible(page, 16)) });

  // Cocina (siempre oscura)
  await page.goto(`${BASE}cocina.html`);
  await page.waitForSelector('.ticket--cocina');
  await capturar(page, 'cocina', suf);

  // Cuenta del comensal con la división y la propina a la vista
  await page.goto(`${BASE}mesa.html?sala=${sala}&m=7#cuenta`);
  await page.waitForSelector('.ticket--cuenta');
  await page.locator('input[name=modo][value=iguales]').check();
  await page.click('[data-foco=dividir]');
  await page.waitForSelector('input[name=parte]');
  await page.locator('input[name=parte][value="0"]').check();
  await page.locator('input[name=propina][value="10"]').check();
  await page.locator('input[name=metodo][value=yappy]').check();
  await capturar(page, 'mesa-cuenta', suf, { completa: true });
  await page.click('[data-foco=pagar]');
  await page.waitForSelector('.ticket--comprobante');
  // La vista se repinta cuando llega el estado de la caja: esperar a que se asiente antes de desplazar.
  await page.waitForTimeout(400);
  await page.locator('.ticket--comprobante').first().scrollIntoViewIfNeeded();
  await capturar(page, 'mesa-comprobante', suf);

  // Kiosco (es una pantalla fija del local: no se prueba con la letra al 200 %)
  if (kiosco) {
    await page.goto(`${BASE}kiosco.html`);
    await page.waitForSelector('#boton-empezar');
    await capturar(page, 'kiosco-reposo', suf);
    await page.click('#boton-empezar');
    await page.click('[data-plato=carimanolas]');
    await page.click('#dlg-plato .hoja__pie button');
    await capturar(page, 'kiosco-pedido', suf);
    await page.click('[data-foco=ir-pagar]');
    await capturar(page, 'kiosco-pagar', suf);
  }

  // Panel
  for (const tab of ['carta', 'mesas', 'nfc', 'ajustes']) {
    await page.goto(`${BASE}admin.html#${tab}`);
    await page.waitForSelector(`#panel-${tab} h2`);
    if (tab === 'mesas') await page.waitForSelector('.placa-impresa .qr', { timeout: 10000 });
    await capturar(page, `admin-${tab}`, suf);
  }
}

const browser = await chromium.launch();
try {
  for (const [ancho, alto] of [[390, 844], [1280, 800]]) {
    for (const esquema of ['light', 'dark']) {
      const suf = `${ancho}-${esquema === 'light' ? 'claro' : 'oscuro'}`;
      const { ctx, page, sala } = await preparar(browser, { ancho, alto, esquema });

      await vistas(page, sala, suf, ancho, esquema);
      await ctx.close();
    }
  }

  // Los bordes de la casa (guía §3): 320 px de ancho y la letra al 200 % a 390 px, en claro.
  for (const [ancho, alto, letra] of [[320, 700, 100], [390, 844, 200]]) {
    const { ctx, page, sala } = await preparar(browser, { ancho, alto, esquema: 'light', letra });
    await vistas(page, sala, letra === 100 ? `${ancho}` : `${ancho}-letra${letra}`, ancho, 'light', { kiosco: letra === 100 });
    await ctx.close();
  }

  // Kiosco en sus pantallas reales
  for (const [ancho, alto] of [[1080, 1920], [1920, 1080]]) {
    const { ctx, page } = await preparar(browser, { ancho, alto, esquema: 'light' });
    const suf = `${ancho}x${alto}`;
    await page.goto(`${BASE}kiosco.html`);
    await page.waitForSelector('#boton-empezar');
    await capturar(page, 'kiosco-reposo', suf);
    await page.click('#boton-empezar');
    await page.click('[data-plato=carimanolas]');
    await page.click('#dlg-plato .hoja__pie button');
    await page.click('.k-categoria:has-text("Platos fuertes")');
    await page.click('[data-plato=churrasco]');
    await capturar(page, 'kiosco-opciones', suf);
    await page.locator('#dlg-plato input[value=medio]').check();
    await page.locator('#dlg-plato input[name=kg-acomp][value=coco]').check();
    await page.click('#dlg-plato .hoja__pie button');
    await capturar(page, 'kiosco-pedido', suf);
    await page.click('[data-foco=ir-pagar]');
    await page.click('[data-foco=llevar-false]');
    await page.click('[data-foco=pago-caja]');
    await capturar(page, 'kiosco-pagar', suf);
    await page.click('[data-foco=confirmar]');
    await page.waitForSelector('.k-orden__numero');
    await capturar(page, 'kiosco-orden', suf);
    await ctx.close();
  }
} finally {
  await browser.close();
}

let problemas = 0;
for (const r of informe) {
  if (r.scrollX) {
    problemas++;
    console.log(`SCROLL HORIZONTAL: ${r.captura}`);
  }
  if (r.desbordes?.length) {
    problemas++;
    console.log(`DESBORDE: ${r.captura}: ${r.desbordes.length} elementos pasan del ancho de la ventana\n   ${r.desbordes.slice(0, 6).join('\n   ')}`);
  }
  if (r.chicos?.length) console.log(`${r.captura}: ${r.chicos.length} objetivos de menos de 44 px\n   ${r.chicos.slice(0, 8).join('\n   ')}`);
  if ('sinFoco' in r) {
    console.log(`${r.captura}: ${r.vistos} elementos recorridos con Tab, ${r.sinFoco} sin foco visible`);
    problemas += r.sinFoco;
  }
}
const capturas = informe.filter((r) => 'scrollX' in r).length;
console.log(`\n${capturas} capturas en ${DIR}/. Scroll horizontal en ${informe.filter((r) => r.scrollX).length} de ${capturas}; elementos desbordados en ${informe.filter((r) => r.desbordes?.length).length} de ${capturas}.`);
console.log(errores.length ? `Consola: ${errores.length} errores o avisos\n${errores.join('\n')}` : 'Consola: sin errores ni avisos.');
if (limitados) console.log(`ntfy.sh contestó 429 (límite por IP) ${limitados} veces; la página reintentó.`);
process.exit(problemas || errores.length ? 1 : 0);
