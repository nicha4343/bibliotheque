import { useEffect, useState } from 'preact/hooks';
import { subscribeReadingFailures } from './reading';

/** Renders again when a photograph could not be read: awaitsReading() then changes. */
export function useReadingFailures(): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      subscribeReadingFailures(() => {
        setVersion((value) => value + 1);
      }),
    [],
  );
}
