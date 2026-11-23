import React from 'react';

export default function GLLogo({ variant = 'icon', size = 32, animated = true, className = '' }) {
  if (variant === 'full') {
    return (
      <svg
        viewBox="0 0 360 140"
        width={size * 2.5}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`gl-logo-svg ${animated ? 'animate-eq' : ''} ${className}`}
      >
        <defs>
          <linearGradient id="glFullGradient" x1="20" y1="20" x2="155" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="50%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        {/* Detalhe de Arco Externo de Fone / Onda Acústica */}
        <path d="M 22 70 C 22 38, 46 18, 76 18" stroke="url(#glFullGradient)" strokeWidth="3.5" strokeLinecap="round" opacity="0.45" />
        <circle cx="22" cy="70" r="3.5" fill="#10B981" />

        {/* Letra 'G' Geométrica */}
        <path d="M 94 36 A 38 38 0 1 0 100 102 L 100 72 L 82 72" stroke="url(#glFullGradient)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />

        {/* Equalizador Dinâmico Integrado ao 'G' */}
        <rect className="eq-bar-1" x="50" y="61" width="4.5" height="18" rx="2.25" fill="#10B981" />
        <rect className="eq-bar-2" x="57.5" y="53" width="4.5" height="34" rx="2.25" fill="#06B6D4" />
        <rect className="eq-bar-3" x="65" y="57" width="4.5" height="26" rx="2.25" fill="#38BDF8" />
        <rect className="eq-bar-4" x="72.5" y="63" width="4.5" height="14" rx="2.25" fill="#8B5CF6" />

        {/* Letra 'L' Estilizada com Base em Onda Sonora & Nota Musical */}
        <path d="M 118 36 L 118 92 C 118 101 124 105 133 102 C 138 100.5 142 99 146 101" stroke="url(#glFullGradient)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="147" cy="101" r="5" fill="#8B5CF6" />

        {/* Tipografia Complementar da Marca */}
        <text x="168" y="76" fontFamily="'Plus Jakarta Sans', 'Inter', system-ui, sans-serif" fontWeight="800" fontSize="40" letterSpacing="-1.5" fill="#FFFFFF">
          GL<tspan fill="#10B981">.</tspan>music
        </text>
        <text x="170" y="98" fontFamily="'Inter', system-ui, sans-serif" fontWeight="600" fontSize="11.5" letterSpacing="3.2" fill="#94A3B8">
          SOUND &amp; STREAMING
        </text>
      </svg>
    );
  }

  // Mini Icon / Header Icon (120x120 viewBox)
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`gl-logo-svg ${animated ? 'animate-eq' : ''} ${className}`}
    >
      <defs>
        <linearGradient id="glIconGrad" x1="10" y1="10" x2="110" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      {/* G geométrico */}
      <path d="M 66 28 A 32 32 0 1 0 70 86 L 70 60 L 52 60" stroke="url(#glIconGrad)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      {/* Equalizador animado */}
      <rect className="eq-bar-1" x="37" y="51" width="4.5" height="18" rx="2.25" fill="#10B981" />
      <rect className="eq-bar-2" x="44.5" y="45" width="4.5" height="30" rx="2.25" fill="#06B6D4" />
      {/* L estilizado com curva sonora e cabeça de nota */}
      <path d="M 85 32 L 85 82 C 85 87 88 90 93 90 L 108 90" stroke="url(#glIconGrad)" strokeWidth="10.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="109" cy="90" r="4.5" fill="#8B5CF6" />
    </svg>
  );
}
