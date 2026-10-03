// index.html · la prueba en vivo: el QR de la mesa 7 con la sala de esta computadora, y lo que llega de esa mesa.

import { $, h, icono, pintar, hace } from '../ui/dom.js';
import { svgQr } from '../ui/comun.js';
import { arrancarCaja } from '../ui/arranque.js';
import { urlMesa, baseDe } from '../nucleo/url.mjs';
import { mesaRt, estadoVisible } from '../nucleo/caja.mjs';
import { resumenCuenta } from '../nucleo/cuenta.mjs';
import { formatear } from '../nucleo/dinero.mjs';

const MESA = 7;
const TEXTO_ESTADO = {
  libre: 'libre, esperando tu pedido',
  ocupada: 'ocupada',
  pidio: 'pidió: el pedido espera que el mesero lo acepte en el salón',
  llama: 'llama al mesero',
  cuenta: 'pidió la cuenta o avisó un pago',
  pagada: 'pagada: falta liberarla en el salón',
};

function pintarEstado(caja) {
  const m = mesaRt(caja.estado, MESA);
  const ev = estadoVisible(m);
  const c = m.cuenta;
  const total = c ? resumenCuenta(c).total : 0;
  const ultimo = c
    ? [...c.pedidos.map((p) => ({ t: p.t, texto: `pedido de la ronda ${p.ronda} (${p.renglones.reduce((s, r) => s + r.cant, 0)} platos)` })), ...c.avisos.map((a) => ({ t: a.t, texto: a.tipo === 'mesero' ? 'llamó al mesero' : 'pidió la cuenta' })), ...c.pagos.map((p) => ({ t: p.t, texto: `pago de ${formatear(p.monto + p.propina)} (${p.estado === 'confirmado' ? 'confirmado' : p.estado === 'pendiente' ? 'por confirmar' : 'no llegó'})` }))].sort((a, b) => b.t - a.t)[0]
    : null;
  pintar(
    $('#estado-mesa7'),
    h(
      'p',
      { class: `estado-vivo estado-vivo--${ev}` },
      icono(ev === 'libre' ? 'qr' : ev === 'pagada' ? 'check' : ev === 'llama' ? 'campana' : 'recibo'),
      h('span', {}, h('strong', {}, `Mesa ${MESA}: `), TEXTO_ESTADO[ev], total ? ` · cuenta ${formatear(total)}` : '', ultimo ? h('span', { class: 'ayuda' }, ` · último: ${ultimo.texto}, ${hace(ultimo.t)}`) : null),
    ),
    ev !== 'libre' ? h('a', { href: `salon.html?m=${MESA}`, target: '_blank', rel: 'noopener' }, 'Verla en el salón') : null,
  );
}

async function iniciar() {
  const r = await arrancarCaja();
  if (!r) return;
  const { caja } = r;
  const url = urlMesa(baseDe(location.href), caja.sala, MESA);
  for (const a of [$('#abrir-mesa-aqui'), $('#vista-mesa'), $('#abrir-mesa-telefono')]) if (a) a.href = url;
  const u = new URL(url);
  $('#placa-dominio').textContent = `${u.host}${u.pathname.replace(/mesa\.html$/, '')}`;
  $('#placa-dominio').title = url;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) $('#aviso-localhost').hidden = false;
  try {
    const svg = await svgQr(url, { nivel: 'Q', titulo: `QR de la mesa ${MESA}: ${url}` });
    pintar($('#placa-qr'), svg);
  } catch {
    pintar($('#placa-qr'), h('p', { class: 'placa__error' }, 'No se pudo cargar el generador del QR (sin conexión). Abre la mesa con el enlace de abajo.'), h('a', { href: url, class: 'placa__enlace' }, url));
  }
  pintarEstado(caja);
  caja.suscribir(() => pintarEstado(caja));
  setInterval(() => pintarEstado(caja), 30_000);
}

iniciar();
