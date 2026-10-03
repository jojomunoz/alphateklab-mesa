// El plano del salón: zonas con mesas en su lugar. Coordenadas en unidades de una cuadrícula de
// ANCHO × alto de la zona (no en píxeles), así el plano se ve igual en cualquier pantalla. Cada zona tiene su
// alto (una barra es más baja que el salón); el ancho es siempre ANCHO.

export const ANCHO = 100;
export const ALTO = 60; // alto por omisión de una zona
export const ALTO_MIN = 20;
export const ALTO_MAX = 80;

export function altoZona(plano, zonaId) {
  return plano.zonas.find((z) => z.id === zonaId)?.alto ?? ALTO;
}
export const FORMAS = ['redonda', 'cuadrada', 'rectangular'];
export const CAP_MIN = 1;
export const CAP_MAX = 20;
export const PASO_TECLADO = 2;
export const PASO_TECLADO_GRANDE = 10;

export function tamanoMesa(mesa) {
  const c = mesa.capacidad;
  if (mesa.forma === 'rectangular') {
    return { w: Math.min(32, 8 + 4 * Math.ceil(c / 2)), h: c > 8 ? 12 : 10 };
  }
  const lado = c <= 2 ? 9 : c <= 4 ? 11 : c <= 6 ? 13 : 15;
  return { w: lado, h: lado };
}

function limitar(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Posición dentro de la zona, redondeada a la unidad. */
export function encajar(mesa, x, y, alto = ALTO) {
  const { w, h } = tamanoMesa(mesa);
  return { x: limitar(Math.round(x), 0, ANCHO - w), y: limitar(Math.round(y), 0, Math.max(0, alto - h)) };
}

export function solapan(a, b) {
  const ta = tamanoMesa(a);
  const tb = tamanoMesa(b);
  return a.zona === b.zona && a.x < b.x + tb.w && b.x < a.x + ta.w && a.y < b.y + tb.h && b.y < a.y + ta.h;
}

/** Mesas con las que se cruza (mismo plano y zona). */
export function cruces(plano, id) {
  const m = plano.mesas.find((x) => x.id === id);
  if (!m) return [];
  return plano.mesas.filter((o) => o.id !== id && solapan(m, o));
}

function reemplazar(plano, id, cambio) {
  return { ...plano, mesas: plano.mesas.map((m) => (m.id === id ? { ...m, ...cambio } : m)) };
}

export function colocarMesa(plano, id, x, y) {
  const m = plano.mesas.find((x2) => x2.id === id);
  if (!m) return plano;
  return reemplazar(plano, id, encajar(m, x, y, altoZona(plano, m.zona)));
}

export function moverMesa(plano, id, dx, dy) {
  const m = plano.mesas.find((x) => x.id === id);
  if (!m) return plano;
  return colocarMesa(plano, id, m.x + dx, m.y + dy);
}

/** Primer lugar libre de la zona (barrido por filas). Si no hay, la esquina. */
export function lugarLibre(plano, zona, mesa) {
  const { w, h } = tamanoMesa(mesa);
  const alto = altoZona(plano, zona);
  for (let y = 2; y <= alto - h; y += 2) {
    for (let x = 2; x <= ANCHO - w; x += 2) {
      const prueba = { ...mesa, zona, x, y };
      if (!plano.mesas.some((o) => o.id !== mesa.id && solapan(prueba, o))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export function siguienteNumero(plano) {
  const usados = new Set(plano.mesas.map((m) => m.numero));
  let n = 1;
  while (usados.has(n)) n++;
  return n;
}

export function agregarMesa(plano, zona, generarId) {
  if (!plano.zonas.some((z) => z.id === zona)) return { ok: false, error: 'La zona no existe.' };
  const base = { id: generarId(), numero: siguienteNumero(plano), forma: 'cuadrada', capacidad: 4, zona, x: 0, y: 0 };
  const pos = lugarLibre(plano, zona, base);
  const mesa = { ...base, ...pos };
  return { ok: true, plano: { ...plano, mesas: [...plano.mesas, mesa] }, mesa };
}

/** `ocupadas`: Set de números de mesa con cuenta abierta. */
export function quitarMesa(plano, id, ocupadas = new Set()) {
  const m = plano.mesas.find((x) => x.id === id);
  if (!m) return { ok: false, error: 'No existe esa mesa.' };
  if (ocupadas.has(m.numero)) return { ok: false, error: `La mesa ${m.numero} tiene una cuenta abierta. Cóbrala y libérala antes de quitarla.` };
  return { ok: true, plano: { ...plano, mesas: plano.mesas.filter((x) => x.id !== id) } };
}

export function cambiarMesa(plano, id, cambios, ocupadas = new Set()) {
  const m = plano.mesas.find((x) => x.id === id);
  if (!m) return { ok: false, error: 'No existe esa mesa.' };
  const nueva = { ...m };
  if ('numero' in cambios) {
    const n = Number(cambios.numero);
    if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, error: 'El número de mesa va de 1 a 999.' };
    if (n !== m.numero && plano.mesas.some((o) => o.numero === n)) return { ok: false, error: `Ya hay una mesa ${n}.` };
    if (n !== m.numero && ocupadas.has(m.numero)) return { ok: false, error: `La mesa ${m.numero} tiene una cuenta abierta; cambia el número cuando esté libre.` };
    nueva.numero = n;
  }
  if ('forma' in cambios) {
    if (!FORMAS.includes(cambios.forma)) return { ok: false, error: 'Forma desconocida.' };
    nueva.forma = cambios.forma;
  }
  if ('capacidad' in cambios) {
    const c = Number(cambios.capacidad);
    if (!Number.isInteger(c) || c < CAP_MIN || c > CAP_MAX) return { ok: false, error: `La capacidad va de ${CAP_MIN} a ${CAP_MAX} personas.` };
    nueva.capacidad = c;
  }
  if ('zona' in cambios && cambios.zona !== m.zona) {
    if (!plano.zonas.some((z) => z.id === cambios.zona)) return { ok: false, error: 'La zona no existe.' };
    nueva.zona = cambios.zona;
    Object.assign(nueva, lugarLibre(plano, nueva.zona, nueva));
  }
  Object.assign(nueva, encajar(nueva, nueva.x, nueva.y, altoZona(plano, nueva.zona)));
  return { ok: true, plano: reemplazar(plano, id, nueva) };
}

export function agregarZona(plano, nombre, generarId) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) return { ok: false, error: 'Escribe el nombre de la zona.' };
  if (plano.zonas.some((z) => z.nombre.toLowerCase() === limpio.toLowerCase())) return { ok: false, error: `Ya hay una zona «${limpio}».` };
  const zona = { id: generarId(), nombre: limpio, alto: 40 };
  return { ok: true, plano: { ...plano, zonas: [...plano.zonas, zona] }, zona };
}

export function renombrarZona(plano, id, nombre) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) return { ok: false, error: 'Escribe el nombre de la zona.' };
  if (plano.zonas.some((z) => z.id !== id && z.nombre.toLowerCase() === limpio.toLowerCase())) return { ok: false, error: `Ya hay una zona «${limpio}».` };
  return { ok: true, plano: { ...plano, zonas: plano.zonas.map((z) => (z.id === id ? { ...z, nombre: limpio } : z)) } };
}

