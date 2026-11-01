import type { ComponentChildren } from 'preact';
import { fr } from '../textes/fr';
import { TrashIcon } from './icons';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  /** A bin by default. */
  icon?: ComponentChildren;
}

/** Asks before an operation that cannot be undone. */
export function ConfirmSheet({ title, text, confirm, onConfirm, onClose, icon = <TrashIcon size={18} /> }: ConfirmSheetProps) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p class="sheet__text">{text}</p>
      <div class="sheet__actions">
        <button type="button" class="button button--danger button--large" onClick={onConfirm}>
          {icon}
          {confirm}
        </button>
        <button type="button" class="button button--secondary button--large" onClick={onClose}>
          {fr.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}
