// kiosco.html · pantalla táctil de autopedido. Todo con toques grandes, nada de hover. Vuelve sola al reposo
// a los 60 s sin uso, con aviso los últimos 10.

import { $, $$, h, icono, pintar } from '../ui/dom.js';
import { anunciar, imgPlato } from '../ui/comun.js';
import { arrancarCaja } from '../ui/arranque.js';
import { leer, escribir } from '../ui/almacen.js';
import { t as tr, textoError, textoPrecios } from '../nucleo/textos.mjs';
import { formatear } from '../nucleo/dinero.mjs';
import { texto, indexar, validarSeleccion, alergenosDe, MAX_CANT } from '../nucleo/carta.mjs';
import { faseInactividad, sugerencia, formatoOrden } from '../nucleo/kiosco.mjs';

const VUELTA_ORDEN_MS = 25_000;

let caja = null;
const k = {
  idioma: leer('kiosco-idioma') === 'en' ? 'en' : 'es',
  fase: 'reposo',
  cat: null,
  carrito: [],
  llevar: null,
  pago: null,
  sugerenciaDescartada: false,
  orden: null,
  ultimoToque: Date.now(),
  ordenDesde: 0,
  enviando: false,
};

const T = (c, v) => tr(k.idioma, c, v);
const dinero = (c) => formatear(c);
const carta = () => caja.estado.carta;

function precioUnit(platoId, mods) {
  const { platos, grupos } = indexar(carta());
  const p = platos.get(platoId);
  if (!p) return 0;
  return p.precio + mods.reduce((s, m) => s + (grupos.get(m.grupo)?.opciones.find((o) => o.id === m.opcion)?.precio ?? 0), 0);
}

function nombre(id) {
  const p = indexar(carta()).platos.get(id);
  return p ? texto(p.nombre, k.idioma) : id;
}

function nombreOpcion(g, o) {
  const grupo = indexar(carta()).grupos.get(g);
  const op = grupo?.opciones.find((x) => x.id === o);
  return op ? texto(op.nombre, k.idioma) : o;
}

function total() {
  return k.carrito.reduce((s, x) => s + precioUnit(x.plato, x.mods) * x.cant, 0);
}

function agregar(plato, cant, mods) {
  const clave = `${plato}|${mods.map((m) => `${m.grupo}.${m.opcion}`).sort().join(',')}`;
  const ex = k.carrito.find((x) => x.clave === clave);
  if (ex) ex.cant = Math.min(MAX_CANT, ex.cant + cant);
  else k.carrito.push({ clave, plato, cant, mods });
}

function aplicarTextos() {
  document.documentElement.lang = k.idioma;
  for (const el of $$('[data-t]')) el.textContent = T(el.dataset.t);
  for (const b of $$('[data-idioma]')) b.setAttribute('aria-pressed', String(b.dataset.idioma === k.idioma));
}

function ir(fase) {
  k.fase = fase;
  $('#reposo').hidden = fase !== 'reposo';
  $('#pantalla').hidden = fase === 'reposo';
  document.body.dataset.fase = fase;
  pintarPantalla();
  if (fase !== 'reposo') $('#pantalla').querySelector('h1, h2')?.focus({ preventScroll: true });
}

function reiniciar() {
  k.carrito = [];
  k.llevar = null;
  k.pago = null;
  k.sugerenciaDescartada = false;
  k.orden = null;
  k.cat = null;
  k.enviando = false;
  for (const d of $$('dialog[open]')) d.close();
  ir('reposo');
  $('#boton-empezar').focus({ preventScroll: true });
}

// ——— Pantallas ———
function pintarPantalla() {
  const p = $('#pantalla');
  if (k.fase === 'pedido') pintar(p, pantallaPedido());
  if (k.fase === 'pagar') pintar(p, pantallaPagar());
  if (k.fase === 'orden') pintar(p, pantallaOrden());
}

function cabeza() {
  return h(
    'header',
    { class: 'kiosco__cabeza' },
    h('p', { class: 'kiosco__local' }, icono('pixbae', 'kiosco__marca'), 'Pixbae', h('span', {}, ` · ${T('ejemplo')}`)),
    h('div', { class: 'kiosco__cabeza-botones' },
      h('button', { type: 'button', class: 'boton boton--secundario boton-k', 'data-foco': 'idioma', lang: k.idioma === 'es' ? 'en' : 'es', onclick: () => { k.idioma = k.idioma === 'es' ? 'en' : 'es'; escribir('kiosco-idioma', k.idioma); aplicarTextos(); pintarPantalla(); } }, icono('idioma'), T('idiomaBoton')),
      h('button', { type: 'button', class: 'boton boton--secundario boton-k', 'data-foco': 'reiniciar', onclick: reiniciar }, T('empezarDeNuevo')),
    ),
  );
}

