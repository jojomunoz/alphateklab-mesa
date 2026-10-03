// mesa.html · el comensal: carta → plato → pedido → cocina; llamar al mesero; cuenta → dividir → propina → pago.

import { $, $$, h, icono, pintar, hora } from '../ui/dom.js';
import { anunciar, prepararBarra, pintarConexion } from '../ui/comun.js';
import { cargarCartaBase } from '../ui/caja-local.js';
import { crearClienteMesa } from '../ui/cliente-mesa.js';
import { leer, escribir, borrar, leerSesion, escribirSesion } from '../ui/almacen.js';
import { leerParametros, urlMesa, baseDe, esSala } from '../nucleo/url.mjs';
import { t as tr, textoError } from '../nucleo/textos.mjs';
import { formatear } from '../nucleo/dinero.mjs';
import { texto, indexar, validarSeleccion, alergenosDe, aplicarParche, MAX_CANT, MAX_NOTA } from '../nucleo/carta.mjs';
import { resumenCuenta } from '../nucleo/cuenta.mjs';
import { resolverPropina, opcionesPropina, propinaPorcentaje } from '../nucleo/propina.mjs';
import { partesIguales, porPlatos, MAX_PARTES } from '../nucleo/division.mjs';

const ui = {
  idioma: leerIdioma(),
  vista: 'carta',
  carrito: [],
  pago: nuevoPago(),
  misPagos: [],
};
let cliente = null;
let cartaBase = null;
let sala = null;
let mesa = null;

function nuevoPago() {
  return { modo: null, n: 3, asignacion: {}, parte: null, propina: null, montoTexto: '', metodo: null };
}

function leerIdioma() {
  const guardado = leer('idioma');
  if (guardado === 'es' || guardado === 'en') return guardado;
  return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
}

const T = (clave, vars) => tr(ui.idioma, clave, vars);
const dinero = (c) => formatear(c);

// ——— Carta visible y ayudas ———
function cartaVista() {
  if (cliente?.cartaCaja) return cliente.cartaCaja;
  return aplicarParche(cartaBase, cliente?.resumen?.parche);
}

function nombrePlato(id, nombreGuardado = '') {
  const p = indexar(cartaVista()).platos.get(id) ?? indexar(cartaBase).platos.get(id);
  return p ? texto(p.nombre, ui.idioma) : nombreGuardado || id;
}

function nombreOpcion(grupo, opcion) {
  const carta = cartaVista();
  const g = indexar(carta).grupos.get(grupo) ?? indexar(cartaBase).grupos.get(grupo);
  const o = g?.opciones?.find((x) => x.id === opcion);
  return o ? texto(o.nombre, ui.idioma) : opcion;
}

function nombreAlergeno(id) {
  const a = (cartaBase.alergenos ?? []).find((x) => x.id === id);
  return a ? texto(a.nombre, ui.idioma) : id;
}

function precioUnitario(platoId, mods) {
  const carta = cartaVista();
  const { platos, grupos } = indexar(carta);
  const p = platos.get(platoId);
  if (!p) return 0;
  let s = p.precio;
  for (const m of mods) s += grupos.get(m.grupo)?.opciones?.find((o) => o.id === m.opcion)?.precio ?? 0;
  return s;
}

function lineaMods(mods, nota) {
  const partes = mods.map((m) => nombreOpcion(m.grupo, m.opcion));
  if (nota) partes.push(`«${nota}»`);
  return partes.join(', ');
}

// ——— Carrito ———
function claveCarrito(plato, mods, nota) {
  return `${plato}|${mods.map((m) => `${m.grupo}.${m.opcion}`).sort().join(',')}|${nota}`;
}

function guardarCarrito() {
  escribir(`carrito:${sala}:${mesa}`, ui.carrito);
  pintarBarraCarrito();
}

function agregarAlCarrito(plato, cant, mods, nota) {
  const clave = claveCarrito(plato, mods, nota);
  const existente = ui.carrito.find((x) => x.clave === clave);
  if (existente) existente.cant = Math.min(MAX_CANT, existente.cant + cant);
  else ui.carrito.push({ clave, plato, cant, mods, nota });
  guardarCarrito();
}

function totalCarrito() {
  return ui.carrito.reduce((s, x) => s + precioUnitario(x.plato, x.mods) * x.cant, 0);
}

function piezasCarrito() {
  return ui.carrito.reduce((s, x) => s + x.cant, 0);
}

// ——— Arranque ———
async function iniciar() {
  aplicarTextos();
  const params = leerParametros(location.search);
  const salaGuardada = leer('sala');
  sala = params.sala ?? (esSala(salaGuardada) ? salaGuardada : null);
  try {
    cartaBase = await cargarCartaBase();
  } catch {
    pintarErrorCarga();
    return;
  }
  $('#estado-carga').hidden = true;
  if (!sala) return pintarEntrada({ sinSala: true });
  if (params.mesa === null) {
    prepararBarra({ sala });
    return pintarEntrada({ error: params.errores.includes('mesa') });
  }
  arrancarMesa(params.mesa);
}

function pintarErrorCarga() {
  const caja = $('#estado-carga');
  pintar(
    caja,
    h('p', { class: 'nota nota--alerta', role: 'alert' }, icono('alerta'), h('span', {}, T('cartaError'))),
    h('button', { type: 'button', class: 'boton boton--primario', onclick: () => location.reload() }, T('reintentar')),
  );
}

function pintarEntrada({ sinSala = false, error = false, noExiste = null } = {}) {
  const v = $('#vista-entrada');
  v.hidden = false;
  $('#titulo-mesa').textContent = T('queMesa');
  $('#nota-mesa').hidden = true;
  if (sinSala) {
    pintar(
      v,
      h('p', { class: 'nota nota--espera' }, icono('info'), h('span', {}, T('sinSala'))),
      h('p', { class: 'entrada__enlace' }, h('a', { href: 'index.html' }, 'alphateklab Mesa')),
    );
    return;
  }
  const entrada = h('input', { id: 'numero-mesa', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '3', autocomplete: 'off', 'aria-describedby': 'numero-ayuda numero-error', 'aria-invalid': error ? 'true' : 'false' });
  const err = h('p', { id: 'numero-error', class: 'mensaje-error', role: 'alert' }, error ? T('numeroInvalido') : noExiste ? T('mesaNoExiste', { n: noExiste }) : '');
  const form = h(
    'form',
    {
      class: 'entrada',
      novalidate: true,
      onsubmit: (ev) => {
        ev.preventDefault();
        const n = Number(entrada.value.trim());
        if (!/^\d{1,3}$/.test(entrada.value.trim()) || n < 1 || n > 999) {
          entrada.setAttribute('aria-invalid', 'true');
          err.textContent = T('numeroInvalido');
          entrada.focus();
          return;
        }
        location.href = urlMesa(baseDe(location.href), sala, n);
      },
    },
    h('h2', { id: 'titulo-entrada' }, T('escaneaOEscribe')),
    h('div', { class: 'campo' }, h('label', { for: 'numero-mesa' }, T('numeroMesa')), entrada, h('p', { id: 'numero-ayuda', class: 'ayuda' }, T('numeroAyuda'))),
    err,
    h('button', { type: 'submit', class: 'boton boton--primario boton--grande' }, T('abrirMesa')),
  );
  pintar(v, form);
}

