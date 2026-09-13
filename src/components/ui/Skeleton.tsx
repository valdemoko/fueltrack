/**
 * Componente Skeleton para estados de carga
 * Muestra pulsación de animación suave mientras se cargan datos
 */
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      aria-hidden="true"
    />
  );
}

/** Skeleton para tarjeta de estación */
export function SkeletonEstacion() {
  return (
    <div className="bg-white rounded-lg shadow p-4" aria-busy="true" aria-label="Cargando estación...">
      <Skeleton className="h-5 w-3/4 mb-3" />
      <Skeleton className="h-4 w-1/2 mb-2" />
      <Skeleton className="h-4 w-2/3 mb-4" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

/** Skeleton para tabla de precios */
export function SkeletonTablaPrecios() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true" aria-label="Cargando precios...">
      <Skeleton className="h-6 w-48 mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4">
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-8 w-1/2 mb-1" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton para gráfico histórico */
export function SkeletonGrafico() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true" aria-label="Cargando gráfico...">
      <Skeleton className="h-6 w-48 mb-4" />
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-[300px] w-full" />
    </div>
  );
}

/** Skeleton para mapa */
export function SkeletonMapa() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-100" aria-busy="true" aria-label="Cargando mapa...">
      <div className="text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-600 border-t-transparent mx-auto mb-3" />
        <p className="text-sm text-gray-500">Cargando mapa...</p>
      </div>
    </div>
  );
}
