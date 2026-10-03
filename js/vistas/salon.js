// salon.html · mapa del salón para el mesero y la caja: estado de cada mesa, pendientes, cobro, borrador de
// factura, liberar mesa y editor del plano (arrastrar con puntero o mover con teclado).

import { $, $$, h, icono, pintar, hora, hace, plural } from '../ui/dom.js';
import { anunciar, confirmar } from '../ui/comun.js';
import { arrancarCaja } from '../ui/arranque.js';
import { leer, escribir } from '../ui/almacen.js';
import { mesaRt, estadoVisible, porAtender } from '../nucleo/caja.mjs';
import { resumenCuenta, renglonesCobrables } from '../nucleo/cuenta.mjs';
import { formatear, leerMonto, desglosarItbms } from '../nucleo/dinero.mjs';
import { textoError } from '../nucleo/textos.mjs';
import { formatoOrden } from '../nucleo/kiosco.mjs';
import { generarId } from '../nucleo/url.mjs';
import {
  ANCHO, tamanoMesa, altoZona, colocarMesa, moverMesa, pasoTecla, agregarMesa, quitarMesa, cambiarMesa,
  agregarZona, renombrarZona, cambiarAltoZona, quitarZona, cruces, FORMAS, CAP_MIN, CAP_MAX, ALTO_MIN, ALTO_MAX,
} from '../nucleo/plano.mjs';

const ESTADOS = {
  libre: { texto: 'Libre', icono: null },
  ocupada: { texto: 'Ocupada', icono: 'persona' },
  pidio: { texto: 'Pidió', icono: 'bolsa' },
  llama: { texto: 'Llama', icono: 'campana' },
  cuenta: { texto: 'Pidió la cuenta', icono: 'recibo' },
  pagada: { texto: 'Pagada', icono: 'check' },
};
const ESTADO_PEDIDO = {
  'por-aceptar': 'Por aceptar',
  enviado: 'Enviado a cocina',
  recibido: 'Recibido en cocina',
  'en-preparacion': 'En preparación',
  listo: 'Listo para servir',
  servido: 'Servido',
  rechazado: 'Rechazado',
};
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', yappy: 'Yappy', mesero: 'Al mesero' };
const MOTIVOS_RECHAZO = ['Pedido desde fuera del local', 'Se agotó un plato', 'La mesa no pidió esto'];
const ANCHO_PANEL = '(min-width: 1100px)';

let caja = null;
const ui = {
  modo: leer('salon-modo') ?? (innerWidth < 700 ? 'lista' : 'plano'),
  seleccion: null,
  editando: false,
  borrador: null,
  mesaEditada: null,
  errorPlano: '',
  cobro: null,
  rechazando: null,
};

const dinero = (c) => formatear(c);
const est = () => caja.estado;
const plano = () => (ui.editando ? ui.borrador : est().plano);

function ocupadas() {
  return new Set(Object.entries(est().mesas).filter(([, m]) => m.estado !== 'libre').map(([n]) => Number(n)));
}

async function hacer(accion, exito) {
  const r = await caja.despachar(accion);
  if (r.error) {
    anunciar(textoError(r.error, 'es', typeof r.detalle === 'number' ? dinero(r.detalle) : r.detalle), { tipo: 'alerta', duracion: 6000 });
    return r;
  }
  if (exito) $('#anuncio-salon').textContent = exito;
  return r;
}

// ——— Pendientes ———
function textoPendiente(p) {
  const motivo = { pedir: 'pedir algo más', ayuda: 'necesita ayuda', otra: 'otra cosa' };
  if (p.tipo === 'llama') return [`Mesa ${p.mesa} llama al mesero`, `${motivo[p.motivo] ?? ''}${p.texto ? `: «${p.texto}»` : ''}`];
  if (p.tipo === 'cuenta') return [`Mesa ${p.mesa} pidió la cuenta`, ''];
  if (p.tipo === 'aceptar') return [`Mesa ${p.mesa}: pedido por aceptar`, 'revísalo y pásalo a cocina'];
  if (p.tipo === 'servir') return [`Mesa ${p.mesa}: pedido listo para servir`, ''];
  if (p.tipo === 'pago') return [`Mesa ${p.mesa}: pago por confirmar`, `${METODOS[p.metodo] ?? p.metodo}, ${dinero(p.monto + p.propina)}`];
  return [`Mesa ${p.mesa}`, ''];
}
const ICONO_PENDIENTE = { llama: 'campana', cuenta: 'recibo', aceptar: 'bolsa', servir: 'cocina', pago: 'tarjeta' };

function pintarPendientes() {
  const lista = porAtender(est());
  const ahora = Date.now();
  $('#titulo-pendientes').textContent = lista.length ? `Por atender (${lista.length})` : 'Por atender';
  pintar(
    $('#lista-pendientes'),
    lista.length
      ? h(
          'ul',
          { class: 'pendientes__lista' },
          lista.map((p) => {
            const [titulo, detalle] = textoPendiente(p);
            return h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: `pendiente pendiente--${p.tipo}`, 'data-foco': `pend-${p.id}`, onclick: () => seleccionar(p.mesa) },
                icono(ICONO_PENDIENTE[p.tipo]),
                h('span', { class: 'pendiente__texto' }, h('strong', {}, titulo), detalle ? h('span', {}, ` · ${detalle}`) : null),
                h('span', { class: 'pendiente__hora cifra' }, hace(p.t, ahora)),
              ),
            );
          }),
        )
      : h('p', { class: 'vacio' }, 'Nada por atender. Las llamadas, los pedidos por aceptar y los pagos por confirmar aparecen aquí, el más viejo primero.'),
  );
}

// ——— Mesas: plano y lista ———
function infoMesa(n) {
  const m = mesaRt(est(), n);
  const ev = estadoVisible(m);
  const listos = (m.cuenta?.pedidos ?? []).filter((p) => p.estado === 'listo').length;
  const total = m.cuenta ? resumenCuenta(m.cuenta).total : 0;
  return { m, ev, listos, total };
}

function etiquetaMesa(mp) {
  const { ev, listos, total } = infoMesa(mp.numero);
  return `Mesa ${mp.numero}, ${plural(mp.capacidad, 'persona', 'personas')}, ${ESTADOS[ev].texto}${listos ? `, ${plural(listos, 'pedido listo', 'pedidos listos')} para servir` : ''}${total ? `, cuenta ${dinero(total)}` : ''}`;
}

