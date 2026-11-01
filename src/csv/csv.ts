// CSV reading and writing (RFC 4180), as produced by spreadsheets and by Libib.

/** Byte order mark (U+FEFF), written as a code so that it stays visible in the source. */
export const BOM = String.fromCharCode(0xfeff);
const DELIMITERS = [';', ',', '\t'] as const;

/** Delimiter most used on the first line, outside quotes: « ; » for French spreadsheets, « , » for Libib. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ',';
  let bestCount = 0;
  for (const [delimiter, value] of counts) {
    if (value > bestCount) {
      best = delimiter;
      bestCount = value;
    }
  }
  return best;
}

/** Rows of cells; quoted cells may hold delimiters, line breaks and doubled quotes. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source.charAt(index + 1) === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

const NEEDS_QUOTES = /[";,\t\r\n]|^\s|\s$/;

function quote(cell: string): string {
  return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/**
 * CSV text opened correctly by a double click in a French Excel: « ; » as delimiter, and a byte
 * order mark so that accented letters are read as UTF-8.
 */
export function toCsv(rows: readonly (readonly string[])[], delimiter = ';'): string {
  return `${BOM}${rows.map((row) => row.map(quote).join(delimiter)).join('\r\n')}\r\n`;
}

/** UTF-8, or Windows-1252 for a file saved again by Excel (« CSV (séparateur : point-virgule) »). */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
