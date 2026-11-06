---
name: tester-organigramme
description: Choisir et lancer les bons tests de l'organigramme (pytest, node --test, scénarios Playwright avec ou sans fenêtre), écrire un nouveau scénario d'usage, diagnostiquer un échec. À utiliser après toute modification du code ou pour reproduire un bug.
---

# Tester l'organigramme

## Quels tests pour quel changement

| Changement | Commande minimale | Puis |
|---|---|---|
| `backend/*.py` (et tout fichier Python) | `make lint test-back` | `make e2e-server` |
| `frontend/src/core/*`, `src/data/*` | `make test-front` | `make e2e` (deux modes) |
| Composants React (`src/*.jsx`) | `make e2e` | `make e2e-headed` pour voir |
| nginx, Dockerfile, compose | `make e2e-stack-down && make e2e-server` (reconstruit l'image) | `make security` |
| Règle partagée Python ↔ JS | `make test-back test-front` | `make e2e` |
| Avant de rendre la main | `make test` | — |

`make test-back` / `make test-front` tournent dans Docker. Les scénarios demandent Node.js en local, sinon utiliser
`make e2e-docker`.

## Scénarios Playwright

- Sans fenêtre (rapide) : `make e2e`. Un mode : `make e2e-server` ou `make e2e-static` (`HEADED=1` pour voir).
- **Avec fenêtre**, ralenti : `make e2e-headed SLOWMO=800`. **Pas à pas** : `make e2e-ui`. Rapport : `make e2e-report`.
- Un seul fichier ou un seul test : `cd e2e && BASE_URL=http://localhost:8081 npx playwright test tests/03-hierarchie.spec.js -g "glisser"`.
- Port 8081 déjà pris (« port is already allocated ») : `make e2e TEST_PORT=8091` (toutes les cibles e2e l'acceptent).
- Projets : `serveur` (instance de **test** Docker, port 8081) et `autonome` (`static/organigramme.html` → faire
  `make static` après une modification du frontend).
- Les scénarios effacent les données : jamais sur le port 8080 (le fixture refuse).

## Écrire un nouveau scénario

Partir de `templates/scenario.spec.js` (copie dans `e2e/tests/NN-sujet.spec.js`). Règles :

1. `await app.open()` : crée ou saisit le mot de passe de test, puis repart de données vides.
2. Utiliser les helpers de `e2e/tests/fixtures.js` : `importFile`, `upload`, `setMapping`, `review`, `confirm`, `card`,
   `section`, `tab`, `toast`, `employees`, `managerOf`, `passVault`, `acknowledgeRecoveryKey`, `rawBrowserStorage`.
3. Sélecteurs : `data-testid` ou rôles accessibles (`getByRole`) ; éviter les classes CSS.
4. Données : **uniquement** les fichiers fictifs de `tools/sample-data/`.
5. Le fixture `network` fait échouer le test sur toute requête externe ou erreur JavaScript. Une tentative volontaire
   (test de blocage) se déclare avec `network.expectBlocked(/motif/)`.
6. Un comportement propre à un mode : `test.skip(app.isServer, 'raison')`.
7. Temps (inactivité…) : `await page.clock.install()` avant `app.open()`, puis `page.clock.fastForward('16:00')`.

## Diagnostiquer un échec

1. Lire le message : Playwright donne le sélecteur et l'attendu. `e2e/test-results/<test>/error-context.md`
   contient l'arbre d'accessibilité de la page au moment de l'échec.
2. Rejouer : `npx playwright show-trace e2e/test-results/<test>/trace.zip` (instantanés, réseau, console).
3. Reproduire en visible : `make e2e-headed` sur le seul test (`-g`).
4. Corriger le code ou, si l'attendu du test est faux, le test, en expliquant pourquoi. Ne jamais affaiblir un
   contrôle de sécurité ou de confidentialité pour faire passer un test.

## Tests unitaires

- pytest : `backend/tests/` ; fixtures `raw_client` (sans mot de passe) et `client` (déverrouillé) dans `conftest.py` ;
  helpers et `TEST_PASSWORD` dans `helpers.py`. Les itérations PBKDF2 sont réduites dans les tests uniquement.
- JS : `frontend/src/core/core.test.js` (`node --test`) ; `memoryStore()` (déverrouillé) et `rawStore()` (sans mot de passe).
