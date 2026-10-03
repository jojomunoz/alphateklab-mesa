// El teléfono del comensal frente a la caja.
//
// Dos modos, la misma interfaz:
// - local: la mesa se abrió en la misma computadora que tiene la caja (misma sala): las acciones van directo a la
//   caja y el resumen se calcula aquí mismo.
// - remoto: el teléfono que escaneó el QR. Manda cada acción por el relevo (con una bandeja de salida que
//   reintenta) y pinta el último resumen que le mandó la caja. Cada acción queda «enviando» hasta que el resumen
//   la trae (o trae su error): así «Enviado» significa que llegó al salón, no que salió del teléfono.

import { crearRelevo } from './relevo.js';
import { abrirCaja, hayCajaPara, idDispositivo } from './caja-local.js';
import { leer, escribir, borrar } from './almacen.js';
import { crearMensaje } from '../nucleo/mensajes.mjs';
import { resumenMesa, expandirResumen, esMasNuevo } from '../nucleo/resumen.mjs';
import { generarId } from '../nucleo/url.mjs';

const ESPERA_RESPUESTA_MS = 9000;
const REINTENTO_MS = 5000;

export function crearClienteMesa({ sala, mesa, cartaBase }) {
  const disp = idDispositivo();
  const local = hayCajaPara(sala);
  const oyentes = new Set();
  const claveResumen = `resumen:${sala}:${mesa}`;
  const claveSalida = `salida:${sala}:${mesa}`;
  const claveIntentos = `intentos:${sala}:${mesa}`;

  let caja = null;
  let relevo = null;
  let crudo = local ? null : leer(claveResumen);
  let resumen = crudo ? expandirResumen(crudo) : null;
  let conexion = local ? { estado: 'local', segundos: 0 } : { estado: 'conectando', segundos: 0 };
  let salida = local ? [] : leer(claveSalida, []);
  /** id → {tipo, datos, t, envio:'enviando'|'publicado'|'fallo', error?} */
  let intentos = new Map(Object.entries(leer(claveIntentos, {})));
  let noResponde = false;
  let temporizadorRespuesta = null;
  let temporizadorSalida = null;

  function guardarIntentos() {
    escribir(claveIntentos, Object.fromEntries(intentos));
  }

  function avisar() {
    for (const fn of oyentes) fn();
  }

  /** Quita de «intentos» lo que el resumen ya muestra (o rechazó). */
  function resolverIntentos() {
    if (!resumen) return;
    const c = resumen.cuenta;
    const ids = new Set();
    for (const p of c?.pedidos ?? []) ids.add(p.id);
    for (const a of c?.avisos ?? []) {
      ids.add(a.id);
      for (const r of a.refs ?? []) ids.add(r);
    }
    for (const p of c?.pagos ?? []) ids.add(p.id);
    const errores = new Map((resumen.errores ?? []).map((e) => [e.ref, e]));
    let cambio = false;
    for (const [id, it] of intentos) {
      // Si el resumen ya lo muestra (aunque sea rechazado), se pinta desde ahí.
      if (ids.has(id) || (it.tipo === 'cuenta' && it.datos?.accion !== 'pedir' && it.envio === 'publicado' && !errores.has(id) && resumen.ts > it.t)) {
        intentos.delete(id);
        cambio = true;
      } else if (errores.has(id)) {
        if (it.envio !== 'error') {
          intentos.set(id, { ...it, envio: 'error', error: errores.get(id).motivo, detalle: errores.get(id).detalle });
          cambio = true;
        }
      }
    }
    if (cambio) guardarIntentos();
  }

  function aplicarCrudo(nuevo) {
    if (!esMasNuevo(crudo, nuevo)) return;
    crudo = nuevo;
    resumen = expandirResumen(nuevo);
    if (!local) escribir(claveResumen, crudo);
    noResponde = false;
    clearTimeout(temporizadorRespuesta);
    resolverIntentos();
    avisar();
  }

  // ——— modo local ———
  if (local) {
    caja = abrirCaja(cartaBase);
    const recalcular = () => aplicarCrudo(resumenMesa(caja.estado, mesa, cartaBase, Date.now()));
    recalcular();
    caja.suscribir(recalcular);
  }

  // ——— modo remoto ———
  async function vaciarSalida() {
    if (local || !relevo) return;
    clearTimeout(temporizadorSalida);
    const pendientes = [...salida];
    for (const msg of pendientes) {
      try {
        await relevo.publicar(msg);
        salida = salida.filter((m) => m.id !== msg.id);
        escribir(claveSalida, salida);
        const it = intentos.get(msg.id);
        if (it && it.envio !== 'error') intentos.set(msg.id, { ...it, envio: 'publicado' });
        guardarIntentos();
        esperarRespuesta();
      } catch {
        const it = intentos.get(msg.id);
        if (it) intentos.set(msg.id, { ...it, envio: 'fallo' });
        temporizadorSalida = setTimeout(vaciarSalida, REINTENTO_MS);
        break;
      }
    }
    avisar();
  }

  function esperarRespuesta() {
    clearTimeout(temporizadorRespuesta);
    temporizadorRespuesta = setTimeout(() => {
      noResponde = true;
      avisar();
    }, ESPERA_RESPUESTA_MS);
  }

  if (!local) {
    relevo = crearRelevo({
      sala,
      alRecibir: (msg) => {
        if (msg.tipo === 'estado' && msg.mesa === mesa && msg.datos && typeof msg.datos === 'object') aplicarCrudo(msg.datos);
      },
      alEstado: (e) => {
        const antes = conexion.estado;
        conexion = e;
        if (e.estado === 'conectado' && antes !== 'conectado') {
          enviar('pedir-estado', {});
          vaciarSalida();
        }
        avisar();
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && conexion.estado === 'conectado') enviar('pedir-estado', {});
    });
  }

  /** Manda una acción del comensal. Devuelve su id. */
  function enviar(tipo, datos) {
    const id = `${tipo === 'pedir-estado' ? 'pe' : tipo.slice(0, 3)}-${generarId(12)}`;
    const msg = crearMensaje({ tipo, mesa, datos, id, disp });
    if (tipo !== 'pedir-estado') {
      intentos.set(id, { tipo, datos, t: Date.now(), envio: 'enviando' });
      guardarIntentos();
    }
    if (local) {
      caja.despachar(msg).then((r) => {
        if (r.error && tipo !== 'pedir-estado') {
          intentos.set(id, { ...intentos.get(id), envio: 'error', error: r.error });
          guardarIntentos();
        }
        resolverIntentos();
        avisar();
      });
    } else {
      if (tipo === 'pedir-estado') {
        relevo
          ?.publicar(msg)
          .then(esperarRespuesta)
          .catch(() => {});
      } else {
        salida.push(msg);
        escribir(claveSalida, salida);
        vaciarSalida();
      }
    }
    avisar();
    return id;
  }

  function olvidarIntento(id) {
    intentos.delete(id);
    guardarIntentos();
    avisar();
  }

  return {
    local,
    disp,
    sala,
    mesa,
    get resumen() {
      return resumen;
    },
    /** La carta que ve el comensal: la de la caja si es local; si no, la base con el parche de la caja. */
    get cartaCaja() {
      return local ? caja.estado.carta : null;
    },
    get conexion() {
      return conexion;
    },
    get noResponde() {
      return noResponde && !local;
    },
    get intentos() {
      return intentos;
    },
    enviar,
    olvidarIntento,
    suscribir(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    /** Botón «Restablecer» en un teléfono remoto: borra lo guardado en el teléfono. En local, la caja. */
    async restablecer() {
      if (local) return caja.restablecer();
      borrar(claveResumen);
      borrar(claveSalida);
      borrar(claveIntentos);
      crudo = null;
      resumen = null;
      salida = [];
      intentos = new Map();
      enviar('pedir-estado', {});
      avisar();
    },
  };
}
