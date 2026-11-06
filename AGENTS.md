# AGENTS.md — instructions pour les agents de code

Ce fichier explique à un agent de code (assistant IA ou automatisation) comment **utiliser**, **piloter** et **modifier**
l'application Organigramme correctement. À lire en entier avant toute action. Le `README.md` reste la documentation
destinée aux humains.

---

## 1. Règles non négociables

1. **Confidentialité : seules les colonnes requises par l'outil sont traitées.**
   Un fichier du personnel contient souvent bien plus que ce dont l'organigramme a besoin : salaire, date de naissance,
   n° de sécurité sociale, adresse, matricule, commentaires RH, etc. **Toute colonne qui n'est pas associée à l'un des
   champs du §3 ne doit être ni importée, ni conservée, ni affichée**, ni par l'application, ni par l'agent :
   - ne pas lire, résumer, citer ou recopier ces colonnes (pas dans la conversation, les journaux, les tests, les commits ni les issues) ;
   - pour inspecter un fichier réel, se limiter à la **ligne d'en-têtes** et ne lire **que** les colonnes retenues ;
   - pour préparer un fichier à importer, produire une copie qui ne contient **que** les colonnes retenues (§3.5) ;
   - ne jamais ajouter un champ au modèle de données, à l'API ou à l'interface pour « garder » une colonne en plus,
     sauf demande explicite du propriétaire du projet, et seulement pour une information nécessaire à l'organigramme.
2. **Zéro appel réseau sortant à l'exécution** : pas de CDN, pas de police distante, pas d'analytics ni de télémétrie.
   Toute dépendance est empaquetée localement. Le navigateur est bridé par une CSP (serveur : `default-src 'self'` ;
   mode autonome : `connect-src 'none'`).
3. **Pas de données réelles dans le dépôt.** Les données d'exemple sont fictives (`tools/sample-data/`) : noms inventés,
   emails en `@entreprise.test`, téléphones `06 39 98 xx xx` (plage réservée à la fiction par l'ARCEP). Ne jamais
   committer un vrai fichier du personnel, une base `org.db`, une sauvegarde `.json`, une capture d'écran ou un PDF
   produit avec de vraies données.
4. **Aucun secret** dans le code ou la configuration.
   **Chiffrement obligatoire** : aucune donnée du personnel n'est écrite en clair (base, IndexedDB, sauvegarde,
   journal). Ne jamais demander, afficher, journaliser ni committer un mot de passe ou une clé de secours réels.
