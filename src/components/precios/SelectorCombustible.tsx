"use client";

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
 * Selector de combustible de la página de municipio.
 * Navega a la variante indexable ?producto=<id> (o a la URL base para el
 * producto por defecto). Solo se muestran productos con cobertura real.
 */
export function SelectorCombustible({
  productos,
  seleccionado,
  basePath,
}: SelectorCombustibleProps) {
  const router = useRouter();

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        htmlFor="selector-combustible"
        className="text-sm font-medium text-stone-700"
      >
        Combustible:
      </label>
      <select
        id="selector-combustible"
        value={seleccionado ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `${basePath}?producto=${id}` : basePath);
        }}
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-amber-500 focus:ring-amber-500"
      >
        {ordenados.map((p) => (
          <option key={p.productoId} value={p.productoId}>
            {p.nombre} ({p.estacionesConPrecio})
          </option>
        ))}
      </select>
    </div>
  );
}
