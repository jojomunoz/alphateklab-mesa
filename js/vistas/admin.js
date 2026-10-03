// admin.html · panel del dueño: carta, mesas y placas QR, NFC y ajustes.

import { $, $$, h, icono, pintar } from '../ui/dom.js';
import { anunciar, confirmar, svgQr } from '../ui/comun.js';
import { arrancarCaja } from '../ui/arranque.js';
import { escribir } from '../ui/almacen.js';
import { formatear, leerMonto, TASAS_ITBMS } from '../nucleo/dinero.mjs';
import { texto, validarCarta } from '../nucleo/carta.mjs';
import { urlMesa, baseDe, cabeEnEtiqueta, generarSala, generarId } from '../nucleo/url.mjs';
import { textoError } from '../nucleo/textos.mjs';

let caja = null;
const PESTANAS = ['carta', 'mesas', 'nfc', 'ajustes'];
const ui = { tab: 'carta', zonaPlacas: '', mesaNfc: 7, nfcEstado: null, bloquear: false, ajustesError: '', cartaError: [] };
const dinero = (c) => formatear(c);
const est = () => caja.estado;
const ESTACIONES = { caliente: 'Cocina caliente', frios: 'Fríos', bar: 'Bar' };
const NOMBRE_TASA = { 7: '7 %: comida y bebidas', 10: '10 %: con alcohol', 0: '0 %: exento' };

async function guardarCarta(nueva, mensaje) {
  const v = validarCarta(nueva);
  if (!v.ok) {
    ui.cartaError = v.errores;
    pintarCarta();
    anunciar('La carta tiene errores; no se guardó.', { tipo: 'alerta' });
    return false;
  }
  const r = await caja.despachar({ tipo: 'guardar-carta', datos: { carta: nueva } });
  if (r.error) {
    ui.cartaError = Array.isArray(r.detalle) ? r.detalle : [textoError(r.error)];
    pintarCarta();
    return false;
  }
  ui.cartaError = [];
  if (mensaje) anunciar(mensaje);
  return true;
}

function copiaCarta() {
  return structuredClone(est().carta);
}

function idDesde(nombre, existentes) {
  const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'plato';
  let id = base;
  while (existentes.has(id)) id = `${base}-${generarId(3)}`;
  return id;
}

// ——— Pestañas ———
function irA(tab, { foco = false } = {}) {
  ui.tab = PESTANAS.includes(tab) ? tab : 'carta';
  if (location.hash !== `#${ui.tab}`) history.replaceState(null, '', `#${ui.tab}`);
  for (const b of $$('[role="tab"]')) {
    const activa = b.dataset.tab === ui.tab;
    b.setAttribute('aria-selected', String(activa));
    b.tabIndex = activa ? 0 : -1;
    if (activa && foco) b.focus();
  }
  for (const t of PESTANAS) $(`#panel-${t}`).hidden = t !== ui.tab;
  pintarPestana();
}

function pintarPestana() {
  if (ui.tab === 'carta') pintarCarta();
  if (ui.tab === 'mesas') pintarMesas();
  if (ui.tab === 'nfc') pintarNfc();
  if (ui.tab === 'ajustes') pintarAjustes();
}

// ——— Carta ———
function pintarCarta() {
  const c = est().carta;
  const panel = $('#panel-carta');
  const archivo = h('input', { type: 'file', accept: 'application/json,.json', id: 'importar-archivo', class: 'visualmente-oculto', tabindex: '-1', 'aria-hidden': 'true', onchange: importar });
  pintar(
    panel,
    h('div', { class: 'admin__intro' },
      h('h2', {}, 'Carta'),
      h('p', { class: 'ayuda' }, 'Los precios son finales, con ITBMS incluido (Ley 473 de 2025): el comensal paga lo que ve. Los cambios se guardan en esta computadora y la carta de las mesas los ve al momento; un plato agotado deja de poder pedirse.'),
    ),
    h('div', { class: 'barra-herramientas' },
      h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'nuevo-plato', onclick: () => editarPlato(null) }, icono('mas'), 'Agregar plato'),
      h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'exportar', onclick: exportar }, 'Exportar la carta (JSON)'),
      h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'importar', onclick: () => archivo.click() }, 'Importar una carta (JSON)'),
      archivo,
    ),
    ui.cartaError.length ? h('div', { class: 'nota nota--alerta', role: 'alert' }, icono('alerta'), h('div', {}, h('p', {}, h('strong', {}, 'No se guardó. Esto hay que corregir:')), h('ul', { class: 'lista' }, ui.cartaError.slice(0, 12).map((e) => h('li', {}, e))))) : null,
    c.categorias.map((cat) => {
      const platos = c.platos.filter((p) => p.cat === cat.id);
      return h('section', { class: 'categoria-admin', 'aria-labelledby': `ca-${cat.id}` },
        h('h3', { id: `ca-${cat.id}` }, texto(cat.nombre), h('span', { class: 'ayuda' }, ` · ${platos.length} ${platos.length === 1 ? 'plato' : 'platos'}`)),
        platos.length
          ? h('ul', { class: 'platos-admin' },
              platos.map((p) =>
                h('li', { class: `plato-admin${p.agotado ? ' plato-admin--agotado' : ''}` },
                  h('div', { class: 'plato-admin__texto' },
                    h('strong', {}, texto(p.nombre, 'es')),
                    h('span', { class: 'ayuda' }, ` · ${texto(p.nombre, 'en')}`),
                    h('p', { class: 'plato-admin__meta' }, `${dinero(p.precio)} · ITBMS ${p.itbms} % · ${ESTACIONES[p.estacion] ?? p.estacion}${p.alergenos.length ? ` · contiene ${p.alergenos.map((a) => texto((c.alergenos ?? []).find((x) => x.id === a)?.nombre) || a).join(', ')}` : ''}${(p.grupos ?? []).length ? ` · opciones: ${p.grupos.map((g) => texto(c.grupos.find((x) => x.id === g)?.nombre) || g).join(', ')}` : ''}`),
                  ),
                  h('button', {
                    type: 'button',
                    class: `interruptor${p.agotado ? ' interruptor--apagado' : ''}`,
                    role: 'switch',
                    'aria-checked': String(!p.agotado),
                    'data-foco': `disp-${p.id}`,
                    'aria-label': `${texto(p.nombre, 'es')}: disponible`,
                    onclick: async () => {
                      const r = await caja.despachar({ tipo: 'agotado', datos: { plato: p.id, agotado: !p.agotado } });
                      if (!r.error) anunciar(`${texto(p.nombre, 'es')}: ${p.agotado ? 'disponible otra vez' : 'agotado'}.`);
                    },
                  }, h('span', { class: 'interruptor__pista', 'aria-hidden': 'true' }), h('span', { class: 'interruptor__texto' }, p.agotado ? 'Agotado' : 'Disponible')),
                  h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': `editar-${p.id}`, 'aria-label': `Editar ${texto(p.nombre, 'es')}`, onclick: () => editarPlato(p.id) }, icono('lapiz'), 'Editar'),
                ),
              ),
            )
          : h('p', { class: 'vacio' }, 'Sin platos en esta categoría.'),
      );
    }),
    editorCategorias(c),
    editorGrupos(c),
  );
}

