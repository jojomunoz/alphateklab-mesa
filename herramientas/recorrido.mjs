// Recorrido completo con Playwright, con clics reales. Necesita el servidor estático en marcha:
//   python3 -m http.server 4870 -d ~/alphateklab/repos
//   node herramientas/recorrido.mjs            → teléfono (390×844) y computadora (1280×800) en el mismo navegador
//   node herramientas/recorrido.mjs --relevo   → además, dos navegadores distintos hablando por ntfy.sh
// Variables: BASE (por omisión http://localhost:4870/alphateklab-mesa/), PLAYWRIGHT (ruta del paquete).

const PW = process.env.PLAYWRIGHT ?? '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.env.BASE ?? 'http://localhost:4870/alphateklab-mesa/';
const CON_RELEVO = process.argv.includes('--relevo');

let pasan = 0;
let fallan = 0;
const errores = [];
const paginas = new Map();
const DIR_FALLAS = process.env.FALLAS ?? null; // carpeta donde guardar capturas si un paso falla

async function paso(nombre, fn) {
  try {
    await fn();
    pasan++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallan++;
    console.log(`  FALLA ${nombre}\n        ${String(e.message).split("\n")[0]}\n        ${String(e.stack).split("\n").find((l) => l.includes("recorrido.mjs")) ?? ""}`);
    if (DIR_FALLAS) for (const [quien, p] of paginas) await p.screenshot({ path: `${DIR_FALLAS}/falla-${quien.replace(/\W+/g, '-')}.png` }).catch(() => {});
    throw e;
  }
}

