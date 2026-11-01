import { fr } from '../textes/fr';
import { TrashIcon } from './icons';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before an operation that cannot be undone. */
export function ConfirmSheet({ title, text, confirm, onConfirm, onClose }: ConfirmSheetProps) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p class="sheet__text">{text}</p>
      <div class="sheet__actions">
        <button type="button" class="button button--danger button--large" onClick={onConfirm}>
          <TrashIcon size={18} />
          {confirm}
        </button>
        <button type="button" class="button button--secondary button--large" onClick={onClose}>
          {fr.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}
