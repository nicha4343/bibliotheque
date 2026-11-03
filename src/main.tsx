// Fonts are bundled (not loaded from Google Fonts) so the app looks the same offline.
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/lists.css';
import { render } from 'preact';
import { App } from './app';
import { startBackups } from './backup/backup';
import { requestPersistentStorage } from './db/storage';
import { startHistoryTracking } from './router';
import { refreshLoanNotifications } from './loans/reminders';
import { startCoverReading } from './pending/coverReading';
import { unlockAudio } from './scan/feedback';
import { startLookups } from './scan/lookups';
import { startSeriesCompletion } from './series/completion';

void requestPersistentStorage();
// Before the first rendering: a return from Google's sign-in page leads to the backup screen.
startBackups();
// Codes read offline or before the app was closed are searched again.
startLookups();
// Series of the books already catalogued, asked once to the BnF.
startSeriesCompletion();
// Photographs of « À compléter » read by Gemini in the background, never during a scan (lot 6).
startCoverReading();
// « Notification à l’échéance »: the daily check of the loans is registered again.
void refreshLoanNotifications();
// Browsers only allow sound after a touch.
document.addEventListener('pointerdown', unlockAudio, { passive: true });

// « Retour » goes back only to a screen of the application.
startHistoryTracking();

const root = document.getElementById('app');
if (root) render(<App />, root);
