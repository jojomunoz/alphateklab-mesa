// La carta: lectura, validación y precio de un renglón (con modificadores).

import { TASAS_ITBMS, tasaAplicable } from './dinero.mjs';

export const IDIOMAS = ['es', 'en'];
export const MAX_CANT = 20;

// Fotos de los platos: «img/platos/<id>» más «-200.webp», «-480.webp» o «-960.webp». Solo rutas de esta carpeta,
// para que una carta importada no pueda pedir imágenes a otro sitio.
export const ANCHOS_FOTO = [200, 480, 960];
const RUTA_FOTO = /^img\/platos\/[a-z0-9-]+$/;
/**
 * Las fotos y las sugerencias llegaron a la carta de ejemplo el 3-oct-2026. A una carta ya guardada en la caja se le
 * agregan las de los platos que coinciden por id, sin tocar nada de lo que editó el dueño. Devuelve si cambió algo.
 */
export function completarFotos(carta, base) {
  if (!carta || !Array.isArray(carta.platos)) return false;
  let cambio = false;
  const fotos = new Map((base?.platos ?? []).filter((p) => typeof p.foto === 'string').map((p) => [p.id, p.foto]));
  for (const p of carta.platos) {
    if (p.foto == null && fotos.has(p.id)) {
      p.foto = fotos.get(p.id);
      cambio = true;
    }
  }
  if (!Array.isArray(carta.sugerencias) && Array.isArray(base?.sugerencias)) {
    carta.sugerencias = [...base.sugerencias];
    cambio = true;
  }
  return cambio;
}

/** Dirección de la foto de un plato en un ancho, o null si el plato no tiene foto. */
export function fotoPlato(p, ancho) {
  return typeof p?.foto === 'string' && RUTA_FOTO.test(p.foto) ? `${p.foto}-${ancho}.webp` : null;
}
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
export function armarRenglon(carta, pedido, { tipoLocal = 'restaurante' } = {}) {
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
      tasa: tasaAplicable(plato.itbms, tipoLocal),
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
  if (!carta || typeof carta !== 'object') return { ok: false, errores: ['Ese archivo no es una copia de la carta.'] };
  if (!Array.isArray(carta.categorias) || carta.categorias.length === 0) errores.push('Falta la lista de categorías.');
  if (!Array.isArray(carta.platos)) errores.push('Falta la lista de platos.');
  if (!Array.isArray(carta.grupos)) errores.push('Falta la lista de opciones de los platos (puede ir vacía).');
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
    if (p.foto != null && !(typeof p.foto === 'string' && RUTA_FOTO.test(p.foto))) errores.push(`El plato ${etiqueta} trae una foto que no es de esta carta.`);
  }
  return { ok: errores.length === 0, errores };
}

// ——— La carta del teléfono remoto ———
// El teléfono que escaneó el QR tiene la carta de ejemplo del sitio (datos/carta.json); la caja tiene la que editó
// el dueño. Por el relevo viaja solo la diferencia, más una huella de la carta de la caja: si al aplicar la
// diferencia el teléfono no llega a la misma huella (porque el resumen se recortó para caber en ntfy), lo dice en
// pantalla en vez de mostrar precios viejos como si fueran los de hoy.

const canonPlato = (p) => ({ id: p.id, cat: p.cat, nombre: p.nombre, desc: p.desc ?? null, precio: p.precio, itbms: p.itbms, estacion: p.estacion, alergenos: p.alergenos ?? [], grupos: p.grupos ?? [], agotado: Boolean(p.agotado) });
const canonGrupo = (g) => ({ id: g.id, nombre: g.nombre, tipo: g.tipo, obligatorio: Boolean(g.obligatorio), opciones: (g.opciones ?? []).map((o) => ({ id: o.id, nombre: o.nombre, precio: o.precio ?? 0, alergenos: o.alergenos ?? [] })) });
const canonCat = (c) => ({ id: c.id, nombre: c.nombre });

