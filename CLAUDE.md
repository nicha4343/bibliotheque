# Ma Bibliothèque — catalogue de livres par scan

Application web installable sur téléphone (PWA) pour cataloguer une bibliothèque personnelle en scannant les codes-barres des livres **en rafale**, sans jamais interrompre le scan. Elle est née des défauts de Libib : recherche lente après chaque scan, clic obligatoire entre deux livres, saisie manuelle qui coupe la série, photo de couverture défaillante.

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
- **Données locales** dans IndexedDB via Dexie ; photographies stockées en Blob JPEG compressé. Sauvegarde : export/import CSV, puis Google Drive (lot 2).
- **Lecture des codes** : API native `BarcodeDetector` quand elle existe, sinon la bibliothèque `barcode-detector` (fondée sur zxing-wasm). Formats : EAN-13 (ISBN 978/979) et QR (étagères).
- **Métadonnées**, interrogées **en parallèle** (la première réponse complète l'emporte, les autres complètent les champs vides) : Google Books, Open Library, BnF (SRU). Mise en cache locale. L'appel direct à la BnF depuis le navigateur (CORS) **reste à vérifier** ; à défaut, petit relais gratuit (Cloudflare Worker).
- **Couvertures** : Open Library Covers, Google Books ; photographie prise sur le flux vidéo du scan lui-même (pas de sélecteur de fichier pour la prise de vue).
- Signal sonore via Web Audio ; vibration via `navigator.vibrate` (absente sur iPhone : ne pas en dépendre).

## Conventions de code

- Code, noms de variables et commentaires techniques en anglais ; textes visibles en français (voir ci-dessus).
- Design repris de la maquette : couleurs `#0F766E` (accent), `#B45309` (à compléter), `#15171C` (texte), `#F4F5F7` (fond) ; polices DM Sans et JetBrains Mono (ISBN) ; zones tactiles d'au moins 44 px ; contraste AA.
- Accessibilité : vrais `<button>`, `<a>`, `<label>` ; `aria-label` sur les boutons à icône seule.
- Tests unitaires (Vitest) pour la logique pure : normalisation et validation des ISBN, fusion des métadonnées, import CSV.

## Commandes

À compléter lors du lot 0 (installation du socle) : lancement en développement, construction, tests, déploiement.

## Méthode de travail

1. Lire [docs/ROADMAP.md](docs/ROADMAP.md) et ne traiter qu'**un lot à la fois**.
2. Respecter [docs/SPEC.md](docs/SPEC.md) ; si une décision change, mettre la spécification à jour dans le même commit.
3. Cocher l'avancement dans la feuille de route à la fin de chaque étape.
4. Faire tester chaque lot sur un vrai téléphone avant de passer au suivant.
5. Échanges avec l'utilisateur : en français, ton direct, tutoiement réciproque. L'utilisateur n'est pas développeur : expliquer simplement.