function arrancarMesa(n) {
  mesa = n;
  ui.carrito = (leer(`carrito:${sala}:${mesa}`, []) ?? []).filter((x) => x && typeof x.plato === 'string' && Number.isInteger(x.cant));
  ui.misPagos = leer(`mispagos:${sala}:${mesa}`, []) ?? [];
  cliente = crearClienteMesa({ sala, mesa, cartaBase });
  prepararBarra({
    sala,
    alRestablecer: async () => {
      await cliente.restablecer();
      ui.carrito = [];
      ui.misPagos = [];
      ui.pago = nuevoPago();
      borrar(`mispagos:${sala}:${mesa}`);
      guardarCarrito();
      pintarTodo();
    },
    textoRestablecer: cliente.local
      ? undefined
      : 'Se borra lo que este teléfono guardó de la mesa (pedido sin enviar y último estado). Lo que ya está en el restaurante no cambia.',
  });
  document.title = `${T('mesaTitulo', { n })} · Fonda Pixbae (${T('ejemplo')})`;
  $('#acciones-mesa').hidden = false;
  $('#pestanas').hidden = false;
  $('#boton-idioma').hidden = false;
  $('#conexion').hidden = cliente.local;
  $('#boton-llamar').addEventListener('click', abrirLlamar);
  $('#boton-cuenta').addEventListener('click', pedirCuenta);
  $('#boton-carrito').addEventListener('click', abrirCarrito);
  $('#boton-idioma').addEventListener('click', cambiarIdioma);
  $('#boton-privacidad').addEventListener('click', abrirPrivacidad);
  prepararPestanas();
  cliente.suscribir(pintarTodo);
  addEventListener('hashchange', () => irA(vistaDeHash(), { desdeHash: true }));
  irA(vistaDeHash(), { desdeHash: true });
  pintarTodo();
}

// ——— Idioma ———
function aplicarTextos() {
  document.documentElement.lang = ui.idioma;
  for (const el of $$('[data-t]')) el.textContent = T(el.dataset.t);
  const b = $('#boton-idioma');
  if (b) {
    b.querySelector('span').textContent = T('idiomaBoton');
    b.setAttribute('aria-label', T('idiomaAria'));
    b.lang = ui.idioma === 'es' ? 'en' : 'es';
  }
}

function cambiarIdioma() {
  ui.idioma = ui.idioma === 'es' ? 'en' : 'es';
  escribir('idioma', ui.idioma);
  aplicarTextos();
  document.title = `${T('mesaTitulo', { n: mesa })} · Fonda Pixbae (${T('ejemplo')})`;
  pintarTodo();
  anunciar(ui.idioma === 'en' ? 'Menu in English' : 'Carta en español');
}

// ——— Pestañas ———
const VISTAS = ['carta', 'mesa', 'cuenta'];
function vistaDeHash() {
  const v = location.hash.replace('#', '');
  return VISTAS.includes(v) ? v : 'carta';
}

function prepararPestanas() {
  const tabs = $$('[role="tab"]');
  for (const tab of tabs) {
    tab.addEventListener('click', () => irA(tab.dataset.vista));
    tab.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(tab);
      let j = null;
      if (ev.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (ev.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (ev.key === 'Home') j = 0;
      if (ev.key === 'End') j = tabs.length - 1;
      if (j !== null) {
        ev.preventDefault();
        irA(tabs[j].dataset.vista);
        tabs[j].focus();
      }
    });
  }
}

function irA(vista, { desdeHash = false } = {}) {
  ui.vista = vista;
  if (!desdeHash && location.hash !== `#${vista}`) history.pushState(null, '', `#${vista}`);
  for (const tab of $$('[role="tab"]')) {
    const activa = tab.dataset.vista === vista;
    tab.setAttribute('aria-selected', String(activa));
    tab.tabIndex = activa ? 0 : -1;
  }
  for (const v of VISTAS) $(`#vista-${v}`).hidden = v !== vista;
  pintarVista();
  if (!desdeHash) $('#pestanas').scrollIntoView({ block: 'start', behavior: 'instant' });
}

// ——— Pintado ———
function pintarTodo() {
  if (!cliente) return;
  const r = cliente.resumen;
  if (r && r.existe === false) {
    $('#pestanas').hidden = true;
    $('#acciones-mesa').hidden = true;
    for (const v of VISTAS) $(`#vista-${v}`).hidden = true;
    pintarEntrada({ noExiste: mesa });
    return;
  }
  $('#titulo-mesa').textContent = T('mesaTitulo', { n: mesa });
  $('#local-nombre').textContent = r?.local ?? 'Fonda Pixbae';
  pintarConexion($('#conexion'), cliente.conexion, {
    local: T('conexion.local'),
    conectando: T('conexion.conectando'),
    conectado: T('conexion.conectado'),
    'sin-conexion': (s) => T('conexion.sin-conexion', { s }),
  });
  recordarPagos();
  pintarMarcaMesa();
  pintarBarraCarrito();
  pintarVista();
}

function pintarVista() {
  if (!cliente) return;
  if (ui.vista === 'carta') pintarCarta();
  if (ui.vista === 'mesa') pintarMiMesa();
  if (ui.vista === 'cuenta') pintarCuenta();
}

function pintarMarcaMesa() {
  const c = cliente.resumen?.cuenta;
  const activos = (c?.pedidos ?? []).filter((p) => !['servido', 'rechazado'].includes(p.estado)).length + [...cliente.intentos.values()].filter((i) => i.tipo === 'pedido' && i.envio !== 'error').length;
  const marca = $('#marca-mesa');
  marca.textContent = activos ? String(activos) : '';
  marca.hidden = !activos;
}

function pintarBarraCarrito() {
  const n = piezasCarrito();
  const barra = $('#barra-carrito');
  barra.hidden = n === 0;
  document.body.classList.toggle('con-barra-carrito', n > 0);
  $('#contador-carrito').textContent = String(n);
  $('#texto-carrito').textContent = T('verPedido');
  $('#total-carrito').textContent = n ? dinero(totalCarrito()) : '';
  $('#boton-carrito').setAttribute('aria-label', `${T('verPedido')}: ${T(n === 1 ? 'platos1' : 'platosN', { n })}, ${dinero(totalCarrito())}`);
}

// ——— Carta ———
let observador = null;
function pintarCarta() {
  const v = $('#vista-carta');
  const carta = cartaVista();
  const cats = carta.categorias.filter((c) => carta.platos.some((p) => p.cat === c.id));
  const enCarrito = new Map();
  for (const x of ui.carrito) enCarrito.set(x.plato, (enCarrito.get(x.plato) ?? 0) + x.cant);

  const nav = h(
    'nav',
    { class: 'categorias', 'aria-label': T('navCategorias') },
    h(
      'ul',
      { class: 'contenedor categorias__lista' },
      cats.map((c) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'categorias__enlace',
              'data-cat': c.id,
              'data-foco': `cat-${c.id}`,
              onclick: () => {
                const destino = document.getElementById(`cat-${c.id}`);
                destino.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
                destino.querySelector('h2').focus({ preventScroll: true });
              },
            },
            texto(c.nombre, ui.idioma),
          ),
        ),
      ),
    ),
  );

  const secciones = cats.map((c) =>
    h(
      'section',
      { class: 'categoria', id: `cat-${c.id}`, 'aria-labelledby': `h-${c.id}` },
      h('h2', { id: `h-${c.id}`, tabindex: '-1' }, texto(c.nombre, ui.idioma)),
      h(
        'ul',
        { class: 'platos' },
        carta.platos
          .filter((p) => p.cat === c.id)
          .map((p) => {
            const alerg = (p.alergenos ?? []).map(nombreAlergeno);
            const cuantos = enCarrito.get(p.id) ?? 0;
            const desc = texto(p.desc, ui.idioma);
            return h(
              'li',
              {},
              h(
                'button',
                {
                  type: 'button',
                  class: 'plato',
                  'data-plato': p.id,
                  'data-foco': `plato-${p.id}`,
                  'aria-disabled': p.agotado ? 'true' : false,
                  onclick: () => (p.agotado ? anunciar(`${texto(p.nombre, ui.idioma)}: ${T('agotado')}`) : abrirPlato(p.id)),
                },
                h('span', { class: 'plato__fila' }, h('span', { class: 'plato__nombre' }, texto(p.nombre, ui.idioma)), h('span', { class: 'plato__precio precio' }, dinero(p.precio))),
                desc ? h('span', { class: 'plato__desc' }, desc) : null,
                alerg.length ? h('span', { class: 'plato__alergenos' }, T('contiene', { lista: alerg.join(', ') })) : null,
                p.agotado ? h('span', { class: 'estado estado--alerta plato__agotado' }, icono('x'), T('agotado')) : null,
                cuantos ? h('span', { class: 'plato__en-pedido' }, icono('bolsa'), T('enTuPedido', { n: cuantos })) : null,
              ),
            );
          }),
      ),
    ),
  );

  pintar(v, nav, h('div', { class: 'contenedor carta' }, h('p', { class: 'carta__impuesto' }, T('preciosIncluyen')), secciones));
  vigilarCategorias();
}