5. **Test local d'abord** : rien n'est publié ou déployé tant que `make test` n'est pas vert sur la machine locale.
6. **Licence MIT** : conserver `LICENSE` (copyright de Vinit Shahdeo, projet d'origine
   [org.chart](https://github.com/vinitshahdeo/org.chart), et de Florian Le Brenn) et les mentions d'auteurs du README.
7. **Pas de mention d'assistant IA** dans le code, la documentation ou les messages de commit (ni signature
   « Co-Authored-By », ni « généré par »). Seul ce fichier et `CLAUDE.md` s'adressent aux agents.

---

## 2. Vue d'ensemble

| | Mode serveur (Docker) | Mode autonome (fichier HTML) |
|---|---|---|
| Lancement | `make up` → <http://localhost:8080> | ouvrir `static/organigramme.html` |
| Stockage | SQLite **chiffrée** dans le volume Docker `org-data` | IndexedDB **chiffrée** (à défaut localStorage, à défaut mémoire) |
| Accès | mot de passe → session (cookie) ; `127.0.0.1` uniquement | mot de passe (clé gardée en mémoire de la page) |
| Import Excel | serveur (openpyxl) | navigateur (read-excel-file) |
| PDF | serveur (reportlab), A4 paysage, une page par site | impression du navigateur |
| API | REST, documentation Swagger locale sur `/api/docs` | aucune |

```
backend/          FastAPI + SQLite
  importer.py     lecture xlsx/csv, détection des en-têtes, mapping proposé, clean_mapping / project_rows / preview
  sync.py         fusion d'un import avec la base (par nom), avertissements
  tree.py         arbres par site, « non rattachés », disposition (layout_items), anti-boucle, Mermaid
  pdf.py          PDF reportlab
  main.py         routes /api/*, imports en attente gardés en mémoire, contrôle de session
  crypto.py       AES-256-GCM, PBKDF2, enveloppe de clé, chiffrement des champs, sauvegardes chiffrées
  vault.py        coffre : création du mot de passe, déverrouillage, sessions, verrouillage, clé de secours
  tests/          pytest
  pyproject.toml  dépendances (uv) ; uv.lock fige toutes les versions avec leurs empreintes
frontend/         React + Vite + Tailwind
  src/core/       MÊME logique qu'importer.py / sync.py / tree.py, en JS (utilisée par le mode autonome)
  src/core/crypto.js  MÊMES formats que crypto.py (WebCrypto)
  src/data/       apiStore.js (mode serveur) et localStore.js (mode autonome) : même interface
  src/VaultGate.jsx   écrans mot de passe / clé de secours / déverrouillage, verrouillage après 15 min
  api-docs/       page Swagger UI locale
static/organigramme.html   mode autonome construit (make static)
e2e/              scénarios Playwright (serveur + autonome)
tools/sample-data/         fichiers FICTIFS + generate.py
```

---

## 3. Format du fichier à importer

### 3.1 Fichiers acceptés

- `.xlsx` / `.xlsm` (Excel). L'ancien `.xls` est refusé : il faut l'enregistrer en `.xlsx`.
- `.csv` / `.txt` : séparateur `;`, `,` ou tabulation (détecté), encodage UTF-8 (avec ou sans BOM) ou Windows-1252 (export Excel français).
- 20 Mo maximum. Pour un classeur à plusieurs feuilles, on en choisit une ; les feuilles sans tableau sont ignorées.
- **Ligne d'en-têtes** : la première ligne, parmi les 20 premières, qui a au moins 2 cellules remplies. Un titre au-dessus
  du tableau est donc toléré. Les lignes vides sont ignorées, et une ligne sans nom est ignorée (et comptée).

### 3.2 Champs utilisés par l'outil (et SEULEMENT ceux-là)

| Champ (`mapping`) | Obligatoire | Contenu | En-têtes reconnus automatiquement (sans accents ni casse) |
|---|---|---|---|
| `name` | oui, **ou** `first_name`/`last_name` | nom complet | « nom complet », « nom et prénom », « collaborateur », « salarié », « employé », « personne », « name », « agent » |
| `first_name` | avec `last_name` | prénom | « prénom », « first name » |
| `last_name` | avec `first_name` | nom de famille | « nom », « nom de famille », « last name », « surname », « nom usuel » |
| `title` | non | fonction | « fonction », « poste », « intitulé », « titre », « rôle », « job », « métier », « emploi » |
| `site` | non (conseillé) | site / bâtiment | « site », « bâtiment », « établissement », « lieu », « localisation », « implantation », « agence », « bureau », « locaux » |
| `email` | non | email | « mail », « courriel » |
| `phone` | non | téléphone | « tél », « téléphone », « phone », « portable », « mobile », « gsm » |
| `manager` | non | nom du supérieur hiérarchique | « supérieur », « manager », « N+1 », « responsable hiérarchique », « chef direct », « hiérarchie » |

- Si `name` est choisi, `first_name` et `last_name` sont ignorés. Un « Nom » seul (sans « Prénom ») est traité comme nom complet.
- Les noms tout en MAJUSCULES sont remis en forme (« D'ALMEIDA » → « D'Almeida »).
- `manager` contient le **nom** du supérieur, dans n'importe quel ordre (« Hélène Marchand » ou « MARCHAND Hélène »).
- **Toute autre colonne est ignorée** : pas lue, pas renvoyée, pas stockée (voir §1.1 et §6).

### 3.3 Exemple minimal (CSV)

```csv
Nom;Prénom;Fonction;Site;Supérieur hiérarchique
MARCHAND;Hélène;Directrice administrative et financière;Siège - Lyon;
LEFÈVRE;François;Responsable comptabilité;Siège - Lyon;Hélène Marchand
BENALI;Nadia;Comptable;Siège - Lyon;François Lefèvre
```

### 3.4 Fichiers d'exemple (fictifs)

`tools/sample-data/` contient : `collaborateurs_avec_superieur.xlsx`, `collaborateurs_sans_superieur.xlsx` (titre
au-dessus du tableau, prénom/nom séparés), `collaborateurs_mise_a_jour.xlsx` (3 arrivées, 2 départs, 1 changement
de poste, 1 changement de site), `collaborateurs.csv` (Windows-1252, `;`), et
`collaborateurs_avec_colonnes_sensibles.xlsx` (5 colonnes RH en trop dont toutes les valeurs commencent par
`CONFIDENTIEL`, pour tester le filtrage). Pour les régénérer : `uv run --project backend python tools/sample-data/generate.py`.

### 3.5 Préparer un fichier réel sans exposer les autres colonnes

Si l'on demande à l'agent de préparer un fichier, il ne garde que les colonnes retenues, sans afficher le reste :

```python
# n'imprime rien d'autre que les en-têtes ; écrit une copie réduite aux colonnes retenues
from openpyxl import load_workbook, Workbook
KEEP = ["Nom", "Prénom", "Fonction", "Site", "Email", "Téléphone", "Supérieur hiérarchique"]  # à adapter aux en-têtes réels
ws = load_workbook("personnel.xlsx", read_only=True, data_only=True).active
rows = ws.iter_rows(values_only=True)
headers = [str(h or "") for h in next(rows)]
print(headers)                                   # seule information lue et affichée
idx = [headers.index(h) for h in KEEP if h in headers]
out = Workbook(); o = out.active
o.append([headers[i] for i in idx])
for r in rows:
    o.append([r[i] for i in idx])
out.save("personnel_organigramme.xlsx")          # à importer, puis à supprimer ; ne jamais committer
```

L'application filtre de toute façon elle-même (§6). Cette étape sert seulement à réduire ce qui circule.

---

## 4. Piloter l'application

### 4.1 Par l'interface (les deux modes)

0. **Mot de passe** : au premier lancement, en choisir un (12 caractères min.) ; une clé de secours s'affiche une seule
   fois. Ensuite, déverrouiller à chaque ouverture et après 15 min d'inactivité.
1. **Importer** : déposer le fichier → l'appli propose le mapping des colonnes (mémorisé d'un import à l'autre). L'aperçu
   n'affiche **que** les colonnes retenues, et liste les noms des colonnes ignorées.
2. **Vérifier l'import** (simulation, rien n'est écrit) : nouveaux, modifiés, retirés, inchangés, et points d'attention
   (homonymes, supérieur introuvable ou ambigu, boucle coupée, personne sans site, subordonnés qui perdent leur supérieur).
