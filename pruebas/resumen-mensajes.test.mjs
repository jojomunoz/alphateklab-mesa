import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicar, estadoVacio, mesaRt } from '../js/nucleo/caja.mjs';
import { planoEjemplo } from '../js/nucleo/semilla.mjs';
import { resumenMesa, expandirResumen, bytesDe, LIMITE_BYTES, esMasNuevo } from '../js/nucleo/resumen.mjs';
import { resumenCuenta } from '../js/nucleo/cuenta.mjs';
import { crearMensaje, leerMensaje, deNtfy, crearRegistro, temaSala, LIMITE_NTFY } from '../js/nucleo/mensajes.mjs';

const CARTA = JSON.parse(readFileSync(new URL('../datos/carta.json', import.meta.url)));
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
let k = 0;
const ap = (e, tipo, mesa, datos, remoto = true) => {
  const r = aplicar(e, { v: 1, tipo, mesa, datos, id: `r${++k}`, t: T0, disp: 'tel' }, { ahora: T0, remoto });
  assert.equal(r.error, undefined, r.error);
  return r.estado;
};

test('resumen de mesa: ida y vuelta por JSON da la misma cuenta que la caja', () => {
  let e = estadoVacio({ sala: 'abcdefghjk', carta: structuredClone(CARTA), plano: planoEjemplo(), ajustes: { aprobacion: 'ninguno' } });
  e = ap(e, 'pedido', 7, { renglones: [
    { plato: 'churrasco', cant: 1, mods: [{ grupo: 'termino', opcion: 'medio' }, { grupo: 'acomp', opcion: 'tajadas' }], nota: 'sin sal' },
    { plato: 'ron-coco', cant: 2, mods: [] },
  ] });
  e = ap(e, 'cuenta', 7, { accion: 'dividir', division: { tipo: 'iguales', n: 3 } });
  e = ap(e, 'pago', 7, { parte: 0, monto: 1034, propina: 103, metodo: 'yappy' });
  const s = resumenMesa(e, 7, CARTA, T0);
  const viaje = expandirResumen(JSON.parse(JSON.stringify(s)));
  const enCaja = resumenCuenta(mesaRt(e, 7).cuenta);
  const enTelefono = resumenCuenta(viaje.cuenta);
  assert.equal(enTelefono.total, enCaja.total);
  assert.deepEqual(enTelefono.itbms, enCaja.itbms);
  assert.deepEqual(enTelefono.division, enCaja.division);
  assert.equal(enTelefono.pendiente, 1034);
  assert.equal(viaje.cuenta.pedidos[0].renglones[0].nota, 'sin sal');
  assert.deepEqual(viaje.cuenta.pedidos[0].renglones[0].mods, [{ grupo: 'termino', opcion: 'medio' }, { grupo: 'acomp', opcion: 'tajadas' }]);
  assert.equal(viaje.cuenta.pedidos[0].renglones[0].nombre, ''); // el teléfono ya lo tiene en su carta
});

test('resumen: una mesa enorme sigue cabiendo en un mensaje de ntfy', () => {
  let e = estadoVacio({ sala: 'abcdefghjk', carta: structuredClone(CARTA), plano: planoEjemplo(), ajustes: { aprobacion: 'ninguno' } });
  const nota = 'Una nota larga de prueba para ocupar espacio, sin datos personales, de ciento cuarenta caracteres más o menos por renglón.';
  for (let ronda = 0; ronda < 6; ronda++) {
    e = ap(e, 'pedido', 8, { renglones: CARTA.platos.filter((p) => !p.agotado && (p.grupos ?? []).length === 0).slice(0, 10).map((p) => ({ plato: p.id, cant: 2, mods: [], nota })) });
  }
  e = ap(e, 'llamada', 8, { motivo: 'ayuda' });
  const s = resumenMesa(e, 8, CARTA, T0);
  assert.ok(bytesDe(s) <= LIMITE_BYTES, `${bytesDe(s)} bytes`);
  assert.ok(s.recortado >= 1);
  const msg = crearMensaje({ tipo: 'estado', mesa: 8, datos: s, id: 'estado-123', disp: 'caja' });
  assert.ok(new TextEncoder().encode(JSON.stringify(msg)).length < LIMITE_NTFY);
});