function pintarMesas() {
  for (const b of $$('#selector-vista button')) b.setAttribute('aria-pressed', String(b.dataset.modo === ui.modo));
  if (ui.editando || ui.modo === 'plano') pintarPlano();
  else pintarLista();
}

function estiloMesa(mp, alto) {
  const { w, h: alt } = tamanoMesa(mp);
  return { left: `${(mp.x / ANCHO) * 100}%`, top: `${(mp.y / alto) * 100}%`, width: `${(w / ANCHO) * 100}%`, height: `${(alt / alto) * 100}%` };
}

function pintarPlano() {
  const p = plano();
  const cruzadas = ui.editando ? new Set(p.mesas.filter((m) => cruces(p, m.id).length).map((m) => m.id)) : new Set();
  pintar(
    $('#mesas'),
    h(
      'div',
      { class: `plano${ui.editando ? ' plano--editando' : ''}` },
      p.zonas.map((z) => {
        const alto = altoZona(p, z.id);
        return h(
          'section',
          { class: 'zona', 'aria-labelledby': `zona-${z.id}` },
          h('h3', { class: 'zona__titulo', id: `zona-${z.id}` }, z.nombre),
          h(
            'div',
            { class: 'zona__lienzo', style: { aspectRatio: `${ANCHO} / ${alto}` }, 'data-zona': z.id },
            p.mesas
              .filter((mp) => mp.zona === z.id)
              .map((mp) => {
                const { ev, listos } = infoMesa(mp.numero);
                const e = ESTADOS[ev];
                const sel = ui.editando ? ui.mesaEditada === mp.id : ui.seleccion === mp.numero;
                return h(
                  'button',
                  {
                    type: 'button',
                    class: `mesa-tile forma-${mp.forma} est-${ui.editando ? 'editar' : ev}${sel ? ' mesa-tile--sel' : ''}${cruzadas.has(mp.id) ? ' mesa-tile--cruce' : ''}`,
                    style: estiloMesa(mp, alto),
                    'data-id': mp.id,
                    'data-foco': `mesa-${mp.id}`,
                    'aria-label': ui.editando ? `Mesa ${mp.numero}, ${mp.forma}, ${plural(mp.capacidad, 'persona', 'personas')}. Flechas para mover; Mayús para pasos largos.` : etiquetaMesa(mp),
                    'aria-pressed': ui.editando ? String(sel) : false,
                    onclick: ui.editando ? () => editarMesa(mp.id) : () => seleccionar(mp.numero),
                    onkeydown: ui.editando ? (ev2) => teclaMesa(ev2, mp.id) : null,
                    onpointerdown: ui.editando ? (ev2) => empezarArrastre(ev2, mp.id) : null,
                  },
                  h('span', { class: 'mesa-tile__num cifra' }, String(mp.numero)),
                  !ui.editando && e.icono ? icono(e.icono, 'icono mesa-tile__icono') : null,
                  !ui.editando ? h('span', { class: 'mesa-tile__estado' }, listos && ev === 'ocupada' ? 'Listo' : e.texto) : h('span', { class: 'mesa-tile__estado' }, `${mp.capacidad} p.`),
                );
              }),
          ),
        );
      }),
    ),
  );
}

function pintarLista() {
  const p = est().plano;
  pintar(
    $('#mesas'),
    h(
      'div',
      { class: 'lista-mesas' },
      p.zonas.map((z) =>
        h(
          'section',
          { class: 'zona', 'aria-labelledby': `zl-${z.id}` },
          h('h3', { class: 'zona__titulo', id: `zl-${z.id}` }, z.nombre),
          h(
            'ul',
            { class: 'lista-mesas__lista' },
            p.mesas
              .filter((mp) => mp.zona === z.id)
              .sort((a, b) => a.numero - b.numero)
              .map((mp) => {
                const { m, ev, listos, total } = infoMesa(mp.numero);
                return h(
                  'li',
                  {},
                  h(
                    'button',
                    { type: 'button', class: `fila-mesa est-${ev}${ui.seleccion === mp.numero ? ' fila-mesa--sel' : ''}`, 'data-foco': `fila-${mp.numero}`, onclick: () => seleccionar(mp.numero) },
                    h('span', { class: 'fila-mesa__num' }, `Mesa ${mp.numero}`),
                    h('span', { class: 'fila-mesa__cap' }, plural(mp.capacidad, 'persona', 'personas')),
                    h('span', { class: `insignia insignia--${ev}` }, ESTADOS[ev].icono ? icono(ESTADOS[ev].icono) : null, ESTADOS[ev].texto),
                    h('span', { class: 'fila-mesa__extra cifra' }, [total ? dinero(total) : '', listos ? ` · ${plural(listos, 'listo', 'listos')}` : '', m.desde && ev !== 'libre' ? ` · desde ${hora(m.desde)}` : ''].join('')),
                  ),
                );
              }),
          ),
        ),
      ),
    ),
  );
}

// ——— Detalle de una mesa ———
function seleccionar(n) {
  if (ui.editando) return;
  if (ui.seleccion !== n) {
    ui.cobro = null;
    ui.rechazando = null;
  }
  ui.seleccion = n;
  pintarMesas();
  pintarPanel({ abrir: true });
}

function cerrarPanel() {
  ui.seleccion = null;
  ui.cobro = null;
  ui.rechazando = null;
  const dlg = $('#dlg-mesa');
  if (dlg.open) dlg.close();
  pintarPanel();
  pintarMesas();
}

function pintarPanel({ abrir = false } = {}) {
  const ancho = matchMedia(ANCHO_PANEL).matches;
  const aside = $('#panel-mesa');
  const dlg = $('#dlg-mesa');
  if (ui.seleccion === null || !est().plano.mesas.some((m) => m.numero === ui.seleccion)) {
    ui.seleccion = null;
    pintar(aside, h('div', { class: 'panel-mesa__vacio' }, h('p', {}, 'Toca una mesa del plano o un pendiente para ver su cuenta, aceptar pedidos, cobrar o liberarla.')));
    if (dlg.open) dlg.close();
    return;
  }
  const contenido = contenidoPanel(ui.seleccion);
  if (ancho) {
    if (dlg.open) dlg.close();
    pintar(aside, contenido);
    if (abrir) aside.querySelector('h2')?.focus();
  } else {
    pintar(aside, h('div', { class: 'panel-mesa__vacio' }));
    pintar(dlg, contenido);
    if (abrir && !dlg.open) dlg.showModal();
  }
}

function bloque(titulo, ...hijos) {
  return h('section', { class: 'panel-bloque' }, h('h3', { class: 'panel-bloque__titulo' }, titulo), ...hijos);
}

