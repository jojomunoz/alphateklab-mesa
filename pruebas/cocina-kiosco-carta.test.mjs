import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { semaforo, minutosDesde, ticketsCocina, listosParaServir, sinAcusar } from '../js/nucleo/cocina.mjs';
import { faseInactividad, sugerencia, formatoOrden } from '../js/nucleo/kiosco.mjs';
import { validarCarta, armarRenglon, alergenosDe, parcheCarta, aplicarParche, validarSeleccion, texto, huellaCarta, cartaAlDia } from '../js/nucleo/carta.mjs';
import { textoPrecios } from '../js/nucleo/textos.mjs';
import { crearSemilla } from '../js/nucleo/semilla.mjs';

const CARTA = JSON.parse(readFileSync(new URL('../datos/carta.json', import.meta.url)));
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

test('semáforo de cocina: verde < 10, ámbar 10-20, rojo > 20, con texto', () => {
  assert.deepEqual(semaforo(0), { nivel: 'verde', texto: 'A tiempo' });
  assert.equal(semaforo(9).nivel, 'verde');
  assert.equal(semaforo(10).nivel, 'ambar');
  assert.equal(semaforo(20).nivel, 'ambar');
  assert.deepEqual(semaforo(21), { nivel: 'rojo', texto: 'Atrasado' });
  assert.equal(semaforo(-3).nivel, 'verde');
  assert.equal(semaforo(NaN).nivel, 'verde');
  assert.equal(minutosDesde(T0 - 9 * 60000 - 59000, T0), 9);
  assert.equal(minutosDesde(T0 + 5000, T0), 0);
});

test('tickets: uno por pedido y estación, el más viejo primero, filtrables', () => {
  const e = crearSemilla({ sala: 'abcdefghjk', carta: CARTA, ahora: T0, generarPin: () => '000' });
  const todos = ticketsCocina(e);
  assert.ok(todos.length >= 4);
  for (let i = 1; i < todos.length; i++) assert.ok(todos[i - 1].entrada <= todos[i].entrada);
  const bar = ticketsCocina(e, { estacion: 'bar' });
  assert.ok(bar.every((t) => t.estacion === 'bar'));
  assert.ok(bar.length >= 1); // el chicheme del kiosco
  // el pedido por aceptar de la mesa 14 no aparece
  assert.ok(!todos.some((t) => t.mesa === 14));
  // la ropa vieja de la mesa 11 tiene sus fríos listos: solo queda el ticket caliente
  assert.deepEqual(todos.filter((t) => t.mesa === 11).map((t) => t.estacion), ['caliente']);
  const listos = listosParaServir(e);
  assert.ok(listos.some((x) => x.mesa === 11 && !x.completo));
  assert.deepEqual(sinAcusar(e).length, 1); // la orden del kiosco todavía no la vio una pantalla de cocina
});

test('kiosco: vuelve al reposo a los 60 s, con aviso los últimos 10', () => {
  assert.deepEqual(faseInactividad(0), { fase: 'activo', segundos: 60 });
  assert.equal(faseInactividad(49_999).fase, 'activo');
  assert.deepEqual(faseInactividad(50_000), { fase: 'aviso', segundos: 10 });
  assert.deepEqual(faseInactividad(59_100), { fase: 'aviso', segundos: 1 });
  assert.deepEqual(faseInactividad(60_000), { fase: 'reposo', segundos: 0 });
  assert.equal(faseInactividad(-5).fase, 'activo');
});

test('kiosco: una sola sugerencia, con reglas simples', () => {
  assert.equal(sugerencia([], CARTA), null);
  assert.equal(sugerencia([{ plato: 'ropa-vieja' }], CARTA).id, 'chicheme'); // sin bebida: la primera bebida disponible
  assert.equal(sugerencia([{ plato: 'ropa-vieja' }, { plato: 'chicheme' }], CARTA).id, 'cocadas'); // fuerte sin postre
  assert.equal(sugerencia([{ plato: 'carimanolas' }, { plato: 'cerveza' }], CARTA), null);
  const sinChicheme = { ...CARTA, platos: CARTA.platos.map((p) => (p.id === 'chicheme' ? { ...p, agotado: true } : p)) };
  assert.equal(sugerencia([{ plato: 'ropa-vieja' }], sinChicheme).id, 'chicha-tamarindo');
  assert.equal(formatoOrden(7), '007');
  assert.equal(formatoOrden(123), '123');
});

