# Ma Bibliothèque — catalogue de livres par scan

Application web installable sur téléphone (PWA) pour cataloguer une bibliothèque personnelle en scannant les codes-barres des livres **en rafale**, sans jamais interrompre le scan. Elle est née des défauts de Libib : recherche lente après chaque scan, clic obligatoire entre deux livres, saisie manuelle qui coupe la série, photo de couverture défaillante.

- **Application en ligne** : https://nicha4343.github.io/bibliotheque/ (dépôt public https://github.com/nicha4343/bibliotheque).
- **Maquette interactive validée** (11 écrans) : https://claude.ai/artifact/DK1VELndFEaoxytF6rRr2b
- **Spécification détaillée** : [docs/SPEC.md](docs/SPEC.md) — à relire avant de toucher à un écran.
- **Feuille de route et avancement** : [docs/ROADMAP.md](docs/ROADMAP.md) — indique le lot en cours.

## Règles impératives

### Textes de l'interface
- **Vouvoiement** partout ; jamais de tutoiement. Les intitulés à la première personne (« Ma bibliothèque », « Mes souhaits », « Mon avis ») sont admis.
- **Français soutenu** partout : pas d'abréviations familières, pas de « on », pas de points d'exclamation, mois écrits en entier (« 1er octobre », jamais « 1 oct. »), typographie française (espace insécable avant « : ; ? », guillemets « », apostrophe ’).
- Vocabulaire retenu :

| Employer | Ne pas employer |
|---|---|
| ouvrage (dans les phrases), livre (libellés courts) | bouquin |
| application | appli |
| démonstration | démo |
| photographie (« Photographier » pour le verbe) | photo |
| bandes dessinées | BD |
| Paramètres | Réglages |
| Souhaits, liste de souhaits | Envies |
| Restitué | Rendu |
| Reporter | Passer, Plus tard |
| exemplaire(s) | ex. |
| scanner, scanné (admis) | — |

- Tous les textes de l'interface sont regroupés dans un seul fichier (`src/textes/fr.ts`), jamais écrits en dur dans les composants, pour pouvoir les relire d'un bloc.

### Décisions de l'utilisateur à ne pas remettre en cause
- Ouvrage déjà présent : une fenêtre demande s'il faut ajouter un exemplaire. Elle **attend une réponse explicite** : pas de fermeture automatique, pas d'ajout par nouveau scan.
- La photographie de l'utilisateur est **toujours prioritaire** sur la couverture automatique.
- L'ordre des livres sur l'étagère est une **option**, désactivée par défaut.
- Refusés : statistiques de lecture, « Que lire ensuite ? ».

## Choix techniques

