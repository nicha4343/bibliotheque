import { db } from '../db/db';
import type { Book } from '../db/schema';

// Covers and photographs for the PDF: reduced and turned into JPEG (the only format drawn), on a white
// background. A cover kept as a link (Decitre) cannot be read by the application: it is left out.

async function sourceOf(book: Book): Promise<Blob | undefined> {
  const cover = book.cover;
  if (cover?.blobId) return (await db.blobs.get(cover.blobId))?.blob;
  if (!cover?.url) return undefined;
  try {
    const response = await fetch(cover.url, { mode: 'cors' });
    return response.ok ? await response.blob() : undefined;
  } catch {
    return undefined;
  }
}

export async function loadJpeg(book: Book, maxSide: number): Promise<Uint8Array | undefined> {
  const blob = await sourceOf(book);
  if (!blob) return undefined;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
    return jpeg ? new Uint8Array(await jpeg.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}
