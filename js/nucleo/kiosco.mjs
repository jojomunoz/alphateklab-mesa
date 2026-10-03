// Reglas de la pantalla táctil de autopedido.

export const INACTIVIDAD_MS = 60_000;
export const AVISO_MS = 10_000;

/**
 * Fase según el tiempo sin tocar la pantalla: activo; aviso (los últimos 10 s, con cuenta regresiva); reposo.
 */
export function faseInactividad(msSinUso, { limite = INACTIVIDAD_MS, aviso = AVISO_MS } = {}) {
  if (!Number.isFinite(msSinUso) || msSinUso < 0) msSinUso = 0;
  if (msSinUso >= limite) return { fase: 'reposo', segundos: 0 };
  if (msSinUso >= limite - aviso) return { fase: 'aviso', segundos: Math.ceil((limite - msSinUso) / 1000) };
  return { fase: 'activo', segundos: Math.ceil((limite - msSinUso) / 1000) };
}

const BEBIDAS = new Set(['bebidas', 'con-alcohol']);
const FUERTES = new Set(['fuertes', 'sopas']);

/**
 * UNA sugerencia, no un muro: si no hay bebida, la primera bebida disponible de la carta (el dueño decide cuál
 * poniéndola primera); si ya hay bebida y hay plato fuerte sin postre, el primer postre disponible. Si no, nada.
 * `carrito`: [{plato}]. Devuelve el plato sugerido o null.
 */
export function sugerencia(carrito, carta) {
  if (!Array.isArray(carrito) || carrito.length === 0) return null;
  const platos = new Map(carta.platos.map((p) => [p.id, p]));
  const cats = new Set(carrito.map((x) => platos.get(x.plato)?.cat).filter(Boolean));
  const enCarrito = new Set(carrito.map((x) => x.plato));
  const primero = (cat) => carta.platos.find((p) => p.cat === cat && !p.agotado && !enCarrito.has(p.id)) ?? null;
  if (![...cats].some((c) => BEBIDAS.has(c))) return primero('bebidas');
  if ([...cats].some((c) => FUERTES.has(c)) && !cats.has('postres')) return primero('postres');
  return null;
}

export function formatoOrden(n) {
  return String(n).padStart(3, '0');
}
