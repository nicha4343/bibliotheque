import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/** Value of a Dexie query, refreshed whenever the data it reads changes. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initialValue: T): T {
  const [value, setValue] = useState<T>(initialValue);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (result) => {
        setValue(() => result);
      },
      error: (error: unknown) => {
        console.error(error);
      },
    });
    return () => {
      subscription.unsubscribe();
    };
    // The caller lists the query's dependencies in deps.
  }, deps);
  return value;
}