/** Cambia el alto de una zona y vuelve a encajar sus mesas dentro. */
export function cambiarAltoZona(plano, id, alto) {
  const a = Number(alto);
  if (!Number.isInteger(a) || a < ALTO_MIN || a > ALTO_MAX) return { ok: false, error: `El alto de la zona va de ${ALTO_MIN} a ${ALTO_MAX}.` };
  const zonas = plano.zonas.map((z) => (z.id === id ? { ...z, alto: a } : z));
  const p = { ...plano, zonas };
  return { ok: true, plano: { ...p, mesas: p.mesas.map((m) => (m.zona === id ? { ...m, ...encajar(m, m.x, m.y, a) } : m)) } };
}

export function quitarZona(plano, id) {
  const n = plano.mesas.filter((m) => m.zona === id).length;
  if (n > 0) return { ok: false, error: `La zona tiene ${n} ${n === 1 ? 'mesa' : 'mesas'}. Muévelas o quítalas primero.` };
  if (plano.zonas.length <= 1) return { ok: false, error: 'El plano necesita al menos una zona.' };
  return { ok: true, plano: { ...plano, zonas: plano.zonas.filter((z) => z.id !== id) } };
}

export function validarPlano(plano) {
  const errores = [];
  if (!plano || !Array.isArray(plano.zonas) || !Array.isArray(plano.mesas)) return { ok: false, errores: ['El plano no tiene zonas o mesas.'] };
  const zonas = new Set(plano.zonas.map((z) => z.id));
  const numeros = new Set();
  for (const m of plano.mesas) {
    if (numeros.has(m.numero)) errores.push(`Hay dos mesas ${m.numero}.`);
    numeros.add(m.numero);
    if (!zonas.has(m.zona)) errores.push(`La mesa ${m.numero} está en una zona que no existe.`);
    if (!FORMAS.includes(m.forma)) errores.push(`La mesa ${m.numero} tiene una forma desconocida.`);
    const { w, h } = tamanoMesa(m);
    if (m.x < 0 || m.y < 0 || m.x + w > ANCHO || m.y + h > altoZona(plano, m.zona)) errores.push(`La mesa ${m.numero} se sale de su zona.`);
  }
  return { ok: errores.length === 0, errores };
}

/** Paso de teclado: flechas mueven PASO_TECLADO; con Mayús, PASO_TECLADO_GRANDE. Devuelve [dx, dy] o null. */
export function pasoTecla(tecla, mayus = false) {
  const p = mayus ? PASO_TECLADO_GRANDE : PASO_TECLADO;
  return { ArrowLeft: [-p, 0], ArrowRight: [p, 0], ArrowUp: [0, -p], ArrowDown: [0, p] }[tecla] ?? null;
}
