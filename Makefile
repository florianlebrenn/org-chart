# Organigramme — commandes usuelles.  `make` ou `make help` pour la liste.
#
# Prérequis : Docker Desktop. Node.js n'est nécessaire QUE pour voir les tests dans un navigateur
# (make e2e-headed / e2e-ui) ; sans Node, `make test` et `make e2e-docker` passent par Docker.

SHELL        := /bin/bash
COMPOSE      := docker compose
# Port de l'instance de test : 8081 par défaut ; s'il est déjà pris, par ex. `make e2e TEST_PORT=8091`
TEST_PORT    ?= 8081
TEST_COMPOSE := TEST_PORT=$(TEST_PORT) docker compose -p orgchart-test -f docker-compose.test.yml
BASE_URL     ?= http://localhost:$(TEST_PORT)
SLOWMO       ?= 600
NODE_IMG     := node:22-alpine
UV_IMG       := ghcr.io/astral-sh/uv:0.13.5-python3.12-trixie-slim
PW_IMG       := mcr.microsoft.com/playwright:v1.63.0-noble
NO_TRACK     := -e DO_NOT_TRACK=1 -e SCARF_ANALYTICS=false
# node_modules, environnement Python (.venv) et cache uv dans des volumes Docker : rien de compilé pour Linux
# n'atterrit dans le dossier
# Tout le dépôt est monté : les tests JS relisent les fichiers fictifs de tools/sample-data
NODE_RUN     := docker run --rm $(NO_TRACK) -v "$(CURDIR)":/src -v orgchart-node-modules:/src/frontend/node_modules \
                -w /src/frontend $(NODE_IMG)
PY_RUN       := docker run --rm -e UV_PROJECT_ENVIRONMENT=/venv -e UV_PYTHON_DOWNLOADS=never -e UV_LINK_MODE=copy \
                -v "$(CURDIR)":/src -v orgchart-uv-venv:/venv -v orgchart-uv-cache:/root/.cache/uv -w /src/backend $(UV_IMG)
FRONT_SRC    := $(shell find frontend/src frontend/index.html frontend/vite.config.js frontend/package.json -type f 2>/dev/null)
PW           := cd e2e && BASE_URL=$(BASE_URL) npx playwright test

.DEFAULT_GOAL := help
.PHONY: help up down logs restart static test test-back test-front e2e e2e-headed e2e-ui e2e-server \
        e2e-static e2e-report e2e-docker e2e-install e2e-stack-up e2e-stack-down need-node clean-test \
        hooks security lint format

help: ## Afficher cette aide
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1mmake %-15s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------------ application

up: ## Lancer l'application (http://localhost:8080)
	$(COMPOSE) up -d --build --wait
	@echo "→ http://localhost:8080   (API : http://localhost:8080/api/docs)"

down: ## Arrêter l'application (les données sont conservées)
	$(COMPOSE) down

restart: down up ## Redémarrer l'application

logs: ## Voir les journaux
	$(COMPOSE) logs -f --tail=100

static: static/organigramme.html ## Construire le fichier HTML autonome (mode sans Docker)

static/organigramme.html: $(FRONT_SRC)
	$(NODE_RUN) sh -c "npm ci --no-audit --no-fund --loglevel=error && npm run build:static"
	@mkdir -p static && cp frontend/dist-static/index.html static/organigramme.html
	@echo "→ static/organigramme.html"

# ------------------------------------------------------------------ tests rapides (sans fenêtre)

test: lint test-back test-front e2e ## TOUS les tests rapides : ruff + backend + logique JS + scénarios navigateur (headless)

test-back: ## Tests du backend (pytest, dépendances figées par uv.lock)
	$(PY_RUN) sh -c "uv sync --frozen -q && uv run --frozen pytest -q"

lint: ## Analyse et format du code Python (ruff, sans rien modifier)
	$(PY_RUN) sh -c "uv sync --frozen -q && cd .. && uv run --project backend --frozen ruff check . && \
	  uv run --project backend --frozen ruff format --check ."

format: ## Corriger automatiquement le code Python (ruff check --fix, puis ruff format)
	$(PY_RUN) sh -c "uv sync --frozen -q && cd .. && uv run --project backend --frozen ruff check --fix . && \
	  uv run --project backend --frozen ruff format ."

test-front: ## Tests de la logique JS du mode autonome (node --test)
	$(NODE_RUN) sh -c "npm ci --no-audit --no-fund --loglevel=error && npm test"

# ------------------------------------------------------------------ scénarios Playwright
# Ils tournent sur l'instance de TEST (port 8081, données séparées) et sur static/organigramme.html.

