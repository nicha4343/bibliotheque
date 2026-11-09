import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fr } from '../textes/fr';
import {
  CameraUnavailable,
  hasTorch,
  nextCamera,
  openCamera,
  pictureColour,
  readChoice,
  sampleFrame,
  saveChoice,
  setTorch,
  stopStream,
  type CameraDevice,
  type CameraError,
} from './camera';
import { createDetector, type CodeDetector, type DetectedCode } from './detector';
import { isInAimArea, ReadConfirmation } from './reads';

/** Why the camera shown changed: the user's button, or a camera filming in black and white left. */
export type CameraChange = 'user' | 'monochrome';

export interface CameraState {
  status: 'starting' | 'ready' | 'error';
  error?: CameraError;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  retry: () => void;
  /** Position of the camera shown among the rear cameras (from 1), and their number. */
  position: number;
  count: number;
  /** Shows the next rear camera, remembered on this device; offered when there are several. */
  switchCamera: () => void;
  /** Cause of the last change of camera and its number, for the screen to announce it. */
  change?: { reason: CameraChange; serial: number };
}

/** Delays after the camera opens at which its picture is looked at, colours being settled then. */
const COLOUR_CHECKS_MS = [800, 1600, 2800, 4500];

/**
 * Rear camera shown in videoRef while the component is mounted; reopened after the app comes back.
 * A camera seen to film in black and white is left for the next one, unless the user chose it.
 */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): CameraState {
  const [status, setStatus] = useState<CameraState['status']>('starting');
  const [error, setError] = useState<CameraError>();
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<{ deviceId?: string; reason?: CameraChange; serial: number }>({ serial: 0 });
  const [rear, setRear] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>();
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setStatus('starting');

    const checkColour = (opened: string, cameras: CameraDevice[], step = 0) => {
      const delay = COLOUR_CHECKS_MS[step];
      if (delay === undefined) return;
      timers.push(
        setTimeout(() => {
          const video = videoRef.current;
          const sample = video && sampleFrame(video);
          const colour = sample ? pictureColour(sample) : 'unknown';
          const choice = readChoice();
          if (colour === 'colour') {
            saveChoice({ deviceId: opened, monochrome: choice.monochrome.filter((id) => id !== opened) });
          } else if (colour === 'monochrome') {
            const monochrome = [...new Set([...choice.monochrome, opened])];
            saveChoice({ monochrome });
            // When every camera seems to film in black and white (a grey scene), back to the main one.
            const other = cameras.find((camera) => !monochrome.includes(camera.deviceId)) ?? cameras[0];
            if (other && other.deviceId !== opened) {
              setRequest((value) => ({ deviceId: other.deviceId, reason: 'monochrome', serial: value.serial + 1 }));
            }
          } else {
            checkColour(opened, cameras, step + 1);
          }
        }, delay),
      );
    };

    openCamera(request.deviceId)
      .then(async (camera) => {
        if (!active) {
          stopStream(camera.stream);
          return;
        }
        streamRef.current = camera.stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = camera.stream;
          await video.play().catch(() => undefined);
        }
        setRear(camera.rear);
        setDeviceId(camera.deviceId);
        setTorchAvailable(hasTorch(camera.stream));
        setTorchOn(false);
        setStatus('ready');
        // Looked at only while another rear camera could replace it, and when neither chosen nor already seen in colour.
        const opened = camera.deviceId;
        if (opened && camera.rear.length > 1 && request.reason !== 'user' && readChoice().deviceId !== opened) checkColour(opened, camera.rear);
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
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisible);
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [attempt, request, videoRef]);

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

  const switchCamera = useCallback(() => {
    const next = nextCamera(rear, deviceId);
    if (!next || next === deviceId) return;
    saveChoice({ deviceId: next, monochrome: readChoice().monochrome });
    setRequest((value) => ({ deviceId: next, reason: 'user', serial: value.serial + 1 }));
  }, [rear, deviceId]);

  const position = rear.findIndex((camera) => camera.deviceId === deviceId) + 1;
  const common = {
    status,
    torchAvailable,
    torchOn,
    toggleTorch,
    retry,
    position,
    count: rear.length,
    switchCamera,
    ...(request.reason ? { change: { reason: request.reason, serial: request.serial } } : {}),
  };
  return error && status === 'error' ? { ...common, error } : common;
}

const NOTICE_MS = 4000;

/** « Caméra arrière 2 sur 3 », for a few seconds after a change of camera, once the new one shows. */
export function useCameraNotice(camera: CameraState): string | undefined {
  const [notice, setNotice] = useState<string>();
  const { status, change, position, count } = camera;
  const serial = change?.serial;
  useEffect(() => {
    if (!change || status !== 'ready' || position === 0) return;
    setNotice(change.reason === 'monochrome' ? fr.scan.cameraMonochrome(position, count) : fr.scan.cameraPosition(position, count));
    const timer = setTimeout(() => {
      setNotice(undefined);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
    // Announced once per change, when the new camera is ready: not again when only its position is learnt.
  }, [serial, status]);
  return status === 'ready' ? notice : undefined;
}

const DETECTION_INTERVAL_MS = 100;

/**
 * Reads the codes visible in the aiming frame, about ten times per second, and hands each one to
 * onCode; a barcode only once read the same on two frames (ReadConfirmation), a QR code at once (its
 * error correction leaves no wrong reading). Returns false when no detector could be started.
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
    const confirmation = new ReadConfirmation();
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
              const now = Date.now();
              for (const code of codes) {
                if (isStopped() || !isInAimArea(code.boundingBox, videoSize, view, aimRect)) continue;
                if (code.format === 'qr_code' || confirmation.confirm(code.rawValue, now)) onCodeRef.current(code);
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
