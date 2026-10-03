import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aplicar, estadoVacio, estadoVisible, porAtender, mesaRt, estadoInicialPedido, MAX_POR_ACEPTAR } from '../js/nucleo/caja.mjs';
import { planoEjemplo, crearSemilla } from '../js/nucleo/semilla.mjs';
import { resumenCuenta } from '../js/nucleo/cuenta.mjs';
import { ticketsCocina } from '../js/nucleo/cocina.mjs';

const CARTA = JSON.parse(readFileSync(new URL('../datos/carta.json', import.meta.url)));
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

function nueva(ajustes = {}) {
  return estadoVacio({ sala: 'abcdefghjk', carta: structuredClone(CARTA), plano: planoEjemplo(() => '123'), ajustes });
}

let k = 0;
function hacer(e, tipo, mesa, datos = {}, { remoto = false, ahora = T0, disp = 'tel1', id } = {}) {
  const r = aplicar(e, { v: 1, tipo, mesa, datos, id: id ?? `a${++k}`, t: ahora, disp }, { ahora, remoto });
  return r;
}
function ok(e, ...args) {
  const r = hacer(e, ...args);
  assert.equal(r.error, undefined, `${args[0]}: ${r.error} ${JSON.stringify(r.detalle ?? '')}`);
  return r.estado;
}

const PEDIDO_TIPICO = {
  renglones: [
    { plato: 'ropa-vieja', cant: 2, mods: [] },
    { plato: 'chicha-tamarindo', cant: 2, mods: [] },
    { plato: 'cerveza', cant: 1, mods: [] },
  ],
};

test('un pedido por QR entra «por aceptar» y no llega a cocina hasta que el mesero lo acepta', () => {
  let e = nueva();
  e = ok(e, 'pedido', 7, PEDIDO_TIPICO, { remoto: true });
  const m = mesaRt(e, 7);
  assert.equal(m.estado, 'ocupada');
  assert.equal(m.cuenta.pedidos[0].estado, 'por-aceptar');
  assert.equal(ticketsCocina(e).length, 0);
  assert.equal(estadoVisible(m), 'pidio');
  assert.deepEqual(porAtender(e).map((x) => x.tipo), ['aceptar']);
  e = ok(e, 'aceptar-pedido', null, { pedido: m.cuenta.pedidos[0].id });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'enviado');
  assert.equal(ticketsCocina(e).length, 2); // caliente y bar
});

test('la caja pone el precio con SU carta: lo que mande el teléfono no cuenta', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 3, { renglones: [{ plato: 'churrasco', cant: 1, precio: 1, unit: 1, monto: 1, mods: [{ grupo: 'termino', opcion: 'medio' }, { grupo: 'acomp', opcion: 'coco' }, { grupo: 'extra', opcion: 'huevo' }] }] }, { remoto: true });
  const r = mesaRt(e, 3).cuenta.pedidos[0].renglones[0];
  assert.equal(r.unit, 1800 + 100);
  assert.equal(r.monto, 1900);
  assert.equal(r.tasa, 7);
});

test('aprobación «primero»: solo el primer pedido de la mesa espera al mesero', () => {
  let e = nueva({ aprobacion: 'primero' });
  e = ok(e, 'pedido', 5, PEDIDO_TIPICO, { remoto: true });
  const p1 = mesaRt(e, 5).cuenta.pedidos[0];
  assert.equal(p1.estado, 'por-aceptar');
  e = ok(e, 'aceptar-pedido', null, { pedido: p1.id });
  e = ok(e, 'pedido', 5, { renglones: [{ plato: 'cocadas', cant: 1, mods: [] }] }, { remoto: true });
  assert.equal(mesaRt(e, 5).cuenta.pedidos[1].estado, 'enviado');
  assert.equal(mesaRt(e, 5).cuenta.pedidos[1].ronda, 2);
});

test('aprobación «ninguno»: directo a cocina; «todos»: siempre espera', () => {
  assert.equal(estadoInicialPedido('ninguno', null), 'enviado');
  assert.equal(estadoInicialPedido('todos', { cuenta: { pedidos: [{ estado: 'servido' }] } }), 'por-aceptar');
  assert.equal(estadoInicialPedido('primero', { cuenta: { pedidos: [{ estado: 'rechazado' }] } }), 'por-aceptar');
  assert.equal(estadoInicialPedido('primero', { cuenta: { pedidos: [{ estado: 'servido' }] } }), 'enviado');
});

