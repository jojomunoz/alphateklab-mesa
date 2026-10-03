// La pantalla de cocina: tickets por estación, con la hora de entrada y el semáforo de demora.

export const UMBRAL_AMBAR = 10; // minutos
export const UMBRAL_ROJO = 20;

/** Menos de 10 min: a tiempo. De 10 a 20: demorado. Más de 20: atrasado. Siempre con texto, no solo color. */
export function semaforo(minutos) {
  if (!Number.isFinite(minutos) || minutos < 0) minutos = 0;
  if (minutos < UMBRAL_AMBAR) return { nivel: 'verde', texto: 'A tiempo' };
  if (minutos <= UMBRAL_ROJO) return { nivel: 'ambar', texto: 'Demorado' };
  return { nivel: 'rojo', texto: 'Atrasado' };
}

export function minutosDesde(t, ahora) {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora - t) / 60000));
}

const EN_COCINA = new Set(['enviado', 'recibido', 'en-preparacion']);

function origenDe(estado) {
  const lista = [];
  for (const [n, m] of Object.entries(estado.mesas)) {
    for (const p of m.cuenta?.pedidos ?? []) lista.push({ pedido: p, mesa: Number(n), orden: null, llevar: false });
  }
  for (const o of estado.kiosco.ordenes) lista.push({ pedido: o.pedido, mesa: null, orden: o.numero, llevar: o.llevar });
  return lista;
}

/**
 * Tickets abiertos: uno por pedido y estación. Un ticket desaparece cuando su estación lo marcó listo.
 * `estacion`: filtra por una estación (null = todas). Orden: el que entró primero, primero.
 */
export function ticketsCocina(estado, { estacion = null } = {}) {
  const tickets = [];
  for (const { pedido: p, mesa, orden, llevar } of origenDe(estado)) {
    if (!EN_COCINA.has(p.estado)) continue;
    const porEstacion = new Map();
    for (const r of p.renglones) {
      if (!porEstacion.has(r.estacion)) porEstacion.set(r.estacion, []);
      porEstacion.get(r.estacion).push(r);
    }
    for (const [est, renglones] of porEstacion) {
      if (estacion && est !== estacion) continue;
      if (p.estacionesListas.includes(est)) continue;
      tickets.push({
        clave: `${p.id}:${est}`,
        pedido: p.id,
        estado: p.estado,
        estacion: est,
        mesa,
        orden,
        llevar,
        ronda: p.ronda,
        entrada: p.marcas?.enviado ?? p.t,
        renglones,
        completo: renglones.every((r) => r.hecho),
      });
    }
  }
  return tickets.sort((a, b) => a.entrada - b.entrada || a.clave.localeCompare(b.clave));
}

/** Estaciones ya listas de pedidos que siguen en cocina por otra estación, y pedidos listos sin servir. */
export function listosParaServir(estado) {
  const out = [];
  for (const { pedido: p, mesa, orden, llevar } of origenDe(estado)) {
    if (p.estado === 'listo') out.push({ pedido: p.id, mesa, orden, llevar, ronda: p.ronda, desde: p.marcas?.listo ?? p.t, completo: true, estaciones: [...p.estacionesListas] });
    else if (EN_COCINA.has(p.estado) && p.estacionesListas.length) out.push({ pedido: p.id, mesa, orden, llevar, ronda: p.ronda, desde: p.t, completo: false, estaciones: [...p.estacionesListas] });
  }
  return out.sort((a, b) => a.desde - b.desde);
}

/** Pedidos que la pantalla de cocina todavía no acusó (para marcarlos «recibido» al mostrarlos). */
export function sinAcusar(estado) {
  return origenDe(estado).filter(({ pedido }) => pedido.estado === 'enviado').map(({ pedido }) => pedido.id);
}
