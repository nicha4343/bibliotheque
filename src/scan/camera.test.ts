import { describe, expect, it } from 'vitest';
import { mainCamera, nextCamera, pictureColour, rearCameras } from './camera';

const device = (deviceId: string, label: string, kind: MediaDeviceKind = 'videoinput') => ({ deviceId, label, kind });

// Chrome on a phone with a night vision camera (Doogee S89): main, front, night vision, ultra wide.
const ANDROID = [
  device('mic', 'Microphone', 'audioinput'),
  device('front', 'camera2 1, facing front'),
  device('night', 'camera2 2, facing back'),
  device('main', 'camera2 0, facing back'),
  device('wide', 'camera2 3, facing back'),
];

describe('rearCameras', () => {
  it('keeps the rear cameras, in the order Android numbers them', () => {
    expect(rearCameras(ANDROID).map((camera) => camera.deviceId)).toEqual(['main', 'night', 'wide']);
  });

  it('reads the names given by Firefox and by the iPhone', () => {
    const firefox = [device('a', 'Camera 1, Facing front, Orientation 270'), device('b', 'Camera 0, Facing back, Orientation 90')];
    expect(rearCameras(firefox).map((camera) => camera.deviceId)).toEqual(['b']);
    const iphone = [device('front', 'Caméra avant'), device('back', 'Caméra arrière'), device('wide', 'Back Ultra Wide Camera')];
    expect(rearCameras(iphone).map((camera) => camera.deviceId)).toEqual(['back', 'wide']);
  });

  it('knows nothing before access is granted, the names being empty', () => {
    expect(rearCameras([device('', ''), device('', '')])).toEqual([]);
  });
});

describe('mainCamera', () => {
  const rear = rearCameras(ANDROID);

  it('prefers the main rear camera to the one the browser opened', () => {
    expect(mainCamera(rear, 'night', [])).toBe('main');
  });

  it('leaves a camera seen to film in black and white', () => {
    expect(mainCamera(rear, 'main', ['main'])).toBe('night');
    expect(mainCamera(rear, 'main', ['main', 'night'])).toBe('wide');
  });

  it('comes back to the main camera when all of them seemed to', () => {
    expect(mainCamera(rear, 'wide', ['main', 'night', 'wide'])).toBe('main');
  });

  it('keeps the choice of the browser where cameras are not numbered', () => {
    const iphone = rearCameras([device('back', 'Back Camera'), device('wide', 'Back Ultra Wide Camera')]);
    expect(mainCamera(iphone, 'wide', [])).toBe('wide');
    expect(mainCamera(iphone, 'wide', ['wide'])).toBe('back');
  });

  it('keeps the camera opened when the browser names none', () => {
    expect(mainCamera([], 'any', [])).toBe('any');
  });
});

describe('nextCamera', () => {
  const rear = rearCameras(ANDROID);

  it('goes through the rear cameras, back to the first after the last', () => {
    expect(nextCamera(rear, 'main')).toBe('night');
    expect(nextCamera(rear, 'wide')).toBe('main');
    expect(nextCamera(rear, 'unknown')).toBe('main');
    expect(nextCamera([], 'main')).toBeUndefined();
  });
});

/** Picture of 48 × 36 pixels, each given by its position. */
function picture(colour: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(48 * 36 * 4);
  for (let y = 0; y < 36; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      data.set([...colour(x, y), 255], (y * 48 + x) * 4);
    }
  }
  return data;
}

describe('pictureColour', () => {
  it('recognises the black and white of a night vision camera', () => {
    const shelf = picture((x, y) => {
      const light = 40 + ((x * 7 + y * 3) % 160);
      return [light, light, light + (x % 2)];
    });
    expect(pictureColour(shelf)).toBe('monochrome');
  });

  it('recognises colours, even few of them', () => {
    const spines = picture((x) => (x < 3 ? [180, 40, 40] : [120, 120, 120]));
    expect(pictureColour(spines)).toBe('colour');
  });

  it('cannot tell from a dark or even picture', () => {
    expect(pictureColour(picture(() => [8, 8, 8]))).toBe('unknown');
    expect(pictureColour(picture(() => [200, 200, 200]))).toBe('unknown');
    expect(pictureColour(new Uint8ClampedArray(0))).toBe('unknown');
  });

  it('does not take a colour camera filming a grey scene for a black and white one', () => {
    // A white balance never quite neutral: a few units between red and blue.
    const page = picture((x, y) => {
      const light = 60 + ((x * 5 + y * 11) % 150);
      return [light + 3, light, light - 2];
    });
    expect(pictureColour(page)).toBe('unknown');
  });
});