test('anti-abuso: no más de 3 pedidos esperando al mesero en una mesa', () => {
  let e = nueva();
  for (let i = 0; i < MAX_POR_ACEPTAR; i++) e = ok(e, 'pedido', 9, { renglones: [{ plato: 'agua', cant: 1, mods: [] }] }, { remoto: true });
  const r = hacer(e, 'pedido', 9, { renglones: [{ plato: 'agua', cant: 1, mods: [] }] }, { remoto: true });
  assert.equal(r.error, 'demasiados');
  assert.equal(mesaRt(r.estado, 9).cuenta.pedidos.length, 3);
  assert.equal(r.estado.errores[0].motivo, 'demasiados'); // el teléfono lo ve en su resumen
});

test('PIN de mesa: con el ajuste encendido, sin el PIN correcto no hay pedido', () => {
  let e = nueva({ pin: true });
  const malo = hacer(e, 'pedido', 7, { ...PEDIDO_TIPICO, pin: '999' }, { remoto: true });
  assert.equal(malo.error, 'pin');
  assert.equal(mesaRt(malo.estado, 7).estado, 'libre');
  const bueno = hacer(malo.estado, 'pedido', 7, { ...PEDIDO_TIPICO, pin: '123' }, { remoto: true });
  assert.equal(bueno.error, undefined);
});

test('por el relevo público solo entra lo que hace un comensal', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 2, PEDIDO_TIPICO, { remoto: true });
  e = ok(e, 'pago', 2, { parte: null, monto: 1000, propina: 0, metodo: 'yappy' }, { remoto: true });
  const pago = mesaRt(e, 2).cuenta.pagos[0];
  for (const [tipo, datos] of [
    ['confirmar-pago', { pago: pago.id }],
    ['liberar-mesa', {}],
    ['cobrar', { pagos: [{ metodo: 'efectivo', monto: 100 }] }],
    ['guardar-ajustes', { ajustes: { aprobacion: 'ninguno' } }],
    ['agotado', { plato: 'cerveza', agotado: true }],
  ]) {
    const r = hacer(e, tipo, 2, datos, { remoto: true });
    assert.equal(r.error, 'no-permitido', tipo);
    assert.equal(r.cambio, false);
  }
  assert.equal(mesaRt(e, 2).cuenta.pagos[0].estado, 'pendiente');
});

test('idempotente: la misma acción dos veces se aplica una sola vez', () => {
  const e = nueva();
  const accion = { v: 1, tipo: 'pedido', mesa: 7, datos: PEDIDO_TIPICO, id: 'mismo-id-1', t: T0, disp: 'x' };
  const r1 = aplicar(e, accion, { ahora: T0, remoto: true });
  const r2 = aplicar(r1.estado, accion, { ahora: T0 + 5, remoto: true });
  assert.equal(r2.repetido, true);
  assert.equal(r2.cambio, false);
  assert.equal(r2.estado, r1.estado);
  assert.equal(mesaRt(r2.estado, 7).cuenta.pedidos.length, 1);
});

test('platos agotados, modificadores que faltan y mesas que no existen', () => {
  let e = nueva();
  e = ok(e, 'agotado', null, { plato: 'cerveza', agotado: true });
  assert.equal(hacer(e, 'pedido', 7, { renglones: [{ plato: 'cerveza', cant: 1, mods: [] }] }, { remoto: true }).error, 'agotado');
  assert.equal(hacer(e, 'pedido', 7, { renglones: [{ plato: 'churrasco', cant: 1, mods: [] }] }, { remoto: true }).error, 'faltan-modificadores');
  assert.equal(hacer(e, 'pedido', 7, { renglones: [{ plato: 'agua', cant: 0, mods: [] }] }, { remoto: true }).error, 'cantidad');
  assert.equal(hacer(e, 'pedido', 57, PEDIDO_TIPICO, { remoto: true }).error, 'mesa-inexistente');
  assert.equal(hacer(e, 'pedido', 7, { renglones: [] }, { remoto: true }).error, 'pedido-vacio');
});

