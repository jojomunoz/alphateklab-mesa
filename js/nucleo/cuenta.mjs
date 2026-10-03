// La cuenta de una mesa: qué se cobra, cuánto ITBMS lleva adentro, qué se pagó y cómo se dividió.

import { desglosarItbms } from './dinero.mjs';
import { partesIguales, porPlatos, MAX_PARTES } from './division.mjs';

/** Un pedido entra a la cuenta cuando el mesero lo aceptó (o no hacía falta aceptarlo). */
export function pedidoCobrable(estado) {
  return estado !== 'por-aceptar' && estado !== 'rechazado';
}

export function renglonesCobrables(cuenta) {
  const out = [];
  for (const p of cuenta?.pedidos ?? []) {
    if (!pedidoCobrable(p.estado)) continue;
    for (const r of p.renglones) {
      out.push({ clave: `${p.id}:${r.id}`, pedido: p.id, ronda: p.ronda, plato: r.plato, nombre: r.nombre, cant: r.cant, mods: r.mods, nota: r.nota, monto: r.monto, tasa: r.tasa });
    }
  }
  return out;
}

const vivo = (pago) => pago.estado !== 'rechazado';

export function estadoDivision(cuenta, total) {
  const d = cuenta?.division;
  if (!d) return null;
  const pagos = (cuenta.pagos ?? []).filter(vivo);
  const partes = d.partes.map((monto, idx) => {
    const pago = pagos.find((p) => p.parte === idx);
    return { idx, monto, estado: pago ? (pago.estado === 'confirmado' ? 'pagada' : 'pendiente') : 'libre', pago: pago?.id ?? null };
  });
  return { tipo: d.tipo, n: d.n, partes, total: d.total, desfasada: d.total !== total, asignacion: d.asignacion ?? null };
}

export function resumenCuenta(cuenta) {
  const renglones = renglonesCobrables(cuenta);
  const itbms = desglosarItbms(renglones.map((r) => ({ monto: r.monto, tasa: r.tasa })));
  const total = itbms.total;
  let confirmado = 0;
  let pendiente = 0;
  let propinaConfirmada = 0;
  let propinaPendiente = 0;
  for (const p of cuenta?.pagos ?? []) {
    if (p.estado === 'confirmado') {
      confirmado += p.monto;
      propinaConfirmada += p.propina;
    } else if (p.estado === 'pendiente') {
      pendiente += p.monto;
      propinaPendiente += p.propina;
    }
  }
  const porAceptar = (cuenta?.pedidos ?? []).filter((p) => p.estado === 'por-aceptar').length;
  return {
    renglones,
    total,
    itbms,
    confirmado,
    pendiente,
    propinaConfirmada,
    propinaPendiente,
    saldo: total - confirmado - pendiente,
    saldoConfirmado: total - confirmado,
    porAceptar,
    division: estadoDivision(cuenta, total),
  };
}

export function estaPagada(cuenta) {
  const r = resumenCuenta(cuenta);
  return r.total > 0 && r.saldoConfirmado <= 0 && r.porAceptar === 0;
}

/**
 * Calcula una división nueva. pedido: {tipo:'iguales', n} | {tipo:'platos', n, asignacion}.
 * No se puede dividir si ya hay pagos (pendientes o confirmados): cambiaría lo que alguien ya pagó.
 */
export function calcularDivision(cuenta, pedido) {
  const r = resumenCuenta(cuenta);
  if ((cuenta?.pagos ?? []).some(vivo)) return { ok: false, error: 'division-bloqueada' };
  if (r.total <= 0) return { ok: false, error: 'cuenta-vacia' };
  const n = pedido?.n;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTES) return { ok: false, error: 'partes' };
  if (pedido.tipo === 'iguales') {
    return { ok: true, division: { tipo: 'iguales', n, partes: partesIguales(r.total, n), total: r.total } };
  }
  if (pedido.tipo === 'platos') {
    const asignacion = {};
    for (const [clave, personas] of Object.entries(pedido.asignacion ?? {})) {
      if (!Array.isArray(personas)) continue;
      asignacion[clave] = [...new Set(personas.filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
    }
    const res = porPlatos(r.renglones.map((x) => ({ clave: x.clave, monto: x.monto })), asignacion, n);
    if (res.sinAsignar.length) return { ok: false, error: 'sin-asignar', sinAsignar: res.sinAsignar.map((s) => s.clave) };
    return { ok: true, division: { tipo: 'platos', n, partes: res.partes, total: r.total, asignacion } };
  }
  return { ok: false, error: 'tipo' };
}
