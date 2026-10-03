// `node --test pruebas/` (como lo pide el brief) en Node 22 trata la carpeta como un módulo: este archivo
// la hace funcionar cargando cada *.test.mjs de la carpeta. `node --test` sin argumentos también las encuentra.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
for (const f of readdirSync(__dirname).filter((x) => x.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(join(__dirname, f)).href);
}
