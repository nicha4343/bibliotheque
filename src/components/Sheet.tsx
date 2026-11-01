import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { fr } from '../textes/fr';
import { CloseIcon } from './icons';

interface SheetProps {
  title: string;
  /** Visible heading; when false, the title is only read by screen readers. */
  showTitle?: boolean;
  /** Without onClose the sheet waits for an explicit answer: no close button, no Escape. */
  onClose?: () => void;
  children: ComponentChildren;
}

let sheetCount = 0;

/** Modal panel rising from the bottom of the screen (location picker, dialogs). */
export function Sheet({ title, showTitle = true, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`sheet-title-${++sheetCount}`).current;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div class="sheet">
      <div class="sheet__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef}>
        <div class={showTitle ? 'sheet__header' : 'visually-hidden'}>
          <h2 class="sheet__title" id={titleId}>
            {title}
          </h2>
          {onClose && (
            <button type="button" class="icon-button sheet__close" aria-label={fr.common.close} onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
