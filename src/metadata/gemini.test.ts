import { describe, expect, it } from 'vitest';
import { checkGeminiKey, coverRequest, GEMINI_MODELS, geminiUrl, parseCoverAnswer, readCoverWithGemini } from './gemini';

/** An answer of generateContent whose text is this JSON. */
const answer = (written: unknown) =>
  Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: typeof written === 'string' ? written : JSON.stringify(written) }] } }] });

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

describe('lecture des couvertures par Gemini', () => {
  it('envoie la photographie en JPEG et demande une réponse au format JSON', () => {
    const request = coverRequest('AAAA') as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
    expect(request.contents[0]?.parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(request.generationConfig.responseMimeType).toBe('application/json');
  });

  it('lit le titre, les auteurs, l’éditeur et la série', () => {
    const read = { isBook: true, title: ' Le Lotus bleu ', authors: ['Hergé', ''], publisher: 'Casterman', series: 'Les Aventures de Tintin', volume: 5 };
    const cover = parseCoverAnswer({ candidates: [{ content: { parts: [{ text: JSON.stringify(read) }] } }] });
    expect(cover).toEqual({ title: 'Le Lotus bleu', authors: ['Hergé'], publisher: 'Casterman', seriesName: 'Les Aventures de Tintin', seriesIndex: 5 });
  });

  it('ne retient rien d’une photographie qui ne montre pas un livre', () => {
    const json = { candidates: [{ content: { parts: [{ text: '{"isBook": false, "title": "Facture", "authors": []}' }] } }] };
    expect(parseCoverAnswer(json)).toEqual({ title: '', authors: [] });
  });

  it('écarte la réflexion du modèle et le JSON entouré de balises', () => {
    const json = {
      candidates: [{ content: { parts: [{ text: 'Je lis la couverture…', thought: true }, { text: '```json\n{"isBook": true, "title": "Germinal", "authors": ["Émile Zola"]}\n```' }] } }],
    };
    expect(parseCoverAnswer(json)).toEqual({ title: 'Germinal', authors: ['Émile Zola'] });
    expect(parseCoverAnswer({ candidates: [] })).toBeUndefined();
  });

  it('passe au modèle suivant quand le premier a épuisé son quota', async () => {
    const asked: string[] = [];
    const outcome = await readCoverWithGemini(photo, 'clé', (input) => {
      asked.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(asked.length === 1 ? new Response('{}', { status: 429 }) : answer({ isBook: true, title: 'Germinal', authors: ['Émile Zola'] }));
    });
    expect(asked).toEqual(GEMINI_MODELS.map(geminiUrl));
    expect(outcome).toEqual({ status: 'read', cover: { title: 'Germinal', authors: ['Émile Zola'] } });
  });

  it('distingue une clé refusée d’un service momentanément indisponible', async () => {
    const invalid = () => Promise.resolve(new Response('{"error": {"status": "INVALID_ARGUMENT", "details": [{"reason": "API_KEY_INVALID"}]}}', { status: 400 }));
    expect(await readCoverWithGemini(photo, 'clé', invalid)).toEqual({ status: 'refused' });
    expect(await readCoverWithGemini(photo, 'clé', () => Promise.resolve(new Response('', { status: 429 })))).toEqual({ status: 'busy' });
    expect(await readCoverWithGemini(photo, 'clé', () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ status: 'busy' });
    expect(await checkGeminiKey('clé', () => Promise.resolve(new Response('', { status: 403 })))).toBe('refused');
    expect(await checkGeminiKey('clé', () => Promise.resolve(Response.json({ name: 'models/gemini-3.8-flash' })))).toBe('valid');
  });
});