test('carta de ejemplo: válida, bilingüe, alcohol al 10 % y lo demás al 7 %', () => {
  assert.deepEqual(validarCarta(CARTA), { ok: true, errores: [] });
  for (const p of CARTA.platos) {
    assert.ok(texto(p.nombre, 'es') && texto(p.nombre, 'en'), p.id);
    assert.equal(p.itbms, p.cat === 'con-alcohol' ? 10 : 7, p.id);
    assert.ok(Number.isSafeInteger(p.precio) && p.precio > 0);
  }
  for (const id of ['carimanolas', 'patacones-ceviche', 'hojaldras', 'tamal-de-olla', 'sancocho', 'arroz-con-pollo', 'ropa-vieja', 'corvina-frita', 'bistec-picado', 'cocadas', 'arroz-con-leche', 'raspao', 'chicheme', 'chicha-tamarindo', 'chicha-saril', 'cafe-boquete', 'agua', 'cerveza', 'ron-coco']) {
    assert.ok(CARTA.platos.some((p) => p.id === id), `falta ${id}`);
  }
});

test('precio de un renglón con extras, y alérgenos que trae una opción', () => {
  const r = armarRenglon(CARTA, { plato: 'arroz-con-pollo', cant: 2, mods: [{ grupo: 'acomp-sin-arroz', opcion: 'tajadas' }, { grupo: 'extra', opcion: 'huevo' }], nota: '  poco aceite ' });
  assert.ok(r.ok);
  assert.equal(r.renglon.unit, 950 + 100);
  assert.equal(r.renglon.monto, 2100);
  assert.equal(r.renglon.nota, 'poco aceite');
  assert.deepEqual(alergenosDe(CARTA, 'cafe-boquete', [{ grupo: 'cafe', opcion: 'leche' }]), ['lacteos']);
  assert.deepEqual(alergenosDe(CARTA, 'arroz-con-pollo', [{ grupo: 'extra', opcion: 'huevo' }]), ['huevo']);
  const dos = validarSeleccion(CARTA, 'churrasco', [{ grupo: 'termino', opcion: 'medio' }, { grupo: 'termino', opcion: 'bien-cocido' }, { grupo: 'acomp', opcion: 'coco' }]);
  assert.equal(dos.ok, false);
  assert.equal(validarSeleccion(CARTA, 'agua', [{ grupo: 'termino', opcion: 'medio' }]).ok, false);
  assert.equal(armarRenglon(CARTA, { plato: 'tamal-de-olla', cant: 1 }).error, 'agotado');
  assert.equal(armarRenglon(CARTA, { plato: 'agua', cant: 1, nota: 'x'.repeat(500) }).renglon.nota.length, 140);
});

test('validarCarta encuentra lo roto al importar', () => {
  assert.equal(validarCarta(null).ok, false);
  assert.equal(validarCarta({}).ok, false);
  const rota = structuredClone(CARTA);
  rota.platos[0].precio = 4.5;
  rota.platos[1].cat = 'inexistente';
  rota.platos[2].itbms = 12;
  rota.platos[3].grupos = ['fantasma'];
  rota.platos.push({ ...rota.platos[5] });
  const v = validarCarta(rota);
  assert.equal(v.ok, false);
  assert.equal(v.errores.length, 5, v.errores.join('\n'));
});

test('parche de carta: agotados, precios cambiados y platos quitados viajan en pocos bytes', () => {
  const actual = structuredClone(CARTA);
  actual.platos.find((p) => p.id === 'cerveza').agotado = true;
  actual.platos.find((p) => p.id === 'sancocho').precio = 800;
  actual.platos = actual.platos.filter((p) => p.id !== 'agua');
  const parche = parcheCarta(CARTA, actual);
  assert.deepEqual(parche.precios, { sancocho: 800 });
  assert.ok(parche.agotados.includes('cerveza') && parche.agotados.includes('tamal-de-olla'));
  assert.deepEqual(parche.ocultos, ['agua']);
  const enTelefono = aplicarParche(CARTA, parche);
  assert.equal(enTelefono.platos.find((p) => p.id === 'sancocho').precio, 800);
  assert.equal(enTelefono.platos.find((p) => p.id === 'cerveza').agotado, true);
  assert.equal(enTelefono.platos.some((p) => p.id === 'agua'), false);
  assert.equal(CARTA.platos.find((p) => p.id === 'cerveza').agotado, false, 'no muta la base');
});

