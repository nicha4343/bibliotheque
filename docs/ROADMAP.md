# Feuille de route

Un lot à la fois. Cocher chaque case à la fin de l'étape ; un lot n'est terminé qu'après un essai sur un vrai téléphone. Le détail de chaque écran est dans [SPEC.md](SPEC.md).

**Lot en cours : 1 — Version 1 : scanner et retrouver** (lot 0 terminé le 1er novembre 2026)

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
- [ ] Pièces et étagères : sélecteur, création, renommage ; codes QR d'étagère (lecture et impression des étiquettes) — fait : sélecteur, création, lecture des QR ; reste : renommage, impression
- [ ] Couvertures automatiques ; capture sur le flux vidéo ; galerie ; priorité à la photographie de l'utilisateur — fait : couvertures automatiques (conservées pour l'affichage hors connexion)
- [ ] « Sans code-barres » et boîte « À compléter » (écran 3)
- [ ] Saisie en série (écran 4), sans reconnaissance de texte
- [x] Bilan de fin d'étagère (écran 2) et « Étagère suivante »
- [ ] Bibliothèque (écran 5) : recherche, filtres statut, pièce, étagère
- [ ] Fiche ouvrage (écran 6) : informations, couverture, exemplaires, statut lu / à lire
- [ ] Paramètres (écran 7) de la version 1
- [ ] Export CSV ; import CSV, y compris une exportation Libib
- [ ] Relecture complète des textes (vouvoiement, français soutenu)
- [ ] Essai réel : une étagère entière scannée sur téléphone

### Reprise du lot 1 (1er novembre 2026)
- Lectures d'une session : table `scanEntries` (schéma version 2), qui sert aussi de file d'attente des recherches (`src/scan/session.ts`, `src/scan/lookups.ts`, lancée au démarrage dans `main.tsx`).
- Pièces et étagères : `src/places/places.ts` (création, renommage, suppression si vide, `indexPlaces` pour les libellés « Salon · Étagère 2 »).
- Composants réutilisables : `Sheet` (fenêtre en bas d'écran), `CoverImage` et `useBlobUrl`, `useCamera` et `captureFrame`/`compressImage` (`src/scan/camera.ts`) pour les photographies de l'écran 3, 4 et 6 ; styles partagés dans `src/styles/components.css`, écrans dans `src/styles/screens.css`.
- Routes prévues dans `src/router.ts` mais pas encore branchées dans `app.tsx` : `entry` (écran 4), `book` (écran 6), `places`, `labels`.
- Prochaines étapes, dans l'ordre : écran 3 et 4, bibliothèque et fiche, paramètres (avec pièces et étiquettes QR via `uqr`, déjà installé), CSV.

## Lot 2 — Lecture et sauvegarde
- [ ] Note sur 5 et avis
- [ ] Étiquettes libres avec suggestions
- [ ] Citations photographiées
- [ ] Sauvegarde automatique sur Google Drive (nécessite la création d'un identifiant Google par l'utilisateur, à guider pas à pas)

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
- Synchronisation entre appareils (piste : Google Drive)
- Photographie d'une étagère entière : lecture des tranches par IA
- Bibliothèque partagée en famille

## À décider par l'utilisateur
- Lecture par photographie de l'ISBN imprimé des livres anciens
- Dictée du titre et de l'auteur
