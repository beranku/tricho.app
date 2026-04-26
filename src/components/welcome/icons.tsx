import React from 'react';

/**
 * Inline SVG glyphs used by the wizard. Kept here (not in
 * `src/components/astro/icons/`) because React renders these inside
 * client islands; the .astro variants are server-side and live alongside
 * the rest of the icon library for parity. All glyphs use `currentColor`.
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function IosShareIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export function KebabIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx={12} cy={5} r={1.6} />
      <circle cx={12} cy={12} r={1.6} />
      <circle cx={12} cy={19} r={1.6} />
    </svg>
  );
}

export function LockIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x={3} y={7} width={10} height={7} rx={1.5} />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/**
 * Sanctioned hand-drawn glyph #2 (`ui-design-system` spec). The path is
 * deliberately imperfect — see ui-prototype/tricho-north-star.md §5.2.
 */
export function HandDrawnCheckIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function CameraIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 8a2 2 0 0 1 2-2h2.5l1.2-1.5a1 1 0 0 1 .8-.5h5a1 1 0 0 1 .8.5L16.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
      <circle cx={12} cy={12.5} r={3.2} />
    </svg>
  );
}

export function GalleryIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x={3} y={5} width={18} height={14} rx={2} />
      <circle cx={8.5} cy={10.5} r={1.5} />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 4v12" />
      <path d="M8 12l4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

/** Apple logo glyph for the OAuth button. */
export function AppleLogo({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M16.365 1.43c.91-1.103 1.524-2.624 1.355-4.156-1.314.05-2.91.873-3.852 1.97-.853.97-1.6 2.51-1.4 4.013 1.467.115 2.96-.747 3.897-1.827zM20.69 17.36c-.59 1.31-.87 1.89-1.62 3.05-1.05 1.62-2.53 3.64-4.36 3.66-1.63.02-2.05-1.06-4.27-1.05-2.22.01-2.68 1.07-4.31 1.05-1.83-.02-3.23-1.84-4.28-3.46C-1 16.06-1.32 9.73 1.6 6.4c2.07-2.36 5.34-3.74 8.42-3.74 1.85 0 3.45.96 4.66.96 1.21 0 3.23-1.18 5.46-1 .94.04 3.55.38 5.24 2.86-4.6 2.51-3.86 9.13.32 11.88z" />
    </svg>
  );
}

/** Google brand-coloured 'G' logo (4 segments). */
export function GoogleLogo({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
