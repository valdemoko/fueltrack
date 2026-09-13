"use client";

import Link from "next/link";
import { Map } from "lucide-react";

interface CtaMapaMunicipioProps {
  municipioId: string;
  municipioNombre: string;
  productoId: number;
}

/**
 * CTA "Ver en el mapa" con municipio y combustible preseleccionados.
 * El mapa lee los parámetros municipioId y producto al montar.
 */
export function CtaMapaMunicipio({
  municipioId,
  municipioNombre,
  productoId,
}: CtaMapaMunicipioProps) {
  return (
    <Link
      href={`/mapa?municipioId=${encodeURIComponent(municipioId)}&producto=${productoId}`}
      className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-colors"
    >
      <Map className="w-4 h-4" />
      Ver en el mapa ({municipioNombre})
    </Link>
  );
}
