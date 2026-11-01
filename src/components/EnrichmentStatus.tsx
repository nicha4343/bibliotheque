import type { EnrichmentState } from '../csv/enrich';
import { fr } from '../textes/fr';

/** Progress, then outcome, of the background search of covers and missing fields. */
export function EnrichmentStatus({ state }: { state: EnrichmentState }) {
  if (state.total === 0) return null;
  if (state.running) {
    return (
      <>
        <p class="sheet__hint sheet__hint--busy" role="status">
          <span class="spinner" aria-hidden="true" />
          {fr.enrichment.running(state.done, state.total)}
        </p>
        <p class="screen__intro">{fr.enrichment.runningHint}</p>
      </>
    );
  }
  return (
    <p class={state.notSearched > 0 ? 'status-line status-line--warn' : 'status-line'} role="status">
      {state.withCovers ? fr.enrichment.done(state.covers, state.total) : fr.enrichment.doneNoCovers}
      {state.notSearched > 0 && ` ${fr.enrichment.notSearched(state.notSearched)}`}
    </p>
  );
}