test('cocina: tocar renglones, listo por estación, deshacer y servir', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 7, PEDIDO_TIPICO, { remoto: true });
  const id = mesaRt(e, 7).cuenta.pedidos[0].id;
  e = ok(e, 'cocina-recibir', null, { pedido: id });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'recibido');
  assert.equal(hacer(e, 'cocina-listo', null, { pedido: id, estacion: 'caliente' }).error, 'faltan-renglones');
  e = ok(e, 'cocina-renglon', null, { pedido: id, renglon: '1', hecho: true });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'en-preparacion');
  // deshacer el único renglón hecho vuelve a «recibido»
  e = ok(e, 'cocina-renglon', null, { pedido: id, renglon: '1', hecho: false });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'recibido');
  for (const r of ['1', '2', '3']) e = ok(e, 'cocina-renglon', null, { pedido: id, renglon: r, hecho: true });
  e = ok(e, 'cocina-listo', null, { pedido: id, estacion: 'caliente' });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'en-preparacion'); // falta el bar
  assert.equal(ticketsCocina(e).length, 1);
  e = ok(e, 'cocina-listo', null, { pedido: id, estacion: 'bar' });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'listo');
  assert.equal(ticketsCocina(e).length, 0);
  e = ok(e, 'cocina-deshacer-listo', null, { pedido: id, estacion: 'bar' });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'en-preparacion');
  e = ok(e, 'cocina-listo', null, { pedido: id, estacion: 'bar' });
  e = ok(e, 'servir-pedido', null, { pedido: id });
  assert.equal(mesaRt(e, 7).cuenta.pedidos[0].estado, 'servido');
  assert.equal(hacer(e, 'cocina-deshacer-listo', null, { pedido: id, estacion: 'bar' }).error, 'transicion');
});

test('flujo completo: pedir la cuenta, dividir en 3, propina y pago confirmado por caja', () => {
  let e = nueva();
  e = ok(e, 'pedido', 7, PEDIDO_TIPICO, { remoto: true });
  const id = mesaRt(e, 7).cuenta.pedidos[0].id;
  e = ok(e, 'aceptar-pedido', null, { pedido: id });
  const total = 2 * 1200 + 2 * 250 + 300;
  assert.equal(resumenCuenta(mesaRt(e, 7).cuenta).total, total); // 3200
  e = ok(e, 'cuenta', 7, { accion: 'pedir' }, { remoto: true });
  assert.equal(estadoVisible(mesaRt(e, 7)), 'cuenta');
  e = ok(e, 'cuenta', 7, { accion: 'dividir', division: { tipo: 'iguales', n: 3 } }, { remoto: true });
  const div = mesaRt(e, 7).cuenta.division;
  assert.deepEqual(div.partes, [1067, 1067, 1066]);
  // Paga la parte 1 con 10 % de propina
  e = ok(e, 'pago', 7, { parte: 0, monto: 1067, propina: 107, metodo: 'yappy' }, { remoto: true });
  assert.equal(hacer(e, 'pago', 7, { parte: 0, monto: 1067, propina: 0, metodo: 'tarjeta' }, { remoto: true }).error, 'parte-tomada');
  assert.equal(hacer(e, 'cuenta', 7, { accion: 'dividir', division: { tipo: 'iguales', n: 2 } }, { remoto: true }).error, 'division-bloqueada');
  e = ok(e, 'pago', 7, { parte: 1, monto: 1067, propina: 0, metodo: 'tarjeta' }, { remoto: true });
  e = ok(e, 'pago', 7, { parte: 2, monto: 1066, propina: 160, metodo: 'mesero' }, { remoto: true });
  const pagos = mesaRt(e, 7).cuenta.pagos;
  assert.ok(pagos.every((p) => p.estado === 'pendiente'));
  assert.equal(mesaRt(e, 7).estado, 'ocupada'); // pendiente no es pagada
  e = ok(e, 'confirmar-pago', 7, { pago: pagos[0].id });
  e = ok(e, 'confirmar-pago', 7, { pago: pagos[1].id });
  assert.equal(mesaRt(e, 7).estado, 'ocupada');
  e = ok(e, 'confirmar-pago', 7, { pago: pagos[2].id });
  assert.equal(mesaRt(e, 7).estado, 'pagada');
  assert.equal(estadoVisible(mesaRt(e, 7)), 'pagada');
  // el aviso de cuenta se cerró solo al pagar
  assert.ok(mesaRt(e, 7).cuenta.avisos.every((a) => a.estado !== 'abierta'));
  const r = resumenCuenta(mesaRt(e, 7).cuenta);
  assert.equal(r.confirmado, total);
  assert.equal(r.propinaConfirmada, 267);
  assert.equal(hacer(e, 'liberar-mesa', 7).error, 'pedidos-en-curso'); // falta servir
});

