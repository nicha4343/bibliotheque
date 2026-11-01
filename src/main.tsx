// Fonts are bundled (not loaded from Google Fonts) so the app looks the same offline.
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/components.css';
import './styles/screens.css';
import { render } from 'preact';
import { App } from './app';
import { requestPersistentStorage } from './db/storage';
import { unlockAudio } from './scan/feedback';
import { startLookups } from './scan/lookups';

void requestPersistentStorage();
// Codes read offline or before the app was closed are searched again.
startLookups();
// Browsers only allow sound after a touch.
document.addEventListener('pointerdown', unlockAudio, { passive: true });

const root = document.getElementById('app');
if (root) render(<App />, root);
