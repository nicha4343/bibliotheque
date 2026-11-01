# Spécification fonctionnelle

Référence visuelle : la maquette interactive https://claude.ai/artifact/DK1VELndFEaoxytF6rRr2b (les numéros d'écran ci-dessous sont ceux de la maquette). Les textes cités sont les libellés exacts à reprendre ; ils respectent les règles de rédaction de [CLAUDE.md](../CLAUDE.md).

## Principe directeur

Le scan ne s'interrompt jamais. Toute opération lente (recherche, couverture, saisie) se fait en arrière-plan ou plus tard. Seule exception voulue : la fenêtre « Ouvrage déjà possédé ».

## Modèle de données

| Entité | Champs principaux |
|---|---|
| **Room** (pièce) | id, name, order |
| **Shelf** (étagère) | id, roomId, name, order, qrToken |
| **Book** (notice) | id, isbn13? (absent seulement pour un ouvrage sans code-barres complété à la main), isbn10?, title, authors[], publisher?, year?, language?, seriesName?, seriesIndex?, cover { source: `auto` \| `user`, url?, blobId?, provider? }, status (`toread` \| `read`), rating (0–5), review, tags[], createdAt, updatedAt |
| **Copy** (exemplaire) | id, bookId, shelfId, position? (si l'option d'ordre est active), addedAt, note? |
| **PendingItem** (à compléter) | id, kind (`unknownIsbn` \| `noBarcode`), isbn?, photoBlobId?, shelfId, sessionId, createdAt |
| **ScanSession** | id, shelfId, startedAt, endedAt, compteurs (scannés, ajoutés, à compléter, exemplaires supplémentaires) |
| **Loan** (prêt) — lot 4 | id, copyId, borrower, lentAt, dueAt, returnedAt? |
| **Wish** (souhait) — lot 5 | id, title, author?, isbn?, source (`series` \| `manual`) |
| **Quote** (citation) — lot 2 | id, bookId, text, photoBlobId?, createdAt |
| **MetadataCache** | isbn13, payload fusionné, fetchedAt |
| **Settings** | voir écran 7 |

Un livre (notice) peut avoir plusieurs exemplaires, chacun avec son propre emplacement.

## Règles transverses

- **ISBN** : accepter EAN-13 commençant par 978 ou 979 et ISBN-10 ; valider la clé de contrôle ; tout stocker en ISBN-13. Ignorer les autres codes-barres (prix, add-on à 5 chiffres).
- **Anti-double lecture** : un même code lu à moins de 2,5 s d'intervalle est ignoré.
- **Recherche des métadonnées** : Google Books, Open Library et BnF interrogées en parallèle, délai maximal 8 s ; la première réponse exploitable crée la notice, les suivantes complètent les champs vides. Résultat mis en cache. La BnF accepte l'appel direct depuis le navigateur (vérifié au lot 1, aucun relais nécessaire) ; elle est interrogée avec l'ISBN-13 et l'ISBN-10, les ouvrages antérieurs à 2007 n'y étant catalogués qu'en ISBN-10. Google Books, sans clé, épuise souvent son quota quotidien : l'application n'en dépend pas.
- **Hors connexion** : le code est conservé avec l'état « Recherche… » ; la recherche reprend au retour du réseau, même après la fermeture de l'application. Si l'option « Lecture hors connexion » est désactivée, un code lu sans réseau n'est pas enregistré et un bandeau le signale.
- **Ouvrage déjà possédé** : détecté dès la lecture, sans réseau. Si l'option « Signaler les ouvrages déjà possédés » est désactivée, un exemplaire supplémentaire est ajouté directement.
- **Zone de visée** : seuls les codes situés dans le cadre sont lus, pour ignorer ceux des ouvrages voisins.
- **Couverture** : recherchée automatiquement ; une photographie de l'utilisateur la remplace toujours et n'est jamais écrasée par une couverture automatique.

## Écrans

