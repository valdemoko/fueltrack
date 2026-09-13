import type { Metadata } from "next";
import { MapaEstacionesLoader } from "@/components/mapa/MapaEstacionesLoader";

export const metadata: Metadata = {
  title: "Mapa de estaciones de servicio",
  description:
    "Mapa interactivo con las estaciones de servicio y precios de carburantes en tiempo real. Datos oficiales del MITECO.",
  openGraph: {
    title: "Mapa de estaciones — FuelTrack",
    description:
      "Explora el mapa interactivo con precios de gasolina y gasóleo.",
  },
};

export default function MapaPage() {
  return (
    <div className="h-screen flex flex-col">
      <main className="flex-1">
        <MapaEstacionesLoader />
      </main>
    </div>
  );
}
