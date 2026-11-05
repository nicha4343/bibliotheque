import { useState } from 'preact/hooks';
import { FileIcon, ShareIcon } from '../components/icons';
import { SwitchRow } from '../components/SwitchRow';
import { downloadBlob, isoDate } from '../csv/export';
import { db } from '../db/db';
import type { Book, Copy, Loan } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import {
  DEFAULT_INVENTORY_OPTIONS,
  inventoryGroups,
  inventorySummary,
  photographedPrecious,
  type InventoryOptions,
  type InventorySummary,
} from '../insurance/inventory';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { formatPrice, fr } from '../textes/fr';

interface InsuranceData {
  books: Book[];
  copies: Copy[];
  loans: Loan[];
  places: PlaceIndex;
  summary: InventorySummary;
}

async function loadInsurance(): Promise<InsuranceData> {
  const [books, copies, loans, places] = await Promise.all([db.books.toArray(), db.copies.toArray(), db.loans.toArray(), loadPlaces()]);
  return { books, copies, loans, places, summary: inventorySummary(books, copies, places) };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number }
  | { kind: 'ready'; file: File; pages: number }
  | { kind: 'failed' };

// Kept while the application is open, as the filters of the library.
let savedOptions: InventoryOptions = { ...DEFAULT_INVENTORY_OPTIONS };

/** « Assurance »: the inventory as a PDF file, to keep away from home. */
export function InsuranceTab() {
  const data = useLiveQuery<InsuranceData | undefined>(() => loadInsurance(), [], undefined);
  const [options, setOptions] = useState<InventoryOptions>(savedOptions);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [message, setMessage] = useState('');
  if (!data) return null;
  const { summary } = data;

  const change = (changes: Partial<InventoryOptions>) => {
    const next = { ...options, ...changes };
    savedOptions = next;
    setOptions(next);
    setStatus({ kind: 'idle' });
    setMessage('');
  };

  const generate = async () => {
    setMessage('');
    setStatus({ kind: 'working', done: 0, total: 0 });
    try {
      const [{ makeInventoryPdf }, { loadJpeg }] = await Promise.all([import('../insurance/pdf'), import('../insurance/images')]);
      const kept = new Set(data.copies.filter((copy) => copy.lostAt === undefined).map((copy) => copy.bookId));
      const result = await makeInventoryPdf({
        summary,
        groups: inventoryGroups(data.books, data.copies, data.loans, data.places, options.byPlace),
        photographed: photographedPrecious(data.books.filter((book) => kept.has(book.id))),
        options: { ...options, photos: options.photos && summary.photos > 0 },
        now: new Date(),
        loadImage: loadJpeg,
        onProgress: (done, total) => {
          setStatus({ kind: 'working', done, total });
        },
      });
      const fileName = fr.insurance.fileName(isoDate(Date.now()));
      setStatus({ kind: 'ready', file: new File([result.bytes as BlobPart], fileName, { type: 'application/pdf' }), pages: result.pages });
    } catch (error) {
      console.error(error);
      setStatus({ kind: 'failed' });
    }
  };

  const save = (file: File) => {
    downloadBlob(file.name, file);
    setMessage(fr.insurance.saved(file.name));
  };

  const canSend = (file: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  const send = (file: File) => {
    navigator.share({ files: [file], title: fr.inventoryPdf.title }).catch(() => undefined);
  };

  if (summary.books === 0) return <p class="screen__intro">{fr.insurance.empty}</p>;

  const details = [
    ...(summary.sites > 0 ? [fr.insurance.sites(summary.sites)] : []),
    fr.insurance.places(summary.rooms, summary.shelves),
    fr.insurance.priced(summary.priced),
  ].join(' · ');

  return (
    <>
      <div class="card inventory-card">
        <p class="inventory-card__kicker">{fr.insurance.kicker}</p>
        <p class="inventory-card__count">{fr.insurance.books(summary.books)}</p>
        <p class="inventory-card__detail">{details}</p>
        {summary.priced > 0 && <p class="inventory-card__detail">{fr.insurance.value(formatPrice(summary.value))}</p>}
      </div>

      <section class="section" aria-labelledby="inventory-options-title">
        <h2 class="section__title" id="inventory-options-title">
          {fr.insurance.options}
        </h2>
        <div class="card">
          <SwitchRow
            label={fr.insurance.covers}
            checked={options.covers}
            onChange={(covers) => {
              change({ covers });
            }}
          />
          <SwitchRow
            label={fr.insurance.prices}
            detail={fr.insurance.pricesDetail}
            checked={options.prices}
            onChange={(prices) => {
              change({ prices });
            }}
          />
          <SwitchRow
            label={fr.insurance.byPlace}
            detail={fr.insurance.byPlaceDetail}
            checked={options.byPlace}
            onChange={(byPlace) => {
              change({ byPlace });
            }}
          />
          <SwitchRow
            label={fr.insurance.photos}
            detail={fr.insurance.photosDetail(summary.photos)}
            checked={options.photos && summary.photos > 0}
            disabled={summary.photos === 0}
            onChange={(photos) => {
              change({ photos });
            }}
          />
        </div>
      </section>

      {status.kind === 'ready' ? (
        <div class="inventory-ready">
          <p class="status-line">{fr.insurance.ready(status.pages)}</p>
          <button
            type="button"
            class="button button--primary button--large"
            onClick={() => {
              save(status.file);
            }}
          >
            <FileIcon size={20} />
            {fr.insurance.save}
          </button>
          {canSend(status.file) && (
            <button
              type="button"
              class="button button--secondary button--large"
              onClick={() => {
                send(status.file);
              }}
            >
              <ShareIcon size={20} />
              {fr.insurance.send}
            </button>
          )}
        </div>
      ) : (
        <button type="button" class="button button--primary button--large" disabled={status.kind === 'working'} onClick={() => void generate()}>
          <FileIcon size={20} />
          {fr.insurance.generate}
        </button>
      )}

      <p class={status.kind === 'failed' ? 'status-line status-line--warn' : 'status-line'} role="status">
        {status.kind === 'working' ? fr.insurance.generating(status.done, status.total) : status.kind === 'failed' ? fr.insurance.failed : message}
      </p>
      <p class="screen__intro">{fr.insurance.note}</p>
    </>
  );
}
