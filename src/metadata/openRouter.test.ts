import { beforeEach, describe, expect, it } from 'vitest';
import { checkOpenRouterKey, coverRequest, forgetModels, freeImageModels, parseCoverAnswer, readCoverWithOpenRouter } from './openRouter';

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const modelOf = (init: RequestInit | undefined) => (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { model: string }).model;

/** An answer of chat/completions whose message is this text. */
const answer = (written: string) => Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: written } }] });

// Part of OpenRouter's list of models (3 November 2026).
const MODELS = {
  data: [
    { id: 'openai/gpt-5', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'nvidia/nemotron-3.5-content-safety:free', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'meta-llama/llama-5-8b:free', architecture: { input_modalities: ['text'] } },
    { id: 'thinkingmachines/inkling:free', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'nvidia/nemotron-3.5-super-vl:free', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'google/gemma-4-31b-it:free', architecture: { input_modalities: ['text', 'image'] } },
  ],
};

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

/** OpenRouter answering the list of models, then each request to a model with the next answer. */
function openRouter(...answers: (() => Response)[]): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    if (urlOf(input).endsWith('/models')) return Promise.resolve(Response.json(MODELS));
    asked.push(modelOf(init));
    return Promise.resolve((answers[asked.length - 1] ?? answers.at(-1) ?? (() => new Response('', { status: 500 })))());
  };
  return { fetchImpl, asked };
}

beforeEach(() => {
  forgetModels();
});

describe('lecture des couvertures par OpenRouter', () => {
  it('choisit les modèles gratuits qui lisent les images, les préférés en tête', () => {
    expect(freeImageModels(MODELS)).toEqual(['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free', 'thinkingmachines/inkling:free']);
  });

  it('envoie la photographie en JPEG', () => {
    const request = coverRequest('google/gemma-4-31b-it:free', 'AAAA') as { messages: { content: Record<string, unknown>[] }[] };
    expect(request.messages[0]?.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  });

  it('lit l’objet JSON de la réponse, même entouré de texte', () => {
    const written = 'Voici :\n```json\n{"isBook": true, "title": " Le Lotus bleu ", "authors": ["Hergé", ""], "publisher": "Casterman", "series": "Les Aventures de Tintin", "volume": "5"}\n```';
    expect(parseCoverAnswer({ choices: [{ message: { content: written } }] })).toEqual({
      title: 'Le Lotus bleu',
      authors: ['Hergé'],
      publisher: 'Casterman',
      seriesName: 'Les Aventures de Tintin',
      seriesIndex: 5,
    });
    expect(parseCoverAnswer({ choices: [{ message: { content: '{"isBook": false, "title": "Facture", "authors": []}' } }] })).toEqual({ title: '', authors: [] });
    expect(parseCoverAnswer({ choices: [{ message: { content: 'Je ne peux pas lire cette image.' } }] })).toBeUndefined();
  });

  it('passe au modèle suivant quand le premier est surchargé ou répond autre chose que le JSON demandé', async () => {
    const { fetchImpl, asked } = openRouter(
      () => new Response('{"error": {"message": "Provider returned error", "code": 429}}', { status: 429 }),
      () => answer('Je ne sais pas.'),
      () => answer('{"isBook": true, "title": "Germinal", "authors": ["Émile Zola"], "publisher": "", "series": "", "volume": 0}'),
    );
    expect(await readCoverWithOpenRouter(photo, 'clé', fetchImpl)).toEqual({ status: 'read', cover: { title: 'Germinal', authors: ['Émile Zola'] } });
    expect(asked).toEqual(freeImageModels(MODELS));
  });

  it('reconnaît une clé refusée, des paramètres de confidentialité à changer et les lectures du jour épuisées', async () => {
    expect(await readCoverWithOpenRouter(photo, 'clé', openRouter(() => Response.json({ error: { message: 'User not found.', code: 401 } }, { status: 401 })).fetchImpl)).toEqual({ status: 'refused' });
    const policy = () => Response.json({ error: { message: 'No endpoints found matching your data policy (Free model training)', code: 404 } }, { status: 404 });
    expect(await readCoverWithOpenRouter(photo, 'clé', openRouter(policy).fetchImpl)).toEqual({ status: 'policy' });
    const reset = Date.now() + 3_600_000;
    const daily = () =>
      new Response('{"error": {"message": "Rate limit exceeded: free-models-per-day", "code": 429}}', { status: 429, headers: { 'X-RateLimit-Reset': String(reset) } });
    expect(await readCoverWithOpenRouter(photo, 'clé', openRouter(daily).fetchImpl)).toEqual({ status: 'busy', retryAt: reset });
    expect(await readCoverWithOpenRouter(photo, 'clé', () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ status: 'busy' });
  });

  it('vérifie la clé', async () => {
    expect(await checkOpenRouterKey('clé', () => Promise.resolve(Response.json({ error: { code: 401 } }, { status: 401 })))).toBe('refused');
    expect(await checkOpenRouterKey('clé', () => Promise.resolve(Response.json({ data: { label: 'Ma bibliothèque' } })))).toBe('valid');
    expect(await checkOpenRouterKey('clé', () => Promise.reject(new TypeError('Failed to fetch')))).toBe('unverified');
  });
});
