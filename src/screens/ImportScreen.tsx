import { useRef, useState } from 'preact/hooks';
import { EnrichmentStatus } from '../components/EnrichmentStatus';
import { ChevronLeftIcon, PinIcon, UploadIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import { decodeText, parseCsv } from '../csv/csv';
import { enrichBooks, useEnrichment } from '../csv/enrich';
import { applyImport, previewImport, type ImportPreview, type ImportResult } from '../csv/import';
import { readLibraryFile, type FileFormat } from '../csv/read';
import type { Id } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { indexPlaces, loadPlaces, type PlaceIndex } from '../places/places';
import { routeHref } from '../router';
import { LocationPicker } from '../scan/LocationPicker';
import { fr } from '../textes/fr';

type Step =
  | { kind: 'choose'; error?: string }
  | { kind: 'reading' }
  | { kind: 'ready'; fileName: string; format: FileFormat; ignoredRows: number; preview: ImportPreview }
  | { kind: 'importing' }
  | { kind: 'done'; result: ImportResult };

const FORMAT_TEXTS: Record<FileFormat, string> = { app: fr.importFile.formatApp, libib: fr.importFile.formatLibib };

const EMPTY_PLACES = indexPlaces([], []);

async function readFile(file: File): Promise<Step> {
  let text: string;
  try {
    text = decodeText(await file.arrayBuffer());
  } catch {
    return { kind: 'choose', error: fr.importFile.unreadable };
  }
  const read = readLibraryFile(parseCsv(text));
  if (!read.ok) return { kind: 'choose', error: read.error === 'empty' ? fr.importFile.empty : fr.importFile.unknownFormat };
  const preview = await previewImport(read.books);
  return { kind: 'ready', fileName: file.name, format: read.format, ignoredRows: read.ignoredRows, preview };
}

function Summary({ step }: { step: Extract<Step, { kind: 'ready' }> }) {
  const { preview } = step;
  return (
    <section class="section" aria-labelledby="import-file">
      <h2 class="section__title" id="import-file">
        {step.fileName}
      </h2>
      <div class="card">
        <div class="card__row">
          <p class="card__label">{fr.importFile.newBooks(preview.newBooks.length, preview.copies)}</p>
          <p class="card__value">{FORMAT_TEXTS[step.format]}</p>
        </div>
        {preview.owned > 0 && (
          <div class="card__row">
            <p class="card__value">{fr.importFile.owned(preview.owned)}</p>
          </div>
        )}
        {step.ignoredRows > 0 && (
          <div class="card__row">
            <p class="card__value">{fr.importFile.ignored(step.ignoredRows)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** « Importer (CSV ou exportation Libib) », from the settings. */
export function ImportScreen() {
  const places = useLiveQuery<PlaceIndex>(() => loadPlaces(), [], EMPTY_PLACES);
  const enrichment = useEnrichment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [shelfId, setShelfId] = useState<Id>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const choose = () => {
    inputRef.current?.click();
  };

  const onFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Emptied so that choosing the same file again is noticed.
    input.value = '';
    if (!file) return;
    setStep({ kind: 'reading' });
    void readFile(file).then(setStep, (error: unknown) => {
      console.error(error);
      setStep({ kind: 'choose', error: fr.importFile.unreadable });
    });
  };

  const start = async (preview: ImportPreview) => {
    setStep({ kind: 'importing' });
    try {
      const result = await applyImport(preview.newBooks, preview.needsShelf ? shelfId : undefined);
      setStep({ kind: 'done', result });
      enrichBooks(result.searchableIds);
    } catch (error) {
      console.error(error);
      setStep({ kind: 'choose', error: fr.importFile.failed });
    }
  };

  const place = shelfId ? places.byShelfId.get(shelfId) : undefined;
  const ready = step.kind === 'ready' ? step : undefined;
  const canImport = ready && ready.preview.newBooks.length > 0 && (!ready.preview.needsShelf || place);

  return (
    <Screen title={fr.importFile.title}>
      <div class="back-bar">
        <a class="text-button back-bar__link" href={routeHref('settings')}>
          <ChevronLeftIcon size={20} />
          {fr.importFile.back}
        </a>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain,text/comma-separated-values,application/csv,application/vnd.ms-excel"
        hidden
        tabIndex={-1}
        aria-label={fr.importFile.choose}
        onChange={(event) => {
          onFile(event.currentTarget);
        }}
      />

      {(step.kind === 'choose' || step.kind === 'reading') && (
        <>
          <p class="screen__intro">{fr.importFile.intro}</p>
          <button type="button" class="button button--primary button--large" disabled={step.kind === 'reading'} onClick={choose}>
            <UploadIcon size={20} />
            {fr.importFile.choose}
          </button>
          {step.kind === 'reading' ? (
            <p class="sheet__hint sheet__hint--busy" role="status">
              <span class="spinner" aria-hidden="true" />
              {fr.importFile.reading}
            </p>
          ) : (
            <p class="status-line status-line--warn" role="status">
              {step.error ?? ''}
            </p>
          )}
        </>
      )}

      {ready && (
        <>
          <Summary step={ready} />
          {ready.preview.newBooks.length === 0 ? (
            <p class="status-line" role="status">
              {fr.importFile.nothingNew}
            </p>
          ) : ready.preview.needsShelf ? (
            <section class="section" aria-labelledby="import-destination">
              <h2 class="section__title" id="import-destination">
                {fr.importFile.destination}
              </h2>
              <div class="card">
                <button
                  type="button"
                  class="link-row"
                  onClick={() => {
                    setPickerOpen(true);
                  }}
                >
                  {place?.label ?? fr.importFile.chooseDestination}
                  <PinIcon size={18} />
                </button>
              </div>
              <p class="screen__intro">
                {ready.format === 'libib' ? fr.importFile.destinationLibib : fr.importFile.destinationPartial}
              </p>
            </section>
          ) : (
            <p class="screen__intro">{fr.importFile.placesFromFile}</p>
          )}
          <div class="sticky-footer import__actions">
            {ready.preview.newBooks.length > 0 && (
              <button
                type="button"
                class="button button--primary button--large"
                disabled={!canImport}
                onClick={() => void start(ready.preview)}
              >
                {fr.importFile.start(ready.preview.newBooks.length)}
              </button>
            )}
            <button type="button" class="button button--secondary button--large" onClick={choose}>
              {fr.importFile.chooseOther}
            </button>
          </div>
        </>
      )}

      {step.kind === 'importing' && (
        <p class="sheet__hint sheet__hint--busy" role="status">
          <span class="spinner" aria-hidden="true" />
          {fr.importFile.importing}
        </p>
      )}

      {step.kind === 'done' && (
        <>
          <p class="status-line" role="status">
            {fr.importFile.done(step.result.bookIds.length, step.result.copies)}
          </p>
          <a class="button button--secondary button--large" href={routeHref('library')}>
            {fr.importFile.library}
          </a>
        </>
      )}

      {(enrichment.running || step.kind === 'done') && <EnrichmentStatus state={enrichment} />}

      {pickerOpen && (
        <LocationPicker
          places={places}
          title={fr.importFile.destinationTitle}
          currentShelfId={shelfId}
          onPick={(shelf) => {
            setShelfId(shelf.id);
            setPickerOpen(false);
          }}
          onClose={() => {
            setPickerOpen(false);
          }}
        />
      )}
    </Screen>
  );
}
