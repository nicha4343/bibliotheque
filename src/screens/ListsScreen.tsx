import { useState } from 'preact/hooks';
import { BackLink } from '../components/BackLink';
import { Screen } from '../components/Screen';
import { DuplicatesTab } from '../lists/DuplicatesTab';
import { InsuranceTab } from '../lists/InsuranceTab';
import { WishesTab } from '../lists/WishesTab';
import { LIST_TABS, routeHref, type ListTab } from '../router';
import { fr } from '../textes/fr';

const TABS: { id: ListTab; label: string }[] = [
  { id: 'wishes', label: fr.lists.wishes },
  { id: 'duplicates', label: fr.lists.duplicates },
  { id: 'insurance', label: fr.lists.insurance },
];

export const listTabOf = (param: string | undefined): ListTab =>
  (Object.keys(LIST_TABS) as ListTab[]).find((tab) => LIST_TABS[tab] === param) ?? 'wishes';

/** Screen 11: wishes and the bookshop check, duplicates to give, inventory for the insurance. */
export function ListsScreen({ tab: initialTab }: { tab: ListTab }) {
  const [tab, setTab] = useState(initialTab);

  const pick = (next: ListTab) => {
    setTab(next);
    // The address follows the tab, without a new entry in the history: « Retour » leaves the lists.
    window.history.replaceState(window.history.state, '', routeHref('lists', LIST_TABS[next]));
  };

  return (
    <Screen title={fr.lists.title}>
      <BackLink href={routeHref('library')} label={fr.lists.back} />
      <div class="segmented segmented--three" role="group" aria-label={fr.lists.tabs}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            class="segmented__option"
            aria-pressed={tab === id}
            onClick={() => {
              pick(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'wishes' && <WishesTab />}
      {tab === 'duplicates' && <DuplicatesTab />}
      {tab === 'insurance' && <InsuranceTab />}
    </Screen>
  );
}
