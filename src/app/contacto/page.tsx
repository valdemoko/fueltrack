/**
 * Página de contacto
 * /contacto
 *
 * Solo información de contacto requerida legalmente.
 * Sin formulario — se mantiene limpio y funcional.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Globe, ExternalLink } from "lucide-react";
import { SITE_URL } from "@/lib/siteConfig";

export const metadata: Metadata = {
  title: "Contacto",
  description:
    "Información de contacto para consultas sobre precios de carburantes y el sitio web.",
  alternates: { canonical: "/contacto" },
};

export default function ContactoPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-16">
        <nav className="text-sm text-stone-500 mb-8" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-stone-700 transition-colors">
            Inicio
          </Link>
          <span className="mx-2">/</span>
          <span className="text-stone-700">Contacto</span>
        </nav>

        <h1 className="font-display text-3xl font-bold text-stone-900 mb-8">
          Contacto
        </h1>

        <div className="card max-w-lg">
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-4 h-4 text-amber-600" />
                <h2 className="font-medium text-stone-900">Email</h2>
              </div>
              <a
                href="mailto:contacto@fueltrack.site"
                className="text-amber-600 hover:text-amber-700 text-sm"
              >
                contacto@fueltrack.site
              </a>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Globe className="w-4 h-4 text-amber-600" />
                <h2 className="font-medium text-stone-900">Sitio web</h2>
              </div>
              <a
                href={SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:text-amber-700 text-sm"
              >
                fueltrack.site
              </a>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <ExternalLink className="w-4 h-4 text-amber-600" />
                <h2 className="font-medium text-stone-900">Fuente de datos</h2>
              </div>
              <a
                href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:text-amber-700 text-sm"
              >
                API REST de Carburantes — MITECO
              </a>
            </div>
          </div>
        </div>

        <p className="mt-8 text-sm text-stone-500">
          Los datos de precios de carburantes provienen del Ministerio para
          la Transición Ecológica y el Reto Demográfico (MITECO). Para
          consultar los datos oficiales, accede a la sede electrónica del
          ministerio.
        </p>
      </main>
    </div>
  );
}
