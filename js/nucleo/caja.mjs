// La caja: el estado completo del restaurante y las reglas para cambiarlo.
//
// Todo cambio entra como una acción {v, tipo, mesa, datos, id, t, disp} y pasa por `aplicar`, que es pura:
// recibe el estado y devuelve otro. Cada acción se aplica una sola vez (por `id`), así da igual si llega por
// BroadcastChannel, por el relevo ntfy o por las dos vías. Lo que llega del relevo público solo puede ser lo que
// hace un comensal (pedir, llamar, pedir la cuenta, dividir, avisar un pago): nunca confirmar pagos ni liberar.

import { armarRenglon, validarCarta } from './carta.mjs';
import { transicion, PEDIDO, PEDIDO_DESHACER, AVISO, MESA, PAGO } from './estados.mjs';
import { resumenCuenta, estaPagada, calcularDivision, pedidoCobrable } from './cuenta.mjs';
import { validarPlano } from './plano.mjs';

export const ESQUEMA = 3;
export const MAX_VISTOS = 600;
export const MAX_RENGLONES = 30;
export const MAX_POR_ACEPTAR = 3;
export const METODOS_COMENSAL = ['yappy', 'tarjeta', 'mesero'];
export const METODOS_CAJA = ['efectivo', 'tarjeta', 'yappy'];
export const MOTIVOS_LLAMADA = ['pedir', 'ayuda', 'otra'];
export const APROBACION = ['todos', 'primero', 'ninguno'];

/** Lo que puede llegar desde un teléfono por el relevo público. */
export const TIPOS_COMENSAL = new Set(['pedido', 'llamada', 'cuenta', 'pago', 'cancelar-aviso', 'pedir-estado']);

export const AJUSTES_BASE = {
  nombre: 'Fonda Pixbae',
  propinas: [10, 15, 20],
  aprobacion: 'todos',
  pin: false,
  resena: '',
};

export function estadoVacio({ sala, carta, plano, ajustes = {}, epoca = 'e0' }) {
  return {
    esquema: ESQUEMA,
    rev: 0,
    epoca,
    sala,
    ajustes: { ...AJUSTES_BASE, ...ajustes },
    carta,
    plano,
    mesas: {},
    kiosco: { siguiente: 1, ordenes: [] },
    historial: [],
    vistos: [],
    errores: [],
    remotos: {},
  };
}

function nuevaCuenta(id, ahora) {
  return { id, abierta: ahora, pedidos: [], avisos: [], pagos: [], division: null };
}

export function mesaRt(estado, n) {
  return estado.mesas[n] ?? { estado: 'libre', desde: null, cuenta: null };
}

function mesaEditable(e, n) {
  if (!e.mesas[n]) e.mesas[n] = { estado: 'libre', desde: null, cuenta: null };
  return e.mesas[n];
}

function mesaDelPlano(e, n) {
  return e.plano.mesas.find((m) => m.numero === n) ?? null;
}

/** Busca un pedido por id en las mesas y en el kiosco. */
export function buscarPedido(estado, id) {
  for (const [n, m] of Object.entries(estado.mesas)) {
    const p = m.cuenta?.pedidos.find((x) => x.id === id);
    if (p) return { pedido: p, mesa: Number(n), orden: null };
  }
  const o = estado.kiosco.ordenes.find((x) => x.pedido.id === id);
  if (o) return { pedido: o.pedido, mesa: null, orden: o };
  return null;
}

function marcar(pedido, a, ahora) {
  pedido.estado = a;
  pedido.marcas = { ...(pedido.marcas ?? {}), [a]: ahora };
}

/** Estado con que entra un pedido por QR según el ajuste de aprobación. */
export function estadoInicialPedido(aprobacion, mesa) {
  if (aprobacion === 'ninguno') return 'enviado';
  if (aprobacion === 'primero') {
    const yaAceptado = (mesa?.cuenta?.pedidos ?? []).some((p) => pedidoCobrable(p.estado));
    return yaAceptado ? 'enviado' : 'por-aceptar';
  }
  return 'por-aceptar';
}

function fallo(codigo, detalle) {
  return { error: codigo, detalle };
}

