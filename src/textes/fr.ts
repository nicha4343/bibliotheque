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
    results: (value: number) => (value === 0 ? 'Aucun résultat' : count(value, 'résultat', 'résultats')),
    searchLabel: 'Rechercher un ouvrage',
    searchPlaceholder: 'Titre, auteur, ISBN…',
    clearSearch: 'Effacer la recherche',
    placeLabel: 'Pièce ou étagère',
    allPlaces: 'Toutes les pièces',
    wholeRoom: (room: string) => `${room} · toutes les étagères`,
    statusFilters: 'Statut de lecture',
    filterAll: 'Tous',
    filterToRead: 'À lire',
    filterRead: 'Lus',
    copies: (value: number) => `${formatNumber(value)} exemplaires`,
    statusToRead: 'À lire',
    statusRead: 'Lu',
    noPlace: 'Sans emplacement',
    noMatchTitle: 'Aucun ouvrage ne correspond à votre recherche',
    noMatchText: 'Cet ouvrage ne figure pas encore dans votre bibliothèque ? Vous pouvez l’ajouter en le scannant.',
    noMatchAction: 'Scanner un ouvrage',
    showMore: (value: number) => `Afficher les ouvrages suivants · ${formatNumber(value)} restants`,
  },

  book: {
    back: 'Bibliothèque',
    edit: 'Modifier',
    editTitle: 'Modifier la fiche',
    notFound: 'Cet ouvrage ne figure plus dans votre bibliothèque.',
    coverAuto: (provider: string) => `Couverture automatique · ${provider}`,
    coverAutoUnknown: 'Couverture automatique',
    coverUser: 'Votre photographie · prioritaire',
    coverNone: 'Aucune couverture',
    changeCover: 'Modifier la couverture',
    coverSheet: 'Couverture',
    takePhoto: 'Prendre une photographie',
    takePhotoDetail: 'Directement dans l’application',
    gallery: 'Choisir dans la galerie',
    galleryDetail: 'Une image enregistrée sur votre téléphone',
    otherCovers: 'Autres couvertures disponibles',
    otherCoverLabel: (provider: string) => `Choisir la couverture proposée par ${provider}`,
    noOtherCovers: 'Aucune autre couverture n’a été trouvée.',
    restoreCover: 'Rétablir la couverture automatique',
    coverLoading: 'Téléchargement de la couverture…',
    coverUnavailable: 'Cette couverture n’a pu être obtenue.',
    restoreFailed: 'Aucune couverture automatique n’a été trouvée pour cet ouvrage.',
    imageFailed: 'Cette image n’a pu être lue.',
    status: 'Statut de lecture',
    toRead: 'À lire',
    read: 'Lu',
    copies: (value: number) => `Exemplaires · ${formatNumber(value)}`,
    move: (place: string) => `Déplacer l’exemplaire rangé dans ${place}`,
    moveTitle: 'Où ranger cet exemplaire ?',
    addCopy: 'Ajouter un exemplaire',
    addCopyTitle: 'Où ranger le nouvel exemplaire ?',
    copyAdded: (place: string) => `Exemplaire ajouté · ${place}`,
    copyMoved: (place: string) => `Exemplaire rangé dans ${place}`,
    removeCopy: (place: string) => `Retirer l’exemplaire rangé dans ${place}`,
    removeCopyTitle: 'Retirer cet exemplaire ?',
    removeCopyText: (place: string) =>
      `L’exemplaire rangé dans ${place} sera retiré de votre bibliothèque ; la fiche de l’ouvrage est conservée.`,
    removeCopyConfirm: 'Retirer l’exemplaire',
    copyRemoved: 'Exemplaire retiré',
    delete: 'Supprimer de ma bibliothèque',
    deleteTitle: 'Supprimer cet ouvrage ?',
    deleteText: 'La fiche, ses exemplaires et sa couverture seront effacés. Cette opération est définitive.',
    deleteConfirm: 'Supprimer définitivement',
    titleLabel: 'Titre',
    authorLabel: 'Auteur',
    authorHint: 'Plusieurs auteurs : séparez-les par une virgule.',
    publisherLabel: 'Éditeur',
    yearLabel: 'Année de parution',
    yearInvalid: 'Indiquez une année à quatre chiffres.',
    saved: 'Fiche enregistrée',
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
    removed: 'Lecture retirée de la session',
    removeRow: (title: string) => `Retirer « ${title} » de la session`,
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
    intro: 'Les ouvrages non reconnus lors de vos lectures sont conservés ici, en attendant que vous complétiez leur fiche. Rien n’a été perdu.',
    filters: 'Nature des ouvrages',
    filterAll: 'Tous',
    filterUnknown: 'ISBN inconnu',
    filterNoBarcode: 'Sans code-barres',
    kindUnknown: 'ISBN inconnu',
    kindNoBarcode: 'Sans code-barres',
    unknownText: 'Ce code n’est référencé dans aucune source.',
    noBarcodeText: (date: string) => `Photographié le ${date}`,
    retry: 'Rechercher de nouveau',
    retrying: 'Recherche…',
    photograph: 'Photographier',
    enter: 'Saisir',
    remove: 'Retirer',
    removeLabel: (what: string) => `Retirer « ${what} » de la liste`,
    removeTitle: 'Retirer cet ouvrage de la liste ?',
    removeText: 'Il ne sera pas ajouté à votre bibliothèque, et sa photographie sera effacée. Cette opération est définitive.',
    removed: 'Ouvrage retiré de la liste',
    found: (title: string) => `« ${title} » a été retrouvé et ajouté à votre bibliothèque`,
    stillUnknown: 'Ce code demeure inconnu de toutes les sources : saisissez sa fiche.',
    unavailable: 'Les sources n’ont pu être jointes : réessayez lorsque le réseau sera disponible.',
    completeSeries: (value: number) => `Compléter en série · ${formatNumber(value)}`,
  },

  entry: {
    title: 'Saisie en série',
    close: 'Fermer',
    step: (index: number, total: number) => `${formatNumber(index)} sur ${formatNumber(total)}`,
    postpone: 'Reporter',
    save: 'Enregistrer',
    finish: 'Terminer',
    photoCaption: 'Photographie prise lors de la lecture.',
    takenHere: 'Photographie prise ici même, sans quitter l’application.',
    unknownCaption:
      'Ce code n’est référencé dans aucune source. Saisissez le titre et l’auteur ; vous pouvez aussi photographier la couverture.',
    noPhotoCaption: 'Aucune photographie : saisissez le titre et l’auteur.',
    photographCover: 'Photographier la couverture',
    retakePhoto: 'Photographier de nouveau',
    place: 'Emplacement',
    changePlace: (place: string) => `Emplacement : ${place}. Modifier`,
    titleLabel: 'Titre',
    titlePlaceholder: 'Titre de l’ouvrage',
    authorLabel: 'Auteur',
    authorPlaceholder: 'Auteur ou autrice',
    publisherLabel: 'Éditeur',
    publisherPlaceholder: 'Facultatif',
    titleRequired: 'Indiquez au moins le titre de l’ouvrage.',
    doneTitle: 'Toutes les fiches sont complètes',
    endedTitle: 'Saisie terminée',
    doneAdded: (value: number) =>
      value === 0
        ? 'Aucun ouvrage n’a été ajouté.'
        : value === 1
          ? '1 ouvrage a été ajouté à votre bibliothèque.'
          : `${formatNumber(value)} ouvrages ont été ajoutés à votre bibliothèque.`,
    doneRemaining: (value: number) =>
      value === 1
        ? '1 ouvrage demeure dans « À compléter ».'
        : `${formatNumber(value)} ouvrages demeurent dans « À compléter ».`,
    library: 'Consulter ma bibliothèque',
    backToPending: 'Revenir à « À compléter »',
    nothing: 'Aucun ouvrage n’attend d’être complété.',
  },

  camera: {
    title: 'Photographier la couverture',
    shoot: 'Prendre la photographie',
    hint: 'Cadrez la couverture entière, puis touchez le bouton.',
  },

  settings: {
    title: 'Paramètres',
    scanning: 'Lors de la lecture des codes',
    sound: 'Signal sonore',
    soundDetail: 'À chaque code reconnu',
    vibration: 'Vibration',
    vibrationDetail: 'Pour poursuivre sans regarder l’écran ; sans effet sur iPhone',
    flagOwned: 'Signaler les ouvrages déjà possédés',
    flagOwnedDetail: 'Propose l’ajout d’un exemplaire supplémentaire',
    covers: 'Couvertures',
    autoCovers: 'Couvertures automatiques',
    autoCoversDetail: 'Votre propre photographie demeure prioritaire',
    sources: 'Sources, interrogées simultanément',
    bnfDetail: 'Particulièrement fiable pour les éditions françaises',
    googleBooksDetail: 'Vaste catalogue international',
    openLibraryDetail: 'Catalogue libre et gratuit',
    lastSource: 'Au moins une source doit demeurer active.',
    keyLabel: 'Clé Google Books',
    keyDetail:
      'Facultative. Sans clé, Google Books refuse souvent de répondre ; avec la vôtre, il répond toujours. Elle demeure sur cet appareil.',
    keySave: 'Enregistrer',
    keyChecking: 'Vérification auprès de Google Books…',
    keyValid: 'Clé enregistrée : Google Books l’accepte.',
    keyRefused:
      'Clé enregistrée, mais Google Books la refuse : vérifiez qu’elle a été copiée en entier et qu’elle autorise ce site.',
    keyUnverified: 'Clé enregistrée. Google Books n’a pu être joint pour la vérifier.',
    keyRemoved: 'Clé supprimée : Google Books est interrogé sans clé.',
    keyRetrying: 'Nouvelle recherche des ISBN inconnus…',
    keyFound: (value: number) =>
      value === 0
        ? 'Aucun des ouvrages mis de côté n’a été retrouvé.'
        : value === 1
          ? '1 ouvrage mis de côté a été retrouvé et ajouté à votre bibliothèque.'
          : `${formatNumber(value)} ouvrages mis de côté ont été retrouvés et ajoutés à votre bibliothèque.`,
    offlineSection: 'Hors connexion',
    offlineScanning: 'Lecture hors connexion',
    offlineScanningDetail: 'Les codes sont conservés ; la recherche s’effectue au retour du réseau',
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