3. **Confirmer l'import**. Le fichier complet est alors oublié.
4. **Organigramme** : un arbre par site. Filtre de site, recherche, replier/déplier, vue liste, zoom.
5. **Hiérarchie** : glisser une carte sur son supérieur ; fiche (clic) → « Supérieur hiérarchique » ; zone
   « Non rattachés » → *Rattacher tous* (responsable du site deviné d'après la fonction) ; *Annuler* après chaque changement.
6. **Exports** : PDF, impression, Mermaid. **Données** : sauvegarde `.json`, restauration, effacement.

### 4.2 Par l'API (mode serveur)

Base : `http://localhost:8080/api` (instance de test : `http://localhost:8081/api`). Contrat complet : `/api/openapi.json`.
Hors `/health` et `/vault/*`, **toutes les routes exigent une session** : déverrouiller d'abord, garder le cookie.
Le mot de passe se lit depuis l'environnement ou une saisie masquée, jamais en clair dans une commande ou un fichier.

```bash
API=http://localhost:8080/api
JAR=$(mktemp)                                   # cookie de session (à supprimer après usage)
read -rs ORG_PW && export ORG_PW               # saisie masquée du mot de passe
curl -s -c "$JAR" -H 'Content-Type: application/json' $API/vault/unlock \
  -d "$(python3 -c 'import json,os; print(json.dumps({"password": os.environ["ORG_PW"]}))')"
# 1. envoyer le fichier -> jeton, feuilles, en-têtes, mapping proposé (AUCUNE valeur de cellule)
curl -s -b "$JAR" -F "file=@tools/sample-data/collaborateurs_avec_superieur.xlsx" $API/import
# 2. aperçu (8 lignes), limité aux colonnes du mapping
curl -s -b "$JAR" -H 'Content-Type: application/json' $API/import/preview \
  -d '{"token":"<jeton>","sheet":0,"mapping":{"name":0,"title":1,"site":2,"email":3,"manager":4}}'
# 3. simulation, puis 4. écriture
curl -s -b "$JAR" -H 'Content-Type: application/json' $API/import/confirm \
  -d '{"token":"<jeton>","sheet":0,"mapping":{...},"dry_run":true}'
curl -s -b "$JAR" -H 'Content-Type: application/json' $API/import/confirm \
  -d '{"token":"<jeton>","sheet":0,"mapping":{...},"dry_run":false}'
# abandonner un import en cours (le fichier est oublié), puis verrouiller
curl -s -b "$JAR" -X DELETE $API/import/<jeton>
curl -s -b "$JAR" -X POST $API/vault/lock; rm -f "$JAR"; unset ORG_PW
```

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | état (`vault` : setup / locked / unlocked) ; compteurs seulement si déverrouillé |
| GET | `/vault/status` | `setup` (mot de passe à créer), `locked` ou `unlocked` |
| POST | `/vault/setup` | `{password}` : premier lancement → `{recovery_key}` (à afficher UNE fois) + session |
| POST | `/vault/unlock` · `/vault/lock` | ouvrir une session / verrouiller (efface la clé de la mémoire) |
| POST | `/vault/recover` | `{recovery_key, new_password}` → nouvelle clé de secours + session |
| POST | `/vault/password` · `/vault/recovery-key` | changer le mot de passe / nouvelle clé de secours (session + mot de passe actuel) |
| POST | `/import` | fichier → jeton, en-têtes, mapping proposé |
| POST | `/import/preview` | aperçu des colonnes retenues + noms des colonnes ignorées |
| POST | `/import/confirm` | `dry_run=true` : simulation ; `false` : écriture |
| DELETE | `/import/{token}` | abandon |
| GET | `/import/last` | dernier import (nom du fichier, date, compteurs) |
| GET | `/employees` · `/sites` · `/org?site_id=` | lecture (liste plate, sites, arbres par site) |
| PATCH | `/employees/{id}` | `manager_id` (null = racine ; boucle refusée), `title`, `site_id`, `email`, `phone`, `photo` (data URL PNG/JPEG/WebP < 300 Ko) |
| POST | `/attach-unassigned` | `{site_id, manager_id}` : rattache tous les « non rattachés » du site |
| GET | `/export/pdf?site_id=` · `/export/mermaid` | exports |
| POST | `/backup` | `{password}` (mot de passe actuel) → sauvegarde **chiffrée** |
| POST | `/restore` · DELETE `/data` | `{backup, password}` (mot de passe de la sauvegarde) ; effacement (le mot de passe reste) |

Réponse d'une route protégée sans session : `401 {"detail": "Application verrouillée.", "locked": true}`.

Un mapping est un objet `{champ: index de colonne}` (index à partir de 0 dans `headers`). Les champs inconnus, les index
invalides et les colonnes en double sont ignorés.

### 4.3 Règles de fusion (réimport)

- Une personne est reconnue par son **nom**, sans tenir compte de la casse, des accents ni de l'ordre des mots.
- Personne présente des deux côtés : fonction, site et contact sont mis à jour ; **hiérarchie et photo conservées**.
- Personne nouvelle : ajoutée, sans supérieur (« Non rattachés »).
- Personne absente du fichier : retirée ; ses subordonnés n'ont plus de supérieur (signalé).
- Colonne `manager` choisie : c'est **le fichier** qui définit toute la hiérarchie (introuvable → racine, ambigu → premier
  homonyme, boucle → coupée ; tout est signalé).
