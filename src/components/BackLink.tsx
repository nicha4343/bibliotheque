import { canGoBack } from '../router';
import { fr } from '../textes/fr';
import { ChevronLeftIcon } from './icons';

interface BackLinkProps {
  /** Where to go when no screen of the application lies behind (opened from a link). */
  href: string;
  /** Name of that screen. */
  label: string;
  class?: string;
}

/** « Retour » to the previous screen of the application, whichever it was; else to a fixed screen. */
export function BackAnchor({ href, label, class: className = 'text-button back-bar__link' }: BackLinkProps) {
  return (
    <a
      class={className}
      href={href}
      onClick={(event) => {
        if (!canGoBack()) return;
        event.preventDefault();
        window.history.back();
      }}
    >
      <ChevronLeftIcon size={20} />
      {canGoBack() ? fr.common.back : label}
    </a>
  );
}

/** The return link above the content of a secondary screen. */
export function BackLink(props: BackLinkProps) {
  return (
    <div class="back-bar">
      <BackAnchor {...props} />
    </div>
  );
}
