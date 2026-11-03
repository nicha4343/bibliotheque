import { useState } from 'preact/hooks';
import { MicIcon, SearchIcon } from '../components/icons';
import { dictationSupported, useDictation, type DictationError } from '../components/useDictation';
import { getSettings } from '../db/settings';
import { searchEditions, type FoundEdition } from '../metadata/titleSearch';
import { formatNumber, fr } from '../textes/fr';

const dictationMessage = (error: DictationError, code: string): string =>
  ({
    denied: fr.entry.dictationDenied,
    network: fr.entry.dictationNetwork,
    nothing: fr.entry.dictationNothing,
    failed: fr.entry.dictationFailed(code),
  })[error];

type Status =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; editions: FoundEdition[] }
  | { kind: 'none'; placed: boolean }
  | { kind: 'unavailable' }
  | { kind: 'picked'; edition: FoundEdition };

interface EditionSearchProps {
  onPick: (edition: FoundEdition) => void;
  /** Nothing found: the words searched may become the title. Returns whether they did. */
  onNothing: (query: string) => boolean;
}

/**
 * « Rechercher l’ouvrage » (screen 4, lot 6): the title and author dictated, or typed, are searched
 * in the catalogues; touching the matching edition fills the form.
 */
export function EditionSearch({ onPick, onNothing }: EditionSearchProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const search = async (text: string) => {
    const words = text.trim();
    if (!words) return;
    setStatus({ kind: 'searching' });
    const settings = await getSettings();
    const { editions, unavailable } = await searchEditions(words, { sources: settings.sources, googleBooksKey: settings.googleBooksKey });
    if (editions.length > 0) setStatus({ kind: 'results', editions });
    else if (unavailable) setStatus({ kind: 'unavailable' });
    else setStatus({ kind: 'none', placed: onNothing(words) });
  };

  const dictation = useDictation((text) => {
    setQuery(text);
    void search(text);
  });

  const message = dictation.listening
    ? dictation.heard || fr.entry.listening
    : dictation.error
      ? dictationMessage(dictation.error, dictation.errorCode)
      : {
          idle: '',
          searching: fr.entry.searching,
          results: fr.entry.resultsHint,
          none: status.kind === 'none' && status.placed ? fr.entry.noResultPlaced : fr.entry.noResult,
          unavailable: fr.entry.searchUnavailable,
          picked: status.kind === 'picked' ? fr.entry.picked(fr.entry.pickedFrom[status.edition.provider]) : '',
        }[status.kind];

  return (
    <section class="edition-search" aria-labelledby="edition-search-title">
      <h2 class="edition-search__title" id="edition-search-title">
        {fr.entry.searchTitle}
      </h2>
      {dictationSupported() && (
        <button
          type="button"
          class={dictation.listening ? 'button button--primary button--large' : 'button button--secondary button--large'}
          aria-pressed={dictation.listening}
          disabled={status.kind === 'searching'}
          onClick={dictation.listening ? dictation.stop : dictation.start}
        >
          <MicIcon size={20} />
          {dictation.listening ? fr.entry.stopDictation : fr.entry.dictate}
        </button>
      )}
      <input
        class="field__input"
        type="search"
        aria-label={fr.entry.searchLabel}
        placeholder={dictationSupported() ? fr.entry.searchPlaceholder : fr.entry.searchPlaceholderTyped}
        autocomplete="off"
        enterKeyHint="search"
        value={dictation.listening ? dictation.heard : query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
        }}
        // Inside the entry form: Enter searches, it does not save the notice.
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void search(query);
        }}
      />
      <p class="edition-search__hint">{fr.entry.keyboardHint}</p>
      {/* Named in full: a magnifier alone, greyed until something is typed, went unnoticed on the phone. */}
      <button
        type="button"
        class="button button--secondary button--large"
        disabled={!query.trim() || status.kind === 'searching'}
        onClick={() => void search(query)}
      >
        {status.kind === 'searching' ? <span class="spinner" aria-hidden="true" /> : <SearchIcon size={20} />}
        {fr.entry.search}
      </button>
      <p class="edition-search__status" role="status">
        {message}
      </p>
      {status.kind === 'results' && (
        <ul class="edition-list" aria-label={fr.entry.resultsLabel(formatNumber(status.editions.length))}>
          {status.editions.map((edition, index) => (
            <li key={`${edition.provider}-${index}`}>
              <button
                type="button"
                class="edition"
                onClick={() => {
                  onPick(edition);
                  setStatus({ kind: 'picked', edition });
                }}
              >
                {edition.coverUrl ? (
                  <img class="edition__cover" src={edition.coverUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
                ) : (
                  <span class="edition__cover" aria-hidden="true" />
                )}
                <span class="edition__body">
                  <span class="edition__title">{edition.title}</span>
                  <span class="edition__details">
                    {[edition.authors.join(', '), edition.publisher, edition.year && String(edition.year)].filter(Boolean).join(' · ')}
                  </span>
                  <span class="edition__source">{fr.entry.source(fr.common.providers[edition.provider])}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