test('liberar: con saldo no se puede; pagada y servida, sí, y queda en el historial', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 4, { renglones: [{ plato: 'agua', cant: 2, mods: [] }] }, { remoto: true });
  const id = mesaRt(e, 4).cuenta.pedidos[0].id;
  e = ok(e, 'cocina-renglon', null, { pedido: id, renglon: '1', hecho: true });
  e = ok(e, 'cocina-listo', null, { pedido: id, estacion: 'bar' });
  e = ok(e, 'servir-pedido', null, { pedido: id });
  const r = hacer(e, 'liberar-mesa', 4);
  assert.equal(r.error, 'saldo-pendiente');
  assert.equal(r.detalle, 300);
  e = ok(e, 'cobrar', 4, { pagos: [{ metodo: 'efectivo', monto: 300, propina: 30, recibido: 500 }] });
  assert.equal(mesaRt(e, 4).estado, 'pagada');
  e = ok(e, 'liberar-mesa', 4);
  assert.equal(mesaRt(e, 4).estado, 'libre');
  assert.equal(mesaRt(e, 4).cuenta, null);
  assert.equal(e.historial[0].total, 300);
  assert.equal(e.historial[0].propinas, 30);
});

test('cobro en caja: mixto, efectivo insuficiente y montos de más', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 6, PEDIDO_TIPICO, { remoto: true }); // 3200
  assert.equal(hacer(e, 'cobrar', 6, { pagos: [{ metodo: 'efectivo', monto: 1000, propina: 0, recibido: 900 }] }).error, 'recibido');
  assert.equal(hacer(e, 'cobrar', 6, { pagos: [{ metodo: 'tarjeta', monto: 3300 }] }).error, 'monto-alto');
  assert.equal(hacer(e, 'cobrar', 6, { pagos: [{ metodo: 'cheque', monto: 100 }] }).error, 'metodo');
  e = ok(e, 'cobrar', 6, { pagos: [{ metodo: 'efectivo', monto: 2000, propina: 0, recibido: 2000 }, { metodo: 'yappy', monto: 1200, propina: 320 }] });
  assert.equal(mesaRt(e, 6).estado, 'pagada');
  assert.equal(resumenCuenta(mesaRt(e, 6).cuenta).propinaConfirmada, 320);
});

test('pago del comensal por más de lo que falta se rechaza; rechazado por caja libera la parte', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 6, PEDIDO_TIPICO, { remoto: true });
  assert.equal(hacer(e, 'pago', 6, { parte: null, monto: 3201, propina: 0, metodo: 'yappy' }, { remoto: true }).error, 'monto-alto');
  assert.equal(hacer(e, 'pago', 6, { parte: null, monto: 1000, propina: 1001, metodo: 'yappy' }, { remoto: true }).error, 'propina');
  e = ok(e, 'cuenta', 6, { accion: 'dividir', division: { tipo: 'iguales', n: 2 } }, { remoto: true });
  e = ok(e, 'pago', 6, { parte: 0, monto: 1600, propina: 0, metodo: 'yappy' }, { remoto: true });
  const pago = mesaRt(e, 6).cuenta.pagos[0];
  e = ok(e, 'rechazar-pago', 6, { pago: pago.id });
  assert.equal(resumenCuenta(mesaRt(e, 6).cuenta).division.partes[0].estado, 'libre');
});

