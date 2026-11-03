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
  onaudiostart: (() => void) | null;
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

/**
 * denied: microphone refused; network: no connection to the recognition service; nothing: silence;
 * failed: anything else, with the browser's code (« service-not-allowed » when the phone offers the
 * browser no speech service) or « timeout » when the recognition never started.
 */
export type DictationError = 'denied' | 'network' | 'nothing' | 'failed';

const ERRORS: Record<string, DictationError> = {
  'not-allowed': 'denied',
  network: 'network',
  'no-speech': 'nothing',
};

/** The recognition must hear the microphone within this delay, or it is taken for stuck. */
const START_TIMEOUT_MS = 6000;

export interface Dictation {
  listening: boolean;
  /** What has been heard so far, shown while speaking. */
  heard: string;
  error: DictationError | undefined;
  /** Code given by the browser for a failure, to tell what went wrong. */
  errorCode: string;
  start: () => void;
  stop: () => void;
}

/** One sentence in French; onDone receives it once the speaker stops. */
export function useDictation(onDone: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<DictationError>();
  const [errorCode, setErrorCode] = useState('');
  const recognition = useRef<SpeechRecognitionLike | undefined>(undefined);
  const busy = useRef(false);
  const mounted = useRef(true);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Leaving the screen silences the microphone; what was heard is dropped.
  useEffect(
    () => () => {
      mounted.current = false;
      const current = recognition.current;
      if (!current) return;
      current.onend = null;
      current.onresult = null;
      current.abort();
    },
    [],
  );

  const fail = (kind: DictationError, code = '') => {
    if (!mounted.current) return;
    setError(kind);
    setErrorCode(code);
  };

  const begin = async () => {
    const Recognition = recognitionConstructor();
    if (!Recognition || busy.current) return;
    busy.current = true;
    setHeard('');
    setError(undefined);
    setListening(true);
    const done = () => {
      busy.current = false;
      recognition.current = undefined;
      if (mounted.current) setListening(false);
    };

    // The application asks for the microphone itself, as for the camera: in an installed
    // application, the recognition alone may neither ask nor say why it fails.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
    } catch (reason) {
      done();
      const name = reason instanceof DOMException ? reason.name : 'micro';
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed', name);
      return;
    }
    if (!mounted.current) {
      done();
      return;
    }

    const current = new Recognition();
    current.lang = 'fr-FR';
    current.interimResults = true;
    current.continuous = false;
    current.maxAlternatives = 1;
    let text = '';
    let failed = false;
    let started = false;
    const watchdog = setTimeout(() => {
      if (started || text) return;
      failed = true;
      fail('failed', 'timeout');
      current.abort();
    }, START_TIMEOUT_MS);
    current.onaudiostart = () => {
      started = true;
    };
    current.onresult = (event) => {
      started = true;
      text = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      setHeard(text);
    };
    current.onerror = (event) => {
      if (event.error === 'aborted') return;
      failed = true;
      fail(ERRORS[event.error] ?? 'failed', event.error);
    };
    current.onend = () => {
      clearTimeout(watchdog);
      done();
      if (!failed && text) onDoneRef.current(text);
      else if (!failed) fail('nothing');
    };
    recognition.current = current;
    try {
      current.start();
    } catch (reason) {
      clearTimeout(watchdog);
      done();
      fail('failed', reason instanceof DOMException ? reason.name : 'start');
    }
  };

  return {
    listening,
    heard,
    error,
    errorCode,
    start: () => {
      void begin();
    },
    stop: () => {
      recognition.current?.stop();
    },
  };
}
