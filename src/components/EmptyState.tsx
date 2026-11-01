import type { ComponentChildren } from 'preact';

interface EmptyStateProps {
  icon: ComponentChildren;
  title: string;
  text: string;
  action?: ComponentChildren;
}

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <section class="empty-state">
      <span class="empty-state__icon">{icon}</span>
      <h2 class="empty-state__title">{title}</h2>
      <p class="empty-state__text">{text}</p>
      {action}
    </section>
  );
}