test('dividir por platos: todo asignado; si se agrega un pedido después, la división queda desfasada', () => {
  let e = nueva({ aprobacion: 'ninguno' });
  e = ok(e, 'pedido', 8, PEDIDO_TIPICO, { remoto: true });
  const pid = mesaRt(e, 8).cuenta.pedidos[0].id;
  const faltan = hacer(e, 'cuenta', 8, { accion: 'dividir', division: { tipo: 'platos', n: 2, asignacion: { [`${pid}:1`]: [0] } } }, { remoto: true });
  assert.equal(faltan.error, 'sin-asignar');
  e = ok(e, 'cuenta', 8, { accion: 'dividir', division: { tipo: 'platos', n: 2, asignacion: { [`${pid}:1`]: [0], [`${pid}:2`]: [0, 1], [`${pid}:3`]: [1] } } }, { remoto: true });
  assert.deepEqual(mesaRt(e, 8).cuenta.division.partes, [2400 + 250, 250 + 300]);
  e = ok(e, 'pedido', 8, { renglones: [{ plato: 'cocadas', cant: 1, mods: [] }] }, { remoto: true });
  const res = resumenCuenta(mesaRt(e, 8).cuenta);
  assert.equal(res.division.desfasada, true);
  assert.equal(hacer(e, 'pago', 8, { parte: 0, monto: 2650, propina: 0, metodo: 'yappy' }, { remoto: true }).error, 'division-desfasada');
});

test('llamar al mesero: no se duplica, el salón lo atiende y el teléfono puede cancelar', () => {
  let e = nueva();
  e = ok(e, 'llamada', 12, { motivo: 'ayuda' }, { remoto: true, id: 'llama-1' });
  e = ok(e, 'llamada', 12, { motivo: 'pedir', texto: 'más hielo' }, { remoto: true, id: 'llama-2' });
  const avisos = mesaRt(e, 12).cuenta.avisos;
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0].refs, ['llama-2']);
  assert.equal(avisos[0].texto, 'más hielo');
  assert.equal(estadoVisible(mesaRt(e, 12)), 'llama');
  e = ok(e, 'atender-aviso', 12, { aviso: 'llama-1' });
  assert.equal(mesaRt(e, 12).cuenta.avisos[0].estado, 'atendida');
  assert.equal(hacer(e, 'atender-aviso', 12, { aviso: 'llama-1' }).error, 'transicion');
  e = ok(e, 'llamada', 12, { motivo: 'otra' }, { remoto: true, id: 'llama-3' });
  e = ok(e, 'cancelar-aviso', 12, { aviso: 'llama-3' }, { remoto: true });
  assert.equal(mesaRt(e, 12).cuenta.avisos[1].estado, 'cancelada');
  // Pedir la cuenta de una mesa sin consumo no tiene sentido
  assert.equal(hacer(e, 'cuenta', 12, { accion: 'pedir' }, { remoto: true }).error, 'cuenta-vacia');
});

test('rechazar el único pedido deja la mesa libre otra vez', () => {
  let e = nueva();
  e = ok(e, 'pedido', 13, PEDIDO_TIPICO, { remoto: true });
  const id = mesaRt(e, 13).cuenta.pedidos[0].id;
  e = ok(e, 'rechazar-pedido', null, { pedido: id, motivo: 'Pedido desde fuera del local' });
  assert.equal(mesaRt(e, 13).estado, 'libre');
  assert.equal(e.historial[0].anulada, true);
});

test('kiosco: número de orden correlativo, pago en caja pendiente y tarjeta simulada', () => {
  let e = nueva();
  const r1 = hacer(e, 'kiosco-orden', null, { renglones: [{ plato: 'carimanolas', cant: 1, mods: [] }], llevar: true, pago: 'caja' });
  e = r1.estado;
  assert.equal(r1.orden, 1);
  const r2 = hacer(e, 'kiosco-orden', null, { renglones: [{ plato: 'agua', cant: 1, mods: [] }], llevar: false, pago: 'tarjeta' });
  e = r2.estado;
  assert.equal(r2.orden, 2);
  assert.equal(e.kiosco.ordenes[0].pago.estado, 'simulado');
  assert.equal(e.kiosco.ordenes[1].pago.estado, 'pendiente');
  assert.equal(ticketsCocina(e).length, 2);
  e = ok(e, 'kiosco-confirmar-pago', null, { orden: 1 });
  assert.equal(e.kiosco.ordenes[1].pago.estado, 'confirmado');
  assert.equal(hacer(e, 'kiosco-confirmar-pago', null, { orden: 1 }).error, 'transicion');
  assert.equal(hacer(e, 'kiosco-entregar', null, { orden: 2 }).error, 'transicion'); // no está listo
});