function contenidoPanel(n) {
  const mp = est().plano.mesas.find((m) => m.numero === n);
  const zona = est().plano.zonas.find((z) => z.id === mp.zona)?.nombre ?? '';
  const m = mesaRt(est(), n);
  const ev = estadoVisible(m);
  const c = m.cuenta;
  const res = c ? resumenCuenta(c) : null;
  const ahora = Date.now();
  const partes = [];

  partes.push(
    h(
      'header',
      { class: 'panel-mesa__cabeza' },
      h('div', {}, h('h2', { id: 'titulo-panel', tabindex: '-1' }, `Mesa ${n}`), h('p', { class: 'panel-mesa__meta' }, `${zona} · ${plural(mp.capacidad, 'persona', 'personas')}${m.desde && m.estado !== 'libre' ? ` · desde las ${hora(m.desde)}` : ''}`)),
      h('span', { class: `insignia insignia--${ev}` }, ESTADOS[ev].icono ? icono(ESTADOS[ev].icono) : null, ESTADOS[ev].texto),
      h('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Cerrar el detalle', 'data-foco': 'cerrar-panel', onclick: cerrarPanel }, icono('x')),
    ),
  );

  if (m.estado === 'libre') {
    partes.push(
      h('p', { class: 'ayuda' }, 'Mesa libre. Cuando el comensal pide por el QR o llama al mesero, la mesa se abre sola.'),
      h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'abrir-mesa', onclick: () => hacer({ tipo: 'abrir-mesa', mesa: n }, `Mesa ${n} ocupada`) }, icono('persona'), 'Sentar clientes (abrir mesa)'),
    );
  }

  // Avisos abiertos
  const avisos = (c?.avisos ?? []).filter((a) => a.estado === 'abierta');
  if (avisos.length) {
    partes.push(
      bloque(
        'Avisos',
        h(
          'ul',
          { class: 'panel-lista' },
          avisos.map((a) =>
            h(
              'li',
              { class: `aviso-salon aviso-salon--${a.tipo}` },
              icono(a.tipo === 'mesero' ? 'campana' : 'recibo'),
              h('span', { class: 'aviso-salon__texto' }, h('strong', {}, a.tipo === 'mesero' ? 'Llama al mesero' : 'Pidió la cuenta'), a.tipo === 'mesero' ? ` · ${{ pedir: 'pedir algo más', ayuda: 'necesita ayuda', otra: 'otra cosa' }[a.motivo] ?? ''}${a.texto ? ` «${a.texto}»` : ''}` : '', h('span', { class: 'ayuda' }, ` · ${hace(a.t, ahora)}`)),
              h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': `atender-${a.id}`, onclick: () => hacer({ tipo: 'atender-aviso', mesa: n, datos: { aviso: a.id } }, 'Aviso atendido: el teléfono de la mesa ve «Visto por el mesero».') }, icono('check'), 'Atender'),
            ),
          ),
        ),
      ),
    );
  }

  // Pedidos
  const pedidos = [...(c?.pedidos ?? [])].sort((a, b) => b.ronda - a.ronda || b.t - a.t);
  if (pedidos.length) {
    partes.push(bloque('Pedidos', h('ul', { class: 'panel-lista' }, pedidos.map((p) => h('li', {}, bloquePedido(p, n, ahora))))));
  }

  // Cuenta
  if (res && (res.total > 0 || c.pagos.length)) {
    partes.push(bloque('Cuenta', resumenCuentaSalon(c, res, n)));
  }

  // Acciones de cierre
  if (m.estado !== 'libre') {
    const enCurso = (c?.pedidos ?? []).filter((p) => ['por-aceptar', 'enviado', 'recibido', 'en-preparacion', 'listo'].includes(p.estado)).length;
    const pendientesPago = (c?.pagos ?? []).filter((p) => p.estado === 'pendiente').length;
    let razon = '';
    if (m.estado === 'ocupada' && res?.total > 0) razon = `Falta cobrar ${dinero(res.saldoConfirmado)}.`;
    else if (enCurso) razon = 'Hay pedidos sin servir.';
    else if (pendientesPago) razon = 'Hay pagos por confirmar.';
    partes.push(
      h(
        'div',
        { class: 'panel-acciones' },
        res && res.saldo > 0 ? h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'cobrar', 'aria-expanded': String(Boolean(ui.cobro)), onclick: () => { ui.cobro = ui.cobro ? null : nuevoCobro(res.saldo); pintarPanel(); $('#cobro-metodo-efectivo')?.focus(); } }, icono('efectivo'), 'Cobrar') : null,
        res && res.total > 0 ? h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'facturar', onclick: () => abrirFactura(n) }, icono('recibo'), 'Facturar') : null,
        h('button', {
          type: 'button',
          class: 'boton boton--secundario',
          'data-foco': 'liberar',
          'aria-disabled': razon ? 'true' : 'false',
          'aria-describedby': razon ? 'razon-liberar' : false,
          onclick: async () => {
            if (razon) {
              anunciar(`No se puede liberar la mesa ${n}: ${razon}`, { tipo: 'alerta' });
              return;
            }
            const ok = await confirmar({ titulo: `¿Liberar la mesa ${n}?`, texto: 'La cuenta se cierra y la mesa queda libre para los siguientes clientes.', aceptar: 'Liberar mesa' });
            if (!ok) return;
            const r = await hacer({ tipo: 'liberar-mesa', mesa: n }, `Mesa ${n} libre.`);
            if (!r.error) anunciar(`Mesa ${n} libre.`);
          },
        }, 'Liberar mesa'),
        razon ? h('p', { class: 'ayuda', id: 'razon-liberar' }, `Para liberar: ${razon.charAt(0).toLowerCase()}${razon.slice(1)}`) : null,
      ),
    );
    if (ui.cobro) partes.push(formularioCobro(n, res));
  }
  return h('div', { class: 'panel-mesa__contenido' }, partes);
}

