# Organigramme

Application d'organigramme d'entreprise, **100 % locale** : aucun appel réseau sortant, aucune télémétrie, aucun CDN.
Import Excel/CSV, vue par site, hiérarchie par glisser-déposer, export PDF, **données chiffrées par mot de passe**.
Fonctionne avec Docker **ou** en simple fichier HTML.

Auteur : [Florian Le Brenn](https://www.linkedin.com/in/florianlebrenn/) · Basée sur [org.chart](https://github.com/vinitshahdeo/org.chart) de Vinit Shahdeo · Licence MIT

Deux façons de l'utiliser, avec la même interface :

| | Mode serveur (Docker) | Mode autonome (fichier HTML) |
|---|---|---|
| Pour qui | un poste ou un serveur avec Docker | un PC d'entreprise verrouillé (sans Docker ni installation) |
| Lancement | `make up` → <http://localhost:8080> | double-clic sur `static/organigramme.html` |
| Données | base SQLite **chiffrée** dans le volume Docker `org-data` | **chiffrées** dans le navigateur de ce PC (IndexedDB) |
| Accès | mot de passe (déverrouillage) ; écoute sur `127.0.0.1` uniquement | mot de passe (déverrouillage) |
| PDF | généré par le serveur (A4 paysage, 1 page par site) | impression du navigateur → « Enregistrer au format PDF » |
| API + Swagger | <http://localhost:8080/api/docs> | — |

## Démarrer

Prérequis : Docker Desktop (et `make`, présent sur macOS et Linux).

```bash
git clone https://github.com/florianlebrenn/org-chart.git
cd org-chart
make up          # ou : docker compose up -d --build
```

Ouvrir <http://localhost:8080>. `make down` arrête (les données restent), `make help` liste toutes les commandes.

### Premier lancement : mot de passe et clé de secours

1. Choisissez un **mot de passe** (12 caractères minimum ; une phrase de passe est idéale). Il chiffre les données et sera
   demandé à chaque ouverture, après un redémarrage, et après **15 minutes d'inactivité**. Le bouton *Verrouiller* le fait à la demande.
2. Une **clé de secours** s'affiche **une seule fois** : imprimez-la ou rangez-la hors de l'ordinateur. Elle permet de
   choisir un nouveau mot de passe (*Mot de passe oublié ?*). **Sans mot de passe ni clé de secours, les données sont
   définitivement illisibles** : c'est le principe du chiffrement.
3. Onglet *Données* → *Sécurité* : changer le mot de passe, générer une nouvelle clé de secours.

Les données d'une version précédente (non chiffrées) sont chiffrées automatiquement lors de la création du mot de passe.

### Mode autonome (sans Docker)

`organigramme.html` est un fichier unique (≈ 380 Ko) qui contient toute l'application : rien à installer, pas besoin
de droits administrateur, ni de Docker, ni de connexion internet.

1. **Récupérer le fichier** : `static/organigramme.html` dans le dépôt, ou en pièce jointe de la dernière version
   (page *Releases* du dépôt GitHub). On peut le copier sur une clé USB, un autre PC ou un partage réseau.
2. **L'ouvrir** par double-clic, dans **Chrome ou Edge**. Sur SharePoint ou Teams, un `.html` est souvent téléchargé au
   lieu d'être affiché : l'ouvrir alors depuis le dossier *Téléchargements*.
3. **Choisir le mot de passe** et ranger la **clé de secours** (voir plus haut, c'est le même fonctionnement).
4. **Importer** le fichier Excel/CSV du personnel, puis utiliser l'organigramme normalement (voir *Utilisation*).
5. **Télécharger une sauvegarde** (onglet *Données*) après chaque mise à jour, et la ranger hors du navigateur.
6. Pour **changer de PC ou de navigateur**, ou passer au mode Docker : ouvrir le fichier sur le nouveau poste, créer un
   mot de passe, puis *Données* → *Restaurer* avec la sauvegarde (le mot de passe de la sauvegarde est demandé).

Bon à savoir :

- Les données sont enregistrées, **chiffrées**, dans le navigateur qui a ouvert le fichier, sur ce PC. Un autre PC, un
  autre navigateur ou une navigation privée repartent de zéro. Si l'historique du navigateur est effacé (« données de
  site », « cookies »), les données le sont aussi : d'où l'importance de la sauvegarde.
- Le PDF passe par l'impression du navigateur : bouton *Imprimer* (icône imprimante) au-dessus de l'organigramme, puis
  « Enregistrer au format PDF » (A4 paysage, une page par site).
- La page interdit elle-même toute connexion réseau (`connect-src 'none'`) et fonctionne hors ligne.
- Mettre à jour l'application = remplacer le fichier `.html` par la nouvelle version. Faire une sauvegarde juste avant :
  si les données n'apparaissent plus après le remplacement, il suffit de la restaurer.
- Reconstruire le fichier après une modification du code : `make static` (Docker), ou avec Node.js 22 :
  `cd frontend && npm ci && npm run build:static`, puis copier `frontend/dist-static/index.html` vers
  `static/organigramme.html`.

## Utilisation

1. **Importer** (onglet *Importer*) : déposer le fichier `.xlsx` ou `.csv`, puis vérifier les colonnes proposées (nom complet, ou prénom + nom ; fonction, site, email, téléphone, supérieur facultatif).
   **Vérifier l'import** montre ce qui va changer, puis **Confirmer l'import** l'enregistre.
   **Seules les colonnes choisies sont lues** : les autres colonnes du fichier (salaire, date de naissance, n° de sécurité sociale, commentaires…) ne sont ni importées, ni conservées, ni affichées. L'aperçu ne montre que les colonnes retenues et liste le nom des colonnes ignorées. En mode serveur, le fichier n'est gardé qu'en mémoire, jusqu'à la confirmation (30 min au plus).
2. **Organigramme** : un arbre par site.
   - Le filtre de site, la recherche (nom, fonction, téléphone, sans tenir compte des accents) et la vue *Liste*.
   - *Tout déplier / Tout replier*, le zoom (−, +, 100 %, *Ajuster*), et le déplacement en attrapant le fond.
3. **Hiérarchie** :
   - glisser une carte sur celle de son supérieur ; ou cliquer sur une carte, puis « Supérieur hiérarchique » → *Changer* ;
   - **Non rattachés** : les personnes sans supérieur. *Rattacher tous* les confie d'un coup au responsable du site (deviné d'après la fonction) ;
   - déposer une carte dans « Non rattachés » la retire de la hiérarchie ;
   - chaque changement peut être **annulé** depuis le message qui s'affiche, et une boucle (A sous B sous A) est refusée.
