import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Módulos que carga una página, siguiendo los import estáticos. */
function grafo(entrada, vistos = new Set()) {
  if (vistos.has(entrada)) return vistos;
  vistos.add(entrada);
  const src = readFileSync(join(RAIZ, entrada), 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    grafo(relative(RAIZ, normalize(join(RAIZ, dirname(entrada), m[1]))), vistos);
  }
  return vistos;
}

test('el service worker guarda todos los módulos de la carta (sin red, mesa.html no puede quedar a medias)', () => {
  const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  const precarga = new Set([...sw.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]));
  const faltan = [...grafo('js/vistas/mesa.js')].filter((f) => !precarga.has(f));
  assert.deepEqual(faltan, []);
});