function bloquePedido(p, n, ahora) {
  const origen = p.origen === 'qr' ? 'por QR' : p.origen === 'mesero' ? 'del mesero' : 'del kiosco';
  const claseEstado = p.estado === 'por-aceptar' ? 'estado--espera' : p.estado === 'listo' ? 'estado--ok' : p.estado === 'rechazado' ? 'estado--alerta' : '';
  const acciones = [];
  if (p.estado === 'por-aceptar') {
    if (ui.rechazando === p.id) {
      const sel = h('select', { id: `motivo-${p.id}`, 'data-foco': `motivo-${p.id}` }, MOTIVOS_RECHAZO.map((x) => h('option', {}, x)), h('option', { value: '' }, 'Otro (escríbelo)'));
      const otro = h('input', { id: `otro-${p.id}`, maxlength: '80', placeholder: 'Motivo', hidden: true });
      sel.addEventListener('change', () => (otro.hidden = sel.value !== ''));
      acciones.push(
        h(
          'div',
          { class: 'rechazo' },
          h('div', { class: 'campo' }, h('label', { for: `motivo-${p.id}` }, 'Motivo (lo ve el teléfono de la mesa)'), sel, otro),
          h('div', { class: 'fila-botones' },
            h('button', { type: 'button', class: 'boton boton--peligro', onclick: async () => { const motivo = sel.value || otro.value.trim(); ui.rechazando = null; await hacer({ tipo: 'rechazar-pedido', datos: { pedido: p.id, motivo } }, 'Pedido rechazado.'); } }, 'Rechazar pedido'),
            h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => { ui.rechazando = null; pintarPanel(); } }, 'Cancelar'),
          ),
        ),
      );
    } else {
      acciones.push(
        h('div', { class: 'fila-botones' },
          h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': `aceptar-${p.id}`, onclick: () => hacer({ tipo: 'aceptar-pedido', datos: { pedido: p.id } }, `Pedido de la mesa ${n} enviado a cocina.`) }, icono('cocina'), 'Aceptar y enviar a cocina'),
          h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': `rechazar-${p.id}`, onclick: () => { ui.rechazando = p.id; pintarPanel(); $(`#motivo-${p.id}`)?.focus(); } }, 'Rechazar'),
        ),
      );
    }
  }
  if (p.estado === 'listo') acciones.push(h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': `servir-${p.id}`, onclick: () => hacer({ tipo: 'servir-pedido', datos: { pedido: p.id } }, `Pedido de la mesa ${n} servido.`) }, icono('check'), 'Marcar servido'));
  return h(
    'article',
    { class: 'pedido-salon' },
    h('header', { class: 'pedido-salon__cabeza' }, h('strong', {}, `Ronda ${p.ronda}`), h('span', { class: 'ayuda' }, ` · ${origen} · ${hora(p.t)}`), h('span', { class: `estado ${claseEstado}` }, ESTADO_PEDIDO[p.estado])),
    h('ul', { class: 'renglones renglones--salon' }, p.renglones.map((r) => h('li', {}, h('div', { class: 'renglon' }, h('span', { class: 'renglon__cant' }, `${r.cant} ×`), h('span', { class: 'renglon__nombre' }, r.nombre), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(r.monto))), r.mods.length || r.nota ? h('p', { class: 'renglon__detalle' }, [r.mods.map((x) => x.nombre).join(', '), r.nota ? `«${r.nota}»` : ''].filter(Boolean).join(' · ')) : null))),
    p.estado === 'rechazado' && p.motivo ? h('p', { class: 'ayuda' }, `Motivo: ${p.motivo}`) : null,
    acciones,
  );
}

function resumenCuentaSalon(c, res, n) {
  const pagos = c.pagos;
  return h(
    'div',
    { class: 'cuenta-salon' },
    h('div', { class: 'renglon ticket__total' }, h('span', { class: 'renglon__nombre' }, 'Total con ITBMS'), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(res.total))),
    res.itbms.porTasa.map((x) => h('div', { class: 'renglon renglon--menor' }, h('span', { class: 'renglon__nombre' }, `ITBMS ${x.tasa} % de ${dinero(x.base)}`), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(x.impuesto)))),
    res.division ? h('p', { class: 'ayuda' }, `Dividida ${res.division.tipo === 'iguales' ? 'en partes iguales' : 'por platos'} entre ${res.division.n}: ${res.division.partes.map((x) => `${dinero(x.monto)} (${x.estado === 'pagada' ? 'pagada' : x.estado === 'pendiente' ? 'por confirmar' : 'por pagar'})`).join(', ')}.${res.division.desfasada ? ' Se agregaron platos después de dividir.' : ''}`) : null,
    pagos.length
      ? h(
          'ul',
          { class: 'panel-lista pagos-salon' },
          pagos.map((p) =>
            h(
              'li',
              { class: `pago-salon pago-salon--${p.estado}` },
              h('span', { class: 'pago-salon__texto' }, h('strong', {}, `${METODOS[p.metodo] ?? p.metodo} · ${dinero(p.monto)}`), p.propina ? ` + propina ${dinero(p.propina)}` : '', p.parte !== null ? ` · parte ${p.parte + 1}` : '', h('span', { class: 'ayuda' }, ` · ${p.origen === 'caja' ? 'cobrado en caja' : 'desde la mesa'} ${hora(p.t)}`), p.metodo === 'efectivo' && p.recibido ? h('span', { class: 'ayuda' }, ` · recibido ${dinero(p.recibido)}, vuelto ${dinero(p.recibido - p.monto - p.propina)}`) : null),
              p.estado === 'pendiente'
                ? h('span', { class: 'fila-botones' },
                    h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': `confirmar-${p.id}`, onclick: () => hacer({ tipo: 'confirmar-pago', mesa: n, datos: { pago: p.id } }, 'Pago confirmado.') }, icono('check'), 'Pago recibido'),
                    h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': `rechazar-pago-${p.id}`, onclick: () => hacer({ tipo: 'rechazar-pago', mesa: n, datos: { pago: p.id } }, 'Pago marcado como no recibido.') }, 'No llegó'),
                  )
                : h('span', { class: `estado ${p.estado === 'confirmado' ? 'estado--ok' : 'estado--alerta'}` }, p.estado === 'confirmado' ? 'Confirmado' : 'No llegó'),
            ),
          ),
        )
      : null,
    h('div', { class: 'renglon renglon--falta' }, h('span', { class: 'renglon__nombre' }, 'Falta por cobrar'), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(Math.max(0, res.saldoConfirmado)))),
    res.propinaConfirmada ? h('p', { class: 'ayuda' }, `Propinas recibidas: ${dinero(res.propinaConfirmada)} (aparte de la cuenta).`) : null,
    h('p', { class: 'ayuda' }, 'En producción, los pagos con tarjeta o Yappy por botón se confirman solos cuando la pasarela avisa por webhook. Aquí los confirma la caja.'),
  );
}

