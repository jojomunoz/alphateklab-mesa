// Los mensajes que viajan entre el teléfono y la caja: {v:1, tipo, mesa, datos, id, t, disp}.

export const V = 1;
export const TIPOS = new Set(['pedido', 'llamada', 'cuenta', 'pago', 'cancelar-aviso', 'pedir-estado', 'estado']);
export const LIMITE_NTFY = 4096;

export function temaSala(sala) {
  return `atk-mesa-${sala}`;
}

export function crearMensaje({ tipo, mesa = null, datos = {}, disp = null, id, t = Date.now() }) {
  if (!TIPOS.has(tipo)) throw new RangeError(`tipo de mensaje desconocido: ${tipo}`);
  if (typeof id !== 'string' || !id) throw new TypeError('el mensaje necesita un id');
  return { v: V, tipo, mesa, datos, id, t, disp };
}

/** Lee y valida el texto de un mensaje. Nunca lanza: devuelve {ok:false, error} si algo no cuadra. */
export function leerMensaje(texto) {
  if (typeof texto !== 'string') return { ok: false, error: 'no-texto' };
  if (new TextEncoder().encode(texto).length > LIMITE_NTFY) return { ok: false, error: 'grande' };
  let m;
  try {
    m = JSON.parse(texto);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'forma' };
  if (m.v !== V) return { ok: false, error: 'version' };
  if (!TIPOS.has(m.tipo)) return { ok: false, error: 'tipo' };
  if (typeof m.id !== 'string' || !/^[a-z0-9-]{4,48}$/.test(m.id)) return { ok: false, error: 'id' };
  if (m.mesa !== null && m.mesa !== undefined && !(Number.isInteger(m.mesa) && m.mesa >= 1 && m.mesa <= 999)) return { ok: false, error: 'mesa' };
  if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return { ok: false, error: 't' };
  if (m.datos === null || typeof m.datos !== 'object' || Array.isArray(m.datos)) return { ok: false, error: 'datos' };
  if (m.disp !== null && m.disp !== undefined && (typeof m.disp !== 'string' || m.disp.length > 24)) return { ok: false, error: 'disp' };
  return { ok: true, msg: { v: V, tipo: m.tipo, mesa: m.mesa ?? null, datos: m.datos, id: m.id, t: m.t, disp: m.disp ?? null } };
}

/** Un evento del flujo SSE de ntfy: `{id, time, event, topic, message}`. Devuelve {ok, msg, ntfyId} o {ok:false}. */
export function deNtfy(dataTexto) {
  let ev;
  try {
    ev = JSON.parse(dataTexto);
  } catch {
    return { ok: false, error: 'sse-json' };
  }
  if (ev?.event !== 'message' || typeof ev.message !== 'string') return { ok: false, error: 'no-mensaje', ntfyId: ev?.id ?? null };
  const r = leerMensaje(ev.message);
  return r.ok ? { ok: true, msg: r.msg, ntfyId: ev.id } : { ...r, ntfyId: ev.id };
}

/** Registro de ids ya vistos, acotado, para aplicar cada mensaje una sola vez aunque llegue por dos vías. */
export function crearRegistro(max = 400) {
  const vistos = [];
  const set = new Set();
  return {
    /** true si es la primera vez que se ve el id. */
    nuevo(id) {
      if (set.has(id)) return false;
      set.add(id);
      vistos.push(id);
      if (vistos.length > max) set.delete(vistos.shift());
      return true;
    },
    tiene: (id) => set.has(id),
    get tamano() {
      return set.size;
    },
  };
}
