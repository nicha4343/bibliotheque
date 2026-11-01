import { useState } from 'preact/hooks';
import { CameraSheet } from '../components/CameraSheet';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { CoverImage } from '../components/CoverImage';
import { EmptyState } from '../components/EmptyState';
import { ChevronRightIcon, PendingIcon, PinIcon, QuestionIcon, TrashIcon } from '../components/icons';
import { Screen } from '../components/Screen';
import type { Id, PendingItem } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { deleteItem, listPendingItems, retryItem, setItemPhoto } from '../pending/pending';
import { loadPlaces, type PlaceIndex } from '../places/places';
import { routeHref } from '../router';
import { formatDate, formatNumber, fr } from '../textes/fr';

type Filter = 'all' | PendingItem['kind'];

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: fr.pending.filterAll },
  { id: 'unknownIsbn', label: fr.pending.filterUnknown },
  { id: 'noBarcode', label: fr.pending.filterNoBarcode },
];

/** Screen 3: items put aside during the scans, completed at leisure. */
export function PendingScreen() {
  const items = useLiveQuery<PendingItem[] | undefined>(() => listPendingItems(), [], undefined);
  const places = useLiveQuery<PlaceIndex | undefined>(() => loadPlaces(), [], undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState<ReadonlySet<Id>>(new Set());
  const [photographing, setPhotographing] = useState<Id>();
  const [removing, setRemoving] = useState<PendingItem>();

  const all = items ?? [];
  const shown = filter === 'all' ? all : all.filter((item) => item.kind === filter);
  const countOf = (id: Filter) => (id === 'all' ? all.length : all.filter((item) => item.kind === id).length);

  const retry = async (item: PendingItem) => {
    setSearching((current) => new Set(current).add(item.id));
    try {
      const outcome = await retryItem(item.id);
      if (outcome.status === 'found') setMessage(fr.pending.found(outcome.title || fr.common.untitled));
      else setMessage(outcome.status === 'unknown' ? fr.pending.stillUnknown : fr.pending.unavailable);
    } finally {
      setSearching((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const remove = async (item: PendingItem) => {
    setRemoving(undefined);
    await deleteItem(item.id);
    setMessage(fr.pending.removed);
  };

  return (
    <Screen
      title={fr.pending.title}
      titleAside={all.length > 0 && <span class="count-badge">{formatNumber(all.length)}</span>}
    >
      {items?.length === 0 && (
        <EmptyState icon={<PendingIcon size={40} />} title={fr.pending.emptyTitle} text={fr.pending.emptyText} />
      )}
      <p class="status-line" role="status">
        {message}
      </p>

      {all.length > 0 && (
        <>
          <p class="screen__intro">{fr.pending.intro}</p>
          <div class="chips chips--wrap" role="group" aria-label={fr.pending.filters}>
            {FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                class="chip"
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id);
                }}
              >
                {label} <span class="chip__count">{formatNumber(countOf(id))}</span>
              </button>
            ))}
          </div>

          <ul class="pending-list">
            {shown.map((item) => (
              <PendingCard
                key={item.id}
                item={item}
                place={places?.byShelfId.get(item.shelfId)?.label}
                searching={searching.has(item.id)}
                onRetry={() => void retry(item)}
                onPhotograph={() => {
                  setPhotographing(item.id);
                }}
                onRemove={() => {
                  setRemoving(item);
                }}
              />
            ))}
          </ul>

          <div class="sticky-footer">
            <a class="button button--primary button--large" href={routeHref('entry')}>
              {fr.pending.completeSeries(all.length)}
              <ChevronRightIcon size={18} />
            </a>
          </div>
        </>
      )}

      {photographing && (
        <CameraSheet
          onCapture={(photo) => setItemPhoto(photographing, photo)}
          onClose={() => {
            setPhotographing(undefined);
          }}
        />
      )}

      {removing && (
        <ConfirmSheet
          title={fr.pending.removeTitle}
          text={fr.pending.removeText}
          confirm={fr.pending.remove}
          onConfirm={() => void remove(removing)}
          onClose={() => {
            setRemoving(undefined);
          }}
        />
      )}
    </Screen>
  );
}

interface PendingCardProps {
  item: PendingItem;
  place: string | undefined;
  searching: boolean;
  onRetry: () => void;
  onPhotograph: () => void;
  onRemove: () => void;
}

function PendingCard({ item, place, searching, onRetry, onPhotograph, onRemove }: PendingCardProps) {
  const unknown = item.kind === 'unknownIsbn';
  const kind = unknown ? fr.pending.kindUnknown : fr.pending.kindNoBarcode;
  return (
    <li class="pending-card">
      {item.photoBlobId ? (
        <CoverImage book={undefined} photoBlobId={item.photoBlobId} class="cover--card" />
      ) : (
        <span class="cover cover--card cover--pending" aria-hidden="true">
          <QuestionIcon size={24} />
        </span>
      )}
      <div class="pending-card__body">
        <p class="pending-card__kind">{kind}</p>
        {item.isbn && <p class="pending-card__isbn mono">{item.isbn}</p>}
        <p class="pending-card__text">
          {unknown ? fr.pending.unknownText : fr.pending.noBarcodeText(formatDate(new Date(item.createdAt)))}
        </p>
        {place && (
          <p class="pending-card__place">
            <PinIcon size={14} />
            {place}
          </p>
        )}
        <div class="pending-card__actions">
          {unknown && (
            <button type="button" class="small-button small-button--accent" disabled={searching} onClick={onRetry}>
              {searching && <span class="spinner" aria-hidden="true" />}
              {searching ? fr.pending.retrying : fr.pending.retry}
            </button>
          )}
          {!item.photoBlobId && (
            <button type="button" class="small-button" onClick={onPhotograph}>
              {fr.pending.photograph}
            </button>
          )}
          <a class="small-button" href={routeHref('entry', item.id)}>
            {fr.pending.enter}
          </a>
        </div>
      </div>
      <button type="button" class="icon-button pending-card__remove" aria-label={fr.pending.removeLabel(item.isbn ?? kind)} onClick={onRemove}>
        <TrashIcon size={18} />
      </button>
    </li>
  );
}
