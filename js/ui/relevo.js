// Relevo entre dispositivos por ntfy.sh (servidor público de pruebas). Publicar = POST al tema; escuchar =
// EventSource sobre /sse. Si ntfy no responde, todo sigue funcionando en el mismo navegador.
//
// El tema es atk-mesa-<sala>. Cualquiera que sepa el tema puede leer y escribir en él: por eso la caja solo acepta
// del relevo lo que hace un comensal, y la pantalla dice siempre que no se escriban datos reales.

import { temaSala, deNtfy, LIMITE_NTFY } from '../nucleo/mensajes.mjs';
import { leer, escribir } from './almacen.js';

const SERVIDOR = 'https://ntfy.sh';
const ESPERAS = [2, 4, 8, 15, 30];

/**
 * alRecibir(msg, ntfyId): cada mensaje válido. alEstado({estado, segundos}): 'conectando' | 'conectado' |
 * 'sin-conexion'. `retomar`: pide a ntfy lo publicado desde el último mensaje visto (lo guarda ntfy 12 h).
 */
export function crearRelevo({ sala, alRecibir, alEstado = () => {}, retomar = false }) {
  const tema = temaSala(sala);
  const claveUltimo = `ntfy-ultimo:${sala}`;
  let ultimo = retomar ? leer(claveUltimo) : null;
  let fuente = null;
  let intento = 0;
  let temporizador = null;
  let cuentaAtras = null;
  let cerrado = false;
  let estado = { estado: 'conectando', segundos: 0 };

  function poner(e) {
    estado = e;
    alEstado(e);
  }

  function conectar() {
    if (cerrado) return;
    clearTimeout(temporizador);
    clearInterval(cuentaAtras);
    poner({ estado: 'conectando', segundos: 0 });
    const desde = ultimo ? `?since=${encodeURIComponent(ultimo)}` : '';
    try {
      fuente = new EventSource(`${SERVIDOR}/${tema}/sse${desde}`);
    } catch {
      programar();
      return;
    }
    fuente.onopen = () => {
      intento = 0;
      poner({ estado: 'conectado', segundos: 0 });
    };
    fuente.onmessage = (ev) => {
      const r = deNtfy(ev.data);
      if (r.ntfyId) {
        ultimo = r.ntfyId;
        if (retomar) escribir(claveUltimo, ultimo);
      }
      if (r.ok) alRecibir(r.msg, r.ntfyId);
    };
    fuente.onerror = () => {
      fuente?.close();
      fuente = null;
      programar();
    };
  }

  function programar() {
    if (cerrado) return;
    const s = ESPERAS[Math.min(intento, ESPERAS.length - 1)];
    intento++;
    let quedan = s;
    poner({ estado: 'sin-conexion', segundos: quedan });
    cuentaAtras = setInterval(() => {
      quedan = Math.max(0, quedan - 1);
      poner({ estado: 'sin-conexion', segundos: quedan });
    }, 1000);
    temporizador = setTimeout(conectar, s * 1000);
  }

  async function publicar(msg) {
    const cuerpo = JSON.stringify(msg);
    if (new TextEncoder().encode(cuerpo).length > LIMITE_NTFY) throw new Error('mensaje demasiado grande para el relevo');
    const r = await fetch(`${SERVIDOR}/${tema}`, { method: 'POST', body: cuerpo });
    if (!r.ok) throw new Error(`relevo: HTTP ${r.status}`);
    return true;
  }

  const alVolverRed = () => {
    if (!fuente) {
      intento = 0;
      conectar();
    }
  };
  addEventListener('online', alVolverRed);

  conectar();

  return {
    tema,
    publicar,
    get estado() {
      return estado;
    },
    reconectar: alVolverRed,
    cerrar() {
      cerrado = true;
      clearTimeout(temporizador);
      clearInterval(cuentaAtras);
      fuente?.close();
      removeEventListener('online', alVolverRed);
    },
  };
}
