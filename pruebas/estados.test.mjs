import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PEDIDO, PEDIDO_DESHACER, AVISO, MESA, PAGO, transicion, puede } from '../js/nucleo/estados.mjs';

test('pedido: el camino completo es válido', () => {
  const camino = ['por-aceptar', 'enviado', 'recibido', 'en-preparacion', 'listo', 'servido'];
  for (let i = 0; i < camino.length - 1; i++) assert.ok(transicion(PEDIDO, camino[i], camino[i + 1]).ok, `${camino[i]} → ${camino[i + 1]}`);
  assert.ok(transicion(PEDIDO, 'por-aceptar', 'rechazado').ok);
  assert.ok(transicion(PEDIDO, 'enviado', 'en-preparacion').ok);
});

test('pedido: saltos y vueltas atrás se rechazan', () => {
  for (const [de, a] of [
    ['por-aceptar', 'listo'],
    ['enviado', 'servido'],
    ['servido', 'listo'],
    ['listo', 'en-preparacion'],
    ['rechazado', 'enviado'],
    ['servido', 'rechazado'],
    ['en-preparacion', 'rechazado'],
  ]) {
    const r = transicion(PEDIDO, de, a);
    assert.equal(r.ok, false, `${de} → ${a}`);
    assert.match(r.error, /no se puede pasar/);
  }
  assert.equal(transicion(PEDIDO, 'inventado', 'listo').ok, false);
});

test('pedido: «Deshacer» de la cocina solo con la tabla de deshacer', () => {
  assert.equal(transicion(PEDIDO, 'listo', 'en-preparacion').ok, false);
  assert.ok(transicion(PEDIDO, 'listo', 'en-preparacion', { deshacer: PEDIDO_DESHACER }).ok);
  assert.ok(transicion(PEDIDO, 'en-preparacion', 'recibido', { deshacer: PEDIDO_DESHACER }).ok);
  assert.equal(transicion(PEDIDO, 'servido', 'listo', { deshacer: PEDIDO_DESHACER }).ok, false);
});

test('aviso: abierta → atendida o cancelada, y de ahí no se mueve', () => {
  assert.ok(puede(AVISO, 'abierta', 'atendida'));
  assert.ok(puede(AVISO, 'abierta', 'cancelada'));
  assert.equal(puede(AVISO, 'atendida', 'abierta'), false);
  assert.equal(puede(AVISO, 'cancelada', 'atendida'), false);
});

test('mesa: libre → ocupada → pagada → libre', () => {
  assert.ok(puede(MESA, 'libre', 'ocupada'));
  assert.ok(puede(MESA, 'ocupada', 'pagada'));
  assert.ok(puede(MESA, 'pagada', 'libre'));
  assert.ok(puede(MESA, 'pagada', 'ocupada'));
  assert.equal(puede(MESA, 'libre', 'pagada'), false);
  assert.equal(puede(MESA, 'libre', 'libre'), false);
});

test('pago: pendiente → confirmado o rechazado; confirmado no vuelve', () => {
  assert.ok(puede(PAGO, 'pendiente', 'confirmado'));
  assert.ok(puede(PAGO, 'pendiente', 'rechazado'));
  assert.equal(puede(PAGO, 'confirmado', 'pendiente'), false);
  assert.equal(puede(PAGO, 'rechazado', 'confirmado'), false);
});