function editorCategorias(c) {
  return h('details', { class: 'editor-admin' },
    h('summary', {}, 'Categorías y su orden'),
    h('ul', { class: 'lista-editor' },
      c.categorias.map((cat, i) => {
        const usadas = c.platos.filter((p) => p.cat === cat.id).length;
        return h('li', { class: 'fila-editor' },
          h('div', { class: 'campo' }, h('label', { for: `cat-es-${cat.id}` }, 'Nombre'), h('input', { id: `cat-es-${cat.id}`, value: texto(cat.nombre, 'es'), maxlength: '40', onchange: (ev) => { const n = copiaCarta(); n.categorias[i].nombre = { ...n.categorias[i].nombre, es: ev.target.value.trim() }; guardarCarta(n, 'Categoría guardada.'); } })),
          h('div', { class: 'campo' }, h('label', { for: `cat-en-${cat.id}` }, 'En inglés'), h('input', { id: `cat-en-${cat.id}`, value: cat.nombre.en ?? '', maxlength: '40', onchange: (ev) => { const n = copiaCarta(); n.categorias[i].nombre = { ...n.categorias[i].nombre, en: ev.target.value.trim() }; guardarCarta(n, 'Categoría guardada.'); } })),
          h('div', { class: 'fila-botones' },
            h('button', { type: 'button', class: 'boton-icono', 'aria-label': `Subir ${texto(cat.nombre)}`, disabled: i === 0, onclick: () => { const n = copiaCarta(); [n.categorias[i - 1], n.categorias[i]] = [n.categorias[i], n.categorias[i - 1]]; guardarCarta(n, 'Orden guardado.'); } }, icono('atras', 'icono icono--arriba')),
            h('button', { type: 'button', class: 'boton-icono', 'aria-label': `Bajar ${texto(cat.nombre)}`, disabled: i === c.categorias.length - 1, onclick: () => { const n = copiaCarta(); [n.categorias[i + 1], n.categorias[i]] = [n.categorias[i], n.categorias[i + 1]]; guardarCarta(n, 'Orden guardado.'); } }, icono('atras', 'icono icono--abajo')),
            h('button', { type: 'button', class: 'boton boton--texto', disabled: usadas > 0, title: usadas ? 'Primero mueve o quita sus platos' : '', onclick: async () => { if (!(await confirmar({ titulo: `¿Quitar la categoría «${texto(cat.nombre)}»?`, aceptar: 'Quitar', peligro: true }))) return; const n = copiaCarta(); n.categorias.splice(i, 1); guardarCarta(n, 'Categoría quitada.'); } }, usadas ? `Tiene ${usadas} platos` : 'Quitar'),
          ),
        );
      }),
    ),
    h('form', { class: 'fila-editor', onsubmit: (ev) => { ev.preventDefault(); const inp = ev.target.querySelector('input'); const nombre = inp.value.trim(); if (!nombre) return; const n = copiaCarta(); n.categorias.push({ id: idDesde(nombre, new Set(n.categorias.map((x) => x.id))), nombre: { es: nombre, en: '' } }); guardarCarta(n, 'Categoría agregada.'); } },
      h('div', { class: 'campo' }, h('label', { for: 'cat-nueva' }, 'Categoría nueva'), h('input', { id: 'cat-nueva', maxlength: '40', placeholder: 'Por ejemplo: Desayunos' })),
      h('button', { type: 'submit', class: 'boton boton--secundario' }, 'Agregar categoría'),
    ),
  );
}

