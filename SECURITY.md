# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas ouvrir d'issue publique**. Utilisez le signalement privé de GitHub :
onglet **Security** du dépôt → **Report a vulnerability**. Indiquez la version (ou le commit), les étapes pour
reproduire avec des données **fictives**, et l'impact observé. Une réponse est apportée dès que possible.

Ne joignez jamais de vraies données du personnel à un signalement.

## Versions suivies

Seule la dernière version de la branche `main` reçoit des correctifs.

## Ce que l'application protège

| Menace | Protection |
|---|---|
| Copie du disque, du volume Docker, d'une sauvegarde ou du stockage du navigateur | Données chiffrées (AES-256-GCM). Clé de données enveloppée par le mot de passe et par une clé de secours (PBKDF2-HMAC-SHA256, 600 000 itérations). |
| Accès à l'application sans le mot de passe | Écran de déverrouillage ; API refusée sans session (cookie HttpOnly, SameSite=Strict) ; verrouillage après 15 min d'inactivité ; temporisation après plusieurs échecs. |
| Fuite de données vers Internet | Aucun appel sortant ; CSP stricte (`connect-src 'self'` en mode serveur, `'none'` en mode autonome) ; aucun CDN, aucune télémétrie. |
| Collecte excessive | Seules les colonnes utiles (nom, fonction, site, email, téléphone, supérieur) sont lues ; les autres ne sont ni importées, ni conservées, ni affichées. |
| Accès depuis le réseau local | Mode Docker : écoute sur `127.0.0.1` uniquement. |
| Page web malveillante visant l'API locale (DNS rebinding) | nginx refuse tout nom d'hôte autre que `localhost` / `127.0.0.1`. |
| Fichier Excel piégé | `defusedxml` (attaques XML), plafond de taille décompressée (« bombe zip »), limite de 20 Mo. |
| Conteneurs | Utilisateur non-root, aucune capacité Linux, `no-new-privileges`, backend en lecture seule. |

## Limites connues

- Une machine **compromise pendant que l'application est déverrouillée** (logiciel espion, extension de navigateur
  malveillante) peut lire les données affichées. Le chiffrement protège les données **au repos**.
- **Mot de passe et clé de secours perdus = données perdues.** C'est le principe du chiffrement : personne ne peut les
  récupérer. Gardez des sauvegardes (elles aussi chiffrées) et la clé de secours hors de l'ordinateur.
- Le mode Docker est prévu pour un usage **local** (`127.0.0.1`). Pour l'ouvrir sur un réseau, placez-le derrière un
  reverse proxy HTTPS, ajoutez le nom d'hôte dans `frontend/nginx.conf`, et faites auditer la configuration.
- Le serveur garde la clé de données en mémoire tant qu'une session est ouverte : quiconque a un accès administrateur
  à la machine hôte à ce moment-là peut, en théorie, la lire.

## Outils de contrôle

- Avant chaque commit (`make hooks`) : gitleaks (secrets), détection de données personnelles, ruff, bandit, contrôles génériques.
- Intégration continue (`.github/workflows/`) : tests complets dont Playwright sur l'image Docker, gitleaks sur
  l'historique, pip-audit (sur les versions figées par `uv.lock`), npm audit, bandit, hadolint, zizmor ; Dependabot
  avec délai de 14 jours.
- À activer dans les réglages GitHub du dépôt : *Secret scanning* + *Push protection*, *Private vulnerability
  reporting*, *CodeQL (default setup)*, protection de la branche `main` (contrôles `ci` et `security` obligatoires).
- Audit approfondi : skill [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
  voir `AGENTS.md` §7.
