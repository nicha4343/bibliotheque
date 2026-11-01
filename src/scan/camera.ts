export type CameraError = 'denied' | 'notFound' | 'unsupported' | 'failed';

export class CameraUnavailable extends Error {
  readonly reason: CameraError;

  constructor(reason: CameraError) {
    super(reason);
    this.reason = reason;
  }
}

/** Rear camera, in high definition so that small barcodes stay readable. */
export async function openCamera(): Promise<MediaStream> {
  // mediaDevices only exists in secure contexts (HTTPS, localhost).
  if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') throw new CameraUnavailable('unsupported');
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraUnavailable('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraUnavailable('notFound');
    throw new CameraUnavailable('failed');
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

function videoTrack(stream: MediaStream): MediaStreamTrack | undefined {
  return stream.getVideoTracks()[0];
}

export function hasTorch(stream: MediaStream): boolean {
  const track = videoTrack(stream);
  if (!track || typeof track.getCapabilities !== 'function') return false;
  return 'torch' in track.getCapabilities();
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  const track = videoTrack(stream);
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Compressed JPEG of the current video frame, without leaving the screen (no file picker). */
export async function captureFrame(video: HTMLVideoElement, maxSize = 1280, quality = 0.82): Promise<Blob> {
  return drawToJpeg(video, video.videoWidth, video.videoHeight, maxSize, quality);
}

/** Compressed JPEG of an image chosen in the gallery. */
export async function compressImage(file: Blob, maxSize = 1280, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height, maxSize, quality);
  } finally {
    bitmap.close();
  }
}

async function drawToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSize: number,
  quality: number,
): Promise<Blob> {
  if (width === 0 || height === 0) throw new Error('Empty image');
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Encoding failed'));
      },
      'image/jpeg',
      quality,
    );
  });
}
