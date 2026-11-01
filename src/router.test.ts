import { describe, expect, it } from 'vitest';
import { parseHash, routeHref } from './router';

describe('routes', () => {
  it('reconnaissent les onglets et leurs paramètres', () => {
    expect(parseHash('#/scanner')).toEqual({ id: 'scan' });
    expect(parseHash('#/livre/abc-123')).toEqual({ id: 'book', param: 'abc-123' });
    expect(parseHash(routeHref('entry', 'x y'))).toEqual({ id: 'entry', param: 'x y' });
  });

  it('ouvrent la bibliothèque par défaut', () => {
    expect(parseHash('')).toEqual({ id: 'library' });
    expect(parseHash('#/inconnu')).toEqual({ id: 'library' });
    expect(parseHash('#/etagere/Ab3_x-9Zk2')).toEqual({ id: 'library' });
  });
});
