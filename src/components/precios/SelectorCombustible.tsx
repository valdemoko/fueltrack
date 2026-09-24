"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProductoCobertura {
  productoId: number;
  nombre: string;
  estacionesConPrecio: number;
}

interface SelectorCombustibleProps {
  productos: ProductoCobertura[];
  seleccionado: number | null;
  /** Ruta base del municipio: /gasolineras/ccaa/provincia/municipio */
  basePath: string;
}

/**
 * Tiempo máximo que se muestra el aviso de carga. Es una RED DE SEGURIDAD, no
 * el camino normal: cuando llega el render del producto pedido, el aviso se
 * quita al instante. Solo entra en juego si la navegación no termina (red
 * caída, respuesta que no cambia el producto seleccionado…). Sin él, un fallo
 * raro dejaría el control bloqueado en "Cargando…" para siempre, que es peor
 * que el problema original.
 */
const MAX_ESPERA_MS = 8000;

/**
 * Selector de combustible de las páginas de municipio y provincia.
 * Navega a la variante indexable ?producto=<id> (o a la URL base para el
 * producto por defecto). Solo se muestran productos con cobertura real.
 *
 * ── POR QUÉ HAY UN INDICADOR DE CARGA (y por qué así) ────────────────────
 *
 * Cambiar de combustible solo modifica `?producto=`, es decir los
 * searchParams de la MISMA ruta. En ese caso React reutiliza el árbol ya
 * montado y NO vuelve a mostrar el `loading.tsx` del segmento: la página se
 * queda con el contenido anterior, sin ninguna señal, hasta que llega el
 * nuevo. Antes de esto, el usuario veía la misma pantalla durante ~2,4 s sin
 * saber si el clic se había registrado.
 *
 * Dos decisiones que merecen explicación:
 *
 *  1. El estado de carga NO usa `useTransition`/`isPending`. Se probó y
 *     `router.push` dentro de una transición puede dejar el estado pendiente
 *     colgado (comprobado con la respuesta de red retardada: seguía cargando
 *     mucho después de haber llegado los datos). Con `isPending` el control
 *     podía quedarse deshabilitado indefinidamente. Ahora el aviso lo gobierna
 *     `esperandoProducto`, que se pone al elegir y se APAGA en cuanto el
 *     componente recibe del servidor el producto pedido: una condición que
 *     depende de los datos, no del ciclo interno del router. Es imposible que
 *     se quede encendido por un comportamiento inesperado de la navegación, y
 *     si algo va mal, `MAX_ESPERA_MS` lo apaga igualmente.
 *  2. Selección OPTIMISTA: el `<select>` se actualiza al instante y no se
 *     deshabilita. Si esperase al servidor, el desplegable mostraría el
 *     carburante antiguo mientras carga y parecería que el clic no se registró;
 *     y bloquearlo impide corregir una elección equivocada sin esperar.
 *
 * Además se prefetchan las otras variantes cuando el usuario apunta al control
 * (ratón encima o foco), para que al elegir el cambio ya esté descargado. Es a
 * propósito por INTENCIÓN y no al montar la página: un rastreador nunca pasa el
 * ratón, así que no se genera ni un render extra por los ~2.300 enlaces
 * indexables.
 *
 * ── OJO AL TOCAR ESTO ────────────────────────────────────────────────────
 * Para comprobar que la caché de datos sigue activa (es lo que hace que el
 * cambio tarde ~0,2 s y no 2,4 s), pedir dos veces la misma URL y cronometrar:
 * si la segunda tarda lo mismo que la primera, la caché se ha desactivado.
 */
export function SelectorCombustible({
  productos,
  seleccionado,
  basePath,
}: SelectorCombustibleProps) {
  const router = useRouter();
  const [valor, setValor] = useState(seleccionado !== null ? String(seleccionado) : "");
  /** Producto pedido al servidor y del que aún no tenemos respuesta. */
  const [esperandoProducto, setEsperandoProducto] = useState<string | null>(null);
  const yaPrefetch = useRef(false);

  // El servidor manda: cuando llega el render del producto pedido, se
  // sincroniza el desplegable y se apaga el aviso de carga.
  useEffect(() => {
    setValor(seleccionado !== null ? String(seleccionado) : "");
    setEsperandoProducto((pedido) =>
      pedido !== null && String(seleccionado) === pedido ? null : pedido
    );
  }, [seleccionado]);

  // Red de seguridad: nunca dejar el aviso encendido indefinidamente.
  useEffect(() => {
    if (esperandoProducto === null) return;
    const t = setTimeout(() => setEsperandoProducto(null), MAX_ESPERA_MS);
    return () => clearTimeout(t);
  }, [esperandoProducto]);

  if (productos.length === 0) return null;

  const orden = ["Gasolina 95 E5", "Gasolina 98 E5", "Gasoleo A", "Gasoleo Premium"];
  const ordenados = [...productos].sort((a, b) => {
    const ia = orden.indexOf(a.nombre);
    const ib = orden.indexOf(b.nombre);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return b.estacionesConPrecio - a.estacionesConPrecio;
  });

  const urlDe = (id: string) => (id ? `${basePath}?producto=${id}` : basePath);
  const cargando = esperandoProducto !== null;

  /** Prefetch de las variantes que el usuario podría elegir (una sola vez). */
  const precalentar = () => {
    if (yaPrefetch.current) return;
    yaPrefetch.current = true;
    for (const p of ordenados) {
      const id = String(p.productoId);
      if (id !== valor) router.prefetch(urlDe(id));
    }
  };

  const elegir = (id: string) => {
    if (id === valor) return;
    setValor(id);
    setEsperandoProducto(id === String(seleccionado) ? null : id);
    router.push(urlDe(id));
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        htmlFor="selector-combustible"
        className="text-sm font-medium text-stone-700"
      >
        Combustible:
      </label>
      <select
        id="selector-combustible"
        value={valor}
        onChange={(e) => elegir(e.target.value)}
        onPointerEnter={precalentar}
        onFocus={precalentar}
        aria-busy={cargando}
        className={`rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 transition-colors focus:border-amber-500 focus:ring-amber-500 ${
          cargando ? "cursor-progress" : ""
        }`}
      >
        {ordenados.map((p) => (
          <option key={p.productoId} value={p.productoId}>
            {p.nombre} ({p.estacionesConPrecio})
          </option>
        ))}
      </select>

      {cargando && (
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-stone-600"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
          />
          Cargando precios…
        </span>
      )}
    </div>
  );
}
