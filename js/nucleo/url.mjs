// La dirección de cada mesa: la que va en el QR y en la etiqueta NFC.

// Sin 0/o, 1/l/i: el código se puede dictar o copiar a mano sin confundirse.
export const ALFABETO_SALA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const LARGO_SALA = 10;
export const MESA_MAX = 999;

export function esSala(s) {
  return typeof s === 'string' && s.length === LARGO_SALA && [...s].every((c) => ALFABETO_SALA.includes(c));
}

/** `aleatorio(n)` devuelve n bytes (Uint8Array). En el navegador y en Node: crypto.getRandomValues. */
export function generarSala(aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let s = '';
  // Rechazo de bytes para no sesgar: 31 letras, se aceptan bytes < 248 (8 × 31).
  while (s.length < LARGO_SALA) {
    for (const b of aleatorio(16)) {
      if (b < 248 && s.length < LARGO_SALA) s += ALFABETO_SALA[b % ALFABETO_SALA.length];
    }
  }
  return s;
}

export function generarId(largo = 12, aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let s = '';
  while (s.length < largo) {
    for (const b of aleatorio(largo * 2)) {
      if (b < 248 && s.length < largo) s += ALFABETO_SALA[b % ALFABETO_SALA.length];
    }
  }
  return s;
}

/** Normaliza la base: siempre termina en «/» y no lleva archivo. «…/alphateklab-mesa/index.html» → «…/alphateklab-mesa/». */
export function baseDe(href) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.toString();
}

/** URL corta de la mesa: `<base>mesa.html?sala=<código>&m=<n>`. */
export function urlMesa(base, sala, mesa) {
  if (!esSala(sala)) throw new RangeError('código de sala no válido');
  if (!Number.isInteger(mesa) || mesa < 1 || mesa > MESA_MAX) throw new RangeError('número de mesa no válido');
  return `${base}mesa.html?sala=${sala}&m=${mesa}`;
}

/** Lee `?sala=…&m=…`. Devuelve {sala|null, mesa|null, errores:[]} sin adivinar nada. */
export function leerParametros(search) {
  const p = new URLSearchParams(search);
  const errores = [];
  let sala = p.get('sala');
  if (sala !== null) {
    sala = sala.trim().toLowerCase();
    if (!esSala(sala)) {
      errores.push('sala');
      sala = null;
    }
  }
  let mesa = null;
  const m = p.get('m');
  if (m !== null) {
    const n = Number(m.trim());
    if (Number.isInteger(n) && n >= 1 && n <= MESA_MAX && /^\d+$/.test(m.trim())) mesa = n;
    else errores.push('mesa');
  }
  return { sala, mesa, errores };
}

// Prefijos de URI de NFC Forum (RTD URI). Se usa el más largo que coincida.
const PREFIJOS_NDEF = [
  [0x02, 'https://www.'],
  [0x01, 'http://www.'],
  [0x04, 'https://'],
  [0x03, 'http://'],
];

export const CAPACIDAD_NTAG = { NTAG213: 144, NTAG215: 504, NTAG216: 888 };

/**
 * Bytes que ocupa la URL grabada como un registro NDEF de tipo URI en una etiqueta Type 2 (NTAG21x):
 * TLV (1 tipo + 1 largo) + cabecera del registro (1) + largo del tipo (1) + largo del contenido (1, registro corto)
 * + tipo «U» (1) + código de prefijo (1) + resto de la URL en UTF-8 + TLV terminador (1). Son 8 bytes fijos.
 */
export function bytesNdefUrl(url) {
  let resto = url;
  for (const [, prefijo] of PREFIJOS_NDEF) {
    if (url.startsWith(prefijo)) {
      resto = url.slice(prefijo.length);
      break;
    }
  }
  const largo = new TextEncoder().encode(resto).length;
  const contenido = 1 + largo;
  if (contenido > 255) return 3 + 4 + contenido + 3; // registro largo y TLV de 3 bytes: no cabe en una NTAG213
  return 8 + largo;
}

export function cabeEnEtiqueta(url, modelo = 'NTAG213') {
  const capacidad = CAPACIDAD_NTAG[modelo];
  const bytes = bytesNdefUrl(url);
  return { cabe: bytes <= capacidad, bytes, capacidad };
}
