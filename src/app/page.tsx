import Link from "next/link";
import { Map, BarChart3, Clock, Database } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden bg-stone-950 text-white">
        {/* Subtle grid texture */}
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 80% 70% at 30% 30%, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 30% 30%, black 30%, transparent 75%)",
          }}
        />
        {/* Warm accent glow */}
        <div
          className="absolute -top-40 right-0 h-[480px] w-[480px] rounded-full blur-3xl"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle, rgba(217,119,6,0.18) 0%, rgba(217,119,6,0) 70%)",
          }}
        />
        <div
          className="absolute -bottom-52 left-1/3 h-[420px] w-[420px] rounded-full blur-3xl"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle, rgba(180,83,9,0.12) 0%, rgba(180,83,9,0) 70%)",
          }}
        />
        {/* Amber rule accent */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-600/60 to-transparent" aria-hidden="true" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 md:py-32">
          <div className="max-w-2xl">
            <p className="text-amber-400 font-medium text-sm tracking-wide uppercase mb-4">
              Datos oficiales del MITECO
            </p>
            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight mb-6 text-balance">
              Consulta precios de
              <span className="text-amber-400"> carburantes</span> en
              tiempo real
            </h1>
            <p className="text-stone-300 text-lg sm:text-xl leading-relaxed mb-8 max-w-xl">
              Compara precios de gasolina y gasóleo en más de 13.000 estaciones
              de servicio de toda España. Encuentra la más barata cerca de ti y
              analiza la evolución histórica de precios.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/precios"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 active:bg-amber-800 transition-colors text-base"
              >
                <BarChart3 className="w-5 h-5" />
                Ver precios
              </Link>
              <Link
                href="/mapa"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 transition-colors text-base backdrop-blur-sm"
              >
                <Map className="w-5 h-5" />
                Explorar mapa
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 md:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Link href="/gasolineras" className="card hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-4">
              <Map className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="font-display font-semibold text-stone-900 mb-2">
              Gasolineras por provincia y municipio
            </h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Explora las estaciones de toda España por comunidad autónoma,
              provincia y municipio, con precios actualizados y estaciones más
              baratas de cada zona.
            </p>
          </Link>

          <Link href="/precios" className="card hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-4">
              <BarChart3 className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="font-display font-semibold text-stone-900 mb-2">
              Precios actuales y histórico
            </h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Consulta los precios de todos los carburantes disponibles y su
              evolución histórica con datos oficiales del MITECO.
            </p>
          </Link>

          <Link href="/mapa" className="card hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-4">
              <Map className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="font-display font-semibold text-stone-900 mb-2">
              Mapa interactivo
            </h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Explora las estaciones de servicio en el mapa. Filtra por
              combustible y municipio para encontrar lo que necesitas.
            </p>
          </Link>

          <Link href="/metodologia" className="card hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-4">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="font-display font-semibold text-stone-900 mb-2">
              Datos oficiales y transparentes
            </h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Todos los datos provienen del MITECO con licencia CC BY 4.0.
              Consulta cómo se obtienen, normalizan y actualizan.
            </p>
          </Link>
        </div>
      </section>

      {/* Sobre el creador */}
      <section className="bg-stone-50 border-y border-stone-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl font-bold text-stone-900 mb-4">
              Sobre el proyecto
            </h2>
            <div className="space-y-4 text-stone-600 leading-relaxed">
              <p>
                FuelTrack es un proyecto independiente que tiene como
                objetivo facilitar el acceso a los precios oficiales de
                carburantes en España. Todos los datos provienen de la API
                pública del Ministerio para la Transición Ecológica y el Reto
                Demográfico (MITECO).
              </p>
              <p>
                El proyecto es de código abierto y utiliza datos con licencia
                CC BY 4.0. Si encuentras algún error o tienes sugerencias,
                puedes contactar a través del email indicado en el aviso legal.
              </p>
            </div>
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-stone-500">
            <Database className="w-4 h-4" />
            <span>
              Datos actualizados periódicamente desde la API oficial del MITECO
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
