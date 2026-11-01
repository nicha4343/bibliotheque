import { useState } from 'preact/hooks';
import { CloseIcon, PlusIcon } from '../components/icons';
import type { Book } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { fr } from '../textes/fr';
import { addTag, cleanTag, removeTag, suggestTags, usedTags } from './tags';

/** « Étiquettes » (screen 6): free keywords, suggested from the usual ones and those already used. */
export function TagsSection({ book }: { book: Book }) {
  const used = useLiveQuery<string[]>(() => usedTags(), [], []);
  const [draft, setDraft] = useState('');
  const suggestions = suggestTags(book.tags, fr.book.usualTags, used, draft);

  const add = (label: string) => {
    void addTag(book.id, label);
    setDraft('');
  };

  return (
    <section class="section" aria-labelledby="tags-title">
      <h2 class="section__title" id="tags-title">
        {fr.book.tags}
      </h2>
      <div class="card book-card">
        {book.tags.length > 0 && (
          <ul class="chips chips--wrap tag-list" aria-label={fr.book.tagsOfBook}>
            {book.tags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  class="chip chip--large chip--tag"
                  aria-label={fr.book.removeTag(tag)}
                  onClick={() => void removeTag(book.id, tag)}
                >
                  {tag}
                  <CloseIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          class="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (cleanTag(draft)) add(draft);
          }}
        >
          <label class="visually-hidden" for="tag-input">
            {fr.book.newTag}
          </label>
          <input
            id="tag-input"
            class="field__input inline-form__field"
            type="text"
            value={draft}
            placeholder={fr.book.tagPlaceholder}
            autocomplete="off"
            enterKeyHint="done"
            onInput={(event) => {
              setDraft(event.currentTarget.value);
            }}
          />
          <button type="submit" class="button button--primary" disabled={!cleanTag(draft)}>
            {fr.book.addTag}
          </button>
        </form>
        {suggestions.length > 0 && (
          <div class="chips chips--wrap" role="group" aria-label={fr.book.tagSuggestions}>
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                class="chip chip--large chip--add"
                aria-label={fr.book.suggestTag(tag)}
                onClick={() => {
                  add(tag);
                }}
              >
                <PlusIcon size={16} />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