function pantallaPedido() {
  const c = carta();
  const cats = c.categorias.filter((x) => c.platos.some((p) => p.cat === x.id));
  if (!k.cat || !cats.some((x) => x.id === k.cat)) k.cat = cats[0]?.id ?? null;
  const platos = c.platos.filter((p) => p.cat === k.cat);
  const n = k.carrito.reduce((s, x) => s + x.cant, 0);
  return h(
    'div',
    { class: 'k-pedido' },
    cabeza(),
    h('h1', { class: 'visualmente-oculto', tabindex: '-1' }, T('tocaParaPedir')),
    h(
      'nav',
      { class: 'k-categorias', 'aria-label': T('navCategorias') },
      cats.map((x) => h('button', { type: 'button', class: 'k-categoria', 'aria-pressed': String(x.id === k.cat), 'data-foco': `kc-${x.id}`, onclick: () => { k.cat = x.id; pintarPantalla(); } }, texto(x.nombre, k.idioma))),
    ),
    h(
      'section',
      { class: 'k-platos', 'aria-label': texto(c.categorias.find((x) => x.id === k.cat)?.nombre, k.idioma) },
      platos.length
        ? h('ul', { class: 'k-platos__lista' },
            platos.map((p) =>
              h('li', {},
                h('button', {
                  type: 'button',
                  class: 'k-plato',
                  'data-plato': p.id,
                  'data-foco': `kp-${p.id}`,
                  'aria-disabled': p.agotado ? 'true' : false,
                  onclick: () => (p.agotado ? anunciar(`${texto(p.nombre, k.idioma)}: ${T('agotado')}`) : abrirPlato(p.id)),
                },
                  imgPlato(p, { clase: 'k-plato__foto', sizes: '(min-width: 900px) 360px, 50vw', ancho: 480 }),
                  h('span', { class: 'k-plato__texto' },
                    h('span', { class: 'k-plato__nombre' }, texto(p.nombre, k.idioma)),
                    texto(p.desc, k.idioma) ? h('span', { class: 'k-plato__desc' }, texto(p.desc, k.idioma)) : null,
                    h('span', { class: 'k-plato__precio cifra' }, p.agotado ? T('agotado') : dinero(p.precio)),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'vacio' }, T('vacioCategoria')),
    ),
    h(
      'aside',
      { class: 'k-carrito', 'aria-labelledby': 'k-carrito-titulo' },
      h('h2', { id: 'k-carrito-titulo', class: 'k-carrito__titulo' }, T('tuPedidoKiosco'), n ? h('span', { class: 'contador' }, String(n)) : null),
      k.carrito.length
        ? h('ul', { class: 'k-carrito__lista' },
            k.carrito.map((x, i) =>
              h('li', { class: 'k-renglon' },
                h('span', { class: 'k-renglon__texto' }, h('strong', {}, nombre(x.plato)), x.mods.length ? h('span', { class: 'k-renglon__mods' }, x.mods.map((m) => nombreOpcion(m.grupo, m.opcion)).join(', ')) : null),
                h('span', { class: 'k-renglon__control' },
                  h('button', { type: 'button', class: 'boton-icono boton-icono--k', 'aria-label': `${T('menos')}: ${nombre(x.plato)}`, 'data-foco': `km-${i}`, onclick: () => { x.cant--; if (x.cant <= 0) k.carrito.splice(i, 1); pintarPantalla(); } }, icono(x.cant <= 1 ? 'basura' : 'menos')),
                  h('span', { class: 'cifra k-renglon__cant' }, String(x.cant)),
                  h('button', { type: 'button', class: 'boton-icono boton-icono--k', 'aria-label': `${T('mas')}: ${nombre(x.plato)}`, 'data-foco': `kmas-${i}`, disabled: x.cant >= MAX_CANT, onclick: () => { x.cant++; pintarPantalla(); } }, icono('mas')),
                ),
                h('span', { class: 'k-renglon__monto cifra' }, dinero(precioUnit(x.plato, x.mods) * x.cant)),
              ),
            ),
          )
        : h('div', { class: 'k-carrito__vacio' }, h('p', {}, T('kioscoVacio')), sugeridos(c)),
      h('div', { class: 'k-carrito__pie' },
        h('p', { class: 'k-carrito__total' }, h('span', {}, T('total')), h('strong', { class: 'cifra' }, dinero(total()))),
        h('p', { class: 'ayuda' }, textoPrecios(k.idioma, caja?.estado?.ajustes?.tipoLocal)),
        h('button', { type: 'button', class: 'boton boton--primario boton-k boton-k--grande', 'data-foco': 'ir-pagar', disabled: !k.carrito.length, onclick: () => ir('pagar') }, T('irAPagar')),
      ),
    ),
  );
}

/** Con el pedido vacío, las sugerencias de la casa (las elige el local en la carta) llenan el hueco del carrito. */
function sugeridos(c) {
  const lista = (c.sugerencias ?? []).map((id) => c.platos.find((p) => p.id === id)).filter((p) => p && !p.agotado).slice(0, 3);
  if (!lista.length) return null;
  return h('section', { class: 'k-sugeridos', 'aria-labelledby': 'k-sugeridos-titulo' },
    h('h3', { id: 'k-sugeridos-titulo', class: 'k-sugeridos__titulo' }, T('sugerenciasCasa')),
    h('ul', { class: 'k-sugeridos__lista' },
      lista.map((p) => h('li', {},
        h('button', { type: 'button', class: 'k-sugerido', 'data-foco': `ks-${p.id}`, onclick: () => abrirPlato(p.id) },
          imgPlato(p, { clase: 'k-sugerido__foto', sizes: '(min-width: 900px) 300px, 30vw', ancho: 480 }),
          h('span', { class: 'k-sugerido__nombre' }, texto(p.nombre, k.idioma)),
          h('span', { class: 'k-sugerido__precio cifra' }, dinero(p.precio)),
        ),
      )),
    ),
  );
}

function abrirPlato(id) {
  const c = carta();
  const { platos, grupos } = indexar(c);
  const p = platos.get(id);
  const dlg = $('#dlg-plato');
  let cant = 1;
  const sel = () => {
    const out = [];
    for (const gid of p.grupos ?? []) for (const inp of dlg.querySelectorAll(`[name="kg-${gid}"]:checked`)) out.push({ grupo: gid, opcion: inp.value });
    return out;
  };
  const precio = h('span', { class: 'cifra' });
  const cantidad = h('output', { class: 'cifra k-cantidad__valor', 'aria-live': 'polite' }, '1');
  const error = h('p', { class: 'mensaje-error', role: 'alert' });
  const alerg = h('p', { class: 'ayuda' });
  const act = () => {
    precio.textContent = dinero(precioUnit(id, sel()) * cant);
    cantidad.textContent = String(cant);
    const al = alergenosDe(c, id, sel()).map((a) => texto((c.alergenos ?? []).find((x) => x.id === a)?.nombre, k.idioma) || a);
    alerg.textContent = al.length ? T('contiene', { lista: al.join(', ') }) : '';
  };
  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-plato-titulo' }, texto(p.nombre, k.idioma)), h('button', { type: 'button', class: 'boton-icono boton-icono--k', 'aria-label': T('cerrar'), onclick: () => dlg.close() }, icono('x'))),
    h('div', { class: 'hoja__cuerpo' },
      texto(p.desc, k.idioma) ? h('p', {}, texto(p.desc, k.idioma)) : null,
      alerg,
      (p.grupos ?? []).map((gid) => {
        const g = grupos.get(gid);
        return h('fieldset', { class: 'grupo', 'data-grupo': gid },
          h('legend', {}, texto(g.nombre, k.idioma), ' ', h('span', { class: 'grupo__regla' }, g.obligatorio ? T('eligeUna') : T('opcional'))),
          h('div', { class: 'grupo__opciones k-opciones' },
            g.opciones.map((o) => h('label', { class: 'opcion opcion--k' }, h('input', { type: g.tipo === 'uno' ? 'radio' : 'checkbox', name: `kg-${gid}`, value: o.id, onchange: () => { error.textContent = ''; act(); } }), h('span', { class: 'opcion__texto' }, texto(o.nombre, k.idioma)), o.precio ? h('span', { class: 'opcion__extra' }, `+ ${dinero(o.precio)}`) : null)),
          ),
        );
      }),
      h('div', { class: 'k-cantidad', role: 'group', 'aria-label': T('cantidad') },
        h('button', { type: 'button', class: 'boton-icono boton-icono--k', 'aria-label': T('menos'), onclick: () => { cant = Math.max(1, cant - 1); act(); } }, icono('menos')),
        cantidad,
        h('button', { type: 'button', class: 'boton-icono boton-icono--k', 'aria-label': T('mas'), onclick: () => { cant = Math.min(MAX_CANT, cant + 1); act(); } }, icono('mas')),
      ),
    ),
    h('div', { class: 'hoja__pie' }, error,
      h('button', {
        type: 'button',
        class: 'boton boton--primario boton-k boton-k--grande boton--con-total',
        onclick: () => {
          const v = validarSeleccion(c, id, sel());
          if (!v.ok) {
            const g = grupos.get(v.faltan[0]);
            error.textContent = g ? T('faltaElegir', { grupo: texto(g.nombre, k.idioma) }) : v.errores[0];
            return;
          }
          agregar(id, cant, sel());
          dlg.close();
          pintarPantalla();
        },
      }, h('span', {}, T('agregar')), precio),
    ),
  );
  act();
  dlg.showModal();
}

function pantallaPagar() {
  const sug = k.sugerenciaDescartada ? null : sugerencia(k.carrito, carta());
  const listo = k.llevar !== null && k.pago !== null;
  return h(
    'div',
    { class: 'k-pagar' },
    cabeza(),
    h('div', { class: 'k-pagar__cuerpo' },
      h('h1', { tabindex: '-1', class: 'k-titulo' }, T('tuPedidoKiosco')),
      h('div', { class: 'ticket-sombra' },
        h('div', { class: 'ticket' },
          h('ul', { class: 'renglones' }, k.carrito.map((x) => h('li', {}, h('div', { class: 'renglon' }, h('span', { class: 'renglon__nombre' }, h('strong', { class: 'renglon__cant' }, `${x.cant} ×`), ' ', nombre(x.plato)), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(precioUnit(x.plato, x.mods) * x.cant))), x.mods.length ? h('p', { class: 'renglon__detalle' }, x.mods.map((m) => nombreOpcion(m.grupo, m.opcion)).join(', ')) : null))),
          h('div', { class: 'ticket__pie' }, h('div', { class: 'renglon ticket__total' }, h('span', { class: 'renglon__nombre' }, T('total')), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(total()))), h('p', { class: 'renglon--menor' }, textoPrecios(k.idioma, caja?.estado?.ajustes?.tipoLocal))),
        ),
      ),
      sug
        ? h('section', { class: 'k-sugerencia', 'aria-label': T('sugerencia', { plato: texto(sug.nombre, k.idioma) }) },
            h('p', { class: 'k-sugerencia__texto' }, T('sugerencia', { plato: texto(sug.nombre, k.idioma) })),
            h('div', { class: 'fila-botones' },
              h('button', { type: 'button', class: 'boton boton--secundario boton-k', 'data-foco': 'sug-si', onclick: () => { if ((sug.grupos ?? []).length) abrirPlato(sug.id); else { agregar(sug.id, 1, []); k.sugerenciaDescartada = true; pintarPantalla(); } } }, icono('mas'), T('agregarSugerencia', { precio: dinero(sug.precio) })),
              h('button', { type: 'button', class: 'boton boton--texto boton-k', 'data-foco': 'sug-no', onclick: () => { k.sugerenciaDescartada = true; pintarPantalla(); } }, T('noGracias')),
            ),
          )
        : null,
      h('fieldset', { class: 'k-eleccion' },
        h('legend', {}, T('dondeComes')),
        h('div', { class: 'k-eleccion__botones' },
          [[false, 'paraComerAqui'], [true, 'paraLlevar']].map(([v, c]) => h('button', { type: 'button', class: 'k-opcion', 'aria-pressed': String(k.llevar === v), 'data-foco': `llevar-${v}`, onclick: () => { k.llevar = v; pintarPantalla(); } }, T(c))),
        ),
      ),
      h('fieldset', { class: 'k-eleccion' },
        h('legend', {}, T('comoPagasKiosco')),
        h('div', { class: 'k-eleccion__botones' },
          [['caja', 'pagarCaja', 'efectivo'], ['tarjeta', 'pagarTarjeta', 'tarjeta']].map(([v, c, ic]) => h('button', { type: 'button', class: 'k-opcion', 'aria-pressed': String(k.pago === v), 'data-foco': `pago-${v}`, onclick: () => { k.pago = v; pintarPantalla(); } }, icono(ic), T(c))),
        ),
        k.pago === 'tarjeta' ? h('p', { class: 'ayuda' }, T('tarjetaKiosco')) : null,
      ),
    ),
    h('div', { class: 'k-pagar__pie' },
      h('button', { type: 'button', class: 'boton boton--secundario boton-k', 'data-foco': 'volver', onclick: () => ir('pedido') }, icono('atras'), T('volver')),
      h('button', {
        type: 'button',
        class: 'boton boton--primario boton-k boton-k--grande',
        'data-foco': 'confirmar',
        disabled: !listo || k.enviando,
        onclick: confirmarOrden,
      }, k.pago === 'tarjeta' ? T('simularPago') : T('enviarPedidoKiosco')),
      !listo ? h('p', { class: 'ayuda k-pagar__falta' }, k.llevar === null ? T('eligeDonde') : T('eligePago')) : null,
    ),
  );
}

