// Reading of a cover photograph by Mistral (lot 6, chosen by the user on 3 November 2026, after
// Tesseract.js read nothing on the phone's photographs and Google AI Studio asked for a proof of age):
// the free mode of Mistral AI Studio, with a key the user creates and enters in the Paramètres
// (kept on the device, never in the repository). The photograph alone is sent; on the free mode,
// Mistral may use it to train its models, which the user may refuse in Mistral's settings.

/**
 * Models reading images (3 November 2026), the first one preferred. A model withdrawn or over its
 * own limits gives way to the next one.
 */
export const MISTRAL_MODELS = ['mistral-small-latest', 'ministral-14b-latest'] as const;

const API = 'https://api.mistral.ai/v1';
const TIMEOUT_MS = 30_000;

/** What Mistral read on a cover; an empty title when it shows no book, or nothing legible. */
export interface ReadCover {
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
  '- publisher: the publisher or the collection printed on the cover (« Folio », « Le Livre de Poche », « Casterman »), or an empty string;',
  '- series and volume: the series and the volume number if the book belongs to one, or an empty string and 0.',
  'Use the usual capitalization of a French library catalogue, not capitals only: « Le Lotus bleu », « Antoine de Saint-Exupéry ».',
  'Write only what can be read on the photograph; leave a field empty rather than guess.',
  'If the photograph shows no book, or nothing legible, set isBook to false and leave the title empty.',
].join('\n');

// Strict structured output: every field present, empty when unknown.
const SCHEMA = {
  type: 'object',
  properties: {
    isBook: { type: 'boolean' },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    publisher: { type: 'string' },
    series: { type: 'string' },
    volume: { type: 'integer' },
  },
  required: ['isBook', 'title', 'authors', 'publisher', 'series', 'volume'],
  additionalProperties: false,
};

export function coverRequest(model: string, jpegBase64: string): unknown {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: `data:image/jpeg;base64,${jpegBase64}` },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'cover', schema: SCHEMA, strict: true } },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** The answer of chat/completions: the JSON written by the model, as a text or in text chunks. */
export function parseCoverAnswer(json: unknown): ReadCover | undefined {
  if (!isObject(json) || !Array.isArray(json.choices)) return undefined;
  const choice: unknown = json.choices[0];
  const content = isObject(choice) && isObject(choice.message) ? choice.message.content : undefined;
  const written =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((chunk: unknown) => (isObject(chunk) && chunk.type === 'text' && typeof chunk.text === 'string' ? chunk.text : '')).join('')
        : '';
  let answer: unknown;
  try {
    answer = JSON.parse(written.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
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
  if (series && typeof answer.volume === 'number' && Number.isInteger(answer.volume) && answer.volume > 0) cover.seriesIndex = answer.volume;
  return cover;
}

/** busy: over the limits, server or network unavailable; asked again later. refused: the key. */
export type ReadOutcome = { status: 'read'; cover: ReadCover } | { status: 'busy' } | { status: 'refused' } | { status: 'failed' };

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function readCoverWithMistral(photo: Blob, key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<ReadOutcome> {
  const image = await base64(photo);
  let busy = false;
  for (const model of MISTRAL_MODELS) {
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
      return cover ? { status: 'read', cover } : { status: 'failed' };
    }
    // 401 « Invalid API Key », 403: the key, not the photograph.
    if (response.status === 401 || response.status === 403) return { status: 'refused' };
    // Over its limits, overloaded, or withdrawn: the next model is tried.
    const withdrawn = response.status === 404 || (response.status === 400 && /model/i.test(await response.text().catch(() => '')));
    if (response.status === 429 || response.status >= 500 || withdrawn) {
      busy ||= !withdrawn;
      continue;
    }
    return { status: 'failed' };
  }
  return busy ? { status: 'busy' } : { status: 'failed' };
}

export type KeyCheck = 'valid' | 'refused' | 'unverified';

/** Asks Mistral for its list of models: free, and enough to tell a refused key. */
export async function checkMistralKey(key: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<KeyCheck> {
  try {
    const response = await fetchImpl(`${API}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (response.ok) return 'valid';
    return response.status === 401 || response.status === 403 ? 'refused' : 'unverified';
  } catch {
    return 'unverified';
  }
}
