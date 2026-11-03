import { describe, expect, it } from 'vitest';
import { checkMistralKey, coverRequest, MISTRAL_MODELS, parseCoverAnswer, readCoverWithMistral } from './mistral';

/** An answer of chat/completions whose message is this JSON. */
const answer = (written: unknown) =>
  Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: typeof written === 'string' ? written : JSON.stringify(written) } }] });

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const modelOf = (init: RequestInit | undefined) => (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { model: string }).model;

describe('lecture des couvertures par Mistral', () => {
  it('envoie la photographie en JPEG et demande une réponse au format JSON', () => {
    const request = coverRequest('mistral-small-latest', 'AAAA') as {
      messages: { content: Record<string, unknown>[] }[];
      response_format: { type: string };
    };
    expect(request.messages[0]?.content[1]).toEqual({ type: 'image_url', image_url: 'data:image/jpeg;base64,AAAA' });
    expect(request.response_format.type).toBe('json_schema');
  });

  it('lit le titre, les auteurs, l’éditeur et la série', () => {
    const read = { isBook: true, title: ' Le Lotus bleu ', authors: ['Hergé', ''], publisher: 'Casterman', series: 'Les Aventures de Tintin', volume: 5 };
    expect(parseCoverAnswer({ choices: [{ message: { content: JSON.stringify(read) } }] })).toEqual({
      title: 'Le Lotus bleu',
      authors: ['Hergé'],
      publisher: 'Casterman',
      seriesName: 'Les Aventures de Tintin',
      seriesIndex: 5,
    });
  });

  it('ne garde pas les champs vides, ni un tome sans série', () => {
    const read = { isBook: true, title: 'Germinal', authors: ['Émile Zola'], publisher: '', series: '', volume: 3 };
    expect(parseCoverAnswer({ choices: [{ message: { content: JSON.stringify(read) } }] })).toEqual({ title: 'Germinal', authors: ['Émile Zola'] });
  });

  it('ne retient rien d’une photographie qui ne montre pas un livre', () => {
    const read = { isBook: false, title: 'Facture', authors: [], publisher: '', series: '', volume: 0 };
    expect(parseCoverAnswer({ choices: [{ message: { content: JSON.stringify(read) } }] })).toEqual({ title: '', authors: [] });
  });

  it('lit une réponse en morceaux de texte ou entourée de balises', () => {
    const json = {
      choices: [{ message: { content: [{ type: 'text', text: '```json\n{"isBook": true, "title": "Candide", ' }, { type: 'text', text: '"authors": ["Voltaire"]}\n```' }] } }],
    };
    expect(parseCoverAnswer(json)).toEqual({ title: 'Candide', authors: ['Voltaire'] });
    expect(parseCoverAnswer({ choices: [] })).toBeUndefined();
  });

  it('passe au modèle suivant quand le premier atteint ses limites', async () => {
    const asked: string[] = [];
    const outcome = await readCoverWithMistral(photo, 'clé', (_input, init) => {
      asked.push(modelOf(init));
      return Promise.resolve(asked.length === 1 ? new Response('{}', { status: 429 }) : answer({ isBook: true, title: 'Germinal', authors: ['Émile Zola'] }));
    });
    expect(asked).toEqual([...MISTRAL_MODELS]);
    expect(outcome).toEqual({ status: 'read', cover: { title: 'Germinal', authors: ['Émile Zola'] } });
  });

  it('distingue une clé refusée d’un service momentanément indisponible', async () => {
    const invalid = () => Promise.resolve(Response.json({ detail: 'Invalid API Key' }, { status: 401 }));
    expect(await readCoverWithMistral(photo, 'clé', invalid)).toEqual({ status: 'refused' });
    expect(await readCoverWithMistral(photo, 'clé', () => Promise.resolve(new Response('', { status: 429 })))).toEqual({ status: 'busy' });
    expect(await readCoverWithMistral(photo, 'clé', () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ status: 'busy' });
    expect(await checkMistralKey('clé', invalid)).toBe('refused');
    expect(await checkMistralKey('clé', () => Promise.resolve(Response.json({ object: 'list', data: [] })))).toBe('valid');
  });
});
