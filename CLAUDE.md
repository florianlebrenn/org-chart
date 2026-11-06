# Instructions pour l'agent

Les instructions de ce projet sont dans `AGENTS.md` (source unique, partagée par tous les agents de code) :

@AGENTS.md

Rappel des points essentiels :

- **Confidentialité** : seules les colonnes requises par l'outil (nom ou prénom+nom, fonction, site, email, téléphone,
  supérieur) sont lues. Toute autre colonne d'un fichier du personnel n'est ni importée, ni conservée, ni affichée, ni
  recopiée dans la conversation.
- Données toujours chiffrées (mot de passe + clé de secours) : ne jamais demander, afficher ou journaliser un mot de passe réel.
- Aucun appel réseau sortant, aucune donnée réelle dans le dépôt, aucune mention d'assistant IA dans les commits.
- Après un changement sensible et avant chaque publication : audit avec la skill `security-audit` (AGENTS.md §7), puis correction des constats et ajout d'un test.
- Skills du projet dans `skills/` (lien `.claude/skills`) : importer-fichier-personnel, tester-organigramme,
  modifier-regle-partagee, ajouter-un-champ, audit-securite, publier-version (voir AGENTS.md §9).
- `make test` doit être vert avant de rendre la main.
