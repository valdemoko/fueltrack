import type { Metadata } from "next";
import Link from "next/link";
import { MapaEstacionesLoader } from "@/components/mapa/MapaEstacionesLoader";
import {
  BotonInfoMapa,
  BotonVolverAlMapa,
} from "@/components/mapa/BotonesInfoMapa";

export const metadata: Metadata = {
  title: "Mapa de estaciones de servicio",
  description:
    "Mapa interactivo con las estaciones de servicio y precios de carburantes en tiempo real. Datos oficiales del MITECO.",
  alternates: { canonical: "/mapa" },
  openGraph: {
    title: "Mapa de estaciones — FuelTrack",
    description:
      "Explora el mapa interactivo con precios de gasolina y gasóleo.",
  },
};

export default function MapaPage() {
  return (
    <div>
      {/* El mapa ocupa TODA la pantalla bajo el header (100dvh − 4rem):
          no hay scroll de página mientras se ve el mapa. La sección de
          ayuda y el footer siguen renderizados en el HTML (SEO/AdSense),
          pero solo se ven con el botón "Cómo se usa", que libera el
          scroll y desplaza hasta ellos (ver BotonesInfoMapa). */}
      <main
        id="mapa"
        className="mapa-pantalla-completa flex flex-col
                   h-[calc(100dvh-4rem)]"
      >
        <MapaEstacionesLoader />
      </main>

      {/* Contexto textual SSR (indexable): el mapa es un componente cliente
          sin contenido HTML inicial, así que este bloque explica la
          herramienta para el usuario y para el rastreador. Texto estático:
          no añade consultas a la base de datos. Se accede con el botón
          "Cómo se usa" del mapa, que libera el scroll y baja hasta aquí. */}
      <section
        id="como-usar-mapa"
        aria-label="Sobre este mapa"
        className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-stone-600 leading-relaxed space-y-4"
      >
        <h2 className="font-display text-2xl font-bold text-stone-900">
          Cómo usar el mapa de gasolineras
        </h2>
        <p>
          Este mapa muestra las estaciones de servicio con precio publicado en
          la última observación oficial disponible, con el precio por litro de
          cada combustible sobre el marcador de la estación. Al abrirlo en un
          municipio concreto (desde cualquier{" "}
          <Link href="/gasolineras" className="text-amber-600 hover:text-amber-700">
            página de municipio
          </Link>
          ), el mapa se centra automáticamente en esa área; también acepta
          parámetros en la URL para abrir directamente un municipio y un
          producto determinados.
        </p>
        <p>
          <strong>Filtros:</strong> puedes elegir el combustible (gasolina 95,
          gasolina 98, gasóleo A, gasóleo premium y otros productos que
          comunican las estaciones al ministerio) y el marcador cambia al
          precio del producto seleccionado. Con el buscador del mapa puedes
          desplazarte a cualquier zona de España y ver las estaciones del
          área visible.
        </p>
        <p>
          <strong>Actualización y limitaciones:</strong> los precios provienen
          de la API oficial del MITECO (licencia CC BY 4.0) y se actualizan a
          diario mediante un proceso automático. El mapa muestra la última
          observación publicada por cada estación: si una estación no ha
          comunicado precios recientemente, sus marcadores pueden mostrar
          datos desactualizados, y la fecha de referencia se indica en la
          propia interfaz. El mapa es una herramienta de exploración visual:
          para comparar estadísticas de un área (precio medio, mínimo y
          máximo) usa la{" "}
          <Link href="/precios" className="text-amber-600 hover:text-amber-700">
            herramienta de precios
          </Link>
          , y para entender cómo se tratan los datos consulta la{" "}
          <Link href="/metodologia" className="text-amber-600 hover:text-amber-700">
            metodología
          </Link>
          .
        </p>
        <p>
          <BotonVolverAlMapa />
        </p>
      </section>
    </div>
  );
}
