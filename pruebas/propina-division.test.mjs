import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propinaPorcentaje, resolverPropina, opcionesPropina } from '../js/nucleo/propina.mjs';
import { partesIguales, porPlatos } from '../js/nucleo/division.mjs';

test('propina: porcentaje sobre el total consumido, mitad hacia arriba', () => {
  assert.equal(propinaPorcentaje(4500, 10), 450); // 10 % de B/. 45.00 = B/. 4.50
  assert.equal(propinaPorcentaje(45, 10), 5); // 4,5 centésimos → 5
  assert.equal(propinaPorcentaje(1030, 15), 155); // 154,5 → 155
  assert.equal(propinaPorcentaje(0, 20), 0);
  assert.throws(() => propinaPorcentaje(100, 10.5), RangeError);
  assert.throws(() => propinaPorcentaje(-1, 10), RangeError);
});

test('propina: sin elección no hay propina ni se puede seguir', () => {
  assert.deepEqual(resolverPropina(4500, null), { ok: false, motivo: 'sin-eleccion' });
  assert.deepEqual(resolverPropina(4500, undefined), { ok: false, motivo: 'sin-eleccion' });
});

test('propina: cada opción', () => {
  assert.deepEqual(resolverPropina(4500, { tipo: 'pct', pct: 10 }), { ok: true, propina: 450, base: 4500, total: 4950, pct: 10 });
  assert.deepEqual(resolverPropina(4500, { tipo: 'ninguna' }), { ok: true, propina: 0, base: 4500, total: 4500, pct: 0 });
  assert.equal(resolverPropina(4500, { tipo: 'monto', texto: '3,50' }).propina, 350);
  assert.equal(resolverPropina(4500, { tipo: 'monto', monto: 0 }).propina, 0);
  assert.equal(resolverPropina(4500, { tipo: 'monto', texto: 'mucho' }).motivo, 'monto-ilegible');
  assert.equal(resolverPropina(4500, { tipo: 'monto', monto: -100 }).motivo, 'monto-negativo');
  assert.equal(resolverPropina(4500, { tipo: 'monto', texto: '450' }).motivo, 'monto-alto'); // «450» por «4.50»
  assert.equal(resolverPropina(4500, { tipo: 'pct', pct: 101 }).motivo, 'pct');
});

test('propina: opciones en orden, la primera es 10 %, ninguna marcada', () => {
  const o = opcionesPropina([10, 15, 20]);
  assert.deepEqual(o.map((x) => x.pct ?? x.tipo), [10, 15, 20, 'monto', 'ninguna']);
  assert.ok(o.every((x) => !('seleccionada' in x) && !('marcada' in x)));
  assert.deepEqual(opcionesPropina([10, 10, 0, 99]).map((x) => x.pct ?? x.tipo), [10, 'monto', 'ninguna']);
});

test('partes iguales: el resto va de a 1 centésimo a las primeras', () => {
  assert.deepEqual(partesIguales(100, 3), [34, 33, 33]);
  assert.deepEqual(partesIguales(4500, 3), [1500, 1500, 1500]);
  assert.deepEqual(partesIguales(1001, 4), [251, 250, 250, 250]);
  assert.deepEqual(partesIguales(2, 3), [1, 1, 0]);
  assert.deepEqual(partesIguales(500, 1), [500]);
  assert.throws(() => partesIguales(100, 0), RangeError);
  assert.throws(() => partesIguales(100, 21), RangeError);
  assert.throws(() => partesIguales(10.5, 2), RangeError);
});

test('partes iguales: nunca se pierde ni se inventa un centésimo (barrido)', () => {
  for (let total = 0; total <= 3000; total += 7) {
    for (let n = 1; n <= 20; n++) {
      const p = partesIguales(total, n);
      assert.equal(p.length, n);
      assert.equal(p.reduce((a, b) => a + b, 0), total, `total ${total} entre ${n}`);
      assert.ok(Math.max(...p) - Math.min(...p) <= 1);
    }
  }
});

test('por platos: compartido entre varias, sin perder centésimos', () => {
  const renglones = [
    { clave: 'a', monto: 1200 }, // ropa vieja de la persona 0
    { clave: 'b', monto: 850 }, // ceviche compartido entre 0, 1 y 2
    { clave: 'c', monto: 300 }, // cerveza de la persona 2
  ];
  const r = porPlatos(renglones, { a: [0], b: [2, 0, 1, 1], c: [2] }, 3);
  // 850 entre 3 = [284, 283, 283] en el orden de las personas (0, 1, 2)
  assert.deepEqual(r.partes, [1200 + 284, 283, 283 + 300]);
  assert.equal(r.partes.reduce((a, b) => a + b, 0), r.total);
  assert.deepEqual(r.sinAsignar, []);
  assert.deepEqual(r.detalle[1], [{ clave: 'b', monto: 283 }]);
});

test('por platos: lo que nadie tomó queda aparte y la suma sigue cuadrando', () => {
  const r = porPlatos([{ clave: 'a', monto: 500 }, { clave: 'b', monto: 333 }], { a: [0, 1], b: [7] }, 2);
  assert.deepEqual(r.partes, [250, 250]);
  assert.deepEqual(r.sinAsignar, [{ clave: 'b', monto: 333 }]);
  assert.equal(r.partes.reduce((a, b) => a + b, 0) + 333, r.total);
});