function editorGrupos(c) {
  return h('details', { class: 'editor-admin' },
    h('summary', {}, 'Opciones de los platos (acompañamiento, término, extras…)'),
    h('p', { class: 'ayuda' }, '«Elige una» obliga a escoger una opción; «varias» deja marcar las que quiera. El precio de una opción se suma al del plato, también con ITBMS incluido.'),
    h('ul', { class: 'lista-editor' },
      c.grupos.map((g, gi) => {
        const usos = c.platos.filter((p) => (p.grupos ?? []).includes(g.id)).length;
        const set = (fn, msg = 'Opciones guardadas.') => { const n = copiaCarta(); fn(n.grupos[gi]); guardarCarta(n, msg); };
        return h('li', { class: 'grupo-admin' },
          h('div', { class: 'fila-editor' },
            h('div', { class: 'campo' }, h('label', { for: `g-es-${g.id}` }, 'Nombre del grupo'), h('input', { id: `g-es-${g.id}`, value: texto(g.nombre, 'es'), maxlength: '40', onchange: (ev) => set((x) => (x.nombre = { ...x.nombre, es: ev.target.value.trim() })) })),
            h('div', { class: 'campo' }, h('label', { for: `g-en-${g.id}` }, 'En inglés'), h('input', { id: `g-en-${g.id}`, value: g.nombre.en ?? '', maxlength: '40', onchange: (ev) => set((x) => (x.nombre = { ...x.nombre, en: ev.target.value.trim() })) })),
            h('div', { class: 'campo' }, h('label', { for: `g-tipo-${g.id}` }, 'Cómo se elige'), h('select', { id: `g-tipo-${g.id}`, onchange: (ev) => set((x) => { x.tipo = ev.target.value; x.obligatorio = ev.target.value === 'uno'; }) }, h('option', { value: 'uno', selected: g.tipo === 'uno' }, 'Elige una (obligatorio)'), h('option', { value: 'varios', selected: g.tipo === 'varios' }, 'Varias (opcional)'))),
          ),
          h('ul', { class: 'opciones-admin' },
            g.opciones.map((o, oi) =>
              h('li', { class: 'fila-editor fila-editor--opcion' },
                h('div', { class: 'campo' }, h('label', { for: `o-es-${g.id}-${o.id}` }, 'Opción'), h('input', { id: `o-es-${g.id}-${o.id}`, value: texto(o.nombre, 'es'), maxlength: '40', onchange: (ev) => set((x) => (x.opciones[oi].nombre = { ...x.opciones[oi].nombre, es: ev.target.value.trim() })) })),
                h('div', { class: 'campo' }, h('label', { for: `o-en-${g.id}-${o.id}` }, 'En inglés'), h('input', { id: `o-en-${g.id}-${o.id}`, value: o.nombre.en ?? '', maxlength: '40', onchange: (ev) => set((x) => (x.opciones[oi].nombre = { ...x.opciones[oi].nombre, en: ev.target.value.trim() })) })),
                h('div', { class: 'campo campo--corto' }, h('label', { for: `o-p-${g.id}-${o.id}` }, 'Suma (B/.)'), h('input', { id: `o-p-${g.id}-${o.id}`, inputmode: 'decimal', value: ((o.precio ?? 0) / 100).toFixed(2), onchange: (ev) => { const m = leerMonto(ev.target.value); if (m === null) { anunciar('Ese precio no se entiende. Escríbelo con números, por ejemplo 1.50.', { tipo: 'alerta' }); return; } set((x) => (x.opciones[oi].precio = m)); } })),
                h('button', { type: 'button', class: 'boton boton--texto', disabled: g.opciones.length <= 1, onclick: () => set((x) => x.opciones.splice(oi, 1), 'Opción quitada.') }, 'Quitar'),
              ),
            ),
          ),
          h('div', { class: 'fila-botones' },
            h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => set((x) => x.opciones.push({ id: idDesde('opcion', new Set(x.opciones.map((y) => y.id))), nombre: { es: 'Opción nueva', en: '' }, precio: 0 }), 'Opción agregada.') }, icono('mas'), 'Agregar opción'),
            h('button', { type: 'button', class: 'boton boton--texto', disabled: usos > 0, onclick: async () => { if (!(await confirmar({ titulo: `¿Quitar el grupo «${texto(g.nombre)}»?`, aceptar: 'Quitar', peligro: true }))) return; const n = copiaCarta(); n.grupos.splice(gi, 1); guardarCarta(n, 'Grupo quitado.'); } }, usos ? `Lo usan ${usos} platos` : 'Quitar el grupo'),
          ),
        );
      }),
    ),
    h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => { const n = copiaCarta(); n.grupos.push({ id: idDesde('grupo', new Set(n.grupos.map((x) => x.id))), nombre: { es: 'Grupo nuevo', en: '' }, tipo: 'uno', obligatorio: true, opciones: [{ id: 'opcion-1', nombre: { es: 'Opción 1', en: '' }, precio: 0 }] }); guardarCarta(n, 'Grupo agregado.'); } }, icono('mas'), 'Agregar un grupo de opciones'),
  );
}