// ——— Cobro en caja ———
function nuevoCobro(saldo) {
  return { metodo: 'efectivo', filas: [{ metodo: 'efectivo', monto: (saldo / 100).toFixed(2) }, { metodo: 'tarjeta', monto: '' }], monto: (saldo / 100).toFixed(2), propina: '', recibido: '', error: '' };
}

function calcularCobro(res) {
  const co = ui.cobro;
  const propina = co.propina.trim() ? leerMonto(co.propina) : 0;
  if (propina === null) return { error: 'La propina no se entiende. Escríbela con números, por ejemplo 3.50.' };
  if (co.metodo === 'mixto') {
    const pagos = [];
    for (const f of co.filas) {
      if (!f.monto.trim()) continue;
      const m = leerMonto(f.monto);
      if (m === null || m <= 0) return { error: 'Un monto del pago mixto no se entiende.' };
      pagos.push({ metodo: f.metodo, monto: m, propina: 0 });
    }
    if (pagos.length < 2) return { error: 'Un pago mixto lleva al menos dos montos.' };
    const suma = pagos.reduce((s, p) => s + p.monto, 0);
    if (suma > res.saldo) return { error: `Los montos suman ${dinero(suma)} y falta cobrar ${dinero(res.saldo)}.` };
    pagos[0].propina = propina;
    return { pagos, suma, propina };
  }
  const monto = leerMonto(co.monto);
  if (monto === null || monto <= 0) return { error: 'Escribe el monto a cobrar.' };
  if (monto > res.saldo) return { error: `El monto pasa de lo que falta (${dinero(res.saldo)}).` };
  const pago = { metodo: co.metodo, monto, propina };
  let vuelto = null;
  if (co.metodo === 'efectivo' && co.recibido.trim()) {
    const recibido = leerMonto(co.recibido);
    if (recibido === null) return { error: 'El efectivo recibido no se entiende.' };
    if (recibido < monto + propina) return { error: `Con ${dinero(recibido)} no alcanza: son ${dinero(monto + propina)}.` };
    pago.recibido = recibido;
    vuelto = recibido - monto - propina;
  }
  return { pagos: [pago], suma: monto, propina, vuelto };
}

function formularioCobro(n, res) {
  const co = ui.cobro;
  const salida = h('p', { class: 'cobro__calculo cifra', id: 'cobro-calculo', 'aria-live': 'polite' });
  const actualizar = () => {
    const c = calcularCobro(res);
    salida.textContent = c.error ? c.error : `Se registran ${dinero(c.suma)}${c.propina ? ` + ${dinero(c.propina)} de propina` : ''}.${c.vuelto !== null && c.vuelto !== undefined ? ` Vuelto: ${dinero(c.vuelto)}.` : ''} Quedan ${dinero(res.saldo - c.suma)} por cobrar.`;
    salida.classList.toggle('cobro__calculo--error', Boolean(c.error));
  };
  const campo = (id, etiqueta, clave, ayuda) =>
    h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), h('input', { id, inputmode: 'decimal', autocomplete: 'off', value: co[clave], 'data-foco': id, oninput: (ev) => { co[clave] = ev.target.value; actualizar(); } }), ayuda ? h('p', { class: 'ayuda' }, ayuda) : null);
  const metodos = ['efectivo', 'tarjeta', 'yappy', 'mixto'];
  const cuerpo = [];
  if (co.metodo === 'mixto') {
    co.filas.forEach((f, i) => {
      cuerpo.push(
        h('div', { class: 'fila-mixto' },
          h('div', { class: 'campo' }, h('label', { for: `mixto-m-${i}` }, `Pago ${i + 1}`), h('select', { id: `mixto-m-${i}`, 'data-foco': `mixto-m-${i}`, onchange: (ev) => { f.metodo = ev.target.value; } }, ['efectivo', 'tarjeta', 'yappy'].map((x) => h('option', { value: x, selected: f.metodo === x }, METODOS[x])))),
          h('div', { class: 'campo' }, h('label', { for: `mixto-v-${i}` }, 'Monto (B/.)'), h('input', { id: `mixto-v-${i}`, inputmode: 'decimal', autocomplete: 'off', value: f.monto, 'data-foco': `mixto-v-${i}`, oninput: (ev) => { f.monto = ev.target.value; actualizar(); } })),
        ),
      );
    });
    if (co.filas.length < 4) cuerpo.push(h('button', { type: 'button', class: 'boton boton--texto', onclick: () => { co.filas.push({ metodo: 'yappy', monto: '' }); pintarPanel(); } }, 'Agregar otro pago'));
  } else {
    cuerpo.push(campo('cobro-monto', 'Monto a cobrar (B/.)', 'monto', `Falta cobrar ${dinero(res.saldo)}.`));
  }
  cuerpo.push(campo('cobro-propina', 'Propina que deja el cliente (B/., opcional)', 'propina', 'Va aparte de la cuenta.'));
  if (co.metodo === 'efectivo') cuerpo.push(campo('cobro-recibido', 'Efectivo recibido (B/., para el vuelto)', 'recibido', null));
  const form = h(
    'form',
    {
      class: 'cobro',
      'aria-labelledby': 'titulo-cobro',
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        const c = calcularCobro(res);
        if (c.error) {
          actualizar();
          anunciar(c.error, { tipo: 'alerta' });
          return;
        }
        const r = await hacer({ tipo: 'cobrar', mesa: n, datos: { pagos: c.pagos } }, 'Cobro registrado.');
        if (!r.error) {
          ui.cobro = null;
          anunciar(`Cobro registrado en la mesa ${n}${c.vuelto ? `. Vuelto: ${dinero(c.vuelto)}` : ''}.`);
          pintarPanel();
        }
      },
    },
    h('h3', { class: 'panel-bloque__titulo', id: 'titulo-cobro' }, 'Cobrar en caja'),
    h('fieldset', {}, h('legend', {}, 'Medio de pago'), h('div', { class: 'grupo__opciones grupo__opciones--cobro' }, metodos.map((x) => h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'cobro-metodo', id: `cobro-metodo-${x}`, value: x, checked: co.metodo === x, onchange: () => { co.metodo = x; pintarPanel(); } }), h('span', { class: 'opcion__texto' }, x === 'mixto' ? 'Mixto' : METODOS[x]))))),
    cuerpo,
    salida,
    h('div', { class: 'fila-botones' }, h('button', { type: 'submit', class: 'boton boton--primario' }, 'Registrar cobro'), h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => { ui.cobro = null; pintarPanel(); } }, 'Cancelar')),
  );
  queueMicrotask(actualizar);
  return form;
}

