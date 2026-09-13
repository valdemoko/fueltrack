/**
 * Política de Privacidad
 * /politica-privacidad
 *
 * Conforme al RGPD (Reglamento (UE) 2016/679) y la LOPDGDD (Ley 3/2018).
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidad — FuelTrack",
  description:
    "Política de privacidad de FuelTrack. Información sobre el tratamiento de datos personales conforme al RGPD.",
};

export default function PoliticaPrivacidadPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <h1 className="font-display text-3xl font-bold text-stone-900 mb-8">
          Política de Privacidad
        </h1>
        <div className="card p-8 prose prose-stone max-w-none">
          <h2>1. Responsable del tratamiento</h2>
          <p>
            <strong>Nombre comercial:</strong> FuelTrack
          </p>
          <p>
            <strong>Web:</strong> fueltrack.site
          </p>
          <p>
            <strong>Actividad:</strong> Consulta de precios de carburantes en
            estaciones de servicio de la provincia de Málaga
          </p>

          <h2>2. Datos que recopilamos</h2>
          <p>
            <strong>Datos de navegación:</strong> Cuando usted visita nuestro
            sitio web, podemos recopilar información automáticamente como su
            dirección IP, tipo de navegador, sistema operativo, páginas
            visitadas y fecha/hora de acceso. Esta información se obtiene a
            través de cookies y tecnologías similares.
          </p>
          <p>
            <strong>Datos que no recopilamos:</strong> No recopilamos datos
            personales identificativos (nombre, email, teléfono) a menos que
            usted nos los proporcione voluntariamente a través del formulario
            de contacto.
          </p>

          <h2>3. Finalidad del tratamiento</h2>
          <p>Los datos se utilizan para:</p>
          <ul>
            <li>
              <strong>Proporcionar el servicio:</strong> Mostrar precios de
              carburantes y estaciones de servicio de Málaga.
            </li>
            <li>
              <strong>Mejorar el servicio:</strong> Analizar el uso del sitio
              web para mejorar la experiencia del usuario.
            </li>
            <li>
              <strong>Publicidad:</strong> Mostrar anuncios relevantes a través
              de Google AdSense, que puede utilizar cookies para personalizar
              los anuncios.
            </li>
            <li>
              <strong>Cumplimiento legal:</strong> Cumplir con nuestras
              obligaciones legales.
            </li>
          </ul>

          <h2>4. Base legal del tratamiento</h2>
          <ul>
            <li>
              <strong>Interés legítimo:</strong> Para el análisis de uso del
              sitio web y la mejora del servicio.
            </li>
            <li>
              <strong>Consentimiento:</strong> Para el uso de cookies de
              terceros (publicidad y análisis), que se obtienen a través de
              nuestro banner de cookies.
            </li>
          </ul>

          <h2>5. Cookies</h2>
          <p>
            Utilizamos cookies y tecnologías similares. Para más información,
            consulte nuestra{" "}
            <Link
              href="/politica-cookies"
              className="text-amber-600 hover:text-amber-700"
            >
              Política de Cookies
            </Link>
            .
          </p>

          <h2>6. Destinatarios de los datos</h2>
          <p>
            <strong>Google AdSense:</strong> Los datos de navegación pueden ser
            compartidos con Google LLC para la personalización de anuncios.
            Google actúa como encargado del tratamiento. Más información:{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Política de Privacidad de Google
            </a>
            .
          </p>
          <p>
            No se realizan transferencias internacionales de datos adicionales
            a las necesarias para el funcionamiento de Google AdSense.
          </p>

          <h2>7. Conservación de los datos</h2>
          <ul>
            <li>
              <strong>Datos de navegación:</strong> Se conservan durante un
              máximo de 26 meses.
            </li>
            <li>
              <strong>Datos del formulario de contacto:</strong> Se conservan
              hasta que se resuelva su solicitud y durante un máximo de 12
              meses.
            </li>
          </ul>

          <h2>8. Derechos del interesado</h2>
          <p>
            Conforme al RGPD, usted tiene derecho a:
          </p>
          <ul>
            <li>
              <strong>Acceso:</strong> Solicitar información sobre los datos
              personales que tratamos.
            </li>
            <li>
              <strong>Rectificación:</strong> Solicitar la corrección de datos
              inexactos.
            </li>
            <li>
              <strong>Supresión:</strong> Solicitar la eliminación de sus datos
              personales.
            </li>
            <li>
              <strong>Limitación:</strong> Solicitar la limitación del
              tratamiento de sus datos.
            </li>
            <li>
              <strong>Portabilidad:</strong> Recibir sus datos en un formato
              estructurado.
            </li>
            <li>
              <strong>Oposición:</strong> Oponerse al tratamiento de sus datos
              personales.
            </li>
          </ul>
          <p>
            Para ejercer estos derechos, puede contactarnos a través de
            nuestro{" "}
            <Link
              href="/contacto"
              className="text-amber-600 hover:text-amber-700"
            >
              formulario de contacto
            </Link>
            .
          </p>

          <h2>9. Reclamaciones</h2>
          <p>
            Si considera que el tratamiento de sus datos no se ajusta a la
            normativa vigente, tiene derecho a presentar una reclamación ante
            la autoridad de control:
          </p>
          <p>
            <strong>Agencia Española de Protección de Datos (AEPD)</strong>
            <br />
            <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">
              www.aepd.es
            </a>
          </p>

          <h2>10. Actualizaciones</h2>
          <p>
            Esta política de privacidad puede actualizarse. La fecha de la
            última actualización se indica al final de este documento.
          </p>
          <p>
            <em>Última actualización: Septiembre 2026</em>
          </p>
        </div>
      </main>
    </div>
  );
}