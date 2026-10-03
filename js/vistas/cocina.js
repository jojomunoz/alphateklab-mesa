// cocina.html · comandas como tickets en el riel, por estación, con hora de entrada y minutos de espera.

import { $, h, icono, pintar, hora } from '../ui/dom.js';
import { anunciar, crearSonido } from '../ui/comun.js';
import { arrancarCaja } from '../ui/arranque.js';
import { leer, escribir } from '../ui/almacen.js';
import { ticketsCocina, listosParaServir, sinAcusar, semaforo, minutosDesde } from '../nucleo/cocina.mjs';
import { formatoOrden } from '../nucleo/kiosco.mjs';
import { texto, indexar } from '../nucleo/carta.mjs';
import { buscarPedido } from '../nucleo/caja.mjs';
import { textoError } from '../nucleo/textos.mjs';

const ESTACIONES = [
  { id: null, nombre: 'Todas' },
  { id: 'caliente', nombre: 'Cocina caliente' },
  { id: 'frios', nombre: 'Fríos' },
  { id: 'bar', nombre: 'Bar' },
];

const sonido = crearSonido();
const deshacer = [];
const vistos = new Set();
let primeraVez = true;
let filtro = leer('cocina-filtro', null);
let caja = null;

function nombreEstacion(id) {
  return ESTACIONES.find((e) => e.id === id)?.nombre ?? id;
}

function origen(t) {
  if (t.orden !== null) return `Orden ${formatoOrden(t.orden)}`;
  return `Mesa ${t.mesa}`;
}

function descripcion(accion) {
  if (accion.tipo === 'renglon') return `${accion.hecho ? 'renglón hecho' : 'renglón pendiente'} · ${accion.etiqueta}`;
  return `listo para servir · ${accion.etiqueta}`;
}

async function hacer(accion, registro) {
  const r = await caja.despachar(accion);
  if (r.error) {
    anunciar(`No se pudo: ${r.error === 'transicion' ? 'ese pedido ya cambió en el salón. Mira el estado en el salón.' : textoError(r.error)}`, { tipo: 'alerta' });
    return false;
  }
  if (registro) {
    deshacer.push(registro);
    if (deshacer.length > 20) deshacer.shift();
  }
  pintarDeshacer();
  return true;
}

function pintarDeshacer() {
  const b = $('#boton-deshacer');
  const ultimo = deshacer.at(-1);
  b.disabled = !ultimo;
  b.querySelector('span').textContent = ultimo ? `Deshacer: ${descripcion(ultimo)}` : 'Deshacer último toque';
}

async function deshacerUltimo() {
  const a = deshacer.pop();
  if (!a) return;
  const r = a.tipo === 'renglon'
    ? await caja.despachar({ tipo: 'cocina-renglon', datos: { pedido: a.pedido, renglon: a.renglon, hecho: !a.hecho } })
    : await caja.despachar({ tipo: 'cocina-deshacer-listo', datos: { pedido: a.pedido, estacion: a.estacion } });
  if (r.error) {
    // El salón ya lo sirvió (o el pedido ya no está): nada de ese pedido se puede deshacer, así que sale de la pila
    // entero en vez de fallar una vez por cada toque.
    for (let i = deshacer.length - 1; i >= 0; i--) if (deshacer[i].pedido === a.pedido) deshacer.splice(i, 1);
    const servido = caja.estado && buscarPedido(caja.estado, a.pedido)?.pedido.estado === 'servido';
    anunciar(`Ya no se puede deshacer (${a.etiqueta}): ${servido ? 'el salón ya lo sirvió' : 'ese pedido ya cambió en el salón'}.`, { tipo: 'alerta', duracion: 6000 });
    pintarDeshacer();
    return;
  }
  $('#anuncio-cocina').textContent = `Deshecho: ${descripcion(a)}`;
  pintarDeshacer();
}