function vigilarCategorias() {
  observador?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        for (const b of $$('.categorias__enlace')) {
          const activa = b.dataset.cat === e.target.id.replace('cat-', '');
          if (activa) {
            b.setAttribute('aria-current', 'true');
            const lista = b.closest('.categorias__lista');
            const li = b.parentElement;
            if (lista && (li.offsetLeft < lista.scrollLeft || li.offsetLeft + li.offsetWidth > lista.scrollLeft + lista.clientWidth)) {
              lista.scrollLeft = Math.max(0, li.offsetLeft - 16);
            }
          } else {
            b.removeAttribute('aria-current');
          }
        }
      }
    },
    { rootMargin: '-120px 0px -65% 0px' },
  );
  for (const s of $$('.categoria')) observador.observe(s);
}

// ——— Ficha del plato ———
function abrirPlato(id) {
  const carta = cartaVista();
  const { platos, grupos } = indexar(carta);
  const p = platos.get(id);
  if (!p) return;
  const dlg = $('#dlg-plato');
  let cant = 1;

  const seleccion = () => {
    const out = [];
    for (const gid of p.grupos ?? []) for (const inp of dlg.querySelectorAll(`[name="g-${gid}"]:checked`)) out.push({ grupo: gid, opcion: inp.value });
    return out;
  };
  const totalTexto = h('span', { class: 'precio' });
  const alergTexto = h('p', { class: 'plato__alergenos' });
  const cantSalida = h('output', { class: 'cantidad__valor cifra', 'aria-live': 'polite' }, '1');
  const error = h('p', { class: 'mensaje-error', role: 'alert' });
  const actualizar = () => {
    const sel = seleccion();
    totalTexto.textContent = dinero(precioUnitario(id, sel) * cant);
    const al = alergenosDe(carta, id, sel).map(nombreAlergeno);
    alergTexto.textContent = al.length ? T('contiene', { lista: al.join(', ') }) : '';
    alergTexto.hidden = !al.length;
    cantSalida.textContent = String(cant);
    menos.disabled = cant <= 1;
    mas.disabled = cant >= MAX_CANT;
  };
  const menos = h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('menos'), onclick: () => { cant = Math.max(1, cant - 1); actualizar(); } }, icono('menos'));
  const mas = h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('mas'), onclick: () => { cant = Math.min(MAX_CANT, cant + 1); actualizar(); } }, icono('mas'));
  const nota = h('textarea', { id: 'nota-plato', rows: '2', maxlength: String(MAX_NOTA), 'aria-describedby': 'nota-ayuda' });

  const fieldsets = (p.grupos ?? []).map((gid) => {
    const g = grupos.get(gid);
    if (!g) return null;
    const tipo = g.tipo === 'uno' ? 'radio' : 'checkbox';
    return h(
      'fieldset',
      { class: 'grupo', 'data-grupo': gid },
      h('legend', {}, texto(g.nombre, ui.idioma), ' ', h('span', { class: 'grupo__regla' }, g.obligatorio ? T('eligeUna') : T('opcional'))),
      h(
        'div',
        { class: 'grupo__opciones' },
        g.opciones.map((o) =>
          h(
            'label',
            { class: 'opcion' },
            h('input', { type: tipo, name: `g-${gid}`, value: o.id, onchange: () => { error.textContent = ''; actualizar(); } }),
            h('span', { class: 'opcion__texto' }, texto(o.nombre, ui.idioma)),
            o.precio ? h('span', { class: 'opcion__extra' }, `+ ${dinero(o.precio)}`) : null,
          ),
        ),
      ),
    );
  });

  const form = h(
    'form',
    {
      method: 'dialog',
      class: 'hoja__form',
      novalidate: true,
      onsubmit: (ev) => {
        ev.preventDefault();
        const sel = seleccion();
        const v = validarSeleccion(carta, id, sel);
        if (!v.ok) {
          const gid = v.faltan[0];
          const g = grupos.get(gid);
          error.textContent = g ? T('faltaElegir', { grupo: texto(g.nombre, ui.idioma) }) : v.errores[0];
          dlg.querySelector(`[data-grupo="${gid}"] input`)?.focus();
          return;
        }
        agregarAlCarrito(id, cant, sel, nota.value.trim().slice(0, MAX_NOTA));
        dlg.close();
        anunciar(T('agregado', { cant, plato: texto(p.nombre, ui.idioma) }), { duracion: 2600 });
        pintarCarta();
      },
    },
    h('div', { class: 'hoja__cuerpo' },
      texto(p.desc, ui.idioma) ? h('p', { class: 'plato__desc plato__desc--ficha' }, texto(p.desc, ui.idioma)) : null,
      alergTexto,
      fieldsets,
      h('div', { class: 'campo' }, h('label', { for: 'nota-plato' }, T('nota')), nota, h('p', { id: 'nota-ayuda', class: 'ayuda' }, T('notaAyuda'))),
      h('div', { class: 'cantidad', role: 'group', 'aria-label': T('cantidad') }, h('span', { class: 'etiqueta' }, T('cantidad')), h('div', { class: 'cantidad__control' }, menos, cantSalida, mas)),
    ),
    h('div', { class: 'hoja__pie' }, error, h('button', { type: 'submit', class: 'boton boton--primario boton--grande boton--ancho boton--con-total' }, h('span', {}, T('agregar')), totalTexto)),
  );

  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-plato-titulo' }, texto(p.nombre, ui.idioma)), h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('cerrar'), onclick: () => dlg.close() }, icono('x'))),
    form,
  );
  actualizar();
  dlg.showModal();
}

// ——— Pedido (carrito) ———
function abrirCarrito() {
  const dlg = $('#dlg-carrito');
  pintarCarrito();
  if (!dlg.open) dlg.showModal();
}

