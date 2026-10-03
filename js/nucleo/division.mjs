// Dividir la cuenta sin perder ni inventar centésimos.

export const MAX_PARTES = 20;

/**
 * N partes iguales. El resto de la división se reparte de a 1 centésimo en las primeras partes:
 * 100 entre 3 = [34, 33, 33]. La suma siempre es el total.
 */
export function partesIguales(totalC, n) {
  if (!Number.isSafeInteger(totalC) || totalC < 0) throw new RangeError('total no válido');
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTES) throw new RangeError(`partes entre 1 y ${MAX_PARTES}`);
  const base = Math.floor(totalC / n);
  const resto = totalC - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * Por platos. `renglones`: [{clave, monto}]. `asignacion`: {clave: [índices de persona]}. Un renglón con varias
 * personas se reparte en partes iguales entre ellas (con el mismo criterio de centésimos, en el orden de las
 * personas). Lo que nadie tomó queda en `sinAsignar`.
 * Devuelve {partes:[monto por persona], detalle:[[{clave, monto}]], sinAsignar:[{clave, monto}], total}.
 */
export function porPlatos(renglones, asignacion, nPersonas) {
  if (!Number.isInteger(nPersonas) || nPersonas < 1 || nPersonas > MAX_PARTES) {
    throw new RangeError(`personas entre 1 y ${MAX_PARTES}`);
  }
  const partes = Array(nPersonas).fill(0);
  const detalle = Array.from({ length: nPersonas }, () => []);
  const sinAsignar = [];
  let total = 0;
  for (const r of renglones) {
    if (!Number.isSafeInteger(r.monto) || r.monto < 0) throw new RangeError(`monto no válido en ${r.clave}`);
    total += r.monto;
    const quienes = [...new Set(asignacion?.[r.clave] ?? [])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < nPersonas)
      .sort((a, b) => a - b);
    if (quienes.length === 0) {
      sinAsignar.push({ clave: r.clave, monto: r.monto });
      continue;
    }
    const trozos = partesIguales(r.monto, quienes.length);
    quienes.forEach((persona, k) => {
      partes[persona] += trozos[k];
      detalle[persona].push({ clave: r.clave, monto: trozos[k] });
    });
  }
  return { partes, detalle, sinAsignar, total };
}