test('el plano no puede perder una mesa con cuenta abierta', () => {
  let e = nueva();
  e = ok(e, 'llamada', 15, { motivo: 'ayuda' }, { remoto: true });
  const plano = { ...e.plano, mesas: e.plano.mesas.filter((m) => m.numero !== 15) };
  const r = hacer(e, 'guardar-plano', null, { plano });
  assert.equal(r.error, 'plano');
});

test('ajustes: validación de propinas, aprobación y enlace de reseñas', () => {
  const e = nueva();
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { propinas: [10, 10, 20] } }).error, 'ajustes');
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { aprobacion: 'a veces' } }).error, 'ajustes');
  assert.equal(hacer(e, 'guardar-ajustes', null, { ajustes: { resena: 'http://inseguro' } }).error, 'ajustes');
  const r = hacer(e, 'guardar-ajustes', null, { ajustes: { propinas: [10, 12, 15], aprobacion: 'primero', resena: 'https://g.page/r/ejemplo' } });
  assert.deepEqual(r.estado.ajustes.propinas, [10, 12, 15]);
  assert.equal(r.estado.ajustes.aprobacion, 'primero');
});

test('semilla: se arma con acciones válidas; la mesa 7 queda libre y hay tickets de los tres colores', () => {
  const ahora = T0;
  const e = crearSemilla({ sala: 'abcdefghjk', carta: CARTA, ahora, generarPin: () => '321' });
  assert.equal(mesaRt(e, 7).estado, 'libre');
  assert.equal(estadoVisible(mesaRt(e, 4)), 'pagada');
  assert.equal(estadoVisible(mesaRt(e, 10)), 'cuenta');
  assert.equal(estadoVisible(mesaRt(e, 11)), 'llama');
  assert.equal(estadoVisible(mesaRt(e, 14)), 'pidio');
  assert.equal(estadoVisible(mesaRt(e, 8)), 'ocupada');
  const tickets = ticketsCocina(e);
  const minutos = tickets.map((t) => Math.floor((ahora - t.entrada) / 60000));
  assert.ok(minutos.some((m) => m < 10) && minutos.some((m) => m >= 10 && m <= 20) && minutos.some((m) => m > 20), minutos.join(','));
  assert.deepEqual(e.errores, []);
});

test('tipo de local: un restaurante cobra 7 % en la comida; una fonda no cobra ITBMS en la comida y sí 10 % en el alcohol', () => {
  const pedido = { renglones: [{ plato: 'ropa-vieja', cant: 1, mods: [] }, { plato: 'chicha-tamarindo', cant: 1, mods: [] }, { plato: 'cerveza', cant: 1, mods: [] }] };
  // Restaurante (por omisión).
  let r = nueva();
  assert.equal(r.ajustes.tipoLocal, 'restaurante');
  r = ok(r, 'pedido', 3, pedido);
  const tasasR = mesaRt(r, 3).cuenta.pedidos[0].renglones.map((x) => x.tasa);
  assert.deepEqual(tasasR, [7, 7, 10]);

  // Fonda: la comida y la chicha pasan a 0 %; la cerveza sigue en 10 %.
  let f = ok(nueva(), 'guardar-ajustes', null, { ajustes: { tipoLocal: 'fonda' } });
  assert.equal(f.ajustes.tipoLocal, 'fonda');
  f = ok(f, 'pedido', 3, pedido);
  const ren = mesaRt(f, 3).cuenta.pedidos[0].renglones;
  assert.deepEqual(ren.map((x) => x.tasa), [0, 0, 10]);
  // El precio que paga el comensal no cambia (es el de la carta); cambia el impuesto que lleva adentro.
  assert.deepEqual(ren.map((x) => x.monto), mesaRt(r, 3).cuenta.pedidos[0].renglones.map((x) => x.monto));
  const cerveza = ren[2].monto;
  f = ok(f, 'aceptar-pedido', null, { pedido: mesaRt(f, 3).cuenta.pedidos[0].id });
  const res = resumenCuenta(mesaRt(f, 3).cuenta);
  assert.equal(res.itbms.impuesto, Math.floor((2 * cerveza * 10 + 110) / 220));
  assert.equal(res.itbms.porTasa.find((x) => x.tasa === 7), undefined);

  assert.equal(hacer(nueva(), 'guardar-ajustes', null, { ajustes: { tipoLocal: 'bar' } }).error, 'ajustes');
});