- **PWA statique**, sans serveur pour la version 1. Hébergement gratuit en HTTPS (GitHub Pages, Netlify ou Cloudflare Pages) : la caméra exige HTTPS.
- **Vite + TypeScript (strict) + Preact.**
- **Données locales** dans IndexedDB via Dexie ; photographies stockées en Blob JPEG compressé. Sauvegarde : export/import CSV ; Google Drive (lot 2), dans le dossier caché réservé à l'application, par un client OAuth que l'utilisateur a créé (identifiant et code secret saisis dans l'application, jamais dans le dépôt).
- **Lecture des codes** : API native `BarcodeDetector` quand elle existe, sinon la bibliothèque `barcode-detector` (fondée sur zxing-wasm). Formats : EAN-13 (ISBN 978/979) et QR (étagères).
- **Métadonnées**, interrogées **en parallèle** (la première réponse complète l'emporte, les autres complètent les champs vides) : Google Books, Open Library, BnF (SRU). Mise en cache locale. La BnF accepte l'appel direct depuis le navigateur (CORS vérifié au lot 1) : aucun relais nécessaire.
- **Couvertures** : Open Library Covers, Google Books ; en dernier recours, les libraires Amazon (par ISBN-10, image enregistrée) puis Decitre (par EAN, affichée par lien, en ligne seulement) — adresses non officielles, choisies par l'utilisateur le 1er novembre 2026 parce qu'elles seules ont les couvertures des ouvrages récents des petits éditeurs ; photographie prise sur le flux vidéo du scan lui-même (pas de sélecteur de fichier pour la prise de vue).
- Signal sonore via Web Audio ; vibration via `navigator.vibrate` (absente sur iPhone : ne pas en dépendre).
- **Lot 6** : couvertures photographiées lues par **Mistral** (mode gratuit de Mistral AI Studio, `src/metadata/mistral.ts`, file d'attente `src/pending/coverReading.ts`, jamais pendant un scan), avec la clé que l'utilisateur a créée et saisie dans les Paramètres (jamais dans le dépôt) ; titre et auteur aussi dictés (reconnaissance vocale du navigateur, qui ne démarre pas sur le téléphone de l'utilisateur) ou saisis, puis cherchés dans Google Books, la BnF et Open Library (`titleSearch.ts`). Tesseract.js, abandonné pour les couvertures (rien de lu sur les photographies du téléphone), demeure pour le texte des citations photographiées, dans un Web Worker ; ses trois fichiers (worker, moteur WebAssembly SIMD, modèle `fra` « best_int ») sont copiés de `node_modules` vers `ocr/` par le greffon `ocrFiles` de `vite.config.ts` et mis en cache par le service worker, jamais chargés d'un CDN.
- **Lot 5** : autres ouvrages d'un auteur par la recherche d'Open Library (éditions françaises, en ligne) ; liste de souhaits partagée sans serveur, compressée dans le lien après le « # » ; inventaire PDF fabriqué sur le téléphone par pdf-lib (chargé à la demande ; polices standard du PDF, d'où `toWinAnsi` pour les caractères qu'elles ignorent).

## Conventions de code

- Code, noms de variables et commentaires techniques en anglais ; textes visibles en français (voir ci-dessus).
- Design repris de la maquette : couleurs `#0F766E` (accent), `#B45309` (à compléter), `#15171C` (texte), `#F4F5F7` (fond) ; polices DM Sans et JetBrains Mono (ISBN) ; zones tactiles d'au moins 44 px ; contraste AA.
- Accessibilité : vrais `<button>`, `<a>`, `<label>` ; `aria-label` sur les boutons à icône seule.
- Tests unitaires (Vitest) pour la logique pure : normalisation et validation des ISBN, fusion des métadonnées, import CSV.

## Commandes

Node 24. Installer les dépendances une fois : `npm install`.

| Commande | Rôle |
|---|---|
| `npm run dev` | Développement local sur http://localhost:5173 (sans service worker) |
| `npm run build` | Vérification des types puis construction dans `dist/` |
| `npm run preview` | Aperçu de la construction sur http://localhost:4173, service worker actif (hors connexion, mises à jour) |
| `npm test` | Tests unitaires (Vitest) |
| `npm run lint` | ESLint ; refuse tout texte visible écrit en dur dans un composant |
| `npm run check` | Lint, tests et construction : à lancer avant chaque commit |
| `npm run texts:fix` | Pose espaces insécables, apostrophes ’ et points de suspension dans `src/textes/fr.ts` |
| `npm run icons` | Régénère les icônes PNG de `public/` à partir de `public/icon.svg` |

**Déploiement** : automatique à chaque push sur `main` (GitHub Actions, `.github/workflows/deploy.yml`) vers GitHub Pages, https://nicha4343.github.io/bibliotheque/ ; l'application est publiée si le lint, les tests et la construction réussissent (deux minutes environ). Suivi : `gh run list`. Les commits portent l'adresse anonyme GitHub de l'utilisateur (dépôt public) : ne pas la remplacer.

### Points d'attention
- **Espaces insécables** : les outils d'édition ne savent pas toujours les saisir. Écrire les textes de `fr.ts` avec des espaces ordinaires, puis lancer `npm run texts:fix` ; le test `fr.test.ts` signale toute faute restante (typographie, tutoiement, vocabulaire proscrit).
- **Base IndexedDB** (`src/db/db.ts`) : ne jamais modifier une version publiée du schéma ; ajouter `this.version(N + 1)` avec les changements, sans quoi les données des téléphones seraient perdues ou illisibles.
- **Navigation** par ancre (`#/bibliotheque`, `#/scanner`, `#/a-completer`, `#/parametres`) : fonctionne sur tout hébergement statique et hors connexion. Base Vite relative (`./`). « Retour » (`BackLink`) revient à l'écran précédent de l'application grâce à la profondeur notée dans l'historique (`startHistoryTracking`).
- **Fins de ligne** : le dépôt est en LF, la copie de travail Windows en CRLF (`core.autocrlf`) ; un script de remplacement doit en tenir compte.
- **Service worker** : le nôtre, `src/sw/sw.ts` (Workbox, mode `injectManifest`, vérifié par `tsconfig.sw.json`) : cache hors connexion et rappels des prêts. Il lit la base sans Dexie (`src/sw/reminders.ts`) et ne doit jamais la créer ni la mettre à niveau. Absent en développement (`npm run dev`) : essayer avec `npm run preview`.
- **Mises à jour** : jamais de rechargement automatique (il interromprait un scan) ; un bandeau propose « Mettre à jour » ou « Reporter ».
- **Polices** embarquées (Fontsource), pas de Google Fonts : rendu identique hors connexion.
- TypeScript reste en 6.x et ESLint en 9.x tant que typescript-eslint et eslint-plugin-jsx-a11y ne prennent pas en charge TypeScript 7 et ESLint 10.

## Méthode de travail

1. Lire [docs/ROADMAP.md](docs/ROADMAP.md) et ne traiter qu'**un lot à la fois**.
2. Respecter [docs/SPEC.md](docs/SPEC.md) ; si une décision change, mettre la spécification à jour dans le même commit.
3. Cocher l'avancement dans la feuille de route à la fin de chaque étape.
4. Faire tester chaque lot sur un vrai téléphone avant de passer au suivant.
5. Échanges avec l'utilisateur : en français, ton direct, tutoiement réciproque. L'utilisateur n'est pas développeur : expliquer simplement.
