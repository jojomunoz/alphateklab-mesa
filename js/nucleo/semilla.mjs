// Datos de ejemplo: el plano de Pixbae (restaurante ficticio) y un servicio en curso.
//
// El servicio se arma pasando acciones reales por `aplicar`, con horas en el pasado, así que no puede quedar en
// un estado que la caja no permitiría. La mesa 7 queda libre a propósito: es la del QR de la portada.

import { estadoVacio, aplicar } from './caja.mjs';

export function planoEjemplo(generarPin = () => '000') {
  const m = (numero, zona, forma, capacidad, x, y) => ({ id: `m${numero}`, numero, zona, forma, capacidad, x, y, pin: generarPin() });
  return {
    zonas: [
      { id: 'salon', nombre: 'Salón', alto: 50 },
      { id: 'terraza', nombre: 'Terraza', alto: 34 },
      { id: 'barra', nombre: 'Barra', alto: 24 },
    ],
    mesas: [
      m(1, 'salon', 'redonda', 2, 6, 6),
      m(2, 'salon', 'cuadrada', 4, 24, 5),
      m(3, 'salon', 'cuadrada', 4, 42, 5),
      m(4, 'salon', 'rectangular', 6, 62, 6),
      m(5, 'salon', 'redonda', 4, 6, 30),
      m(6, 'salon', 'cuadrada', 4, 24, 30),
      m(7, 'salon', 'cuadrada', 4, 42, 30),
      m(8, 'salon', 'rectangular', 8, 62, 31),
      m(9, 'terraza', 'redonda', 2, 6, 12),
      m(10, 'terraza', 'redonda', 4, 26, 11),
      m(11, 'terraza', 'cuadrada', 4, 46, 11),
      m(12, 'terraza', 'rectangular', 6, 68, 12),
      m(13, 'barra', 'redonda', 2, 14, 8),
      m(14, 'barra', 'redonda', 2, 34, 8),
      m(15, 'barra', 'redonda', 2, 54, 8),
    ],
  };
}

/** Pin de 3 cifras. */
export function pinAleatorio(aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const b = aleatorio(2);
  return String(((b[0] << 8) | b[1]) % 1000).padStart(3, '0');
}

