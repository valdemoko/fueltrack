"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Map, BarChart3 } from "lucide-react";

const navItems = [
  { href: "/", label: "Inicio" },
  { href: "/gasolineras", label: "Gasolineras", icon: Map },
  { href: "/precios", label: "Precios", icon: BarChart3 },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group" aria-label="Inicio — FuelTrack">
            <Image
              src="/favicon.svg"
              alt=""
              width={32}
              height={32}
              className="rounded-lg"
              aria-hidden="true"
              unoptimized
            />
            <span className="font-display font-bold text-lg text-stone-900 hidden sm:block">
              FuelTrack
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Navegación principal">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-amber-100 text-amber-700"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.icon && <item.icon className="w-4 h-4" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Mobile Nav */}
          <nav className="flex md:hidden items-center gap-1" aria-label="Navegación móvil">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-amber-100 text-amber-700"
                      : "text-stone-500 hover:bg-stone-100"
                  }`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
