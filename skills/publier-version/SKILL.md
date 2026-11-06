---
name: publier-version
description: Préparer une publication open source (push sur GitHub, version taguée) de l'organigramme — vérification des données personnelles, des mentions, de la licence, des tests et des réglages de sécurité GitHub. À utiliser avant chaque push public ou création de version.
---

# Publier une version

## 1. Rien de personnel ni de sensible

```bash
git status                       # aucun fichier inattendu (xlsx, csv, json de sauvegarde, db, pdf, captures)
make security                    # inclut gitleaks sur tout l'historique et le garde-fou « données personnelles »
```

Puis rechercher (en ignorant `node_modules`) :

- toute mention d'une **entreprise réelle**, d'un client, d'une personne réelle ou du contexte privé de l'auteur ;
- toute adresse email hors `@entreprise.test` / `example.*`, tout téléphone hors de la plage `06 39 98` ;
- toute mention d'un **assistant IA** dans le code, la doc ou les messages de commit (`git log --format=%B`) ;
  seuls `AGENTS.md`, `CLAUDE.md`, `.claude/` et `skills/` s'adressent aux agents ;
- tout chemin de machine personnelle (`/Users/…`, `C:\Users\…`).

Les données d'exemple doivent rester **fictives** (`tools/sample-data/`, régénérables par `generate.py`).

## 2. Licence et mentions

- `LICENSE` : MIT, avec le copyright du projet d'origine (Vinit Shahdeo, org.chart) **et** celui de l'auteur.
- `README.md` : section *Auteurs et licence* à jour ; dans l'application, le pied de page cite l'auteur.
- Composants tiers : licences listées dans le README ; `LICENSE-swagger-ui.txt` et `NOTICE-swagger-ui.txt` copiés
  dans le build (Apache-2.0).

## 3. Qualité

```bash
make test        # ruff + pytest + node --test + Playwright (deux modes), sans fenêtre
make static      # static/organigramme.html à jour (la CI le vérifie)
```

- `README.md`, `AGENTS.md`, `SECURITY.md` décrivent le comportement actuel.
- Changements sensibles depuis la dernière version : audit (skill `audit-securite`).

## 4. GitHub (une fois, puis vérifier)

Dans *Settings* du dépôt :

- *Code security* : **Secret scanning** + **Push protection**, **Private vulnerability reporting**,
  **Dependabot alerts**, **CodeQL** (*default setup*).
- *Branches* : protection de `main` — PR obligatoire, contrôles `ci` et `security` requis, pas de force-push.
- *Actions* : permissions par défaut en lecture seule.

## 5. Version

- Mettre à jour la version (`frontend/package.json`, `backend/pyproject.toml` puis `uv lock`, `version` de FastAPI
  dans `backend/main.py`).
- Tag `vX.Y.Z` et notes de version : nouveautés, correctifs de sécurité (sans détail exploitable avant correction).
- Joindre `static/organigramme.html` à la release pour les utilisateurs sans Docker.
