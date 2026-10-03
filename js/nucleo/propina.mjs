// Propina: voluntaria, elegida por el comensal y en una línea aparte.
//
// ACODECO (mayo de 2026; Ley 45 de 2007, art. 56) recordó que no puede venir incluida de antemano. Por eso
// aquí no hay valor por defecto: sin elección, no hay propina calculada y el pago no sigue. El porcentaje se
// calcula sobre el total consumido (precio final, ITBMS incluido) y la pantalla dice sobre qué cifra.

import { dividirRedondeando, leerMonto } from './dinero.mjs';

export const PROPINAS_SUGERIDAS = [10, 15, 20];

/** Propina de un porcentaje entero sobre una base en centésimos, redondeo mitad hacia arriba. */
export function propinaPorcentaje(baseC, pct) {
  if (!Number.isSafeInteger(baseC) || baseC < 0) throw new RangeError('base no válida');
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RangeError('porcentaje no válido');
  return dividirRedondeando(baseC * pct, 100);
}

/**
 * Resuelve lo que eligió el comensal.
 * eleccion: null | {tipo:'pct', pct} | {tipo:'monto', texto|monto} | {tipo:'ninguna'}
 * Devuelve {ok:true, propina, base, total, pct?} o {ok:false, motivo}.
 * La cifra libre no puede ser negativa ni pasar del total consumido (evita «450» por «4.50»).
 */
export function resolverPropina(baseC, eleccion) {
  if (!Number.isSafeInteger(baseC) || baseC < 0) return { ok: false, motivo: 'base' };
  if (!eleccion || typeof eleccion !== 'object') return { ok: false, motivo: 'sin-eleccion' };
  if (eleccion.tipo === 'ninguna') return { ok: true, propina: 0, base: baseC, total: baseC, pct: 0 };
  if (eleccion.tipo === 'pct') {
    if (!Number.isInteger(eleccion.pct) || eleccion.pct < 0 || eleccion.pct > 100) return { ok: false, motivo: 'pct' };
    const propina = propinaPorcentaje(baseC, eleccion.pct);
    return { ok: true, propina, base: baseC, total: baseC + propina, pct: eleccion.pct };
  }
  if (eleccion.tipo === 'monto') {
    const m = typeof eleccion.monto === 'number' ? eleccion.monto : leerMonto(eleccion.texto ?? '');
    if (m === null || !Number.isSafeInteger(m)) return { ok: false, motivo: 'monto-ilegible' };
    if (m < 0) return { ok: false, motivo: 'monto-negativo' };
    if (m > baseC) return { ok: false, motivo: 'monto-alto' };
    return { ok: true, propina: m, base: baseC, total: baseC + m };
  }
  return { ok: false, motivo: 'tipo' };
}

/** Lista de opciones a mostrar, en orden: la primera es la costumbre panameña (10 %). */
export function opcionesPropina(sugeridas = PROPINAS_SUGERIDAS) {
  const limpias = [...new Set(sugeridas.filter((p) => Number.isInteger(p) && p > 0 && p <= 50))];
  return [
    ...limpias.map((pct) => ({ tipo: 'pct', pct })),
    { tipo: 'monto' },
    { tipo: 'ninguna' },
  ];
}