### 1 · Scan en rafale (version 1)
- Caméra toujours ouverte ; cadre de visée ; bouton lampe torche.
- En haut : pastille d'emplacement (« Salon · Étagère 2 ») qui ouvre le sélecteur ; compteurs « N scannés » et « N à compléter ».
- À chaque code reconnu : signal sonore, vibration (si disponible), bandeau d'état, ligne ajoutée en tête de « Cette session » avec l'état « Recherche… », puis « Ajouté » avec la couverture.
- ISBN inconnu : la ligne passe à « À compléter », l'élément part dans la boîte « À compléter » ; bandeau « ISBN inconnu : ouvrage mis de côté, la lecture se poursuit ».
- **Ouvrage déjà présent** (si l'option est active) : fenêtre « Ouvrage déjà possédé » avec couverture, titre, auteur, « Vous en possédez déjà N exemplaire(s) : » et la liste des emplacements ; boutons « Ajouter un Nᵉ exemplaire » (« Il sera rangé dans … ») et « Ne pas l'ajouter ». Le scan est suspendu tant que la fenêtre est ouverte. Aucune fermeture automatique.
- **Code QR d'étagère** : change l'emplacement courant ; bandeau « Code QR d'étagère reconnu : Bureau · Bandes dessinées ».
- « Annuler la dernière lecture » retire le dernier élément (et l'exemplaire ou l'élément à compléter créé).
- « Sans code-barres » : capture une image du flux vidéo (sans quitter l'écran) et crée un élément « Ouvrage sans code-barres » à compléter.
- « Terminer · N » ouvre le bilan.
- **Sélecteur d'emplacement** (« Où ranger ces ouvrages ? ») : pastilles de pièces + « Nouvelle pièce » (champ « Nom de la nouvelle pièce », bouton « Créer ») ; liste des étagères de la pièce choisie + « Nouvelle étagère » (nom par défaut « Étagère N », modifiable). Choisir une étagère ferme le sélecteur.

### 2 · Fin d'étagère (version 1)
- « Session terminée », nombre scanné, durée, emplacement ; trois compteurs (ajoutés, à compléter, exemplaire supplémentaire) ; derniers ajouts en vignettes.
- « Étagère suivante » : relance le scan sur l'étagère suivante de la même pièce (la crée si besoin).
- « Compléter les ouvrages mis de côté », « Consulter ma bibliothèque ».

### 3 · À compléter (version 1)
- Liste des éléments avec filtre « Tous / ISBN inconnu / Sans code-barres » et compteur.
- Carte : photographie ou icône, nature, ISBN éventuel ; actions « Photographier », « Corriger » ou « Saisir ».
- Suggestion de titre et d'auteur lue sur la couverture (« Relevé sur la couverture », bouton « Confirmer ») : **lot 6** (reconnaissance de texte).
- « Compléter en série · N » ouvre l'écran 4.

### 4 · Saisie en série (version 1)
- Un élément après l'autre, barre de progression « 1 sur N ».
- Photographie (ou bouton « Photographier la couverture » qui capture sans changer d'application), champs Titre, Auteur, Éditeur (facultatif), emplacement repris de la session.
- Boutons « Reporter » et « Enregistrer » (dernier : « Terminer ») ; écran final « Toutes les fiches sont complètes ».
- Pastilles de mots relevés sous chaque champ : **lot 6**.

### 5 · Ma bibliothèque (version 1)
- Recherche instantanée et locale (titre, auteur, ISBN), insensible aux accents.
- Filtre par pièce ou par étagère (liste déroulante groupée par pièce) ; filtres « Tous / À lire / Lus / Prêtés » (« Prêtés » au lot 4).
- Ligne : couverture, titre, auteur, emplacement du premier exemplaire, « N exemplaires » s'il y en a plusieurs, statut.
- Raccourcis Étagères, Séries, Prêts, Listes : affichés à mesure que les lots correspondants sont livrés.
- Barre de navigation : Bibliothèque, Scanner, À compléter (pastille), Paramètres.

### 6 · Fiche ouvrage (version 1 pour l'essentiel)
- Couverture et sa provenance (« Couverture automatique · Open Library », « Votre photographie · prioritaire »), titre, auteur, éditeur, ISBN.
- « Modifier la couverture » : « Prendre une photographie », « Choisir dans la galerie », « Autres couvertures disponibles », « Rétablir la couverture automatique ».
- Exemplaires : emplacement (lien vers l'étagère au lot 3), statut, « Ajouter un exemplaire », déplacement.
- Statut lu / à lire.
- Lot 2 : « Ma lecture » (note sur 5, « Mon avis »), « Étiquettes » (mots-clés libres, suggestions : Dédicacé, Édition originale, Cadeau, À donner, À relire, Abîmé, Format poche, Classique, plus celles déjà employées), « Citations » (photographier un passage).
- Lot 4 : bouton « Prêter » par exemplaire.

### 7 · Paramètres
- Version 1 : « Lors de la lecture des codes » (Signal sonore, Vibration, Signaler les ouvrages déjà possédés, Mémoriser l'ordre sur l'étagère — désactivé par défaut) ; « Couvertures automatiques » ; « Sources, interrogées simultanément » (BnF, Google Books, Open Library) ; « Lecture hors connexion » ; « Mes données » : Pièces et étagères, Étiquettes QR à imprimer, Exporter (CSV), Importer (CSV, y compris une exportation Libib).
- Lot 2 : « Sauvegarde automatique » sur Google Drive.
- Lot 5 : « Inventaire pour l'assurance (PDF) ».

### 8 · Vue étagère (lot 3)
- Tranches dans l'ordre de rangement (si l'option est active), position numérotée ; « Où se trouve … ? » met l'ouvrage en évidence avec sa position.
- « Vérifier cette étagère » : scan de l'étagère puis comparaison ; résultats « N ouvrages à leur place », « Introuvable » (actions « Il est rangé ailleurs », « Déclarer perdu »), « Mal rangé » (« Le ranger désormais ici », « Le remettre à sa place »), « Prêté » (absence attendue).
- « Imprimer le code QR de cette étagère ».

### 9 · Série et auteur (lot 5)
- Série reconnue par la source ou regroupée à la main ; « Vous en possédez N sur M » ; tomes possédés et manquants ; « Ajouter les tomes manquants à mes souhaits ».
- « Du même auteur » ; « Vos autres séries ».

### 10 · Prêts (lot 4)
- « Prêter un ouvrage » : scanner l'ouvrage, choisir l'emprunteur, la durée (2 semaines, 1 mois, 2 mois) ; rappel à l'échéance.
- Prêts groupés par emprunteur ; retards signalés ; « Adresser un rappel courtois » ; « Restitué » (ou nouveau scan de l'ouvrage) indique où le ranger ; historique.

### 11 · Listes (lot 5)
- **Souhaits** : liste partageable par lien (les proches voient la liste, pas la bibliothèque) ; « En librairie » : scanner un ouvrage pour savoir s'il est déjà possédé, souhaité ou absent.
- **Doublons** : ouvrages en plusieurs exemplaires, marque « À donner », export CSV.
- **Assurance** : inventaire PDF (couvertures, prix d'achat, classement par pièce et étagère, photographies des éditions précieuses).

## Questions ouvertes

- Reconnaissance de texte sur les couvertures (lot 6) : Tesseract.js (gratuit, approximatif) ou IA de vision (fiable, payante à l'usage).
- À décider par l'utilisateur : lecture par photographie de l'ISBN imprimé des livres anciens ; dictée du titre et de l'auteur.
