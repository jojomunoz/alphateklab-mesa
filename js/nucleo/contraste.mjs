// Contraste WCAG 2.x entre dos colores hexadecimales.

export function hexARgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new RangeError(`color no válido: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function luminancia(hex) {
  const [r, g, b] = hexARgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Variables `--nombre: #hex;` de un bloque de CSS (el primero que coincida con el selector). */
export function leerTokens(css, selector) {
  const i = css.indexOf(selector);
  if (i < 0) return {};
  const ini = css.indexOf('{', i);
  let prof = 0;
  let fin = ini;
  for (let k = ini; k < css.length; k++) {
    if (css[k] === '{') prof++;
    if (css[k] === '}') {
      prof--;
      if (prof === 0) {
        fin = k;
        break;
      }
    }
  }
  const bloque = css.slice(ini + 1, fin);
  const out = {};
  for (const m of bloque.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