function pintarFiltro() {
  pintar(
    $('#filtro'),
    ESTACIONES.map((e) =>
      h(
        'button',
        {
          type: 'button',
          class: 'filtro__boton',
          'aria-pressed': String(filtro === e.id),
          'data-foco': `filtro-${e.id}`,
          onclick: () => {
            filtro = e.id;
            escribir('cocina-filtro', filtro);
            pintarFiltro();
            pintarTablero();
          },
        },
        e.nombre,
      ),
    ),
  );
}

function ticket(t, ahora, { enColumna = false } = {}) {
  const min = minutosDesde(t.entrada, ahora);
  const s = semaforo(min);
  const nuevo = !primeraVez && !vistos.has(t.clave);
  const carta = indexar(caja.estado.carta);
  const etiqueta = `${origen(t)} · ${nombreEstacion(t.estacion)}`;
  return h(
    'article',
    { class: `ticket ticket--cocina nivel-${s.nivel}${nuevo ? ' ticket--nuevo' : ''}`, 'aria-labelledby': `t-${t.clave}`, 'data-clave': t.clave },
    h(
      'header',
      { class: 'ticket-cocina__banda' },
      h('h3', { class: 'ticket-cocina__origen', id: `t-${t.clave}` }, origen(t), t.orden !== null ? h('span', { class: 'ticket-cocina__llevar' }, t.llevar ? ' · Para llevar' : ' · Comer aquí') : h('span', { class: 'ticket-cocina__ronda' }, ` · Ronda ${t.ronda}`)),
      h('p', { class: 'ticket-cocina__tiempo' }, icono(s.nivel === 'verde' ? 'reloj' : 'alerta'), h('span', {}, h('time', { datetime: new Date(t.entrada).toISOString() }, hora(t.entrada)), ` · ${min} min · ${s.texto}`)),
    ),
    filtro === null && !enColumna ? h('p', { class: 'ticket-cocina__estacion' }, nombreEstacion(t.estacion)) : null,
    h(
      'ul',
      { class: 'renglones-cocina' },
      t.renglones.map((r) => {
        const plato = carta.platos.get(r.plato);
        const mods = r.mods.map((m) => m.nombre).join(', ');
        return h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'renglon-cocina',
              'aria-pressed': String(r.hecho),
              'data-foco': `${t.clave}-${r.id}`,
              onclick: () => hacer({ tipo: 'cocina-renglon', datos: { pedido: t.pedido, renglon: r.id, hecho: !r.hecho } }, { tipo: 'renglon', pedido: t.pedido, renglon: r.id, hecho: !r.hecho, etiqueta: `${r.cant} × ${r.nombre} (${origen(t)})` }),
            },
            h('span', { class: 'renglon-cocina__marca', 'aria-hidden': 'true' }, r.hecho ? icono('check') : null),
            h('span', { class: 'renglon-cocina__texto' },
              h('span', { class: 'renglon-cocina__plato' }, h('strong', { class: 'cifra' }, `${r.cant} ×`), ' ', plato ? texto(plato.nombre, 'es') : r.nombre),
              mods ? h('span', { class: 'renglon-cocina__mods' }, mods) : null,
              r.nota ? h('span', { class: 'renglon-cocina__nota' }, `Nota: «${r.nota}»`) : null,
            ),
            h('span', { class: 'visualmente-oculto' }, r.hecho ? ' (hecho)' : ' (pendiente)'),
          ),
        );
      }),
    ),
    t.completo
      ? h(
          'footer',
          { class: 'ticket-cocina__pie' },
          h(
            'button',
            {
              type: 'button',
              class: 'boton boton--grande boton--ancho boton-listo',
              'data-foco': `listo-${t.clave}`,
              onclick: () => hacer({ tipo: 'cocina-listo', datos: { pedido: t.pedido, estacion: t.estacion } }, { tipo: 'listo', pedido: t.pedido, estacion: t.estacion, etiqueta }),
            },
            icono('check'),
            'Listo para servir',
          ),
        )
      : null,
  );
}

