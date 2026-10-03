// Una aserción por regla que la revisión del 3-oct rompió sin que ninguna prueba fallara (11 mutaciones que
// sobrevivían). Cada una tiene su mutación en herramientas/mutaciones.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicar, estadoVacio, mesaRt, porAtender, MAX_RENGLONES } from '../js/nucleo/caja.mjs';
import { planoEjemplo } from '../js/nucleo/semilla.mjs';
import { resumenCuenta } from '../js/nucleo/cuenta.mjs';
import { puede, transicion, AVISO } from '../js/nucleo/estados.mjs';
import { MAX_CANT } from '../js/nucleo/carta.mjs';
import { leerParametros } from '../js/nucleo/url.mjs';

const CARTA = JSON.parse(readFileSync(new URL('../datos/carta.json', import.meta.url)));
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
let k = 0;

function nueva(ajustes = {}) {
  return estadoVacio({ sala: 'abcdefghjk', carta: structuredClone(CARTA), plano: planoEjemplo(() => '123'), ajustes });
}
function hacer(e, tipo, mesa, datos = {}, { remoto = false, ahora = T0 } = {}) {
  return aplicar(e, { v: 1, tipo, mesa, datos, id: `r${++k}`, t: ahora, disp: 'tel' }, { ahora, remoto });
}
function ok(e, ...args) {
  const r = hacer(e, ...args);
  assert.equal(r.error, undefined, `${args[0]}: ${r.error} ${JSON.stringify(r.detalle ?? '')}`);
  return r.estado;
}
const CERVEZA = { renglones: [{ plato: 'cerveza', cant: 1, mods: [] }] };
const pedidoDe = (e, n, i = -1) => mesaRt(e, n).cuenta.pedidos.at(i).id;

test('un pedido sobre una mesa pagada la reabre: vuelve a «ocupada» y con saldo', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 3, CERVEZA, { remoto: true });
  e = ok(e, 'cobrar', 3, { pagos: [{ metodo: 'efectivo', monto: resumenCuenta(mesaRt(e, 3).cuenta).total }] });
  assert.equal(mesaRt(e, 3).estado, 'pagada');
  e = ok(e, 'pedido', 3, CERVEZA, { remoto: true });
  assert.equal(mesaRt(e, 3).estado, 'ocupada');
  assert.ok(resumenCuenta(mesaRt(e, 3).cuenta).saldoConfirmado > 0);
});

test('con un pedido por aceptar, la mesa no queda «pagada» aunque lo aceptado esté cobrado', () => {
  let e = nueva({ aprobacion: 'primero' });
  e = ok(e, 'pedido', 3, CERVEZA, { remoto: true });
  e = ok(e, 'aceptar-pedido', null, { pedido: pedidoDe(e, 3) });
  // Otro pedido que espera al mesero (con «todos» espera también el segundo).
  e.ajustes.aprobacion = 'todos';
  e = ok(e, 'pedido', 3, CERVEZA, { remoto: true });
  assert.equal(mesaRt(e, 3).cuenta.pedidos.at(-1).estado, 'por-aceptar');
  e = ok(e, 'cobrar', 3, { pagos: [{ metodo: 'efectivo', monto: resumenCuenta(mesaRt(e, 3).cuenta).total }] });
  assert.equal(mesaRt(e, 3).estado, 'ocupada');
});

test('no se libera una mesa pagada que todavía tiene un pago por confirmar', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 3, { renglones: [{ plato: 'cerveza', cant: 2, mods: [] }] }, { remoto: true });
  e.mesas[3].cuenta.pedidos[0].estado = 'servido'; // ya servido: lo único que frena es el pago por confirmar
  e = ok(e, 'cuenta', 3, { accion: 'dividir', division: { tipo: 'iguales', n: 2 } }, { remoto: true });
  const [a, b] = resumenCuenta(mesaRt(e, 3).cuenta).division.partes;
  e = ok(e, 'pago', 3, { parte: 0, monto: a.monto, propina: 0, metodo: 'yappy' }, { remoto: true });
  e = ok(e, 'cobrar', 3, { pagos: [{ metodo: 'efectivo', monto: b.monto }] });
  e = ok(e, 'pago', 3, { parte: 1, monto: b.monto, propina: 0, metodo: 'tarjeta' }, { remoto: true });
  const pagos = mesaRt(e, 3).cuenta.pagos;
  e = ok(e, 'confirmar-pago', 3, { pago: pagos[0].id });
  assert.equal(mesaRt(e, 3).estado, 'pagada');
  assert.ok(mesaRt(e, 3).cuenta.pagos.some((p) => p.estado === 'pendiente'));
  assert.equal(hacer(e, 'liberar-mesa', 3).error, 'pagos-pendientes');
});

