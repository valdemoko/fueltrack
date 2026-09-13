/**
 * Política de Cookies
 * /politica-cookies
 *
 * Información sobre el uso de cookies conforme a la LSSI-CE y el RGPD.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Cookies — FuelTrack",
  description:
    "Política de cookies de FuelTrack. Información sobre las cookies utilizadas y cómo gestionarlas.",
};

export default function PoliticaCookiesPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <h1 className="font-display text-3xl font-bold text-stone-900 mb-8">
          Política de Cookies
        </h1>
        <div className="card p-8 prose prose-stone max-w-none">
          <h2>¿Qué son las cookies?</h2>
          <p>
            Las cookies son pequeños archivos de texto que se almacenan en su
            dispositivo (ordenador, tablet o móvil) cuando visita un sitio web.
            Permiten al sitio web recordar sus acciones y preferencias durante
            un período de tiempo.
          </p>

          <h2>¿Cómo utilizamos las cookies?</h2>
          <p>
            Utilizamos cookies para los siguientes fines:
          </p>

          <h3>Cookies técnicas (necesarias)</h3>
          <p>
            Son imprescindibles para el funcionamiento del sitio web. Sin
            estas cookies, el sitio no puede funcionar correctamente.
          </p>
          <table className="min-w-full border-collapse border border-stone-200">
            <thead>
              <tr className="bg-stone-50">
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Cookie
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Finalidad
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-stone-200 px-4 py-2">next-session</td>
                <td className="border border-stone-200 px-4 py-2">
                  Mantener la sesión del usuario
                </td>
                <td className="border border-stone-200 px-4 py-2">
                  Sesión
                </td>
              </tr>
              <tr>
                <td className="border border-stone-200 px-4 py-2">
                  cookie_consent
                </td>
                <td className="border border-stone-200 px-4 py-2">
                  Recordar la preferencia de cookies del usuario
                </td>
                <td className="border border-stone-200 px-4 py-2">
                  1 año
                </td>
              </tr>
            </tbody>
          </table>

          <h3>Cookies de análisis (estadísticas)</h3>
          <p>
            Nos ayudan a entender cómo interactúan los visitantes con el sitio
            web, recopilando información de forma anónima.
          </p>
          <table className="min-w-full border-collapse border border-stone-200">
            <thead>
              <tr className="bg-stone-50">
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Cookie
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Proveedor
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-stone-200 px-4 py-2">_ga</td>
                <td className="border border-stone-200 px-4 py-2">Google</td>
                <td className="border border-stone-200 px-4 py-2">2 años</td>
              </tr>
              <tr>
                <td className="border border-stone-200 px-4 py-2">_ga_*_*</td>
                <td className="border border-stone-200 px-4 py-2">Google</td>
                <td className="border border-stone-200 px-4 py-2">2 años</td>
              </tr>
            </tbody>
          </table>

          <h3>Cookies de publicidad</h3>
          <p>
            Se utilizan para mostrar anuncios relevantes. Google AdSense puede
            utilizar cookies para personalizar los anuncios según su
            navegación.
          </p>
          <table className="min-w-full border-collapse border border-stone-200">
            <thead>
              <tr className="bg-stone-50">
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Cookie
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Proveedor
                </th>
                <th className="border border-stone-200 px-4 py-2 text-left">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-stone-200 px-4 py-2">
                  _gcl_au
                </td>
                <td className="border border-stone-200 px-4 py-2">Google</td>
                <td className="border border-stone-200 px-4 py-2">3 meses</td>
              </tr>
              <tr>
                <td className="border border-stone-200 px-4 py-2">
                  IDE
                </td>
                <td className="border border-stone-200 px-4 py-2">Google</td>
                <td className="border border-stone-200 px-4 py-2">1 año</td>
              </tr>
              <tr>
                <td className="border border-stone-200 px-4 py-2">
                  NID
                </td>
                <td className="border border-stone-200 px-4 py-2">Google</td>
                <td className="border border-stone-200 px-4 py-2">6 meses</td>
              </tr>
            </tbody>
          </table>

          <h2>Cómo gestionar las cookies</h2>
          <p>
            Puede configurar su navegador para aceptar o rechazar cookies, o
            para que le notifique cuando se envíe una cookie. Los siguientes
            enlaces explican cómo configurar las cookies en los navegadores más
            populares:
          </p>
          <ul>
            <li>
              <a
                href="https://support.google.com/chrome/answer/95647"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Chrome
              </a>
            </li>
            <li>
              <a
                href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web"
                target="_blank"
                rel="noopener noreferrer"
              >
                Mozilla Firefox
              </a>
            </li>
            <li>
              <a
                href="https://support.apple.com/es-es/guide/safari/sfri11471/mac"
                target="_blank"
                rel="noopener noreferrer"
              >
                Safari
              </a>
            </li>
            <li>
              <a
                href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
                target="_blank"
                rel="noopener noreferrer"
              >
                Microsoft Edge
              </a>
            </li>
          </ul>

          <h2>Consentimiento</h2>
          <p>
            Al hacer clic en &quot;Aceptar&quot; en nuestro banner de cookies,
            usted consiente el uso de las cookies de análisis y publicidad. Las
            cookies técnicas se utilizan sin necesidad de consentimiento ya que
            son imprescindibles para el funcionamiento del sitio.
          </p>
          <p>
            Puede retirar su consentimiento en cualquier momento modificando la
            configuración de cookies desde el botón &quot;Configurar cookies&quot;
            que encontrará en el pie de página.
          </p>

          <h2>Cambios en esta política</h2>
          <p>
            Nos reservamos el derecho de modificar esta política de cookies.
            Los cambios se publicarán en esta página.
          </p>
          <p>
            <em>Última actualización: Septiembre 2026</em>
          </p>
        </div>
      </main>
    </div>
  );
}