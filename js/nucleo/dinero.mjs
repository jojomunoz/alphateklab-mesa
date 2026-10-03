// Dinero en centésimos enteros. Nunca flotantes.
//
// Los precios de la carta ya traen el ITBMS adentro (Ley 473 de 2025: desde el 19-jun-2026 el precio que se
// muestra es el final). Por eso aquí el impuesto no se suma: se calcula el que va CONTENIDO en cada renglón,
// `monto × tasa / (100 + tasa)`, redondeado al centésimo «mitad hacia arriba», una vez por renglón.
//
// Formato: Panamá escribe el decimal con punto y los miles con coma («B/. 1,234.50»), como lo imprimen las
// cartas y los recibos del país y como lo trae CLDR para es-PA. La especificación escribía «45,00»; se eligió el
// uso local y está anotado en CLAUDE.md. Cambiarlo es tocar solo `formatear`.

export const MONEDA = 'B/.';
export const TASAS_ITBMS = [0, 7, 10];

export function esCentesimos(n) {
  return Number.isSafeInteger(n);
}

function exigirEntero(n, nombre) {
  if (!Number.isSafeInteger(n)) throw new TypeError(`${nombre} debe ser un entero de centésimos (llegó ${n})`);
}

/** División entera con redondeo «mitad hacia arriba» para numerador y denominador no negativos. */
export function dividirRedondeando(numerador, denominador) {
  exigirEntero(numerador, 'numerador');
  exigirEntero(denominador, 'denominador');
  if (numerador < 0 || denominador <= 0) throw new RangeError('solo numerador ≥ 0 y denominador > 0');
  return Math.floor((2 * numerador + denominador) / (2 * denominador));
}

/** ITBMS contenido en un monto que ya lo incluye. `tasa` en por ciento entero (7, 10). */
export function impuestoContenido(montoC, tasa) {
  exigirEntero(montoC, 'monto');
  if (!TASAS_ITBMS.includes(tasa)) throw new RangeError(`tasa de ITBMS no válida: ${tasa}`);
  if (tasa === 0) return 0;
  return dividirRedondeando(montoC * tasa, 100 + tasa);
}

/**
 * Desglose de ITBMS por tasa de una lista de renglones `{monto, tasa}` (monto = precio final del renglón).
 * Redondea por renglón y suma; así la cuenta cuadra con lo que dice cada renglón.
 */
export function desglosarItbms(renglones) {
  const porTasa = new Map();
  let total = 0;
  let impuesto = 0;
  for (const r of renglones) {
    exigirEntero(r.monto, 'monto del renglón');
    const imp = impuestoContenido(r.monto, r.tasa);
    total += r.monto;
    impuesto += imp;
    const t = porTasa.get(r.tasa) ?? { tasa: r.tasa, total: 0, impuesto: 0, base: 0 };
    t.total += r.monto;
    t.impuesto += imp;
    t.base = t.total - t.impuesto;
    porTasa.set(r.tasa, t);
  }
  return {
    total,
    impuesto,
    base: total - impuesto,
    porTasa: [...porTasa.values()].sort((a, b) => a.tasa - b.tasa),
  };
}

/** «B/. 1,234.50». Negativos con signo delante del símbolo. */
export function formatear(c, { simbolo = true } = {}) {
  exigirEntero(c, 'monto');
  const signo = c < 0 ? '−' : '';
  const abs = Math.abs(c);
  const enteros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cent = String(abs % 100).padStart(2, '0');
  const cifra = `${enteros}.${cent}`;
  return simbolo ? `${signo}${MONEDA} ${cifra}` : `${signo}${cifra}`;
}

/**
 * Lee un monto escrito por una persona: «4.50», «4,50», «4», «1,500», «1.234,50», «B/. 12». Devuelve
 * centésimos o `null` si no se entiende. Regla: con dos separadores, el último es el decimal; con uno solo,
 * es decimal si lo siguen 1 o 2 cifras y de miles si lo siguen 3.
 */
export function leerMonto(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) && texto >= 0 ? Math.round(texto * 100) : null;
  if (typeof texto !== 'string') return null;
  let s = texto.trim().replace(/^B\/\.?\s*/i, '').replace(/^\$\s*/, '').replace(/\s/g, '');
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  const ultimoPunto = s.lastIndexOf('.');
  const ultimaComa = s.lastIndexOf(',');
  let enteros = s;
  let decimales = '';
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const sep = Math.max(ultimoPunto, ultimaComa);
    enteros = s.slice(0, sep).replace(/[.,]/g, '');
    decimales = s.slice(sep + 1);
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sepChar = ultimoPunto >= 0 ? '.' : ',';
    const partes = s.split(sepChar);
    const ultima = partes[partes.length - 1];
    if (partes.length === 2 && ultima.length >= 1 && ultima.length <= 2) {
      enteros = partes[0];
      decimales = ultima;
    } else if (partes.slice(1).every((p) => p.length === 3)) {
      enteros = partes.join('');
    } else {
      return null;
    }
  }
  if (!/^\d*$/.test(enteros) || !/^\d{0,2}$/.test(decimales)) return null;
  if (enteros === '' && decimales === '') return null;
  const c = Number(enteros || '0') * 100 + Number(decimales.padEnd(2, '0') || '0');
  return Number.isSafeInteger(c) ? c : null;
}

/** Suma segura de centésimos. */
export function sumar(lista) {
  let s = 0;
  for (const n of lista) {
    exigirEntero(n, 'sumando');
    s += n;
  }
  return s;
}
