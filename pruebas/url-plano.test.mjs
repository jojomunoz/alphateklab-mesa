import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarSala, esSala, urlMesa, leerParametros, baseDe, bytesNdefUrl, cabeEnEtiqueta, ALFABETO_SALA } from '../js/nucleo/url.mjs';
import {
  encajar, moverMesa, colocarMesa, agregarMesa, quitarMesa, cambiarMesa, agregarZona, quitarZona, renombrarZona,
  cambiarAltoZona, validarPlano, pasoTecla, tamanoMesa, cruces, ANCHO,
} from '../js/nucleo/plano.mjs';
import { planoEjemplo } from '../js/nucleo/semilla.mjs';

test('sala: 10 caracteres sin letras que se confunden', () => {
  for (let i = 0; i < 200; i++) {
    const s = generarSala();
    assert.equal(s.length, 10);
    assert.ok(esSala(s));
    assert.ok(!/[01ilo]/.test(s), s);
  }
  // con bytes fijos es determinista y descarta los ≥ 248 (sin sesgo)
  const fijo = () => new Uint8Array([255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 31, 250, 0, 0]);
  assert.equal(generarSala(fijo), ALFABETO_SALA.slice(0, 10));
  assert.equal(esSala('ABCDEFGHJK'), false);
  assert.equal(esSala('abc'), false);
});

test('URL de la mesa: corta y con la forma de la especificación', () => {
  const base = baseDe('https://jojomunoz.github.io/alphateklab-mesa/index.html?x=1#y');
  assert.equal(base, 'https://jojomunoz.github.io/alphateklab-mesa/');
  assert.equal(urlMesa(base, 'abcdefghjk', 7), 'https://jojomunoz.github.io/alphateklab-mesa/mesa.html?sala=abcdefghjk&m=7');
  assert.throws(() => urlMesa(base, 'corta', 7), RangeError);
  assert.throws(() => urlMesa(base, 'abcdefghjk', 0), RangeError);
});

test('leer ?sala=…&m=… sin adivinar', () => {
  assert.deepEqual(leerParametros('?sala=abcdefghjk&m=7'), { sala: 'abcdefghjk', mesa: 7, errores: [] });
  assert.deepEqual(leerParametros('?sala=ABCDEFGHJK&m=12'), { sala: 'abcdefghjk', mesa: 12, errores: [] });
  assert.deepEqual(leerParametros(''), { sala: null, mesa: null, errores: [] });
  assert.deepEqual(leerParametros('?sala=abcdefghjk'), { sala: 'abcdefghjk', mesa: null, errores: [] });
  assert.deepEqual(leerParametros('?m=abc').errores, ['mesa']);
  assert.deepEqual(leerParametros('?m=0').errores, ['mesa']);
  assert.deepEqual(leerParametros('?m=7.5').errores, ['mesa']);
  assert.deepEqual(leerParametros('?m=-3').errores, ['mesa']);
  assert.deepEqual(leerParametros('?sala=hola').errores, ['sala']);
});

test('NFC: la URL de mesa entra en una NTAG213 (144 bytes)', () => {
  const url = 'https://jojomunoz.github.io/alphateklab-mesa/mesa.html?sala=abcdefghjk&m=999';
  // «https://» se guarda como 1 byte de prefijo; el resto, 71 bytes; más 8 fijos = 79
  assert.equal(bytesNdefUrl(url), 8 + url.length - 'https://'.length);
  const r = cabeEnEtiqueta(url, 'NTAG213');
  assert.equal(r.cabe, true);
  assert.equal(r.capacidad, 144);
  assert.equal(bytesNdefUrl('https://www.ejemplo.com/a'), 8 + 'ejemplo.com/a'.length);
  // 136 caracteres después de «https://» es el máximo de una NTAG213
  assert.equal(cabeEnEtiqueta('https://' + 'a'.repeat(136)).cabe, true);
  assert.equal(cabeEnEtiqueta('https://' + 'a'.repeat(137)).cabe, false);
  assert.equal(cabeEnEtiqueta('https://' + 'a'.repeat(400), 'NTAG216').cabe, true);
});

const plano = () => planoEjemplo(() => '111');
let n = 0;
const gid = () => `nuevo${++n}`;