function pintarCarrito() {
  const dlg = $('#dlg-carrito');
  const ajustes = cliente.resumen?.ajustes;
  const aprobacion = ajustes?.aprobacion ?? 'todos';
  const yaAceptado = (cliente.resumen?.cuenta?.pedidos ?? []).some((p) => !['por-aceptar', 'rechazado'].includes(p.estado));
  const esperaMesero = aprobacion === 'todos' || (aprobacion === 'primero' && !yaAceptado);
  const necesitaPin = Boolean(ajustes?.pin) && !leerSesion(`pin:${sala}:${mesa}`);
  const pin = necesitaPin ? h('input', { id: 'pin-mesa', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '3', autocomplete: 'off', 'aria-describedby': 'pin-ayuda', 'data-foco': 'pin' }) : null;
  const error = h('p', { class: 'mensaje-error', role: 'alert' });

  const cuerpo = ui.carrito.length
    ? h(
        'div',
        { class: 'ticket-sombra' },
        h(
          'div',
          { class: 'ticket' },
          h('ul', { class: 'renglones renglones--carrito' },
            ui.carrito.map((x, i) =>
              h(
                'li',
                { class: 'renglon-carrito' },
                h('div', { class: 'renglon' }, h('span', { class: 'renglon__nombre' }, h('strong', { class: 'renglon__cant' }, `${x.cant} ×`), ' ', nombrePlato(x.plato)), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(precioUnitario(x.plato, x.mods) * x.cant))),
                lineaMods(x.mods, x.nota) ? h('p', { class: 'renglon__detalle' }, lineaMods(x.mods, x.nota)) : null,
                h(
                  'div',
                  { class: 'renglon-carrito__controles' },
                  h('button', { type: 'button', class: 'boton-icono', 'data-foco': `menos-${i}`, 'aria-label': `${T('menos')}: ${nombrePlato(x.plato)}`, disabled: x.cant <= 1, onclick: () => { x.cant--; guardarCarrito(); pintarCarrito(); } }, icono('menos')),
                  h('span', { class: 'cifra renglon-carrito__cant', 'aria-label': T('editarCantidad', { plato: nombrePlato(x.plato) }) }, String(x.cant)),
                  h('button', { type: 'button', class: 'boton-icono', 'data-foco': `mas-${i}`, 'aria-label': `${T('mas')}: ${nombrePlato(x.plato)}`, disabled: x.cant >= MAX_CANT, onclick: () => { x.cant++; guardarCarrito(); pintarCarrito(); } }, icono('mas')),
                  h('button', { type: 'button', class: 'boton boton--texto', 'data-foco': `quitar-${i}`, onclick: () => { ui.carrito.splice(i, 1); guardarCarrito(); pintarCarrito(); pintarCarta(); } }, T('quitar')),
                ),
              ),
            ),
          ),
          h('div', { class: 'ticket__pie' },
            h('div', { class: 'renglon ticket__total' }, h('span', { class: 'renglon__nombre' }, T('total')), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(totalCarrito()))),
            h('p', { class: 'renglon--menor' }, T('preciosIncluyen')),
          ),
        ),
      )
    : h('p', { class: 'vacio' }, T('carritoVacio'));

  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-carrito-titulo' }, T('tuPedido', { n: mesa })), h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('cerrar'), 'data-foco': 'cerrar', onclick: () => dlg.close() }, icono('x'))),
    h(
      'div',
      { class: 'hoja__cuerpo' },
      cuerpo,
      ui.carrito.length && pin ? h('div', { class: 'campo' }, h('label', { for: 'pin-mesa' }, T('pinTitulo')), pin, h('p', { id: 'pin-ayuda', class: 'ayuda' }, T('pinAyuda'))) : null,
      ui.carrito.length ? h('p', { class: 'nota' }, icono('info'), h('span', {}, esperaMesero ? T('aprobacionNota') : T('sinAprobacionNota'))) : null,
      ui.carrito.length ? h('p', { class: 'ayuda aviso-relevo' }, T('avisoRelevo')) : null,
    ),
    ui.carrito.length
      ? h(
          'div',
          { class: 'hoja__pie' },
          error,
          h(
            'button',
            {
              type: 'button',
              class: 'boton boton--primario boton--grande boton--ancho',
              'data-foco': 'enviar',
              onclick: () => {
                const datos = { renglones: ui.carrito.map(({ plato, cant, mods, nota }) => ({ plato, cant, mods, nota })) };
                if (pin) {
                  const v = pin.value.trim();
                  if (!/^\d{3}$/.test(v)) {
                    error.textContent = T('pinFormato');
                    pin.setAttribute('aria-invalid', 'true');
                    pin.focus();
                    return;
                  }
                  escribirSesion(`pin:${sala}:${mesa}`, v);
                }
                const guardado = leerSesion(`pin:${sala}:${mesa}`);
                if (guardado) datos.pin = guardado;
                const id = cliente.enviar('pedido', datos);
                escribir(`enviado:${id}`, ui.carrito);
                ui.carrito = [];
                guardarCarrito();
                dlg.close();
                anunciar(T('pedidoEnviadoAviso'));
                irA('mesa');
              },
            },
            icono('cocina'),
            T('enviarCocina'),
          ),
        )
      : null,
  );
}

// ——— Llamar al mesero ———
function abrirLlamar() {
  const dlg = $('#dlg-llamar');
  const error = h('p', { class: 'mensaje-error', role: 'alert' });
  const detalle = h('input', { id: 'detalle-llamada', maxlength: '80', autocomplete: 'off' });
  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-llamar-titulo' }, T('tituloLlamar')), h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('cerrar'), onclick: () => dlg.close() }, icono('x'))),
    h(
      'form',
      {
        class: 'hoja__form',
        novalidate: true,
        onsubmit: (ev) => {
          ev.preventDefault();
          const motivo = dlg.querySelector('[name="motivo"]:checked')?.value;
          if (!motivo) {
            error.textContent = T('eligeUna');
            dlg.querySelector('[name="motivo"]').focus();
            return;
          }
          cliente.enviar('llamada', { motivo, texto: detalle.value.trim() });
          dlg.close();
          irA('mesa');
        },
      },
      h(
        'div',
        { class: 'hoja__cuerpo' },
        h('fieldset', { class: 'grupo' }, h('legend', { class: 'visualmente-oculto' }, T('tituloLlamar')), h('div', { class: 'grupo__opciones' }, ['pedir', 'ayuda', 'otra'].map((m) => h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'motivo', value: m, onchange: () => (error.textContent = '') }), h('span', { class: 'opcion__texto' }, T(`motivo.${m}`)))))),
        h('div', { class: 'campo' }, h('label', { for: 'detalle-llamada' }, T('detalleOpcional')), detalle, h('p', { class: 'ayuda' }, T('notaAyuda'))),
      ),
      h('div', { class: 'hoja__pie' }, error, h('button', { type: 'submit', class: 'boton boton--primario boton--grande boton--ancho' }, icono('campana'), T('llamarMesero'))),
    ),
  );
  dlg.showModal();
}

function pedirCuenta() {
  const total = cliente.resumen?.cuenta ? resumenCuenta(cliente.resumen.cuenta).total : 0;
  if (total > 0) {
    const abierta = (cliente.resumen.cuenta.avisos ?? []).some((a) => a.tipo === 'cuenta' && a.estado === 'abierta');
    if (!abierta) cliente.enviar('cuenta', { accion: 'pedir' });
  }
  irA('cuenta');
}

function abrirPrivacidad() {
  const dlg = $('#dlg-privacidad');
  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-privacidad-titulo' }, T('privacidadTitulo')), h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('cerrar'), onclick: () => dlg.close() }, icono('x'))),
    h('div', { class: 'hoja__cuerpo' }, h('p', {}, T('privacidadTexto')), h('p', { class: 'ayuda' }, T('avisoRelevo'))),
  );
  dlg.showModal();
}

// ——— Mi mesa ———
const PASOS = ['enviado', 'recibido', 'en-preparacion', 'listo', 'servido'];

function estadoPedidoClase(estado) {
  if (estado === 'listo' || estado === 'servido') return 'estado--ok';
  if (estado === 'rechazado') return 'estado--alerta';
  if (estado === 'por-aceptar' || estado === 'enviando') return 'estado--espera';
  return '';
}

