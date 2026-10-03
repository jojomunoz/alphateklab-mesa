// La caja en esta computadora: el estado del restaurante en localStorage (fuente de verdad), compartido entre
// pestañas con BroadcastChannel('atk-mesa') y escrito bajo un cerrojo (Web Locks) para que dos pestañas no se
// pisen. Lo usan el inicio, la cocina, el salón, el kiosco, el panel y la mesa cuando se abre en la misma
// computadora.

import { aplicar, ESQUEMA } from '../nucleo/caja.mjs';
import { crearSemilla } from '../nucleo/semilla.mjs';
import { generarSala, generarId, esSala } from '../nucleo/url.mjs';
import { leer, escribir, claveDeAlmacen, almacenDisponible } from './almacen.js';

const CLAVE_ESTADO = 'estado';
const CLAVE_SALA = 'sala';
const CLAVE_DISP = 'disp';
const REFRESCAR_SEMILLA_MS = 20 * 60_000;

let cartaBasePromesa = null;
/** La carta de ejemplo del propio sitio (la cachea el service worker). */
export function cargarCartaBase() {
  if (!cartaBasePromesa) {
    cartaBasePromesa = fetch('datos/carta.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`carta: HTTP ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        cartaBasePromesa = null;
        throw e;
      });
  }
  return cartaBasePromesa;
}

export function idDispositivo() {
  let d = leer(CLAVE_DISP);
  if (typeof d !== 'string' || !/^[a-z0-9]{8}$/.test(d)) {
    d = generarId(8);
    escribir(CLAVE_DISP, d);
  }
  return d;
}

/** El código de sala de esta computadora (se crea la primera vez). */
export function salaLocal() {
  let s = leer(CLAVE_SALA);
  if (!esSala(s)) {
    s = generarSala();
    escribir(CLAVE_SALA, s);
  }
  return s;
}

/** ¿Hay una caja guardada en este navegador para esta sala? (sin crearla) */
export function hayCajaPara(sala) {
  const s = leer(CLAVE_SALA);
  return esSala(s) && s === sala;
}

function conCerrojo(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('atk-mesa-estado', () => fn());
  return Promise.resolve(fn());
}

export function abrirCaja(cartaBase) {
  const sala = salaLocal();
  const disp = idDispositivo();
  const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('atk-mesa') : null;
  const oyentes = new Set();
  const oyentesAccion = new Set();

  function nuevaSemilla() {
    return crearSemilla({ sala, carta: cartaBase, ahora: Date.now(), epoca: generarId(6) });
  }

  function leerEstado() {
    const e = leer(CLAVE_ESTADO);
    if (!e || e.esquema !== ESQUEMA || e.sala !== sala || !e.carta || !e.plano) return null;
    return e;
  }

  let estado = leerEstado();
  const refrescar = estado?.semilla && !estado.semilla.tocado && Date.now() - estado.semilla.t > REFRESCAR_SEMILLA_MS;
  if (!estado || refrescar) {
    // Primera visita, esquema viejo o datos de ejemplo sin tocar desde hace rato: el ejemplo vuelve con horas
    // de ahora (si no, la cocina mostraría tickets de ayer).
    estado = nuevaSemilla();
    escribir(CLAVE_ESTADO, estado);
  }

  function avisar(origen) {
    for (const fn of oyentes) fn(estado, origen);
  }

  function alCambiarFuera() {
    const e = leerEstado();
    if (e && (e.rev !== estado.rev || e.epoca !== estado.epoca)) {
      estado = e;
      avisar('otra-pestana');
    }
  }

  canal?.addEventListener('message', (ev) => {
    if (ev.data?.tipo === 'cambio') {
      if (!almacenDisponible() && ev.data.estado) {
        // Sin localStorage, el estado viaja completo por el canal.
        estado = ev.data.estado;
        avisar('otra-pestana');
      } else {
        alCambiarFuera();
      }
    }
  });
  addEventListener('storage', (ev) => {
    if (ev.key === claveDeAlmacen(CLAVE_ESTADO)) alCambiarFuera();
  });

  /**
   * Aplica una acción. `remoto`: llegó por el relevo (solo acciones de comensal). `automatico`: no la hizo una
   * persona (acuse de la cocina, relevo), así que no cuenta como «tocar» los datos de ejemplo.
   */
  async function despachar(accion, { remoto = false, automatico = false } = {}) {
    const completa = { v: 1, mesa: null, datos: {}, t: Date.now(), disp, id: generarId(12), ...accion };
    const r = await conCerrojo(() => {
      const actual = leerEstado() ?? estado;
      const res = aplicar(actual, completa, { ahora: Date.now(), remoto });
      if (res.cambio) {
        let nuevo = res.estado;
        if (!automatico && nuevo.semilla && !nuevo.semilla.tocado) nuevo = { ...nuevo, semilla: { ...nuevo.semilla, tocado: true } };
        escribir(CLAVE_ESTADO, nuevo);
        estado = nuevo;
        res.estado = nuevo;
      } else if (actual !== estado) {
        estado = actual;
      }
      return res;
    });
    if (r.cambio) {
      canal?.postMessage({ tipo: 'cambio', rev: estado.rev, estado: almacenDisponible() ? undefined : estado });
      avisar('esta-pestana');
    }
    for (const fn of oyentesAccion) fn(r, completa, { remoto });
    return r;
  }

  async function restablecer() {
    await conCerrojo(() => {
      estado = nuevaSemilla();
      escribir(CLAVE_ESTADO, estado);
    });
    canal?.postMessage({ tipo: 'cambio', rev: estado.rev, estado: almacenDisponible() ? undefined : estado });
    avisar('restablecido');
  }

  return {
    sala,
    disp,
    cartaBase,
    get estado() {
      return estado;
    },
    despachar,
    restablecer,
    /** fn(estado, origen) en cada cambio, de esta u otra pestaña. Devuelve la función para dejar de oír. */
    suscribir(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    /** fn(resultado, accion, {remoto}) después de cada acción de ESTA pestaña. */
    alAplicar(fn) {
      oyentesAccion.add(fn);
      return () => oyentesAccion.delete(fn);
    },
    guardaDatos: almacenDisponible(),
  };
}
