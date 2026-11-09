import { NavBar } from './components/NavBar';
import { PwaNotices } from './components/PwaNotices';
import { LOAN_HISTORY, useRoute, type Route, type TabId } from './router';
import { AuthorScreen } from './screens/AuthorScreen';
import { BackupScreen } from './screens/BackupScreen';
import { BookScreen } from './screens/BookScreen';
import { BookshopScreen } from './screens/BookshopScreen';
import { EntryScreen } from './screens/EntryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LabelsScreen } from './screens/LabelsScreen';
import { LendScanScreen } from './screens/LendScanScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { ListsScreen, listTabOf } from './screens/ListsScreen';
import { LoanHistoryScreen, LoansScreen } from './screens/LoansScreen';
import { PendingScreen } from './screens/PendingScreen';
import { PlacesScreen } from './screens/PlacesScreen';
import { RecapScreen } from './screens/RecapScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SeriesListScreen, SeriesScreen } from './screens/SeriesScreen';
import { InvitationScreen } from './screens/InvitationScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SharedBookScreen } from './screens/SharedBookScreen';
import { SharedListScreen } from './screens/SharedListScreen';
import { SharedPlaceScreen } from './screens/SharedPlaceScreen';
import { SharingScreen } from './screens/SharingScreen';
import { SiteSharingScreen } from './screens/SiteSharingScreen';
import { ShelfCheckScreen } from './screens/ShelfCheckScreen';
import { ShelfScreen } from './screens/ShelfScreen';
import { ShelvesScreen } from './screens/ShelvesScreen';

/** Tab highlighted in the navigation bar; none for full-screen pages (scan, recap…). */
function tabOf(route: Route): TabId | undefined {
  switch (route.id) {
    case 'library':
    case 'book':
    case 'shelves':
    case 'shelf':
    case 'loans':
    case 'series':
    case 'author':
    case 'lists':
    case 'sharedPlace':
    case 'invitation':
      return 'library';
    case 'pending':
      return 'pending';
    case 'settings':
    case 'places':
    case 'labels':
    case 'import':
    case 'backup':
    case 'sharing':
      return 'settings';
    default:
      return undefined;
  }
}

function CurrentScreen({ route }: { route: Route }) {
  switch (route.id) {
    case 'scan':
      return <ScanScreen />;
    case 'recap':
      return <RecapScreen sessionId={route.param} />;
    case 'pending':
      return <PendingScreen />;
    case 'book':
      return route.param ? <BookScreen key={route.param} bookId={route.param} /> : <LibraryScreen />;
    case 'entry':
      return <EntryScreen key={route.param ?? 'all'} itemId={route.param} />;
    case 'settings':
      return <SettingsScreen />;
    case 'places':
      return <PlacesScreen />;
    case 'labels':
      return <LabelsScreen key={route.param ?? 'all'} shelfId={route.param} />;
    case 'shelves':
      return <ShelvesScreen />;
    case 'shelf':
      return route.param ? <ShelfScreen key={route.param} shelfRef={route.param} copyId={route.detail} /> : <ShelvesScreen />;
    case 'check':
      return route.param ? <ShelfCheckScreen key={route.param} shelfId={route.param} /> : <ShelvesScreen />;
    case 'loans':
      return route.param === LOAN_HISTORY ? <LoanHistoryScreen /> : <LoansScreen />;
    case 'lend':
      return <LendScanScreen key="lend" mode="lend" />;
    case 'giveBack':
      return <LendScanScreen key="return" mode="return" />;
    case 'series':
      return route.param ? <SeriesScreen key={route.param} name={route.param} /> : <SeriesListScreen />;
    case 'author':
      return route.param ? <AuthorScreen key={route.param} name={route.param} /> : <LibraryScreen />;
    case 'lists':
      return <ListsScreen key={route.param ?? 'wishes'} tab={listTabOf(route.param)} />;
    case 'bookshop':
      return <BookshopScreen />;
    case 'sharedList':
      return route.param ? <SharedListScreen key={route.param} payload={route.param} /> : <LibraryScreen />;
    case 'sharing':
      return route.param ? <SiteSharingScreen key={route.param} siteId={route.param} /> : <SharingScreen />;
    case 'invitation':
      return route.param ? <InvitationScreen key={route.param} payload={route.param} /> : <SharingScreen />;
    case 'sharedPlace':
      if (!route.param) return <SharingScreen />;
      return route.detail ? (
        <SharedBookScreen key={route.detail} fileId={route.param} bookId={route.detail} />
      ) : (
        <SharedPlaceScreen key={route.param} fileId={route.param} />
      );
    case 'import':
      return <ImportScreen />;
    case 'backup':
      return <BackupScreen />;
    default:
      return <LibraryScreen />;
  }
}

export function App() {
  const route = useRoute();
  const tab = tabOf(route);

  return (
    <div class={tab ? 'app' : 'app app--full'}>
      <CurrentScreen route={route} />
      <PwaNotices />
      {tab && <NavBar current={tab} />}
    </div>
  );
}
