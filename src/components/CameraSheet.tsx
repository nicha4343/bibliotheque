import { useRef, useState } from 'preact/hooks';
import { captureFrame } from '../scan/camera';
import { useCamera } from '../scan/useCamera';
import { fr } from '../textes/fr';
import { CameraIcon } from './icons';
import { Sheet } from './Sheet';

interface CameraSheetProps {
  onCapture: (photo: Blob) => Promise<void> | void;
  onClose: () => void;
}

/** Photograph taken on the live picture, without leaving the app (no file picker). */
export function CameraSheet({ onCapture, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef);
  const [busy, setBusy] = useState(false);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      await onCapture(await captureFrame(video));
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
    <Sheet title={fr.camera.title} onClose={onClose}>
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
      </div>
      <p class="sheet__hint">{fr.camera.hint}</p>
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
