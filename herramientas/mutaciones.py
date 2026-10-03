# Prueba de las pruebas: rompe a propósito cada regla de negocio en una copia del repo y comprueba que
# `node --test pruebas/` falla. Si una mutación sobrevive, esa regla no está probada.
#   python3 herramientas/mutaciones.py
import subprocess, shutil, os, sys, tempfile
ORIG=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP=os.path.join(tempfile.mkdtemp(prefix='atk-mesa-mutante-'), 'repo')
MUT=[
 ('redondeo al piso en vez de mitad arriba','js/nucleo/dinero.mjs','return Math.floor((2 * numerador + denominador) / (2 * denominador));','return Math.floor(numerador / denominador);'),
 ('ITBMS sumado en vez de contenido','js/nucleo/dinero.mjs','return dividirRedondeando(montoC * tasa, 100 + tasa);','return dividirRedondeando(montoC * tasa, 100);'),
 ('ITBMS de cada renglón en cero','js/nucleo/dinero.mjs','const imp = impuestoContenido(r.monto, r.tasa);','const imp = 0;'),
 ('propina 10 % por omisión','js/nucleo/propina.mjs',"if (!eleccion || typeof eleccion !== 'object') return { ok: false, motivo: 'sin-eleccion' };","if (!eleccion || typeof eleccion !== 'object') eleccion = { tipo: 'pct', pct: 10 };"),
 ('propina libre sin tope','js/nucleo/propina.mjs',"if (m > baseC) return { ok: false, motivo: 'monto-alto' };",""),
 ('el resto va a la última parte','js/nucleo/division.mjs','base + (i < resto ? 1 : 0)','base + (i === n - 1 ? resto : 0)'),
 ('se pierde el resto','js/nucleo/division.mjs','base + (i < resto ? 1 : 0)','base'),
 ('compartido sin repartir el resto','js/nucleo/division.mjs','const trozos = partesIguales(r.monto, quienes.length);','const trozos = quienes.map(() => Math.floor(r.monto / quienes.length));'),
 ('servido vuelve a listo','js/nucleo/estados.mjs',"  servido: [],\n  rechazado: [],","  servido: ['listo'],\n  rechazado: [],"),
 ('sin idempotencia','js/nucleo/caja.mjs',"if (estado.vistos.includes(accion.id)) return { estado, cambio: false, repetido: true };",""),
 ('el relevo puede confirmar pagos','js/nucleo/caja.mjs',"if (remoto && !TIPOS_COMENSAL.has(accion.tipo)) return { estado, cambio: false, error: 'no-permitido' };",""),
 ('aprobación apagada por omisión','js/nucleo/caja.mjs',"  return 'por-aceptar';\n}","  return 'enviado';\n}"),
 ('sin límite de pedidos por aceptar','js/nucleo/caja.mjs',"return fallo('demasiados');","/* sin tope */"),
 ('PIN no se revisa','js/nucleo/caja.mjs',"if (e.ajustes.pin && String(a.datos?.pin ?? '') !== String(mp.pin ?? '')) return fallo('pin');",""),
 ('pendiente cuenta como pagado','js/nucleo/cuenta.mjs',"return r.total > 0 && r.saldoConfirmado <= 0 && r.porAceptar === 0;","return r.total > 0 && r.saldo <= 0 && r.porAceptar === 0;"),
 ('dividir con pagos hechos','js/nucleo/cuenta.mjs',"if ((cuenta?.pagos ?? []).some(vivo)) return { ok: false, error: 'division-bloqueada' };",""),
 ('liberar con saldo','js/nucleo/caja.mjs',"if (m.estado === 'ocupada' && r.total > 0) return fallo('saldo-pendiente', r.saldoConfirmado);",""),
 ('precio del teléfono','js/nucleo/carta.mjs',"const unit = plato.precio + sel.mods.reduce((s, m) => s + m.precio, 0);","const unit = pedido.unit ?? plato.precio + sel.mods.reduce((s, m) => s + m.precio, 0);"),
 ('agotado se puede pedir','js/nucleo/carta.mjs',"if (plato.agotado) return { ok: false, error: 'agotado', plato: plato.id };",""),
 ('semáforo ámbar desde 11','js/nucleo/cocina.mjs','if (minutos < UMBRAL_AMBAR)','if (minutos <= UMBRAL_AMBAR)'),
 ('kiosco sin aviso','js/nucleo/kiosco.mjs',"if (msSinUso >= limite - aviso) return","if (false) return"),
 ('NDEF sin TLV terminador','js/nucleo/url.mjs','return 8 + largo;','return 7 + largo;'),
 ('resumen sin recortar','js/nucleo/resumen.mjs','if (bytesDe(s) <= LIMITE_BYTES) return s;','return s;'),
 ('resumen sin dispositivo del pago','js/nucleo/resumen.mjs','p.estado, p.disp ?? null]','p.estado]'),
 ('pixbae más claro (contraste)','css/tokens.css','--sobre-pixbae: #fbfcfa;','--sobre-pixbae: #f0a090;'),
 ('mensaje sin validar mesa','js/nucleo/mensajes.mjs',"if (m.mesa !== null && m.mesa !== undefined && !(Number.isInteger(m.mesa) && m.mesa >= 1 && m.mesa <= 999)) return { ok: false, error: 'mesa' };",""),
 ('plano deja salir mesas','js/nucleo/plano.mjs','return { x: limitar(Math.round(x), 0, ANCHO - w), y: limitar(Math.round(y), 0, Math.max(0, alto - h)) };','return { x: Math.round(x), y: Math.round(y) };'),
 ('la fonda cobra 7 %','js/nucleo/dinero.mjs',"return tipoLocal === 'fonda' && tasaPlato === 7 ? 0 : tasaPlato;","return tasaPlato;"),
 ('la fonda tampoco cobra el alcohol','js/nucleo/dinero.mjs',"return tipoLocal === 'fonda' && tasaPlato === 7 ? 0 : tasaPlato;","return tipoLocal === 'fonda' ? 0 : tasaPlato;"),
 ('la caja ignora el tipo de local','js/nucleo/caja.mjs',"const res = armarRenglon(e.carta, r, { tipoLocal: e.ajustes.tipoLocal });","const res = armarRenglon(e.carta, r);"),
 ('quitar mesa ocupada','js/nucleo/plano.mjs',"if (ocupadas.has(m.numero)) return { ok: false, error: `La mesa ${m.numero} tiene una cuenta abierta. Cóbrala y libérala antes de quitarla.` };",""),
 ('pedido tras pagar no reabre la mesa','js/nucleo/caja.mjs',"if (m.estado === 'libre' || m.estado === 'pagada') {","if (m.estado === 'libre') {"),
 ('pagada con pedidos por aceptar','js/nucleo/cuenta.mjs',"return r.total > 0 && r.saldoConfirmado <= 0 && r.porAceptar === 0;","return r.total > 0 && r.saldoConfirmado <= 0;"),
 ('liberar con pagos pendientes','js/nucleo/caja.mjs',"if ((m.cuenta?.pagos ?? []).some((p) => p.estado === 'pendiente')) return fallo('pagos-pendientes');",""),
 ('pagar una parte con otro monto','js/nucleo/caja.mjs',"if (parte.monto !== d.monto) return fallo('monto');",""),
 ('aviso atendido se puede cancelar','js/nucleo/estados.mjs',"  atendida: [],\n  cancelada: [],","  atendida: ['cancelada'],\n  cancelada: [],"),
 ('más de 30 renglones','js/nucleo/caja.mjs',"if (lista.length > MAX_RENGLONES) return fallo('pedido-largo');",""),
 ('cantidad hasta 99','js/nucleo/carta.mjs','export const MAX_CANT = 20;','export const MAX_CANT = 99;'),
 ('por atender al revés','js/nucleo/caja.mjs','return out.sort((a, b) => a.t - b.t);','return out.sort((a, b) => b.t - a.t);'),
 ('nombre del local vacío','js/nucleo/caja.mjs','if (!s || s.length > 60)','if (s.length > 60)'),
 ('kiosco no vuelve a 001','js/nucleo/caja.mjs','e.kiosco.siguiente = numero >= 999 ? 1 : numero + 1;','e.kiosco.siguiente = numero + 1;'),
 ('m=1e1 es la mesa 10','js/nucleo/url.mjs',r"&& /^\d+$/.test(m.trim())",''),
 ('el rechazo no vuelve al teléfono','js/nucleo/intentos.mjs',"if (e) intentos.set(id, { tipo: 'pedido'","if (false) intentos.set(id, { tipo: 'pedido'"),
 ('el PIN queda guardado en el teléfono','js/nucleo/intentos.mjs',"if (!datos || typeof datos !== 'object' || !('pin' in datos)) return datos;","return datos;"),
 ('el parche no lleva los grupos de opciones','js/nucleo/carta.mjs',"if (Object.keys(grupos).length) parche.grupos = grupos;",""),
 ('el parche no lleva los platos nuevos','js/nucleo/carta.mjs',"if (nuevos.length) parche.nuevos = nuevos;",""),
 ('la semilla se refresca con un pedido nuevo','js/nucleo/semilla.mjs',"for (const m of Object.values(estado.mesas ?? {})) {","for (const m of []) {"),
 ('la fonda dice «ITBMS incluido»','js/nucleo/textos.mjs',"tipoLocal === 'fonda' ? 'preciosFonda' : 'preciosIncluyen'","'preciosIncluyen'"),
]
atrapadas=0
for nombre, archivo, a, b in MUT:
    if os.path.exists(TMP): shutil.rmtree(TMP)
    shutil.copytree(ORIG, TMP, ignore=shutil.ignore_patterns('.git','capturas'))
    ruta=os.path.join(TMP, archivo)
    s=open(ruta).read()
    if a not in s:
        print('NO APLICA', nombre); continue
    open(ruta,'w').write(s.replace(a,b,1))
    r=subprocess.run(['node','--test','pruebas/'],cwd=TMP,capture_output=True,text=True)
    falla='# fail 0' not in r.stdout
    atrapadas+=falla
    print(('atrapada  ' if falla else 'SOBREVIVE ')+nombre)
print(f'{atrapadas} de {len(MUT)} mutaciones atrapadas')
shutil.rmtree(os.path.dirname(TMP))
sys.exit(0 if atrapadas == len(MUT) else 1)
