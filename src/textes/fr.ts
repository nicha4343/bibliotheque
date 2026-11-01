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

/** « 45 s », « 2 min 10 s », « 1 h 05 min ». */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
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

  common: {
    close: 'Fermer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    create: 'Créer',
    untitled: 'Sans titre',
    unknownAuthor: 'Auteur inconnu',
    /** « 2ᵉ exemplaire » */
    ordinal: (value: number) => (value === 1 ? '1er' : `${formatNumber(value)}ᵉ`),
    providers: { bnf: 'BnF', googleBooks: 'Google Books', openLibrary: 'Open Library' },
  },

  places: {
    label: (room: string, shelf: string) => `${room} · ${shelf}`,
    defaultShelfName: (value: number) => `Étagère ${value}`,
    pickerTitle: 'Où ranger ces ouvrages ?',
    room: 'Pièce',
    shelvesOf: (room: string) => `Étagères · ${room}`,
    newRoom: 'Nouvelle pièce',
    newRoomLabel: 'Nom de la nouvelle pièce',
    newRoomPlaceholder: 'Par exemple : Grenier',
    newShelf: 'Nouvelle étagère',
    namesHint:
      'Les noms sont libres et peuvent être modifiés à tout moment : « Bandes dessinées », « Table de chevet », « Rayonnage supérieur »…',
    firstRoomHint: 'Commencez par créer une pièce, par exemple « Salon » : sa première étagère est créée avec elle.',
  },

  scan: {
    title: 'Scanner',
    choosePlace: 'Choisir un emplacement',
    torchOn: 'Allumer la lampe torche',
    torchOff: 'Éteindre la lampe torche',
    scanned: (value: number) => plural(value, 'scanné', 'scannés'),
    pending: 'à compléter',
    hint: 'La caméra demeure active : vous pouvez enchaîner les ouvrages sans toucher l’écran.',
    sessionTitle: 'Cette session',
    emptySession: 'Les ouvrages scannés apparaîtront ici, le plus récent en tête.',
    undo: 'Annuler la dernière lecture',
    noBarcode: 'Sans code-barres',
    finish: (value: number) => `Terminer · ${formatNumber(value)}`,
    ready: 'Présentez le code-barres d’un ouvrage dans le cadre',
    read: (isbn: string) => `Code lu · ${isbn}`,
    added: (title: string) => `${title} — ajouté à votre bibliothèque`,
    unknown: 'ISBN inconnu : ouvrage mis de côté, la lecture se poursuit',
    alreadyOwned: (title: string) => `${title} — déjà dans votre bibliothèque`,
    extraCopyAdded: (ordinal: string, place: string) => `${ordinal} exemplaire ajouté · ${place}`,
    notAdded: (title: string) => `${title} — non ajouté, la lecture se poursuit`,
    undone: 'Dernière lecture annulée',
    photographed: 'Couverture photographiée — fiche à compléter ultérieurement',
    shelfQr: (place: string) => `Code QR d’étagère reconnu : ${place}`,
    unknownShelfQr: 'Ce code QR ne correspond à aucune étagère de votre bibliothèque',
    placeChanged: (place: string) => `Les prochains ouvrages seront rangés dans ${place}`,
    offline: 'Hors connexion : la recherche reprendra au retour du réseau',
    offlineRefused: 'Hors connexion : ce code n’a pas été enregistré, la lecture hors connexion étant désactivée',
    choosePlaceFirst: 'Choisissez d’abord l’emplacement de ces ouvrages',
    rowSearching: 'Recherche…',
    rowInProgress: 'En cours',
    rowAdded: 'Ajouté',
    rowWaiting: 'En attente',
    rowAlreadyHere: 'Déjà présent…',
    rowCopy: (ordinal: string) => `${ordinal} exemplaire`,
    rowNotAdded: 'Non ajouté',
    rowAlreadyInLibrary: 'Déjà dans votre bibliothèque',
    rowUnknown: 'ISBN inconnu',
    rowToComplete: 'À compléter',
    rowNoBarcode: 'Ouvrage sans code-barres',
    rowPhotographed: 'Couverture photographiée',
    cameraStarting: 'Ouverture de la caméra…',
    cameraDenied:
      'L’accès à la caméra a été refusé. Autorisez-le pour ce site dans les paramètres du navigateur, puis touchez « Réessayer ».',
    cameraNotFound: 'Aucune caméra n’a été trouvée sur cet appareil.',
    cameraUnsupported:
      'Ce navigateur ne permet pas d’utiliser la caméra ici. Ouvrez l’application à son adresse sécurisée, commençant par https.',
    cameraFailed: 'La caméra n’a pas pu être ouverte. Fermez les autres applications qui l’utilisent, puis réessayez.',
    detectorFailed: 'La lecture des codes-barres n’a pas pu démarrer sur ce navigateur.',
    retry: 'Réessayer',
  },

  duplicate: {
    heading: 'Ouvrage déjà possédé',
    owned: (value: number) =>
      value === 1 ? 'Vous en possédez déjà 1 exemplaire :' : `Vous en possédez déjà ${formatNumber(value)} exemplaires :`,
    add: (ordinal: string) => `Ajouter un ${ordinal} exemplaire`,
    willBePlaced: (place: string) => `Il sera rangé dans ${place}`,
    decline: 'Ne pas l’ajouter',
  },

  recap: {
    title: 'Bilan de la session',
    ended: 'Session terminée',
    scanned: (value: number) => count(value, 'livre scanné', 'livres scannés'),
    details: (duration: string, place: string) => `en ${duration} · ${place}`,
    added: (value: number) => plural(value, 'ajouté', 'ajoutés'),
    pending: 'à compléter',
    extraCopies: (value: number) => plural(value, 'exemplaire supplémentaire', 'exemplaires supplémentaires'),
    latest: 'Derniers ajouts',
    nextShelf: 'Étagère suivante',
    nextShelfDetail: (place: string) => `${place} — la lecture reprend`,
    completePending: 'Compléter les ouvrages mis de côté',
    library: 'Consulter ma bibliothèque',
    noSession: 'Aucune session terminée pour le moment.',
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
