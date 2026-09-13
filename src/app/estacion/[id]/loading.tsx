import { Skeleton, SkeletonTablaPrecios, SkeletonGrafico } from "@/components/ui/Skeleton";

export default function EstacionLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Cabecera */}
      <header className="bg-green-600 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Skeleton className="h-4 w-32 mb-2 bg-green-500/30" />
          <Skeleton className="h-7 w-64 mb-1 bg-green-500/30" />
          <Skeleton className="h-4 w-48 bg-green-500/30" />
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Info estación */}
            <div className="bg-white rounded-lg shadow p-6">
              <Skeleton className="h-6 w-48 mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-3 w-20 mb-1" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </div>

            <SkeletonTablaPrecios />
            <SkeletonGrafico />
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <Skeleton className="h-6 w-32 mb-4" />
              <Skeleton className="h-10 w-full mb-3" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