// ——— Borrador de factura ———
function abrirFactura(n) {
  const m = mesaRt(est(), n);
  const c = m.cuenta;
  const res = resumenCuenta(c);
  const dlg = $('#dlg-factura');
  const datos = { nombre: '', ruc: '' };
  const renglones = renglonesCobrables(c);
  const vista = h('div', { class: 'factura' });
  const pintarFactura = () => {
    const itbms = desglosarItbms(renglones.map((r) => ({ monto: r.monto, tasa: r.tasa })));
    pintar(
      vista,
      h(
        'div',
        { class: 'ticket-sombra' },
        h(
          'article',
          { class: 'ticket ticket--factura', 'aria-labelledby': 'factura-titulo' },
          h('header', { class: 'ticket__cabeza ticket__cabeza--factura' }, h('h3', { class: 'ticket__titulo', id: 'factura-titulo' }, 'Borrador de factura'), h('p', { class: 'ticket__meta' }, `${est().ajustes.nombre} (restaurante de ejemplo) · Mesa ${n} · ${new Intl.DateTimeFormat('es-PA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`)),
          h('p', { class: 'factura__cliente' }, `Cliente: ${datos.nombre.trim() || 'Consumidor final'}${datos.ruc.trim() ? ` · RUC o cédula: ${datos.ruc.trim()}` : ''}`),
          h('ul', { class: 'renglones' }, renglones.map((r) => h('li', {}, h('div', { class: 'renglon' }, h('span', { class: 'renglon__cant' }, `${r.cant} ×`), h('span', { class: 'renglon__nombre' }, `${r.nombre} (ITBMS ${r.tasa} %)`), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(r.monto)))))),
          h(
            'div',
            { class: 'ticket__pie' },
            itbms.porTasa.map((x) => [
              h('div', { class: 'renglon renglon--menor' }, h('span', { class: 'renglon__nombre' }, `Base gravada al ${x.tasa} %`), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(x.base))),
              h('div', { class: 'renglon renglon--menor' }, h('span', { class: 'renglon__nombre' }, `ITBMS ${x.tasa} %`), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(x.impuesto))),
            ]),
            h('div', { class: 'renglon ticket__total' }, h('span', { class: 'renglon__nombre' }, 'Total'), h('span', { class: 'renglon__puntos', 'aria-hidden': 'true' }), h('span', { class: 'renglon__monto' }, dinero(itbms.total))),
            res.propinaConfirmada ? h('p', { class: 'renglon--menor' }, `Propina recibida aparte: ${dinero(res.propinaConfirmada)} (no forma parte de la venta).`) : null,
          ),
        ),
      ),
    );
    return itbms;
  };
  const json = () => {
    const itbms = desglosarItbms(renglones.map((r) => ({ monto: r.monto, tasa: r.tasa })));
    return JSON.stringify({ nota: 'Formato ilustrativo. No es el esquema oficial de la DGI: el PAC define el suyo.', emisor: est().ajustes.nombre, cliente: { nombre: datos.nombre.trim() || 'Consumidor final', ruc: datos.ruc.trim() || null }, renglones: renglones.map((r) => ({ descripcion: r.nombre, cantidad: r.cant, total: r.monto / 100, tasaItbms: r.tasa })), totales: { base: itbms.base / 100, itbms: itbms.impuesto / 100, total: itbms.total / 100, porTasa: itbms.porTasa.map((x) => ({ tasa: x.tasa, base: x.base / 100, itbms: x.impuesto / 100 })) } }, null, 2);
  };
  const campo = (id, etiqueta, clave) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), h('input', { id, autocomplete: 'off', maxlength: '80', oninput: (ev) => { datos[clave] = ev.target.value; pintarFactura(); } }));
  pintar(
    dlg,
    h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'titulo-factura' }, `Facturar la mesa ${n}`), h('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, icono('x'))),
    h(
      'div',
      { class: 'hoja__cuerpo' },
      h('p', { class: 'nota nota--espera' }, icono('info'), h('span', {}, 'La factura electrónica válida la emite el PAC autorizado por la DGI; aquí se arma el borrador que se le enviaría. Es obligatoria desde el 1 de enero de 2026 para quien factura más de B/. 36,000 al año o emite más de 100 documentos al mes.')),
      campo('factura-nombre', 'Nombre o razón social (opcional)', 'nombre'),
      campo('factura-ruc', 'RUC o cédula (opcional)', 'ruc'),
      h('p', { class: 'ayuda' }, 'Es una demo: no escribas datos reales. Sin datos, la factura va a «Consumidor final».'),
      vista,
    ),
    h(
      'div',
      { class: 'hoja__pie fila-botones' },
      h('button', { type: 'button', class: 'boton boton--primario', onclick: () => { document.body.classList.add('imprimiendo-factura'); print(); document.body.classList.remove('imprimiendo-factura'); } }, icono('imprimir'), 'Imprimir borrador'),
      h('button', {
        type: 'button',
        class: 'boton boton--secundario',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(json());
            anunciar('Datos del borrador copiados (formato ilustrativo).');
          } catch {
            anunciar('Este navegador no dejó copiar. Usa «Imprimir borrador».', { tipo: 'alerta' });
          }
        },
      }, 'Copiar datos para el PAC'),
    ),
  );
  pintarFactura();
  dlg.showModal();
}

// ——— Mostrador (kiosco) ———
function pintarMostrador() {
  const ordenes = est().kiosco.ordenes.filter((o) => o.pedido.estado !== 'servido' || o.pago.estado === 'pendiente').slice(0, 12);
  pintar(
    $('#lista-mostrador'),
    ordenes.length
      ? h(
          'ul',
          { class: 'panel-lista mostrador__lista' },
          ordenes.map((o) =>
            h(
              'li',
              { class: 'orden' },
              h('span', { class: 'orden__num cifra' }, formatoOrden(o.numero)),
              h('span', { class: 'orden__texto' }, h('strong', {}, o.llevar ? 'Para llevar' : 'Comer aquí'), ` · ${dinero(o.pago.total)} · ${ESTADO_PEDIDO[o.pedido.estado]}`, h('span', { class: 'ayuda' }, ` · ${o.pago.metodo === 'tarjeta' ? 'tarjeta (simulado)' : o.pago.estado === 'pendiente' ? 'paga en caja: pendiente' : 'pagado en caja'}`)),
              h('span', { class: 'fila-botones' },
                o.pago.estado === 'pendiente' ? h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': `kpago-${o.numero}`, onclick: () => hacer({ tipo: 'kiosco-confirmar-pago', datos: { orden: o.numero } }, `Orden ${formatoOrden(o.numero)} pagada.`) }, 'Pago recibido') : null,
                o.pedido.estado === 'listo' ? h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': `kentrega-${o.numero}`, onclick: () => hacer({ tipo: 'kiosco-entregar', datos: { orden: o.numero } }, `Orden ${formatoOrden(o.numero)} entregada.`) }, 'Entregada') : null,
              ),
            ),
          ),
        )
      : h('p', { class: 'vacio' }, 'Sin pedidos del kiosco por cobrar o entregar.'),
  );
}

