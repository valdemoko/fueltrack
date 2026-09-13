"use client";

// ─── Props ─────────────────────────────────────────────────────────────────
interface LeyendaPreciosProps {
  min: number;
  max: number;
  promedio: number;
}

// ─── Componente ────────────────────────────────────────────────────────────
export function LeyendaPrecios({ min, max, promedio }: LeyendaPreciosProps) {
  return (
    <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-lg shadow-lg p-3 text-sm" role="complementary" aria-label="Leyenda de colores de precios">
      <div className="font-medium text-gray-700 mb-2">Precios €/L</div>

      {/* Barra de gradiente */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="h-3 w-32 rounded"
          style={{
            background: "linear-gradient(to right, #22c55e, #f59e0b, #dc2626)",
          }}
        />
      </div>

      {/* Etiquetas */}
      <div className="flex justify-between text-xs text-gray-500 w-32">
        <span>{min.toFixed(3)}€</span>
        <span>{promedio.toFixed(3)}€</span>
        <span>{max.toFixed(3)}€</span>
      </div>

      {/* Leyenda de colores */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-xs text-gray-600">Barato</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-xs text-gray-600">Precio medio</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-600" />
          <span className="text-xs text-gray-600">Caro</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-400" />
          <span className="text-xs text-gray-600">Sin precio</span>
        </div>
      </div>
    </div>
  );
}
