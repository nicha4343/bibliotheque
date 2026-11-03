import { useEffect, useState } from 'preact/hooks';
import { subscribeCoverReading } from './coverReading';

/** Renders again when OpenRouter refuses the key or fails on a photograph: awaitsReading() then changes. */
export function useCoverReadingChanges(): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      subscribeCoverReading(() => {
        setVersion((value) => value + 1);
      }),
    [],
  );
}
