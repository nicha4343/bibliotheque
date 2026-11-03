import { describe, expect, it } from 'vitest';
import type { TextLine } from './engine';
import { passageText } from './passage';

const line = (text: string, paragraph: number, confidence = 90): TextLine => ({
  text,
  confidence,
  words: text.split(' ').map((word) => ({ text: word, confidence })),
  left: 0,
  top: 0,
  width: 100,
  height: 20,
  paragraph,
});

describe('passageText', () => {
  it('joins the lines of a paragraph and rejoins the words cut at the end of a line', () => {
    const lines = [
      line('Longtemps, je me suis couché de bonne heure. Parfois, à peine ma bou-', 1),
      line('gie éteinte, mes yeux se fermaient si vite que je n’avais pas le temps', 1),
      line('de me dire : « Je m’endors. »', 1),
      line('Jean-', 2),
      line('Paul et moi', 2),
      // A short last line, taken by Tesseract for a paragraph of its own.
      line('partîmes.', 3),
    ];
    expect(passageText({ width: 1000, height: 1500, lines })).toBe(
      'Longtemps, je me suis couché de bonne heure. Parfois, à peine ma bougie éteinte, mes yeux se fermaient si vite que je n’avais pas le temps de me dire : « Je m’endors. »\nJean-Paul et moi partîmes.',
    );
  });

  it('leaves out the lines Tesseract doubts', () => {
    const lines = [line('|', 1), line('ÿ ee 7%', 1, 20), line('Une phrase lisible.', 2), line('-', 3)];
    expect(passageText({ width: 1000, height: 1500, lines })).toBe('Une phrase lisible.');
  });
});
