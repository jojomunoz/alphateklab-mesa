// Puente entre la caja de esta computadora y los teléfonos que escanearon el QR de una mesa.
//
// Escucha el relevo; lo que llega de un teléfono (pedido, llamada, cuenta, pago) pasa por la caja como acción
// remota, y la caja contesta con el resumen de esa mesa (`tipo:'estado'`). También manda el resumen cuando el
// personal cambia algo de una mesa que tiene un teléfono conectado (recibido, listo, visto, pago confirmado).
// Para no gastar mensajes del servidor público, solo publica para mesas que hablaron en las últimas 6 horas, y
// agrupa los cambios seguidos de una mesa en un solo mensaje.

import { crearRelevo } from './relevo.js';
import { crearMensaje, crearRegistro } from '../nucleo/mensajes.mjs';
import { resumenMesa } from '../nucleo/resumen.mjs';
import { TIPOS_COMENSAL } from '../nucleo/caja.mjs';
import { generarId } from '../nucleo/url.mjs';

const VENTANA_REMOTA_MS = 6 * 3600_000;
const AGRUPAR_MS = 350;

export function conectarCajaAlRelevo(caja, { alEstado = () => {} } = {}) {
  const vistos = crearRegistro(500);
  const pendientes = new Map();
  let relevo = null;

  function esRemota(mesa) {
    const t = caja.estado.remotos?.[mesa];
    return Number.isFinite(t) && Date.now() - t < VENTANA_REMOTA_MS;
  }

  function programarEstado(mesa) {
    if (!Number.isInteger(mesa) || !relevo) return;
    clearTimeout(pendientes.get(mesa));
    pendientes.set(
      mesa,
      setTimeout(async () => {
        pendientes.delete(mesa);
        const datos = resumenMesa(caja.estado, mesa, caja.cartaBase, Date.now());
        const msg = crearMensaje({ tipo: 'estado', mesa, datos, id: `es-${generarId(10)}`, disp: caja.disp });
        try {
          await relevo.publicar(msg);
        } catch {
          // Sin red: el teléfono volverá a pedir el estado cuando se reconecte.
        }
      }, AGRUPAR_MS),
    );
  }

  relevo = crearRelevo({
    sala: caja.sala,
    retomar: true,
    alEstado,
    alRecibir: async (msg) => {
      if (!vistos.nuevo(msg.id)) return;
      if (msg.disp === caja.disp) return;
      if (!TIPOS_COMENSAL.has(msg.tipo)) return;
      const r = await caja.despachar(msg, { remoto: true, automatico: true });
      // Solo la pestaña que aplicó el cambio contesta (las demás ven «repetido»). «pedir-estado» siempre cambia
      // la marca de remoto de la mesa, así que también se contesta una sola vez.
      if (r.cambio && Number.isInteger(msg.mesa)) programarEstado(msg.mesa);
    },
  });

  caja.alAplicar((r, accion, { remoto }) => {
    if (remoto || !r.cambio) return;
    if (r.todas) {
      for (const m of Object.keys(caja.estado.remotos ?? {}).map(Number)) if (esRemota(m)) programarEstado(m);
    } else if (Number.isInteger(r.mesa) && esRemota(r.mesa)) {
      programarEstado(r.mesa);
    }
  });

  return {
    get estado() {
      return relevo.estado;
    },
    cerrar: () => relevo.cerrar(),
  };
}