export function crearSemilla({ sala, carta, ahora = Date.now(), epoca = 'e0', generarPin = () => pinAleatorio() }) {
  let e = estadoVacio({ sala, carta: structuredClone(carta), plano: planoEjemplo(generarPin), epoca });
  const MIN = 60_000;
  let k = 0;
  const ap = (tipo, mesa, datos, haceMin, id) => {
    const t = ahora - haceMin * MIN;
    const accion = { v: 1, tipo, mesa, datos, id: id ?? `s${epoca}-${++k}`, t, disp: null };
    const r = aplicar(e, accion, { ahora: t });
    if (r.error) throw new Error(`semilla: ${tipo} ${r.error} ${JSON.stringify(r.detalle ?? '')}`);
    e = r.estado;
    return accion.id;
  };

  // Mesa 4: comió hace una hora, ya pagó en efectivo; falta liberarla.
  const p4 = ap('pedido', 4, { renglones: [
    { plato: 'sancocho', cant: 2, mods: [] },
    { plato: 'corvina-ajillo', cant: 1, mods: [{ grupo: 'acomp', opcion: 'coco' }] },
    { plato: 'chicheme', cant: 3, mods: [] },
  ] }, 75);
  ap('aceptar-pedido', null, { pedido: p4 }, 74);
  for (const r of ['1', '2', '3']) ap('cocina-renglon', null, { pedido: p4, renglon: r, hecho: true }, 60);
  ap('cocina-listo', null, { pedido: p4, estacion: 'caliente' }, 58);
  ap('cocina-listo', null, { pedido: p4, estacion: 'bar' }, 58);
  ap('servir-pedido', null, { pedido: p4 }, 57);
  ap('cobrar', 4, { pagos: [{ metodo: 'efectivo', monto: 3800, propina: 400, recibido: 5000 }] }, 4);

  // Mesa 10 (terraza): ya comió y pidió la cuenta hace 2 minutos.
  const p10 = ap('pedido', 10, { renglones: [
    { plato: 'churrasco', cant: 1, mods: [{ grupo: 'termino', opcion: 'medio' }, { grupo: 'acomp', opcion: 'ensalada' }] },
    { plato: 'arroz-con-pollo', cant: 1, mods: [{ grupo: 'acomp-sin-arroz', opcion: 'patacones' }] },
    { plato: 'ron-coco', cant: 1, mods: [] },
    { plato: 'agua', cant: 1, mods: [] },
  ] }, 52);
  ap('aceptar-pedido', null, { pedido: p10 }, 51);
  for (const r of ['1', '2', '3', '4']) ap('cocina-renglon', null, { pedido: p10, renglon: r, hecho: true }, 38);
  ap('cocina-listo', null, { pedido: p10, estacion: 'caliente' }, 37);
  ap('cocina-listo', null, { pedido: p10, estacion: 'bar' }, 37);
  ap('servir-pedido', null, { pedido: p10 }, 35);
  ap('cuenta', 10, { accion: 'pedir' }, 2);

  // Mesa 11 (terraza): ropa vieja atrasada (24 min) y llama al mesero.
  const p11 = ap('pedido', 11, { renglones: [
    { plato: 'ropa-vieja', cant: 2, mods: [] },
    { plato: 'patacones-ceviche', cant: 1, mods: [{ grupo: 'quitar', opcion: 'aji' }] },
  ] }, 25);
  ap('aceptar-pedido', null, { pedido: p11 }, 24);
  ap('cocina-recibir', null, { pedido: p11 }, 24);
  ap('cocina-renglon', null, { pedido: p11, renglon: '2', hecho: true }, 19);
  ap('cocina-listo', null, { pedido: p11, estacion: 'frios' }, 19);
  ap('llamada', 11, { motivo: 'ayuda', texto: '' }, 2);

  // Mesa 5: pedido de hace 14 min; las cervezas salieron, la corvina ya está, falta el bistec.
  const p5 = ap('pedido', 5, { renglones: [
    { plato: 'corvina-frita', cant: 1, mods: [{ grupo: 'acomp', opcion: 'patacones' }] },
    { plato: 'bistec-picado', cant: 1, mods: [{ grupo: 'acomp', opcion: 'coco' }, { grupo: 'quitar', opcion: 'cebolla' }] },
    { plato: 'cerveza', cant: 2, mods: [] },
  ] }, 15);
  ap('aceptar-pedido', null, { pedido: p5 }, 14);
  ap('cocina-recibir', null, { pedido: p5 }, 14);
  ap('cocina-renglon', null, { pedido: p5, renglon: '3', hecho: true }, 12);
  ap('cocina-listo', null, { pedido: p5, estacion: 'bar' }, 12);
  ap('cocina-renglon', null, { pedido: p5, renglon: '1', hecho: true }, 3);

  // Mesa 2: pedido de hace 6 min; las chichas ya salieron.
  const p2 = ap('pedido', 2, { renglones: [
    { plato: 'sancocho', cant: 1, mods: [] },
    { plato: 'arroz-con-pollo', cant: 1, mods: [{ grupo: 'acomp-sin-arroz', opcion: 'tajadas' }], nota: 'Bien caliente, por favor' },
    { plato: 'chicha-tamarindo', cant: 2, mods: [] },
  ] }, 7);
  ap('aceptar-pedido', null, { pedido: p2 }, 6);
  ap('cocina-recibir', null, { pedido: p2 }, 6);
  ap('cocina-renglon', null, { pedido: p2, renglon: '3', hecho: true }, 4);
  ap('cocina-listo', null, { pedido: p2, estacion: 'bar' }, 4);

  // Kiosco: una orden para llevar de hace 9 min, por pagar en caja.
  ap('kiosco-orden', null, { renglones: [
    { plato: 'carimanolas', cant: 1, mods: [] },
    { plato: 'chicheme', cant: 1, mods: [] },
  ], llevar: true, pago: 'caja' }, 9);

  // Mesa 8: se acaban de sentar.
  ap('abrir-mesa', 8, {}, 3);

  // Mesa 14 (barra): pidió por QR hace un minuto; espera que el mesero lo acepte.
  ap('pedido', 14, { renglones: [
    { plato: 'cerveza', cant: 2, mods: [] },
    { plato: 'carimanolas', cant: 1, mods: [] },
  ] }, 1);

  e.errores = [];
  e.semilla = { t: ahora, tocado: false };
  return e;
}
