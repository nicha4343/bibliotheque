import type { Rect } from './reads';

export type CameraError = 'denied' | 'notFound' | 'unsupported' | 'failed';

export class CameraUnavailable extends Error {
  readonly reason: CameraError;

  constructor(reason: CameraError) {
    super(reason);
    this.reason = reason;
  }
}

/** A camera of the device, as enumerateDevices names it once access is granted. */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface OpenedCamera {
  stream: MediaStream;
  /** The camera actually opened, when the browser says so. */
  deviceId: string | undefined;
  /** Rear cameras of the device, the main one first; empty when the browser does not name them. */
  rear: CameraDevice[];
}

// Android numbers its cameras, the main rear camera first: « camera2 0, facing back » (Chrome),
// « Camera 0, Facing back, Orientation 90 » (Firefox).
const NUMBERED = /camera2?\s*(\d+),\s*facing\s+(back|front)/i;
const REAR = /back|rear|environment|arrière/i;
const FRONT = /front|user|avant|facetime/i;

function cameraNumber(label: string): number | undefined {
  const match = NUMBERED.exec(label);
  return match?.[2]?.toLowerCase() === 'back' ? Number(match[1]) : undefined;
}

function isRear(label: string): boolean {
  if (NUMBERED.test(label)) return cameraNumber(label) !== undefined;
  return REAR.test(label) && !FRONT.test(label);
}

/** Rear cameras among the devices, in Android's order when it numbers them. */
export function rearCameras(devices: readonly Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): CameraDevice[] {
  const rank = (label: string) => cameraNumber(label) ?? Number.MAX_SAFE_INTEGER;
  return devices
    .filter(({ kind, deviceId, label }) => kind === 'videoinput' && deviceId !== '' && isRear(label))
    .map(({ deviceId, label }) => ({ deviceId, label }))
    .sort((a, b) => rank(a.label) - rank(b.label));
}

/**
 * Camera to show: on Android, the main rear camera rather than the one the browser picked, which can
 * be a night vision camera filming in black and white (Doogee S89) or an ultra wide one; elsewhere
 * (iPhone), the browser's choice. Cameras seen to film in black and white are avoided while another
 * one remains.
 */
export function mainCamera(rear: readonly CameraDevice[], current: string | undefined, monochrome: readonly string[]): string | undefined {
  const colour = rear.filter((camera) => !monochrome.includes(camera.deviceId));
  // When all of them seemed to (a grey scene), the information is worthless.
  const candidates = colour.length > 0 ? colour : rear;
  const numbered = candidates.find((camera) => cameraNumber(camera.label) !== undefined);
  if (numbered) return numbered.deviceId;
  if (candidates.some((camera) => camera.deviceId === current)) return current;
  return candidates[0]?.deviceId ?? current;
}

/** The rear camera after the current one, back to the first after the last. */
export function nextCamera(rear: readonly CameraDevice[], current: string | undefined): string | undefined {
  if (rear.length === 0) return undefined;
  const index = rear.findIndex((camera) => camera.deviceId === current);
  return rear[(index + 1) % rear.length]?.deviceId;
}

/**
 * This device's camera. Kept out of the settings, which are saved to Google Drive: camera
 * identifiers differ from one device to another.
 */
export interface CameraChoice {
  /** Chosen by the user, or seen to film in colour. */
  deviceId?: string;
  /** Seen to film in black and white. */
  monochrome: string[];
}

const CHOICE_KEY = 'bibliotheque.camera';

export function readChoice(): CameraChoice {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const { deviceId, monochrome } = value as Partial<CameraChoice>;
      return {
        ...(typeof deviceId === 'string' ? { deviceId } : {}),
        monochrome: Array.isArray(monochrome) ? monochrome.filter((id): id is string => typeof id === 'string') : [],
      };
    }
  } catch {
    // Storage refused (private browsing) or damaged: the camera is chosen again.
  }
  return { monochrome: [] };
}

export function saveChoice(choice: CameraChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Storage refused: the camera will be chosen again next time.
  }
}

