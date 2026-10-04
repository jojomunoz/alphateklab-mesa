// Recorrido completo con Playwright, con clics reales. Necesita el servidor estático en marcha:
//   python3 -m http.server 4870 -d ~/alphateklab/repos
//   node herramientas/recorrido.mjs            → teléfono (390×844) y computadora (1280×800) en el mismo navegador
//   node herramientas/recorrido.mjs --relevo   → además, dos navegadores distintos hablando por ntfy.sh
//   node herramientas/recorrido.mjs --solo-relevo → solo eso (ntfy.sh limita por IP: tras muchas corridas seguidas
//                                               contesta 429 y el relevo queda «sin conexión» un rato)
// Variables: BASE (por omisión http://localhost:4870/alphateklab-mesa/), PLAYWRIGHT (ruta del paquete).

const PW = new URL('./navegador.mjs', import.meta.url).href; // Playwright: ver herramientas/navegador.mjs
const { chromium } = await import(PW);
const BASE = process.env.BASE ?? 'http://localhost:4870/alphateklab-mesa/';
const SOLO_RELEVO = process.argv.includes('--solo-relevo');
const CON_RELEVO = SOLO_RELEVO || process.argv.includes('--relevo');

let pasan = 0;
let fallan = 0;
const errores = [];
const limitados = [];
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
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // El 429 de ntfy.sh (limita por IP) lo anota el navegador como error de red; no es un error de la página, que
    // reintenta. Se cuenta aparte para que se vea, sin tapar los errores propios.
    if (/status of 429/.test(m.text()) && /ntfy\.sh/.test(m.location()?.url ?? '')) limitados.push(quien);
    else errores.push(`${quien} [${m.type()}] ${m.text()}`);
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
    // El título del comprobante queda a la vista, debajo de las pestañas fijas, y con el foco (antes quedaba tapado).
    const [tituloArriba, pestanasAbajo, conFoco] = await tel.evaluate(() => [
      document.querySelector('.ticket--comprobante .ticket__titulo').getBoundingClientRect().top,
      document.querySelector('#pestanas').getBoundingClientRect().bottom,
      document.activeElement?.classList.contains('ticket__titulo'),
    ]);
    if (tituloArriba < pestanasAbajo) throw new Error(`el título del comprobante (y=${Math.round(tituloArriba)}) queda debajo de las pestañas (hasta y=${Math.round(pestanasAbajo)})`);
    if (!conFoco) throw new Error('el foco no pasó al título del comprobante');
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