function pintarCierre() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const hoy = est().historial.filter((x) => x.cerrada >= inicio.getTime() && !x.anulada);
  const ventas = hoy.reduce((s, x) => s + x.total, 0);
  const propinas = hoy.reduce((s, x) => s + x.propinas, 0);
  $('#cierre-dia').textContent = hoy.length
    ? `Hoy, en esta caja: ${plural(hoy.length, 'cuenta cerrada', 'cuentas cerradas')}, ${dinero(ventas)} en ventas con ITBMS y ${dinero(propinas)} en propinas.`
    : 'Hoy no se ha cerrado ninguna cuenta en esta caja todavía.';
}

// ——— Editor del plano ———
function pintarEdicion() {
  const cont = $('#edicion');
  cont.hidden = !ui.editando;
  $('#boton-editar').hidden = ui.editando;
  $('#selector-vista').hidden = ui.editando;
  if (!ui.editando) return pintar(cont);
  const p = ui.borrador;
  const ocup = ocupadas();
  const sel = p.mesas.find((m) => m.id === ui.mesaEditada);
  const cruzadas = p.mesas.filter((m) => cruces(p, m.id).length);
  const aplicarCambio = (r) => {
    if (!r.ok) {
      ui.errorPlano = r.error;
    } else {
      ui.borrador = r.plano;
      ui.errorPlano = '';
    }
    pintarEdicion();
    pintarMesas();
  };
  const zonaNueva = h('select', { id: 'zona-agregar', 'data-foco': 'zona-agregar' }, p.zonas.map((z) => h('option', { value: z.id }, z.nombre)));
  pintar(
    cont,
    h('div', { class: 'edicion' },
      h('p', { class: 'nota' }, icono('mover'), h('span', {}, 'Arrastra las mesas o selecciónalas y muévelas con las flechas (con Mayús, pasos largos). Toca una mesa para cambiar su número, forma, capacidad o zona. Nada se guarda hasta «Guardar plano».')),
      ui.errorPlano ? h('p', { class: 'mensaje-error', role: 'alert' }, ui.errorPlano) : null,
      cruzadas.length ? h('p', { class: 'nota nota--espera' }, icono('alerta'), h('span', {}, `Se cruzan: ${cruzadas.map((m) => `mesa ${m.numero}`).join(', ')}. Sepáralas para que el plano se lea bien.`)) : null,
      sel
        ? h('fieldset', { class: 'edicion__mesa' },
            h('legend', {}, `Mesa ${sel.numero}`),
            h('div', { class: 'edicion__campos' },
              h('div', { class: 'campo' }, h('label', { for: 'ed-numero' }, 'Número'), h('input', { id: 'ed-numero', type: 'number', min: '1', max: '999', value: String(sel.numero), 'data-foco': 'ed-numero', onchange: (ev) => aplicarCambio(cambiarMesa(ui.borrador, sel.id, { numero: Number(ev.target.value) }, ocup)) })),
              h('div', { class: 'campo' }, h('label', { for: 'ed-forma' }, 'Forma'), h('select', { id: 'ed-forma', 'data-foco': 'ed-forma', onchange: (ev) => aplicarCambio(cambiarMesa(ui.borrador, sel.id, { forma: ev.target.value }, ocup)) }, FORMAS.map((f) => h('option', { value: f, selected: sel.forma === f }, f.charAt(0).toUpperCase() + f.slice(1))))),
              h('div', { class: 'campo' }, h('label', { for: 'ed-cap' }, 'Capacidad (personas)'), h('input', { id: 'ed-cap', type: 'number', min: String(CAP_MIN), max: String(CAP_MAX), value: String(sel.capacidad), 'data-foco': 'ed-cap', onchange: (ev) => aplicarCambio(cambiarMesa(ui.borrador, sel.id, { capacidad: Number(ev.target.value) }, ocup)) })),
              h('div', { class: 'campo' }, h('label', { for: 'ed-zona' }, 'Zona'), h('select', { id: 'ed-zona', 'data-foco': 'ed-zona', onchange: (ev) => aplicarCambio(cambiarMesa(ui.borrador, sel.id, { zona: ev.target.value }, ocup)) }, p.zonas.map((z) => h('option', { value: z.id, selected: sel.zona === z.id }, z.nombre)))),
            ),
            h('button', { type: 'button', class: 'boton boton--peligro', 'data-foco': 'ed-quitar', onclick: () => { const r = quitarMesa(ui.borrador, sel.id, ocup); if (r.ok) ui.mesaEditada = null; aplicarCambio(r); } }, icono('basura'), `Quitar la mesa ${sel.numero}`),
          )
        : null,
      h('div', { class: 'edicion__fila' },
        h('div', { class: 'campo campo--en-linea' }, h('label', { for: 'zona-agregar' }, 'Agregar una mesa en'), zonaNueva),
        h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'agregar-mesa', onclick: () => { const r = agregarMesa(ui.borrador, zonaNueva.value, () => `m${generarId(6)}`); if (r.ok) ui.mesaEditada = r.mesa.id; aplicarCambio(r); } }, icono('mas'), 'Agregar mesa'),
      ),
      h('details', { class: 'edicion__zonas' },
        h('summary', {}, 'Zonas del plano'),
        h('ul', { class: 'panel-lista' },
          p.zonas.map((z) =>
            h('li', { class: 'zona-edicion' },
              h('div', { class: 'campo' }, h('label', { for: `zn-${z.id}` }, 'Nombre'), h('input', { id: `zn-${z.id}`, value: z.nombre, maxlength: '30', 'data-foco': `zn-${z.id}`, onchange: (ev) => aplicarCambio(renombrarZona(ui.borrador, z.id, ev.target.value)) })),
              h('div', { class: 'campo' }, h('label', { for: `za-${z.id}` }, `Alto (${ALTO_MIN} a ${ALTO_MAX})`), h('input', { id: `za-${z.id}`, type: 'number', min: String(ALTO_MIN), max: String(ALTO_MAX), value: String(altoZona(p, z.id)), 'data-foco': `za-${z.id}`, onchange: (ev) => aplicarCambio(cambiarAltoZona(ui.borrador, z.id, Number(ev.target.value))) })),
              h('button', { type: 'button', class: 'boton boton--texto', onclick: () => aplicarCambio(quitarZona(ui.borrador, z.id)) }, 'Quitar zona'),
            ),
          ),
        ),
        h('form', { class: 'edicion__fila', onsubmit: (ev) => { ev.preventDefault(); const inp = ev.target.querySelector('input'); const r = agregarZona(ui.borrador, inp.value, () => `z${generarId(6)}`); aplicarCambio(r); } },
          h('div', { class: 'campo campo--en-linea' }, h('label', { for: 'zona-nueva' }, 'Zona nueva'), h('input', { id: 'zona-nueva', maxlength: '30', placeholder: 'Por ejemplo: Patio' })),
          h('button', { type: 'submit', class: 'boton boton--secundario' }, 'Agregar zona'),
        ),
      ),
      h('div', { class: 'fila-botones edicion__guardar' },
        h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'guardar-plano', onclick: guardarPlano }, 'Guardar plano'),
        h('button', { type: 'button', class: 'boton boton--secundario', onclick: salirEdicion }, 'Descartar cambios'),
      ),
    ),
  );
}

