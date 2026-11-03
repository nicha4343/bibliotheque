import { useEffect, useRef, useState } from 'preact/hooks';

// Dictation of the title and author (screen 4, lot 6, chosen by the user on 3 November 2026 when
// the reading of covers by Tesseract read nothing): the speech recognition of the browser (Chrome
// sends the sound to Google; free, network needed). Not in TypeScript's library: typed here.

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative | undefined;
}

interface SpeechResultEvent {
  readonly results: { readonly length: number; [index: number]: SpeechResult | undefined };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const scope = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export const dictationSupported = (): boolean => recognitionConstructor() !== undefined;

/** denied: microphone refused; network: no connection to the recognition service; nothing: silence. */
export type DictationError = 'denied' | 'network' | 'nothing' | 'failed';

const ERRORS: Record<string, DictationError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  network: 'network',
  'no-speech': 'nothing',
};

export interface Dictation {
  listening: boolean;
  /** What has been heard so far, shown while speaking. */
  heard: string;
  error: DictationError | undefined;
  start: () => void;
  stop: () => void;
}

/** One sentence in French; onDone receives it once the speaker stops. */
export function useDictation(onDone: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<DictationError>();
  const recognition = useRef<SpeechRecognitionLike | undefined>(undefined);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Leaving the screen silences the microphone; what was heard is dropped.
  useEffect(
    () => () => {
      const current = recognition.current;
      if (!current) return;
      current.onend = null;
      current.onresult = null;
      current.abort();
    },
    [],
  );

  const start = () => {
    const Recognition = recognitionConstructor();
    if (!Recognition || recognition.current) return;
    const current = new Recognition();
    current.lang = 'fr-FR';
    current.interimResults = true;
    current.continuous = false;
    current.maxAlternatives = 1;
    let text = '';
    let failed = false;
    current.onresult = (event) => {
      text = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      setHeard(text);
    };
    current.onerror = (event) => {
      if (event.error === 'aborted') return;
      failed = true;
      setError(ERRORS[event.error] ?? 'failed');
    };
    current.onend = () => {
      recognition.current = undefined;
      setListening(false);
      if (!failed && text) onDoneRef.current(text);
      else if (!failed) setError('nothing');
    };
    recognition.current = current;
    setHeard('');
    setError(undefined);
    setListening(true);
    try {
      current.start();
    } catch {
      recognition.current = undefined;
      setListening(false);
      setError('failed');
    }
  };

  const stop = () => {
    recognition.current?.stop();
  };

  return { listening, heard, error, start, stop };
}