function vigilar(page, quien) {
  paginas.set(quien, page);
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errores.push(`${quien} [${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errores.push(`${quien} [pageerror] ${e.message}`));
}

const texto = (page, sel) => page.locator(sel).first().innerText();
const esperarTexto = (page, sel, contiene, timeout = 8000) =>
  page.waitForFunction(([s, t]) => [...document.querySelectorAll(s)].some((el) => el.textContent.replace(/\u00a0/g, ' ').includes(t)), [sel, contiene], { timeout, polling: 200 });

async function pedirDesdeTelefono(tel) {
  await tel.click('[data-plato=ropa-vieja]');
  await tel.click('#dlg-plato [aria-label="Agregar uno"]');
  await tel.click('#dlg-plato button[type=submit]');
  await tel.click('[data-plato=chicha-tamarindo]');
  await tel.click('#dlg-plato button[type=submit]');
  await tel.click('[data-plato=cerveza]');
  await tel.click('#dlg-plato button[type=submit]');
  await tel.click('#boton-carrito');
  await tel.click('#dlg-carrito [data-foco=enviar]');
}

async function cocinaTerminaMesa7(cocina) {
  cocina.setDefaultTimeout(8000);
  const tickets = cocina.locator('.ticket--cocina', { has: cocina.locator('h3', { hasText: /^Mesa 7 / }) });
  await tickets.first().waitFor({ timeout: 10000 });
  let vueltas = 0;
  while ((await tickets.count()) > 0 && vueltas++ < 6) {
    const t = tickets.first();
    // Cada renglón por su data-foco (estable entre repintados), esperando a que quede marcado antes del siguiente.
    const claves = await t.locator('.renglon-cocina[aria-pressed=false]').evaluateAll((els) => els.map((e) => e.dataset.foco));
    for (const k of claves) {
      await cocina.click(`.renglon-cocina[data-foco="${k}"]`);
      await cocina.waitForSelector(`.renglon-cocina[data-foco="${k}"][aria-pressed=true]`);
    }
    const clave = await t.getAttribute('data-clave');
    await cocina.click(`.ticket--cocina[data-clave="${clave}"] .boton-listo`);
    await cocina.waitForSelector(`.ticket--cocina[data-clave="${clave}"]`, { state: 'detached' });
  }
}

async function pagarParte(tel, { parte, propina, metodo }) {
  await tel.click('#tab-cuenta');
  await tel.locator(`input[name=parte][value="${parte}"]`).check();
  await tel.locator(`input[name=propina][value="${propina}"]`).check();
  await tel.locator(`input[name=metodo][value="${metodo}"]`).check();
  await tel.click('[data-foco=pagar]');
}

async function mismoNavegador(browser) {
  console.log('\n1. Teléfono y computadora en el mismo navegador (BroadcastChannel + localStorage)');
  const ctx = await browser.newContext({ locale: 'es-PA' });
  const salon = await ctx.newPage();
  await salon.setViewportSize({ width: 1280, height: 800 });
  vigilar(salon, 'salón');
  await salon.goto(`${BASE}salon.html`);
  await salon.waitForSelector('.mesa-tile');
  await salon.click('.barra-demo [data-restablecer]');
  await salon.click('.dialogo-confirmar .boton--peligro');
  await salon.waitForTimeout(300);
  const sala = await salon.evaluate(() => JSON.parse(localStorage.getItem('atk-mesa:sala')));
  const cocina = await ctx.newPage();
  await cocina.setViewportSize({ width: 1280, height: 800 });
  vigilar(cocina, 'cocina');
  await cocina.goto(`${BASE}cocina.html`);
  const tel = await ctx.newPage();
  await tel.setViewportSize({ width: 390, height: 844 });
  vigilar(tel, 'teléfono');
  await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7`);
  await tel.waitForSelector('[data-plato=ropa-vieja]');

  await paso('el teléfono pide 2 ropa vieja, 1 chicha y 1 cerveza', async () => {
    await pedirDesdeTelefono(tel);
    await esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Esperando al mesero');
  });
  await paso('el salón lo ve «por aceptar» y la cocina todavía no', async () => {
    await salon.waitForSelector('.mesa-tile.est-pidio[data-id=m7]', { timeout: 5000 });
    if (await cocina.locator('.ticket--cocina h3', { hasText: /^Mesa 7 / }).count()) throw new Error('la cocina ya lo tiene');
  });
  await paso('el mesero lo acepta y aparece en cocina (caliente y bar)', async () => {
    await salon.click('.mesa-tile[data-id=m7]');
    await salon.click('#panel-mesa button:has-text("Aceptar y enviar a cocina")');
    await cocina.waitForSelector('.ticket--cocina h3:has-text("Mesa 7")', { timeout: 5000 });
    const n = await cocina.locator('.ticket--cocina', { has: cocina.locator('h3', { hasText: /^Mesa 7 / }) }).count();
    if (n !== 2) throw new Error(`esperaba 2 tickets, hay ${n}`);
  });
  await paso('el teléfono ve «Recibido en cocina»', () => esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Recibido en cocina'));
  await paso('la cocina marca todo listo y el teléfono lo ve', async () => {
    await cocinaTerminaMesa7(cocina);
    await esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Listo');
  });
  await paso('el salón lo marca servido', async () => {
    await salon.click('#panel-mesa button:has-text("Marcar servido")');
    await esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Servido');
  });
  await paso('el teléfono llama al mesero; el salón lo atiende; el teléfono ve «Visto por el mesero»', async () => {
    await tel.click('#boton-llamar');
    await tel.locator('#dlg-llamar input[value=pedir]').check();
    await tel.click('#dlg-llamar button[type=submit]');
    await esperarTexto(tel, '#vista-mesa .aviso', 'Enviado');
    await salon.click('#panel-mesa button:has-text("Atender")');
    await esperarTexto(tel, '#vista-mesa .aviso', 'Visto por el mesero');
  });
  await paso('pide la cuenta: total B/. 29.50 con ITBMS 7 % B/. 1.73 y 10 % B/. 0.27', async () => {
    await tel.click('#boton-cuenta');
    await tel.waitForSelector('.ticket--cuenta');
    const t = await texto(tel, '.ticket--cuenta');
    for (const esperado of ['B/. 29.50', 'ITBMS 7 %', 'B/. 1.73', 'ITBMS 10 %', 'B/. 0.27', 'precuenta']) if (!t.includes(esperado)) throw new Error(`falta «${esperado}» en la cuenta`);
    await salon.waitForSelector('.mesa-tile.est-cuenta[data-id=m7]', { timeout: 5000 });
  });
  await paso('divide en 3 partes iguales: 9.84 + 9.83 + 9.83', async () => {
    await tel.locator('input[name=modo][value=iguales]').check();
    await tel.click('[data-foco=dividir]');
    await tel.waitForSelector('input[name=parte]');
    const t = await texto(tel, '.pago');
    for (const m of ['9.84', '9.83']) if (!t.includes(m)) throw new Error(`falta ${m}`);
  });
  await paso('ninguna propina viene marcada y sin elegir no se puede pagar', async () => {
    await tel.locator('input[name=parte][value="0"]').check();
    if (await tel.locator('input[name=propina]:checked').count()) throw new Error('hay una propina marcada');
    await tel.locator('input[name=metodo][value=yappy]').check();
    if (!(await tel.locator('[data-foco=pagar]').isDisabled())) throw new Error('el botón de pago está activo sin propina');
  });
  await paso('propina 10 %: «10 % de B/. 9.84 = B/. 0.98»; simula el pago; queda pendiente', async () => {
    await tel.locator('input[name=propina][value="10"]').check();
    const det = await texto(tel, '.propina__detalle');
    if (!det.includes('10 % de B/. 9.84 = B/. 0.98')) throw new Error(det);
    const boton = await texto(tel, '[data-foco=pagar]');
    if (boton !== 'Simular pago (demo)') throw new Error(`el botón dice «${boton}»`);
    await tel.click('[data-foco=pagar]');
    await esperarTexto(tel, '.ticket--comprobante', 'Pendiente de confirmar');
    await esperarTexto(tel, '.ticket--comprobante', 'Pago simulado');
  });
  const tel2 = await ctx.newPage();
  const tel3 = await ctx.newPage();
  for (const [p, n] of [[tel2, 'teléfono 2'], [tel3, 'teléfono 3']]) {
    await p.setViewportSize({ width: 390, height: 844 });
    vigilar(p, n);
    await p.goto(`${BASE}mesa.html?sala=${sala}&m=7#cuenta`);
    await p.waitForSelector('input[name=parte]');
  }
  await paso('las otras dos partes se pagan desde otros dos teléfonos', async () => {
    await pagarParte(tel2, { parte: 1, propina: 'ninguna', metodo: 'tarjeta' });
    await esperarTexto(tel2, '.ticket--comprobante', 'Pendiente de confirmar');
    await tel3.waitForSelector('input[name=parte][value="1"][disabled]', { timeout: 5000 });
    await pagarParte(tel3, { parte: 2, propina: '15', metodo: 'mesero' });
    await esperarTexto(tel3, '.ticket--comprobante', 'Pendiente de confirmar');
  });
  await paso('con pagos pendientes la mesa NO está pagada', async () => {
    if (await salon.locator('.mesa-tile.est-pagada[data-id=m7]').count()) throw new Error('quedó pagada sin confirmar');
  });
  await paso('la caja confirma los tres pagos y la mesa pasa a «pagada»', async () => {
    for (let i = 0; i < 3; i++) {
      await salon.locator('#panel-mesa button:has-text("Pago recibido")').first().click();
      await salon.waitForTimeout(200);
    }
    await salon.waitForSelector('.mesa-tile.est-pagada[data-id=m7]', { timeout: 5000 });
    await esperarTexto(tel, '.ticket--comprobante', 'Pagado');
    await esperarTexto(tel, '#vista-cuenta', 'La mesa está pagada');
  });
  await paso('el salón libera la mesa y el teléfono ve la cuenta cerrada', async () => {
    await salon.click('#panel-mesa button:has-text("Liberar mesa")');
    await salon.click('.dialogo-confirmar .boton--primario');
    await salon.waitForSelector('.mesa-tile.est-libre[data-id=m7]', { timeout: 5000 });
    await esperarTexto(tel, '#vista-cuenta', 'Tu cuenta quedó cerrada');
  });
  await paso('Ajustes «Fonda o comida rápida»: la comida va sin ITBMS y la cerveza sigue al 10 %', async () => {
    const admin = await ctx.newPage();
    vigilar(admin, 'panel');
    await admin.setViewportSize({ width: 1280, height: 800 });
    await admin.goto(`${BASE}admin.html#ajustes`);
    await admin.locator('input[name=tipo-local][value=fonda]').check();
    await admin.click('#panel-ajustes button[type=submit]:has-text("Guardar ajustes")');
    await admin.waitForFunction(() => JSON.parse(localStorage.getItem('atk-mesa:estado')).ajustes.tipoLocal === 'fonda', null, { polling: 200 });
    await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7`);
    await tel.waitForSelector('[data-plato=ropa-vieja]');
    await tel.click('[data-plato=ropa-vieja]');
    await tel.click('#dlg-plato button[type=submit]');
    await tel.click('[data-plato=cerveza]');
    await tel.click('#dlg-plato button[type=submit]');
    await tel.click('#boton-carrito');
    await tel.click('#dlg-carrito [data-foco=enviar]');
    await salon.click('.mesa-tile[data-id=m7]');
    await salon.click('#panel-mesa button:has-text("Aceptar y enviar a cocina")');
    await tel.click('#boton-cuenta');
    await esperarTexto(tel, '.ticket--cuenta', 'Sin ITBMS: B/. 12.00');
    const t = (await texto(tel, '.ticket--cuenta')).replace(/\u00a0/g, ' ');
    for (const esperado of ['B/. 15.00', 'Sin ITBMS: B/. 12.00', 'ITBMS 10 %', 'B/. 0.27']) if (!t.includes(esperado)) throw new Error(`falta «${esperado}» en la cuenta`);
    if (t.includes('ITBMS 7 %')) throw new Error('la fonda cobró 7 %');
    await admin.locator('input[name=tipo-local][value=restaurante]').check();
    await admin.click('#panel-ajustes button[type=submit]:has-text("Guardar ajustes")');
    await admin.waitForFunction(() => JSON.parse(localStorage.getItem('atk-mesa:estado')).ajustes.tipoLocal === 'restaurante', null, { polling: 200 });
  });
  await ctx.close();
}

async function porRelevo() {
  console.log('\n2. Dos navegadores distintos por el relevo ntfy.sh (sin localStorage compartido)');
  const compu = await chromium.launch();
  const telefono = await chromium.launch();
  try {
    const ctxA = await compu.newContext({ locale: 'es-PA', viewport: { width: 1280, height: 800 } });
    const salon = await ctxA.newPage();
    vigilar(salon, 'salón (A)');
    await salon.goto(`${BASE}salon.html`);
    await salon.waitForSelector('#conexion[data-estado=conectado]', { timeout: 15000 });
    const sala = await salon.evaluate(() => JSON.parse(localStorage.getItem('atk-mesa:sala')));
    console.log(`  sala ${sala}, tema atk-mesa-${sala}`);
    const ctxB = await telefono.newContext({ locale: 'es-PA', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tel = await ctxB.newPage();
    vigilar(tel, 'teléfono (B)');
    const t0 = Date.now();
    await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7`);
    await paso('el teléfono se conecta y recibe el estado de la mesa desde la computadora', async () => {
      await tel.waitForSelector('#conexion[data-estado=conectado]', { timeout: 15000 });
      await esperarTexto(tel, '#vista-carta', 'Ropa vieja', 15000);
      await tel.click('#tab-mesa');
      await esperarTexto(tel, '#vista-mesa', 'Aún no hay pedidos', 15000);
    });
    await paso('pedido por el relevo: llega al salón «por aceptar»', async () => {
      await tel.click('#tab-carta');
      await pedirDesdeTelefono(tel);
      await salon.waitForSelector('.mesa-tile.est-pidio[data-id=m7]', { timeout: 20000 });
      console.log(`        (${((Date.now() - t0) / 1000).toFixed(1)} s desde que abrió el teléfono)`);
      await esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Esperando al mesero', 20000);
    });
    await paso('el salón lo acepta y el teléfono ve «Enviado a cocina»', async () => {
      await salon.click('.mesa-tile[data-id=m7]');
      await salon.click('#panel-mesa button:has-text("Aceptar y enviar a cocina")');
      await esperarTexto(tel, '#vista-mesa .ticket--pedido .estado', 'Enviado a cocina', 20000);
    });
    await paso('llamar al mesero por el relevo: «Enviado» y luego «Visto por el mesero»', async () => {
      await tel.click('#boton-llamar');
      await tel.locator('#dlg-llamar input[value=ayuda]').check();
      await tel.click('#dlg-llamar button[type=submit]');
      await esperarTexto(tel, '#vista-mesa .aviso', 'Enviado', 20000);
      await salon.click('#panel-mesa button:has-text("Atender")');
      await esperarTexto(tel, '#vista-mesa .aviso', 'Visto por el mesero', 20000);
    });
    await paso('cuenta, propina 10 % y pago simulado por el relevo; la caja confirma y el teléfono ve «Pagado»', async () => {
      await tel.click('#boton-cuenta');
      await tel.waitForSelector('.ticket--cuenta', { timeout: 20000 });
      await tel.locator('input[name=modo][value=todo]').check();
      await tel.locator('input[name=propina][value="10"]').check();
      await tel.locator('input[name=metodo][value=yappy]').check();
      await tel.click('[data-foco=pagar]');
      await salon.waitForSelector('#panel-mesa button:has-text("Pago recibido")', { timeout: 20000 });
      await salon.click('#panel-mesa button:has-text("Pago recibido")');
      await esperarTexto(tel, '.ticket--comprobante', 'Pagado', 20000);
    });
  } finally {
    await compu.close();
    await telefono.close();
  }
}

const browser = await chromium.launch();
try {
  await mismoNavegador(browser);
} catch {
  /* el paso ya dijo qué falló */
} finally {
  await browser.close();
}
if (CON_RELEVO) {
  try {
    await porRelevo();
  } catch {
    /* idem */
  }
}
console.log(`\n${pasan} pasos bien, ${fallan} con falla.`);
console.log(errores.length ? `Consola con ${errores.length} errores o avisos:\n${errores.join('\n')}` : 'Consola: sin errores ni avisos.');
process.exit(fallan || errores.length ? 1 : 0);