async function request(camera: MediaTrackConstraints): Promise<MediaStream> {
  try {
    // High definition, so that small barcodes stay readable.
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...camera, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraUnavailable('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraUnavailable('notFound');
    throw new CameraUnavailable('failed');
  }
}

async function describe(stream: MediaStream): Promise<OpenedCamera> {
  const deviceId = videoTrack(stream)?.getSettings().deviceId;
  let rear: CameraDevice[] = [];
  try {
    // Cameras are named only once access is granted, hence after opening one.
    rear = rearCameras(await navigator.mediaDevices.enumerateDevices());
  } catch {
    // Without the list, the browser's camera stays.
  }
  return { stream, deviceId, rear };
}

const isDenied = (error: unknown) => error instanceof CameraUnavailable && error.reason === 'denied';
const ANY_REAR: MediaTrackConstraints = { facingMode: { ideal: 'environment' } };

/**
 * The camera asked for, otherwise the one remembered on this device, otherwise the main rear camera;
 * the one the browser picks when none of them opens.
 */
export async function openCamera(wanted?: string): Promise<OpenedCamera> {
  // mediaDevices only exists in secure contexts (HTTPS, localhost).
  if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') throw new CameraUnavailable('unsupported');
  const choice = readChoice();
  const target = wanted ?? choice.deviceId;
  if (target) {
    try {
      return await describe(await request({ deviceId: { exact: target } }));
    } catch (error) {
      if (isDenied(error)) throw error;
      // Gone (site data cleared, camera removed): chosen again below.
      if (target === choice.deviceId) saveChoice({ monochrome: choice.monochrome });
    }
  }
  const opened = await describe(await request(ANY_REAR));
  const main = mainCamera(opened.rear, opened.deviceId, choice.monochrome);
  if (!main || main === opened.deviceId) return opened;
  // Some phones cannot open two cameras at once.
  stopStream(opened.stream);
  try {
    return await describe(await request({ deviceId: { exact: main } }));
  } catch (error) {
    if (isDenied(error)) throw error;
    return describe(await request(ANY_REAR));
  }
}

/**
 * Whether a small picture filmed by the camera has colours: a night vision camera gives the same red,
 * green and blue everywhere. Unknown for a picture too dark or too even to tell (camera starting,
 * hand over the lens, white wall).
 */
export function pictureColour(rgba: Uint8ClampedArray): 'colour' | 'monochrome' | 'unknown' {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 'unknown';
  let total = 0;
  let squares = 0;
  let coloured = 0;
  let grey = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    const light = (r + g + b) / 3;
    total += light;
    squares += light * light;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > 8) coloured += 1;
    else if (spread <= 2) grey += 1;
  }
  if (coloured > pixels * 0.02) return 'colour';
  const mean = total / pixels;
  const deviation = Math.sqrt(Math.max(0, squares / pixels - mean * mean));
  if (mean < 24 || deviation < 6) return 'unknown';
  return grey >= pixels * 0.99 ? 'monochrome' : 'unknown';
}

/** Small copy of the current video frame, in RGBA, for pictureColour. */
export function sampleFrame(video: HTMLVideoElement): Uint8ClampedArray | undefined {
  if (video.readyState < 2 || video.videoWidth === 0) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return undefined;
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

/**
 * Compressed JPEG of the current video frame, without leaving the screen (no file picker); of a part
 * of it only when region is given (the cover framed on the scan screen), in video pixels.
 */
export async function captureFrame(video: HTMLVideoElement, maxSize = 1280, quality = 0.82, region?: Rect): Promise<Blob> {
  const area = region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  return drawToJpeg(video, area, maxSize, quality);
}

/** Compressed JPEG of an image chosen in the gallery. */
export async function compressImage(file: Blob, maxSize = 1280, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await drawToJpeg(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, maxSize, quality);
  } finally {
    bitmap.close();
  }
}

async function drawToJpeg(source: CanvasImageSource, area: Rect, maxSize: number, quality: number): Promise<Blob> {
  const { x, y, width, height } = area;
  if (width <= 0 || height <= 0) throw new Error('Empty image');
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context');
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
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
