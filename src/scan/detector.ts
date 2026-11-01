import type { BarcodeDetector as Ponyfill, BarcodeFormat } from 'barcode-detector/ponyfill';
// Bundled with the app (not fetched from a CDN) so that scanning works offline.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface DetectedCode {
  rawValue: string;
  format: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface CodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

const FORMATS: BarcodeFormat[] = ['ean_13', 'qr_code'];

type DetectorClass = Pick<typeof Ponyfill, 'getSupportedFormats'> &
  (new (options: { formats: BarcodeFormat[] }) => CodeDetector);

/** The browser's own BarcodeDetector (Android) when it reads both formats, zxing-wasm otherwise (iPhone). */
export async function createDetector(): Promise<CodeDetector> {
  const native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      if (FORMATS.every((format) => supported.includes(format))) return new native({ formats: FORMATS });
    } catch {
      // Fall back to zxing-wasm.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: FORMATS });
}