function editarPlato(id) {
  const c = est().carta;
  const p = id ? c.platos.find((x) => x.id === id) : { id: null, cat: c.categorias[0]?.id, nombre: { es: '', en: '' }, desc: { es: '', en: '' }, precio: 0, itbms: 7, estacion: 'caliente', alergenos: [], grupos: [], agotado: false };
  const dlg = $('#dlg-plato');
  const error = h('div', { class: 'mensaje-error', role: 'alert' });
  const campo = (idc, etiqueta, valor, extra = {}) => h('div', { class: 'campo' }, h('label', { for: idc }, etiqueta), h('input', { id: idc, value: valor ?? '', ...extra }));
  const area = (idc, etiqueta, valor) => h('div', { class: 'campo' }, h('label', { for: idc }, etiqueta), h('textarea', { id: idc, rows: '2', maxlength: '160' }, valor ?? ''));
  const form = h(
    'form',
    {
      class: 'hoja__form',
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const nombreEs = f.querySelector('#p-nombre-es').value.trim();
        const precio = leerMonto(f.querySelector('#p-precio').value);
        const problemas = [];
        if (!nombreEs) problemas.push('Escribe el nombre del plato.');
        if (precio === null || precio <= 0) problemas.push('Escribe el precio final con números, por ejemplo 12.50.');
        if (problemas.length) {
          pintar(error, h('ul', {}, problemas.map((x) => h('li', {}, x))));
          (nombreEs ? f.querySelector('#p-precio') : f.querySelector('#p-nombre-es')).focus();
          return;
        }
        const n = copiaCarta();
        const nuevo = {
          ...p,
          id: p.id ?? idDesde(nombreEs, new Set(n.platos.map((x) => x.id))),
          cat: f.querySelector('#p-cat').value,
          nombre: { es: nombreEs, en: f.querySelector('#p-nombre-en').value.trim() },
          desc: { es: f.querySelector('#p-desc-es').value.trim(), en: f.querySelector('#p-desc-en').value.trim() },
          precio,
          itbms: Number(f.querySelector('#p-itbms').value),
          estacion: f.querySelector('#p-estacion').value,
          alergenos: [...f.querySelectorAll('[name="alergeno"]:checked')].map((x) => x.value),
          grupos: [...f.querySelectorAll('[name="grupo"]:checked')].map((x) => x.value),
          agotado: f.querySelector('#p-agotado').checked,
        };
        const i = n.platos.findIndex((x) => x.id === p.id);
        if (i >= 0) n.platos[i] = nuevo;
        else n.platos.push(nuevo);
        if (await guardarCarta(n, p.id ? 'Plato guardado.' : 'Plato agregado.')) dlg.close();
        else pintar(error, h('ul', {}, ui.cartaError.map((x) => h('li', {}, x))));
      },
    },
    h('div', { class: 'hoja__cuerpo' },
      h('div', { class: 'dos-columnas' }, campo('p-nombre-es', 'Nombre', p.nombre.es, { maxlength: '60', required: true }), campo('p-nombre-en', 'Nombre en inglés', p.nombre.en, { maxlength: '60' })),
      h('div', { class: 'dos-columnas' }, area('p-desc-es', 'Descripción', p.desc?.es), area('p-desc-en', 'Descripción en inglés', p.desc?.en)),
      h('div', { class: 'dos-columnas' },
        h('div', { class: 'campo' }, h('label', { for: 'p-cat' }, 'Categoría'), h('select', { id: 'p-cat' }, c.categorias.map((x) => h('option', { value: x.id, selected: x.id === p.cat }, texto(x.nombre))))),
        campo('p-precio', 'Precio final (B/., con ITBMS)', p.precio ? (p.precio / 100).toFixed(2) : '', { inputmode: 'decimal', 'aria-describedby': 'p-precio-ayuda' }),
      ),
      h('p', { class: 'ayuda', id: 'p-precio-ayuda' }, 'Es lo que paga el comensal. La cuenta calcula el ITBMS que va adentro: precio × tasa ÷ (100 + tasa).'),
      h('div', { class: 'dos-columnas' },
        h('div', { class: 'campo' }, h('label', { for: 'p-itbms' }, 'Tasa de ITBMS'), h('select', { id: 'p-itbms' }, TASAS_ITBMS.slice().sort((a, b) => (a === 0) - (b === 0) || a - b).map((t) => h('option', { value: String(t), selected: t === p.itbms }, NOMBRE_TASA[t])))),
        h('div', { class: 'campo' }, h('label', { for: 'p-estacion' }, 'Va a la estación'), h('select', { id: 'p-estacion' }, Object.entries(ESTACIONES).map(([v, n]) => h('option', { value: v, selected: v === p.estacion }, n)))),
      ),
      h('fieldset', { class: 'casillas' }, h('legend', {}, 'Alérgenos'), h('div', { class: 'casillas__lista' }, (c.alergenos ?? []).map((a) => h('label', { class: 'opcion opcion--compacta' }, h('input', { type: 'checkbox', name: 'alergeno', value: a.id, checked: p.alergenos.includes(a.id) }), h('span', {}, texto(a.nombre)))))),
      h('fieldset', { class: 'casillas' }, h('legend', {}, 'Opciones que se eligen al pedirlo'), h('div', { class: 'casillas__lista' }, c.grupos.map((g) => h('label', { class: 'opcion opcion--compacta' }, h('input', { type: 'checkbox', name: 'grupo', value: g.id, checked: (p.grupos ?? []).includes(g.id) }), h('span', {}, `${texto(g.nombre)} (${g.opciones.map((o) => texto(o.nombre)).join(', ')})`))))),
      h('label', { class: 'opcion' }, h('input', { type: 'checkbox', id: 'p-agotado', checked: p.agotado }), h('span', { class: 'opcion__texto' }, 'Agotado hoy (no se puede pedir)')),
    ),
    h('div', { class: 'hoja__pie' },
      error,
      h('div', { class: 'fila-botones' },
        h('button', { type: 'submit', class: 'boton boton--primario' }, p.id ? 'Guardar plato' : 'Agregar plato'),
        h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => dlg.close() }, 'Cancelar'),
        p.id ? h('button', { type: 'button', class: 'boton boton--peligro', onclick: async () => { if (!(await confirmar({ titulo: `¿Quitar «${texto(p.nombre)}» de la carta?`, texto: 'Los pedidos que ya lo tienen no cambian.', aceptar: 'Quitar plato', peligro: true }))) return; const n = copiaCarta(); n.platos = n.platos.filter((x) => x.id !== p.id); if (await guardarCarta(n, 'Plato quitado.')) dlg.close(); } }, icono('basura'), 'Quitar') : null,
      ),
    ),
  );
  pintar(dlg, h('div', { class: 'hoja__cabeza' }, h('h2', { id: 'dlg-plato-titulo' }, p.id ? `Editar: ${texto(p.nombre)}` : 'Plato nuevo'), h('button', { type: 'button', class: 'boton-icono', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, icono('x'))), form);
  dlg.showModal();
  dlg.querySelector('#p-nombre-es').focus();
}

