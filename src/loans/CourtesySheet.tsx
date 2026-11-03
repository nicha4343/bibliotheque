import { useState } from 'preact/hooks';
import { Sheet } from '../components/Sheet';
import { fr } from '../textes/fr';

interface CourtesySheetProps {
  borrower: string;
  /** Message proposed, which the user may change. */
  message: string;
  onClose: () => void;
}

/**
 * « Adresser un rappel courtois »: the message is handed to the app of the user's choice (text
 * message, e-mail…) through the share sheet of the phone, or copied where there is none.
 */
export function CourtesySheet({ borrower, message, onClose }: CourtesySheetProps) {
  const [text, setText] = useState(message);
  const [status, setStatus] = useState('');
  const canShare = typeof navigator.share === 'function';

  const share = async () => {
    try {
      await navigator.share({ text });
      onClose();
    } catch {
      // Closed without choosing an app: the sheet stays open.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(fr.courtesy.copied);
    } catch {
      setStatus(fr.courtesy.copyFailed);
    }
  };

  return (
    <Sheet title={fr.courtesy.title(borrower)} onClose={onClose}>
      <div class="sheet__form">
        <div class="field">
          <label class="field__label" for="courtesy-text">
            {fr.courtesy.label}
          </label>
          <textarea
            id="courtesy-text"
            class="field__input"
            rows={6}
            value={text}
            aria-describedby="courtesy-hint"
            onInput={(event) => {
              setText(event.currentTarget.value);
            }}
          />
          <p class="field__hint" id="courtesy-hint">
            {fr.courtesy.hint}
          </p>
        </div>
        <p class="status-line" role="status">
          {status}
        </p>
        <div class="sheet__actions">
          {canShare && (
            <button type="button" class="button button--primary button--large" onClick={() => void share()}>
              {fr.courtesy.send}
            </button>
          )}
          <button
            type="button"
            class={canShare ? 'button button--secondary button--large' : 'button button--primary button--large'}
            onClick={() => void copy()}
          >
            {fr.courtesy.copy}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
