---
name: modifier-regle-partagee
description: Modifier une règle qui existe en double (Python côté serveur et JavaScript côté mode autonome) — lecture des fichiers, mapping des colonnes, fusion au réimport, arbres et mise en page, chiffrement et sauvegardes — sans désynchroniser les deux modes.
---

# Modifier une règle partagée Python ↔ JS

L'application a deux modes (serveur Docker, fichier HTML autonome) qui doivent se comporter **exactement** pareil.
Chaque règle métier existe donc deux fois :

| Règle | Python (serveur) | JavaScript (mode autonome) |
|---|---|---|
| Normalisation des noms, en-têtes, mapping proposé, en-tête détecté, colonnes retenues | `backend/importer.py` | `frontend/src/core/text.js`, `core/importer.js` |
| Fusion au réimport, avertissements | `backend/sync.py` | `frontend/src/core/sync.js` |
| Arbres par site, non rattachés, colonnes de 6, anti-boucle, Mermaid | `backend/tree.py` (+ `pdf.py`) | `frontend/src/core/tree.js` (+ `components/OrgChart.jsx`, `index.css`) |
| Chiffrement, clé de secours, sauvegardes | `backend/crypto.py`, `vault.py` | `frontend/src/core/crypto.js`, `data/localStore.js` |
| Interface de stockage | `backend/main.py` (API) | `frontend/src/data/apiStore.js` = `localStore.js` (mêmes méthodes) |

## Procédure

1. **Écrire d'abord le test** qui décrit le nouveau comportement, des deux côtés :
   `backend/tests/` (pytest) et `frontend/src/core/core.test.js` (même scénario, mêmes fichiers d'exemple).
2. Modifier Python, puis JS, **ligne à ligne** : mêmes constantes (ex. `STACK_MIN`, `MAX_COLUMN`, `MIN_PASSWORD`,
   `MAX_UNCOMPRESSED`), mêmes expressions régulières, même ordre de tri (tri par code point, comme Python : voir `cmp`
   dans `tree.js`), mêmes messages d'erreur en français.
3. Disposition de l'organigramme : l'écran (`OrgChart.jsx` + CSS `.oc-*`) et le PDF (`pdf.py`) suivent `layout_items` /
   `layoutItems`. Vérifier visuellement les deux (`make e2e-headed`, et le PDF téléchargé).
4. Chiffrement : ne jamais casser la compatibilité des sauvegardes. `tools/sample-data/sauvegarde-chiffree-exemple.json`
   doit rester lisible par pytest **et** node --test ; le scénario Playwright « sauvegarde du mode autonome restaurée
   dans le mode serveur » vérifie l'autre sens. Un changement de format = nouveau `version` + lecture de l'ancien.
5. Données déjà enregistrées : prévoir la migration (`db._migrate`, `vault.encrypt_existing`, ou lecture tolérante dans
   `localStore`).
6. `make test-back test-front`, puis `make static` et `make e2e` (les deux projets).
7. Mettre à jour `AGENTS.md` (§3 à §6 bis) si la règle est décrite, et `README.md` si l'utilisateur la voit.

## Pièges connus

- `localeCompare` ≠ tri Python : utiliser le tri par code point pour garder l'ordre et les couleurs des sites.
- `Number.isInteger` (JS) vs `isinstance(i, int) and not isinstance(i, bool)` (Python) pour les index de colonnes.
- WebCrypto renvoie `chiffré || tag`, comme `AESGCM.encrypt` de `cryptography` : garder le nonce de 12 octets devant.
- Les en-têtes en double, les colonnes vides en fin de tableau et la ligne de titre au-dessus du tableau sont gérés
  par `tableFromRows` / `_table_from_rows` : tester avec `collaborateurs_sans_superieur.xlsx`.
