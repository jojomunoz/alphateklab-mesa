import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicar, estadoVacio, mesaRt } from '../js/nucleo/caja.mjs';
import { planoEjemplo } from '../js/nucleo/semilla.mjs';
import { resumenMesa, expandirResumen } from '../js/nucleo/resumen.mjs';
import { resolverIntentos, datosParaGuardar, MAX_PROPIOS } from '../js/nucleo/intentos.mjs';

const CARTA = JSON.parse(readFileSync(new URL('../datos/carta.json', import.meta.url)));
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

// Lo que ve el teléfono: el resumen de la caja, ida y vuelta por JSON como por el relevo.
const verDesdeTelefono = (e, n, ahora) => expandirResumen(JSON.parse(JSON.stringify(resumenMesa(e, n, CARTA, ahora))));

function caja() {
  return estadoVacio({ sala: 'abcdefghjk', carta: structuredClone(CARTA), plano: planoEjemplo(() => '123') });
}

test('rechazo del único pedido de la mesa: el teléfono que lo mandó se entera, con el motivo', () => {
  let e = caja();
  const intentos = new Map();
  const propios = new Map();
  const datos = { renglones: [{ plato: 'cerveza', cant: 1, mods: [], nota: '' }], pin: '412' };
  intentos.set('ped-1', { tipo: 'pedido', datos: datosParaGuardar(datos), t: T0, envio: 'publicado' });

  e = aplicar(e, { v: 1, tipo: 'pedido', mesa: 7, datos, id: 'ped-1', t: T0, disp: 'tel1' }, { ahora: T0, remoto: true }).estado;
  assert.equal(resolverIntentos(intentos, propios, verDesdeTelefono(e, 7, T0 + 1)), true);
  assert.equal(intentos.size, 0, 'el resumen ya muestra el pedido «por aceptar»');
  assert.ok(propios.has('ped-1'));
  assert.equal(propios.get('ped-1').datos.pin, undefined, 'el PIN no queda guardado');

  e = aplicar(e, { v: 1, tipo: 'rechazar-pedido', mesa: null, datos: { pedido: 'ped-1', motivo: 'Pedido desde fuera del local' }, id: 'r1', t: T0 + 2 }, { ahora: T0 + 2 }).estado;
  assert.equal(mesaRt(e, 7).cuenta, null, 'la mesa vuelve a quedar libre');
  const r = verDesdeTelefono(e, 7, T0 + 3);
  assert.equal(r.cuenta, null);
  resolverIntentos(intentos, propios, r);
  const it = intentos.get('ped-1');
  assert.ok(it, 'el pedido rechazado vuelve a la pantalla');
  assert.equal(it.envio, 'error');
  assert.equal(it.error, 'rechazado');
  assert.equal(it.detalle, 'Pedido desde fuera del local');
  assert.deepEqual(it.datos.renglones.map((x) => x.plato), ['cerveza'], 'con sus platos, para «Ver pedido»');
  assert.equal(propios.has('ped-1'), false);

  // Si el comensal lo descarta, un resumen posterior no lo vuelve a sacar.
  intentos.delete('ped-1');
  resolverIntentos(intentos, propios, verDesdeTelefono(e, 7, T0 + 4));
  assert.equal(intentos.size, 0);
});

test('pedidos propios: se olvidan al cerrarse la cuenta sin error, y no pasan de un tope', () => {
  let e = caja();
  e.ajustes.aprobacion = 'ninguno';
  const intentos = new Map([['p1', { tipo: 'pedido', datos: { renglones: [] }, t: T0, envio: 'publicado' }]]);
  const propios = new Map();
  e = aplicar(e, { v: 1, tipo: 'pedido', mesa: 3, datos: { renglones: [{ plato: 'cerveza', cant: 1, mods: [] }] }, id: 'p1', t: T0, disp: 'tel1' }, { ahora: T0 }).estado;
  resolverIntentos(intentos, propios, verDesdeTelefono(e, 3, T0));
  assert.ok(propios.has('p1'));
  // Otra época (alguien restableció la caja): el pedido no está y no hay error → se olvida, sin inventar un rechazo.
  resolverIntentos(intentos, propios, verDesdeTelefono(caja(), 3, T0 + 1));
  assert.equal(propios.size, 0);
  assert.equal(intentos.size, 0);

  const muchos = new Map(Array.from({ length: MAX_PROPIOS + 5 }, (_, i) => [`x${i}`, { datos: {}, t: T0 + i }]));
  const r = { cuenta: { pedidos: [...muchos.keys()].map((id) => ({ id })), avisos: [], pagos: [] }, errores: [] };
  resolverIntentos(new Map(), muchos, r);
  assert.equal(muchos.size, MAX_PROPIOS);
  assert.ok(!muchos.has('x0') && muchos.has(`x${MAX_PROPIOS + 4}`), 'se van los más viejos');
});