function ticketPedido({ id, ronda, estado, disp, t, renglones, motivo, enviando = false, error = null }) {
  const desde = disp === cliente.disp ? T('desdeEste') : disp ? T('desdeOtro') : T('desdeMesero');
  const actual = enviando ? 'enviando' : estado;
  const idx = PASOS.indexOf(estado);
  return h(
    'li',
    { class: 'ticket-sombra' },
    h(
      'article',
      { class: 'ticket ticket--pedido', 'aria-labelledby': `p-${id}` },
      h('header', { class: 'ticket__cabeza' }, h('h3', { class: 'ticket__titulo', id: `p-${id}` }, ronda ? T('ronda', { n: ronda }) : T('tuPedido', { n: mesa })), h('p', { class: 'ticket__meta' }, `${t ? hora(t) : ''} · ${desde}`)),
      error
        ? h('p', { class: 'nota nota--alerta', role: 'alert' }, icono('alerta'), h('span', {}, error === 'rechazado' ? (motivo ? T('rechazadoMotivo', { motivo }) : T('rechazadoSinMotivo')) : textoError(error, ui.idioma)))
        : h('p', { class: `estado ${estadoPedidoClase(actual)}` }, icono(actual === 'listo' || actual === 'servido' ? 'check' : actual === 'rechazado' ? 'x' : 'reloj'), T(`pedido.${actual}`)),
      !enviando && !error && idx >= 0
        ? h('ol', { class: 'avance', 'aria-label': T('pasos') }, PASOS.map((p, i) => h('li', { class: i <= idx ? 'avance__paso avance__paso--hecho' : 'avance__paso', 'aria-current': i === idx ? 'step' : false }, h('span', { class: 'visualmente-oculto' }, T(`pedido.${p}`)))))
        : null,
      estado === 'rechazado' ? h('p', { class: 'ayuda' }, motivo ? T('rechazadoMotivo', { motivo }) : T('rechazadoSinMotivo')) : null,
      h(
        'ul',
        { class: 'renglones' },
        renglones.map((r) =>
          h(
            'li',
            {},
            h('div', { class: 'renglon' }, h('span', { class: 'renglon__nombre' }, h('strong', { class: 'renglon__cant' }, `${r.cant} ×`), ' ', nombrePlato(r.plato, r.nombre)), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, r.monto != null ? dinero(r.monto) : '')),
            lineaMods(r.mods ?? [], r.nota) ? h('p', { class: 'renglon__detalle' }, lineaMods(r.mods ?? [], r.nota)) : null,
          ),
        ),
      ),
      error ? h('div', { class: 'ticket__pie' }, h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => devolverAlCarrito(id) }, icono('bolsa'), T('verPedido'))) : null,
    ),
  );
}

function devolverAlCarrito(id) {
  const it = cliente.intentos.get(id);
  const guardado = leer(`enviado:${id}`) ?? (it?.datos?.renglones ?? []).map((r) => ({ ...r, clave: claveCarrito(r.plato, r.mods ?? [], r.nota ?? '') }));
  for (const r of guardado) agregarAlCarrito(r.plato, r.cant, r.mods ?? [], r.nota ?? '');
  borrar(`enviado:${id}`);
  cliente.olvidarIntento(id);
  abrirCarrito();
}

function pintarMiMesa() {
  const v = $('#vista-mesa');
  const r = cliente.resumen;
  const c = r?.cuenta;
  const intentos = [...cliente.intentos.entries()];
  const partes = [];

  if (!cliente.local && !r) partes.push(h('p', { class: 'nota' }, icono('antena'), h('span', {}, cliente.noResponde ? T('noResponde') : T('conexion.conectando'))));
  else if (cliente.noResponde) partes.push(h('p', { class: 'nota nota--espera' }, icono('alerta'), h('span', {}, T('noResponde'))));

  // Avisos
  const avisos = [...(c?.avisos ?? [])].filter((a) => a.estado !== 'cancelada').sort((a, b) => b.t - a.t);
  const avisosEnviando = intentos.filter(([, i]) => (i.tipo === 'llamada' || (i.tipo === 'cuenta' && i.datos?.accion === 'pedir')) && i.envio !== 'error');
  if (avisos.length || avisosEnviando.length) {
    partes.push(
      h('section', { class: 'bloque', 'aria-labelledby': 'h-avisos' },
        h('h2', { id: 'h-avisos', class: 'bloque__titulo' }, T('avisosTitulo')),
        h('ul', { class: 'avisos' },
          avisosEnviando.map(([id, i]) => h('li', { class: 'aviso' }, icono(i.tipo === 'llamada' ? 'campana' : 'recibo'), h('span', { class: 'aviso__texto' }, T(i.tipo === 'llamada' ? 'aviso.mesero' : 'aviso.cuenta')), h('span', { class: 'estado estado--espera' }, icono('reloj'), T('aviso.enviando')))),
          avisos.map((a) =>
            h(
              'li',
              { class: 'aviso' },
              icono(a.tipo === 'mesero' ? 'campana' : 'recibo'),
              h('span', { class: 'aviso__texto' }, T(`aviso.${a.tipo}`), h('span', { class: 'aviso__hora' }, ` · ${hora(a.t)}`)),
              h('span', { class: `estado ${a.estado === 'atendida' ? 'estado--ok' : 'estado--espera'}` }, icono(a.estado === 'atendida' ? 'check' : 'reloj'), T(`aviso.${a.estado}`)),
              a.estado === 'abierta' && a.tipo === 'mesero' ? h('button', { type: 'button', class: 'boton boton--texto', onclick: () => cliente.enviar('cancelar-aviso', { aviso: a.id }) }, T('yaNoHaceFalta')) : null,
            ),
          ),
        ),
      ),
    );
  }

  // Pedidos (los que se están enviando primero)
  const enviando = intentos
    .filter(([, i]) => i.tipo === 'pedido')
    .map(([id, i]) => ticketPedido({ id, ronda: null, estado: 'enviando', disp: cliente.disp, t: i.t, motivo: i.detalle ?? '', renglones: (i.datos?.renglones ?? []).map((x) => ({ ...x, monto: precioUnitario(x.plato, x.mods ?? []) * x.cant })), enviando: i.envio !== 'error', error: i.envio === 'error' ? i.error : null }));
  const pedidos = [...(c?.pedidos ?? [])].sort((a, b) => b.ronda - a.ronda).map((p) => ticketPedido(p));
  if (enviando.length && cliente.noResponde === false && !cliente.local && intentos.some(([, i]) => i.tipo === 'pedido' && i.envio === 'publicado' && Date.now() - i.t > 9000)) {
    partes.push(h('p', { class: 'nota nota--espera' }, icono('reloj'), h('span', {}, T('sinRespuesta'))));
  }
  if (enviando.length || pedidos.length) partes.push(h('ul', { class: 'lista-tickets' }, enviando, pedidos));
  else if (r || cliente.local) partes.push(h('p', { class: 'vacio' }, T('mesaVacia')));

  pintar(v, partes);
}

// ——— Cuenta ———
function recordarPagos() {
  const c = cliente.resumen?.cuenta;
  let cambio = false;
  for (const p of c?.pagos ?? []) {
    if (p.disp === cliente.disp || ui.misPagos.some((x) => x.id === p.id)) {
      const i = ui.misPagos.findIndex((x) => x.id === p.id);
      const dato = { ...p, cid: c.id };
      if (i < 0) ui.misPagos.push(dato);
      else if (JSON.stringify(ui.misPagos[i]) !== JSON.stringify(dato)) ui.misPagos[i] = dato;
      else continue;
      cambio = true;
    }
  }
  if (cambio) escribir(`mispagos:${sala}:${mesa}`, ui.misPagos);
}

function renglonTicket(nombre, monto, clase = '') {
  return h('div', { class: `renglon ${clase}` }, h('span', { class: 'renglon__nombre' }, nombre), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, monto));
}

