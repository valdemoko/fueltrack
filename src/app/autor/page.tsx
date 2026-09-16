/**
 * Página de autor: /autor
 *
 * Transmite que existe una persona responsable del proyecto, con la
 * información verificable disponible. Sin biografía inventada: solo lo que
 * el propio proyecto documenta (rol, filosofía, fuentes, contacto).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SITE_NAME, SITE_URL } from "@/lib/siteConfig";

export const metadata: Metadata = {
  title: "Autor — Quién está detrás de este proyecto",
  description:
    "Miguel Iglesias Valenzuela, creador y responsable de FuelTrack. Desarrolla y mantiene las herramientas y recursos del sitio y revisa el contenido para mantenerlo útil, claro y actualizado.",
  alternates: { canonical: "/autor" },
};

const LINKEDIN_URL =
  "https://www.linkedin.com/in/miguel-iglesias-valenzuela-14069b367/";

export default function AutorPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${SITE_URL}/autor#person`,
    name: "Miguel Iglesias Valenzuela",
    url: `${SITE_URL}/autor`,
    sameAs: [LINKEDIN_URL],
    worksFor: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return (
    <div className="min-h-screen bg-surface-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-16">
        <nav className="text-sm text-stone-500 mb-8" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-amber-600 transition-colors">
            Inicio
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-700">Autor</span>
        </nav>

        <h1 className="font-display text-3xl font-bold text-stone-900 mb-8">
          Sobre el autor
        </h1>

        <div className="card p-6 md:p-8 space-y-6">
          <div>
            <h2 className="font-display text-xl font-semibold text-stone-900">
              Miguel Iglesias Valenzuela
            </h2>
            <p className="text-sm text-stone-500 mt-1">
              Creador y responsable de {SITE_NAME}
            </p>
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-amber-600 hover:text-amber-700"
            >
              <ExternalLink className="w-4 h-4" />
              Perfil profesional en LinkedIn
            </a>
          </div>

          <div className="space-y-4 text-stone-600 leading-relaxed">
            <p>
              Miguel Iglesias Valenzuela es el creador y la persona responsable
              de este proyecto. Desarrolla y mantiene las herramientas y los
              recursos disponibles en este sitio y revisa el contenido para
              mantenerlo útil, claro y actualizado.
            </p>
            <p>
              El objetivo del proyecto es hacer accesibles los datos oficiales
              que el Ministerio para la Transición Ecológica y el Reto
              Demográfico (MITECO) publica sobre los precios de las estaciones
              de servicio, de forma clara, rápida y transparente.
            </p>
            <p>
              La filosofía del sitio es simple: mostrar solo lo que los datos
              reales permiten afirmar. Los precios provienen de la fuente
              oficial, el histórico se construye con observaciones reales y la{" "}
              <Link
                href="/metodologia"
                className="text-amber-600 hover:text-amber-700"
              >
                metodología
              </Link>{" "}
              explica exactamente cómo se procesa cada dato. No se inventan
              horarios, servicios ni valoraciones: si la fuente no publica una
              información, no aparece en la web.
            </p>
            <p>
              Si detectas un error o quieres hacer una sugerencia, puedes
              escribir a través de la{" "}
              <Link href="/contacto" className="text-amber-600 hover:text-amber-700">
                página de contacto
              </Link>
              .
            </p>
          </div>

          <div className="pt-4 border-t border-stone-200">
            <h3 className="text-sm font-semibold text-stone-900 mb-2">
              Responsabilidad sobre los contenidos
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              Los datos mostrados proceden de la API pública del MITECO y se
              reutilizan conforme a la licencia CC BY 4.0. La corrección de
              cualquier dato de origen corresponde a la estación y al
              ministerio; este sitio se limita a reflejar la fuente oficial
              sin alterar sus valores. Ver{" "}
              <Link
                href="/aviso-legal"
                className="text-amber-600 hover:text-amber-700"
              >
                aviso legal
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
