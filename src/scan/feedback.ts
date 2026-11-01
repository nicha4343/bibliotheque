// Sound through Web Audio (no audio file to download) and vibration where available
// (navigator.vibrate does not exist on iPhone: never rely on it).

let audioContext: AudioContext | undefined;

/** Browsers only let a page play sound after a touch: call this from any user gesture. */
export function unlockAudio(): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
  } catch {
    audioContext = undefined;
  }
}

export type Signal = 'read' | 'attention';

const TONES: Record<Signal, { frequency: number; start: number }[]> = {
  read: [{ frequency: 1320, start: 0 }],
  attention: [
    { frequency: 660, start: 0 },
    { frequency: 520, start: 0.14 },
  ],
};

export function beep(signal: Signal = 'read'): void {
  const context = audioContext;
  if (!context || context.state !== 'running') return;
  const now = context.currentTime;
  for (const { frequency, start } of TONES[signal]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.1);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + 0.12);
  }
}

export function vibrate(signal: Signal = 'read'): void {
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(signal === 'read' ? 40 : [60, 80, 60]);
  } catch {
    // Some browsers refuse vibration without a recent touch.
  }
}
