import { SkeletonMapa } from "@/components/ui/Skeleton";

export default function MapaLoading() {
  return (
    <div className="h-screen flex flex-col">
      <header className="bg-green-600 text-white px-4 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Mapa de estaciones</h1>
            <p className="text-green-100 text-sm">Cargando...</p>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <SkeletonMapa />
      </main>
    </div>
  );
}