async function casosDeBorde(browser) {
  console.log('\n2. Casos de borde (los que encontró la revisión del 3-oct)');
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
  await cocina.waitForSelector('.renglon-cocina');
  const tel = await ctx.newPage();
  await tel.setViewportSize({ width: 390, height: 844 });
  vigilar(tel, 'teléfono');
  await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7#carta`);
  await tel.waitForSelector('[data-plato=cerveza]');
  const pedirCerveza = async () => {
    await tel.click('#tab-carta');
    await tel.click('[data-plato=cerveza]');
    await tel.click('#dlg-plato button[type=submit]');
    await tel.click('#boton-carrito');
    await tel.click('#dlg-carrito [data-foco=enviar]');
  };
  // Un cambio en otra pantalla: la cocina marca y desmarca un renglón de otra mesa (repinta salón y teléfono).
  const otraPantallaCambiaAlgo = async () => {
    const r = cocina.locator('.renglon-cocina').first();
    const k = await r.getAttribute('data-foco');
    await cocina.click(`.renglon-cocina[data-foco="${k}"]`);
    await cocina.click(`.renglon-cocina[data-foco="${k}"]`);
    await salon.waitForTimeout(300);
  };

  await paso('el motivo de rechazo elegido sobrevive a un cambio de otra pantalla', async () => {
    await pedirCerveza();
    await salon.waitForSelector('.mesa-tile.est-pidio[data-id=m7]', { timeout: 5000 });
    await salon.click('.mesa-tile[data-id=m7]');
    await salon.click('#panel-mesa button:has-text("Rechazar")');
    await salon.locator('#panel-mesa select').selectOption({ label: 'Otro (escríbelo)' });
    await salon.fill('#panel-mesa input[id^=otro-]', 'Pedido de prueba');
    await otraPantallaCambiaAlgo();
    if ((await salon.locator('#panel-mesa select').inputValue()) !== '') throw new Error('el motivo volvió a la primera opción');
    if ((await salon.locator('#panel-mesa input[id^=otro-]').inputValue()) !== 'Pedido de prueba') throw new Error('se perdió el texto del motivo');
  });
  await paso('rechazar el único pedido: el teléfono ve «El mesero no lo aceptó» con el motivo, aunque la mesa quede libre', async () => {
    await salon.click('#panel-mesa button:has-text("Rechazar pedido")');
    await salon.waitForSelector('.mesa-tile.est-libre[data-id=m7]', { timeout: 5000 });
    await esperarTexto(tel, '#vista-mesa', 'El mesero no lo aceptó: Pedido de prueba');
    await tel.click('#vista-mesa button:has-text("Entendido")');
    await esperarTexto(tel, '#vista-mesa', 'Aún no hay pedidos');
  });
  await paso('cobro en caja: escribir «5», otra pantalla cambia algo, escribir «0» da 50 (no 05)', async () => {
    await salon.click('.mesa-tile[data-id=m10]');
    await salon.click('#panel-mesa [data-foco=cobrar]');
    await salon.click('#cobro-recibido');
    await salon.keyboard.type('5');
    await otraPantallaCambiaAlgo();
    await salon.keyboard.type('0');
    const v = await salon.locator('#cobro-recibido').inputValue();
    if (v !== '50') throw new Error(`el campo quedó en «${v}»`);
    await salon.click('#panel-mesa button:has-text("Cancelar")');
  });
  await paso('propina «Otra cifra» en el teléfono: «2», el salón atiende otra mesa, «.50» da 2.50', async () => {
    await pedirCerveza();
    await salon.waitForSelector('.mesa-tile.est-pidio[data-id=m7]', { timeout: 5000 });
    await salon.click('.mesa-tile[data-id=m7]');
    await salon.click('#panel-mesa button:has-text("Aceptar y enviar a cocina")');
    await tel.click('#tab-cuenta');
    await tel.locator('input[name=modo][value=todo]').check();
    await tel.locator('input[name=propina][value=monto]').check();
    await tel.click('#monto-propina');
    await tel.keyboard.type('2');
    await salon.click('.mesa-tile[data-id=m11]');
    await salon.click('#panel-mesa button:has-text("Atender")');
    await tel.waitForTimeout(300);
    await tel.keyboard.type('.50');
    const v = await tel.locator('#monto-propina').inputValue();
    if (v !== '2.50') throw new Error(`la propina quedó en «${v}»`);
  });
  await paso('cocina: «Deshacer» de un pedido que el salón ya sirvió avisa que no se puede y no dice «Deshecho»', async () => {
    const t = cocina.locator('.ticket--cocina', { has: cocina.locator('h3', { hasText: /^Mesa 7 / }) }).first();
    await t.waitFor({ timeout: 8000 });
    const clave = await t.getAttribute('data-clave');
    await cocina.click(`.ticket--cocina[data-clave="${clave}"] .renglon-cocina`);
    await cocina.click(`.ticket--cocina[data-clave="${clave}"] .boton-listo`);
    await salon.click('.mesa-tile[data-id=m7]');
    await salon.click('#panel-mesa button:has-text("Marcar servido")');
    await esperarTexto(salon, '#panel-mesa', 'Servido');
    await cocina.click('#boton-deshacer');
    await cocina.waitForTimeout(400);
    if (/Deshecho/.test(await cocina.locator('#anuncio-cocina').textContent())) throw new Error('anunció «Deshecho»');
    await esperarTexto(cocina, 'body', 'Ya no se puede deshacer');
    const boton = await cocina.locator('#boton-deshacer').innerText();
    if (/Mesa 7/.test(boton)) throw new Error(`el botón sigue ofreciendo deshacer ese pedido: «${boton}»`);
  });
  await paso('el foco del teclado nunca queda debajo de las barras fijas de la carta (WCAG 2.4.11)', async () => {
    await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7#carta`);
    await tel.waitForSelector('[data-plato=cerveza]');
    await tel.click('[data-plato=cerveza]');
    await tel.click('#dlg-plato button[type=submit]');
    await tel.waitForSelector('#barra-carrito:not([hidden])');
    // Se mide con la página quieta: tras «End» el navegador se desplaza con suavidad un rato, y medir a mitad de
    // camino daba fallas al azar (1 de cada 4 corridas) que un teclado humano nunca ve.
    const tapado = () =>
      tel.evaluate(async () => {
        await new Promise((listo) => {
          let antes = scrollY, quietos = 0;
          const mirar = () => {
            if (scrollY === antes) quietos += 1;
            else { quietos = 0; antes = scrollY; }
            if (quietos >= 4) listo();
            else requestAnimationFrame(mirar);
          };
          requestAnimationFrame(mirar);
        });
        const el = document.activeElement;
        if (!el || el === document.body || el.closest('.pestanas, .categorias, #barra-carrito, .barra-demo')) return null;
        const r = el.getBoundingClientRect();
        // Lo que tapan las barras fijas: la parte del elemento que cae dentro de alguna de ellas, o fuera de la ventana.
        const barras = ['.pestanas', '.categorias', '#barra-carrito'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
        let tapada = Math.max(0, -r.top) + Math.max(0, r.bottom - innerHeight);
        for (const b of barras) tapada += Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
        const visible = Math.max(0, r.height - tapada);
        return visible < r.height - 1 ? `«${el.textContent.trim().slice(0, 30)}» se ve ${Math.round(visible)} de ${Math.round(r.height)} px` : null;
      });
    await tel.evaluate(() => { scrollTo(0, 0); document.querySelector('.categorias__enlace').focus(); });
    const problemas = [];
    for (let i = 0; i < 30; i++) {
      await tel.keyboard.press('Tab');
      const t = await tapado();
      if (t) problemas.push(`Tab ${i + 1}: ${t}`);
    }
    await tel.evaluate(() => document.querySelector('.platos li:last-child .plato').focus());
    await tel.keyboard.press('End');
    await tapado(); // espera a que termine el desplazamiento suave de «End» antes de volver con Mayús+Tab
    for (let i = 0; i < 12; i++) {
      await tel.keyboard.press('Shift+Tab');
      const t = await tapado();
      if (t) problemas.push(`Mayús+Tab ${i + 1}: ${t}`);
    }
    if (problemas.length) throw new Error(problemas.slice(0, 4).join('; '));
  });
  await paso('con el texto al 200 % las categorías se pegan debajo de las pestañas, sin taparlas (WCAG 1.4.4)', async () => {
    await tel.goto(`${BASE}mesa.html?sala=${sala}&m=7#carta`);
    await tel.waitForSelector('[data-plato=cerveza]');
    await tel.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await tel.evaluate(() => scrollTo(0, 1600));
    await tel.waitForTimeout(300);
    const [pestanas, categorias] = await tel.evaluate(() => ['.pestanas', '.categorias'].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()));
    if (categorias.top < pestanas.bottom - 1) throw new Error(`las categorías empiezan en ${Math.round(categorias.top)} px y las pestañas terminan en ${Math.round(pestanas.bottom)} px`);
  });
  await paso('PIN equivocado: el campo vuelve a salir (también tras recargar) y con el PIN bueno el pedido entra', async () => {
    const admin = await ctx.newPage();
    vigilar(admin, 'panel');
    await admin.setViewportSize({ width: 1280, height: 800 });
    await admin.goto(`${BASE}admin.html#ajustes`);
    await admin.check('#aj-pin');
    await admin.click('#panel-ajustes button[type=submit]:has-text("Guardar ajustes")');
    await admin.waitForFunction(() => JSON.parse(localStorage.getItem('atk-mesa:estado')).ajustes.pin === true, null, { polling: 200 });
    const pin = await admin.evaluate(() => JSON.parse(localStorage.getItem('atk-mesa:estado')).plano.mesas.find((m) => m.numero === 3).pin);
    const p3 = await ctx.newPage();
    vigilar(p3, 'teléfono mesa 3');
    await p3.setViewportSize({ width: 390, height: 844 });
    await p3.goto(`${BASE}mesa.html?sala=${sala}&m=3#carta`);
    await p3.click('[data-plato=cerveza]');
    await p3.click('#dlg-plato button[type=submit]');
    await p3.click('#boton-carrito');
    await p3.fill('#pin-mesa', pin === '111' ? '222' : '111');
    await p3.click('#dlg-carrito [data-foco=enviar]');
    await esperarTexto(p3, '#vista-mesa', 'El PIN no coincide');
    await p3.reload();
    await p3.click('#vista-mesa button:has-text("Ver pedido")');
    await p3.waitForSelector('#pin-mesa', { timeout: 3000 });
    await p3.fill('#pin-mesa', pin);
    await p3.click('#dlg-carrito [data-foco=enviar]');
    await esperarTexto(p3, '#vista-mesa .ticket--pedido .estado', 'Esperando al mesero');
    await admin.uncheck('#aj-pin');
    await admin.click('#panel-ajustes button[type=submit]:has-text("Guardar ajustes")');
    await admin.close();
  });
  await ctx.close();
}

async function porRelevo() {
  console.log('\n3. Dos navegadores distintos por el relevo ntfy.sh (sin localStorage compartido)');
  const compu = await chromium.launch();
  const telefono = await chromium.launch();
  try {
    const ctxA = await compu.newContext({ locale: 'es-PA', viewport: { width: 1280, height: 800 } });
    const salon = await ctxA.newPage();
    vigilar(salon, 'salón (A)');
    await salon.goto(`${BASE}salon.html`);
    // Dentro de un paso: si ntfy.sh no responde (o limita con 429), cuenta como falla y no pasa en silencio.
    await paso('la computadora se conecta al relevo ntfy.sh', () => salon.waitForSelector('#conexion[data-estado=conectado]', { timeout: 45000 }));
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
  if (!SOLO_RELEVO) await mismoNavegador(browser);
} catch {
  /* el paso ya dijo qué falló */
}
try {
  if (!SOLO_RELEVO) await casosDeBorde(browser);
} catch {
  /* idem */
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
if (limitados.length) console.log(`ntfy.sh contestó 429 (límite por IP) ${limitados.length} veces; la página reintentó.`);
process.exit(fallan || errores.length ? 1 : 0);