- Homonymes : appariés dans l'ordre du fichier et signalés.

### 4.4 Règles d'affichage (identiques à l'écran et dans le PDF)

- Un arbre par site ; quelqu'un dont le supérieur est sur un autre site est racine de son site, avec la mention « Rattaché(e) à … ».
- « Non rattachés » : les personnes sans supérieur **et** sans subordonné sur le site.
- Les subordonnés sans équipe (au moins 3) sont empilés en colonnes de 6 au plus (`layout_items` / `layoutItems`).
- Couleur d'un site : son rang (tri alphabétique) dans une palette fixe.

---

## 5. Commandes

```bash
make help            # liste
make up / make down  # application (8080)
make static          # reconstruire static/organigramme.html
make test            # TOUT, sans fenêtre : ruff + pytest + node --test + Playwright (serveur et autonome)
make lint            # ruff : analyse et format du code Python, sans rien modifier (dans Docker)
make format          # ruff : corrige ce qui peut l'être et reformate (dans Docker)
make test-back       # pytest (dans Docker)
make test-front      # logique JS (node --test, dans Docker)
make e2e             # scénarios Playwright, sans fenêtre (instance de test sur 8081)
make e2e-headed      # navigateur visible et ralenti (SLOWMO=600)
make e2e-ui          # interface Playwright (rejouer un scénario pas à pas)
make e2e-docker      # scénarios sans Node local
make hooks           # contrôles avant commit (gitleaks, données personnelles, ruff, bandit…)
make security        # gitleaks, données personnelles, pip-audit, bandit, npm audit, hadolint (dans Docker)
```

