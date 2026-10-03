// El estado de UNA mesa, compacto, para mandarlo al teléfono por el relevo.
//
// ntfy.sh trata como adjunto todo mensaje de más de 4.096 bytes; por eso el resumen va en arreglos cortos, los
// nombres de plato solo viajan si el teléfono no los tiene en su carta, y si aun así pasa del límite se quitan
// primero las notas y luego los nombres. Hay una prueba que lo comprueba con una mesa de 30 renglones.

import { mesaRt } from './caja.mjs';
import { parcheCarta } from './carta.mjs';

export const LIMITE_BYTES = 3800;

export function bytesDe(obj) {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

export function resumenMesa(estado, n, cartaBase, ahora = Date.now()) {
  const local = estado.ajustes.nombre;
  const mp = estado.plano.mesas.find((m) => m.numero === n);
  if (!mp) return { mesa: n, ok: 0, rev: estado.rev, ep: estado.epoca, ts: ahora, local };
  const conocidos = new Set((cartaBase?.platos ?? []).map((p) => p.id));
  const m = mesaRt(estado, n);
  const c = m.cuenta;
  const s = {
    mesa: n,
    ok: 1,
    rev: estado.rev,
    ep: estado.epoca,
    ts: ahora,
    local,
    est: m.estado,
    aj: { ap: estado.ajustes.aprobacion, pin: estado.ajustes.pin ? 1 : 0, pr: estado.ajustes.propinas, re: estado.ajustes.resena },
    pc: cartaBase ? parcheCarta(cartaBase, estado.carta) : null,
    cid: c?.id ?? null,
    ped: (c?.pedidos ?? []).map((p) => [
      p.id,
      p.ronda,
      p.estado,
      p.disp,
      p.marcas?.[p.estado] ?? p.t,
      p.renglones.map((r) => [r.plato, r.cant, r.monto, r.tasa, r.mods.map((x) => `${x.grupo}.${x.opcion}`), r.nota, conocidos.has(r.plato) ? '' : r.nombre]),
      p.motivo ?? '',
    ]),
    av: (c?.avisos ?? []).map((a) => [a.id, a.tipo, a.estado, a.t, a.refs ?? []]),
    pag: (c?.pagos ?? []).map((p) => [p.id, p.parte, p.monto, p.propina, p.metodo, p.estado]),
    div: c?.division ? { t: c.division.tipo, n: c.division.n, p: c.division.partes, tot: c.division.total, as: c.division.asignacion ?? null } : null,
    err: estado.errores.filter((x) => x.mesa === n).slice(0, 4).map((x) => [x.ref, x.motivo, typeof x.detalle === 'string' ? x.detalle.slice(0, 80) : null]),
  };
  return recortar(s);
}

/** Si el resumen no cabe, quita notas, luego nombres, luego los avisos ya cerrados. */
export function recortar(s) {
  if (bytesDe(s) <= LIMITE_BYTES) return s;
  const r = structuredClone(s);
  for (const p of r.ped ?? []) for (const x of p[5]) x[5] = '';
  if (bytesDe(r) <= LIMITE_BYTES) return { ...r, recortado: 1 };
  for (const p of r.ped ?? []) for (const x of p[5]) x[6] = '';
  if (bytesDe(r) <= LIMITE_BYTES) return { ...r, recortado: 2 };
  r.av = (r.av ?? []).filter((a) => a[2] === 'abierta');
  r.pc = r.pc ? { agotados: r.pc.agotados, precios: {}, ocultos: [] } : null;
  return { ...r, recortado: 3 };
}

/** Del formato compacto a objetos con nombre (lo que usa la pantalla del comensal). */
export function expandirResumen(s) {
  if (!s) return null;
  if (!s.ok) return { mesa: s.mesa, existe: false, rev: s.rev, ep: s.ep, ts: s.ts, local: s.local, cuenta: null, errores: [] };
  const cuenta = s.cid
    ? {
        id: s.cid,
        pedidos: s.ped.map(([id, ronda, estado, disp, t, renglones, motivo]) => ({
          id,
          ronda,
          estado,
          disp,
          t,
          motivo,
          renglones: renglones.map(([plato, cant, monto, tasa, mods, nota, nombre], i) => ({
            id: String(i + 1),
            plato,
            cant,
            monto,
            tasa,
            nota,
            nombre,
            mods: mods.map((x) => {
              const [grupo, opcion] = x.split('.');
              return { grupo, opcion };
            }),
          })),
        })),
        avisos: s.av.map(([id, tipo, estado, t, refs]) => ({ id, tipo, estado, t, refs })),
        pagos: s.pag.map(([id, parte, monto, propina, metodo, estado]) => ({ id, parte, monto, propina, metodo, estado })),
        division: s.div ? { tipo: s.div.t, n: s.div.n, partes: s.div.p, total: s.div.tot, asignacion: s.div.as } : null,
      }
    : null;
  return {
    mesa: s.mesa,
    existe: true,
    rev: s.rev,
    ep: s.ep,
    ts: s.ts,
    local: s.local,
    estado: s.est,
    ajustes: { aprobacion: s.aj.ap, pin: Boolean(s.aj.pin), propinas: s.aj.pr, resena: s.aj.re },
    parche: s.pc,
    cuenta,
    errores: (s.err ?? []).map(([ref, motivo, detalle]) => ({ ref, motivo, detalle: detalle ?? null })),
    recortado: s.recortado ?? 0,
  };
}

/** ¿Reemplaza `nuevo` al resumen que ya tiene el teléfono? Misma época: gana la revisión mayor. Época distinta
 *  (alguien restableció los datos de la caja): gana el más reciente según el reloj de la caja. */
export function esMasNuevo(actual, nuevo) {
  if (!nuevo) return false;
  if (!actual) return true;
  if (nuevo.ep === actual.ep) return nuevo.rev >= actual.rev;
  return (nuevo.ts ?? 0) >= (actual.ts ?? 0);
}
