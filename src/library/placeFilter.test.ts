import { describe, expect, it } from 'vitest';
import type { Room, Shelf, Site } from '../db/schema';
import { indexPlaces } from '../places/places';
import { hasPlace, placeFilter, placeFilterLabel, placeSelection } from './placeFilter';

const sites: Site[] = [
  { id: 'chapelle', name: 'La Chapelle', order: 0 },
  { id: 'malzaure', name: 'Malzaure', order: 1 },
];
const rooms: Room[] = [
  { id: 'entree', siteId: 'chapelle', name: 'Placard Entrée', order: 0 },
  { id: 'mezzanine', siteId: 'malzaure', name: 'Mezzanine', order: 1 },
];
const shelves: Shelf[] = [
  { id: 'e1', roomId: 'entree', name: 'Étagère 1', order: 0, qrToken: 'a' },
  { id: 'e2', roomId: 'entree', name: 'Étagère 2', order: 1, qrToken: 'b' },
  { id: 'm1', roomId: 'mezzanine', name: 'Étagère 1', order: 0, qrToken: 'c' },
];
const two = indexPlaces(sites, rooms, shelves);
const one = indexPlaces(sites.slice(0, 1), rooms.slice(0, 1), shelves.slice(0, 2));

describe('filtre par emplacement de la bibliothèque', () => {
  it('nomme l’emplacement choisi sans répétition', () => {
    expect(placeFilterLabel('all', two)).toBe('Tous les lieux');
    expect(placeFilterLabel('site:malzaure', two)).toBe('Malzaure');
    expect(placeFilterLabel('room:entree', two)).toBe('La Chapelle · Placard Entrée');
    expect(placeFilterLabel('shelf:e2', two)).toBe('La Chapelle · Placard Entrée · Étagère 2');
    expect(placeFilterLabel('all', one)).toBe('Toutes les pièces');
    expect(placeFilterLabel('room:entree', one)).toBe('Placard Entrée');
    expect(placeFilterLabel('shelf:disparue', two)).toBe('Tous les lieux');
  });

  it('retrouve le lieu et la pièce d’une étagère choisie', () => {
    expect(placeSelection('shelf:e2', two)).toEqual({ siteId: 'chapelle', roomId: 'entree', shelfId: 'e2' });
    expect(placeSelection('room:mezzanine', two)).toEqual({ siteId: 'malzaure', roomId: 'mezzanine' });
    expect(placeSelection('site:chapelle', two)).toEqual({ siteId: 'chapelle' });
    expect(placeSelection('all', two)).toEqual({});
    // A single place: its rooms are offered at once.
    expect(placeSelection('all', one)).toEqual({ siteId: 'chapelle' });
  });

  it('retient les étagères du lieu ou de la pièce, et écarte un emplacement supprimé', () => {
    expect(placeFilter('site:chapelle', two)).toEqual({ kind: 'room', shelfIds: new Set(['e1', 'e2']) });
    expect(placeFilter('room:mezzanine', two)).toEqual({ kind: 'room', shelfIds: new Set(['m1']) });
    expect(placeFilter('shelf:e1', two)).toEqual({ kind: 'shelf', shelfId: 'e1' });
    expect(hasPlace('site:chapelle', two)).toBe(true);
    expect(hasPlace('site:chapelle', one)).toBe(false);
    expect(hasPlace('room:disparue', two)).toBe(false);
    expect(hasPlace('all', two)).toBe(true);
  });
});
