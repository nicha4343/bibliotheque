import { useRef, useState } from 'preact/hooks';
import { captureFrame } from '../scan/camera';
import { useCamera, useCameraNotice } from '../scan/useCamera';
import { fr } from '../textes/fr';
import { CameraIcon, SwitchCameraIcon } from './icons';
import { Sheet } from './Sheet';

interface CameraSheetProps {
  onCapture: (photo: Blob) => Promise<void> | void;
  onClose: () => void;
  /** A book cover by default. */
  title?: string;
  hint?: string;
  /** Largest side of the stored photograph, in pixels: larger for a passage to be read. */
  maxSize?: number;
}

/** Photograph taken on the live picture, without leaving the app (no file picker). */
export function CameraSheet({ onCapture, onClose, title = fr.camera.title, hint = fr.camera.hint, maxSize }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef);
  const notice = useCameraNotice(camera);
  const [busy, setBusy] = useState(false);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      await onCapture(await captureFrame(video, maxSize));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const error =
    camera.status === 'error'
      ? {
          denied: fr.scan.cameraDenied,
          notFound: fr.scan.cameraNotFound,
          unsupported: fr.scan.cameraUnsupported,
          failed: fr.scan.cameraFailed,
        }[camera.error ?? 'failed']
      : undefined;

  return (
    <Sheet title={title} onClose={onClose}>
      <div class="camera">
        <video class="camera__video" ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {error ? (
          <div class="camera__message">
            <p>{error}</p>
            <button type="button" class="button button--light" onClick={camera.retry}>
              {fr.scan.retry}
            </button>
          </div>
        ) : (
          camera.status === 'starting' && <p class="camera__message">{fr.scan.cameraStarting}</p>
        )}
        {camera.count > 1 && camera.status !== 'error' && (
          <button
            type="button"
            class="scan__round-button camera__switch"
            aria-label={fr.scan.switchCamera}
            disabled={camera.status === 'starting'}
            onClick={camera.switchCamera}
          >
            <SwitchCameraIcon size={20} />
          </button>
        )}
        {notice && (
          <p class="camera__notice" role="status">
            {notice}
          </p>
        )}
      </div>
      <p class="sheet__hint">{hint}</p>
      <button
        type="button"
        class="button button--primary button--large"
        disabled={camera.status !== 'ready' || busy}
        onClick={() => void shoot()}
      >
        <CameraIcon size={20} />
        {fr.camera.shoot}
      </button>
    </Sheet>
  );
}