test('resumen de una mesa que no existe', () => {
  const e = estadoVacio({ sala: 'abcdefghjk', carta: CARTA, plano: planoEjemplo() });
  const r = expandirResumen(resumenMesa(e, 77, CARTA, T0));
  assert.equal(r.existe, false);
});

test('el teléfono se queda con el resumen más nuevo, también si la caja se restableció', () => {
  const a = { ep: 'e1', rev: 10, ts: 100 };
  assert.equal(esMasNuevo(null, a), true);
  assert.equal(esMasNuevo(a, { ep: 'e1', rev: 9, ts: 200 }), false);
  assert.equal(esMasNuevo(a, { ep: 'e1', rev: 11, ts: 50 }), true);
  assert.equal(esMasNuevo(a, { ep: 'e2', rev: 1, ts: 300 }), true); // restablecida: rev vuelve a empezar
  assert.equal(esMasNuevo(a, { ep: 'e0', rev: 99, ts: 10 }), false); // mensaje viejo de otra época
});

test('mensajes: crear y leer', () => {
  const m = crearMensaje({ tipo: 'pedido', mesa: 7, datos: { renglones: [] }, id: 'abc123', disp: 'tel', t: T0 });
  const r = leerMensaje(JSON.stringify(m));
  assert.ok(r.ok);
  assert.deepEqual(r.msg, m);
  assert.throws(() => crearMensaje({ tipo: 'borrar-todo', id: 'x1234' }), RangeError);
});

test('mensajes: lo que no cuadra se descarta sin lanzar', () => {
  const base = { v: 1, tipo: 'llamada', mesa: 7, datos: {}, id: 'abcd1', t: 1 };
  const casos = [
    ['{', 'json'],
    ['[]', 'forma'],
    [JSON.stringify({ ...base, v: 2 }), 'version'],
    [JSON.stringify({ ...base, tipo: 'liberar-mesa' }), 'tipo'],
    [JSON.stringify({ ...base, id: 'A B' }), 'id'],
    [JSON.stringify({ ...base, mesa: 0 }), 'mesa'],
    [JSON.stringify({ ...base, mesa: 7.5 }), 'mesa'],
    [JSON.stringify({ ...base, t: 'ayer' }), 't'],
    [JSON.stringify({ ...base, datos: null }), 'datos'],
    [JSON.stringify({ ...base, datos: 'x'.repeat(5000) }), 'grande'],
  ];
  for (const [texto, error] of casos) assert.equal(leerMensaje(texto).error, error, texto.slice(0, 40));
  assert.equal(leerMensaje(42).error, 'no-texto');
});

test('mensajes: evento SSE de ntfy (formato real del 3-oct)', () => {
  const ev = '{"id":"330Zu46iyxOL","time":1791007000,"expires":1791050200,"event":"message","topic":"atk-mesa-prueba","message":"{\\"v\\":1,\\"tipo\\":\\"pedir-estado\\",\\"mesa\\":7,\\"datos\\":{},\\"id\\":\\"pe-1234\\",\\"t\\":1}"}';
  const r = deNtfy(ev);
  assert.ok(r.ok);
  assert.equal(r.ntfyId, '330Zu46iyxOL');
  assert.equal(r.msg.tipo, 'pedir-estado');
  const abierto = deNtfy('{"id":"9qhApE7UUEj6","time":1791006998,"event":"open","topic":"atk-mesa-prueba"}');
  assert.equal(abierto.ok, false);
  assert.equal(abierto.error, 'no-mensaje');
  assert.equal(deNtfy('no es json').ok, false);
});

test('registro de vistos: cada id una vez, con memoria acotada', () => {
  const r = crearRegistro(3);
  assert.equal(r.nuevo('a'), true);
  assert.equal(r.nuevo('a'), false);
  r.nuevo('b');
  r.nuevo('c');
  r.nuevo('d'); // saca a «a»
  assert.equal(r.tamano, 3);
  assert.equal(r.tiene('a'), false);
  assert.equal(r.nuevo('d'), false);
});

test('tema del relevo', () => {
  assert.equal(temaSala('abcdefghjk'), 'atk-mesa-abcdefghjk');
});
