import { describe, expect, it } from 'vitest';
import { BOM, decodeText, detectDelimiter, parseCsv, toCsv } from './csv';

describe('lecture CSV', () => {
  it('reconnaît le séparateur de la première ligne', () => {
    expect(detectDelimiter('Titre;Auteurs;ISBN-13\n')).toBe(';');
    expect(detectDelimiter('item_type,title,creators\n')).toBe(',');
    expect(detectDelimiter('"a;b",c,d\n')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it('lit les cellules entre guillemets, les guillemets doublés et les retours à la ligne', () => {
    const text = BOM + 'title,creators,notes\r\n"Le Petit Prince","Antoine de Saint-Exupéry","Dit ""le"" livre,\nrelié"\r\n\r\nL\'Étranger,Albert Camus,\n';
    expect(parseCsv(text)).toEqual([
      ['title', 'creators', 'notes'],
      ['Le Petit Prince', 'Antoine de Saint-Exupéry', 'Dit "le" livre,\nrelié'],
      ['L\'Étranger', 'Albert Camus', ''],
    ]);
  });

  it('lit la dernière ligne sans retour final', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('écriture CSV', () => {
  it('écrit pour Excel en français et se relit à l’identique', () => {
    const rows = [
      ['Titre', 'Remarque'],
      ['Guerre et paix', 'Tome 1 ; reliure « cuir »'],
      ['Dit "le" livre', 'deux\nlignes'],
      ['Sans', ''],
    ];
    const text = toCsv(rows);
    expect(text.startsWith(`${BOM}Titre;Remarque\r\n`)).toBe(true);
    expect(parseCsv(text)).toEqual(rows);
  });

  it('décode un fichier enregistré de nouveau par Excel (Windows-1252)', () => {
    const bytes = new Uint8Array([0x54, 0x69, 0x74, 0x72, 0x65, 0x3b, 0xc9, 0x64, 0x69, 0x74, 0x65, 0x75, 0x72]);
    expect(decodeText(bytes.buffer)).toBe('Titre;Éditeur');
    expect(decodeText(new TextEncoder().encode('Éditeur').buffer)).toBe('Éditeur');
  });
});
