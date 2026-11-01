import type { ComponentChildren } from 'preact';

// Stroke icons from the mock-up. Decorative: the accompanying text carries the meaning.

interface IconProps {
  size?: number;
}

function Svg({ size = 22, children }: IconProps & { children: ComponentChildren }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {children}
    </svg>
  );
}

export function LibraryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
      <path d="M4 19a2 2 0 0 1 2-2h13" />
    </Svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 8v8M11 8v8M14 8v8M16.5 8v8" />
    </Svg>
  );
}

export function PendingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 13l3-8h12l3 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />
      <path d="M3 13h5l1 2h6l1-2h5" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  );
}