/** JSON con las claves ordenadas: dos cartas iguales dan el mismo texto aunque sus objetos se armaran distinto. */
function estable(x) {
  if (Array.isArray(x)) return `[${x.map(estable).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${estable(x[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}
const igual = (a, b) => estable(a) === estable(b);

/** Huella de lo que ve el comensal (FNV-1a de 32 bits sobre la forma canónica). */
export function huellaCarta(carta) {
  const s = estable({ al: carta.alergenos ?? [], ca: (carta.categorias ?? []).map(canonCat), gr: (carta.grupos ?? []).map(canonGrupo), pl: (carta.platos ?? []).map(canonPlato) });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Diferencia entre la carta base y la de la caja, para mandarla al teléfono en pocos bytes:
 * agotados, precios, platos quitados (como antes), y además los demás campos cambiados de cada plato, los platos
 * nuevos, los grupos de opciones cambiados o nuevos (con los precios de sus opciones), las categorías y los
 * alérgenos si cambiaron, el orden de los platos si cambió y la huella de la carta completa.
 */
export function parcheCarta(base, actual) {
  const b = new Map((base.platos ?? []).map((p) => [p.id, canonPlato(p)]));
  const agotados = [];
  const precios = {};
  const campos = {};
  const nuevos = [];
  for (const p of actual.platos ?? []) {
    const c = canonPlato(p);
    if (c.agotado) agotados.push(p.id);
    const o = b.get(p.id);
    if (!o) {
      const { agotado: _a, ...sinAgotado } = c;
      nuevos.push(sinAgotado);
      continue;
    }
    if (o.precio !== c.precio) precios[p.id] = c.precio;
    const dif = {};
    for (const k of ['cat', 'nombre', 'desc', 'itbms', 'estacion', 'alergenos', 'grupos']) if (!igual(o[k], c[k])) dif[k] = c[k];
    if (Object.keys(dif).length) campos[p.id] = dif;
  }
  const actuales = new Set((actual.platos ?? []).map((p) => p.id));
  const ocultos = [...b.keys()].filter((id) => !actuales.has(id));
  const parche = { agotados, precios, ocultos, h: huellaCarta(actual) };
  if (Object.keys(campos).length) parche.campos = campos;
  if (nuevos.length) parche.nuevos = nuevos;
  // Orden: el que daría aplicar el parche (base sin los quitados, luego los nuevos) contra el de la caja.
  const ordenAplicado = [...[...b.keys()].filter((id) => actuales.has(id)), ...nuevos.map((p) => p.id)];
  const ordenActual = (actual.platos ?? []).map((p) => p.id);
  if (!igual(ordenAplicado, ordenActual)) parche.orden = ordenActual;
  const bg = new Map((base.grupos ?? []).map((g) => [g.id, canonGrupo(g)]));
  const grupos = {};
  for (const g of actual.grupos ?? []) {
    const c = canonGrupo(g);
    if (!bg.has(g.id) || !igual(bg.get(g.id), c)) grupos[g.id] = c;
  }
  if (Object.keys(grupos).length) parche.grupos = grupos;
  const gruposActuales = new Set((actual.grupos ?? []).map((g) => g.id));
  const gruposQuitados = [...bg.keys()].filter((id) => !gruposActuales.has(id));
  if (gruposQuitados.length) parche.gruposQuitados = gruposQuitados;
  const cats = (actual.categorias ?? []).map(canonCat);
  if (!igual((base.categorias ?? []).map(canonCat), cats)) parche.categorias = cats;
  if (!igual(base.alergenos ?? [], actual.alergenos ?? [])) parche.alergenos = actual.alergenos ?? [];
  return parche;
}

/** Aplica el parche sobre la carta base (en el teléfono). No muta. */
export function aplicarParche(base, parche) {
  if (!parche) return base;
  const ag = new Set(parche.agotados ?? []);
  const oc = new Set(parche.ocultos ?? []);
  let platos = (base.platos ?? [])
    .filter((p) => !oc.has(p.id))
    .map((p) => ({ ...p, ...(parche.campos?.[p.id] ?? {}), agotado: ag.has(p.id), precio: parche.precios?.[p.id] ?? p.precio }))
    .concat((parche.nuevos ?? []).map((p) => ({ ...p, agotado: ag.has(p.id) })));
  if (Array.isArray(parche.orden)) {
    const pos = new Map(parche.orden.map((id, i) => [id, i]));
    platos = platos.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  const gq = new Set(parche.gruposQuitados ?? []);
  const gruposNuevos = Object.values(parche.grupos ?? {}).filter((g) => !(base.grupos ?? []).some((x) => x.id === g.id));
  const grupos = (base.grupos ?? []).filter((g) => !gq.has(g.id)).map((g) => parche.grupos?.[g.id] ?? g).concat(gruposNuevos);
  return { ...base, platos, grupos, categorias: parche.categorias ?? base.categorias, alergenos: parche.alergenos ?? base.alergenos };
}

/** ¿La carta que armó el teléfono es la misma que la de la caja? (sin huella en el parche: no se sabe, se asume que sí) */
export function cartaAlDia(cartaTelefono, parche) {
  if (!parche?.h) return true;
  return huellaCarta(cartaTelefono) === parche.h;
}
