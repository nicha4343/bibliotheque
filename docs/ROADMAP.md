# Feuille de route

Un lot à la fois. Cocher chaque case à la fin de l'étape ; un lot n'est terminé qu'après un essai sur un vrai téléphone. Le détail de chaque écran est dans [SPEC.md](SPEC.md).

**Lot en cours : 2 — Lecture et sauvegarde** (lot 0 et lot 1 terminés le 1er novembre 2026)

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
- [ ] Sauvegarde automatique sur Google Drive (nécessite la création d'un identifiant Google par l'utilisateur, à guider pas à pas) : code écrit et testé avec un faux Drive (`src/backup/`, écran `BackupScreen`, table `backup` du schéma version 3) ; reste la création du client Google par l'utilisateur, puis l'essai sur téléphone (connexion, sauvegarde, restauration)

### Reprise du lot 2 (1er novembre 2026)
- Fiche ouvrage : sections dans `src/books/` (`ReadingSection`, `TagsSection`, `QuotesSection`) ; logique dans `tags.ts` et `quotes.ts` (testées). Aucun changement de schéma : `rating`, `review`, `tags` et la table `quotes` existaient depuis la version 1.
- `CameraSheet` accepte un titre, une consigne et une taille maximale (1 920 pixels pour un passage).
- Vérifié dans le navigateur ; reste à essayer sur téléphone, avec la sauvegarde Google Drive.
- Sauvegarde : `google.ts` (connexion par code d'autorisation avec PKCE, jeton de renouvellement, appels Drive), `snapshot.ts` (contenu, empreinte, restauration en une transaction), `backup.ts` (sauvegarde incrémentale des photographies, déclenchements automatiques lancés par `startBackups` dans `main.tsx`, restauration). Choix : client « Application Web » avec code secret saisi par l'utilisateur (Google l'exige même avec PKCE) plutôt que le jeton d'une heure de Google Identity Services, qui aurait obligé à une nouvelle connexion à chaque usage. CORS vérifié le 1er novembre 2026 sur `oauth2.googleapis.com/token` et l'API Drive.

## Lot 3 — Étagères
- [ ] Option « Mémoriser l'ordre sur l'étagère »
- [ ] Vue étagère (écran 8) et « Où se trouve … ? »
- [ ] Vérification d'étagère

## Lot 4 — Prêts
- [ ] Prêter en scannant, emprunteurs, durées, rappels (écran 10)
- [ ] Restitution par bouton ou par nouveau scan ; historique
- [ ] Filtre « Prêtés » et bouton « Prêter » sur la fiche

## Lot 5 — Séries et listes
- [ ] Séries et tomes manquants ; page auteur (écran 9)
- [ ] Liste de souhaits partageable ; vérification en librairie (écran 11)
- [ ] Doublons à donner
- [ ] Inventaire PDF pour l'assurance

## Lot 6 — Reconnaissance de texte
- [ ] Choix de la technique (Tesseract.js gratuit ou IA de vision payante) avec l'utilisateur
- [ ] Suggestions titre et auteur dans « À compléter » et pastilles dans la saisie en série

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
- Dictée du titre et de l'auteur