function pintarTablero() {
  if (!caja) return;
  const ahora = Date.now();
  const tablero = $('#tablero');
  const todos = ticketsCocina(caja.estado, { estacion: filtro });
  const nuevos = todos.filter((t) => !vistos.has(t.clave));
  if (!primeraVez && nuevos.length) {
    sonido.tocar();
    $('#anuncio-cocina').textContent = `Nueva comanda: ${nuevos.map(origen).join(', ')}`;
  }

  let contenido;
  if (!todos.length) {
    contenido = h('p', { class: 'vacio-cocina' }, filtro ? `Sin comandas para ${nombreEstacion(filtro).toLowerCase()}.` : 'Sin comandas.', ' Las nuevas entran aquí con su hora de entrada.');
  } else if (filtro === null && matchMedia('(min-width: 1100px)').matches) {
    contenido = h(
      'div',
      { class: 'columnas' },
      ESTACIONES.filter((e) => e.id).map((e) => {
        const lista = todos.filter((t) => t.estacion === e.id);
        return h(
          'section',
          { class: 'columna', 'aria-labelledby': `col-${e.id}` },
          h('h3', { class: 'columna__titulo', id: `col-${e.id}` }, e.nombre, h('span', { class: 'columna__cuenta cifra' }, ` ${lista.length}`)),
          lista.length ? h('ul', { class: 'riel' }, lista.map((t) => h('li', {}, ticket(t, ahora, { enColumna: true })))) : h('p', { class: 'vacio-cocina vacio-cocina--columna' }, 'Nada pendiente.'),
        );
      }),
    );
  } else {
    contenido = h('ul', { class: 'riel riel--flujo' }, todos.map((t) => h('li', {}, ticket(t, ahora))));
  }
  pintar(tablero, contenido);
  for (const t of todos) vistos.add(t.clave);
  primeraVez = false;

  // Listos para servir
  const listos = listosParaServir(caja.estado);
  $('#listos').hidden = !listos.length;
  pintar(
    $('#lista-listos'),
    listos.map((x) =>
      h(
        'li',
        { class: 'listo' },
        icono('check'),
        h('span', {}, h('strong', {}, x.orden !== null ? `Orden ${formatoOrden(x.orden)}` : `Mesa ${x.mesa}`), x.completo ? ` · ronda ${x.ronda}, todo listo` : ` · ${x.estaciones.map(nombreEstacion).join(' y ')} listo; falta lo demás`, x.completo ? h('span', { class: 'listo__desde' }, ` · desde las ${hora(x.desde)}`) : null),
      ),
    ),
  );
}

function acusar() {
  // «Recibido en cocina» es honesto solo si esta pantalla está a la vista.
  if (document.visibilityState !== 'visible' || !caja) return;
  for (const id of sinAcusar(caja.estado)) caja.despachar({ tipo: 'cocina-recibir', datos: { pedido: id } });
}

function pintarReloj() {
  $('#reloj').textContent = hora(Date.now());
}

async function iniciar() {
  const r = await arrancarCaja();
  if (!r) return;
  caja = r.caja;
  pintarFiltro();
  pintarReloj();
  pintarTablero();
  acusar();
  caja.suscribir(() => {
    pintarTablero();
    acusar();
  });
  document.addEventListener('visibilitychange', acusar);
  matchMedia('(min-width: 1100px)').addEventListener('change', pintarTablero);
  setInterval(() => {
    pintarReloj();
    pintarTablero();
  }, 15_000);
  $('#boton-deshacer').addEventListener('click', deshacerUltimo);
  $('#boton-sonido').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (sonido.activo) {
      sonido.desactivar();
      b.setAttribute('aria-pressed', 'false');
      b.querySelector('span').textContent = 'Activar sonido';
      b.querySelector('use').setAttribute('href', 'img/iconos.svg#sonido-no');
    } else {
      try {
        await sonido.activar();
        b.setAttribute('aria-pressed', 'true');
        b.querySelector('span').textContent = 'Sonido activado';
        b.querySelector('use').setAttribute('href', 'img/iconos.svg#sonido');
      } catch {
        anunciar('Este navegador no deja reproducir sonido.', { tipo: 'alerta' });
      }
    }
  });
}

iniciar();
