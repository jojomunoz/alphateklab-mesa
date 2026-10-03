// Piezas que comparten todas las vistas: barra de la demo, confirmaciones, avisos breves, QR y sonido.

import { h, icono, $ } from './dom.js';
import { urlMesa, baseDe } from '../nucleo/url.mjs';
import { fotoPlato, ANCHOS_FOTO } from '../nucleo/carta.mjs';

/**
 * Foto de un plato con sus tres anchos (el navegador elige según `sizes` y la densidad de la pantalla), o null si el
 * plato no tiene. Va con alt vacío: el nombre del plato ya está escrito al lado.
 */
export function imgPlato(p, { clase, sizes, ancho = 480, carga = 'lazy' } = {}) {
  const src = fotoPlato(p, ancho);
  if (!src) return null;
  return h('img', {
    class: clase,
    src,
    srcset: ANCHOS_FOTO.map((w) => `${fotoPlato(p, w)} ${w}w`).join(', '),
    sizes,
    width: String(ancho),
    height: String(ancho),
    alt: '',
    loading: carga,
    decoding: 'async',
  });
}

/** Avisos breves con región viva para lectores de pantalla. */
let zonaAvisos = null;
let regionViva = null;
export function anunciar(texto, { tipo = 'normal', duracion = 4200 } = {}) {
  if (!zonaAvisos) {
    zonaAvisos = h('div', { class: 'avisos-breves' });
    regionViva = h('div', { class: 'visualmente-oculto', 'aria-live': 'polite', role: 'status' });
    document.body.append(zonaAvisos, regionViva);
  }
  const el = h('p', { class: `aviso-breve${tipo === 'alerta' ? ' aviso-breve--alerta' : ''}` }, texto);
  zonaAvisos.append(el);
  while (zonaAvisos.children.length > 2) zonaAvisos.firstElementChild.remove();
  regionViva.textContent = '';
  requestAnimationFrame(() => {
    regionViva.textContent = texto;
  });
  setTimeout(() => el.remove(), duracion);
}

/** Confirmación con <dialog> nativo. Devuelve una promesa con true/false. */
export function confirmar({ titulo, texto, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise((resolver) => {
    const dlg = h(
      'dialog',
      { class: 'dialogo-confirmar', 'aria-labelledby': 'confirmar-titulo' },
      h('h2', { id: 'confirmar-titulo' }, titulo),
      texto ? h('p', {}, texto) : null,
      h(
        'div',
        { class: 'dialogo-confirmar__botones' },
        h('button', { type: 'button', class: 'boton boton--secundario', value: 'no', onclick: () => cerrar(false) }, cancelar),
        h('button', { type: 'button', class: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`, onclick: () => cerrar(true) }, aceptar),
      ),
    );
    function cerrar(v) {
      dlg.close();
      dlg.remove();
      resolver(v);
    }
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      cerrar(false);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Prepara la barra de la demo que ya está en el HTML: marca la vista actual, pone la sala en el enlace de la
 * mesa 7 y engancha «Restablecer datos de ejemplo».
 */
export function prepararBarra({ sala = null, alRestablecer = null, textoRestablecer } = {}) {
  const barra = $('.barra-demo');
  if (!barra) return;
  const actual = location.pathname.split('/').pop() || 'index.html';
  for (const a of barra.querySelectorAll('nav a')) {
    const destino = a.getAttribute('href').split('?')[0];
    if (destino === actual) a.setAttribute('aria-current', 'page');
    if (destino === 'mesa.html' && sala) a.href = urlMesa(baseDe(location.href), sala, 7);
  }
  const boton = barra.querySelector('[data-restablecer]');
  if (boton && alRestablecer) {
    boton.hidden = false;
    boton.addEventListener('click', async () => {
      const ok = await confirmar({
        titulo: '¿Restablecer los datos de ejemplo?',
        texto: textoRestablecer ?? 'Se borran los pedidos, cuentas y cambios guardados en este navegador y vuelve el servicio de ejemplo de Pixbae. El código de sala no cambia.',
        aceptar: 'Restablecer',
        peligro: true,
      });
      if (ok) {
        await alRestablecer();
        anunciar('Datos de ejemplo restablecidos.');
      }
    });
  }
}

/** Texto e indicador de la conexión con el relevo. */
export function pintarConexion(el, { estado, segundos }, textos = {}) {
  if (!el) return;
  const t = {
    local: 'Solo en este navegador',
    conectando: 'Relevo entre dispositivos: conectando…',
    conectado: 'Relevo entre dispositivos: conectado',
    'sin-conexion': `Relevo entre dispositivos: sin conexión, reintentando en ${segundos} s`,
    ...textos,
  };
  el.dataset.estado = estado;
  el.textContent = typeof t[estado] === 'function' ? t[estado](segundos) : t[estado] ?? estado;
}

/** qrcode-generator 1.4.4 (MIT) desde jsDelivr, con integridad. Se carga solo donde hace falta un QR. */
let qrPromesa = null;
export function cargarQr() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  if (!qrPromesa) {
    qrPromesa = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      s.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
      s.crossOrigin = 'anonymous';
      s.onload = () => (globalThis.qrcode ? resolver(globalThis.qrcode) : rechazar(new Error('qrcode no quedó disponible')));
      s.onerror = () => {
        qrPromesa = null;
        rechazar(new Error('No se pudo cargar el generador de QR'));
      };
      document.head.append(s);
    });
  }
  return qrPromesa;
}

/**
 * SVG del QR con módulos de `celda` unidades y margen de 4 módulos (lo que pide la norma). Nivel M por omisión.
 * Devuelve un elemento <svg> con <title>.
 */
export async function svgQr(texto, { nivel = 'M', titulo = 'Código QR' } = {}) {
  const qrcode = await cargarQr();
  const qr = qrcode(0, nivel);
  qr.addData(texto, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const margen = 4;
  const lado = n + margen * 2;
  let d = '';
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) if (qr.isDark(f, c)) d += `M${c + margen} ${f + margen}h1v1h-1z`;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', 'qr');
  const title = document.createElementNS(NS, 'title');
  title.textContent = titulo;
  const fondo = document.createElementNS(NS, 'rect');
  fondo.setAttribute('width', lado);
  fondo.setAttribute('height', lado);
  fondo.setAttribute('class', 'qr__fondo');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', 'qr__modulos');
  svg.append(title, fondo, p);
  return svg;
}

/** Sonido corto con WebAudio (sin archivos). Solo suena después de que la persona lo activó con un toque. */
export function crearSonido() {
  let ctx = null;
  return {
    get activo() {
      return Boolean(ctx) && ctx.state === 'running';
    },
    async activar() {
      ctx = ctx ?? new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      await ctx.resume();
      this.tocar();
    },
    desactivar() {
      ctx?.suspend();
    },
    tocar() {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      for (const [i, f] of [880, 1320].entries()) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.16);
        o.stop(t + i * 0.16 + 0.16);
      }
    },
  };
}

export { icono };
