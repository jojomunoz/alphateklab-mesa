// Lo que un teléfono mandó a la caja y cómo se entera de qué pasó con eso.
//
// - `intentos` (id → {tipo, datos, t, envio, error?, detalle?}): acciones que el resumen de la mesa todavía no
//   muestra. Mientras tanto la pantalla las pinta «Enviando…»; si la caja anota un error con su id, quedan en error.
// - `propios` (id → {datos, t}): pedidos de este teléfono que ya entraron a la cuenta. Hacen falta para un caso:
//   si el mesero rechaza el único pedido de una mesa, la cuenta se cierra y el pedido ya no sale en el resumen.
//   Lo único que queda es el error anotado con su id; sin recordar que el pedido era de este teléfono, la pantalla
//   diría «Aún no hay pedidos» y el comensal nunca sabría que no se lo aceptaron.
//
// Las dos funciones modifican los Map que reciben y devuelven si algo cambió.

export const MAX_PROPIOS = 20;

/** Ids que el resumen muestra (pedidos, avisos y sus refs, pagos). */
function idsDelResumen(resumen) {
  const c = resumen?.cuenta;
  const ids = new Set();
  for (const p of c?.pedidos ?? []) ids.add(p.id);
  for (const a of c?.avisos ?? []) {
    ids.add(a.id);
    for (const r of a.refs ?? []) ids.add(r);
  }
  for (const p of c?.pagos ?? []) ids.add(p.id);
  return ids;
}

/** Quita lo que el PIN no debe dejar guardado. */
export function datosParaGuardar(datos) {
  if (!datos || typeof datos !== 'object' || !('pin' in datos)) return datos;
  const { pin: _pin, ...resto } = datos;
  return resto;
}

export function resolverIntentos(intentos, propios, resumen) {
  if (!resumen) return false;
  const ids = idsDelResumen(resumen);
  const errores = new Map((resumen.errores ?? []).map((e) => [e.ref, e]));
  let cambio = false;

  for (const [id, it] of intentos) {
    // Dividir o quitar la división no deja un id en el resumen: basta con un resumen posterior sin error.
    const cuentaSinId = it.tipo === 'cuenta' && it.datos?.accion !== 'pedir' && it.envio === 'publicado' && !errores.has(id) && resumen.ts > it.t;
    if (ids.has(id) || cuentaSinId) {
      if (it.tipo === 'pedido') propios.set(id, { datos: datosParaGuardar(it.datos), t: it.t });
      intentos.delete(id);
      cambio = true;
    } else if (errores.has(id) && it.envio !== 'error') {
      const e = errores.get(id);
      intentos.set(id, { ...it, envio: 'error', error: e.motivo, detalle: e.detalle ?? null });
      cambio = true;
    }
  }

  // Pedidos propios que el resumen ya no muestra: si la caja anotó un error con su id (rechazado), vuelven como
  // intento con ese error para que la pantalla lo diga; si no, la cuenta se cerró y se olvidan.
  for (const [id, p] of propios) {
    if (ids.has(id)) continue;
    const e = errores.get(id);
    if (e) intentos.set(id, { tipo: 'pedido', datos: p.datos, t: p.t, envio: 'error', error: e.motivo, detalle: e.detalle ?? null });
    propios.delete(id);
    cambio = true;
  }

  if (propios.size > MAX_PROPIOS) {
    const sobran = [...propios.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, propios.size - MAX_PROPIOS);
    for (const [id] of sobran) propios.delete(id);
    cambio = true;
  }
  return cambio;
}