function ticketCuenta(res) {
  // Agrupa renglones iguales (mismo plato, opciones y nota) para que la cuenta se lea como una impresa.
  const grupos = new Map();
  for (const r of res.renglones) {
    const k = claveCarrito(r.plato, r.mods ?? [], r.nota ?? '');
    const g = grupos.get(k) ?? { ...r, cant: 0, monto: 0 };
    g.cant += r.cant;
    g.monto += r.monto;
    grupos.set(k, g);
  }
  return h(
    'div',
    { class: 'ticket-sombra' },
    h(
      'article',
      { class: 'ticket ticket--cuenta', 'aria-labelledby': 'h-cuenta' },
      h('header', { class: 'ticket__cabeza' }, h('h2', { class: 'ticket__titulo', id: 'h-cuenta' }, T('tituloCuenta', { n: mesa })), h('p', { class: 'ticket__meta' }, cliente.resumen?.local ?? 'Fonda Pixbae')),
      h(
        'ul',
        { class: 'renglones' },
        [...grupos.values()].map((r) =>
          h('li', {}, h('div', { class: 'renglon' }, h('span', { class: 'renglon__nombre' }, h('strong', { class: 'renglon__cant' }, `${r.cant} ×`), ' ', nombrePlato(r.plato, r.nombre)), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(r.monto))), lineaMods(r.mods ?? [], '') ? h('p', { class: 'renglon__detalle' }, lineaMods(r.mods ?? [], '')) : null),
        ),
      ),
      h(
        'div',
        { class: 'ticket__pie' },
        renglonTicket(T('total'), dinero(res.total), 'ticket__total'),
        h('p', { class: 'renglon--menor' }, T('incluyeItbms')),
        res.itbms.porTasa.map((x) => renglonTicket(T('itbmsTasa', { tasa: x.tasa, base: dinero(x.base) }), dinero(x.impuesto), 'renglon--menor')),
        res.confirmado ? renglonTicket(T('cuentaPagadaTotal'), dinero(res.confirmado), 'renglon--menor') : null,
        res.pendiente ? renglonTicket(T('pagosPendientes'), dinero(res.pendiente), 'renglon--menor') : null,
        res.confirmado || res.pendiente ? renglonTicket(T('faltaPagar'), dinero(res.saldo), 'renglon--falta') : null,
        h('p', { class: 'ticket__precuenta' }, T('precuenta')),
      ),
    ),
  );
}

function pintarCuenta() {
  const v = $('#vista-cuenta');
  const r = cliente.resumen;
  const c = r?.cuenta;
  const partes = [];

  // Cuenta cerrada: este teléfono pagó y la cuenta ya no está.
  const pagadosAntes = ui.misPagos.filter((p) => p.estado === 'confirmado');
  if (r && pagadosAntes.length && (!c || pagadosAntes.every((p) => p.cid !== c.id))) {
    partes.push(
      h('div', { class: 'cierre' }, h('p', { class: 'nota nota--ok' }, icono('check'), h('span', {}, T('cuentaCerrada'))), invitacionResena(r), h('button', {
        type: 'button',
        class: 'boton boton--secundario',
        onclick: () => {
          ui.misPagos = [];
          borrar(`mispagos:${sala}:${mesa}`);
          ui.pago = nuevoPago();
          irA('carta');
          pintarTodo();
        },
      }, T('nuevaCuenta'))),
    );
    pintar(v, partes);
    return;
  }

  if (!c) {
    partes.push(h('p', { class: 'vacio' }, !r && !cliente.local ? T('conexion.conectando') : T('cuentaVacia')));
    pintar(v, partes);
    return;
  }
  const res = resumenCuenta(c);
  if (res.total === 0) {
    partes.push(h('p', { class: 'vacio' }, T('cuentaVacia')));
    pintar(v, partes);
    return;
  }

  partes.push(ticketCuenta(res));

  const avisoCuenta = [...c.avisos].reverse().find((a) => a.tipo === 'cuenta');
  const pidiendo = [...cliente.intentos.values()].some((i) => i.tipo === 'cuenta' && i.datos?.accion === 'pedir' && i.envio !== 'error');
  if (pidiendo || avisoCuenta) {
    const est = pidiendo && !avisoCuenta ? 'enviando' : avisoCuenta.estado;
    partes.push(h('p', { class: `estado ${est === 'atendida' ? 'estado--ok' : 'estado--espera'} estado--bloque` }, icono(est === 'atendida' ? 'check' : 'recibo'), `${T('aviso.cuenta')}: ${T(`aviso.${est}`)}`));
  } else if (res.saldo > 0) {
    partes.push(h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => cliente.enviar('cuenta', { accion: 'pedir' }) }, icono('recibo'), T('pedirCuenta')));
  }

  // Comprobantes de este teléfono
  const mios = ui.misPagos.filter((p) => p.cid === c.id);
  const pagosEnviando = [...cliente.intentos.entries()].filter(([, i]) => i.tipo === 'pago');
  if (mios.length || pagosEnviando.length) partes.push(h('ul', { class: 'lista-tickets' }, pagosEnviando.map(([id, i]) => comprobante({ id, ...i.datos, estado: i.envio === 'error' ? 'error' : 'enviando', error: i.error })), [...mios].reverse().map((p) => comprobante(p, res))));

  if (r.estado === 'pagada' || (res.saldo <= 0 && res.pendiente === 0)) {
    partes.push(h('div', { class: 'cierre' }, h('p', { class: 'nota nota--ok' }, icono('check'), h('span', {}, T('mesaPagada'))), invitacionResena(r)));
  } else if (res.saldo > 0 && !pagosEnviando.some(([, i]) => i.envio !== 'error')) {
    partes.push(formularioPago(c, res));
  }
  pintar(v, partes);
}

function invitacionResena(r) {
  const url = r?.ajustes?.resena;
  return h('div', { class: 'resena' }, h('p', {}, T('resenaInvita')), url ? h('a', { class: 'boton boton--secundario', href: url, target: '_blank', rel: 'noopener' }, T('dejarResena')) : h('p', { class: 'ayuda' }, T('resenaDemo')));
}

function comprobante(p, res) {
  const div = cliente.resumen?.cuenta?.division;
  const clase = p.estado === 'confirmado' ? 'estado--ok' : p.estado === 'rechazado' || p.estado === 'error' ? 'estado--alerta' : 'estado--espera';
  const textoEstado = p.estado === 'error' ? textoError(p.error, ui.idioma) : T(`pago.${p.estado}`);
  return h(
    'li',
    { class: 'ticket-sombra' },
    h(
      'article',
      { class: 'ticket ticket--comprobante', 'aria-labelledby': `pg-${p.id}` },
      h('header', { class: 'ticket__cabeza' }, h('h3', { class: 'ticket__titulo', id: `pg-${p.id}` }, T('comprobante')), h('p', { class: 'ticket__meta' }, T(`metodo.${p.metodo}`))),
      p.parte !== null && p.parte !== undefined && div ? h('p', { class: 'ayuda' }, T('parteDe', { n: p.parte + 1, total: div.n })) : null,
      renglonTicket(T('consumo'), dinero(p.monto)),
      renglonTicket(T('propina'), dinero(p.propina ?? 0)),
      renglonTicket(T('totalPagar'), dinero(p.monto + (p.propina ?? 0)), 'ticket__total'),
      h('p', { class: 'renglon--menor' }, p.metodo === 'mesero' ? T('pagoAlMesero') : T('pagoSimulado')),
      h('p', { class: `estado ${clase} estado--bloque`, role: 'status' }, icono(p.estado === 'confirmado' ? 'check' : p.estado === 'rechazado' || p.estado === 'error' ? 'alerta' : 'reloj'), textoEstado),
      p.estado === 'error' ? h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => cliente.olvidarIntento(p.id) }, T('quitar')) : null,
      p.estado === 'confirmado' && res && res.saldo > 0 ? invitacionResena(cliente.resumen) : null,
    ),
  );
}