test('parche de carta: el teléfono remoto ve los precios de las opciones, los platos nuevos y los nombres de la caja', () => {
  const actual = structuredClone(CARTA);
  const extra = actual.grupos.find((g) => g.opciones.some((o) => o.precio > 0));
  const opcion = extra.opciones.find((o) => o.precio > 0);
  opcion.precio += 100; // «Huevo frito» de 1.00 a 2.00
  actual.platos.push({ id: 'pescado-especial', cat: actual.platos[0].cat, precio: 1650, itbms: 7, estacion: 'caliente', nombre: { es: 'Pescado al ajillo especial', en: 'Special garlic fish' }, desc: { es: '', en: '' }, alergenos: ['pescado'], grupos: [], agotado: false });
  actual.categorias[0].nombre = { es: 'Para empezar', en: 'To start' };
  actual.platos[1].nombre = { es: 'Patacones con ceviche', en: 'Tostones with ceviche' };
  actual.platos[2].itbms = 10;
  const parche = JSON.parse(JSON.stringify(parcheCarta(CARTA, actual)));
  const tel = aplicarParche(CARTA, parche);
  assert.equal(huellaCarta(tel), huellaCarta(actual), 'el teléfono llega a la misma carta que la caja');
  assert.equal(cartaAlDia(tel, parche), true);
  assert.equal(tel.grupos.find((g) => g.id === extra.id).opciones.find((o) => o.id === opcion.id).precio, opcion.precio);
  assert.ok(tel.platos.some((p) => p.id === 'pescado-especial'));
  assert.equal(tel.categorias[0].nombre.es, 'Para empezar');
  assert.equal(tel.platos[2].itbms, 10);
  // Lo mismo que cobra la caja: el precio de un renglón con la opción, armado con la carta del teléfono.
  const plato = actual.platos.find((p) => (p.grupos ?? []).includes(extra.id));
  const sel = [{ grupo: extra.id, opcion: opcion.id }];
  const conDatos = (carta) => armarRenglon(carta, { plato: plato.id, cant: 1, mods: [...sel, ...(plato.grupos ?? []).filter((g) => g !== extra.id).map((g) => ({ grupo: g, opcion: carta.grupos.find((x) => x.id === g).opciones[0].id }))] });
  assert.equal(conDatos(tel).renglon.unit, conDatos(actual).renglon.unit);
  // Sin cambios, el parche no trae nada más que lo de siempre.
  const vacio = parcheCarta(CARTA, structuredClone(CARTA));
  assert.deepEqual(Object.keys(vacio).sort(), ['agotados', 'h', 'ocultos', 'precios']);
  // Si la diferencia no llega entera (resumen recortado), el teléfono lo sabe.
  const recortado = { agotados: parche.agotados, precios: {}, ocultos: [], h: parche.h };
  assert.equal(cartaAlDia(aplicarParche(CARTA, recortado), recortado), false);
});

test('la línea de los precios dice la verdad en una fonda', () => {
  assert.match(textoPrecios('es', 'restaurante'), /ITBMS incluido/);
  assert.doesNotMatch(textoPrecios('es', 'fonda'), /ITBMS incluido/);
  assert.match(textoPrecios('es', 'fonda'), /no llevan ITBMS/);
  assert.match(textoPrecios('en', 'fonda'), /no ITBMS/);
});

test('fotos: solo rutas de esta carta, y una caja guardada recibe las del ejemplo sin perder lo editado', async () => {
  const { fotoPlato, completarFotos } = await import('../js/nucleo/carta.mjs');
  assert.equal(fotoPlato(CARTA.platos[0], 200), `img/platos/${CARTA.platos[0].id}-200.webp`);
  assert.equal(fotoPlato({ foto: 'https://otro.sitio/x' }, 200), null);
  assert.equal(fotoPlato({ foto: 'img/platos/../../x' }, 200), null);
  assert.equal(fotoPlato({}, 200), null);
  const ajena = structuredClone(CARTA);
  ajena.platos[0].foto = 'https://otro.sitio/espia.gif';
  assert.ok(validarCarta(ajena).errores.some((e) => /foto/.test(e)));
  assert.ok(validarCarta(CARTA).ok, validarCarta(CARTA).errores.join('\n'));
  // Una caja guardada antes de las fotos: el dueño cambió un precio y agregó un plato propio.
  const vieja = structuredClone(CARTA);
  for (const p of vieja.platos) delete p.foto;
  delete vieja.sugerencias;
  vieja.platos[0].precio = 999;
  vieja.platos.push({ ...vieja.platos[1], id: 'plato-propio' });
  assert.equal(completarFotos(vieja, CARTA), true);
  assert.equal(vieja.platos[0].precio, 999);
  assert.equal(vieja.platos[0].foto, CARTA.platos[0].foto);
  assert.equal(vieja.platos.at(-1).foto, undefined);
  assert.deepEqual(vieja.sugerencias, CARTA.sugerencias);
  assert.equal(completarFotos(vieja, CARTA), false);
});
