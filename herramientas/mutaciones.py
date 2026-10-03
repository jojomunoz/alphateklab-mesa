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