4. **Fiche** (clic sur une carte) : photo (redimensionnée dans le navigateur), fonction, site, email, téléphone, équipe directe.
5. **Exports** : PDF (A4 paysage, une page par site, ou le site affiché), impression, Mermaid (`.mmd`, à coller dans Mermaid Live).
6. **Données** : sauvegarde `.json` **chiffrée avec le mot de passe actuel** (tout, photos comprises), restauration
   (le mot de passe de la sauvegarde est demandé), effacement. Une sauvegarde permet aussi de passer d'un mode à l'autre.

### Réimport du fichier (mise à jour)

Chaque personne est reconnue par son **nom**, sans tenir compte des majuscules, des accents ni de l'ordre prénom/nom.

- Personne déjà présente : fonction, site et contact sont mis à jour, et **sa hiérarchie et sa photo sont conservées**.
- Nouvelle personne : elle arrive dans « Non rattachés ».
- Personne absente du fichier : elle est retirée, et ses subordonnés remontent dans « Non rattachés » (c'est signalé avant de confirmer).
- Si une colonne « supérieur » est choisie, c'est le fichier qui définit la hiérarchie.
- Homonymes, supérieur introuvable, boucle, personne sans site : signalés dans « Points d'attention ».
- Les choix de colonnes sont mémorisés pour le prochain import. Ancien format `.xls` : « Enregistrer sous » `.xlsx` dans Excel.

### Mise en page (écran et PDF identiques)

Les personnes sans équipe sont empilées en colonnes d'au plus 6 sous leur responsable, pour que l'organigramme reste lisible sur une page A4.
Une personne dont le supérieur est sur un autre site apparaît en haut de l'arbre de son site, avec la mention « Rattaché(e) à … ».

## Tests

| Commande | Ce qu'elle fait | Besoin |
|---|---|---|
| `make test` | tout, sans fenêtre : ruff, backend (pytest), logique JS (node:test), scénarios navigateur | Docker + Node |
| `make test-back` / `make test-front` | tests unitaires seuls | Docker |
| `make lint` / `make format` | code Python : vérifier / corriger avec [ruff](https://docs.astral.sh/ruff/) (analyse et format, réglages dans `ruff.toml`) | Docker |
| `make e2e` | scénarios Playwright, sans fenêtre (rapide) | Docker + Node |
| `make e2e-headed` | scénarios dans un **navigateur visible**, ralentis (`SLOWMO=600` ms, réglable : `make e2e-headed SLOWMO=1200`) | Docker + Node |
| `make e2e-ui` | interface Playwright : choisir un scénario, le rejouer pas à pas, voir chaque étape | Docker + Node |
| `make e2e-server` / `make e2e-static` | un seul mode (`HEADED=1` pour voir le navigateur) | Docker + Node |
| `make e2e-report` | rapport du dernier passage (captures, traces) | Node |
| `make e2e-docker` | scénarios sans fenêtre, entièrement dans Docker | Docker |

- La première fois, `make e2e…` installe Playwright et Chromium (`make e2e-install`).
- Les scénarios utilisent une **instance de test séparée** : port 8081 (`TEST_PORT=8091` par exemple s'il est déjà pris sur votre machine), volume `org-data-test`. Ils ne touchent jamais aux vraies données, et refusent de tourner sur le port 8080. `make e2e-stack-down` arrête cette instance.
- Chaque scénario échoue si l'application tente de joindre l'extérieur, ou en cas d'erreur JavaScript.
- Backend sans Docker : avec [uv](https://docs.astral.sh/uv/) installé, `cd backend && uv sync && uv run pytest -q`
  (versions figées par `uv.lock`).

Les scénarios (`e2e/tests/`) :

1. import avec et sans supérieur, réimport du mois suivant, mapping mémorisé, refus du `.xls` ;
2. navigation : sites, recherche, replier/déplier, liste, zoom ;
3. hiérarchie : *Rattacher tous* + annuler, glisser-déposer + annuler, boucle refusée, retrait, fiche (supérieur, fonction, photo) ;
4. exports : PDF serveur (3 pages, et 1 page pour un site), impression (une page par site), Mermaid ;
5. données : sauvegarde chiffrée, effacement, restauration ;
6. confidentialité : connexion externe bloquée, CSP en place, hors ligne, Swagger servi localement ;
7. colonnes sensibles : un export RH complet (fictif) est importé sans qu'aucune colonne non retenue n'apparaisse dans la page, l'API, le stockage ou la sauvegarde ;
8. mot de passe : premier lancement, clé de secours, verrouillage manuel et automatique (15 min), mot de passe oublié, changement, sauvegarde du mode autonome restaurée dans le mode serveur, nom d'hôte inconnu refusé.

Le mot de passe de l'instance de test est fixé dans `e2e/tests/fixtures.js` (instance de test uniquement).

## Structure

```
docker-compose.yml        application (port 8080, volume org-data)
docker-compose.test.yml   instance de test (port 8081, volume org-data-test)
Makefile                  commandes (make help)
SECURITY.md               signaler une vulnérabilité, menaces couvertes, limites
.pre-commit-config.yaml   contrôles avant commit (gitleaks, données personnelles, ruff, bandit…)
ruff.toml                 analyse et format du code Python (ruff)
.github/                  CI (tests + sécurité) et Dependabot
AGENTS.md / CLAUDE.md     instructions pour les agents de code (format des fichiers, API, règles de confidentialité)
skills/                   procédures pour agents de code (import, tests, règles partagées, audit, publication) ;
                          .claude/skills est un lien vers ce dossier
backend/                  FastAPI + SQLite : importer.py, sync.py (fusion), tree.py, pdf.py (reportlab),
                          crypto.py (chiffrement), vault.py (mot de passe, sessions), tests/ ;
                          dépendances gérées par uv (pyproject.toml + uv.lock)
frontend/                 React + Vite + Tailwind
  src/core/               logique partagée (import, fusion, arbres, chiffrement WebCrypto), utilisée par le mode autonome
  src/data/               stockage : apiStore (serveur) / localStore (IndexedDB)
  api-docs/               page Swagger UI locale (copiée dans le build)
static/organigramme.html  mode autonome, prêt à l'emploi
e2e/                      scénarios Playwright
tools/sample-data/        fichiers FICTIFS de test (+ generate.py)
tools/hooks/              garde-fou « données personnelles » (pre-commit et CI)
tools/csv-converter/      convertisseur CSV → JSON/Mermaid d'origine (fork)
```

`.claude/skills` est un **lien symbolique** vers `skills/` (aucune duplication). Sous macOS et Linux, `git clone` le
recrée tel quel. **Sous Windows**, activez le *mode développeur* puis clonez avec
`git clone -c core.symlinks=true https://github.com/florianlebrenn/org-chart.git` ; sinon le lien devient un simple
fichier texte : l'application et les tests fonctionnent normalement, mais les agents doivent lire `skills/` directement
(c'est ce qu'indique `AGENTS.md`).

## Sécurité

Détails, menaces couvertes et limites : [`SECURITY.md`](SECURITY.md).

- **Chiffrement** : AES-256-GCM ; la clé de données est enveloppée par le mot de passe et par la clé de secours
  (PBKDF2-HMAC-SHA256, 600 000 itérations). Mode serveur : chaque champ est chiffré dans SQLite, la clé n'existe qu'en
  mémoire pendant une session (cookie HttpOnly, SameSite=Strict). Mode autonome : WebCrypto, état chiffré dans IndexedDB.
- **Docker** : écoute sur `127.0.0.1` seulement, conteneurs non-root sans capacités Linux, backend en lecture seule,
  nginx refuse les noms d'hôte inconnus (protection DNS rebinding).
- **Fichiers importés** : protection contre les attaques XML (`defusedxml`) et les « bombes zip ».

| Commande | Ce qu'elle fait |
|---|---|
| `make hooks` | installe les contrôles avant commit : gitleaks (secrets), données personnelles, ruff, bandit, clés privées, gros fichiers (dépôt git requis) |
| `make security` | dans Docker : gitleaks, données personnelles, pip-audit (sur `uv.lock`), bandit, npm audit, hadolint |

Sur GitHub, la CI (`.github/workflows/`) relance tests et contrôles à chaque PR, et chaque semaine. À activer dans les
réglages du dépôt : *Secret scanning* + *Push protection*, *Private vulnerability reporting*, *CodeQL (default setup)*,
*Dependabot alerts*, et la protection de `main` avec les contrôles `ci` et `security` obligatoires.

## Confidentialité

- **Minimisation des données** : seules les colonnes requises (nom, prénom, fonction, site, email, téléphone, supérieur) sont traitées ; les autres sont écartées dès la lecture du fichier, et des tests le vérifient (`backend/tests/test_confidentialite.py`, `e2e/tests/07-colonnes-sensibles.spec.js`).
- Toutes les ressources (JS, CSS, icônes, Swagger UI) sont empaquetées : aucun CDN, aucune police distante.
- Mode serveur : nginx envoie une CSP `default-src 'self'`, et la page Swagger par défaut de FastAPI (qui chargerait un CDN) est remplacée par une copie locale.
- Mode autonome : la CSP est dans la page (`connect-src 'none'`).
- Aucune télémétrie, même à l'installation des paquets (`DO_NOT_TRACK`, Scarf désactivé pour swagger-ui).
- Versions verrouillées par `package-lock.json` (interface) et `uv.lock` (backend, avec empreintes) ; les dépendances ajoutées sont épinglées à des versions publiées depuis plus de deux semaines (`exclude-newer = "14 days"` côté uv).

## Auteurs et licence

- **[Florian Le Brenn](https://www.linkedin.com/in/florianlebrenn/)** : application Organigramme (import, hiérarchie, vue par site, PDF, mode autonome, tests).
- **[Vinit Shahdeo](https://github.com/vinitshahdeo)** : projet d'origine [org.chart](https://github.com/vinitshahdeo/org.chart) (arbre repliable React, convertisseur CSV), dont ce projet est un fork.

Distribué sous licence **MIT** (voir [`LICENSE`](LICENSE)), qui conserve la mention de copyright du projet d'origine.
Composants tiers embarqués : React, Tailwind CSS, Framer Motion, Lucide (ISC), read-excel-file, Swagger UI (Apache-2.0), FastAPI, openpyxl, ReportLab (BSD).

Les données d'exemple (`tools/sample-data/`) sont **entièrement fictives** : noms inventés, adresses en `.test` (domaine réservé), numéros dans la plage `06 39 98` réservée par l'ARCEP aux œuvres de fiction.
