import { describe, expect, it } from 'vitest';
import { LIST_TABS, LOAN_HISTORY, parseHash, routeHref } from './router';

describe('routes', () => {
  it('reconnaissent les onglets et leurs paramètres', () => {
    expect(parseHash('#/scanner')).toEqual({ id: 'scan' });
    expect(parseHash('#/livre/abc-123')).toEqual({ id: 'book', param: 'abc-123' });
    expect(parseHash(routeHref('entry', 'x y'))).toEqual({ id: 'entry', param: 'x y' });
  });

  it('distinguent la liste des étagères d’une étagère, désignée aussi par le jeton de son étiquette', () => {
    expect(parseHash('#/etageres')).toEqual({ id: 'shelves' });
    expect(parseHash('#/etagere/Ab3_x-9Zk2')).toEqual({ id: 'shelf', param: 'Ab3_x-9Zk2' });
    expect(parseHash('https://exemple.org/#/etagere/Ab3_x-9Zk2'.replace(/^[^#]*/, ''))).toEqual({ id: 'shelf', param: 'Ab3_x-9Zk2' });
  });

  it('transmettent l’exemplaire à montrer sur une étagère', () => {
    expect(parseHash(routeHref('shelf', 'etagere-1', 'exemplaire 2'))).toEqual({
      id: 'shelf',
      param: 'etagere-1',
      detail: 'exemplaire 2',
    });
    expect(parseHash(routeHref('shelf', 'a/b'))).toEqual({ id: 'shelf', param: 'a/b' });
  });

  it('distinguent les prêts, leur historique et les scans d’un ouvrage à prêter ou restitué', () => {
    expect(parseHash('#/prets')).toEqual({ id: 'loans' });
    expect(parseHash(routeHref('loans', LOAN_HISTORY))).toEqual({ id: 'loans', param: 'historique' });
    expect(parseHash('#/preter')).toEqual({ id: 'lend' });
    expect(parseHash('#/restituer')).toEqual({ id: 'giveBack' });
  });

  it('mènent aux séries, aux auteurs, aux listes et à une liste de souhaits partagée', () => {
    expect(parseHash('#/series')).toEqual({ id: 'series' });
    expect(parseHash(routeHref('series', 'Astérix'))).toEqual({ id: 'series', param: 'Astérix' });
    expect(parseHash(routeHref('author', 'J.K. Rowling'))).toEqual({ id: 'author', param: 'J.K. Rowling' });
    expect(parseHash(routeHref('lists', LIST_TABS.insurance))).toEqual({ id: 'lists', param: 'assurance' });
    expect(parseHash('#/librairie')).toEqual({ id: 'bookshop' });
    expect(parseHash('#/souhaits/q1Yq-U7_Iy1')).toEqual({ id: 'sharedList', param: 'q1Yq-U7_Iy1' });
    // A malformed escape does not break the application.
    expect(parseHash('#/auteur/100%')).toEqual({ id: 'author', param: '100%' });
  });

  it('ouvrent la bibliothèque par défaut', () => {
    expect(parseHash('')).toEqual({ id: 'library' });
    expect(parseHash('#/inconnu')).toEqual({ id: 'library' });
  });
});