async function entrarEdicion() {
  ui.editando = true;
  ui.borrador = structuredClone(est().plano);
  ui.mesaEditada = null;
  ui.errorPlano = '';
  cerrarPanel();
  pintarEdicion();
  pintarMesas();
  $('#edicion .nota')?.scrollIntoView({ block: 'nearest' });
}

async function salirEdicion() {
  const cambio = JSON.stringify(ui.borrador) !== JSON.stringify(est().plano);
  if (cambio && !(await confirmar({ titulo: '¿Descartar los cambios del plano?', texto: 'Lo que moviste o cambiaste desde que abriste el editor se pierde.', aceptar: 'Descartar', peligro: true }))) return;
  ui.editando = false;
  ui.borrador = null;
  pintarEdicion();
  pintarMesas();
  $('#boton-editar').focus();
}

async function guardarPlano() {
  const r = await caja.despachar({ tipo: 'guardar-plano', datos: { plano: ui.borrador } });
  if (r.error) {
    ui.errorPlano = textoError(r.error, 'es', r.detalle);
    pintarEdicion();
    return;
  }
  ui.editando = false;
  ui.borrador = null;
  anunciar('Plano guardado.');
  pintarEdicion();
  pintarMesas();
}

function editarMesa(id) {
  ui.mesaEditada = id;
  pintarEdicion();
  pintarMesas();
}

function moverEstilo(id) {
  const mp = ui.borrador.mesas.find((m) => m.id === id);
  const el = $(`.mesa-tile[data-id="${CSS.escape(id)}"]`);
  if (!mp || !el) return;
  Object.assign(el.style, estiloMesa(mp, altoZona(ui.borrador, mp.zona)));
}

function teclaMesa(ev, id) {
  const paso = pasoTecla(ev.key, ev.shiftKey);
  if (!paso) return;
  ev.preventDefault();
  ui.borrador = moverMesa(ui.borrador, id, paso[0], paso[1]);
  ui.mesaEditada = id;
  moverEstilo(id);
  const mp = ui.borrador.mesas.find((m) => m.id === id);
  $('#anuncio-salon').textContent = `Mesa ${mp.numero}: ${mp.x} a la derecha, ${mp.y} hacia abajo.`;
  clearTimeout(teclaMesa.t);
  teclaMesa.t = setTimeout(() => {
    pintarEdicion();
    pintarMesas();
  }, 350);
}

function empezarArrastre(ev, id) {
  if (ev.button !== 0) return;
  const el = ev.currentTarget;
  const lienzo = el.parentElement;
  const caja2 = lienzo.getBoundingClientRect();
  const mp = ui.borrador.mesas.find((m) => m.id === id);
  const alto = altoZona(ui.borrador, mp.zona);
  const inicio = { x: ev.clientX, y: ev.clientY, mx: mp.x, my: mp.y };
  let movio = false;
  el.setPointerCapture(ev.pointerId);
  el.classList.add('mesa-tile--arrastrando');
  const mover = (e) => {
    const dx = ((e.clientX - inicio.x) / caja2.width) * ANCHO;
    const dy = ((e.clientY - inicio.y) / caja2.height) * alto;
    if (Math.abs(e.clientX - inicio.x) + Math.abs(e.clientY - inicio.y) > 3) movio = true;
    ui.borrador = colocarMesa(ui.borrador, id, inicio.mx + dx, inicio.my + dy);
    moverEstilo(id);
  };
  const soltar = () => {
    el.removeEventListener('pointermove', mover);
    el.removeEventListener('pointerup', soltar);
    el.removeEventListener('pointercancel', soltar);
    el.classList.remove('mesa-tile--arrastrando');
    ui.mesaEditada = id;
    if (movio) {
      pintarEdicion();
      pintarMesas();
      $(`.mesa-tile[data-id="${CSS.escape(id)}"]`)?.focus();
    }
  };
  el.addEventListener('pointermove', mover);
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
}

// ——— Arranque ———
function pintarTodo() {
  pintarPendientes();
  pintarMesas();
  pintarMostrador();
  pintarCierre();
  if (!ui.editando) pintarPanel();
  const dlgF = $('#dlg-factura');
  if (dlgF.open && ui.seleccion === null) dlgF.close();
}

async function iniciar() {
  const r = await arrancarCaja();
  if (!r) return;
  caja = r.caja;
  for (const b of $$('#selector-vista button')) {
    b.addEventListener('click', () => {
      ui.modo = b.dataset.modo;
      escribir('salon-modo', ui.modo);
      pintarMesas();
    });
  }
  $('#boton-editar').addEventListener('click', entrarEdicion);
  $('#dlg-mesa').addEventListener('close', () => {
    if (!matchMedia(ANCHO_PANEL).matches && ui.seleccion !== null) {
      ui.seleccion = null;
      ui.cobro = null;
      pintarMesas();
    }
  });
  matchMedia(ANCHO_PANEL).addEventListener('change', () => pintarPanel());
  caja.suscribir(pintarTodo);
  setInterval(pintarPendientes, 30_000);
  pintarTodo();
  const pedida = Number(new URLSearchParams(location.search).get('m'));
  if (Number.isInteger(pedida) && pedida > 0) seleccionar(pedida);
}

iniciar();