test('pagar una parte con un monto distinto al de la parte se rechaza', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 3, { renglones: [{ plato: 'chicha-tamarindo', cant: 2, mods: [] }] }, { remoto: true });
  e = ok(e, 'cuenta', 3, { accion: 'dividir', division: { tipo: 'iguales', n: 3 } }, { remoto: true });
  const parte = resumenCuenta(mesaRt(e, 3).cuenta).division.partes[0];
  assert.equal(hacer(e, 'pago', 3, { parte: 0, monto: parte.monto - 1, propina: 0, metodo: 'yappy' }, { remoto: true }).error, 'monto');
  assert.equal(hacer(e, 'pago', 3, { parte: 0, monto: parte.monto, propina: 0, metodo: 'yappy' }, { remoto: true }).error, undefined);
});

test('un aviso atendido o cancelado ya no cambia (tampoco a «cancelada»)', () => {
  assert.equal(puede(AVISO, 'atendida', 'cancelada'), false);
  assert.equal(puede(AVISO, 'cancelada', 'atendida'), false);
  assert.equal(transicion(AVISO, 'atendida', 'cancelada').ok, false);
  let e = nueva();
  e = ok(e, 'llamada', 5, { motivo: 'pedir' }, { remoto: true });
  const aviso = mesaRt(e, 5).cuenta.avisos[0].id;
  e = ok(e, 'atender-aviso', 5, { aviso });
  const r = hacer(e, 'cancelar-aviso', 5, { aviso }, { remoto: true });
  assert.equal(r.error, 'transicion');
  assert.equal(mesaRt(r.estado, 5).cuenta.avisos[0].estado, 'atendida');
});

test(`tope de ${MAX_RENGLONES} renglones por pedido y de ${MAX_CANT} por renglón`, () => {
  const e = nueva();
  const renglones = (n) => Array.from({ length: n }, () => ({ plato: 'cerveza', cant: 1, mods: [] }));
  assert.equal(hacer(e, 'pedido', 3, { renglones: renglones(MAX_RENGLONES) }, { remoto: true }).error, undefined);
  assert.equal(hacer(e, 'pedido', 3, { renglones: renglones(MAX_RENGLONES + 1) }, { remoto: true }).error, 'pedido-largo');
  assert.equal(hacer(e, 'pedido', 3, { renglones: [{ plato: 'cerveza', cant: MAX_CANT, mods: [] }] }, { remoto: true }).error, undefined);
  assert.equal(hacer(e, 'pedido', 3, { renglones: [{ plato: 'cerveza', cant: MAX_CANT + 1, mods: [] }] }, { remoto: true }).error, 'cantidad');
  assert.equal(MAX_CANT, 20, 'el texto de error dice «de 1 a 20»');
});

test('«Por atender» va del más viejo al más nuevo', () => {
  let e = nueva();
  e = ok(e, 'llamada', 5, { motivo: 'pedir' }, { remoto: true, ahora: T0 + 3000 });
  e = ok(e, 'pedido', 2, CERVEZA, { remoto: true, ahora: T0 + 1000 });
  e = ok(e, 'llamada', 9, { motivo: 'ayuda' }, { remoto: true, ahora: T0 + 2000 });
  assert.deepEqual(porAtender(e).map((x) => x.mesa), [2, 9, 5]);
});

test('el nombre del local no puede quedar vacío', () => {
  const e = nueva();
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { nombre: '   ' } }).error, 'ajustes');
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { nombre: '' } }).error, 'ajustes');
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { nombre: 'x'.repeat(61) } }).error, 'ajustes');
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { nombre: 'Otro local' } }).estado.ajustes.nombre, 'Otro local');
});

test('kiosco: después de la orden 999 viene la 001', () => {
  let e = nueva();
  e.kiosco.siguiente = 999;
  const r = hacer(e, 'kiosco-orden', null, { renglones: [{ plato: 'cerveza', cant: 1, mods: [] }], llevar: false, pago: 'caja' });
  assert.equal(r.orden, 999);
  e = r.estado;
  assert.equal(e.kiosco.siguiente, 1);
  assert.equal(hacer(e, 'kiosco-orden', null, { renglones: [{ plato: 'cerveza', cant: 1, mods: [] }], pago: 'caja' }).orden, 1);
});

test('la mesa de la URL va en cifras: «1e1», «7.0» o «0x7» no son la mesa 10 ni la 7', () => {
  for (const m of ['1e1', '7.0', '0x7', '+7', ' 7a']) {
    const r = leerParametros(`?sala=abcdefghjk&m=${encodeURIComponent(m)}`);
    assert.equal(r.mesa, null, m);
    assert.ok(r.errores.includes('mesa'), m);
  }
  assert.equal(leerParametros('?sala=abcdefghjk&m=10').mesa, 10);
});