function formularioPago(c, res) {
  const pago = ui.pago;
  const div = res.division;
  const pagosVivos = (c.pagos ?? []).some((p) => p.estado !== 'rechazado');
  const bloques = [];

  // 1. Cómo pagan
  if (div && !div.desfasada) {
    pago.modo = div.tipo;
    const libres = div.partes.filter((x) => x.estado === 'libre');
    if (pago.parte !== null && !libres.some((x) => x.idx === pago.parte)) pago.parte = null;
    bloques.push(
      h('fieldset', { class: 'paso' },
        h('legend', { class: 'paso__titulo' }, T('elegirParte')),
        h('div', { class: 'grupo__opciones' },
          div.partes.map((x) =>
            h('label', { class: 'opcion' },
              h('input', { type: 'radio', name: 'parte', value: String(x.idx), checked: pago.parte === x.idx, disabled: x.estado !== 'libre', 'data-foco': `parte-${x.idx}`, onchange: () => { pago.parte = x.idx; pintarCuenta(); } }),
              h('span', { class: 'opcion__texto' }, T('parteDe', { n: x.idx + 1, total: div.n }), div.tipo === 'platos' ? h('span', { class: 'ayuda opcion__sub' }, platosDeParte(c, div, x.idx)) : null),
              h('span', { class: 'opcion__extra' }, dinero(x.monto)),
              h('span', { class: `estado ${x.estado === 'pagada' ? 'estado--ok' : x.estado === 'pendiente' ? 'estado--espera' : ''}` }, T(`parte.${x.estado}`)),
            ),
          ),
        ),
        pagosVivos ? h('p', { class: 'ayuda' }, T('divisionBloqueada')) : h('button', { type: 'button', class: 'boton boton--texto', onclick: () => { cliente.enviar('cuenta', { accion: 'quitar-division' }); pago.parte = null; pago.modo = null; } }, T('cambiarDivision')),
      ),
    );
  } else {
    if (div?.desfasada) {
      bloques.push(h('p', { class: 'nota nota--espera' }, icono('alerta'), h('span', {}, T('divisionDesfasada'))));
      if (!pagosVivos && pago.modo !== 'todo') {
        bloques.push(h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => cliente.enviar('cuenta', { accion: 'quitar-division' }) }, T('cambiarDivision')));
      }
      if (pagosVivos) pago.modo = 'todo';
    }
    const modos = div?.desfasada && pagosVivos ? ['todo'] : ['todo', 'iguales', 'platos'];
    bloques.push(
      h('fieldset', { class: 'paso' },
        h('legend', { class: 'paso__titulo' }, T('comoPagan')),
        h('div', { class: 'grupo__opciones grupo__opciones--fila' },
          modos.map((m) =>
            h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'modo', value: m, checked: pago.modo === m, 'data-foco': `modo-${m}`, onchange: () => { pago.modo = m; pago.parte = null; pintarCuenta(); } }), h('span', { class: 'opcion__texto' }, T(m === 'todo' ? 'todoJunto' : m === 'iguales' ? 'iguales' : 'porPlatos'))),
          ),
        ),
      ),
    );
    if (pago.modo === 'iguales' || pago.modo === 'platos') bloques.push(formularioDivision(c, res));
  }

  // Base de la propina: la parte elegida, o lo que falta.
  let base = null;
  if (div && !div.desfasada && pago.parte !== null) base = div.partes[pago.parte].monto;
  if (pago.modo === 'todo') base = res.saldo;

  if (base !== null) {
    bloques.push(formularioPropina(base));
    bloques.push(formularioMetodo(base));
    bloques.push(resumenYBoton(base));
  }
  return h('section', { class: 'pago', 'aria-label': T('dividir') }, bloques);
}

function platosDeParte(c, div, idx) {
  const nombres = [];
  for (const [clave, personas] of Object.entries(div.asignacion ?? {})) {
    if (!personas.includes(idx)) continue;
    const [pid, rid] = clave.split(':');
    const r = c.pedidos.find((p) => p.id === pid)?.renglones.find((x) => x.id === rid);
    if (r) nombres.push(`${r.cant} × ${nombrePlato(r.plato, r.nombre)}${personas.length > 1 ? ` (1/${personas.length})` : ''}`);
  }
  return nombres.join(', ');
}

function formularioDivision(c, res) {
  const pago = ui.pago;
  const n = pago.n;
  const cambiarN = (d) => {
    pago.n = Math.min(MAX_PARTES, Math.max(2, pago.n + d));
    pintarCuenta();
  };
  const control = h('div', { class: 'cantidad', role: 'group', 'aria-label': T('entreCuantas') },
    h('span', { class: 'etiqueta' }, T('entreCuantas')),
    h('div', { class: 'cantidad__control' },
      h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('menos'), 'data-foco': 'n-menos', disabled: n <= 2, onclick: () => cambiarN(-1) }, icono('menos')),
      h('output', { class: 'cantidad__valor cifra', 'aria-live': 'polite' }, String(n)),
      h('button', { type: 'button', class: 'boton-icono', 'aria-label': T('mas'), 'data-foco': 'n-mas', disabled: n >= MAX_PARTES, onclick: () => cambiarN(1) }, icono('mas')),
    ),
  );
  const intentando = [...cliente.intentos.values()].some((i) => i.tipo === 'cuenta' && i.datos?.accion === 'dividir' && i.envio !== 'error');
  const errorDiv = [...cliente.intentos.entries()].find(([, i]) => i.tipo === 'cuenta' && i.envio === 'error');
  if (pago.modo === 'iguales') {
    const partes = partesIguales(res.total, n);
    return h('div', { class: 'paso' },
      control,
      h('p', { class: 'ayuda cifra' }, partes.map((m, i) => `${T('persona', { n: i + 1 })}: ${dinero(m)}`).join(' · ')),
      errorDiv ? h('p', { class: 'mensaje-error', role: 'alert' }, textoError(errorDiv[1].error, ui.idioma)) : null,
      h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'dividir', disabled: intentando, onclick: () => { if (errorDiv) cliente.olvidarIntento(errorDiv[0]); cliente.enviar('cuenta', { accion: 'dividir', division: { tipo: 'iguales', n } }); } }, intentando ? T('enviando') : T('dividir')),
    );
  }
  // Por platos: cada renglón con un botón por persona
  const renglones = res.renglones;
  const asign = pago.asignacion;
  for (const k of Object.keys(asign)) if (!renglones.some((r) => r.clave === k)) delete asign[k];
  for (const k of Object.keys(asign)) asign[k] = asign[k].filter((i) => i < n);
  const calc = porPlatos(renglones.map((r) => ({ clave: r.clave, monto: r.monto })), asign, n);
  const faltan = calc.sinAsignar.length;
  return h('div', { class: 'paso' },
    control,
    h('p', { class: 'ayuda' }, T('asignaAyuda')),
    h('ul', { class: 'asignacion' },
      renglones.map((r) =>
        h('li', { class: 'asignacion__renglon' },
          h('div', { class: 'renglon' }, h('span', { class: 'renglon__nombre' }, h('strong', { class: 'renglon__cant' }, `${r.cant} ×`), ' ', nombrePlato(r.plato, r.nombre)), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(r.monto))),
          h('div', { class: 'asignacion__personas', role: 'group', 'aria-label': nombrePlato(r.plato, r.nombre) },
            Array.from({ length: n }, (_, i) => {
              const marcado = (asign[r.clave] ?? []).includes(i);
              return h('button', {
                type: 'button',
                class: 'persona',
                'aria-pressed': String(marcado),
                'data-foco': `as-${r.clave}-${i}`,
                'aria-label': `${T('persona', { n: i + 1 })}: ${nombrePlato(r.plato, r.nombre)}`,
                onclick: () => {
                  const set = new Set(asign[r.clave] ?? []);
                  if (set.has(i)) set.delete(i);
                  else set.add(i);
                  asign[r.clave] = [...set];
                  pintarCuenta();
                },
              }, String(i + 1));
            }),
          ),
        ),
      ),
    ),
    h('p', { class: 'ayuda cifra' }, calc.partes.map((m, i) => `${T('persona', { n: i + 1 })}: ${dinero(m)}`).join(' · ')),
    faltan ? h('p', { class: 'nota nota--espera' }, icono('info'), h('span', {}, faltan === 1 ? T('faltanAsignar1') : T('faltanAsignarN', { n: faltan }))) : null,
    errorDiv ? h('p', { class: 'mensaje-error', role: 'alert' }, textoError(errorDiv[1].error, ui.idioma)) : null,
    h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'dividir', disabled: faltan > 0 || intentando, onclick: () => { if (errorDiv) cliente.olvidarIntento(errorDiv[0]); cliente.enviar('cuenta', { accion: 'dividir', division: { tipo: 'platos', n, asignacion: asign } }); } }, intentando ? T('enviando') : T('dividir')),
  );
}

