import { describe, expect, it } from 'vitest';
import { aimAreaInVideo, classifyCode, isInAimArea, ReadConfirmation, RepeatFilter, shelfQrContent } from './reads';

describe('classifyCode', () => {
  it('reconnaît un ISBN', () => {
    expect(classifyCode('9782070360420', 'ean_13')).toEqual({ kind: 'isbn', isbn13: '9782070360420' });
  });

  it('ignore les autres codes-barres', () => {
    expect(classifyCode('3017620422003', 'ean_13')).toEqual({ kind: 'ignored' });
    expect(classifyCode('52000', 'ean_5')).toEqual({ kind: 'ignored' });
    expect(classifyCode('https://exemple.fr', 'qr_code')).toEqual({ kind: 'ignored' });
  });

  it('reconnaît un code QR d’étagère, quelle que soit l’adresse de l’application', () => {
    const content = shelfQrContent('https://nicha4343.github.io/bibliotheque/#/scanner', 'Ab3_x-9Zk2');
    expect(content).toBe('https://nicha4343.github.io/bibliotheque/#/etagere/Ab3_x-9Zk2');
    expect(classifyCode(content, 'qr_code')).toEqual({ kind: 'shelf', token: 'Ab3_x-9Zk2' });
    expect(classifyCode('https://ailleurs.fr/#/etagere/Ab3_x-9Zk2', 'qr_code')).toEqual({
      kind: 'shelf',
      token: 'Ab3_x-9Zk2',
    });
  });
});

describe('ReadConfirmation', () => {
  it('ne retient un code qu’une fois lu deux fois de suite, puis à chaque lecture', () => {
    const confirmation = new ReadConfirmation();
    expect(confirmation.confirm('9782383861706', 0)).toBe(false);
    expect(confirmation.confirm('9782383861706', 100)).toBe(true);
    expect(confirmation.confirm('9782383861706', 200)).toBe(true);
  });

  it('écarte un code mal lu sur une seule image', () => {
    const confirmation = new ReadConfirmation();
    expect(confirmation.confirm('9782383861706', 0)).toBe(false);
    expect(confirmation.confirm('9782543861706', 100)).toBe(false);
    expect(confirmation.confirm('9782383861706', 200)).toBe(true);
  });

  it('oublie une lecture trop ancienne', () => {
    const confirmation = new ReadConfirmation();
    expect(confirmation.confirm('A', 0)).toBe(false);
    expect(confirmation.confirm('A', 1500)).toBe(false);
    expect(confirmation.confirm('A', 1600)).toBe(true);
  });
});

describe('RepeatFilter', () => {
  it('ignore un code relu moins de 2,5 s après', () => {
    const filter = new RepeatFilter();
    expect(filter.accept('A', 0)).toBe(true);
    expect(filter.accept('A', 1000)).toBe(false);
    expect(filter.accept('B', 1100)).toBe(true);
  });

  it('ne relit pas un ouvrage resté devant la caméra', () => {
    const filter = new RepeatFilter();
    expect(filter.accept('A', 0)).toBe(true);
    for (let t = 200; t <= 6000; t += 200) expect(filter.accept('A', t)).toBe(false);
  });

  it('relit un ouvrage présenté de nouveau après 2,5 s', () => {
    const filter = new RepeatFilter();
    expect(filter.accept('A', 0)).toBe(true);
    expect(filter.accept('A', 2600)).toBe(true);
  });

  it('oublie tout après reset', () => {
    const filter = new RepeatFilter();
    filter.accept('A', 0);
    filter.reset();
    expect(filter.accept('A', 100)).toBe(true);
  });
});

describe('isInAimArea', () => {
  // A 1920×1080 video shown in a 400×800 portrait view: scale 800/1080, 511 px cut on each side.
  const video = { width: 1920, height: 1080 };
  const view = { width: 400, height: 800 };
  const aim = { x: 68, y: 334, width: 264, height: 132 };

  it('accepte un code au centre du cadre', () => {
    expect(isInAimArea({ x: 860, y: 500, width: 200, height: 80 }, video, view, aim)).toBe(true);
  });

  it('refuse le code d’un ouvrage voisin', () => {
    expect(isInAimArea({ x: 1300, y: 500, width: 200, height: 80 }, video, view, aim)).toBe(false);
    expect(isInAimArea({ x: 860, y: 100, width: 200, height: 80 }, video, view, aim)).toBe(false);
  });
});

describe('aimAreaInVideo', () => {
  // A 1080×1920 portrait video shown in a 375×450 view: scale 375/1080, 108 px cut above and below.
  const video = { width: 1080, height: 1920 };
  const view = { width: 375, height: 450 };

  it('garde la partie de l’image visible dans le cadre de la couverture', () => {
    const area = aimAreaInVideo(video, view, { x: 87.5, y: 75, width: 200, height: 300 }, 0);
    expect(area).toEqual({ x: 252, y: 528, width: 576, height: 864 });
  });

  it('ne dépasse pas de l’image avec la marge', () => {
    const area = aimAreaInVideo(video, view, { x: 0, y: 0, width: 375, height: 450 });
    expect(area.x).toBe(0);
    expect(area.width).toBe(1080);
    expect(area.y + area.height).toBeLessThanOrEqual(1920);
  });
});
