/**
 * Página de aviso legal
 * /aviso-legal
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Aviso legal",
  description:
    "Aviso legal de FuelTrack. Información sobre el titular del sitio web, condiciones de uso y propiedad intelectual.",
  alternates: { canonical: "/aviso-legal" },
};

export default function AvisoLegalPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <h1 className="font-display text-3xl font-bold text-stone-900 mb-8">
          Aviso legal
        </h1>
        <div className="card p-8 prose prose-stone max-w-none">
          <h2>1. Datos del titular</h2>
          <p>
            En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de
            la Sociedad de la Información y de Comercio Electrónico (LSSI-CE),
            se informa a los usuarios de los datos del titular del sitio web:
          </p>
          <ul>
            <li>
              <strong>Nombre comercial:</strong> FuelTrack
            </li>
            <li>
              <strong>Web:</strong> fueltrack.site
            </li>
            <li>
              <strong>Actividad:</strong> Consulta de precios de carburantes en
              estaciones de servicio de toda España
            </li>
          </ul>

          <h2>2. Condiciones de uso</h2>
          <p>
            El acceso y uso de este sitio web atribuye la condición de Usuario
            e implica la aceptación plena de todas las condiciones establecidas
            en este Aviso Legal. El Usuario se compromete a hacer un uso
            adecuado del sitio web de conformidad con la ley, la buena fe y el
            orden público.
          </p>

          <h2>3. Propiedad intelectual e industrial</h2>
          <p>
            Todos los contenidos de este sitio web (textos, imágenes, gráficos,
            iconos, tecnología, software, enlaces y otros contenidos
            audiovisuales o sonoros) son propiedad intelectual de FuelTrack o de
            terceros, sin que puedan entenderse cedidos al Usuario ninguno de
            los derechos de explotación reconocidos por la normativa vigente
            sobre propiedad intelectual.
          </p>
          <p>
            Las marcas, nombres comerciales o signos distintivos son titularidad
            de sus propietarios. El acceso a los mismos no atribuye ningún
            derecho sobre los mismos.
          </p>

          <h2>4. Fuentes de datos</h2>
          <p>
            Los datos de precios de carburantes mostrados en este sitio web
            provienen de la API oficial del Ministerio para la Transición
            Ecológica y el Reto Demográfico (MITECO):
          </p>
          <p>
            <a
              href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/
            </a>
          </p>
          <p>
            Los datos están sujetos a la licencia{" "}
            <strong>CC BY 4.0</strong> (Conforme al Reglamento (UE) 2023/138
            del Parlamento Europeo y del Consejo y a la Ley 37/2007, de 16 de
            noviembre, sobre reutilización de la información del sector público).
          </p>

          <h2>5. Exención de responsabilidad</h2>
          <p>
            FuelTrack no se hace responsable, en ningún caso, de:
          </p>
          <ul>
            <li>
              Los errores u omisiones en los datos mostrados, ya que estos
              provienen de una fuente oficial externa.
            </li>
            <li>
              La disponibilidad del servicio o la continuidad del sitio web.
            </li>
            <li>
              Los daños o perjuicios que puedan causar virus o programas
              maliciosos en el equipo del Usuario.
            </li>
            <li>
              El uso que el Usuario haga de los contenidos del sitio web.
            </li>
          </ul>

          <h2>6. Enlaces</h2>
          <p>
            Este sitio web puede contener enlaces a sitios de terceros. El
            Usuario reconoce y acepta que FuelTrack no tiene control
            sobre el contenido o las políticas de privacidad de dichos sitios
            web, y no asume responsabilidad alguna por ellos.
          </p>

          <h2>7. Protección de datos</h2>
          <p>
            Para información sobre cómo tratamos sus datos personales, consulte
            nuestra{" "}
            <Link
              href="/politica-privacidad"
              className="text-amber-600 hover:text-amber-700"
            >
              Política de Privacidad
            </Link>
            .
          </p>

          <h2>8. Cookies</h2>
          <p>
            Para información sobre el uso de cookies, consulte nuestra{" "}
            <Link
              href="/politica-cookies"
              className="text-amber-600 hover:text-amber-700"
            >
              Política de Cookies
            </Link>
            .
          </p>

          <h2>9. Modificaciones</h2>
          <p>
            FuelTrack se reserva el derecho de modificar este aviso
            legal en cualquier momento. Se recomienda revisarlo periódicamente.
          </p>

          <h2>10. Legislación aplicable</h2>
          <p>
            Las relaciones entre el Usuario y FuelTrack se rigen por
            la legislación española. Para la resolución de cualquier
            controversia, las partes se someterán a los Juzgados y Tribunales
            de Málaga.
          </p>
        </div>
      </main>
    </div>
  );
}