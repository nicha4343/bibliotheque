import { NavBar } from './components/NavBar';
import { PwaNotices } from './components/PwaNotices';
import { useRoute, type Route, type TabId } from './router';
import { BookScreen } from './screens/BookScreen';
import { EntryScreen } from './screens/EntryScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PendingScreen } from './screens/PendingScreen';
import { RecapScreen } from './screens/RecapScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SettingsScreen } from './screens/SettingsScreen';

/** Tab highlighted in the navigation bar; none for full-screen pages (scan, recap…). */
function tabOf(route: Route): TabId | undefined {
  switch (route.id) {
    case 'library':
    case 'book':
      return 'library';
    case 'pending':
      return 'pending';
    case 'settings':
    case 'places':
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
