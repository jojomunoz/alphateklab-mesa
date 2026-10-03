// La carta: lectura, validación y precio de un renglón (con modificadores).

import { TASAS_ITBMS } from './dinero.mjs';

export const IDIOMAS = ['es', 'en'];
export const MAX_CANT = 20;
export const MAX_NOTA = 140;

/** Texto en el idioma pedido, con el español de respaldo. */
export function texto(obj, idioma = 'es') {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[idioma] || obj.es || '';
}

export function indexar(carta) {
  const platos = new Map((carta.platos ?? []).map((p) => [p.id, p]));
  const grupos = new Map((carta.grupos ?? []).map((g) => [g.id, g]));
  const categorias = new Map((carta.categorias ?? []).map((c) => [c.id, c]));
  return { platos, grupos, categorias };
}

/**
 * Valida una selección de modificadores para un plato.
 * seleccion: [{grupo, opcion}]. Devuelve {ok, faltan:[grupoId], errores:[texto], mods:[{grupo, opcion, nombre, precio}]}.
 */
export function validarSeleccion(carta, platoId, seleccion = []) {
  const { platos, grupos } = indexar(carta);
  const plato = platos.get(platoId);
  if (!plato) return { ok: false, faltan: [], errores: [`no existe el plato «${platoId}»`], mods: [] };
  const errores = [];
  const faltan = [];
  const mods = [];
  const permitidos = new Set(plato.grupos ?? []);
  const porGrupo = new Map();
  for (const s of seleccion) {
    if (!s || !permitidos.has(s.grupo)) {
      errores.push(`el modificador «${s?.grupo}» no aplica a este plato`);
      continue;
    }
    const lista = porGrupo.get(s.grupo) ?? [];
    if (lista.includes(s.opcion)) continue; // repetido: se ignora
    lista.push(s.opcion);
    porGrupo.set(s.grupo, lista);
  }
  for (const gid of plato.grupos ?? []) {
    const g = grupos.get(gid);
    if (!g) {
      errores.push(`falta el grupo «${gid}» en la carta`);
      continue;
    }
    const elegidas = porGrupo.get(gid) ?? [];
    if (g.tipo === 'uno' && elegidas.length > 1) errores.push(`en «${texto(g.nombre)}» se elige una sola opción`);
    if (g.obligatorio && elegidas.length === 0) faltan.push(gid);
    for (const oid of elegidas) {
      const o = (g.opciones ?? []).find((x) => x.id === oid);
      if (!o) {
        errores.push(`la opción «${oid}» no existe en «${texto(g.nombre)}»`);
        continue;
      }
      mods.push({ grupo: gid, opcion: oid, nombre: texto(o.nombre), precio: o.precio ?? 0, alergenos: o.alergenos ?? [] });
    }
  }
  return { ok: errores.length === 0 && faltan.length === 0, faltan, errores, mods };
}

/**
 * Precio de un renglón pedido: {plato, cant, mods:[{grupo, opcion}], nota}. La caja lo calcula con SU carta,
 * no con lo que mande el teléfono. Devuelve {ok, error?, renglon}.
 */
export function armarRenglon(carta, pedido) {
  const { platos } = indexar(carta);
  const plato = platos.get(pedido?.plato);
  if (!plato) return { ok: false, error: 'plato-inexistente' };
  if (plato.agotado) return { ok: false, error: 'agotado', plato: plato.id };
  const cant = pedido.cant;
  if (!Number.isInteger(cant) || cant < 1 || cant > MAX_CANT) return { ok: false, error: 'cantidad' };
  const sel = validarSeleccion(carta, plato.id, pedido.mods ?? []);
  if (!sel.ok) return { ok: false, error: sel.faltan.length ? 'faltan-modificadores' : 'modificadores', detalle: sel };
  const nota = typeof pedido.nota === 'string' ? pedido.nota.trim().slice(0, MAX_NOTA) : '';
  const unit = plato.precio + sel.mods.reduce((s, m) => s + m.precio, 0);
  return {
    ok: true,
    renglon: {
      plato: plato.id,
      nombre: texto(plato.nombre, 'es'),
      cant,
      mods: sel.mods.map((m) => ({ grupo: m.grupo, opcion: m.opcion, nombre: m.nombre, precio: m.precio })),
      nota,
      unit,
      monto: unit * cant,
      tasa: plato.itbms,
      estacion: plato.estacion,
    },
  };
}

export function alergenosDe(carta, platoId, mods = []) {
  const { platos, grupos } = indexar(carta);
  const p = platos.get(platoId);
  const set = new Set(p?.alergenos ?? []);
  for (const m of mods) {
    const o = grupos.get(m.grupo)?.opciones?.find((x) => x.id === m.opcion);
    for (const a of o?.alergenos ?? []) set.add(a);
  }
  return [...set];
}

