// Ayudas mínimas para armar el DOM sin innerHTML (los textos de pedidos y notas vienen de otras personas).

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/**
 * h('button', {class: 'x', onclick: fn, 'aria-label': '…'}, 'texto', otroNodo)
 * Atributos con valor false/null/undefined no se ponen. `dataset` y `style` como objetos.
 */
export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string' && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';

export function icono(nombre, clase = 'icono') {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `img/iconos.svg#${nombre}`);
  svg.append(use);
  return svg;
}

/** Reemplaza el contenido de `raiz` sin perder el foco: busca el elemento con el mismo data-foco. */
export function pintar(raiz, ...hijos) {
  const activo = document.activeElement;
  const clave = activo && raiz.contains(activo) ? activo.dataset?.foco : null;
  const scroll = raiz.scrollTop;
  raiz.replaceChildren();
  agregar(raiz, hijos);
  raiz.scrollTop = scroll;
  if (clave) {
    const nuevo = raiz.querySelector(`[data-foco="${CSS.escape(clave)}"]`);
    if (nuevo) nuevo.focus({ preventScroll: true });
  }
}

const fmtHora = new Intl.DateTimeFormat('es-PA', { hour: 'numeric', minute: '2-digit' });
export function hora(t) {
  return fmtHora.format(new Date(t));
}

export function hace(t, ahora = Date.now()) {
  const min = Math.max(0, Math.floor((ahora - t) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return `hace ${horas} h ${min % 60} min`;
}

export function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}
