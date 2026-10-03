// localStorage con red: toda lectura y escritura en try/catch, y una copia en memoria para que la página siga
// funcionando si el navegador no deja guardar (ventana privada, almacenamiento bloqueado o lleno).

const PREFIJO = 'atk-mesa:';
const memoria = new Map();
let funciona = null;

export function almacenDisponible() {
  if (funciona !== null) return funciona;
  try {
    const k = `${PREFIJO}__prueba`;
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    funciona = true;
  } catch {
    funciona = false;
  }
  return funciona;
}

export function leer(clave, porOmision = null) {
  try {
    const s = localStorage.getItem(PREFIJO + clave);
    if (s !== null) return JSON.parse(s);
  } catch {
    /* sin almacenamiento o JSON roto: se usa la memoria */
  }
  return memoria.has(clave) ? structuredClone(memoria.get(clave)) : porOmision;
}

export function escribir(clave, valor) {
  memoria.set(clave, valor);
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export function borrar(clave) {
  memoria.delete(clave);
  try {
    localStorage.removeItem(PREFIJO + clave);
  } catch {
    /* nada que borrar */
  }
}

export function claveDeAlmacen(clave) {
  return PREFIJO + clave;
}

/** sessionStorage (para el PIN de mesa, que no debe quedar guardado). */
export function leerSesion(clave, porOmision = null) {
  try {
    const s = sessionStorage.getItem(PREFIJO + clave);
    return s === null ? porOmision : JSON.parse(s);
  } catch {
    return porOmision;
  }
}

export function escribirSesion(clave, valor) {
  try {
    sessionStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
  } catch {
    /* sin sesión: se volverá a pedir */
  }
}
