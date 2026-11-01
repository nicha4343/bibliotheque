import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CameraUnavailable, hasTorch, openCamera, setTorch, stopStream, type CameraError } from './camera';
import { createDetector, type CodeDetector, type DetectedCode } from './detector';
import { isInAimArea } from './reads';

export interface CameraState {
  status: 'starting' | 'ready' | 'error';
  error?: CameraError;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  retry: () => void;
}

/** Rear camera shown in videoRef while the component is mounted; reopened after the app comes back. */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): CameraState {
  const [status, setStatus] = useState<CameraState['status']>('starting');
  const [error, setError] = useState<CameraError>();
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('starting');
    openCamera()
      .then(async (stream) => {
        if (!active) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setTorchAvailable(hasTorch(stream));
        setTorchOn(false);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof CameraUnavailable ? reason.reason : 'failed');
        setStatus('error');
      });
    // The system may stop the camera while the app is in the background.
    const onVisible = () => {
      const ended = streamRef.current?.getVideoTracks().every((track) => track.readyState === 'ended');
      if (document.visibilityState === 'visible' && ended) setAttempt((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [attempt, videoRef]);

  const toggleTorch = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !torchOn;
    void setTorch(stream, next).then((done) => {
      if (done) setTorchOn(next);
    });
  }, [torchOn]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return error && status === 'error'
    ? { status, error, torchAvailable, torchOn, toggleTorch, retry }
    : { status, torchAvailable, torchOn, toggleTorch, retry };
}

const DETECTION_INTERVAL_MS = 100;

/**
 * Reads the codes visible in the aiming frame, about ten times per second, and hands each one to
 * onCode. Returns false when no detector could be started.
 */
export function useCodeDetection(
  enabled: boolean,
  refs: {
    video: RefObject<HTMLVideoElement | null>;
    view: RefObject<HTMLElement | null>;
    aim: RefObject<HTMLElement | null>;
  },
  onCode: (code: DetectedCode) => void,
): boolean {
  const [available, setAvailable] = useState(true);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const detectorRef = useRef<Promise<CodeDetector> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Read through a function: the flag changes while detect() awaits.
    const isStopped = () => stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    detectorRef.current ??= createDetector();
    detectorRef.current
      .then((detector) => {
        const tick = async () => {
          if (stopped) return;
          const video = refs.video.current;
          const view = refs.view.current?.getBoundingClientRect();
          const aim = refs.aim.current?.getBoundingClientRect();
          if (video && view && aim && video.readyState >= 2 && document.visibilityState === 'visible') {
            try {
              const codes = await detector.detect(video);
              const videoSize = { width: video.videoWidth, height: video.videoHeight };
              const aimRect = { x: aim.left - view.left, y: aim.top - view.top, width: aim.width, height: aim.height };
              for (const code of codes) {
                if (!isStopped() && isInAimArea(code.boundingBox, videoSize, view, aimRect)) onCodeRef.current(code);
              }
            } catch {
              // A frame that cannot be read (camera starting): try the next one.
            }
          }
          if (!isStopped()) timer = setTimeout(() => void tick(), DETECTION_INTERVAL_MS);
        };
        void tick();
      })
      .catch(() => {
        setAvailable(false);
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, refs]);

  return available;
}
