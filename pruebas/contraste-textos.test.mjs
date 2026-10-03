import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { contraste, leerTokens } from '../js/nucleo/contraste.mjs';
import { T, ERRORES_COMENSAL, ERRORES_PERSONAL, t, textoError } from '../js/nucleo/textos.mjs';

const CSS = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
const claro = leerTokens(CSS, ':root {');
const oscuroMedia = leerTokens(CSS, ":root:not([data-tema='claro']) {");
const oscuroAttr = leerTokens(CSS, ":root[data-tema='oscuro'] {");
const cocina = leerTokens(CSS, '.tema-cocina {');

// [texto, fondo, mínimo]. 4,5 para texto; 3 para texto grande (≥ 19 px en negrita) y bordes de controles.
const PARES = [
  ['tinta', 'fondo', 4.5],
  ['tinta', 'superficie', 4.5],
  ['tinta', 'superficie-2', 4.5],
  ['tinta-2', 'fondo', 4.5],
  ['tinta-2', 'superficie', 4.5],
  ['tinta-2', 'superficie-2', 4.5],
  ['sobre-primario', 'primario', 4.5],
  ['primario-texto', 'fondo', 4.5],
  ['primario-texto', 'superficie', 4.5],
  ['primario-texto', 'primario-suave', 4.5],
  ['tinta', 'primario-suave', 4.5],
  ['sobre-pixbae', 'pixbae', 3], // solo la cifra del carrito, en negrita de 19 px o más
  ['ok', 'ok-suave', 4.5],
  ['ok', 'superficie', 4.5],
  ['espera', 'espera-suave', 4.5],
  ['espera', 'superficie', 4.5],
  ['alerta', 'alerta-suave', 4.5],
  ['alerta', 'superficie', 4.5],
  ['borde', 'superficie', 3],
  ['borde', 'fondo', 3],
  ['foco', 'fondo', 3],
  ['foco', 'superficie', 3],
];

for (const [nombre, tokens] of [['claro', claro], ['oscuro', oscuroMedia]]) {
  test(`contraste medido, tema ${nombre}`, () => {
    for (const [a, b, min] of PARES) {
      assert.ok(tokens[a] && tokens[b], `falta --${a} o --${b} en el tema ${nombre}`);
      const c = contraste(tokens[a], tokens[b]);
      assert.ok(c >= min, `--${a} sobre --${b}: ${c.toFixed(2)} < ${min} (${nombre})`);
    }
  });
}

test('el tema oscuro por preferencia y el forzado son idénticos', () => {
  assert.deepEqual(oscuroAttr, oscuroMedia);
  assert.deepEqual(Object.keys(oscuroMedia).sort(), Object.keys(claro).sort());
});

test('contraste de la cocina (siempre oscura, tickets de papel)', () => {
  for (const [a, b, min] of [
    ['papel-tinta', 'papel', 4.5],
    ['papel-tinta-2', 'papel', 4.5],
    ['sobre-riel', 'riel', 4.5],
    ['sobre-riel-2', 'riel', 4.5],
    ['sobre-riel', 'riel-2', 4.5],
    ['sobre-riel-2', 'riel-2', 4.5],
    ['sobre-banda', 'banda-verde', 4.5],
    ['sobre-banda', 'banda-ambar', 4.5],
    ['sobre-banda', 'banda-rojo', 4.5],
    ['banda-verde', 'papel', 4.5],
    ['foco-cocina', 'riel', 3],
  ]) {
    const c = contraste(cocina[a], cocina[b]);
    assert.ok(c >= min, `--${a} sobre --${b}: ${c.toFixed(2)}`);
  }
});

test('los colores fijos que pide la especificación no se movieron', () => {
  assert.equal(claro.fondo, '#f3f5f1');
  assert.equal(claro.superficie, '#fbfcfa');
  assert.equal(claro.tinta, '#1b1f1c');
  assert.equal(claro.primario, '#1f5130');
  assert.equal(claro.pixbae, '#d8452a');
  assert.equal(claro.ok, '#1d7a3e');
  assert.equal(claro.espera, '#a15c07');
  assert.equal(claro.alerta, '#b42318');
});

test('cada texto existe en español y en inglés', () => {
  const es = Object.keys(T.es).sort();
  const en = Object.keys(T.en).sort();
  assert.deepEqual(en, es);
  for (const k of es) {
    assert.ok(T.es[k].trim(), `vacío en es: ${k}`);
    assert.ok(T.en[k].trim(), `vacío en en: ${k}`);
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(vars(T.en[k]), vars(T.es[k]), `variables distintas en ${k}`);
  }
  assert.equal(t('es', 'mesaTitulo', { n: 7 }), 'Mesa 7');
  assert.equal(t('en', 'pctDetalle', { pct: 10, base: 'B/. 45.00', monto: 'B/. 4.50' }), '10 % of B/. 45.00 = B/. 4.50');
});

test('cada código de error que puede devolver la caja tiene su texto', () => {
  const dir = new URL('../js/nucleo/', import.meta.url);
  const codigos = new Set();
  // Los módulos que producen errores que ve una persona (mensajes.mjs descarta en silencio lo que no cuadra).
  for (const f of readdirSync(dir).filter((x) => ['caja.mjs', 'carta.mjs', 'cuenta.mjs'].includes(x))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/fallo\('([a-z-]+)'/g)) codigos.add(m[1]);
    for (const m of src.matchAll(/error: '([a-z-]+)'/g)) codigos.add(m[1]);
  }
  // errores que solo usa el módulo de propina (los traduce la pantalla con 'propina.<motivo>')
  for (const c of ['sin-eleccion', 'monto-ilegible', 'monto-negativo', 'base', 'pct']) codigos.delete(c);
  const conocidos = new Set([...Object.keys(ERRORES_COMENSAL.es), ...Object.keys(ERRORES_PERSONAL)]);
  const faltan = [...codigos].filter((c) => !conocidos.has(c));
  assert.deepEqual(faltan, []);
  assert.deepEqual(Object.keys(ERRORES_COMENSAL.en).sort(), Object.keys(ERRORES_COMENSAL.es).sort());
  assert.equal(textoError('saldo-pendiente', 'es', 'B/. 3.00'), 'Falta cobrar B/. 3.00. Cobra la cuenta antes de liberar la mesa.');
});