async function confirmarOrden() {
  if (k.enviando) return;
  k.enviando = true;
  const r = await caja.despachar({ tipo: 'kiosco-orden', datos: { renglones: k.carrito.map(({ plato, cant, mods }) => ({ plato, cant, mods })), llevar: k.llevar, pago: k.pago } });
  k.enviando = false;
  if (r.error) {
    anunciar(textoError(r.error, k.idioma), { tipo: 'alerta', duracion: 6000 });
    pintarPantalla();
    return;
  }
  k.orden = { numero: r.orden, llevar: k.llevar, pago: k.pago };
  k.ordenDesde = Date.now();
  ir('orden');
}

function pantallaOrden() {
  const o = k.orden;
  const quedan = Math.max(0, Math.ceil((VUELTA_ORDEN_MS - (Date.now() - k.ordenDesde)) / 1000));
  return h(
    'div',
    { class: 'k-orden' },
    h('h1', { tabindex: '-1', class: 'k-orden__titulo' }, T('tuOrden')),
    h('p', { class: 'k-orden__numero cifra' }, formatoOrden(o.numero)),
    h('p', { class: 'k-orden__detalle' }, `${o.llevar ? T('paraLlevar') : T('paraComerAqui')} · ${o.pago === 'tarjeta' ? T('pagadoKiosco') : T('pasaCaja')}`),
    h('button', { type: 'button', class: 'boton boton--primario boton-k boton-k--grande', 'data-foco': 'nuevo', onclick: reiniciar }, T('nuevoPedido')),
    h('p', { class: 'ayuda', id: 'k-vuelta' }, T('volvemosOrden', { s: quedan })),
  );
}

