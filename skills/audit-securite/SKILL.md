---
name: audit-securite
description: Auditer et corriger la sécurité de l'organigramme — contrôles automatiques (make security), puis audit approfondi avec la skill Cloudflare security-audit adaptée aux règles du projet, correction des constats avec tests. À utiliser avant une publication ou après un changement sensible (import, API, chiffrement, Docker, dépendances).
---

# Audit de sécurité du projet

## 1. Contrôles automatiques (rapides)

```bash
make security   # gitleaks, données personnelles, pip-audit, bandit, npm audit, hadolint (dans Docker)
make test       # le comportement de sécurité est aussi couvert par les tests
```

Corriger tout constat avant d'aller plus loin. Une dépendance vulnérable : monter vers une version corrigée **publiée
depuis au moins 14 jours**, épinglée exactement (Python : `uv lock --upgrade-package <paquet>` dans `backend/`,
la règle `exclude-newer = "14 days"` de `pyproject.toml` écarte les versions trop récentes), puis relancer `make test`.

## 2. Audit approfondi : skill Cloudflare `security-audit`

Installation (relire la skill avant : ce sont des instructions tierces) :

```bash
npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit
```

Lancer en précisant les contraintes du projet, par exemple :

> security audit this codebase, profile standard, output to ~/security-audit-skill/org-chart.
> Use only the fictitious data in tools/sample-data. Do not run anything against port 8080.

Profil : `standard` avant une publication, `quick` (ou portée limitée aux fichiers changés) après un changement.

Surfaces à couvrir en priorité (à donner à l'audit comme carte des frontières de confiance) :

| Surface | Fichiers |
|---|---|
| Lecture de fichiers importés (xlsx/csv) | `backend/importer.py`, `frontend/src/core/importer.js` |
| Authentification, sessions, verrouillage | `backend/vault.py`, middleware de `backend/main.py` |
| Chiffrement et sauvegardes | `backend/crypto.py`, `frontend/src/core/crypto.js`, `data/localStore.js` |
| API (autorisation de chaque route, validation) | `backend/main.py` |
| Rendu (XSS via noms/fonctions/photos importés) | `frontend/src/components/*.jsx`, `DetailsPanel.jsx` |
| En-têtes, CSP, Host, proxy | `frontend/nginx.conf`, `vite.config.js` (CSP du mode autonome) |
| Conteneurs | `*/Dockerfile`, `docker-compose*.yml` |
| Chaîne d'approvisionnement | `backend/pyproject.toml` + `uv.lock`, `package*.json`, `.github/workflows/` |

## 3. Traiter les constats

Pour chaque constat **confirmé** :

1. Écrire d'abord un test qui reproduit le problème (pytest, `node --test` ou Playwright) avec des données fictives.
2. Appliquer le correctif le plus petit, au dernier point de décision fiable, **dans les deux modes** si la règle est
   partagée (skill `modifier-regle-partagee`).
3. `make test` + `make security`, puis un audit ciblé (`quick`) pour confirmer la fermeture.

Constats `needs_validation` (dépendent du déploiement : réseau, poste, reverse proxy) : les documenter dans
`SECURITY.md` → *Limites connues*, avec la précaution à prendre.

## Règles

- Le rapport d'audit reste **hors du dépôt** (ou dans `.security-audit/`, ignoré par git) : il peut décrire des failles
  non corrigées. Ne jamais le committer.
- Jamais de vraies données, jamais de test sur une instance contenant de vraies données.
- Ne jamais affaiblir une protection existante (CSP, filtrage des colonnes, chiffrement, Host, non-root, verrouillage)
  pour faire passer un test ou un outil.