Backend hors Docker (développement) : [uv](https://docs.astral.sh/uv/) gère Python et les dépendances.

```bash
cd backend
uv sync                                   # crée .venv à partir de uv.lock
uv run pytest -q
uv run uvicorn main:app --reload --port 8000
cd .. && uv run --project backend ruff check . && uv run --project backend ruff format --check .
```

Le mot de passe de l'instance de test est dans `e2e/tests/fixtures.js` (instance de test uniquement ; pytest utilise
le sien dans `backend/tests/helpers.py`, avec un nombre d'itérations réduit pour la vitesse).
Les scénarios effacent les données : ils tournent **uniquement** sur l'instance de test (port 8081, volume
`org-data-test`) et refusent le port 8080. Ne jamais pointer les tests vers une instance contenant de vraies données.
Si le port 8081 est déjà pris sur la machine (« port is already allocated »), passer un autre port à toutes les cibles
e2e : `make e2e TEST_PORT=8091` (8080 est refusé).

---

## 6. Filtrage des colonnes dans le code (à préserver)

La règle §1.1 est appliquée par le code, à plusieurs niveaux. Toute modification doit la garder intacte.

| Étape | Serveur (`backend/`) | Mode autonome (`frontend/src/`) |
|---|---|---|
| Envoi du fichier | `POST /import` ne renvoie que les en-têtes, jamais de valeur | `localStore.upload` idem |
| Fichier en attente | **en mémoire uniquement** (`PendingImports`, 30 min max, 10 fichiers max), oublié à la confirmation, à l'abandon ou au verrouillage ; plus aucun fichier sur le disque (l'ancien dossier `imports/` est supprimé au démarrage) | en mémoire de la page, jamais dans IndexedDB |
| Mapping | `importer.clean_mapping` : seuls les champs de `FIELDS`, index valides, une colonne par champ | `cleanMapping` |
| Aperçu | `importer.preview` : colonnes retenues + noms des colonnes ignorées | `preview` |
| Import | `importer.project_rows` réduit le tableau **avant** la fusion ; `sync` ne voit jamais les autres colonnes | `projectRows` |
| Stockage | schéma `employees` limité à `name, title, email, phone, photo, site_id, manager_id` (+ techniques) | même structure dans IndexedDB |
| Mémorisation | seuls les **en-têtes** des colonnes retenues sont mémorisés (`import_mapping`) | idem |

