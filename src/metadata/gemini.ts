// Reading of a cover photograph by Gemini (lot 6, chosen by the user on 3 November 2026 after
// Tesseract.js read nothing on the phone's photographs): Google AI Studio's free tier, with a key the
// user creates and enters in the Paramètres (kept on the device, never in the repository). The
// photograph alone is sent; Google may use it to improve its products on the free tier.

/**
 * Stable models of the free tier (3 November 2026), the best first. Each has its own quota: a model
 * over its quota, or withdrawn, gives way to the next one.
 */
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] as const;

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30_000;

export const geminiUrl = (model: string): string => `${API}/${model}:generateContent`;

/** What Gemini read on a cover; an empty title when it shows no book, or nothing legible. */
export interface GeminiCover {
  title: string;
  authors: string[];
  publisher?: string;
  seriesName?: string;
  seriesIndex?: number;
}

const PROMPT = [
  'This photograph shows the front cover of a book (possibly a comic, or its spine or title page).',
  'Read what is printed on it and fill the fields, in the language printed on the cover:',
  '- title: the title of the book, without the series name when the series is printed apart, without the name of the collection;',
  '- authors: the authors credited (for a comic, the writer and the artist), each as « First name Last name », without « par » or « de »;',
  '- publisher: the publisher or the collection printed on the cover (« Folio », « Le Livre de Poche », « Casterman »), if any;',
  '- series and volume: the series and the volume number, if the book belongs to one.',
  'Use the usual capitalization of a French library catalogue, not capitals only: « Le Lotus bleu », « Antoine de Saint-Exupéry ».',
  'Write only what can be read on the photograph; leave a field empty rather than guess.',
  'If the photograph shows no book, or nothing legible, set isBook to false and leave the title empty.',
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    isBook: { type: 'BOOLEAN' },
    title: { type: 'STRING' },
    authors: { type: 'ARRAY', items: { type: 'STRING' } },
    publisher: { type: 'STRING' },
    series: { type: 'STRING' },
    volume: { type: 'INTEGER' },
  },
  required: ['isBook', 'title', 'authors'],
};

export function coverRequest(jpegBase64: string): unknown {
  return {
    contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** The answer of generateContent: the JSON written by the model in its text. */
export function parseCoverAnswer(json: unknown): GeminiCover | undefined {
  if (!isObject(json) || !Array.isArray(json.candidates)) return undefined;
  const candidate: unknown = json.candidates[0];
  const parts = isObject(candidate) && isObject(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const written = parts.map((part: unknown) => (isObject(part) && typeof part.text === 'string' && part.thought !== true ? part.text : '')).join('');
  let answer: unknown;
  try {
    answer = JSON.parse(written.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return undefined;
  }
  if (!isObject(answer)) return undefined;
  const cover: GeminiCover = {
    title: answer.isBook === false ? '' : text(answer.title),
    authors: Array.isArray(answer.authors) ? answer.authors.map(text).filter(Boolean) : [],
  };
  if (!cover.title) return { title: '', authors: [] };
  const publisher = text(answer.publisher);
  if (publisher) cover.publisher = publisher;
  const series = text(answer.series);
  if (series) cover.seriesName = series;
  if (typeof answer.volume === 'number' && Number.isInteger(answer.volume) && answer.volume > 0) cover.seriesIndex = answer.volume;
  return cover;
}

/** busy: over the quota, server or network unavailable; asked again later. refused: the key. */
export type GeminiOutcome = { status: 'read'; cover: GeminiCover } | { status: 'busy' } | { status: 'refused' } | { status: 'failed' };

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** 400 « API key not valid », 401, 403 (API not allowed, address not allowed): the key, not the photograph. */
async function keyRefused(response: Response): Promise<boolean> {
  if (response.status === 401 || response.status === 403) return true;
  if (response.status !== 400) return false;
  const body = await response.text().catch(() => '');
  return /API_KEY_INVALID|API key not valid/i.test(body);
}

export async function readCoverWithGemini(photo: Blob, key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<GeminiOutcome> {
  const body = JSON.stringify(coverRequest(await base64(photo)));
  let busy = false;
  for (const model of GEMINI_MODELS) {
    let response: Response;
    try {
      response = await fetchImpl(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { status: 'busy' };
    }
    if (response.ok) {
      const cover = parseCoverAnswer(await response.json().catch(() => undefined));
      return cover ? { status: 'read', cover } : { status: 'failed' };
    }
    if (await keyRefused(response)) return { status: 'refused' };
    // Over its quota, overloaded or withdrawn: the next model is tried.
    if (response.status === 429 || response.status === 404 || response.status >= 500) {
      busy ||= response.status !== 404;
      continue;
    }
    return { status: 'failed' };
  }
  return busy ? { status: 'busy' } : { status: 'failed' };
}

export type GeminiKeyCheck = 'valid' | 'refused' | 'unverified';

/** Asks Gemini for the description of its first model: free, and enough to tell a refused key. */
export async function checkGeminiKey(key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<GeminiKeyCheck> {
  try {
    const response = await fetchImpl(`${API}/${GEMINI_MODELS[0]}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
    if (response.ok) return 'valid';
    return (await keyRefused(response)) ? 'refused' : 'unverified';
  } catch {
    return 'unverified';
  }
}
