import type { ComponentType } from 'preact';
import { NavBar } from './components/NavBar';
import { PwaNotices } from './components/PwaNotices';
import { useRoute, type RouteId } from './router';
import { LibraryScreen } from './screens/LibraryScreen';
import { PendingScreen } from './screens/PendingScreen';
import { ScanScreen } from './screens/ScanScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const SCREENS: Record<RouteId, ComponentType> = {
  library: LibraryScreen,
  scan: ScanScreen,
  pending: PendingScreen,
  settings: SettingsScreen,
};

export function App() {
  const route = useRoute();
  const CurrentScreen = SCREENS[route];

  return (
    <div class="app">
      <CurrentScreen />
      <PwaNotices />
      <NavBar current={route} />
    </div>
  );
}