function formularioPropina(base) {
  const pago = ui.pago;
  const sugeridas = cliente.resumen?.ajustes?.propinas ?? [10, 15, 20];
  const opciones = opcionesPropina(sugeridas);
  const res = resolverPropina(base, pago.propina?.tipo === 'monto' ? { tipo: 'monto', texto: pago.montoTexto } : pago.propina);
  const marcada = (o) => pago.propina && pago.propina.tipo === o.tipo && (o.tipo !== 'pct' || pago.propina.pct === o.pct);
  const entradaMonto =
    pago.propina?.tipo === 'monto'
      ? h('div', { class: 'campo' },
          h('label', { for: 'monto-propina' }, T('montoPropina')),
          h('input', {
            id: 'monto-propina',
            inputmode: 'decimal',
            autocomplete: 'off',
            value: pago.montoTexto,
            'data-foco': 'monto-propina',
            'aria-invalid': pago.montoTexto && !res.ok ? 'true' : 'false',
            'aria-describedby': 'propina-error',
            oninput: (ev) => {
              pago.montoTexto = ev.target.value;
              const r2 = resolverPropina(base, { tipo: 'monto', texto: pago.montoTexto });
              const err = $('#propina-error');
              if (err) err.textContent = pago.montoTexto && !r2.ok ? T(`propina.${r2.motivo}`) : '';
              ev.target.setAttribute('aria-invalid', pago.montoTexto && !r2.ok ? 'true' : 'false');
              actualizarResumenPago(base);
            },
          }),
          h('p', { id: 'propina-error', class: 'mensaje-error', role: 'alert' }, pago.montoTexto && !res.ok ? T(`propina.${res.motivo}`) : ''),
        )
      : null;
  return h('fieldset', { class: 'paso' },
    h('legend', { class: 'paso__titulo' }, T('tituloPropina')),
    h('p', { class: 'ayuda' }, T('propinaSobre', { base: dinero(base) })),
    h('div', { class: 'grupo__opciones grupo__opciones--propina' },
      opciones.map((o) => {
        const etiqueta = o.tipo === 'pct' ? T('pctBoton', { pct: o.pct }) : o.tipo === 'monto' ? T('otraCifra') : T('sinPropina');
        return h('label', { class: 'opcion opcion--propina' },
          h('input', { type: 'radio', name: 'propina', value: o.tipo === 'pct' ? String(o.pct) : o.tipo, checked: Boolean(marcada(o)), 'data-foco': `propina-${o.pct ?? o.tipo}`, onchange: () => { pago.propina = o.tipo === 'pct' ? { tipo: 'pct', pct: o.pct } : { tipo: o.tipo }; pintarCuenta(); if (o.tipo === 'monto') $('#monto-propina')?.focus(); } }),
          h('span', { class: 'opcion__texto' }, etiqueta),
          o.tipo === 'pct' ? h('span', { class: 'opcion__extra' }, dinero(propinaPorcentaje(base, o.pct))) : null,
        );
      }),
    ),
    entradaMonto,
    pago.propina?.tipo === 'pct' && res.ok ? h('p', { class: 'propina__detalle cifra' }, T('pctDetalle', { pct: res.pct, base: dinero(base), monto: dinero(res.propina) })) : null,
  );
}

function formularioMetodo(base) {
  const pago = ui.pago;
  const res = resolverPropina(base, pago.propina?.tipo === 'monto' ? { tipo: 'monto', texto: pago.montoTexto } : pago.propina);
  const total = res.ok ? base + res.propina : null;
  const explicacion = {
    yappy: () => h('div', { class: 'metodo__detalle' },
      h('img', { src: 'img/yappy-ejemplo.svg', width: '168', height: '168', class: 'yappy-qr', alt: T('yappyEjemplo') }),
      h('div', {}, h('p', {}, total !== null ? T('yappyExplica', { monto: dinero(total) }) : T('propinaElige')), h('p', { class: 'ayuda' }, T('yappyEjemplo')))),
    tarjeta: () => h('p', { class: 'ayuda metodo__detalle' }, T('tarjetaExplica')),
    mesero: () => h('p', { class: 'ayuda metodo__detalle' }, T('meseroExplica')),
  };
  return h('fieldset', { class: 'paso' },
    h('legend', { class: 'paso__titulo' }, T('tituloMetodo')),
    h('div', { class: 'grupo__opciones' },
      ['yappy', 'tarjeta', 'mesero'].map((m) =>
        h('label', { class: 'opcion' },
          h('input', { type: 'radio', name: 'metodo', value: m, checked: pago.metodo === m, 'data-foco': `metodo-${m}`, onchange: () => { pago.metodo = m; pintarCuenta(); } }),
          icono(m === 'yappy' ? 'telefono' : m === 'tarjeta' ? 'tarjeta' : 'persona'),
          h('span', { class: 'opcion__texto' }, T(`metodo.${m}`)),
        ),
      ),
    ),
    pago.metodo ? explicacion[pago.metodo]() : null,
  );
}

function resumenYBoton(base) {
  return h('div', { class: 'paso resumen-pago', id: 'resumen-pago' }, contenidoResumenPago(base));
}

function contenidoResumenPago(base) {
  const pago = ui.pago;
  const res = resolverPropina(base, pago.propina?.tipo === 'monto' ? { tipo: 'monto', texto: pago.montoTexto } : pago.propina);
  const listo = res.ok && pago.metodo;
  const falta = !res.ok ? T('propinaElige') : !pago.metodo ? T('eligeMetodo') : '';
  return [
    h('div', { class: 'ticket-sombra' },
      h('div', { class: 'ticket ticket--resumen' },
        renglonTicket(T('consumo'), dinero(base)),
        renglonTicket(T('propina'), res.ok ? dinero(res.propina) : '—'),
        renglonTicket(T('totalPagar'), res.ok ? dinero(base + res.propina) : '—', 'ticket__total'),
      ),
    ),
    falta ? h('p', { class: 'ayuda', id: 'falta-pago' }, falta) : null,
    h('button', {
      type: 'button',
      class: 'boton boton--primario boton--grande boton--ancho',
      'data-foco': 'pagar',
      disabled: !listo,
      'aria-describedby': falta ? 'falta-pago' : false,
      onclick: () => {
        const div = cliente.resumen?.cuenta?.division;
        const parte = div && pago.modo !== 'todo' && pago.parte !== null ? pago.parte : null;
        cliente.enviar('pago', { parte, monto: base, propina: res.propina, metodo: pago.metodo });
        ui.pago = nuevoPago();
        pintarCuenta();
        $('#vista-cuenta .ticket--comprobante')?.scrollIntoView({ block: 'center' });
      },
    }, pago.metodo === 'mesero' ? T('avisarPagoMesero') : T('simularPago')),
  ];
}

function actualizarResumenPago(base) {
  const caja = $('#resumen-pago');
  if (caja) pintar(caja, contenidoResumenPago(base));
}

// Service worker: la carta queda en caché para el interior con mala señal.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

iniciar();