function revisarPagada(m) {
  if (m.estado === 'ocupada' && m.cuenta && estaPagada(m.cuenta)) {
    m.estado = 'pagada';
    for (const a of m.cuenta.avisos) if (a.tipo === 'cuenta' && a.estado === 'abierta') a.estado = 'atendida';
  }
}

function ocupar(m, ahora) {
  if (m.estado === 'libre' || m.estado === 'pagada') {
    m.estado = 'ocupada';
    m.desde = m.desde ?? ahora;
  }
}

function crearAviso(m, a, tipo, ahora, extra = {}) {
  const abierto = m.cuenta.avisos.find((x) => x.tipo === tipo && x.estado === 'abierta');
  if (abierto) {
    abierto.refs = [...new Set([...(abierto.refs ?? []), a.id])].slice(-10);
    Object.assign(abierto, extra);
    return abierto;
  }
  const aviso = { id: a.id, tipo, estado: 'abierta', t: ahora, disp: a.disp ?? null, refs: [], ...extra };
  m.cuenta.avisos.push(aviso);
  return aviso;
}

const MANEJADORES = {
  // ——— Comensal ———
  pedido(e, a, ahora) {
    const n = a.mesa;
    const mp = mesaDelPlano(e, n);
    if (!mp) return fallo('mesa-inexistente');
    if (e.ajustes.pin && String(a.datos?.pin ?? '') !== String(mp.pin ?? '')) return fallo('pin');
    const lista = a.datos?.renglones;
    if (!Array.isArray(lista) || lista.length === 0) return fallo('pedido-vacio');
    if (lista.length > MAX_RENGLONES) return fallo('pedido-largo');
    const renglones = [];
    for (const [i, r] of lista.entries()) {
      const res = armarRenglon(e.carta, r);
      if (!res.ok) return fallo(res.error, res.plato ?? r?.plato);
      renglones.push({ id: String(i + 1), ...res.renglon, hecho: false });
    }
    const m = mesaEditable(e, n);
    if (m.cuenta && m.cuenta.pedidos.filter((p) => p.estado === 'por-aceptar').length >= MAX_POR_ACEPTAR) {
      return fallo('demasiados');
    }
    if (!m.cuenta) m.cuenta = nuevaCuenta(a.id, ahora);
    const inicial = estadoInicialPedido(e.ajustes.aprobacion, m);
    const ronda = m.cuenta.pedidos.filter((p) => p.estado !== 'rechazado').length + 1;
    const pedido = { id: a.id, ronda, origen: a.datos?.origen === 'mesero' ? 'mesero' : 'qr', disp: a.disp ?? null, t: a.t ?? ahora, estado: inicial, marcas: { [inicial]: ahora }, renglones, estacionesListas: [], motivo: '' };
    m.cuenta.pedidos.push(pedido);
    ocupar(m, ahora);
    return { mesa: n };
  },

  llamada(e, a, ahora) {
    const n = a.mesa;
    if (!mesaDelPlano(e, n)) return fallo('mesa-inexistente');
    const motivo = MOTIVOS_LLAMADA.includes(a.datos?.motivo) ? a.datos.motivo : 'otra';
    const texto = typeof a.datos?.texto === 'string' ? a.datos.texto.trim().slice(0, 80) : '';
    const m = mesaEditable(e, n);
    if (!m.cuenta) m.cuenta = nuevaCuenta(a.id, ahora);
    ocupar(m, ahora);
    crearAviso(m, a, 'mesero', ahora, { motivo, texto });
    return { mesa: n };
  },

  cuenta(e, a, ahora) {
    const n = a.mesa;
    if (!mesaDelPlano(e, n)) return fallo('mesa-inexistente');
    const m = mesaEditable(e, n);
    const accion = a.datos?.accion;
    if (accion === 'pedir') {
      if (!m.cuenta || resumenCuenta(m.cuenta).total === 0) return fallo('cuenta-vacia');
      crearAviso(m, a, 'cuenta', ahora);
      return { mesa: n };
    }
    if (accion === 'dividir') {
      if (!m.cuenta) return fallo('cuenta-vacia');
      const res = calcularDivision(m.cuenta, a.datos.division);
      if (!res.ok) return fallo(res.error, res.sinAsignar);
      m.cuenta.division = res.division;
      return { mesa: n };
    }
    if (accion === 'quitar-division') {
      if (!m.cuenta?.division) return { mesa: n };
      if (m.cuenta.pagos.some((p) => p.estado !== 'rechazado')) return fallo('division-bloqueada');
      m.cuenta.division = null;
      return { mesa: n };
    }
    return fallo('accion');
  },

  pago(e, a, ahora) {
    const n = a.mesa;
    if (!mesaDelPlano(e, n)) return fallo('mesa-inexistente');
    const m = mesaEditable(e, n);
    if (!m.cuenta) return fallo('cuenta-vacia');
    const d = a.datos ?? {};
    if (!METODOS_COMENSAL.includes(d.metodo)) return fallo('metodo');
    if (!Number.isSafeInteger(d.monto) || d.monto <= 0) return fallo('monto');
    if (!Number.isSafeInteger(d.propina) || d.propina < 0 || d.propina > d.monto) return fallo('propina');
    const r = resumenCuenta(m.cuenta);
    if (d.parte !== null && d.parte !== undefined) {
      const div = r.division;
      if (!div) return fallo('sin-division');
      if (div.desfasada) return fallo('division-desfasada');
      const parte = div.partes[d.parte];
      if (!parte) return fallo('parte');
      if (parte.estado !== 'libre') return fallo('parte-tomada');
      if (parte.monto !== d.monto) return fallo('monto');
    } else if (d.monto > r.saldo) {
      return fallo('monto-alto', r.saldo);
    }
    m.cuenta.pagos.push({ id: a.id, parte: d.parte ?? null, monto: d.monto, propina: d.propina, metodo: d.metodo, estado: 'pendiente', origen: 'mesa', disp: a.disp ?? null, t: ahora });
    return { mesa: n };
  },

  'cancelar-aviso'(e, a) {
    const m = e.mesas[a.mesa];
    const aviso = m?.cuenta?.avisos.find((x) => x.id === a.datos?.aviso || (x.refs ?? []).includes(a.datos?.aviso));
    if (!aviso) return fallo('aviso');
    const t = transicion(AVISO, aviso.estado, 'cancelada');
    if (!t.ok) return fallo('transicion', t.error);
    aviso.estado = 'cancelada';
    return { mesa: a.mesa };
  },

  'pedir-estado'(e, a) {
    if (!mesaDelPlano(e, a.mesa)) return fallo('mesa-inexistente');
    return { mesa: a.mesa };
  },

  // ——— Salón y caja ———
  'aceptar-pedido'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const t = transicion(PEDIDO, b.pedido.estado, 'enviado');
    if (!t.ok) return fallo('transicion', t.error);
    marcar(b.pedido, 'enviado', ahora);
    return { mesa: b.mesa };
  },

  'rechazar-pedido'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const t = transicion(PEDIDO, b.pedido.estado, 'rechazado');
    if (!t.ok) return fallo('transicion', t.error);
    marcar(b.pedido, 'rechazado', ahora);
    b.pedido.motivo = typeof a.datos?.motivo === 'string' ? a.datos.motivo.slice(0, 80) : '';
    const m = e.mesas[b.mesa];
    if (m) {
      // Si la mesa solo tenía ese pedido y nada más, vuelve a quedar libre.
      const algo = m.cuenta.pedidos.some((p) => p.estado !== 'rechazado') || m.cuenta.avisos.some((x) => x.estado === 'abierta');
      if (!algo && m.estado === 'ocupada') {
        m.estado = 'libre';
        m.desde = null;
        e.historial.unshift({ id: m.cuenta.id, mesa: b.mesa, abierta: m.cuenta.abierta, cerrada: ahora, total: 0, propinas: 0, anulada: true });
        e.historial = e.historial.slice(0, 50);
        m.cuenta = null;
      } else {
        revisarPagada(m);
      }
    }
    return { mesa: b.mesa };
  },

  'atender-aviso'(e, a, ahora) {
    const m = e.mesas[a.mesa];
    const aviso = m?.cuenta?.avisos.find((x) => x.id === a.datos?.aviso);
    if (!aviso) return fallo('aviso');
    const t = transicion(AVISO, aviso.estado, 'atendida');
    if (!t.ok) return fallo('transicion', t.error);
    aviso.estado = 'atendida';
    aviso.tAtendida = ahora;
    return { mesa: a.mesa };
  },

  'abrir-mesa'(e, a, ahora) {
    if (!mesaDelPlano(e, a.mesa)) return fallo('mesa-inexistente');
    const m = mesaEditable(e, a.mesa);
    const t = transicion(MESA, m.estado, 'ocupada');
    if (!t.ok) return fallo('transicion', t.error);
    if (!m.cuenta) m.cuenta = nuevaCuenta(a.id, ahora);
    m.estado = 'ocupada';
    m.desde = ahora;
    return { mesa: a.mesa };
  },

  'confirmar-pago'(e, a, ahora) {
    const m = e.mesas[a.mesa];
    const pago = m?.cuenta?.pagos.find((p) => p.id === a.datos?.pago);
    if (!pago) return fallo('pago');
    const t = transicion(PAGO, pago.estado, 'confirmado');
    if (!t.ok) return fallo('transicion', t.error);
    pago.estado = 'confirmado';
    pago.tConfirmado = ahora;
    revisarPagada(m);
    return { mesa: a.mesa };
  },

  'rechazar-pago'(e, a, ahora) {
    const m = e.mesas[a.mesa];
    const pago = m?.cuenta?.pagos.find((p) => p.id === a.datos?.pago);
    if (!pago) return fallo('pago');
    const t = transicion(PAGO, pago.estado, 'rechazado');
    if (!t.ok) return fallo('transicion', t.error);
    pago.estado = 'rechazado';
    pago.tRechazado = ahora;
    return { mesa: a.mesa };
  },

  /** Cobro en caja: pagos que el personal recibe en mano (quedan confirmados). Mixto = varios a la vez. */
  cobrar(e, a, ahora) {
    const m = e.mesas[a.mesa];
    if (!m?.cuenta) return fallo('cuenta-vacia');
    const pagos = a.datos?.pagos;
    if (!Array.isArray(pagos) || pagos.length === 0 || pagos.length > 4) return fallo('pagos');
    let suma = 0;
    for (const p of pagos) {
      if (!METODOS_CAJA.includes(p.metodo)) return fallo('metodo');
      if (!Number.isSafeInteger(p.monto) || p.monto <= 0) return fallo('monto');
      if (!Number.isSafeInteger(p.propina ?? 0) || (p.propina ?? 0) < 0) return fallo('propina');
      if (p.metodo === 'efectivo' && p.recibido != null && (!Number.isSafeInteger(p.recibido) || p.recibido < p.monto + (p.propina ?? 0))) return fallo('recibido');
      suma += p.monto;
    }
    const r = resumenCuenta(m.cuenta);
    if (suma > r.saldo) return fallo('monto-alto', r.saldo);
    pagos.forEach((p, i) => {
      m.cuenta.pagos.push({ id: `${a.id}-${i}`, parte: null, monto: p.monto, propina: p.propina ?? 0, metodo: p.metodo, recibido: p.recibido ?? null, estado: 'confirmado', origen: 'caja', disp: null, t: ahora, tConfirmado: ahora });
    });
    revisarPagada(m);
    return { mesa: a.mesa };
  },

  'liberar-mesa'(e, a, ahora) {
    const m = e.mesas[a.mesa];
    if (!m || m.estado === 'libre') return fallo('transicion', 'la mesa ya está libre');
    const r = m.cuenta ? resumenCuenta(m.cuenta) : { total: 0, saldoConfirmado: 0, propinaConfirmada: 0 };
    const enCurso = (m.cuenta?.pedidos ?? []).filter((p) => ['por-aceptar', 'enviado', 'recibido', 'en-preparacion', 'listo'].includes(p.estado));
    if (m.estado === 'ocupada' && r.total > 0) return fallo('saldo-pendiente', r.saldoConfirmado);
    if (enCurso.length) return fallo('pedidos-en-curso', enCurso.length);
    if ((m.cuenta?.pagos ?? []).some((p) => p.estado === 'pendiente')) return fallo('pagos-pendientes');
    const t = transicion(MESA, m.estado, 'libre');
    if (!t.ok) return fallo('transicion', t.error);
    if (m.cuenta) {
      e.historial.unshift({ id: m.cuenta.id, mesa: a.mesa, abierta: m.cuenta.abierta, cerrada: ahora, total: r.total, propinas: r.propinaConfirmada });
      e.historial = e.historial.slice(0, 50);
    }
    e.mesas[a.mesa] = { estado: 'libre', desde: null, cuenta: null };
    return { mesa: a.mesa };
  },

  // ——— Cocina ———
  'cocina-recibir'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    if (b.pedido.estado !== 'enviado') return { mesa: b.mesa, sinCambio: true };
    marcar(b.pedido, 'recibido', ahora);
    return { mesa: b.mesa };
  },

  'cocina-renglon'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const p = b.pedido;
    if (!['enviado', 'recibido', 'en-preparacion', 'listo'].includes(p.estado)) return fallo('transicion', `el pedido está «${p.estado}»`);
    const r = p.renglones.find((x) => x.id === a.datos?.renglon);
    if (!r) return fallo('renglon');
    const hecho = Boolean(a.datos?.hecho);
    if (r.hecho === hecho) return { mesa: b.mesa, sinCambio: true };
    r.hecho = hecho;
    if (hecho && (p.estado === 'enviado' || p.estado === 'recibido')) marcar(p, 'en-preparacion', ahora);
    if (!hecho) {
      if (p.estacionesListas.includes(r.estacion)) p.estacionesListas = p.estacionesListas.filter((x) => x !== r.estacion);
      if (p.estado === 'listo') {
        const t = transicion(PEDIDO, 'listo', 'en-preparacion', { deshacer: PEDIDO_DESHACER });
        if (t.ok) marcar(p, 'en-preparacion', ahora);
      }
      if (p.estado === 'en-preparacion' && !p.renglones.some((x) => x.hecho)) marcar(p, 'recibido', ahora);
    }
    return { mesa: b.mesa };
  },

  'cocina-listo'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const p = b.pedido;
    const est = a.datos?.estacion;
    const deEstacion = p.renglones.filter((r) => r.estacion === est);
    if (!deEstacion.length) return fallo('estacion');
    if (deEstacion.some((r) => !r.hecho)) return fallo('faltan-renglones');
    if (!['en-preparacion', 'recibido', 'enviado'].includes(p.estado)) return fallo('transicion', `el pedido está «${p.estado}»`);
    if (!p.estacionesListas.includes(est)) p.estacionesListas = [...p.estacionesListas, est];
    const estaciones = new Set(p.renglones.map((r) => r.estacion));
    if ([...estaciones].every((x) => p.estacionesListas.includes(x))) {
      if (p.estado !== 'en-preparacion') marcar(p, 'en-preparacion', ahora);
      marcar(p, 'listo', ahora);
    }
    return { mesa: b.mesa };
  },

  'cocina-deshacer-listo'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const p = b.pedido;
    const est = a.datos?.estacion;
    if (!p.estacionesListas.includes(est)) return fallo('estacion');
    if (p.estado === 'servido') return fallo('transicion', 'el pedido ya se sirvió');
    p.estacionesListas = p.estacionesListas.filter((x) => x !== est);
    if (p.estado === 'listo') {
      const t = transicion(PEDIDO, 'listo', 'en-preparacion', { deshacer: PEDIDO_DESHACER });
      if (!t.ok) return fallo('transicion', t.error);
      marcar(p, 'en-preparacion', ahora);
    }
    return { mesa: b.mesa };
  },

  'servir-pedido'(e, a, ahora) {
    const b = buscarPedido(e, a.datos?.pedido);
    if (!b) return fallo('pedido');
    const t = transicion(PEDIDO, b.pedido.estado, 'servido');
    if (!t.ok) return fallo('transicion', t.error);
    marcar(b.pedido, 'servido', ahora);
    return { mesa: b.mesa };
  },

  // ——— Panel del dueño ———
  'guardar-plano'(e, a) {
    const plano = a.datos?.plano;
    const v = validarPlano(plano);
    if (!v.ok) return fallo('plano', v.errores);
    for (const [n, m] of Object.entries(e.mesas)) {
      if (m.estado !== 'libre' && !plano.mesas.some((x) => x.numero === Number(n))) return fallo('plano', [`La mesa ${n} tiene una cuenta abierta y no puede desaparecer del plano.`]);
    }
    e.plano = plano;
    return {};
  },

  'guardar-carta'(e, a) {
    const v = validarCarta(a.datos?.carta);
    if (!v.ok) return fallo('carta', v.errores);
    e.carta = a.datos.carta;
    return { todas: true };
  },

  agotado(e, a) {
    const p = e.carta.platos.find((x) => x.id === a.datos?.plato);
    if (!p) return fallo('plato-inexistente');
    p.agotado = Boolean(a.datos.agotado);
    return { todas: true };
  },

  'guardar-ajustes'(e, a) {
    const n = a.datos?.ajustes ?? {};
    const nuevo = { ...e.ajustes };
    if ('nombre' in n) {
      const s = String(n.nombre).trim();
      if (!s || s.length > 60) return fallo('ajustes', ['El nombre del local va de 1 a 60 caracteres.']);
      nuevo.nombre = s;
    }
    if ('propinas' in n) {
      const p = n.propinas;
      if (!Array.isArray(p) || p.length !== 3 || p.some((x) => !Number.isInteger(x) || x < 1 || x > 50)) return fallo('ajustes', ['Las tres propinas sugeridas son porcentajes enteros de 1 a 50.']);
      if (new Set(p).size !== 3) return fallo('ajustes', ['Las tres propinas sugeridas tienen que ser distintas.']);
      nuevo.propinas = [...p];
    }
    if ('aprobacion' in n) {
      if (!APROBACION.includes(n.aprobacion)) return fallo('ajustes', ['Opción de aprobación desconocida.']);
      nuevo.aprobacion = n.aprobacion;
    }
    if ('pin' in n) nuevo.pin = Boolean(n.pin);
    if ('resena' in n) {
      const s = String(n.resena).trim();
      if (s && !/^https:\/\/[^\s]+$/.test(s)) return fallo('ajustes', ['El enlace de reseñas tiene que empezar con https://']);
      nuevo.resena = s;
    }
    e.ajustes = nuevo;
    return { todas: true };
  },

  // ——— Kiosco ———
  'kiosco-orden'(e, a, ahora) {
    const lista = a.datos?.renglones;
    if (!Array.isArray(lista) || lista.length === 0) return fallo('pedido-vacio');
    if (lista.length > MAX_RENGLONES) return fallo('pedido-largo');
    const renglones = [];
    for (const [i, r] of lista.entries()) {
      const res = armarRenglon(e.carta, r);
      if (!res.ok) return fallo(res.error, res.plato ?? r?.plato);
      renglones.push({ id: String(i + 1), ...res.renglon, hecho: false });
    }
    const metodo = a.datos?.pago === 'tarjeta' ? 'tarjeta' : 'caja';
    const numero = e.kiosco.siguiente;
    e.kiosco.siguiente = numero >= 999 ? 1 : numero + 1;
    const pedido = { id: a.id, ronda: 1, origen: 'kiosco', disp: a.disp ?? null, t: ahora, estado: 'enviado', marcas: { enviado: ahora }, renglones, estacionesListas: [], motivo: '' };
    const total = renglones.reduce((s, r) => s + r.monto, 0);
    e.kiosco.ordenes.unshift({ numero, llevar: Boolean(a.datos?.llevar), pago: { metodo, estado: metodo === 'tarjeta' ? 'simulado' : 'pendiente', total }, pedido, t: ahora });
    e.kiosco.ordenes = e.kiosco.ordenes.slice(0, 40);
    return { orden: numero };
  },

  'kiosco-confirmar-pago'(e, a, ahora) {
    const o = e.kiosco.ordenes.find((x) => x.numero === a.datos?.orden);
    if (!o) return fallo('orden');
    if (o.pago.estado !== 'pendiente') return fallo('transicion', 'ese pago no está pendiente');
    o.pago.estado = 'confirmado';
    o.pago.t = ahora;
    return {};
  },

  'kiosco-entregar'(e, a, ahora) {
    const o = e.kiosco.ordenes.find((x) => x.numero === a.datos?.orden);
    if (!o) return fallo('orden');
    const t = transicion(PEDIDO, o.pedido.estado, 'servido');
    if (!t.ok) return fallo('transicion', t.error);
    marcar(o.pedido, 'servido', ahora);
    return {};
  },
};

