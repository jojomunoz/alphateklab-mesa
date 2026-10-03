// Arranque común de las pantallas de la computadora (inicio, cocina, salón, kiosco, panel).

import { $, h } from './dom.js';
import { cargarCartaBase, abrirCaja } from './caja-local.js';
import { conectarCajaAlRelevo } from './puente.js';
import { prepararBarra, pintarConexion } from './comun.js';

/**
 * Devuelve {caja, puente} o null si no se pudo cargar la carta (y deja el error pintado en `#principal`).
 * `conRelevo`: escuchar a los teléfonos por ntfy.sh (todas las pantallas de la computadora lo hacen, así basta
 * con tener una abierta para que un pedido por QR llegue).
 */
export async function arrancarCaja({ conRelevo = true } = {}) {
  let cartaBase;
  try {
    cartaBase = await cargarCartaBase();
  } catch {
    const principal = $('#principal') ?? document.body;
    principal.prepend(
      h(
        'div',
        { class: 'contenedor', role: 'alert' },
        h('p', { class: 'nota nota--alerta' }, 'No se pudo cargar la carta de ejemplo (datos/carta.json). Revisa la conexión y vuelve a cargar la página.'),
        h('button', { type: 'button', class: 'boton boton--primario', onclick: () => location.reload() }, 'Volver a cargar'),
      ),
    );
    return null;
  }
  const caja = abrirCaja(cartaBase);
  prepararBarra({ sala: caja.sala, alRestablecer: () => caja.restablecer() });
  const indicador = $('#conexion');
  const puente = conRelevo ? conectarCajaAlRelevo(caja, { alEstado: (e) => pintarConexion(indicador, e) }) : null;
  if (!conRelevo) pintarConexion(indicador, { estado: 'local', segundos: 0 });
  if (!caja.guardaDatos) {
    const aviso = h('p', { class: 'nota nota--espera contenedor' }, 'Este navegador no deja guardar datos (¿ventana privada?). La demo funciona, pero cada pestaña va por su cuenta (con su propio ejemplo y su propio código de sala) y todo se pierde al cerrarla.');
    ($('#principal') ?? document.body).prepend(aviso);
  }
  return { caja, puente };
}
