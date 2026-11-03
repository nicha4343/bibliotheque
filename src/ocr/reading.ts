import { db, type LibraryDatabase } from '../db/db';
import type { Id } from '../db/schema';
import { recognizeLines, type RecognizedImage } from './engine';
import { passageText } from './passage';

type Recognize = (photo: Blob) => Promise<RecognizedImage>;

/** Text of a photographed passage (« Citations », screen 6), empty when nothing could be read. */
export async function readPassage(photoBlobId: Id, database: LibraryDatabase = db, recognize: Recognize = recognizeLines): Promise<string> {
  const photo = await database.blobs.get(photoBlobId);
  return photo ? passageText(await recognize(photo.blob)) : '';
}