/**
 * Aplica una acción. Devuelve {estado, cambio, repetido?, mesa?, error?, detalle?, orden?, todas?}.
 * - Idempotente por `accion.id`.
 * - `remoto: true` = llegó por el relevo público: solo se aceptan los tipos de TIPOS_COMENSAL.
 * - Los errores de acciones del comensal quedan anotados en `estado.errores` para que su teléfono los vea.
 */
export function aplicar(estado, accion, { ahora = Date.now(), remoto = false } = {}) {
  if (!accion || typeof accion !== 'object' || typeof accion.id !== 'string' || !accion.id) {
    return { estado, cambio: false, error: 'accion-invalida' };
  }
  if (estado.vistos.includes(accion.id)) return { estado, cambio: false, repetido: true };
  const manejador = MANEJADORES[accion.tipo];
  if (!manejador) return { estado, cambio: false, error: 'tipo-desconocido' };
  if (remoto && !TIPOS_COMENSAL.has(accion.tipo)) return { estado, cambio: false, error: 'no-permitido' };
  if (TIPOS_COMENSAL.has(accion.tipo) && !Number.isInteger(accion.mesa)) return { estado, cambio: false, error: 'mesa-invalida' };

  const e = structuredClone(estado);
  const res = manejador(e, accion, ahora) ?? {};
  e.vistos = [...e.vistos, accion.id].slice(-MAX_VISTOS);
  if (remoto && Number.isInteger(accion.mesa)) e.remotos = { ...e.remotos, [accion.mesa]: ahora };
  if (res.error) {
    if (TIPOS_COMENSAL.has(accion.tipo)) {
      e.errores = [{ ref: accion.id, mesa: accion.mesa ?? null, motivo: res.error, detalle: res.detalle ?? null, t: ahora }, ...e.errores].slice(0, 30);
      e.rev = estado.rev + 1;
      return { estado: e, cambio: true, error: res.error, detalle: res.detalle, mesa: accion.mesa ?? null };
    }
    return { estado, cambio: false, error: res.error, detalle: res.detalle };
  }
  if (res.sinCambio) return { estado, cambio: false, mesa: res.mesa };
  e.rev = estado.rev + 1;
  return { estado: e, cambio: true, mesa: res.mesa ?? accion.mesa ?? null, orden: res.orden, todas: Boolean(res.todas) };
}

