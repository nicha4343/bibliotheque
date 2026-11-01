import { useMemo } from 'preact/hooks';
import { encode } from 'uqr';

/** QR code drawn as one SVG path, sharp at any print size. */
export function QrCode({ value, class: className }: { value: string; class?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, size: qr.size };
  }, [value]);

  return (
    <svg class={className} viewBox={`0 0 ${size} ${size}`} shape-rendering="crispEdges" aria-hidden="true">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