/** Validación completa (para importar un JSON en el panel). Devuelve {ok, errores:[texto]}. */
export function validarCarta(carta) {
  const errores = [];
  if (!carta || typeof carta !== 'object') return { ok: false, errores: ['El archivo no es una carta (no es un objeto JSON).'] };
  if (!Array.isArray(carta.categorias) || carta.categorias.length === 0) errores.push('Falta la lista de categorías.');
  if (!Array.isArray(carta.platos)) errores.push('Falta la lista de platos.');
  if (!Array.isArray(carta.grupos)) errores.push('Falta la lista de grupos de modificadores (puede ir vacía: []).');
  if (errores.length) return { ok: false, errores };
  const ids = new Set();
  const cats = new Set();
  for (const c of carta.categorias) {
    if (!c.id || !texto(c.nombre)) errores.push(`Categoría sin id o sin nombre: ${JSON.stringify(c).slice(0, 60)}`);
    if (cats.has(c.id)) errores.push(`Categoría repetida: «${c.id}».`);
    cats.add(c.id);
  }
  const grupos = new Set();
  for (const g of carta.grupos) {
    if (!g.id || !texto(g.nombre)) errores.push('Un grupo de modificadores no tiene id o nombre.');
    if (!['uno', 'varios'].includes(g.tipo)) errores.push(`El grupo «${g.id}» tiene un tipo desconocido («${g.tipo}»).`);
    if (!Array.isArray(g.opciones) || g.opciones.length === 0) errores.push(`El grupo «${g.id}» no tiene opciones.`);
    for (const o of g.opciones ?? []) {
      if (!Number.isSafeInteger(o.precio ?? 0) || (o.precio ?? 0) < 0) errores.push(`Precio no válido en la opción «${o.id}» de «${g.id}».`);
    }
    grupos.add(g.id);
  }
  const estaciones = new Set((carta.estaciones ?? [{ id: 'caliente' }, { id: 'frios' }, { id: 'bar' }]).map((e) => e.id));
  for (const p of carta.platos) {
    const etiqueta = p.id ? `«${p.id}»` : '(sin id)';
    if (!p.id) errores.push('Hay un plato sin id.');
    if (ids.has(p.id)) errores.push(`Plato repetido: ${etiqueta}.`);
    ids.add(p.id);
    if (!texto(p.nombre)) errores.push(`El plato ${etiqueta} no tiene nombre.`);
    if (!cats.has(p.cat)) errores.push(`El plato ${etiqueta} apunta a una categoría que no existe («${p.cat}»).`);
    if (!Number.isSafeInteger(p.precio) || p.precio <= 0) errores.push(`El plato ${etiqueta} no tiene un precio válido en centésimos.`);
    if (!TASAS_ITBMS.includes(p.itbms)) errores.push(`El plato ${etiqueta} tiene una tasa de ITBMS no válida (${p.itbms}).`);
    if (!estaciones.has(p.estacion)) errores.push(`El plato ${etiqueta} va a una estación desconocida («${p.estacion}»).`);
    for (const g of p.grupos ?? []) if (!grupos.has(g)) errores.push(`El plato ${etiqueta} usa un grupo que no existe («${g}»).`);
  }
  return { ok: errores.length === 0, errores };
}

/** Diferencias de precio y agotados contra la carta base (para mandarlas al teléfono en pocos bytes). */
export function parcheCarta(base, actual) {
  const b = indexar(base).platos;
  const agotados = [];
  const precios = {};
  const ocultos = [];
  for (const p of actual.platos ?? []) {
    if (p.agotado) agotados.push(p.id);
    const original = b.get(p.id);
    if (original && original.precio !== p.precio) precios[p.id] = p.precio;
  }
  const actuales = new Set((actual.platos ?? []).map((p) => p.id));
  for (const id of b.keys()) if (!actuales.has(id)) ocultos.push(id);
  return { agotados, precios, ocultos };
}

/** Aplica el parche sobre la carta base (en el teléfono). No muta. */
export function aplicarParche(base, parche) {
  if (!parche) return base;
  const ag = new Set(parche.agotados ?? []);
  const oc = new Set(parche.ocultos ?? []);
  return {
    ...base,
    platos: (base.platos ?? [])
      .filter((p) => !oc.has(p.id))
      .map((p) => ({ ...p, agotado: ag.has(p.id), precio: parche.precios?.[p.id] ?? p.precio })),
  };
}