Tests de garde (à garder verts, à compléter si l'on touche à l'import) :
`backend/tests/test_confidentialite.py`, `frontend/src/core/core.test.js` (bloc « confidentialité »),
`e2e/tests/07-colonnes-sensibles.spec.js`. Ils importent le fichier fictif à colonnes sensibles et vérifient que la
chaîne `CONFIDENTIEL` n'apparaît **nulle part** : réponses de l'API, aperçu, page affichée, base SQLite et fichiers
du dossier de données, IndexedDB, sauvegarde, exports.

---

## 6 bis. Chiffrement (à préserver)

| | Serveur (`backend/crypto.py`, `vault.py`) | Mode autonome (`src/core/crypto.js`, `localStore.js`) |
|---|---|---|
| Clé de données (DEK) | 256 bits aléatoires, uniquement en mémoire pendant une session | idem, `CryptoKey` non exportable |
| Enveloppe | DEK chiffrée (AES-256-GCM) par PBKDF2-HMAC-SHA256 (600 000 it., sel 16 o) du mot de passe, et de la clé de secours | identique |
| Données | chaque champ chiffré (AES-GCM, nonce aléatoire, nom du champ en AAD) ; noms/sites retrouvés par HMAC-SHA256 | l'état complet chiffré en un bloc (AES-GCM) |
| Sauvegarde | format `organigramme-sauvegarde-chiffree` **identique** dans les deux modes (testé dans les deux sens) | identique |
| Verrouillage | 15 min sans requête, bouton *Verrouiller*, redémarrage | 15 min sans activité, bouton, rechargement |

Règles : ne jamais réduire les itérations en production (les tests les réduisent explicitement), ne jamais écrire la
DEK, le mot de passe ou la clé de secours sur le disque ou dans un journal, garder les deux implémentations compatibles
(`tools/sample-data/sauvegarde-chiffree-exemple.json` est relu par pytest ET node --test), et n'exposer aucune donnée
sur les routes publiques (`/health`, `/vault/*`). Tests de garde : `backend/tests/test_vault.py`, bloc « chiffrement »
de `core.test.js`, `e2e/tests/08-mot-de-passe.spec.js`.

---

## 7. Audit de sécurité (skill Cloudflare `security-audit`)

