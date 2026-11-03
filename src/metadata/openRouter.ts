// Reading of a cover photograph by a free model of OpenRouter (lot 6, chosen by the user on
// 3 November 2026, after Tesseract.js read nothing on the phone's photographs, Google AI Studio asked
// for a proof of age and Mistral withdrew its free API): an account opened with an address only, a
// key the user creates and enters in the Paramètres (kept on the device, never in the repository),
// 50 free requests a day. The photograph alone is sent; the providers of free models may keep it.

const API = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 45_000;

/**
 * Free models reading images, the best for a cover first (3 November 2026). Free models come and go:
 * the list of OpenRouter is read at the first reading, and these are only preferred within it.
 */
const PREFERRED_MODELS = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-26b-a4b-it:free'];
/** Models that classify content rather than describe it. */
const NOT_READERS = /safety|moderation|guard/i;
const MAX_MODELS = 3;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** The free models of OpenRouter's list that read images, the preferred ones first. */
export function freeImageModels(json: unknown): string[] {
  const models = isObject(json) && Array.isArray(json.data) ? json.data.filter(isObject) : [];
  const readers = models
    .filter((model) => typeof model.id === 'string' && model.id.endsWith(':free') && !NOT_READERS.test(model.id))
    .filter((model) => isObject(model.architecture) && strings(model.architecture.input_modalities).includes('image'))
    .map((model) => String(model.id));
  const rank = (id: string) => {
    const index = PREFERRED_MODELS.indexOf(id);
    return index === -1 ? PREFERRED_MODELS.length : index;
  };
  return readers.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_MODELS);
}

let models: Promise<string[]> | undefined;

/** Read once per session; the preferred models when the list cannot be read. */
function readerModels(fetchImpl: typeof fetch): Promise<string[]> {
  models ??= fetchImpl(`${API}/models`, { signal: AbortSignal.timeout(15_000) })
    .then(async (response) => (response.ok ? freeImageModels(await response.json()) : []))
    .catch(() => [])
    .then((found) => {
      if (found.length === 0) models = undefined;
      return found.length > 0 ? found : PREFERRED_MODELS;
    });
  return models;
}

/** What the model read on a cover; an empty title when it shows no book, or nothing legible. */
export interface ReadCover {
  title: string;
  authors: string[];
  publisher?: string;
  seriesName?: string;
  seriesIndex?: number;
}

const PROMPT = [
  'This photograph shows the front cover of a book (possibly a comic, or its spine or title page).',
  'Read what is printed on it, in the language printed on the cover:',
  '- title: the title of the book, without the series name when the series is printed apart, without the name of the collection;',
  '- authors: the authors credited (for a comic, the writer and the artist), each as « First name Last name », without « par » or « de »;',
  '- publisher: the publisher or the collection printed on the cover (« Folio », « Le Livre de Poche », « Casterman »), or an empty string;',
  '- series and volume: the series and the volume number if the book belongs to one, or an empty string and 0.',
  'Use the usual capitalization of a French library catalogue, not capitals only: « Le Lotus bleu », « Antoine de Saint-Exupéry ».',
  'Write only what can be read on the photograph; leave a field empty rather than guess.',
  'If the photograph shows no book, or nothing legible, set isBook to false and leave the title empty.',
  'Answer with this JSON object only, without any other text:',
  '{"isBook": true, "title": "", "authors": [], "publisher": "", "series": "", "volume": 0}',
].join('\n');

export function coverRequest(model: string, jpegBase64: string): unknown {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
        ],
      },
    ],
  };
}

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** The answer of chat/completions: the JSON object written by the model, whatever surrounds it. */
export function parseCoverAnswer(json: unknown): ReadCover | undefined {
  if (!isObject(json) || !Array.isArray(json.choices)) return undefined;
  const choice: unknown = json.choices[0];
  const content = isObject(choice) && isObject(choice.message) ? choice.message.content : undefined;
  const written =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((chunk: unknown) => (isObject(chunk) && typeof chunk.text === 'string' ? chunk.text : '')).join('')
        : '';
  const start = written.indexOf('{');
  const end = written.lastIndexOf('}');
  if (start === -1 || end < start) return undefined;
  let answer: unknown;
  try {
    answer = JSON.parse(written.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!isObject(answer)) return undefined;
  const title = answer.isBook === false ? '' : text(answer.title);
  if (!title) return { title: '', authors: [] };
  const cover: ReadCover = { title, authors: Array.isArray(answer.authors) ? answer.authors.map(text).filter(Boolean) : [] };
  const publisher = text(answer.publisher);
  if (publisher) cover.publisher = publisher;
  const series = text(answer.series);
  if (series) cover.seriesName = series;
  const volume = typeof answer.volume === 'string' ? Number(answer.volume) : answer.volume;
  if (series && typeof volume === 'number' && Number.isInteger(volume) && volume > 0) cover.seriesIndex = volume;
  return cover;
}

/**
 * busy: over a limit, server or network unavailable; asked again at retryAt, or a moment later.
 * refused: the key. policy: the privacy settings of the account forbid the free models.
 */
export type ReadOutcome =
  | { status: 'read'; cover: ReadCover }
  | { status: 'busy'; retryAt?: number }
  | { status: 'refused' }
  | { status: 'policy' }
  | { status: 'failed' };

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** The 50 free requests of the day are spent: asked again when OpenRouter says they come back. */
const DAILY_RETRY_MS = 60 * 60 * 1000;

export async function readCoverWithOpenRouter(photo: Blob, key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<ReadOutcome> {
  const image = await base64(photo);
  let busy = false;
  for (const model of await readerModels(fetchImpl)) {
    let response: Response;
    try {
      response = await fetchImpl(`${API}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(coverRequest(model, image)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { status: 'busy' };
    }
    if (response.ok) {
      const cover = parseCoverAnswer(await response.json().catch(() => undefined));
      if (cover) return { status: 'read', cover };
      // An answer that is not the JSON asked for: another model may do better.
      continue;
    }
    if (response.status === 401 || response.status === 403) return { status: 'refused' };
    const body = await response.text().catch(() => '');
    if (/data policy|privacy/i.test(body)) return { status: 'policy' };
    if (response.status === 429 && /per-day|per day/i.test(body)) {
      const reset = Number(response.headers.get('X-RateLimit-Reset'));
      return { status: 'busy', retryAt: reset > Date.now() ? reset : Date.now() + DAILY_RETRY_MS };
    }
    // Over its limit for the minute, overloaded, or withdrawn: the next model is tried.
    if (response.status === 429 || response.status === 404 || response.status >= 500) {
      busy ||= response.status !== 404;
      continue;
    }
  }
  return busy ? { status: 'busy' } : { status: 'failed' };
}

export type KeyCheck = 'valid' | 'refused' | 'unverified';

/** Asks OpenRouter about the key itself: free, and enough to tell a refused key. */
export async function checkOpenRouterKey(key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<KeyCheck> {
  try {
    const response = await fetchImpl(`${API}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (response.ok) return 'valid';
    return response.status === 401 || response.status === 403 ? 'refused' : 'unverified';
  } catch {
    return 'unverified';
  }
}

/** Unit tests read the list of models afresh. */
export function forgetModels(): void {
  models = undefined;
}
