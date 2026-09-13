import Link from "next/link";
import Image from "next/image";
import { Map, Mail, ExternalLink } from "lucide-react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-stone-900 text-stone-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <Image
                src="/favicon.svg"
                alt=""
                width={32}
                height={32}
                className="rounded-lg"
                aria-hidden="true"
                unoptimized
              />
              <span className="font-display font-bold text-lg text-white">
                FuelTrack
              </span>
            </Link>
            <p className="text-sm leading-relaxed mb-4">
              Consulta precios de carburantes en estaciones de servicio. Datos
              oficiales del MITECO actualizados periódicamente.
            </p>
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <Map className="w-4 h-4" />
              <span>España</span>
            </div>
          </div>

          {/* Precios */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Precios</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/gasolineras" className="hover:text-amber-400 transition-colors">
                  Gasolineras en España
                </Link>
              </li>
              <li>
                <Link href="/precios" className="hover:text-amber-400 transition-colors">
                  Consultar precios
                </Link>
              </li>
              <li>
                <Link href="/mapa" className="hover:text-amber-400 transition-colors">
                  Mapa interactivo
                </Link>
              </li>
              <li>
                <Link href="/metodologia" className="hover:text-amber-400 transition-colors">
                  Metodología
                </Link>
              </li>
              <li>
                <Link href="/precios-espana" className="hover:text-amber-400 transition-colors">
                  Precios en España
                </Link>
              </li>
              <li>
                <Link href="/autor" className="hover:text-amber-400 transition-colors">
                  Autor
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/aviso-legal" className="hover:text-amber-400 transition-colors">
                  Aviso legal
                </Link>
              </li>
              <li>
                <Link href="/politica-privacidad" className="hover:text-amber-400 transition-colors">
                  Política de privacidad
                </Link>
              </li>
              <li>
                <Link href="/politica-cookies" className="hover:text-amber-400 transition-colors">
                  Política de cookies
                </Link>
              </li>
              <li>
                <Link href="/contacto" className="hover:text-amber-400 transition-colors">
                  Contacto
                </Link>
              </li>
              <li>
                <Link href="/autor" className="hover:text-amber-400 transition-colors">
                  Sobre el autor
                </Link>
              </li>
            </ul>
          </div>

          {/* Datos */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Datos</h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a
                  href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-amber-400 transition-colors"
                >
                  Fuente: MITECO
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <span className="text-stone-500">Licencia CC BY 4.0</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-stone-800 mt-8 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm">
              <p>© {currentYear} FuelTrack. Todos los derechos reservados.</p>
            </div>
            <div className="text-xs text-stone-500">
              <p>
                Datos proporcionados por el Ministerio para la Transición Ecológica
                y el Reto Demográfico (MITECO).
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
