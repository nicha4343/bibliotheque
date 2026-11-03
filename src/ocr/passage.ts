import type { RecognizedImage } from './engine';

// Text of a photographed passage (« Citations », screen 6, lot 6), offered in the field of the quote:
// the user keeps the sentences they wanted and corrects what was misread.

/** Lines Tesseract doubts (page edges, the facing page, a finger) are left out. */
const MIN_CONFIDENCE = 55;

const letterCount = (text: string): number => text.match(/\p{L}/gu)?.length ?? 0;

/**
 * The lines of each paragraph joined, a word cut at the end of a line rejoined (« pas- / sage »),
 * paragraphs separated by a line break when the previous one ends a sentence.
 */
export function passageText(image: RecognizedImage): string {
  const paragraphs: string[][] = [];
  let current: number | undefined;
  for (const line of image.lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (line.confidence < MIN_CONFIDENCE || letterCount(text) < 2) continue;
    if (line.paragraph === undefined || line.paragraph !== current || paragraphs.length === 0) paragraphs.push([]);
    current = line.paragraph;
    paragraphs.at(-1)?.push(text);
  }
  return paragraphs
    .map((lines) =>
      lines.reduce((text, line) => {
        if (!text) return line;
        // « pas- » then « sage »: a word cut by the line; « Jean- » then « Paul » keeps its hyphen.
        if (/\p{L}[-‐¬]$/u.test(text)) return /^\p{Ll}/u.test(line) ? `${text.slice(0, -1)}${line}` : `${text}${line}`;
        return `${text} ${line}`;
      }, ''),
    )
    .filter(Boolean)
    // A short last line is often taken for a paragraph of its own: a sentence left open goes on.
    .reduce((text, paragraph) => (!text ? paragraph : /[.!?…»:"]$/u.test(text) ? `${text}\n${paragraph}` : `${text} ${paragraph}`), '');
}
