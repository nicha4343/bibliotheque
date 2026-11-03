# Feuille de route

Un lot à la fois. Cocher chaque case à la fin de l'étape ; un lot n'est terminé qu'après un essai sur un vrai téléphone. Le détail de chaque écran est dans [SPEC.md](SPEC.md).

**Lot en cours : 6 — Reconnaissance de texte** (lots 0 et 1 terminés le 1er novembre 2026, lot 2 le 2 novembre 2026, lots 3, 4 et 5 le 3 novembre 2026)

## Lot 0 — Socle
- [x] Projet Vite + TypeScript strict + Preact, ESLint, Vitest
- [x] PWA : manifeste, icônes, service worker (fonctionnement hors connexion)
- [x] Base IndexedDB (Dexie) avec le modèle de données de SPEC.md
- [x] Fichier unique des textes `src/textes/fr.ts`
- [x] Jetons de design (couleurs, polices, espacements) repris de la maquette ; barre de navigation
- [x] Déploiement HTTPS gratuit et ouverture sur le téléphone : https://nicha4343.github.io/bibliotheque/ ; essai validé sur Android le 1er novembre 2026 (installation, plein écran, mode avion, données protégées)
- [x] Section « Commandes » de CLAUDE.md complétée

## Lot 1 — Version 1 : scanner et retrouver
- [x] Lecture des codes (BarcodeDetector ou zxing-wasm) : EAN-13/ISBN et QR ; anti-double lecture ; validation ISBN (tests)
- [x] Recherche parallèle Google Books, Open Library, BnF ; fusion (tests) ; cache ; file d'attente hors connexion ; vérification CORS de la BnF (accès direct possible)
- [x] Écran 1 : scan en rafale, liste « Cette session », signal sonore, vibration, annulation
- [x] Fenêtre « Ouvrage déjà possédé » (réponse explicite obligatoire)
- [x] Pièces et étagères : sélecteur, création, renommage, suppression si vide ; codes QR d'étagère (lecture et impression des étiquettes)
- [x] Couvertures automatiques ; capture sur le flux vidéo ; galerie ; priorité à la photographie de l'utilisateur
- [x] « Sans code-barres » et boîte « À compléter » (écran 3), avec « Rechercher de nouveau »
- [x] Saisie en série (écran 4), sans reconnaissance de texte
- [x] Bilan de fin d'étagère (écran 2) et « Étagère suivante »
- [x] Bibliothèque (écran 5) : recherche, filtres statut, pièce, étagère
- [x] Fiche ouvrage (écran 6) : informations, couverture, exemplaires, statut lu / à lire
- [x] Paramètres (écran 7) de la version 1 : interrupteurs, clé Google Books, pièces et étagères, étiquettes QR, export et import CSV
- [x] Export CSV ; import CSV, y compris une exportation Libib : validé sur téléphone le 1er novembre 2026 avec l'exportation réelle de l'utilisateur (60 ouvrages et 63 exemplaires ajoutés, 5 déjà présents ignorés ; couvertures obtenues d'Amazon et Decitre, voir ci-dessous)
- [x] Relecture complète des textes (vouvoiement, français soutenu) : règles vérifiées par `fr.test.ts`, tournures harmonisées (« n’a pu »)
- [x] Essai réel : une étagère entière scannée sur téléphone, validé le 1er novembre 2026 (tout est bon)

### Reprise du lot 1 (1er novembre 2026)
- Lectures d'une session : table `scanEntries` (schéma version 2), qui sert aussi de file d'attente des recherches (`src/scan/session.ts`, `src/scan/lookups.ts`, lancée au démarrage dans `main.tsx`).
- Pièces et étagères : `src/places/places.ts` (création, renommage, suppression si vide, `indexPlaces` pour les libellés « Salon · Étagère 2 »).
- Composants réutilisables : `Sheet` (fenêtre en bas d'écran), `CoverImage` et `useBlobUrl`, `useCamera` et `captureFrame`/`compressImage` (`src/scan/camera.ts`) pour les photographies de l'écran 3, 4 et 6 ; styles partagés dans `src/styles/components.css`, écrans dans `src/styles/screens.css`.
- Couvertures après l'import Libib (1er novembre 2026) : aucune trouvée sur le téléphone, même après « Rechercher les couvertures manquantes » : Open Library, la BnF et Google Books n'en ont pas pour ces ouvrages des Éditions du Triomphe, alors que Libib en avait. Amazon (par ISBN-10) et Decitre (par EAN) ont les 63 couvertures (vérifié) : ajoutés en dernier recours, sur décision de l'utilisateur. Corrigés au passage : cache réservé aux recherches complètes, recherche après import ralentie, bilan des ouvrages non examinés. Validé sur téléphone le 1er novembre 2026 : les couvertures sont trouvées.
- Export et import CSV : `src/csv/` (`csv.ts` lecture et écriture, `export.ts`, `read.ts` reconnaissance des formats et conversion, testés ; `import.ts` écriture en base, `enrich.ts` recherche des couvertures en arrière-plan) ; écran `ImportScreen` (`#/importer`) ; `findOrCreateShelf` dans `places.ts`.
- Pièces et étagères (`PlacesScreen`, `#/pieces`) et étiquettes (`LabelsScreen`, `#/etiquettes`, impression par le navigateur, code QR dessiné par `QrCode` avec `uqr` ; relecture vérifiée avec le lecteur de l'application).
- Bibliothèque et fiche : recherche et filtres dans `src/library/filter.ts` (testés) ; opérations de la fiche dans `src/books/books.ts` ; fenêtres réutilisables `ConfirmSheet` et `CameraSheet`.
- Boîte « À compléter » : `src/pending/pending.ts` (saisie, nouvelle recherche, photographie, retrait) ; prise de vue réutilisable `CameraSheet` ; clé Google Books vérifiée par `src/metadata/googleBooksKey.ts`, dont l'enregistrement relance la recherche des ISBN inconnus.
- Premier essai sur téléphone (1er novembre 2026) : lecture des codes réussie ; mais deux livres récents (Éditions du Triomphe, 2026) restent inconnus : absents de la BnF et d'Open Library, présents dans Google Books, qui refuse les appels sans clé (quota commun épuisé). Accepté par l'utilisateur : clé Google Books gratuite, créée par lui pas à pas, saisie dans les Paramètres (Amazon écarté : pas d'interface publique gratuite, lecture des pages interdite et bloquée). Clé créée par l'utilisateur le 1er novembre 2026, limitée à https://nicha4343.github.io/* et à la Books API, conservée par lui : ne jamais l'écrire dans le dépôt (public) ; prévoir un champ « Clé Google Books » dans les Paramètres (stockée dans IndexedDB, ajoutée en `&key=` aux requêtes Google Books) ; prévoir aussi « Rechercher de nouveau » sur les ISBN inconnus de l'écran 3. Croix de suppression par ligne de « Cette session » ajoutée à sa demande.
- Clé Google Books saisie dans les Paramètres et validée sur téléphone le 1er novembre 2026 : les ISBN jusque-là inconnus sont trouvés.

## Lot 2 — Lecture et sauvegarde
- [x] Note sur 5 et avis (« Ma lecture », avec le statut de lecture)
- [x] Étiquettes libres avec suggestions ; recherche de la bibliothèque par étiquette
- [x] Citations photographiées ou saisies
- [x] Sauvegarde automatique sur Google Drive (`src/backup/`, écran `BackupScreen`, table `backup` du schéma version 3) : client Google « Application Web » créé par l'utilisateur le 2 novembre 2026 dans le projet « Ma bibliotheque » (application publiée « En production », autorisation `drive.appdata` non sensible, page de confidentialité `public/confidentialite.html` exigée par Google) ; connexion et première sauvegarde validées sur téléphone le 2 novembre 2026. Relecture de la sauvegarde avant restauration (date, nombre d'ouvrages) validée sur téléphone le 2 novembre 2026 ; la restauration complète n'a été essayée qu'avec un faux Drive.

### Reprise du lot 2 (1er novembre 2026)
- Fiche ouvrage : sections dans `src/books/` (`ReadingSection`, `TagsSection`, `QuotesSection`) ; logique dans `tags.ts` et `quotes.ts` (testées). Aucun changement de schéma : `rating`, `review`, `tags` et la table `quotes` existaient depuis la version 1.
- `CameraSheet` accepte un titre, une consigne et une taille maximale (1 920 pixels pour un passage).
- Note, avis, étiquettes et citations photographiées validés sur téléphone le 2 novembre 2026.
- Sauvegarde : `google.ts` (connexion par code d'autorisation avec PKCE, jeton de renouvellement, appels Drive), `snapshot.ts` (contenu, empreinte, restauration en une transaction), `backup.ts` (sauvegarde incrémentale des photographies, déclenchements automatiques lancés par `startBackups` dans `main.tsx`, restauration). Choix : client « Application Web » avec code secret saisi par l'utilisateur (Google l'exige même avec PKCE) plutôt que le jeton d'une heure de Google Identity Services, qui aurait obligé à une nouvelle connexion à chaque usage. CORS vérifié le 1er novembre 2026 sur `oauth2.googleapis.com/token` et l'API Drive.

## Lot 3 — Étagères
- [x] Option « Mémoriser l'ordre sur l'étagère » (Paramètres ; position relevée au scan, de gauche à droite)
- [x] Vue étagère (écran 8) et « Où se trouve … ? » ; raccourci « Étagères » de la bibliothèque ; étiquette QR lue par l'appareil photo du téléphone
- [x] Vérification d'étagère : scan dédié, bilan et réponses, « Déclarer perdu »
- [x] Essai sur téléphone : ordre relevé au scan et visible sur la vue étagère, ISBN inconnus retrouvés ; validé le 3 novembre 2026 (« c'est tout bon »)

### Reprise du lot 3 (2 novembre 2026)
- Schéma version 4 : table `shelfChecks` ; `Copy.position` (clé de tri : heure de la lecture, renumérotée par une vérification) et `Copy.lostAt`, `ScanEntry.position`, `PendingItem.position`, non indexés.
- Logique pure, testée (`src/shelves/shelves.test.ts`) : `src/shelves/order.ts` (tri, positions après une vérification) et `src/shelves/check.ts` (comparaison, puis enregistrement : ouverture, lectures, fin, réponses).
- Écrans : `ShelvesScreen` (`#/etageres`), `ShelfScreen` (`#/etagere/<identifiant ou jeton>[/<exemplaire>]`), `ShelfCheckScreen` (`#/verifier/<étagère>`) ; viseur commun au scan et à la vérification (`src/scan/Viewfinder.tsx`) ; fiche ouvrage : lien de l'emplacement, position, « Déplacer » et « Retrouvé ».
- Vérifié dans le navigateur de l'ordinateur avec des lectures simulées (pas de caméra) : ordre, « Où se trouve … ? », bilan et chacune des réponses.
- Premier essai sur téléphone (2 novembre 2026) : presque tous les ouvrages de l'étagère déclarés « ISBN inconnu ». Cause probable : la BnF et Open Library ne les connaissent pas et Google Books, seul à les connaître, n'a pas répondu ; un ISBN était alors déclaré inconnu dès la première recherche incomplète. Corrigé : trois recherches espacées de trente secondes avant « À compléter », et bouton « Rechercher de nouveau les N ISBN inconnus » dans « À compléter » pour récupérer ceux de l'essai (leur position est conservée). Deuxième essai : retrouvés, mais après trois appuis sur « Rechercher de nouveau » : Google Books refusait encore. Corrigé : ses requêtes sont espacées d'une seconde et redemandées deux fois après un refus, dans la même recherche. Validé sur téléphone le 3 novembre 2026.
- Proposé à l'utilisateur, sans réponse : filtre de la bibliothèque sur une étagère classé dans l'ordre de rangement quand l'option est active (aujourd'hui toujours par titre).

## Lot 4 — Prêts
- [x] Prêter en scannant, emprunteurs, durées, rappels (écran 10) ; rappel à l'échéance dans l'application
- [x] Rappels en option (décision du 3 novembre 2026 : les deux, le rappel dans l'application dans tous les cas) : notification du téléphone, ajout à l'agenda
- [x] Restitution par bouton ou par nouveau scan ; historique
- [x] Filtre « Prêtés » et bouton « Prêter » sur la fiche
- [x] Essai sur téléphone, validé le 3 novembre 2026 (« lot 4 validé sur téléphone ») : prêter en scannant, restituer par le scan « Restituer un ouvrage », et auparavant : ouverture hors connexion après la mise à jour (nouveau service worker), notification d'essai à l'activation de « Notification à l'échéance », ouverture de Google Agenda à la bonne date lors d'un prêt

### Reprise du lot 4 (3 novembre 2026)
- Aucune nouvelle version du schéma : la table `loans` existe depuis la version 1 (`returnedAt` non indexé). La sauvegarde Google Drive passe au format 2 (prêts compris ; le format 1 se restaure sans prêts).
- Logique pure, testée (`src/loans/loans.test.ts`) : `src/loans/loans.ts` (échéance, état d'un prêt, emprunteurs connus, prêt, restitution et annulation, sens d'une lecture du scan des prêts, regroupement par emprunteur, historique). Retirer un exemplaire ou supprimer une fiche efface ses prêts (`books.ts`).
- Composants : `LendSheet` (emprunteur et durée, depuis le scan ou la fiche), `CourtesySheet` (message modifiable, partage du téléphone ou copie). Écrans : `LoansScreen` et `LoanHistoryScreen` (`#/prets`, `#/prets/historique`), `LendScanScreen` (`#/preter`). Bibliothèque : filtre « Prêtés », raccourci « Prêts » avec pastille ; fiche : « Prêter » et « Restitué » sous chaque exemplaire ; fenêtre « Ouvrage déjà possédé » : « · prêté à … ».
- Rappels : service worker propre (`src/sw/sw.ts`, Workbox en mode `injectManifest`, même cache qu'avant ; `tsconfig.sw.json`), qui lit la base sans Dexie (`src/sw/reminders.ts`) ; côté page, `src/loans/reminders.ts` (activation, `refreshLoanNotifications` au démarrage) ; dates pures dans `src/loans/dates.ts` (aussi employées par le service worker). Champs `Loan.notifiedAt` et `Loan.seenAt`, non indexés ; paramètres `loanNotifications` et `loanCalendar`. Vérifié avec `npm run preview` : service worker actif, 19 fichiers en cache, rappel de la bibliothèque, liens d'agenda ; la notification elle-même n'a pu l'être (refusée par le navigateur de l'ordinateur).
- Retours de l'essai sur téléphone (3 novembre 2026), corrigés : le bouton « Prêter un ouvrage » ne disait pas qu'il servait aussi à la restitution (ajout de « Restituer un ouvrage », scan `#/restituer` réservé aux retours) ; avec un titre long, la confirmation dépassait de l'écran (la liste du scan élargissait la page : largeur de l'application bornée dans `app.css`, bannière du scan sur deux lignes).
- Vérifié dans le navigateur de l'ordinateur avec une caméra et un lecteur de codes simulés : prêt, restitution par scan, choix entre restitution et second exemplaire, lectures répétées sans effet, annulations, rappel courtois (sans partage sur l'ordinateur : « Copier le message » seul).

## Lot 5 — Séries et listes
- [x] Séries et tomes manquants ; page auteur (écran 9)
- [x] Liste de souhaits partageable ; vérification en librairie (écran 11)
- [x] Doublons à donner
- [x] Inventaire PDF pour l'assurance
- [x] Nombre de tomes parus et titre des tomes manquants d'après la BnF (demande de l'utilisateur du 3 novembre 2026) ; correction de la lecture des réponses de la BnF ; séries des ouvrages déjà catalogués
- [x] Essai sur téléphone, validé le 3 novembre 2026 (« lot 5 validé ») : séries (dont « Nombre de tomes parus, d'après la BnF »), page auteur, souhaits et lien partagé ouvert sur un autre téléphone, « En librairie », doublons, PDF enregistré et envoyé

### Reprise du lot 5 (3 novembre 2026)
- Schéma version 5 : table `series` (nombre de tomes déclaré) ; `Book.price`, champs de `Wish` (`source` élargie, `seriesName`, `seriesIndex`, `createdAt`) non indexés ; paramètre `wishListName`. Sauvegarde Google Drive au format 3 (souhaits et séries ; les formats 1 et 2 se restaurent sans eux). Export et import CSV : colonne « Prix d'achat », `price` de Libib.
- Logique pure, testée : `src/series/series.ts` (série lue dans le titre, regroupement, tomes manquants, auteurs), `src/series/authorWorks.ts` (Open Library), `src/wishes/` (`wishes.ts` souhaits et souhaits réalisés, `share.ts` liste compressée dans le lien, `bookshop.ts` vérification en librairie), `src/lists/duplicates.ts`, `src/insurance/inventory.ts` (contenu de l'inventaire, caractères des polices du PDF).
- Écrans : `SeriesScreen` (`#/series[/<nom>]`), `AuthorScreen` (`#/auteur/<nom>`), `ListsScreen` (`#/listes/<onglet>`, onglets dans `src/lists/`), `BookshopScreen` (`#/librairie`), `SharedListScreen` (`#/souhaits/<liste>`, plein écran). Fiche : liens auteur et série, champs Série, Tome, Prix d'achat. Bibliothèque : raccourcis « Séries » et « Listes ». Paramètres : « Inventaire pour l'assurance (PDF) ».
- PDF : `src/insurance/pdf.ts` avec pdf-lib (nouvelle dépendance, chargée seulement à la génération et mise en cache pour le hors-connexion) ; images réduites en JPEG par `src/insurance/images.ts`.
- « Retour » : `BackLink` (`src/components/BackLink.tsx`) revient à l'écran précédent de l'application, la profondeur étant notée dans l'historique (`startHistoryTracking` dans `router.ts`) ; employé par les nouveaux écrans et la fiche ouvrage.
- Vérifié dans le navigateur de l'ordinateur, avec des données d'essai et une caméra et un lecteur simulés : séries (grille, souhaits d'un toucher, nombre de tomes parus), page auteur (Open Library), souhaits, lien partagé relu, liens altérés, « En librairie » (possédé, souhaité, absent et titre trouvé en ligne, souhait ajouté), doublons et « À donner », PDF de trois pages avec couvertures et photographie ; fiche : série retirée, prix saisi « 14,95 € ». Non vérifiés : le partage du téléphone (« Partager le lien », « Envoyer le PDF »), absent de l'ordinateur.
- Retour de l'utilisateur (3 novembre 2026) sur le nombre de tomes, laissé à sa saisie : « ça doit pouvoir se trouver ». La BnF relie chaque tome à la notice de sa série et liste ces notices (index `ens2bib`) : `src/series/catalog.ts` (testé sur deux réponses réelles enregistrées dans `src/series/fixtures/`), `SeriesRecord.catalog`, recherche à l'ouverture d'une série (`refreshCatalog`) et de « Séries » (`refreshCatalogs`). En l'étudiant : les réponses de la BnF étaient ignorées depuis le lot 1 (`format="UNIMARC"` en majuscules), donc ses séries et ses notices perdues ; corrigé (`unimarcRecords`), et rattrapage une fois par ouvrage des séries des ouvrages déjà catalogués (`src/series/completion.ts`, lancé au démarrage, `Book.seriesCheckedAt`). Vérifié dans le navigateur de l'ordinateur avec la vraie BnF : deux Pat'Apouf sans série la reçoivent, « Vous en possédez 2 sur 19 », titres des 17 tomes manquants, souhaits avec titre et ISBN, tome manquant reconnu en librairie sans réseau. Google Books donne aussi des séries (`seriesInfo`), mais il refuse les appels sans clé depuis l'ordinateur : non employé.

## Lot 6 — Reconnaissance de texte
- [x] Choix de la technique : **Tesseract.js** (décision de l'utilisateur du 3 novembre 2026 : gratuit, dans le téléphone, hors connexion compris). IA de vision payante écartée.
- [x] Suggestions titre et auteur lues sur la couverture dans « À compléter » et pastilles dans la saisie en série : faites, puis **retirées** le 3 novembre 2026 (essai sur téléphone : « ça ne reconnaît absolument rien »)
- [x] « Sans code-barres » : vraie prise de vue de la couverture pendant le scan (demande de l'utilisateur du 3 novembre 2026)
- [x] **Dictée du titre et de l'auteur, puis recherche dans les catalogues** (écran 4), choisie par l'utilisateur le 3 novembre 2026 parmi trois solutions gratuites (IA Gemini gratuite, dictée, lecteur de texte expérimental de Chrome)
- [x] Texte des passages photographiés (« Citations » de la fiche) par Tesseract.js, prévu au lot 6 par la spécification
- [ ] Essai sur téléphone : « Sans code-barres » (cadrage), dictée et choix d'une édition dans « Compléter en série » (livres anciens et récents), saisie au clavier dans la recherche, passage photographié dans « Citations »

### Reprise du lot 6 (3 novembre 2026)
- Prise de vue de la couverture pendant le scan : `shooting` dans `ScanScreen` (lecture des codes suspendue), cadre `scan__aim--cover` du `Viewfinder`, partie cadrée découpée par `aimAreaInVideo` (`src/scan/reads.ts`, testée) et `captureFrame(…, region)` ; 1 600 pixels au plus. Vérifié avec une caméra simulée.
- Dictée : `src/components/useDictation.ts` (reconnaissance vocale du navigateur, `fr-FR`, une phrase, transcription en cours affichée, erreurs : micro refusé, réseau, silence). Recherche : `src/metadata/titleSearch.ts` (adresses, lecture des réponses des trois sources, ordre et doublons, testés sur de vraies réponses de la BnF et d'Open Library à « lotus bleu hergé » enregistrées dans `src/metadata/fixtures/search/`) ; `googleBooksVolume` et `bnfRecord` extraits de `sources.ts`, `waitGoogleBooksTurn` de `search.ts` (même rythme pour Google Books que les recherches par ISBN). Écran : `src/pending/EditionSearch.tsx`, dans `EntryScreen`.
- Tesseract.js pour les citations seulement : `src/ocr/engine.ts` (Tesseract.js 7 chargé à la demande, un seul worker, libéré trente secondes après la dernière lecture ; niveaux de gris, agrandissement), `src/ocr/passage.ts` (lignes jointes, mots coupés recollés, testé), `src/ocr/reading.ts` (`readPassage`). Fichiers servis sous `ocr/` (greffon `ocrFiles` de `vite.config.ts`) et mis en cache par le service worker (limite portée à 5 Mo) : Tesseract.js 7 ne sait pas recevoir le modèle directement, d'où un dossier et des noms fixes.
- Lecture des couvertures retirée (`src/ocr/cover.ts`, `names.ts`, file d'attente, carte « Relevé sur la couverture », pastilles) : sur des couvertures d'Amazon, elle lisait Tintin, Camus ou Flaubert, mais rien sur les photographies du téléphone. Le champ `PendingItem.reading`, non indexé, n'est plus écrit ; celui que la version précédente a pu laisser sur le téléphone est sans effet.
- Essai sur téléphone (3 novembre 2026) : « ça ne fonctionne pas », sans demande d'autorisation du micro. Cause inconnue (pas de message rapporté) ; corrigé à l'aveugle : le micro est demandé par `getUserMedia` avant la reconnaissance, une reconnaissance qui n'entend pas le micro dans les six secondes est arrêtée, le code d'erreur du navigateur est affiché (`service-not-allowed` n'est plus pris pour un refus du micro), et le micro du clavier est indiqué en secours. Vérifié avec des simulations : dictée normale, service refusé, aucune réponse, micro refusé.
- Vérifié dans le navigateur de l'ordinateur avec une dictée simulée et les vrais catalogues : « le lotus bleu Hergé » donne en tête « Le lotus bleu · Hergé · Casterman » (Open Library) et « Le Lotus bleu · Éd. Moulinsart » (BnF) ; fiche remplie d'un toucher ; rien de trouvé (mots placés dans le titre) ; micro refusé. Google Books n'a pu être essayé (il refuse les appels sans clé depuis l'ordinateur). Non vérifiés : la vraie reconnaissance vocale du téléphone.

## Lot 7 — Améliorations demandées
- [ ] Champ de recherche dans « Séries » (`#/series`), demandé par l'utilisateur le 3 novembre 2026 : retrouver une série par son nom ou celui de son auteur, recherche instantanée et locale, insensible aux accents, comme celle de la bibliothèque (écran 5)
- [ ] Essai sur téléphone

## Plus tard
- Synchronisation entre appareils (piste : Google Drive ; même mécanisme que l'écriture à plusieurs dans un lieu partagé)
- Photographie d'une étagère entière : lecture des tranches par IA
- Lieux partagés en famille (décisions du 1er novembre 2026, détail dans SPEC.md, « Lieux partagés en famille »), dans cet ordre :
  - niveau « Lieu » au-dessus des pièces, utile sans partage ;
  - séparation de « Lu », de la note et de l'avis, propres à chaque personne (nouvelle version du schéma) ;
  - partage d'un lieu en consultation avec plusieurs personnes (Google Drive, après la sauvegarde du lot 2) ;
  - ajout et déplacement d'exemplaires par les invités, seulement si cela reste simple.

## À décider par l'utilisateur
- Lecture par photographie de l'ISBN imprimé des livres anciens