// ——— Inactividad ———
function tocar() {
  k.ultimoToque = Date.now();
  const d = $('#dlg-inactivo');
  if (d.open) d.close();
}

function vigilar() {
  if (k.fase === 'reposo') return;
  if (k.fase === 'orden') {
    if (Date.now() - k.ordenDesde >= VUELTA_ORDEN_MS) return reiniciar();
    const v = $('#k-vuelta');
    if (v) v.textContent = T('volvemosOrden', { s: Math.ceil((VUELTA_ORDEN_MS - (Date.now() - k.ordenDesde)) / 1000) });
    return;
  }
  const f = faseInactividad(Date.now() - k.ultimoToque);
  const d = $('#dlg-inactivo');
  if (f.fase === 'reposo') return reiniciar();
  if (f.fase === 'aviso') {
    $('#texto-inactivo').textContent = T('volvemos', { s: f.segundos });
    if (!d.open) d.showModal();
  } else if (d.open) d.close();
}

async function iniciar() {
  const r = await arrancarCaja();
  if (!r) return;
  caja = r.caja;
  aplicarTextos();
  $('#boton-empezar').addEventListener('click', () => {
    k.ultimoToque = Date.now();
    ir('pedido');
  });
  for (const b of $$('[data-idioma]')) {
    b.addEventListener('click', () => {
      k.idioma = b.dataset.idioma;
      escribir('kiosco-idioma', k.idioma);
      aplicarTextos();
    });
  }
  $('#boton-sigo').addEventListener('click', tocar);
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, tocar, { capture: true, passive: true });
  setInterval(vigilar, 500);
  caja.suscribir(() => {
    if (k.fase === 'pedido') pintarPantalla();
  });
  ir('reposo');
}

iniciar();