function exportar() {
  const blob = new Blob([JSON.stringify(est().carta, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `carta-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  anunciar('Carta exportada.');
}

async function importar(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  let datos;
  try {
    datos = JSON.parse(await f.text());
  } catch {
    ui.cartaError = ['El archivo no es un JSON válido.'];
    pintarCarta();
    return;
  }
  const v = validarCarta(datos);
  if (!v.ok) {
    ui.cartaError = v.errores;
    pintarCarta();
    return;
  }
  if (!(await confirmar({ titulo: '¿Reemplazar la carta?', texto: `La carta del archivo tiene ${datos.platos.length} platos en ${datos.categorias.length} categorías. Reemplaza la actual en esta computadora.`, aceptar: 'Reemplazar' }))) return;
  await guardarCarta(datos, 'Carta importada.');
}

// ——— Mesas y placas ———
async function pintarMesas() {
  const p = est().plano;
  const base = baseDe(location.href);
  const sala = caja.sala;
  const mesas = p.mesas.filter((m) => !ui.zonaPlacas || m.zona === ui.zonaPlacas).sort((a, b) => a.numero - b.numero);
  const conPin = est().ajustes.pin;
  const hoja = h('div', { class: 'hoja-placas', 'aria-label': 'Vista previa de las placas' });
  const zonas = h('select', { id: 'zona-placas', 'data-foco': 'zona-placas', onchange: (ev) => { ui.zonaPlacas = ev.target.value; pintarMesas(); } }, h('option', { value: '' }, 'Todas las mesas'), p.zonas.map((z) => h('option', { value: z.id, selected: ui.zonaPlacas === z.id }, z.nombre)));
  pintar(
    $('#panel-mesas'),
    h('div', { class: 'admin__intro' },
      h('h2', {}, 'Mesas y placas QR'),
      h('p', { class: 'ayuda' }, `Cada mesa tiene su dirección; el QR y la etiqueta NFC de su placa llevan esa misma dirección. Las mesas se agregan o mueven en el editor del plano del salón. Código de sala de esta computadora: ${sala}.`),
    ),
    h('div', { class: 'barra-herramientas' },
      h('div', { class: 'campo campo--en-linea' }, h('label', { for: 'zona-placas' }, 'Imprimir'), zonas),
      h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'imprimir', onclick: () => { document.body.classList.add('imprimiendo-placas'); print(); document.body.classList.remove('imprimiendo-placas'); } }, icono('imprimir'), `Imprimir ${mesas.length} ${mesas.length === 1 ? 'placa' : 'placas'}`),
      h('a', { class: 'boton boton--secundario', href: 'salon.html' }, 'Editar el plano'),
    ),
    h('div', { class: 'tabla-scroll' },
      h('table', { class: 'tabla' },
        h('caption', { class: 'visualmente-oculto' }, 'Mesas con su dirección'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Mesa'), h('th', { scope: 'col' }, 'Zona'), h('th', { scope: 'col' }, 'Dirección'), conPin ? h('th', { scope: 'col' }, 'PIN') : null, h('th', { scope: 'col' }, h('span', { class: 'visualmente-oculto' }, 'Acciones')))),
        h('tbody', {},
          mesas.map((m) => {
            const url = urlMesa(base, sala, m.numero);
            return h('tr', {},
              h('th', { scope: 'row', class: 'cifra' }, String(m.numero)),
              h('td', {}, p.zonas.find((z) => z.id === m.zona)?.nombre ?? ''),
              h('td', { class: 'tabla__url' }, h('a', { href: url }, url.replace(/^https?:\/\//, ''))),
              conPin ? h('td', { class: 'cifra' }, m.pin) : null,
              h('td', {}, h('button', { type: 'button', class: 'boton boton--texto', onclick: () => copiar(url, `Dirección de la mesa ${m.numero} copiada.`) }, icono('enlace'), 'Copiar')),
            );
          }),
        ),
      ),
    ),
    h('details', { class: 'editor-admin', open: true },
      h('summary', {}, 'Cómo instalar las placas'),
      h('ul', { class: 'lista' },
        h('li', {}, 'Imprime en hoja carta: salen cuatro placas por hoja, una por cuarto. El QR va con margen blanco y nivel de corrección Q, así se lee aunque se raye un poco.'),
        h('li', {}, 'Atorníllalas o mételas en acrílico o laminado que deje marca si alguien pega otro QR encima (el fraude de «QR falso» existe). Que alguien del personal mire las placas al abrir cada turno.'),
        h('li', {}, 'En producción, el QR apunta al dominio del restaurante, no a un servidor de terceros: el comensal ve un nombre que reconoce.'),
        h('li', {}, 'Prueba cada placa con un iPhone y un Android antes de dejarla en la mesa.'),
      ),
    ),
    h('h3', { class: 'admin__subtitulo' }, 'Vista previa'),
    hoja,
  );
  const dominio = new URL(base);
  for (const m of mesas) {
    const url = urlMesa(base, sala, m.numero);
    const placa = h('article', { class: 'placa-impresa' },
      h('p', { class: 'placa-impresa__local' }, icono('pixbae', 'placa-impresa__marca'), est().ajustes.nombre, h('span', {}, 'restaurante de ejemplo')),
      h('p', { class: 'placa-impresa__mesa' }, 'Mesa', h('strong', { class: 'cifra' }, String(m.numero))),
      h('div', { class: 'placa-impresa__qr' }),
      h('p', { class: 'placa-impresa__instruccion' }, 'Escanea o acerca tu teléfono', h('span', { lang: 'en' }, 'Scan or tap your phone')),
      h('p', { class: 'placa-impresa__dominio' }, `${dominio.host}${dominio.pathname}`),
      conPin ? h('p', { class: 'placa-impresa__pin cifra' }, `PIN de la mesa: ${m.pin}`) : null,
    );
    hoja.append(placa);
    try {
      placa.querySelector('.placa-impresa__qr').append(await svgQr(url, { nivel: 'Q', titulo: `QR de la mesa ${m.numero}` }));
    } catch {
      placa.querySelector('.placa-impresa__qr').append(h('p', { class: 'ayuda' }, 'Sin conexión: no se pudo cargar el generador de QR.'));
    }
  }
}

async function copiar(textoACopiar, mensaje) {
  try {
    await navigator.clipboard.writeText(textoACopiar);
    anunciar(mensaje);
  } catch {
    anunciar('Este navegador no dejó copiar. Selecciona la dirección y cópiala a mano.', { tipo: 'alerta' });
  }
}

// ——— NFC ———
function pintarNfc() {
  const p = est().plano;
  const soporta = 'NDEFReader' in window;
  const url = urlMesa(baseDe(location.href), caja.sala, ui.mesaNfc);
  const cabe = cabeEnEtiqueta(url, 'NTAG213');
  const estado = ui.nfcEstado;
  const mesas = p.mesas.slice().sort((a, b) => a.numero - b.numero);
  if (!mesas.some((m) => m.numero === ui.mesaNfc)) ui.mesaNfc = mesas[0]?.numero ?? 1;
  pintar(
    $('#panel-nfc'),
    h('div', { class: 'admin__intro' },
      h('h2', { id: 'nfc' }, 'Etiquetas NFC'),
      h('p', { class: 'ayuda' }, 'La etiqueta de la placa guarda la misma dirección que el QR. El comensal acerca el teléfono y se abre la carta de su mesa, sin abrir la cámara. Los iPhone XS y posteriores la leen sin app; en Android hace falta tener el NFC encendido.'),
    ),
    h('div', { class: 'campo campo--en-linea' }, h('label', { for: 'mesa-nfc' }, 'Mesa'), h('select', { id: 'mesa-nfc', 'data-foco': 'mesa-nfc', onchange: (ev) => { ui.mesaNfc = Number(ev.target.value); ui.nfcEstado = null; pintarNfc(); } }, mesas.map((m) => h('option', { value: String(m.numero), selected: m.numero === ui.mesaNfc }, `Mesa ${m.numero}`)))),
    h('p', { class: 'nfc__url' }, h('a', { href: url }, url), ' ', h('button', { type: 'button', class: 'boton boton--texto', onclick: () => copiar(url, 'Dirección copiada.') }, icono('enlace'), 'Copiar')),
    h('p', { class: `nota ${cabe.cabe ? 'nota--ok' : 'nota--alerta'}` }, icono(cabe.cabe ? 'check' : 'alerta'), h('span', {}, cabe.cabe ? `Ocupa ${cabe.bytes} de los ${cabe.capacidad} bytes de una NTAG213: cabe.` : `Ocupa ${cabe.bytes} bytes y una NTAG213 tiene ${cabe.capacidad}: usa una NTAG215 o acorta la dirección.`)),
    soporta
      ? h('div', { class: 'nfc__grabar' },
          h('label', { class: 'opcion' }, h('input', { type: 'checkbox', id: 'nfc-bloquear', checked: ui.bloquear, onchange: (ev) => (ui.bloquear = ev.target.checked) }), h('span', { class: 'opcion__texto' }, 'Bloquear la etiqueta después de grabarla. ', h('strong', {}, 'No se puede deshacer:'), ' nadie podrá cambiar la dirección, ni tú.')),
          h('div', { class: 'fila-botones' },
            h('button', { type: 'button', class: 'boton boton--primario', 'data-foco': 'nfc-grabar', disabled: estado?.tipo === 'esperando', onclick: grabarNfc }, icono('nfc'), `Grabar la mesa ${ui.mesaNfc} en una etiqueta`),
            h('button', { type: 'button', class: 'boton boton--secundario', 'data-foco': 'nfc-leer', disabled: estado?.tipo === 'esperando', onclick: leerNfc }, 'Leer una etiqueta para comprobarla'),
          ),
        )
      : h('div', { class: 'nota nota--espera' }, icono('info'), h('div', {},
          h('p', {}, h('strong', {}, 'Este navegador no puede grabar etiquetas NFC.'), ' Web NFC funciona solo en Chrome para Android (versión 89 o más), en una página con https y después de un toque en un botón. Desde aquí puedes copiar la dirección y grabarla con una app gratuita:'),
          h('ol', { class: 'lista' },
            h('li', {}, 'Instala NFC Tools (Android o iPhone).'),
            h('li', {}, 'Abre «Escribir» → «Agregar un registro» → «URL / URI».'),
            h('li', {}, 'Pega la dirección de la mesa (botón «Copiar» de arriba).'),
            h('li', {}, 'Toca «Escribir» y acerca la etiqueta a la parte de atrás del teléfono.'),
            h('li', {}, 'Si quieres bloquearla: «Otros» → «Bloquear la etiqueta». Es irreversible.'),
          ),
        )),
    estado ? h('p', { class: `nota ${estado.tipo === 'ok' ? 'nota--ok' : estado.tipo === 'error' ? 'nota--alerta' : 'nota--espera'}`, role: 'status' }, icono(estado.tipo === 'ok' ? 'check' : estado.tipo === 'error' ? 'alerta' : 'nfc'), h('span', {}, estado.texto)) : null,
    h('details', { class: 'editor-admin' },
      h('summary', {}, 'Qué etiqueta comprar'),
      h('ul', { class: 'lista' },
        h('li', {}, 'NTAG213 (144 bytes) alcanza para la dirección de una mesa si es corta, como esta. Es la más barata.'),
        h('li', {}, 'Para producción: NTAG 424 DNA con SUN. En cada toque genera una dirección distinta, firmada, que el servidor del restaurante verifica: prueba que el teléfono está en la mesa y no se puede copiar con una foto. Necesita ese servidor; esta demo no lo tiene.'),
      ),
    ),
  );
}

async function grabarNfc() {
  const url = urlMesa(baseDe(location.href), caja.sala, ui.mesaNfc);
  const n = ui.mesaNfc;
  if (ui.bloquear && !(await confirmar({ titulo: `¿Grabar y bloquear la etiqueta de la mesa ${n}?`, texto: 'Después de bloquearla nadie puede cambiar su dirección. Si el dominio del restaurante cambia, habrá que cambiar la etiqueta.', aceptar: 'Grabar y bloquear', peligro: true }))) return;
  ui.nfcEstado = { tipo: 'esperando', texto: 'Acerca la etiqueta a la parte de atrás del teléfono y no la muevas…' };
  pintarNfc();
  try {
    const lector = new window.NDEFReader();
    await lector.write({ records: [{ recordType: 'url', data: url }] });
    if (ui.bloquear) {
      if (typeof lector.makeReadOnly !== 'function') throw Object.assign(new Error('Este Chrome no puede bloquear etiquetas (hace falta la versión 100 o más). Quedó grabada sin bloquear.'), { name: 'SinBloqueo' });
      ui.nfcEstado = { tipo: 'esperando', texto: 'Grabada. Ahora acércala otra vez para bloquearla…' };
      pintarNfc();
      await lector.makeReadOnly();
      ui.nfcEstado = { tipo: 'ok', texto: `Listo: la etiqueta abre la mesa ${n} y quedó bloqueada.` };
    } else {
      ui.nfcEstado = { tipo: 'ok', texto: `Listo: la etiqueta abre la mesa ${n}. Pruébala con un teléfono.` };
    }
  } catch (e) {
    const textos = {
      NotAllowedError: 'El navegador no dio permiso para usar NFC. Acéptalo cuando lo pregunte.',
      NotSupportedError: 'Este teléfono no tiene NFC o está apagado. Enciéndelo en los ajustes.',
      NetworkError: 'La etiqueta se alejó antes de terminar. Vuelve a intentarlo sin moverla.',
      NotReadableError: 'No se pudo leer la etiqueta. Prueba con otra.',
      AbortError: 'Se canceló la grabación.',
    };
    ui.nfcEstado = { tipo: 'error', texto: textos[e.name] ?? e.message ?? 'No se pudo grabar la etiqueta.' };
  }
  pintarNfc();
}

async function leerNfc() {
  ui.nfcEstado = { tipo: 'esperando', texto: 'Acerca una etiqueta para leerla…' };
  pintarNfc();
  try {
    const lector = new window.NDEFReader();
    const ctrl = new AbortController();
    await lector.scan({ signal: ctrl.signal });
    lector.onreading = (ev) => {
      const r = ev.message.records.find((x) => x.recordType === 'url');
      const valor = r ? new TextDecoder().decode(r.data) : null;
      ui.nfcEstado = valor ? { tipo: 'ok', texto: `La etiqueta abre: ${valor}` } : { tipo: 'error', texto: 'La etiqueta no tiene una dirección (registro URL).' };
      ctrl.abort();
      pintarNfc();
    };
    lector.onreadingerror = () => {
      ui.nfcEstado = { tipo: 'error', texto: 'No se pudo leer esa etiqueta. Prueba otra vez.' };
      pintarNfc();
    };
  } catch (e) {
    ui.nfcEstado = { tipo: 'error', texto: e.name === 'NotAllowedError' ? 'El navegador no dio permiso para usar NFC.' : 'No se pudo empezar a leer.' };
    pintarNfc();
  }
}

// ——— Ajustes ———
function pintarAjustes() {
  const a = est().ajustes;
  const form = h(
    'form',
    {
      class: 'ajustes',
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const propinas = [0, 1, 2].map((i) => Number(f.querySelector(`#propina-${i}`).value));
        const r = await caja.despachar({ tipo: 'guardar-ajustes', datos: { ajustes: { nombre: f.querySelector('#aj-nombre').value, propinas, aprobacion: f.querySelector('[name="aprobacion"]:checked')?.value, tipoLocal: f.querySelector('[name="tipo-local"]:checked')?.value, pin: f.querySelector('#aj-pin').checked, resena: f.querySelector('#aj-resena').value } } });
        ui.ajustesError = r.error ? textoError(r.error, 'es', r.detalle) : '';
        pintarAjustes();
        if (!r.error) anunciar('Ajustes guardados. Los teléfonos de las mesas los ven al momento.');
        else $('#ajustes-error')?.focus();
      },
    },
    h('div', { class: 'admin__intro' }, h('h2', {}, 'Ajustes')),
    ui.ajustesError ? h('p', { class: 'mensaje-error', id: 'ajustes-error', role: 'alert', tabindex: '-1' }, ui.ajustesError) : null,
    h('div', { class: 'campo' }, h('label', { for: 'aj-nombre' }, 'Nombre del local'), h('input', { id: 'aj-nombre', value: a.nombre, maxlength: '60' })),
    h('div', { class: 'campo' }, h('span', { class: 'etiqueta' }, 'Moneda'), h('p', {}, 'B/. (balboa, a la par con el dólar). Precios en la carta con ITBMS incluido.')),
    h('fieldset', { class: 'ajustes__grupo' },
      h('legend', {}, 'Propinas sugeridas (%)'),
      h('p', { class: 'ayuda' }, 'Aparecen en este orden y ninguna va marcada: el comensal elige, o pone otra cifra, o ninguna. La primera es la costumbre panameña (10 %). La propina es voluntaria (ACODECO, mayo de 2026).'),
      h('div', { class: 'propinas-ajuste' }, [0, 1, 2].map((i) => h('div', { class: 'campo' }, h('label', { for: `propina-${i}` }, `Opción ${i + 1}`), h('input', { id: `propina-${i}`, type: 'number', min: '1', max: '50', value: String(a.propinas[i]) })))),
    ),
    h('fieldset', { class: 'ajustes__grupo' },
      h('legend', {}, 'Tipo de local (decide el ITBMS)'),
      h('p', { class: 'ayuda', id: 'aj-tipo-ayuda' }, 'Según la DGI, los restaurantes con comida preparada cobran 7 % y las bebidas alcohólicas 10 %; las fondas y los restaurantes de comida rápida no cobran ITBMS. ', h('a', { href: 'https://dgi.mef.gob.pa/itbms/Generalidades', rel: 'noopener', target: '_blank' }, 'Ver la tabla de la DGI'), '. El precio de la carta no cambia: cambia el impuesto que lleva adentro. Aplica a los pedidos nuevos.'),
      h('div', { class: 'grupo__opciones' },
        [
          ['restaurante', 'Restaurante (ITBMS 7 % y 10 % en alcohol)', 'Comida y bebidas sin alcohol al 7 %; cerveza, ron y demás al 10 %.'],
          ['fonda', 'Fonda o comida rápida (sin ITBMS en la comida)', 'La comida y las bebidas sin alcohol van sin ITBMS. Las alcohólicas siguen al 10 %: confírmalo con tu contador.'],
        ].map(([v, t, d]) => h('label', { class: 'opcion opcion--doble' }, h('input', { type: 'radio', name: 'tipo-local', value: v, checked: (a.tipoLocal ?? 'restaurante') === v, 'aria-describedby': 'aj-tipo-ayuda' }), h('span', { class: 'opcion__texto' }, h('strong', {}, t), h('span', { class: 'ayuda' }, d)))),
      ),
    ),
    h('fieldset', { class: 'ajustes__grupo' },
      h('legend', {}, 'Pedidos por QR'),
      h('div', { class: 'grupo__opciones' },
        [
          ['todos', 'El mesero acepta cada pedido antes de que pase a cocina (recomendado)', 'Frena los pedidos hechos desde fuera del local con la foto de un QR.'],
          ['primero', 'El mesero acepta solo el primer pedido de cada mesa', 'Las rondas siguientes de esa cuenta van directo a cocina.'],
          ['ninguno', 'Directo a cocina, sin aprobación', 'Solo si las placas tienen otra protección (PIN o NFC con firma).'],
        ].map(([v, t, d]) => h('label', { class: 'opcion opcion--doble' }, h('input', { type: 'radio', name: 'aprobacion', value: v, checked: a.aprobacion === v }), h('span', { class: 'opcion__texto' }, h('strong', {}, t), h('span', { class: 'ayuda' }, d)))),
      ),
    ),
    h('label', { class: 'opcion opcion--doble' }, h('input', { type: 'checkbox', id: 'aj-pin', checked: a.pin }), h('span', { class: 'opcion__texto' }, h('strong', {}, 'Pedir el PIN de la mesa'), h('span', { class: 'ayuda' }, 'Cada placa lleva impreso un PIN de 3 números; el teléfono lo pide antes del primer pedido. Si lo enciendes, vuelve a imprimir las placas.'))),
    h('div', { class: 'campo' }, h('label', { for: 'aj-resena' }, 'Enlace para dejar una reseña en Google (opcional)'), h('input', { id: 'aj-resena', type: 'url', value: a.resena, placeholder: 'https://g.page/r/…', 'aria-describedby': 'aj-resena-ayuda' }), h('p', { class: 'ayuda', id: 'aj-resena-ayuda' }, 'Se lo mostramos al comensal después de pagar. Sin enlace, la pantalla explica que ahí iría el del local.')),
    h('div', { class: 'fila-botones' }, h('button', { type: 'submit', class: 'boton boton--primario' }, 'Guardar ajustes')),
  );
  pintar(
    $('#panel-ajustes'),
    form,
    h('section', { class: 'admin__bloque', 'aria-labelledby': 'h-pago' },
      h('h3', { id: 'h-pago' }, 'Cómo se cobra de verdad'),
      h('p', {}, 'En esta demo no hay pasarela: el pago es simulado y la caja lo confirma a mano. Con un cliente real hay dos caminos:'),
      h('ul', { class: 'lista' },
        h('li', {}, h('strong', {}, 'Sin servidor: '), 'la cuenta muestra el QR estático de Yappy Comercial del local y el monto exacto. El cajero ve cada pago en su app y pulsa «Pago recibido». Yappy le cobra al local 1 % + ITBMS; al comensal, nada.'),
        h('li', {}, h('strong', {}, 'Con servidor: '), 'botón de pago de Yappy por API, o enlace de pago de Tilopay para tarjeta (3,75 % + B/. 0.50 por cobro) con webhook. La mesa pasa a «pagada» cuando llega la confirmación de la pasarela, nunca antes.'),
      ),
    ),
    h('section', { class: 'admin__bloque', 'aria-labelledby': 'h-sala' },
      h('h3', { id: 'h-sala' }, 'Código de sala'),
      h('p', {}, `Esta computadora usa la sala ${caja.sala}. Va en la dirección de cada mesa y en el tema del relevo (atk-mesa-${caja.sala}).`),
      h('p', { class: 'ayuda' }, 'Cámbialo si alguien de fuera lo conoce. Las placas impresas con el código viejo dejan de funcionar y se borran los datos de esta computadora.'),
      h('button', { type: 'button', class: 'boton boton--peligro', onclick: cambiarSala }, 'Cambiar el código de sala'),
    ),
  );
}

