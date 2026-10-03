// Máquinas de estado. Lo que no está en la tabla se rechaza.

/** Pedido: por aceptar (lo revisa el mesero) → enviado (a cocina) → recibido (la pantalla de cocina lo mostró)
 *  → en preparación (primer renglón hecho) → listo → servido. Rechazado sale de «por aceptar». */
export const PEDIDO = {
  'por-aceptar': ['enviado', 'rechazado'],
  enviado: ['recibido', 'en-preparacion'],
  recibido: ['en-preparacion'],
  'en-preparacion': ['listo'],
  listo: ['servido'],
  servido: [],
  rechazado: [],
};

/** Vueltas atrás que solo se permiten con «Deshacer» en la cocina. */
export const PEDIDO_DESHACER = {
  'en-preparacion': ['recibido', 'enviado'],
  listo: ['en-preparacion'],
};

/** Aviso al mesero (llamada o cuenta): abierta → atendida («Visto por el mesero»), o cancelada por la mesa. */
export const AVISO = {
  abierta: ['atendida', 'cancelada'],
  atendida: [],
  cancelada: [],
};

/** Mesa: libre → ocupada → pagada → libre. Ocupada → libre solo sin consumo (lo cuida la caja). Pagada →
 *  ocupada si la mesa vuelve a pedir después de pagar. */
export const MESA = {
  libre: ['ocupada'],
  ocupada: ['pagada', 'libre'],
  pagada: ['libre', 'ocupada'],
};

/** Pago: pendiente (el comensal dice que pagó o va a pagar) → confirmado (la caja lo recibió) o rechazado. */
export const PAGO = {
  pendiente: ['confirmado', 'rechazado'],
  confirmado: [],
  rechazado: [],
};

export function puede(maquina, de, a) {
  return Array.isArray(maquina[de]) && maquina[de].includes(a);
}

/** {ok:true} o {ok:false, error} con un texto que dice qué pasó. */
export function transicion(maquina, de, a, { deshacer = null } = {}) {
  if (!(de in maquina)) return { ok: false, error: `estado desconocido: ${de}` };
  if (!(a in maquina)) return { ok: false, error: `estado desconocido: ${a}` };
  if (puede(maquina, de, a)) return { ok: true };
  if (deshacer && puede(deshacer, de, a)) return { ok: true };
  return { ok: false, error: `no se puede pasar de «${de}» a «${a}»` };
}

/** Orden de avance del pedido, para comparar («¿ya llegó a cocina?»). */
export const ORDEN_PEDIDO = ['por-aceptar', 'enviado', 'recibido', 'en-preparacion', 'listo', 'servido'];

export function avancePedido(estado) {
  return ORDEN_PEDIDO.indexOf(estado);
}
