// Imprime la hoja de placas a PDF (como la imprimiría Chrome) y comprueba que salen cuatro por hoja carta.
// Con la fila a media hoja exacta, el borde empujaba la segunda fila y salían dos por hoja (pasó el 3-oct).
//   node herramientas/placas-pdf.mjs [salida.pdf]   (servidor en marcha)
const PW = new URL('./navegador.mjs', import.meta.url).href; // Playwright: ver herramientas/navegador.mjs
const { chromium } = await import(PW);
const { readFileSync } = await import('node:fs');
const BASE = process.env.BASE ?? 'http://localhost:4870/alphateklab-mesa/';
const SALIDA = process.argv[2] ?? 'capturas/placas.pdf';
const browser = await chromium.launch();
let placas = 0;
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}admin.html#mesas`);
  await page.waitForSelector('.placa-impresa .qr', { timeout: 10000 });
  placas = await page.locator('.placa-impresa').count();
  // Lo mismo que hace el botón «Imprimir N placas» antes de llamar a print().
  await page.evaluate(() => document.body.classList.add('imprimiendo-placas'));
  await page.pdf({ path: SALIDA, preferCSSPageSize: true, printBackground: true });
} finally {
  await browser.close();
}
const paginas = (readFileSync(SALIDA, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const esperadas = Math.ceil(placas / 4);
console.log(`${placas} placas en ${paginas} hojas (esperadas ${esperadas}) → ${SALIDA}`);
process.exit(paginas === esperadas ? 0 : 1);
