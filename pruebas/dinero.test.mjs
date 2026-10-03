import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dividirRedondeando, impuestoContenido, desglosarItbms, formatear, leerMonto, sumar } from '../js/nucleo/dinero.mjs';

test('redondeo mitad hacia arriba con enteros', () => {
  assert.equal(dividirRedondeando(5, 2), 3); // 2,5 → 3
  assert.equal(dividirRedondeando(15, 10), 2); // 1,5 → 2
  assert.equal(dividirRedondeando(14, 10), 1); // 1,4 → 1
  assert.equal(dividirRedondeando(25, 10), 3); // 2,5 → 3 (no al par)
  assert.equal(dividirRedondeando(0, 7), 0);
  assert.throws(() => dividirRedondeando(-1, 2), RangeError);
  assert.throws(() => dividirRedondeando(1.5, 2), TypeError);
});

test('ITBMS contenido: precio × tasa / (100 + tasa), al centésimo', () => {
  assert.equal(impuestoContenido(1070, 7), 70); // B/. 10.70 con 7 % lleva B/. 0.70
  assert.equal(impuestoContenido(1000, 7), 65); // 65,42 → 65
  assert.equal(impuestoContenido(1100, 10), 100); // bebida con alcohol: 10 %
  assert.equal(impuestoContenido(300, 10), 27); // 27,27 → 27
  assert.equal(impuestoContenido(650, 10), 59); // 59,09 → 59
  assert.equal(impuestoContenido(950, 7), 62); // 62,15 → 62
  assert.equal(impuestoContenido(500, 0), 0);
  assert.throws(() => impuestoContenido(1000, 12), RangeError);
  assert.throws(() => impuestoContenido(10.5, 7), TypeError);
});

test('desglose por tasa, redondeando por renglón', () => {
  const d = desglosarItbms([
    { monto: 100, tasa: 7 },
    { monto: 100, tasa: 7 },
    { monto: 100, tasa: 7 },
    { monto: 600, tasa: 10 },
  ]);
  // Cada renglón de 1.00 lleva 0,0654 → 7 centésimos; tres renglones = 21 (no 20, que daría redondear el total).
  assert.equal(d.porTasa[0].tasa, 7);
  assert.equal(d.porTasa[0].impuesto, 21);
  assert.equal(d.porTasa[0].total, 300);
  assert.equal(d.porTasa[0].base, 279);
  assert.equal(d.porTasa[1].tasa, 10);
  assert.equal(d.porTasa[1].impuesto, 55); // 54,55 → 55
  assert.equal(d.total, 900);
  assert.equal(d.impuesto, 76);
  assert.equal(d.base + d.impuesto, d.total);
});

test('desglose vacío', () => {
  const d = desglosarItbms([]);
  assert.deepEqual(d, { total: 0, impuesto: 0, base: 0, porTasa: [] });
});

test('formato panameño: punto decimal y coma de miles', () => {
  assert.equal(formatear(0), 'B/. 0.00');
  assert.equal(formatear(5), 'B/. 0.05');
  assert.equal(formatear(4500), 'B/. 45.00');
  assert.equal(formatear(123456), 'B/. 1,234.56');
  assert.equal(formatear(100000000), 'B/. 1,000,000.00');
  assert.equal(formatear(-150), '−B/. 1.50');
  assert.equal(formatear(450, { simbolo: false }), '4.50');
  assert.throws(() => formatear(1.5), TypeError);
});

test('leer montos escritos por una persona', () => {
  assert.equal(leerMonto('4.50'), 450);
  assert.equal(leerMonto('4,50'), 450);
  assert.equal(leerMonto('4,5'), 450);
  assert.equal(leerMonto('4'), 400);
  assert.equal(leerMonto(' B/. 12 '), 1200);
  assert.equal(leerMonto('$3.25'), 325);
  assert.equal(leerMonto('1,500'), 150000); // tres cifras tras la coma: miles
  assert.equal(leerMonto('1.234,50'), 123450);
  assert.equal(leerMonto('1,234.50'), 123450);
  assert.equal(leerMonto('.5'), 50);
  assert.equal(leerMonto(''), null);
  assert.equal(leerMonto('abc'), null);
  assert.equal(leerMonto('-3'), null);
  assert.equal(leerMonto('4.505'), 450500); // tres cifras tras el punto: miles (B/. 4,505.00)
  assert.equal(leerMonto('4.5.0'), null);
  assert.equal(leerMonto(null), null);
});

test('sumar exige enteros', () => {
  assert.equal(sumar([100, 250, 5]), 355);
  assert.throws(() => sumar([1, 0.5]), TypeError);
});