test('plano: encajar dentro de la zona y mover con teclado', () => {
  const p = plano();
  const m1 = p.mesas.find((m) => m.numero === 1);
  assert.deepEqual(encajar(m1, -5, -5, 50), { x: 0, y: 0 });
  assert.deepEqual(encajar(m1, 999, 999, 50), { x: ANCHO - tamanoMesa(m1).w, y: 50 - tamanoMesa(m1).h });
  const movido = moverMesa(p, 'm1', ...pasoTecla('ArrowRight'));
  assert.equal(movido.mesas.find((m) => m.id === 'm1').x, m1.x + 2);
  const grande = moverMesa(p, 'm1', ...pasoTecla('ArrowDown', true));
  assert.equal(grande.mesas.find((m) => m.id === 'm1').y, m1.y + 10);
  assert.equal(pasoTecla('Enter'), null);
  const arrastre = colocarMesa(p, 'm1', 30.4, 20.6);
  assert.deepEqual([arrastre.mesas[0].x, arrastre.mesas[0].y], [30, 21]);
  assert.equal(p.mesas[0].x, 6, 'no muta el plano original');
});

test('plano: el de ejemplo es válido y sin mesas encimadas', () => {
  const p = plano();
  assert.deepEqual(validarPlano(p), { ok: true, errores: [] });
  for (const m of p.mesas) assert.deepEqual(cruces(p, m.id), [], `mesa ${m.numero}`);
});

test('plano: agregar toma el siguiente número y un lugar libre', () => {
  const r = agregarMesa(plano(), 'barra', gid);
  assert.ok(r.ok);
  assert.equal(r.mesa.numero, 16);
  assert.deepEqual(cruces(r.plano, r.mesa.id), []);
  assert.ok(validarPlano(r.plano).ok);
  assert.equal(agregarMesa(plano(), 'sotano', gid).ok, false);
});

test('plano: no se quita ni se renumera una mesa con cuenta abierta', () => {
  const ocupadas = new Set([2]);
  assert.equal(quitarMesa(plano(), 'm2', ocupadas).ok, false);
  assert.ok(quitarMesa(plano(), 'm3', ocupadas).ok);
  assert.match(cambiarMesa(plano(), 'm2', { numero: 40 }, ocupadas).error, /cuenta abierta/);
  assert.match(cambiarMesa(plano(), 'm3', { numero: 2 }).error, /Ya hay una mesa 2/);
  const r = cambiarMesa(plano(), 'm3', { numero: 30, forma: 'redonda', capacidad: 6 });
  assert.ok(r.ok);
  assert.equal(r.plano.mesas.find((m) => m.id === 'm3').numero, 30);
  assert.equal(cambiarMesa(plano(), 'm3', { capacidad: 0 }).ok, false);
  assert.equal(cambiarMesa(plano(), 'm3', { forma: 'triangular' }).ok, false);
});

test('plano: cambiar de zona la recoloca en un lugar libre de la nueva', () => {
  const r = cambiarMesa(plano(), 'm1', { zona: 'barra' });
  assert.ok(r.ok);
  const m = r.plano.mesas.find((x) => x.id === 'm1');
  assert.equal(m.zona, 'barra');
  assert.deepEqual(cruces(r.plano, 'm1'), []);
  assert.ok(validarPlano(r.plano).ok);
});

test('zonas: agregar, renombrar, cambiar alto y quitar solo si está vacía', () => {
  const a = agregarZona(plano(), 'Patio', gid);
  assert.ok(a.ok);
  assert.equal(agregarZona(a.plano, 'patio', gid).ok, false);
  assert.equal(renombrarZona(a.plano, a.zona.id, '  ').ok, false);
  assert.ok(renombrarZona(a.plano, a.zona.id, 'Patio de atrás').ok);
  assert.match(quitarZona(plano(), 'barra').error, /3 mesas/);
  assert.ok(quitarZona(a.plano, a.zona.id).ok);
  const bajo = cambiarAltoZona(plano(), 'salon', 20);
  assert.ok(bajo.ok);
  assert.ok(validarPlano(bajo.plano).ok, validarPlano(bajo.plano).errores.join(' '));
  assert.equal(cambiarAltoZona(plano(), 'salon', 5).ok, false);
});

test('validarPlano detecta números repetidos y mesas fuera de la zona', () => {
  const p = plano();
  p.mesas[1].numero = 1;
  p.mesas[2].x = 99;
  const v = validarPlano(p);
  assert.equal(v.ok, false);
  assert.equal(v.errores.length, 2);
});
