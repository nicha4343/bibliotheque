import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { fr } from '../textes/fr';

// The first screen is not focused: the page has just loaded.
let hasNavigated = false;

interface ScreenProps {
  title: string;
  subtitle?: string | undefined;
  /** Above the title: what the page shows (« Série », « Auteur »). */
  kicker?: string;
  /** Shown beside the title (a count badge). */
  titleAside?: ComponentChildren;
  children?: ComponentChildren;
}

export function Screen({ title, subtitle, kicker, titleAside, children }: ScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = title === fr.app.name ? title : fr.app.documentTitle(title);
    // After a tab change, screen readers start reading from the new title.
    if (hasNavigated) headingRef.current?.focus();
    hasNavigated = true;
  }, [title]);

  return (
    <main class="screen">
      <div class="screen__inner">
        <header class="screen__header">
          {kicker && <p class="screen__kicker">{kicker}</p>}
          <div class="screen__title-row">
            <h1 class="screen__title" tabIndex={-1} ref={headingRef}>
              {title}
            </h1>
            {titleAside}
          </div>
          {subtitle && <p class="screen__subtitle">{subtitle}</p>}
        </header>
        {children}
      </div>
    </main>
  );
}
