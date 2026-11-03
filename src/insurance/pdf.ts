import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { initialsOf, placeholderColour } from '../components/CoverImage';
import type { Book } from '../db/schema';
import { formatDate, formatPrice, fr } from '../textes/fr';
import { isPrecious, toWinAnsi, type InventoryGroup, type InventoryItem, type InventoryOptions, type InventorySummary } from './inventory';

// Drawing of the insurance inventory (A4, standard fonts). Loaded only when the user asks for it.

/** JPEG bytes of a cover or photograph, at most maxSide pixels on its longer side; undefined if unavailable. */
export type ImageLoader = (book: Book, maxSide: number) => Promise<Uint8Array | undefined>;

export interface InventoryInput {
  summary: InventorySummary;
  groups: InventoryGroup[];
  /** Precious editions photographed by the user (when the option is on). */
  photographed: Book[];
  options: InventoryOptions;
  now: Date;
  loadImage: ImageLoader;
  onProgress?: (done: number, total: number) => void;
}

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const BOTTOM = 52;
const WIDTH = PAGE[0] - 2 * MARGIN;
const PRICE_WIDTH = 92;
const COVER = { width: 34, height: 50 };

const hex = (value: string): RGB => {
  const number = Number.parseInt(value.replace('#', ''), 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
};

const INK = hex('#15171C');
const MUTED = hex('#5A606B');
const ACCENT = hex('#0F766E');
const RULE = hex('#E3E5EA');
const WHITE = rgb(1, 1, 1);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** The text, shortened with « … » to fit the width. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const clean = toWinAnsi(text);
  if (font.widthOfTextAtSize(clean, size) <= width) return clean;
  let low = 0;
  let high = clean.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${clean.slice(0, middle).trimEnd()}…`, size) <= width) low = middle;
    else high = middle - 1;
  }
  return `${clean.slice(0, low).trimEnd()}…`;
}

class Writer {
  page: PDFPage;
  y: number;
  private readonly doc: PDFDocument;
  private readonly fonts: Fonts;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN;
  }

  newPage(): void {
    this.page = this.doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN;
  }

  /** Room for the given height, else a new page. */
  need(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  text(text: string, options: { x?: number; size: number; bold?: boolean; color?: RGB; width?: number; right?: boolean; dy?: number }): void {
    const font = options.bold ? this.fonts.bold : this.fonts.regular;
    const width = options.width ?? WIDTH;
    const value = fit(text, font, options.size, width);
    const x = options.x ?? MARGIN;
    this.page.drawText(value, {
      x: options.right ? x + width - font.widthOfTextAtSize(value, options.size) : x,
      y: this.y - (options.dy ?? 0) - options.size,
      size: options.size,
      font,
      color: options.color ?? INK,
    });
  }

  line(text: string, size: number, options: { bold?: boolean; color?: RGB; gap?: number } = {}): void {
    this.need(size + 4);
    this.text(text, { size, ...options });
    this.y -= size + (options.gap ?? 5);
  }

  rule(): void {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + WIDTH, y: this.y }, thickness: 0.75, color: RULE });
  }
}

const priceText = (item: InventoryItem): string | undefined => {
  if (item.book.price === undefined) return undefined;
  const price = formatPrice(item.book.price);
  return item.copies > 1 ? fr.inventoryPdf.times(item.copies, price) : price;
};

function detailsOf(item: InventoryItem): string {
  const { book } = item;
  const parts = [book.isbn13 ? fr.inventoryPdf.isbn(book.isbn13) : undefined];
  if (item.copies > 1) parts.push(fr.inventoryPdf.copies(item.copies));
  if (item.lentTo) parts.push(fr.inventoryPdf.lentTo(item.lentTo));
  if (item.places) parts.push(item.places.join(', '));
  if (isPrecious(book)) {
    const precious = new Set(fr.insurance.preciousTags.map((tag) => tag.toLocaleLowerCase('fr')));
    parts.push(...book.tags.filter((tag) => precious.has(tag.toLocaleLowerCase('fr'))));
  }
  return parts.filter(Boolean).join(' · ');
}

function drawPlaceholder(writer: Writer, fonts: Fonts, book: Book, x: number, y: number): void {
  writer.page.drawRectangle({ x, y, width: COVER.width, height: COVER.height, color: hex(placeholderColour(book.title)) });
  const initials = toWinAnsi(initialsOf(book.title));
  const size = 9;
  writer.page.drawText(initials, {
    x: x + (COVER.width - fonts.bold.widthOfTextAtSize(initials, size)) / 2,
    y: y + COVER.height / 2 - size / 3,
    size,
    font: fonts.bold,
    color: WHITE,
  });
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>, onDone: () => void): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++) {
        results[index] = await task(items[index] as T);
        onDone();
      }
    }),
  );
  return results;
}

/** The inventory as a PDF file, and its number of pages. */
export async function makeInventoryPdf(input: InventoryInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const { summary, groups, options, now } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(fr.inventoryPdf.title));
  doc.setLanguage('fr-FR');
  doc.setCreator(toWinAnsi(fr.app.name));
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };

  // Covers and photographs first, a few at a time, so that the progress can be shown.
  const books = options.covers ? groups.flatMap((group) => group.items.map((item) => item.book)) : [];
  const unique = [...new Map(books.map((book) => [book.id, book])).values()];
  const photographed = options.photos ? input.photographed : [];
  const total = unique.length + photographed.length;
  let done = 0;
  const progress = () => {
    done += 1;
    input.onProgress?.(done, total);
  };
  input.onProgress?.(0, total);
  const embed = async (bytes: Uint8Array | undefined): Promise<PDFImage | undefined> => {
    if (!bytes) return undefined;
    try {
      return await doc.embedJpg(bytes);
    } catch {
      return undefined;
    }
  };
  const coverImages = new Map<string, PDFImage | undefined>();
  const covers = await mapLimit(unique, 4, async (book) => embed(await input.loadImage(book, 160)), progress);
  unique.forEach((book, index) => coverImages.set(book.id, covers[index]));
  const photos = await mapLimit(photographed, 2, async (book) => embed(await input.loadImage(book, 1400)), progress);

  const writer = new Writer(doc, fonts);
  const date = formatDate(now);
  writer.line(fr.inventoryPdf.title, 20, { bold: true, gap: 8 });
  writer.line(fr.inventoryPdf.made(date), 10, { color: MUTED, gap: 10 });
  writer.line(fr.inventoryPdf.totals(summary.books, summary.copies), 10.5);
  if (options.prices) writer.line(fr.inventoryPdf.value(formatPrice(summary.value), summary.priced, summary.books), 10.5);
  if (summary.lost > 0) writer.line(fr.inventoryPdf.lost(summary.lost), 9, { color: MUTED });
  writer.y -= 6;

  const textX = MARGIN + (options.covers ? COVER.width + 10 : 0);
  const textWidth = MARGIN + WIDTH - textX - (options.prices ? PRICE_WIDTH + 8 : 0);
  const rowHeight = options.covers ? COVER.height + 10 : 42;
  let room: string | undefined;

  for (const group of groups) {
    if (group.room !== undefined && group.room !== room) {
      room = group.room;
      writer.need(26 + 18 + rowHeight);
      writer.y -= 10;
      writer.line(room, 13, { bold: true, gap: 6 });
    } else if (group.room === undefined) {
      writer.need(26 + rowHeight);
      writer.y -= 10;
      writer.line(fr.inventoryPdf.byTitle, 13, { bold: true, gap: 6 });
    }
    if (group.shelf !== undefined) {
      writer.need(18 + rowHeight);
      writer.line(fr.inventoryPdf.shelf(group.shelf, group.items.length), 10.5, { bold: true, color: ACCENT, gap: 6 });
    }
    for (const item of group.items) {
      writer.need(rowHeight);
      writer.rule();
      const top = writer.y;
      writer.y -= 6;
      if (options.covers) {
        const image = coverImages.get(item.book.id);
        const y = top - 5 - COVER.height;
        if (image) writer.page.drawImage(image, { x: MARGIN, y, width: COVER.width, height: COVER.height });
        else drawPlaceholder(writer, fonts, item.book, MARGIN, y);
      }
      writer.text(item.book.title || fr.common.untitled, { x: textX, size: 10, bold: true, width: textWidth });
      const byline = [item.book.authors.join(', '), item.book.publisher, item.book.year ? String(item.book.year) : undefined]
        .filter(Boolean)
        .join(' · ');
      writer.text(byline || fr.common.unknownAuthor, { x: textX, size: 8.5, color: MUTED, width: textWidth, dy: 14 });
      const details = detailsOf(item);
      if (details) writer.text(details, { x: textX, size: 8.5, color: MUTED, width: textWidth, dy: 26 });
      if (options.prices) {
        const price = priceText(item);
        writer.text(price ?? '—', { x: MARGIN + WIDTH - PRICE_WIDTH, size: 9.5, bold: price !== undefined, color: price ? INK : MUTED, width: PRICE_WIDTH, right: true });
      }
      writer.y = top - rowHeight;
    }
  }
  writer.rule();

  if (options.prices) {
    writer.y -= 10;
    writer.need(14);
    writer.text(fr.inventoryPdf.total(formatPrice(summary.value)), { size: 11, bold: true, right: true });
    writer.y -= 18;
  }

  const shown = photographed.flatMap((book, index) => {
    const image = photos[index];
    return image ? [{ book, image }] : [];
  });
  if (shown.length > 0) {
    writer.newPage();
    writer.line(fr.inventoryPdf.photos, 15, { bold: true, gap: 12 });
    const cellWidth = (WIDTH - 16) / 2;
    const imageHeight = 300;
    const cellHeight = imageHeight + 40;
    shown.forEach(({ book, image }, index) => {
      const column = index % 2;
      if (column === 0) writer.need(cellHeight);
      const x = MARGIN + column * (cellWidth + 16);
      const scale = Math.min(cellWidth / image.width, imageHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      writer.page.drawImage(image, { x: x + (cellWidth - width) / 2, y: writer.y - imageHeight + (imageHeight - height), width, height });
      const captionY = writer.y;
      writer.y = captionY - imageHeight - 6;
      writer.text(book.title || fr.common.untitled, { x, size: 9, bold: true, width: cellWidth });
      writer.text(book.tags.filter((tag) => isPrecious({ tags: [tag] })).join(' · '), { x, size: 8, color: MUTED, width: cellWidth, dy: 12 });
      writer.y = column === 1 || index === shown.length - 1 ? captionY - cellHeight : captionY;
    });
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const size = 8;
    const footer = toWinAnsi(fr.inventoryPdf.footer(date));
    const number = toWinAnsi(fr.inventoryPdf.page(index + 1, pages.length));
    page.drawText(footer, { x: MARGIN, y: 28, size, font: fonts.regular, color: MUTED });
    page.drawText(number, { x: MARGIN + WIDTH - fonts.regular.widthOfTextAtSize(number, size), y: 28, size, font: fonts.regular, color: MUTED });
  });

  return { bytes: await doc.save(), pages: pages.length };
}
