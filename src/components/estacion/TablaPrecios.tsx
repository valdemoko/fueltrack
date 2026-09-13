/**
 * Tabla de precios de una estación de servicio
 * Muestra todos los productos disponibles con su precio actual
 */
interface ProductoPrecio {
  productoId: number;
  nombre: string;
  abreviatura: string;
  precio: number | null;
}

interface TablaPreciosProps {
  precios: ProductoPrecio[];
}

// ─── Colores por tipo de combustible ──────────────────────────────────────
function getProductoColor(abreviatura: string): string {
  if (abreviatura.includes("G95")) return "#22c55e"; // verde - gasolina 95
  if (abreviatura.includes("G98")) return "#3b82f6"; // azul - gasolina 98
  if (abreviatura.includes("Gasóleo A")) return "#f59e0b"; // ámbar - gasóleo A
  if (abreviatura.includes("Gasóleo P")) return "#ef4444"; // rojo - gasóleo premium
  if (abreviatura.includes("Gasóleo")) return "#f97316"; // naranja - gasóleo B/C
  if (abreviatura.includes("GLP")) return "#8b5cf6"; // púrpura - GLP
  if (abreviatura.includes("GNC")) return "#06b6d4"; // cian - GNC
  if (abreviatura.includes("AdBlue")) return "#6366f1"; // índigo - AdBlue
  return "#6b7280"; // gris - otros
}

export function TablaPrecios({ precios }: TablaPreciosProps) {
  // Solo mostrar productos con precio disponible
  const preciosDisponibles = precios.filter((p) => p.precio !== null);
  const preciosNoDisponibles = precios.filter((p) => p.precio === null);

  if (preciosDisponibles.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Precios actuales
        </h3>
        <p className="text-gray-500">No hay precios disponibles actualmente.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Precios actuales
      </h3>

      {/* Productos con precio */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="list" aria-label="Lista de precios por combustible">
        {preciosDisponibles.map((producto) => {
          const color = getProductoColor(producto.abreviatura);
          return (
            <div
              key={producto.productoId}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow"
              role="listitem"
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm font-medium text-gray-700">
                  {producto.nombre}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className="text-2xl font-bold"
                  style={{ color }}
                >
                  {producto.precio!.toFixed(3)}
                </span>
                <span className="text-sm text-gray-500">€/L</span>
              </div>
              <span className="text-xs text-gray-400">{producto.abreviatura}</span>
            </div>
          );
        })}
      </div>

      {/* Productos sin precio */}
      {preciosNoDisponibles.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 rounded">
            {preciosNoDisponibles.length} productos sin precio disponible
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {preciosNoDisponibles.map((producto) => (
              <span
                key={producto.productoId}
                className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded"
              >
                {producto.abreviatura}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}