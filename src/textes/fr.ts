/**
 * Every text shown to the user, gathered in one place so it can be proofread at once.
 *
 * Writing rules (see CLAUDE.md), checked by fr.test.ts:
 * - « vous » everywhere, formal French, no exclamation marks;
 * - French typography: no-break space (U+00A0) before « : » and inside « », narrow no-break
 *   space (U+202F) before « ; » and « ? », typographic apostrophe ’;
 * - months spelled out in full (« 1er novembre »).
 *
 * The no-break spaces look like ordinary spaces in an editor: fr.test.ts flags any mistake.
 */

/** French uses the singular for 0 and 1. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return Math.abs(count) < 2 ? singular : pluralForm;
}

const numberFormat = new Intl.NumberFormat('fr-FR');

/** 1234 → « 1 234 », with the narrow no-break space as thousands separator. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** « 1er novembre 2026 », « 12 mars 2027 » (local time). */
export function formatDate(date: Date): string {
  const day = date.getDate();
  const month = MONTHS[date.getMonth()] ?? '';
  return `${day === 1 ? '1er' : String(day)} ${month} ${date.getFullYear()}`;
}

const count = (value: number, singular: string, pluralForm: string): string =>
  `${formatNumber(value)} ${plural(value, singular, pluralForm)}`;

export const fr = {
  app: {
    name: 'Ma bibliothèque',
    shortName: 'Bibliothèque',
    description:
      'Cataloguez votre bibliothèque en scannant le code-barres de vos ouvrages, l’un après l’autre, sans interruption.',
    /** Browser tab title for a screen. */
    documentTitle: (screenTitle: string) => `${screenTitle} · Ma bibliothèque`,
  },

  nav: {
    label: 'Navigation principale',
    library: 'Bibliothèque',
    scan: 'Scanner',
    pending: 'À compléter',
    settings: 'Paramètres',
    /** Read by screen readers after « À compléter ». */
    pendingBadge: (value: number) => count(value, 'ouvrage en attente', 'ouvrages en attente'),
  },

  library: {
    title: 'Ma bibliothèque',
    summary: (value: number) => (value === 0 ? 'Aucun livre pour le moment' : count(value, 'livre', 'livres')),
    emptyTitle: 'Votre bibliothèque est encore vide',
    emptyText: 'Scannez le code-barres de vos ouvrages : ils viendront s’ajouter ici, rangés par pièce et par étagère.',
    emptyAction: 'Scanner des ouvrages',
  },

  scan: {
    title: 'Scanner',
    unavailableTitle: 'Lecture des codes-barres en préparation',
    unavailableText: 'Cette fonction sera disponible dans la prochaine version de l’application.',
  },

  pending: {
    title: 'À compléter',
    emptyTitle: 'Aucun ouvrage à compléter',
    emptyText:
      'Les ouvrages dont l’ISBN est inconnu et ceux qui n’ont pas de code-barres seront rassemblés ici, pour être complétés à votre convenance.',
  },

  settings: {
    title: 'Paramètres',
    aboutTitle: 'À propos de l’application',
    version: 'Version',
    versionValue: (version: string, date: string) => `${version}, publiée le ${date}`,
    offline: 'Fonctionnement hors connexion',
    offlineReady: 'Disponible : l’application s’ouvre même sans réseau.',
    offlinePreparing: 'En préparation…',
    offlineUnsupported: 'Ce navigateur ne permet pas le fonctionnement hors connexion.',
    storage: 'Conservation des données',
    storagePersistent: 'Vos données sont conservées sur cet appareil, à l’abri de tout effacement automatique.',
    storageBestEffort:
      'Vos données sont conservées sur cet appareil ; installez l’application sur l’écran d’accueil pour mieux les protéger.',
    storageUnknown: 'Vos données sont conservées sur cet appareil.',
  },

  pwa: {
    updateAvailable: 'Une nouvelle version de l’application est disponible.',
    update: 'Mettre à jour',
    postpone: 'Reporter',
    offlineReady: 'L’application est prête à fonctionner hors connexion.',
    dismiss: 'Fermer',
  },
} as const;