e2e-stack-up: ## Démarrer l'instance de test (port 8081, ou TEST_PORT=…)
	@if [ "$(TEST_PORT)" = "8080" ]; then echo "TEST_PORT=8080 refusé : c'est le port de la vraie application."; exit 1; fi
	$(TEST_COMPOSE) up -d --build --wait

e2e-stack-down: ## Arrêter et vider l'instance de test
	$(TEST_COMPOSE) down -v

need-node:
	@command -v npx >/dev/null 2>&1 || { echo "Node.js n'est pas installé : utilisez 'make e2e-docker' (sans fenêtre) ou installez Node 22 (https://nodejs.org)."; exit 1; }
	@test -d e2e/node_modules/@playwright/test || { echo "Première fois : installation de Playwright…"; $(MAKE) e2e-install; }

e2e-install: ## Installer Playwright + Chromium (une seule fois, nécessite Node.js)
	cd e2e && DO_NOT_TRACK=1 npm ci --no-audit --no-fund && npx playwright install chromium

e2e: need-node static e2e-stack-up ## Scénarios, sans fenêtre (rapide)
	$(PW)

e2e-headed: need-node static e2e-stack-up ## Scénarios dans un navigateur visible et ralenti (SLOWMO=600 ms)
	SLOWMO=$(SLOWMO) $(PW) --headed

e2e-ui: need-node static e2e-stack-up ## Interface Playwright : rejouer / inspecter un scénario pas à pas
	$(PW) --ui

e2e-server: need-node e2e-stack-up ## Scénarios du mode serveur uniquement
	$(PW) --project=serveur $(if $(HEADED),--headed)

e2e-static: need-node static ## Scénarios du mode autonome uniquement (fichier HTML)
	$(PW) --project=autonome $(if $(HEADED),--headed)

e2e-report: need-node ## Ouvrir le rapport du dernier passage (captures, traces)
	cd e2e && npx playwright show-report

e2e-docker: static e2e-stack-up ## Scénarios sans fenêtre, dans Docker (sans Node.js local)
	docker run --rm --ipc=host $(NO_TRACK) -v "$(CURDIR)":/work -v orgchart-e2e-modules:/work/e2e/node_modules -w /work/e2e \
	  --network orgchart-test_default -e BASE_URL=http://frontend:8080 $(PW_IMG) \
	  sh -c "npm ci --no-audit --no-fund --loglevel=error && npx playwright test"

# ------------------------------------------------------------------ sécurité

GITLEAKS_IMG := ghcr.io/gitleaks/gitleaks:v8.30.1
HADOLINT_IMG := hadolint/hadolint:v2.15.1

hooks: ## Installer les contrôles avant commit (gitleaks, données personnelles, bandit…) — dépôt git requis
	@test -d .git || { echo "Initialisez d'abord le dépôt : git init"; exit 1; }
	@command -v pre-commit >/dev/null 2>&1 || pipx install pre-commit==4.7.0 || python3 -m pip install --user pre-commit==4.7.0
	pre-commit install
	pre-commit run --all-files

security: ## Contrôles de sécurité (dans Docker) : secrets, données personnelles, dépendances, code, Dockerfiles
	@if [ -d .git ]; then \
	  docker run --rm -v "$(CURDIR)":/repo -w /repo $(GITLEAKS_IMG) git --redact --no-banner /repo && \
	  git ls-files -z | xargs -0 python3 tools/hooks/check_data_files.py; \
	else \
	  docker run --rm -v "$(CURDIR)":/repo -w /repo $(GITLEAKS_IMG) dir --redact --no-banner /repo && \
	  find . -type f -not -path '*/node_modules/*' -not -path './frontend/dist*' -not -path './e2e/test-results/*' \
	    -not -path './e2e/playwright-report/*' -not -path './_archives/*' -not -path './backend/.venv/*' -print0 | xargs -0 python3 tools/hooks/check_data_files.py; \
	fi
	$(PY_RUN) sh -c "uv export --frozen --no-dev --no-emit-project --format requirements-txt -q -o /tmp/requirements.txt && \
	  uvx pip-audit@2.10.1 -r /tmp/requirements.txt --disable-pip --require-hashes && \
	  uvx bandit@1.9.4 -q -r . -x ./tests,./.venv"
	$(NODE_RUN) sh -c "npm audit --audit-level=moderate"
	docker run --rm -i $(HADOLINT_IMG) < backend/Dockerfile
	docker run --rm -i $(HADOLINT_IMG) < frontend/Dockerfile
	@echo "✓ Contrôles de sécurité terminés"

clean-test: e2e-stack-down ## Supprimer l'instance de test, rapports et caches de test
	rm -rf e2e/test-results e2e/playwright-report
	-docker volume rm orgchart-node-modules orgchart-uv-venv orgchart-uv-cache orgchart-e2e-modules 2>/dev/null