async function cambiarSala() {
  if (!(await confirmar({ titulo: '¿Cambiar el código de sala?', texto: 'Las placas y etiquetas grabadas con el código actual dejan de servir, y se borran los pedidos y cambios de esta computadora.', aceptar: 'Cambiar código', peligro: true }))) return;
  escribir('sala', generarSala());
  location.reload();
}

async function iniciar() {
  const r = await arrancarCaja();
  if (!r) return;
  caja = r.caja;
  const tabs = $$('[role="tab"]');
  for (const t of tabs) {
    t.addEventListener('click', () => irA(t.dataset.tab));
    t.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(t);
      const j = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[ev.key];
      if (j !== undefined) {
        ev.preventDefault();
        irA(tabs[j].dataset.tab, { foco: true });
      }
    });
  }
  addEventListener('hashchange', () => irA(location.hash.slice(1)));
  // Firma de lo que pinta cada pestaña: así un pedido en otra pestaña no regenera los QR ni borra lo que se escribe.
  const firma = (e) => ({
    carta: JSON.stringify(e.carta) + e.ajustes.nombre,
    mesas: JSON.stringify([e.plano, e.ajustes.pin, e.ajustes.nombre, e.sala]),
    nfc: JSON.stringify(e.plano.mesas.map((m) => m.numero)),
    ajustes: JSON.stringify(e.ajustes),
  });
  let antes = firma(est());
  caja.suscribir((estado) => {
    $('#nombre-local').textContent = `${estado.ajustes.nombre} (ejemplo)`;
    const ahora = firma(estado);
    const cambio = ahora[ui.tab] !== antes[ui.tab];
    antes = ahora;
    if (cambio && !$('#dlg-plato').open) pintarPestana();
  });
  $('#nombre-local').textContent = `${est().ajustes.nombre} (ejemplo)`;
  irA(location.hash.slice(1) || 'carta');
}

iniciar();
