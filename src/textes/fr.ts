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

/** « 1er septembre » this year, « 1er septembre 2025 » another year (local time). */
export function formatNearDate(date: Date, now: Date): string {
  const text = formatDate(date);
  return date.getFullYear() === now.getFullYear() ? text.slice(0, text.lastIndexOf(' ')) : text;
}

/** « 21 h 40 », « 9 h 05 » (local time). */
export function formatTime(date: Date): string {
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
}

/** « 31 octobre 2026 à 9 h 05 »; « aujourd’hui à 21 h 40 » when now is given and is the same day. */
export function formatDateTime(date: Date, now?: Date): string {
  const day = now && date.toDateString() === now.toDateString() ? 'aujourd’hui' : formatDate(date);
  return `${day} à ${formatTime(date)}`;
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

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 12.5 → « 12,50 € ». */
export function formatPrice(value: number): string {
  return priceFormat.format(value);
}

/** « 4 », « 4 et 7 », « 4, 6 et 7 ». */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1) ?? ''}`;
}

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
    searchPlaceholder: 'Titre, auteur, étiquette, ISBN…',
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
    shortcuts: 'Raccourcis',
    shelves: 'Étagères',
    loans: 'Prêts',
    /** Read by screen readers after « Prêts ». */
    loansDue: (value: number) => count(value, 'prêt arrivé à échéance', 'prêts arrivés à échéance'),
    lost: 'Déclaré perdu',
    filterLent: 'Prêtés',
    lentTo: (name: string) => `Prêté à ${name}`,
    series: 'Séries',
    lists: 'Listes',
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
    reading: 'Ma lecture',
    rating: 'Note',
    ratingStar: (value: number) => `Note : ${formatNumber(value)} sur 5`,
    ratingValue: (value: number) => `${formatNumber(value)} sur 5`,
    notRated: 'Non noté',
    reviewLabel: 'Mon avis',
    reviewPlaceholder: 'Votre appréciation…',
    tags: 'Étiquettes',
    tagsOfBook: 'Étiquettes de l’ouvrage',
    newTag: 'Nouvelle étiquette',
    tagPlaceholder: 'Ajouter un mot-clé…',
    addTag: 'Ajouter',
    removeTag: (tag: string) => `Retirer l’étiquette « ${tag} »`,
    tagSuggestions: 'Étiquettes suggérées',
    suggestTag: (tag: string) => `Ajouter l’étiquette « ${tag} »`,
    /** Suggested on every book, followed by the tags already used in the library. */
    usualTags: ['Dédicacé', 'Édition originale', 'Cadeau', 'À donner', 'À relire', 'Abîmé', 'Format poche', 'Classique'],
    quotes: (value: number) => (value === 0 ? 'Citations' : `Citations · ${formatNumber(value)}`),
    photographQuote: 'Photographier un passage',
    writeQuote: 'Saisir une citation',
    quoteCameraHint: 'Cadrez le passage à conserver, puis touchez le bouton.',
    quoteTitle: 'Citation',
    newQuoteTitle: 'Nouvelle citation',
    quoteText: (text: string) => `« ${text} »`,
    quoteNoText: 'Passage photographié',
    quotePhotographed: (date: string) => `Photographiée le ${date}`,
    quoteWritten: (date: string) => `Saisie le ${date}`,
    quotePhoto: 'Photographie du passage',
    zoomIn: 'Agrandir',
    zoomOut: 'Ajuster à l’écran',
    quoteTextLabel: 'Texte de la citation',
    quoteTextHint: 'Facultatif : recopiez tout ou partie du passage photographié.',
    readPassage: 'Relever le texte de la photographie',
    readingPassage: 'Lecture du texte…',
    passageRead: 'Texte relevé sur la photographie : vérifiez-le et ne conservez que le passage souhaité.',
    passageNothing: 'Aucun texte lisible sur la photographie.',
    passageFailed: 'Le texte n’a pu être relevé : réessayez dans quelques instants.',
    quoteTextRequired: 'Saisissez le texte de la citation.',
    quoteSaved: 'Citation enregistrée',
    deleteQuote: 'Supprimer la citation',
    deleteQuoteTitle: 'Supprimer cette citation ?',
    deleteQuoteText: 'La citation et sa photographie éventuelle seront effacées. Cette opération est définitive.',
    quoteDeleted: 'Citation supprimée',
    copies: (value: number) => `Exemplaires · ${formatNumber(value)}`,
    move: (place: string) => `Déplacer l’exemplaire rangé dans ${place}`,
    moveButton: 'Déplacer',
    position: (ordinal: string) => `${ordinal} position à partir de la gauche`,
    lostOn: (date: string) => `Déclaré perdu le ${date}`,
    found: 'Retrouvé',
    foundLabel: (place: string) => `Exemplaire retrouvé : choisir où le ranger (dernier emplacement connu : ${place})`,
    foundTitle: 'Où ranger cet exemplaire retrouvé ?',
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
    lend: 'Prêter',
    lendLabel: (place: string) => `Prêter l’exemplaire rangé dans ${place}`,
    lentTo: (name: string, date: string) => `Prêté à ${name} le ${date}`,
    giveBack: 'Restitué',
    giveBackLabel: (name: string) => `Exemplaire restitué par ${name}`,
    delete: 'Supprimer de ma bibliothèque',
    deleteTitle: 'Supprimer cet ouvrage ?',
    deleteText: 'La fiche, ses exemplaires, sa couverture et ses citations seront effacés. Cette opération est définitive.',
    deleteConfirm: 'Supprimer définitivement',
    titleLabel: 'Titre',
    authorLabel: 'Auteur',
    authorHint: 'Plusieurs auteurs : séparez-les par une virgule.',
    publisherLabel: 'Éditeur',
    yearLabel: 'Année de parution',
    yearInvalid: 'Indiquez une année à quatre chiffres.',
    saved: 'Fiche enregistrée',
    series: (name: string) => `Série : ${name}`,
    seriesVolume: (name: string, index: number) => `Série : ${name} · tome ${formatNumber(index)}`,
    authorPage: (name: string) => `Ouvrages de ${name}`,
    seriesLabel: 'Série',
    seriesHint: 'Laissez vide si l’ouvrage n’appartient à aucune série.',
    volumeLabel: 'Tome',
    volumeInvalid: 'Indiquez le numéro du tome en chiffres.',
    priceLabel: 'Prix d’achat (en euros)',
    priceHint: 'Prix d’un exemplaire ; il figure dans l’inventaire pour l’assurance.',
    priceInvalid: 'Indiquez un prix, par exemple 12,50.',
    price: (amount: string) => `Prix d’achat : ${amount}`,
  },

  common: {
    close: 'Fermer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    create: 'Créer',
    untitled: 'Sans titre',
    unknownAuthor: 'Auteur inconnu',
    back: 'Retour',
    /** « 2ᵉ exemplaire » */
    ordinal: (value: number) => (value === 1 ? '1er' : `${formatNumber(value)}ᵉ`),
    /** « 1re position », « 3ᵉ position » */
    ordinalFeminine: (value: number) => (value === 1 ? '1re' : `${formatNumber(value)}ᵉ`),
    providers: { bnf: 'BnF', googleBooks: 'Google Books', openLibrary: 'Open Library', amazon: 'Amazon', decitre: 'Decitre' },
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
    screenTitle: 'Pièces et étagères',
    back: 'Paramètres',
    intro: 'Touchez un nom pour le modifier. Une étagère ou une pièce ne peut être supprimée que si elle ne contient aucun ouvrage.',
    copies: (value: number) => (value === 0 ? 'Vide' : count(value, 'exemplaire', 'exemplaires')),
    rename: (name: string) => `Renommer « ${name} »`,
    renameTitle: 'Renommer',
    nameLabel: 'Nom',
    deleteRoom: (name: string) => `Supprimer la pièce « ${name} »`,
    deleteShelf: (name: string) => `Supprimer l’étagère « ${name} »`,
    deleteRoomTitle: 'Supprimer cette pièce ?',
    deleteRoomText: (name: string) => `La pièce « ${name} » et ses étagères vides seront supprimées.`,
    deleteShelfTitle: 'Supprimer cette étagère ?',
    deleteShelfText: (name: string) => `L’étagère « ${name} » sera supprimée ; son étiquette QR ne sera plus reconnue.`,
    deleteConfirm: 'Supprimer',
    notEmpty: 'Elle contient encore des ouvrages : déplacez-les d’abord.',
    noRooms: 'Aucune pièce pour le moment. Créez la première ci-dessous.',
  },

  labels: {
    title: 'Étiquettes QR à imprimer',
    back: 'Paramètres',
    intro:
      'Collez chaque étiquette sur son étagère : dès que vous la scannez, les ouvrages suivants y sont rangés, sans passer par le sélecteur.',
    choose: 'Étagères à imprimer',
    all: 'Toutes',
    none: 'Aucune',
    print: (value: number) => `Imprimer · ${count(value, 'étiquette', 'étiquettes')}`,
    noShelves: 'Créez d’abord vos pièces et étagères.',
    hint: 'Conseil : imprimez sur du papier autocollant, ou découpez et fixez avec un ruban adhésif.',
  },

  shelves: {
    title: 'Étagères',
    back: 'Bibliothèque',
    summary: (value: number) => (value === 0 ? 'Aucune étagère pour le moment' : count(value, 'étagère', 'étagères')),
    books: (value: number) => (value === 0 ? 'Vide' : count(value, 'ouvrage', 'ouvrages')),
    checkedOn: (date: string) => `vérifiée le ${date}`,
    empty: 'Créez d’abord vos pièces et étagères :',
  },

  /** Screen 8: one shelf, its order, its check. */
  shelf: {
    back: 'Étagères',
    backToBook: 'Fiche de l’ouvrage',
    notFound: 'Cette étagère ne figure pas dans votre bibliothèque : elle a pu être supprimée.',
    books: (value: number) => (value === 0 ? 'Aucun ouvrage' : count(value, 'ouvrage', 'ouvrages')),
    inOrder: 'dans l’ordre de la dernière lecture',
    byTitle: 'classés par titre',
    unknownPositions: (value: number) =>
      value === 1
        ? 'La position d’un ouvrage n’est pas connue : il figure à la fin. Vérifiez l’étagère pour la relever.'
        : `La position de ${formatNumber(value)} ouvrages n’est pas connue : ils figurent à la fin. Vérifiez l’étagère pour la relever.`,
    orderOff:
      'Pour voir les ouvrages dans l’ordre de rangement, activez « Mémoriser l’ordre sur l’étagère » dans les Paramètres, puis vérifiez cette étagère.',
    whereTitle: (title: string) => `Où se trouve « ${title} » ?`,
    wherePosition: (place: string, ordinal: string) => `${place} · ${ordinal} position à partir de la gauche`,
    whereUnknown: (place: string) => `${place} · position inconnue`,
    whereLost: (place: string) => `Déclaré perdu ; dernier emplacement connu : ${place}`,
    spines: 'Tranches des ouvrages, de gauche à droite',
    spine: (ordinal: string, title: string) => `${ordinal} position : ${title}`,
    lent: (title: string) => `${title} · prêté`,
    positionPrefix: (ordinal: string) => `${ordinal} position :`,
    empty: 'Aucun ouvrage n’est rangé sur cette étagère.',
    scanHere: 'Scanner des ouvrages sur cette étagère',
    verify: 'Vérifier cette étagère',
    verifyDetail: 'Scannez-la de nouveau ; l’application compare',
    resume: (value: number) => `Reprendre la vérification · ${count(value, 'ouvrage lu', 'ouvrages lus')}`,
    printQr: 'Imprimer le code QR de cette étagère',
    resultTitle: (date: string) => `Vérification du ${date}`,
    hideResult: 'Masquer ce bilan',
    inPlace: (value: number) =>
      value === 0
        ? 'Aucun ouvrage à sa place'
        : value === 1
          ? '1 ouvrage à sa place'
          : `${formatNumber(value)} ouvrages à leur place`,
    unchecked: (value: number) =>
      value === 1
        ? '1 ouvrage sans code-barres n’a pu être vérifié par le scan.'
        : `${formatNumber(value)} ouvrages sans code-barres n’ont pu être vérifiés par le scan.`,
    missingTag: 'Introuvable',
    missingText: 'Cet ouvrage devrait se trouver ici et n’est pas prêté.',
    storedElsewhere: 'Il est rangé ailleurs',
    storedElsewhereTitle: 'Où se trouve cet ouvrage ?',
    declareLost: 'Déclarer perdu',
    misplacedTag: 'Mal rangé',
    misplacedText: (place: string) => `Trouvé ici, alors qu’il est habituellement rangé dans ${place}.`,
    moveHere: 'Le ranger désormais ici',
    putBack: 'Le remettre à sa place',
    lentTag: 'Prêté',
    lentText: 'Absence attendue : cet ouvrage est prêté.',
    notOwnedTag: 'Absent de votre bibliothèque',
    notOwnedTitle: 'Ouvrage inconnu',
    notOwnedText: 'Ce code ne correspond à aucun ouvrage de votre bibliothèque.',
    addHere: 'L’ajouter à cette étagère',
    answerMoved: (place: string) => `Emplacement mis à jour : ${place}`,
    answerPutBack: (place: string) => `À replacer dans ${place}`,
    answerLost: 'Déclaré perdu',
    answerAdded: 'Ajouté à votre bibliothèque, sur cette étagère',
    answerFailed: 'Cette opération n’a pu aboutir : la vérification a pu être remplacée par une autre.',
  },

  /** Scanning a shelf to check it (screen 8, « Vérifier cette étagère »). */
  check: {
    title: 'Vérification de l’étagère',
    quit: 'Quitter la vérification : elle pourra être reprise',
    found: (found: number, total: number) => `sur ${formatNumber(total)} ${plural(found, 'retrouvé', 'retrouvés')}`,
    toReview: 'à examiner',
    ready: 'Présentez le code-barres de chaque ouvrage de l’étagère',
    hintOrdered: 'Scannez les ouvrages dans l’ordre, de gauche à droite : leur ordre sera mémorisé.',
    hintFree: 'Scannez chacun des ouvrages de l’étagère, dans l’ordre de votre choix.',
    inPlace: (title: string) => `${title} — à sa place`,
    misplaced: (title: string, place: string) => `${title} — habituellement rangé dans ${place}`,
    notOwned: 'Cet ouvrage ne figure pas dans votre bibliothèque',
    repeated: (title: string) => `${title} — déjà lu au cours de cette vérification`,
    thisShelf: (place: string) => `Étagère reconnue : ${place}`,
    otherShelf: (place: string) => `Ce code QR désigne une autre étagère, ${place} : la vérification se poursuit`,
    listTitle: 'Ouvrages lus',
    empty: 'Les ouvrages scannés apparaîtront ici, le plus récent en tête.',
    removeRow: (title: string) => `Retirer « ${title} » de la vérification`,
    rowInPlace: 'À sa place',
    rowMisplaced: 'Mal rangé',
    rowMisplacedDetail: (place: string) => `Habituellement : ${place}`,
    rowNotOwned: 'Absent',
    rowRepeated: 'Déjà lu',
    cancel: 'Abandonner',
    finish: (value: number) => `Terminer · ${formatNumber(value)}`,
    cancelTitle: 'Abandonner la vérification ?',
    cancelText: (value: number) =>
      value === 1
        ? 'L’ouvrage lu sera oublié ; votre bibliothèque demeure inchangée.'
        : `Les ${formatNumber(value)} ouvrages lus seront oubliés ; votre bibliothèque demeure inchangée.`,
    cancelConfirm: 'Abandonner la vérification',
  },

  scan: {
    title: 'Scanner',
    choosePlace: 'Choisir un emplacement',
    torchOn: 'Allumer la lampe torche',
    torchOff: 'Éteindre la lampe torche',
    scanned: (value: number) => plural(value, 'scanné', 'scannés'),
    pending: 'à compléter',
    hint: 'La caméra demeure active : vous pouvez enchaîner les ouvrages sans toucher l’écran.',
    hintOrdered: 'Scannez les ouvrages de gauche à droite : leur ordre sur l’étagère est mémorisé.',
    sessionTitle: 'Cette session',
    emptySession: 'Les ouvrages scannés apparaîtront ici, le plus récent en tête.',
    undo: 'Annuler la dernière lecture',
    noBarcode: 'Sans code-barres',
    coverFlash: 'Photographie d’un ouvrage sans code-barres',
    coverHint: 'Cadrez la couverture entière, puis touchez « Prendre la photographie ».',
    shoot: 'Prendre la photographie',
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
    cameraFailed: 'La caméra n’a pu être ouverte. Fermez les autres applications qui l’utilisent, puis réessayez.',
    detectorFailed: 'La lecture des codes-barres n’a pu démarrer sur ce navigateur.',
    retry: 'Réessayer',
  },

  duplicate: {
    heading: 'Ouvrage déjà possédé',
    owned: (value: number) =>
      value === 1 ? 'Vous en possédez déjà 1 exemplaire :' : `Vous en possédez déjà ${formatNumber(value)} exemplaires :`,
    add: (ordinal: string) => `Ajouter un ${ordinal} exemplaire`,
    willBePlaced: (place: string) => `Il sera rangé dans ${place}`,
    decline: 'Ne pas l’ajouter',
    lostPlace: (place: string) => `${place} · déclaré perdu`,
    lentPlace: (place: string, name: string) => `${place} · prêté à ${name}`,
  },

  /** Screen 10: loans in progress, grouped by borrower. */
  loans: {
    title: 'Prêts',
    back: 'Bibliothèque',
    summary: (lent: number, late: number) =>
      lent === 0
        ? 'Aucun ouvrage prêté'
        : `${count(lent, 'ouvrage prêté', 'ouvrages prêtés')}${late > 0 ? ` · ${formatNumber(late)} en retard` : ''}`,
    lend: 'Prêter un ouvrage',
    lendDetail: 'Scannez-le, puis indiquez l’emprunteur et la durée',
    empty:
      'Aucun ouvrage n’est prêté pour le moment. Vous pouvez aussi prêter un exemplaire depuis la fiche de l’ouvrage, avec le bouton « Prêter ».',
    books: (value: number) => count(value, 'ouvrage', 'ouvrages'),
    lentOn: (date: string) => `Prêté le ${date}`,
    reminderOn: (date: string) => `Rappel le ${date}`,
    dueToday: 'Retour prévu aujourd’hui',
    late: (date: string) => `En retard · retour prévu le ${date}`,
    courtesy: (name: string) => `Adresser un rappel courtois à ${name}`,
    giveBack: 'Restitué',
    giveBackLabel: (title: string, name: string) => `« ${title} » restitué par ${name}`,
    givenBack: (title: string, place: string) => `« ${title} » restitué · à ranger dans ${place}`,
    undo: 'Annuler',
    undone: (title: string) => `Restitution de « ${title} » annulée`,
    giveBackStart: 'Restituer un ouvrage',
    giveBackStartDetail: 'Scannez-le : l’application indique où le ranger',
    history: 'Historique des prêts',
  },

  /** « Prêter un ouvrage »: borrower and duration, from the lending scan or the book sheet. */
  lend: {
    title: 'Prêter un ouvrage',
    scanned: 'Scanné à l’instant',
    copy: 'Exemplaire',
    borrower: 'Emprunteur',
    newPerson: 'Nouvelle personne',
    nameLabel: 'Nom de l’emprunteur',
    namePlaceholder: 'Par exemple : Claire',
    duration: 'Durée du prêt',
    durations: { '2w': '2 semaines', '1m': '1 mois', '2m': '2 mois' },
    confirm: (name: string) => `Prêter à ${name}`,
    chooseBorrower: 'Veuillez choisir un emprunteur',
    done: (title: string, name: string, date: string) => `« ${title} » prêté à ${name} · rappel le ${date}`,
    failed: 'Cet exemplaire est déjà prêté.',
  },

  /** Scans of « Prêter un ouvrage » (a lent book read is given back all the same) and « Restituer un ouvrage ». */
  lendScan: {
    title: 'Prêter un ouvrage',
    titleReturn: 'Restituer un ouvrage',
    quit: 'Revenir aux prêts',
    readyReturn: 'Présentez le code-barres de l’ouvrage restitué',
    hintReturn: 'Scannez l’un après l’autre les ouvrages qui vous sont restitués.',
    lentFlash: (title: string, name: string) => `« ${title} » prêté à ${name}`,
    givenBackFlash: (title: string) => `« ${title} » restitué`,
    notLent: (title: string) => `« ${title} » n’est pas prêté`,
    ready: 'Présentez le code-barres de l’ouvrage à prêter',
    hint: 'Un ouvrage prêté qui vous est restitué est reconnu de même : scannez-le simplement.',
    notOwned: 'Cet ouvrage ne figure pas dans votre bibliothèque',
    shelfQr: 'Ce code QR désigne une étagère : présentez le code-barres d’un ouvrage',
    lent: (value: number) => plural(value, 'prêté', 'prêtés'),
    givenBack: (value: number) => plural(value, 'restitué', 'restitués'),
    listTitle: 'Cette session',
    empty: 'Les ouvrages prêtés ou restitués apparaîtront ici, le plus récent en tête.',
    emptyReturn: 'Les ouvrages restitués apparaîtront ici, le plus récent en tête.',
    rowLent: (name: string, date: string) => `À ${name} · rappel le ${date}`,
    rowGivenBack: (place: string) => `À ranger dans ${place}`,
    statusLent: 'Prêté',
    statusGivenBack: 'Restitué',
    undoRow: (title: string) => `Annuler l’opération sur « ${title} »`,
    undoneLend: (title: string) => `Prêt de « ${title} » annulé`,
    undoneGiveBack: (title: string) => `Restitution de « ${title} » annulée`,
    undoFailed: 'Cette opération ne peut plus être annulée : l’exemplaire a été prêté de nouveau.',
    justLent: (title: string, name: string) => `${title} — vient d’être prêté à ${name}`,
    justGivenBack: (title: string) => `${title} — vient d’être restitué`,
    finish: 'Terminer',
    chooseText: (value: number) =>
      value === 1 ? 'Un exemplaire de cet ouvrage est prêté :' : `${formatNumber(value)} exemplaires de cet ouvrage sont prêtés :`,
    givenBackBy: (name: string) => `Restitué par ${name}`,
    lentSince: (date: string) => `Prêté le ${date}`,
    lendAnother: 'Prêter un autre exemplaire',
    ignore: 'Ne rien faire',
  },

  /** « Adresser un rappel courtois »: a message the user sends with the app of their choice. */
  courtesy: {
    title: (name: string) => `Rappel courtois à ${name}`,
    label: 'Message',
    hint: 'Vous pouvez le modifier avant de l’envoyer.',
    message: (name: string, title: string, date: string) =>
      `Bonjour ${name},\nJ’espère que vous avez apprécié « ${title} », que je vous ai prêté le ${date}. Pourriez-vous me le rapporter lorsque vous l’aurez terminé ? Je vous en remercie par avance.`,
    send: 'Envoyer le message',
    copy: 'Copier le message',
    copied: 'Message copié : collez-le dans la messagerie de votre choix.',
    copyFailed: 'Le message n’a pu être copié : sélectionnez-le, puis copiez-le.',
  },

  /** Reminders of the return day: in the app always, on the phone and in the calendar as options. */
  loanReminders: {
    inAppOne: (title: string, name: string) => `Le prêt de « ${title} » à ${name} est arrivé à échéance.`,
    inAppMany: (value: number) => `${formatNumber(value)} prêts sont arrivés à échéance.`,
    see: 'Consulter les prêts',
    dismiss: 'Masquer ce rappel',
    notificationTitle: (value: number) =>
      value === 1 ? 'Prêt arrivé à échéance' : `${formatNumber(value)} prêts arrivés à échéance`,
    notificationMore: (title: string, name: string, others: number) =>
      `« ${title} », prêté à ${name}, et ${count(others, 'autre prêt', 'autres prêts')}`,
    notificationItem: (title: string, name: string) => `« ${title} », prêté à ${name}`,
    enabledTitle: 'Rappels des prêts',
    enabledBody: 'Le téléphone vous préviendra ainsi le jour du retour prévu de chaque prêt.',
    calendarTitle: (title: string, name: string) => `Retour de « ${title} », prêté à ${name}`,
    calendarDetails: (date: string) => `Prêté le ${date}. Rappel de Ma bibliothèque.`,
    addToCalendar: 'Ajouter à l’agenda',
    addToCalendarLabel: (title: string) => `Ajouter le retour de « ${title} » à l’agenda`,
  },

  loanHistory: {
    title: 'Historique des prêts',
    back: 'Prêts',
    summary: (value: number) => (value === 0 ? 'Aucun prêt terminé' : count(value, 'prêt terminé', 'prêts terminés')),
    empty: 'Les prêts figureront ici une fois les ouvrages restitués.',
    period: (name: string, from: string, to: string) => `${name} · du ${from} au ${to}`,
    removed: 'Ouvrage retiré de votre bibliothèque',
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
    readingLabel: 'Relevé sur la couverture',
    reading: 'Lecture de la couverture…',
    nothingRead: 'Aucun titre lisible sur la photographie.',
    volume: (value: number) => `tome ${formatNumber(value)}`,
    confirm: 'Confirmer',
    confirmLabel: (title: string) => `Confirmer « ${title} »`,
    correct: 'Corriger',
    confirmed: (title: string) => `« ${title} » a été ajouté à votre bibliothèque`,
    noKeyHint: 'Les couvertures photographiées peuvent être lues automatiquement : saisissez une clé OpenRouter dans les Paramètres.',
    keyRefusedHint: 'OpenRouter refuse la clé saisie : les couvertures ne sont pas lues. Vérifiez-la dans les Paramètres.',
    policyHint:
      'OpenRouter refuse les modèles gratuits avec les paramètres de confidentialité de votre compte : autorisez-les dans la rubrique « Privacy » du site d’OpenRouter.',
    toPrivacy: 'Ouvrir les paramètres de confidentialité d’OpenRouter',
    dailyHint: 'Les cinquante lectures gratuites du jour sont faites : la lecture reprendra d’elle-même lorsque OpenRouter les renouvellera, en général dans la nuit.',
    toSettings: 'Ouvrir les Paramètres',
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
    incomplete:
      'Les sources qui ont répondu ne connaissent pas ce code, mais une autre n’a pu être jointe : réessayez dans quelques instants.',
    retryAll: (value: number) =>
      value === 1 ? 'Rechercher de nouveau l’ISBN inconnu' : `Rechercher de nouveau les ${formatNumber(value)} ISBN inconnus`,
    retryingAll: (done: number, total: number) =>
      `Nouvelle recherche des ISBN inconnus : ${formatNumber(done)} sur ${formatNumber(total)}…`,
    retryAllDone: (found: number, unavailable: number) =>
      [
        found === 0
          ? 'Aucun ouvrage n’a été retrouvé.'
          : found === 1
            ? '1 ouvrage a été retrouvé et ajouté à votre bibliothèque.'
            : `${formatNumber(found)} ouvrages ont été retrouvés et ajoutés à votre bibliothèque.`,
        unavailable === 0
          ? ''
          : unavailable === 1
            ? '1 n’a pu être recherché dans toutes les sources : réessayez dans quelques instants.'
            : `${formatNumber(unavailable)} n’ont pu être recherchés dans toutes les sources : réessayez dans quelques instants.`,
      ]
        .filter(Boolean)
        .join(' '),
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
    readingPending: 'Lecture de la couverture…',
    readingDone: 'Titre et auteur lus sur la couverture : vérifiez-les, puis enregistrez.',
    readingNothing: 'Aucun titre lisible sur la photographie : dictez-le ou saisissez-le.',
    searchTitle: 'Rechercher l’ouvrage',
    dictate: 'Dicter le titre et l’auteur',
    stopDictation: 'Arrêter la dictée',
    listening: 'Parlez : le titre, puis l’auteur…',
    searchLabel: 'Titre et auteur à rechercher dans les catalogues',
    searchPlaceholder: 'Ou saisissez le titre et l’auteur',
    searchPlaceholderTyped: 'Titre et auteur',
    search: 'Rechercher dans les catalogues',
    searching: 'Recherche dans les catalogues…',
    resultsLabel: (count: string) => `Éditions trouvées : ${count}`,
    resultsHint: 'Touchez l’édition qui correspond à votre ouvrage pour remplir la fiche.',
    source: (name: string) => `Source : ${name}`,
    noResult: 'Aucun ouvrage trouvé dans les catalogues.',
    noResultPlaced: 'Aucun ouvrage trouvé dans les catalogues : les mots recherchés ont été placés dans le titre, à corriger au besoin.',
    searchUnavailable: 'Les catalogues n’ont pu être joints : vérifiez la connexion, puis réessayez.',
    picked: (source: string) => `Fiche remplie d’après ${source} : vérifiez-la, puis enregistrez.`,
    pickedFrom: { bnf: 'la BnF', googleBooks: 'Google Books', openLibrary: 'Open Library' },
    dictationDenied: 'Le micro est refusé à l’application : autorisez-le dans les paramètres du navigateur, ou saisissez le titre.',
    dictationNetwork: 'La dictée nécessite une connexion à Internet : saisissez le titre, ou réessayez dans quelques instants.',
    dictationNothing: 'Rien n’a été entendu : touchez de nouveau « Dicter le titre et l’auteur » et parlez distinctement.',
    dictationFailed: (code: string) =>
      `La dictée n’a pu démarrer sur ce téléphone (${code === 'timeout' ? 'aucune réponse' : `code ${code}`}) : touchez le champ ci-dessous, puis le micro du clavier.`,
    keyboardHint: 'Le micro du clavier permet aussi de dicter dans ce champ.',
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

  backup: {
    title: 'Sauvegarde',
    back: 'Paramètres',
    settingsRow: 'Sauvegarde sur Google Drive',
    rowNotSet: 'Non configurée : vos données ne sont conservées que sur ce téléphone',
    rowDisabled: 'Sauvegarde automatique désactivée',
    rowNever: 'Aucune sauvegarde pour le moment',
    rowLast: (when: string) => `Dernière sauvegarde : ${when}`,
    rowReconnect: 'Google refuse l’accès : reconnectez-vous',
    intro:
      'Votre bibliothèque, ses photographies et ses citations sont copiées sur votre Google Drive, dans un dossier réservé à l’application et invisible dans Drive. Vous pourrez les restaurer sur un autre téléphone.',
    clientTitle: 'Identifiants Google',
    clientIntro:
      'Créés dans la console Google Cloud, selon les explications qui vous ont été fournies. Ils demeurent sur ce téléphone.',
    clientId: 'Identifiant du client',
    clientSecret: 'Code secret du client',
    clientIdInvalid: 'L’identifiant se termine par « .apps.googleusercontent.com ».',
    clientSecretMissing: 'Saisissez le code secret.',
    redirect: 'Adresse de redirection à déclarer',
    connect: 'Se connecter à Google Drive',
    reconnect: 'Se reconnecter à Google Drive',
    editClient: 'Modifier les identifiants',
    connecting: 'Connexion à Google Drive…',
    connected: 'Google Drive est connecté : première sauvegarde en cours.',
    cancelled: 'Connexion annulée.',
    signInFailed: 'La connexion n’a pu aboutir. Vérifiez l’identifiant et le code secret, puis recommencez.',
    missingScope: 'L’accès à Google Drive n’a pas été accordé : recommencez en cochant la case proposée par Google.',
    status: 'État',
    auto: 'Sauvegarde automatique',
    autoDetail: 'Au démarrage, puis toutes les dix minutes et à la sortie de l’application, si la bibliothèque a changé',
    last: (when: string) => `Dernière sauvegarde : ${when}`,
    never: 'Aucune sauvegarde pour le moment.',
    errorOffline: 'La dernière tentative a échoué faute de connexion ; elle sera renouvelée.',
    errorRefused: 'Google refuse désormais l’accès : reconnectez-vous.',
    errorFailed: 'La dernière tentative a échoué ; elle sera renouvelée.',
    backUpNow: 'Sauvegarder maintenant',
    backingUp: 'Sauvegarde en cours…',
    backedUp: 'Sauvegarde effectuée.',
    restore: 'Restaurer une sauvegarde',
    searching: 'Recherche de la sauvegarde…',
    noBackup: 'Aucune sauvegarde ne figure sur ce compte Google Drive.',
    restoreTitle: 'Restaurer cette sauvegarde ?',
    restoreText: (when: string, books: number, local: number) =>
      `La sauvegarde du ${when} (${count(books, 'ouvrage', 'ouvrages')}) remplacera la bibliothèque de ce téléphone (${count(local, 'ouvrage', 'ouvrages')}). Cette opération est définitive.`,
    restoreConfirm: 'Restaurer',
    restoring: (done: number, total: number) =>
      `Téléchargement des photographies : ${formatNumber(done)} sur ${formatNumber(total)}…`,
    restored: 'Bibliothèque restaurée.',
    restoreFailed: 'La restauration n’a pu aboutir ; la bibliothèque de ce téléphone est inchangée.',
    disconnect: 'Déconnecter Google Drive',
    disconnectTitle: 'Déconnecter Google Drive ?',
    disconnectText: 'Les sauvegardes déjà faites demeurent sur votre Google Drive ; aucune nouvelle ne sera faite.',
    disconnectConfirm: 'Déconnecter',
    disconnected: 'Google Drive est déconnecté.',
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
    rememberOrder: 'Mémoriser l’ordre sur l’étagère',
    rememberOrderDetail: 'Relevé de gauche à droite lors du scan ou de la vérification d’une étagère',
    covers: 'Couvertures',
    autoCovers: 'Couvertures automatiques',
    autoCoversDetail: 'Votre propre photographie demeure prioritaire',
    missingCovers: (value: number) =>
      value === 0
        ? 'Tous vos ouvrages pourvus d’un ISBN ont une couverture.'
        : value === 1
          ? '1 ouvrage pourvu d’un ISBN n’a pas de couverture.'
          : `${formatNumber(value)} ouvrages pourvus d’un ISBN n’ont pas de couverture.`,
    searchCovers: 'Rechercher les couvertures manquantes',
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
    openRouterSection: 'Lecture des couvertures',
    openRouterLabel: 'Clé OpenRouter',
    openRouterDetail:
      'Les couvertures photographiées des ouvrages à compléter sont lues par un modèle gratuit d’OpenRouter : titre, auteur, éditeur ; cinquante lectures par jour au plus. Seules les photographies sont envoyées ; les fournisseurs des modèles gratuits peuvent les conserver. Créez un compte et une clé gratuits sur OpenRouter, puis collez la clé ici.',
    openRouterCreate: 'Créer une clé sur OpenRouter',
    openRouterValid: 'Clé enregistrée : OpenRouter l’accepte. Les couvertures photographiées vont être lues.',
    openRouterRefused: 'Clé enregistrée, mais OpenRouter la refuse : vérifiez-la.',
    openRouterUnverified: 'Clé enregistrée. OpenRouter n’a pu être joint pour la vérifier.',
    openRouterRemoved: 'Clé supprimée : les couvertures ne seront plus lues.',
    keyRemoved: 'Clé supprimée : Google Books est interrogé sans clé.',
    keyRetrying: 'Nouvelle recherche des ISBN inconnus…',
    keyFound: (value: number) =>
      value === 0
        ? 'Aucun des ouvrages mis de côté n’a été retrouvé.'
        : value === 1
          ? '1 ouvrage mis de côté a été retrouvé et ajouté à votre bibliothèque.'
          : `${formatNumber(value)} ouvrages mis de côté ont été retrouvés et ajoutés à votre bibliothèque.`,
    loansSection: 'Prêts',
    loanNotifications: 'Notification à l’échéance',
    loanNotificationsDetail:
      'Le téléphone vous prévient le jour du retour prévu, même application fermée. Android seulement, application installée ; Chrome choisit le moment, une fois par jour au plus.',
    loanNotificationsOn: 'Notifications activées : une notification d’essai vient d’être envoyée.',
    loanNotificationsUnsupported:
      'Ce navigateur ne permet pas ces notifications : seul Chrome sur Android le permet, l’application étant installée sur l’écran d’accueil.',
    loanNotificationsDenied:
      'Les notifications sont refusées à cette application : autorisez-les dans les paramètres du téléphone, puis réessayez.',
    loanNotificationsNotInstalled:
      'Chrome ne le permet qu’à l’application installée sur l’écran d’accueil : ouvrez-la depuis son icône, puis réessayez.',
    loanCalendar: 'Ajouter chaque prêt à l’agenda',
    loanCalendarDetail:
      'Google Agenda s’ouvre lors du prêt, à la date du retour prévu, et vous préviendra ce jour-là. Il reçoit le titre de l’ouvrage et le nom de l’emprunteur.',
    offlineSection: 'Hors connexion',
    offlineScanning: 'Lecture hors connexion',
    offlineScanningDetail: 'Les codes sont conservés ; la recherche s’effectue au retour du réseau',
    myData: 'Mes données',
    privacy: 'Règles de confidentialité',
    places: 'Pièces et étagères',
    labels: 'Étiquettes QR à imprimer',
    exportCsv: 'Exporter (CSV, Excel)',
    exporting: 'Préparation du fichier…',
    exportEmpty: 'Votre bibliothèque est vide : il n’y a rien à exporter.',
    exported: (fileName: string, books: number, copies: number) =>
      `Fichier « ${fileName} » créé : ${count(books, 'ouvrage', 'ouvrages')}, ${count(copies, 'exemplaire', 'exemplaires')}, une ligne par exemplaire. Les photographies et les citations n’y figurent pas.`,
    exportFailed: 'Le fichier n’a pu être créé.',
    importCsv: 'Importer (CSV ou exportation Libib)',
    insurance: 'Inventaire pour l’assurance (PDF)',
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

  /**
   * CSV export, one row per copy. The import recognises these column names (ignoring case and
   * accents): renaming one prevents files exported before from being imported.
   */
  csv: {
    fileName: (isoDate: string) => `ma-bibliotheque-${isoDate}.csv`,
    columns: {
      title: 'Titre',
      authors: 'Auteurs',
      publisher: 'Éditeur',
      year: 'Année',
      isbn13: 'ISBN-13',
      isbn10: 'ISBN-10',
      language: 'Langue',
      series: 'Série',
      volume: 'Tome',
      room: 'Pièce',
      shelf: 'Étagère',
      status: 'Statut',
      rating: 'Note',
      review: 'Avis',
      tags: 'Étiquettes',
      addedAt: 'Ajouté le',
      note: 'Remarque',
      price: 'Prix d’achat',
    },
    statusRead: 'Lu',
    statusToRead: 'À lire',
  },

  importFile: {
    title: 'Importer des ouvrages',
    back: 'Paramètres',
    intro:
      'Choisissez un fichier CSV exporté par cette application, ou par Libib depuis son site (exportation d’une collection). Les ouvrages déjà présents dans votre bibliothèque ne sont pas importés de nouveau.',
    choose: 'Choisir un fichier',
    chooseOther: 'Choisir un autre fichier',
    reading: 'Lecture du fichier…',
    unreadable: 'Ce fichier n’a pu être lu.',
    empty: 'Ce fichier ne contient aucun ouvrage.',
    unknownFormat:
      'Ce fichier n’est pas reconnu : il ne provient ni de cette application ni de Libib. Sa première ligne doit nommer les colonnes.',
    fileLabel: 'Fichier',
    formatApp: 'Exportation de Ma bibliothèque',
    formatLibib: 'Exportation Libib',
    newBooks: (books: number, copies: number) =>
      books === 0
        ? 'Aucun ouvrage à importer'
        : `${count(books, 'ouvrage', 'ouvrages')} à importer, ${count(copies, 'exemplaire', 'exemplaires')}`,
    owned: (value: number) =>
      value === 1
        ? '1 ouvrage figure déjà dans votre bibliothèque : il est ignoré.'
        : `${formatNumber(value)} ouvrages figurent déjà dans votre bibliothèque : ils sont ignorés.`,
    ignored: (value: number) =>
      value === 1
        ? '1 ligne est ignorée : elle ne décrit pas un livre, ou n’a ni titre ni ISBN.'
        : `${formatNumber(value)} lignes sont ignorées : elles ne décrivent pas un livre, ou n’ont ni titre ni ISBN.`,
    nothingNew: 'Tous les ouvrages de ce fichier figurent déjà dans votre bibliothèque.',
    placesFromFile: 'Chaque exemplaire est rangé dans la pièce et sur l’étagère indiquées par le fichier ; celles qui manquent sont créées.',
    destination: 'Où ranger ces ouvrages ?',
    destinationTitle: 'Où ranger les ouvrages importés ?',
    destinationLibib:
      'Libib n’indique pas l’emplacement des ouvrages : ils seront tous rangés sur l’étagère choisie. Vous pourrez ensuite déplacer chacun depuis sa fiche.',
    destinationPartial: 'Les exemplaires sans emplacement dans le fichier seront rangés sur l’étagère choisie.',
    chooseDestination: 'Choisir l’étagère',
    start: (value: number) => `Importer ${count(value, 'ouvrage', 'ouvrages')}`,
    importing: 'Importation en cours…',
    failed: 'L’importation a échoué ; votre bibliothèque est inchangée.',
    done: (books: number, copies: number) =>
      `Importation terminée : ${count(books, 'ouvrage', 'ouvrages')} et ${count(copies, 'exemplaire', 'exemplaires')} ajoutés à votre bibliothèque.`,
    library: 'Consulter ma bibliothèque',
  },

  /** Background search of covers and missing fields (after an import, or from the settings). */
  enrichment: {
    running: (done: number, total: number) =>
      `Recherche des couvertures et des informations manquantes : ${formatNumber(done)} sur ${formatNumber(total)}…`,
    runningHint: 'La recherche se poursuit si vous quittez cet écran, tant que l’application demeure ouverte.',
    done: (covers: number, total: number) =>
      covers === 0
        ? 'Recherche terminée : aucune couverture n’a été trouvée.'
        : `Recherche terminée : couverture trouvée pour ${count(covers, 'ouvrage', 'ouvrages')} sur ${formatNumber(total)}.`,
    doneNoCovers: 'Recherche des informations manquantes terminée.',
    notSearched: (value: number) =>
      value === 1
        ? '1 ouvrage n’a pu être recherché dans toutes les sources (réseau absent, ou source momentanément indisponible) : réessayez ultérieurement avec « Rechercher les couvertures manquantes », dans les Paramètres.'
        : `${formatNumber(value)} ouvrages n’ont pu être recherchés dans toutes les sources (réseau absent, ou source momentanément indisponible) : réessayez ultérieurement avec « Rechercher les couvertures manquantes », dans les Paramètres.`,
  },

  /** Screen 9: the series of the library, and one series. */
  series: {
    listTitle: 'Séries',
    back: 'Bibliothèque',
    summary: (value: number) => (value === 0 ? 'Aucune série' : count(value, 'série', 'séries')),
    emptyTitle: 'Aucune série n’a encore été reconnue',
    emptyText:
      'Les séries sont identifiées lorsque la source les référence, ou lorsque le titre indique le tome (« Astérix - Tome 3 »). Vous pouvez aussi indiquer la série d’un ouvrage depuis sa fiche, par « Modifier ».',
    rowOwned: (owned: number, total: number) => `${formatNumber(owned)} sur ${formatNumber(total)}`,
    rowBooks: (value: number) => count(value, 'ouvrage', 'ouvrages'),
    rowMissing: (value: number) => count(value, 'tome manquant', 'tomes manquants'),
    complete: 'Série complète',
    kicker: 'Série',
    notFound: 'Cette série ne figure plus dans votre bibliothèque.',
    ownedOf: (owned: number, total: number) => `Vous en possédez ${formatNumber(owned)} sur ${formatNumber(total)}`,
    ownedBooks: (value: number) => `Vous en possédez ${count(value, 'ouvrage', 'ouvrages')}`,
    missingOne: (index: number) => `Il manque le tome ${formatNumber(index)}`,
    missingSome: (list: string) => `Il manque les tomes ${list}`,
    missingMany: (value: number) => `Il manque ${formatNumber(value)} tomes`,
    volumes: 'Tomes',
    volume: (index: number) => `Tome ${formatNumber(index)}`,
    volumeOwned: (index: number, title: string) => `Tome ${formatNumber(index)} : ${title}`,
    volumeMissing: 'Manquant',
    volumeWished: 'Dans vos souhaits',
    volumeWishLabel: (index: number) => `Tome ${formatNumber(index)}, manquant : l’ajouter à vos souhaits`,
    volumeUnwishLabel: (index: number) => `Tome ${formatNumber(index)}, dans vos souhaits : l’en retirer`,
    volumeWishTitledLabel: (index: number, title: string) =>
      `Tome ${formatNumber(index)}, « ${title} », manquant : l’ajouter à vos souhaits`,
    volumeUnwishTitledLabel: (index: number, title: string) =>
      `Tome ${formatNumber(index)}, « ${title} », dans vos souhaits : l’en retirer`,
    addMissing: 'Ajouter les tomes manquants à mes souhaits',
    allWished: 'Les tomes manquants figurent dans vos souhaits',
    addedMissing: (value: number) => `${count(value, 'tome ajouté', 'tomes ajoutés')} à vos souhaits`,
    unnumbered: 'Sans numéro de tome',
    totalDeclared: (value: number) => `Nombre de tomes parus : ${formatNumber(value)}, indiqué par vous`,
    totalFound: (value: number) => `Nombre de tomes parus : ${formatNumber(value)}, d’après la BnF`,
    totalSearching: 'Recherche du nombre de tomes parus à la BnF…',
    totalNotFound: 'Nombre de tomes parus : inconnu de la BnF',
    totalUnknown: 'Nombre de tomes parus : non indiqué',
    totalEdit: 'Modifier',
    totalEditLabel: 'Modifier le nombre de tomes parus',
    totalTitle: 'Nombre de tomes parus',
    totalHint: 'Laissez vide : l’application retient le nombre trouvé à la BnF, ou à défaut le plus grand numéro que vous possédez.',
    totalInvalid: 'Indiquez un nombre de 1 à 500.',
    sameAuthor: 'Du même auteur',
    authorRow: (value: number) => `${count(value, 'ouvrage', 'ouvrages')} dans votre bibliothèque · voir les titres manquants`,
    otherSeries: 'Vos autres séries',
    note: 'Les séries sont identifiées lorsque la source les référence ; à défaut, vous pouvez regrouper vous-même les ouvrages. Le nombre de tomes parus et le titre des tomes manquants viennent de la BnF.',
    addBook: 'Ajouter un ouvrage à cette série',
    addTitle: 'Ajouter un ouvrage à la série',
    addSearchLabel: 'Rechercher dans votre bibliothèque',
    addSearchPlaceholder: 'Titre ou auteur…',
    addNoMatch: 'Aucun ouvrage ne correspond à votre recherche.',
    addInOther: (name: string) => `Actuellement dans la série « ${name} »`,
    addVolumeLabel: 'Numéro du tome',
    addVolumeHint: 'Facultatif.',
    addConfirm: 'Ajouter à la série',
    addChange: 'Choisir un autre ouvrage',
    added: (title: string) => `« ${title} » ajouté à la série`,
  },

  /** Screen 9: « Du même auteur ». */
  author: {
    kicker: 'Auteur',
    summary: (value: number) => `${count(value, 'ouvrage', 'ouvrages')} dans votre bibliothèque`,
    series: 'Ses séries',
    owned: 'Dans votre bibliothèque',
    missing: 'Absents de votre bibliothèque',
    searching: 'Recherche des autres ouvrages de l’auteur…',
    offline: 'Les autres ouvrages de l’auteur seront recherchés lorsque le réseau sera disponible.',
    failed: 'Les autres ouvrages de l’auteur n’ont pu être recherchés.',
    retry: 'Réessayer',
    noneMissing: 'Open Library ne connaît aucun autre ouvrage de cet auteur paru en français.',
    source: 'D’après Open Library ; la liste peut être incomplète.',
    wish: (title: string) => `Ajouter « ${title} » à mes souhaits`,
    unwish: (title: string) => `Retirer « ${title} » de mes souhaits`,
    year: (value: number) => `Paru en ${value}`,
  },

  /** Screen 11: wishes, duplicates, insurance. */
  lists: {
    title: 'Listes',
    back: 'Bibliothèque',
    tabs: 'Listes',
    wishes: 'Souhaits',
    duplicates: 'Doublons',
    insurance: 'Assurance',
  },

  wishes: {
    bookshopTitle: 'En librairie',
    bookshopText: 'Scannez un ouvrage pour savoir immédiatement s’il figure déjà dans votre bibliothèque ou dans vos souhaits.',
    bookshopAction: 'Vérifier un ouvrage',
    title: (value: number) => (value === 0 ? 'Mes souhaits' : `Mes souhaits · ${formatNumber(value)}`),
    share: 'Partager',
    shareLabel: 'Partager ma liste de souhaits',
    add: 'Ajouter un souhait',
    empty:
      'Aucun souhait pour le moment. Ajoutez-en depuis une série incomplète, la page d’un auteur ou la vérification en librairie, ou saisissez-les vous-même.',
    sources: {
      series: 'Série incomplète',
      author: 'Du même auteur',
      bookshop: 'Vu en librairie',
      manual: 'Ajouté manuellement',
    },
    volumeTitle: (name: string, index: number) => `${name}, tome ${formatNumber(index)}`,
    unknownTitle: 'Titre inconnu',
    isbn: (isbn: string) => `ISBN ${isbn}`,
    sheetTitle: 'Souhait',
    newTitle: 'Nouveau souhait',
    titleLabel: 'Titre',
    titleRequired: 'Saisissez le titre de l’ouvrage.',
    authorLabel: 'Auteur',
    isbnLabel: 'ISBN',
    isbnHint: 'Facultatif : il désigne l’édition souhaitée.',
    isbnInvalid: 'Cet ISBN n’est pas valide.',
    remove: 'Retirer de mes souhaits',
    removed: (title: string) => `« ${title} » retiré de vos souhaits`,
    saved: 'Souhait enregistré',
    added: (title: string) => `« ${title} » ajouté à vos souhaits`,
    already: (title: string) => `« ${title} » figure déjà dans vos souhaits`,
    acquired: (value: number) =>
      value === 1
        ? '1 souhait réalisé : l’ouvrage figure désormais dans votre bibliothèque.'
        : `${formatNumber(value)} souhaits réalisés : ces ouvrages figurent désormais dans votre bibliothèque.`,
  },

  /** « Partager » the wish list. */
  shareWishes: {
    title: 'Partager ma liste de souhaits',
    text: (value: number) =>
      value === 1
        ? 'Vos proches verront l’ouvrage de cette liste, mais non votre bibliothèque.'
        : `Vos proches verront les ${formatNumber(value)} ouvrages de cette liste, mais non votre bibliothèque.`,
    note: 'Le lien contient la liste d’aujourd’hui : partagez-le de nouveau après l’avoir modifiée.',
    nameLabel: 'Votre nom, en tête de la liste',
    nameHint: 'Facultatif.',
    shareLink: 'Partager le lien',
    copyLink: 'Copier le lien',
    copied: 'Lien copié. Vos proches pourront consulter cette liste, mais non votre bibliothèque.',
    copyFailed: 'Le lien n’a pu être copié.',
    preparing: 'Préparation du lien…',
    messageTitle: (name: string) => `Liste de souhaits de ${name}`,
    messageTitleAnonymous: 'Ma liste de souhaits',
    messageText: 'Voici les ouvrages qui me feraient plaisir.',
  },

  /** The wish list opened from a shared link, by a relative. */
  sharedList: {
    title: (name: string) => `Liste de souhaits de ${name}`,
    titleAnonymous: 'Liste de souhaits',
    summary: (date: string, value: number) => `Établie le ${date} · ${count(value, 'ouvrage', 'ouvrages')}`,
    loading: 'Ouverture de la liste…',
    empty: 'Cette liste est vide.',
    invalid:
      'Ce lien de liste de souhaits est incomplet ou altéré. Demandez à la personne qui vous l’a transmis de le partager de nouveau.',
    note: 'Cette liste vous a été transmise par lien. Elle ne donne aucun accès à la bibliothèque de son auteur.',
    isbn: (isbn: string) => `ISBN ${isbn}`,
    open: 'Ouvrir Ma bibliothèque',
  },

  /** « En librairie »: the scan of books to check before buying them. */
  bookshop: {
    title: 'En librairie',
    quit: 'Revenir aux listes',
    ready: 'Présentez le code-barres d’un ouvrage',
    hint: 'L’application indique si vous possédez déjà l’ouvrage ou s’il figure dans vos souhaits.',
    owned: (title: string) => `« ${title} » — déjà dans votre bibliothèque`,
    wished: (title: string) => `« ${title} » figure dans vos souhaits`,
    absent: 'Absent de votre bibliothèque',
    absentTitle: (title: string) => `« ${title} » — absent de votre bibliothèque`,
    again: (title: string) => `${title} — déjà vérifié au cours de cette visite`,
    lentTo: (name: string) => `Prêté à ${name}`,
    lost: 'Déclaré perdu',
    copies: (value: number, place: string) => `${count(value, 'exemplaire', 'exemplaires')} · ${place}`,
    searching: 'Recherche du titre…',
    unknown: 'Titre inconnu des sources',
    offline: 'Titre inconnu hors connexion',
    seriesOwned: (name: string, value: number) => `Série « ${name} » : vous en possédez ${count(value, 'tome', 'tomes')}`,
    seriesMissing: (name: string, index: number) => `Tome ${formatNumber(index)} de « ${name} », qui vous manque`,
    shelfQr: 'Ce code QR désigne une étagère : présentez le code-barres d’un ouvrage',
    countOwned: (value: number) => plural(value, 'possédé', 'possédés'),
    countWished: (value: number) => plural(value, 'souhaité', 'souhaités'),
    countAbsent: (value: number) => plural(value, 'absent', 'absents'),
    listTitle: 'Cette visite',
    empty: 'Les ouvrages vérifiés apparaîtront ici, le plus récent en tête.',
    statusOwned: 'Possédé',
    statusWished: 'Souhaité',
    finish: 'Terminer',
  },

  duplicates: {
    intro: 'Les ouvrages que vous possédez en plusieurs exemplaires. Indiquez ceux que vous souhaitez donner ou revendre.',
    empty: 'Vous ne possédez aucun ouvrage en plusieurs exemplaires.',
    summary: (value: number, give: number) =>
      `${count(value, 'ouvrage', 'ouvrages')} en plusieurs exemplaires · ${formatNumber(give)} à donner`,
    times: (value: number) => `× ${formatNumber(value)}`,
    /** The tag marking a book to give, as in the suggestions of the book sheet. */
    tag: 'À donner',
    give: 'À donner',
    giveLabel: (title: string) => `Un exemplaire de « ${title} » est à donner`,
    placeCount: (place: string, value: number) => `${place} (${formatNumber(value)})`,
    export: 'Exporter la liste (CSV)',
    exported: (fileName: string) => `Fichier enregistré : ${fileName}`,
    fileName: (isoDate: string) => `doublons-${isoDate}.csv`,
    columns: {
      title: 'Titre',
      authors: 'Auteurs',
      isbn13: 'ISBN-13',
      copies: 'Exemplaires',
      places: 'Emplacements',
      give: 'À donner',
    },
    yes: 'Oui',
    no: 'Non',
  },

  insurance: {
    /** Tags of the book sheet marking a precious edition, whose photographs may join the inventory. */
    preciousTags: ['Édition originale', 'Dédicacé'],
    kicker: 'Inventaire pour l’assurance',
    books: (value: number) => count(value, 'ouvrage', 'ouvrages'),
    places: (rooms: number, shelves: number) => `${count(rooms, 'pièce', 'pièces')} · ${count(shelves, 'étagère', 'étagères')}`,
    priced: (value: number) => `prix d’achat renseigné pour ${count(value, 'ouvrage', 'ouvrages')}`,
    value: (amount: string) => `Valeur d’achat déclarée : ${amount}`,
    options: 'Contenu de l’inventaire',
    covers: 'Inclure les couvertures',
    prices: 'Inclure les prix d’achat',
    pricesDetail: 'Saisis sur la fiche de chaque ouvrage, par « Modifier »',
    byPlace: 'Classer par pièce et par étagère',
    byPlaceDetail: 'Sinon, par titre',
    photos: 'Joindre les photographies des éditions précieuses',
    photosDetail: (value: number) =>
      value === 0
        ? 'Aucun ouvrage photographié ne porte l’étiquette « Édition originale » ou « Dédicacé ».'
        : `${count(value, 'photographie', 'photographies')} d’ouvrages portant l’étiquette « Édition originale » ou « Dédicacé »`,
    generate: 'Générer le PDF',
    generating: (done: number, total: number) => `Préparation de l’inventaire : ${formatNumber(done)} sur ${formatNumber(total)}…`,
    ready: (pages: number) => `Inventaire prêt · ${count(pages, 'page', 'pages')}`,
    save: 'Enregistrer le PDF',
    send: 'Envoyer le PDF',
    saved: (fileName: string) => `Fichier enregistré : ${fileName}`,
    failed: 'L’inventaire n’a pu être préparé.',
    note: 'Conservez-en une copie hors de votre domicile, par courriel ou sur votre Drive.',
    empty: 'Votre bibliothèque est vide : il n’y a encore rien à inventorier.',
    fileName: (isoDate: string) => `inventaire-bibliotheque-${isoDate}.pdf`,
  },

  /** Contents of the insurance PDF. */
  inventoryPdf: {
    title: 'Inventaire de ma bibliothèque',
    made: (date: string) => `Établi le ${date}`,
    totals: (books: number, copies: number) => `${count(books, 'ouvrage', 'ouvrages')} · ${count(copies, 'exemplaire', 'exemplaires')}`,
    value: (amount: string, priced: number, books: number) =>
      `Valeur d’achat déclarée : ${amount} (prix renseigné pour ${formatNumber(priced)} ${plural(priced, 'ouvrage', 'ouvrages')} sur ${formatNumber(books)})`,
    lost: (value: number) =>
      value === 1
        ? 'Un exemplaire déclaré perdu ne figure pas dans cet inventaire.'
        : `${formatNumber(value)} exemplaires déclarés perdus ne figurent pas dans cet inventaire.`,
    shelf: (name: string, value: number) => `${name} · ${count(value, 'ouvrage', 'ouvrages')}`,
    byTitle: 'Ouvrages classés par titre',
    copies: (value: number) => `${formatNumber(value)} exemplaires`,
    lentTo: (name: string) => `Prêté à ${name}`,
    isbn: (isbn: string) => `ISBN ${isbn}`,
    times: (value: number, price: string) => `${formatNumber(value)} × ${price}`,
    total: (amount: string) => `Valeur d’achat totale : ${amount}`,
    photos: 'Photographies des éditions précieuses',
    footer: (date: string) => `Ma bibliothèque · inventaire du ${date}`,
    page: (page: number, pages: number) => `Page ${formatNumber(page)} sur ${formatNumber(pages)}`,
  },

  pwa: {
    updateAvailable: 'Une nouvelle version de l’application est disponible.',
    update: 'Mettre à jour',
    postpone: 'Reporter',
    offlineReady: 'L’application est prête à fonctionner hors connexion.',
    dismiss: 'Fermer',
  },
} as const;
