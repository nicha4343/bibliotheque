import { NavBar } from './components/NavBar';
import { PwaNotices } from './components/PwaNotices';
import { useRoute, type Route, type TabId } from './router';
import { BackupScreen } from './screens/BackupScreen';
import { BookScreen } from './screens/BookScreen';
import { EntryScreen } from './screens/EntryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { LabelsScreen } from './screens/LabelsScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PendingScreen } from './screens/PendingScreen';
import { PlacesScreen } from './screens/PlacesScreen';
import { RecapScreen } from './screens/RecapScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SettingsScreen } from './screens/SettingsScreen';
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
      return 'library';
    case 'pending':
      return 'pending';
    case 'settings':
    case 'places':
    case 'labels':
    case 'import':
    case 'backup':
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
