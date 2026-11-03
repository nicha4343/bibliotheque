// Text recognition by Tesseract.js (lot 6, chosen by the user on 3 November 2026: free, in the phone,
// offline too). Its three files are served by the application itself under ocr/ and precached by the
// service worker (see vite.config.ts), never fetched from a CDN: the worker, the engine (WebAssembly
// with SIMD, LSTM only) and the French model (« best_int », 0,7 Mo).
import type { Worker as TesseractWorker } from 'tesseract.js';

/** A line of text found on an image, with its place: the tallest lines of a cover are its title. */
export interface TextLine {
  text: string;
  /** 0 to 100, as Tesseract gives it. */
  confidence: number;
  words: { text: string; confidence: number }[];
  /** Box of the line, in pixels of the recognized image. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Lines of the same paragraph share its number (a passage, see passage.ts). */
  paragraph?: number;
}

export interface RecognizedImage {
  lines: TextLine[];
  /** Size of the recognized image, to compare the heights of the lines whatever the photograph. */
  width: number;
  height: number;
}

/**
 * « sparse »: words scattered over a picture, as on a cover; « auto »: columns and paragraphs, as on a
 * page (also a second chance for a cover where the first finds no title).
 */
export type TextLayout = 'sparse' | 'auto';

/** Tesseract finds text best when letters are 20 to 30 pixels high: photographs are enlarged. */
export const COVER_SIZE = 2000;
export const PAGE_SIZE = 2400;
const MAX_ENLARGEMENT = 4;
/** The engine is kept a while for the next photograph, then released (it takes some hundred megabytes). */
const IDLE_MS = 30_000;

// WebAssembly SIMD (Chrome 91, Safari 16.4, Firefox 89): the only engine shipped. Same test as wasm-feature-detect.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function textRecognitionSupported(): boolean {
  try {
    return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_TEST);
  } catch {
    return false;
  }
}

interface Engine {
  worker: TesseractWorker;
  psm: typeof import('tesseract.js').PSM;
}

let engine: Promise<Engine> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Jobs run one after the other: a Tesseract worker reads one image at a time. */
let queue: Promise<unknown> = Promise.resolve();

const ocrUrl = (name: string) => new URL(`ocr/${name}`, document.baseURI).href;

async function startEngine(): Promise<Engine> {
  const tesseract = await import('tesseract.js');
  const worker = await tesseract.createWorker('fra', tesseract.OEM.LSTM_ONLY, {
    workerPath: ocrUrl('worker.min.js'),
    corePath: ocrUrl('tesseract-core-simd-lstm.wasm.js'),
    // Folder of fra.traineddata.gz.
    langPath: ocrUrl(''),
    // A worker of our own address, so that the service worker serves its files offline.
    workerBlobURL: false,
    // Already kept by the service worker: Tesseract would store a second copy in IndexedDB.
    cacheMethod: 'none',
  });
  return { worker, psm: tesseract.PSM };
}

function releaseLater(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const current = engine;
    engine = undefined;
    void current?.then(({ worker }) => worker.terminate()).catch(() => undefined);
  }, IDLE_MS);
}

async function withEngine<T>(job: (engine: Engine) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    clearTimeout(idleTimer);
    engine ??= startEngine();
    try {
      return await job(await engine);
    } catch (error) {
      // A failed start (engine unreachable) is tried again next time.
      engine = undefined;
      throw error;
    } finally {
      releaseLater();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Grey levels, enlarged if needed: colours only disturb Tesseract. */
async function prepare(photo: Blob, size: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo);
  try {
    const scale = Math.min(MAX_ENLARGEMENT, Math.max(1, size / Math.max(bitmap.width, bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No 2D context');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const grey = 0.299 * (pixels[index] ?? 0) + 0.587 * (pixels[index + 1] ?? 0) + 0.114 * (pixels[index + 2] ?? 0);
      pixels[index] = grey;
      pixels[index + 1] = grey;
      pixels[index + 2] = grey;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Lines of text read on a photograph, enlarged to about size pixels. */
export async function recognizeLines(photo: Blob, layout: TextLayout, size = COVER_SIZE): Promise<RecognizedImage> {
  const canvas = await prepare(photo, size);
  return withEngine(async ({ worker, psm }) => {
    await worker.setParameters({ tessedit_pageseg_mode: layout === 'sparse' ? psm.SPARSE_TEXT : psm.AUTO });
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
    const lines: TextLine[] = [];
    let paragraph = 0;
    for (const block of data.blocks ?? []) {
      for (const { lines: paragraphLines } of block.paragraphs) {
        paragraph += 1;
        for (const line of paragraphLines) {
          lines.push({
            text: line.text.trim(),
            confidence: line.confidence,
            words: line.words.map((word) => ({ text: word.text, confidence: word.confidence })),
            left: line.bbox.x0,
            top: line.bbox.y0,
            width: line.bbox.x1 - line.bbox.x0,
            height: line.bbox.y1 - line.bbox.y0,
            paragraph,
          });
        }
      }
    }
    return { lines, width: canvas.width, height: canvas.height };
  });
}