On utilise la skill open source [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
(MIT) pour rechercher d'éventuelles vulnérabilités, puis on les corrige.

**Quand l'utiliser**

- **Avant la première publication** du dépôt, puis avant chaque version publiée : audit complet, profil `standard`.
- **Après toute modification sensible** : import, fusion, API, stockage, sauvegarde/restauration, CSP/nginx, Docker,
  dépendances. Audit ciblé (profil `quick`, ou limité aux fichiers modifiés).
- Pour une question ponctuelle (« ce changement est-il sûr ? »), le mode *guidance* suffit : il n'écrit aucun fichier.

**Installation** (relire le contenu de la skill avant de l'installer : ce sont des instructions tierces)

```bash
npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit
```

**Lancement** : demander à l'agent, par exemple :
« security audit this codebase, profile standard, output to ~/security-audit-skill/org-chart ».

**Règles propres à ce projet**

1. Le rapport est écrit **hors du dépôt** (par défaut `~/security-audit-skill/<repo>/run-<N>`). S'il doit être dans
   le dépôt, utiliser uniquement `.security-audit/` (ignoré par git). **Ne jamais committer un rapport d'audit.**
2. L'audit ne travaille qu'avec les **données fictives** de `tools/sample-data/`. Jamais avec un vrai fichier du personnel.
3. La skill **décrit** les correctifs mais ne modifie pas le code. Pour chaque constat `confirmed` :
   - appliquer le correctif le plus petit possible, au bon endroit, **dans les deux implémentations** (Python et JS) si la règle est partagée (§8, parité Python ↔ JS) ;
   - ajouter un test de non-régression : pytest, `node --test` ou un scénario Playwright ;
   - relancer `make test`, puis un audit ciblé pour vérifier que le constat est clos.
4. Les constats `needs_validation` (qui dépendent du déploiement : réseau, reverse proxy, poste de travail) sont reportés
   dans le README (section Sécurité) avec la précaution à prendre, au lieu d'être ignorés.
5. Ne jamais affaiblir une protection existante pour faire passer un test : CSP, filtrage des colonnes (§6),
   garde-fou du port 8080, utilisateur non-root dans Docker.

---

## 8. Modifier le code : checklist

- **Parité Python ↔ JS** : toute règle d'import, de fusion ou de disposition existe deux fois et doit rester identique :
  `importer.py` ↔ `src/core/importer.js`, `sync.py` ↔ `src/core/sync.js`, `tree.py` ↔ `src/core/tree.js`,
  `crypto.py` ↔ `src/core/crypto.js` (formats de sauvegarde et de clé de secours).
  `apiStore.js` et `localStore.js` exposent la même interface.
- **Nouveau cas d'usage** = un scénario Playwright dans `e2e/tests/` (les deux modes si possible). Le fixture `network`
  fait échouer tout test qui voit une requête externe ou une erreur JavaScript.
- **Dépendances** : versions exactes, publiées depuis au moins deux semaines ; jamais de CDN ; `DO_NOT_TRACK=1`
  (swagger-ui-dist contient Scarf, désactivé via `scarfSettings`). Ne pas supprimer `package-lock.json` ni `uv.lock`.
  Python : uniquement via uv, dans `backend/` — `uv add <paquet>==<x.y.z>` (ou `--dev`), `uv lock --upgrade-package
  <paquet>` ; `exclude-newer = "14 days"` (pyproject.toml) refuse les versions trop récentes. Pas de `pip install`
  ni de `requirements.txt`.
- **Code Python** : `ruff check` et `ruff format` sans erreur (réglages dans `ruff.toml` : défauts de ruff, lignes de
  120 caractères). Ne pas désactiver une règle globalement pour faire passer le code ; un `# noqa: <code>` ponctuel
  doit être justifié en commentaire.
- **Interface en français**, accessible au clavier, pas de boîte `alert()/confirm()` (confirmation dans la page).
- **Backend** : un seul processus uvicorn (les imports en attente sont en mémoire).
- Après modification du frontend : `make static` pour régénérer `static/organigramme.html`.
- **Changement sensible** (import, API, stockage, Docker, dépendances) : audit de sécurité ciblé (§7) et correction des constats.
- **Contrôles avant commit** : `make hooks` (une fois) ; ne jamais contourner avec `--no-verify`. `make security` avant une publication.
- **Avant de rendre la main** : `make test` vert, puis vérifier qu'aucune donnée réelle ni capture n'a été ajoutée
  (`git status`), et que `README.md` / ce fichier sont à jour si le comportement a changé.

---

## 9. Skills du projet

Procédures prêtes à l'emploi, dans `skills/` (format `SKILL.md` : nom, description, étapes). `.claude/skills` est un
lien vers ce dossier (rien n'est dupliqué) ; un agent qui ne lit pas `.claude/` — ou un clone Windows sans liens
symboliques, où `.claude/skills` n'est qu'un fichier texte — ouvre directement `skills/<nom>/SKILL.md`.

| Skill | Quand l'utiliser |
|---|---|
| `importer-fichier-personnel` | inspecter, réduire ou importer un vrai fichier du personnel (script : en-têtes seulement, copie réduite) |
| `tester-organigramme` | choisir les tests, lancer Playwright avec ou sans fenêtre, écrire un scénario (modèle fourni), diagnostiquer |
| `modifier-regle-partagee` | changer une règle d'import, de fusion, de disposition ou de chiffrement dans les deux modes |
| `ajouter-un-champ` | ajouter une information au modèle (sur demande explicite), de l'import au PDF, chiffrée |
| `audit-securite` | `make security`, audit Cloudflare adapté au projet, correction des constats avec tests |
| `publier-version` | avant un push public ou une version : données perso, mentions, licence, tests, réglages GitHub |