/** Estado que se ve en el plano. Prioridad: llama > pidió la cuenta > pidió (por aceptar) > pagada > ocupada > libre. */
export function estadoVisible(m) {
  if (!m || m.estado === 'libre') return 'libre';
  if (!m.cuenta) return m.estado;
  const avisos = m.cuenta.avisos.filter((a) => a.estado === 'abierta');
  if (avisos.some((a) => a.tipo === 'mesero')) return 'llama';
  if (avisos.some((a) => a.tipo === 'cuenta') || m.cuenta.pagos.some((p) => p.estado === 'pendiente')) return 'cuenta';
  if (m.cuenta.pedidos.some((p) => p.estado === 'por-aceptar')) return 'pidio';
  if (m.estado === 'pagada') return 'pagada';
  return 'ocupada';
}

/** Lista de pendientes del salón, la más vieja primero. */
export function porAtender(estado) {
  const out = [];
  for (const [n, m] of Object.entries(estado.mesas)) {
    if (!m.cuenta) continue;
    const mesa = Number(n);
    for (const a of m.cuenta.avisos) if (a.estado === 'abierta') out.push({ tipo: a.tipo === 'mesero' ? 'llama' : 'cuenta', mesa, t: a.t, id: a.id, motivo: a.motivo, texto: a.texto });
    for (const p of m.cuenta.pedidos) {
      if (p.estado === 'por-aceptar') out.push({ tipo: 'aceptar', mesa, t: p.marcas['por-aceptar'] ?? p.t, id: p.id });
      if (p.estado === 'listo') out.push({ tipo: 'servir', mesa, t: p.marcas.listo, id: p.id });
    }
    for (const p of m.cuenta.pagos) if (p.estado === 'pendiente') out.push({ tipo: 'pago', mesa, t: p.t, id: p.id, monto: p.monto, propina: p.propina, metodo: p.metodo });
  }
  return out.sort((a, b) => a.t - b.t);
}
