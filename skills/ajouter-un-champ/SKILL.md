---
name: ajouter-un-champ
description: Ajouter une nouvelle information sur les collaborateurs (ex. service, date d'arrivée, bureau) à l'organigramme, de l'import jusqu'au PDF, en respectant la minimisation des données et le chiffrement. À utiliser seulement sur demande explicite du propriétaire du projet.
---

# Ajouter un champ au modèle

**Préalable obligatoire** : la règle de confidentialité (`AGENTS.md` §1.1) interdit d'ajouter un champ « au cas où ».
N'ajouter que sur **demande explicite** du propriétaire du projet, et seulement pour une information nécessaire à
l'organigramme. Refuser les données sensibles (santé, salaire, n° de sécurité sociale, date de naissance, opinions…).
Le champ sera **chiffré** comme les autres.

Exemple utilisé ci-dessous : `department` (« Service »).

## Liste de modifications (dans cet ordre)

1. **Import** — `backend/importer.py` et `frontend/src/core/importer.js` :
   - ajouter `"department"` à `FIELDS` (même position des deux côtés) ;
   - ajouter un motif à `PATTERNS` (en-têtes normalisés, sans accents : `service|departement|direction`), en vérifiant
     qu'il ne capte pas une colonne existante (ordre des motifs = priorité).
2. **Fusion** — `sync.py` et `core/sync.js` : lire le champ dans `build_records`/`buildRecords`, l'ajouter aux champs
   comparés (`labels`) et à l'écriture (`apply_plan`/`applyPlan`).
3. **Stockage serveur** — `db.py` : colonne `department TEXT` dans le schéma **et** dans `_migrate` (ALTER TABLE) ;
   chiffrer/déchiffrer partout avec le contexte `"employees.department"` : `tree.load_employees`, `sync.apply_plan`,
   `main.py` (`EmployeePatch`, `UPDATE_SQL`, `_restore`, `backup`), `vault.encrypt_existing`.
4. **Stockage autonome** — `data/localStore.js` : `updateEmployee`, `restore` (le reste est automatique : l'état entier
   est chiffré).
5. **Interface** — `ImportView.jsx` (`FIELDS` + libellé), `DetailsPanel.jsx` (champ modifiable), `PersonCard.jsx` /
   `OrgList.jsx` si affiché, recherche dans `core/tree.js` (`matches`) si utile.
6. **PDF** — `backend/pdf.py` (`Drawer.card`) seulement si le champ doit apparaître sur les cartes imprimées.
7. **Tests** :
   - fichiers d'exemple : ajouter la colonne dans `tools/sample-data/generate.py` (valeurs FICTIVES) et régénérer ;
   - pytest : import, réimport (changement détecté), PATCH, chiffrement au repos (`test_data_is_encrypted_at_rest`) ;
   - `core.test.js` : même scénario ;
   - mettre à jour `test_schema_has_only_known_columns` (`test_confidentialite.py`) : c'est voulu, ce test casse
     tant que le nouveau champ n'y est pas ajouté consciemment ;
   - Playwright : mapping proposé, affichage dans la fiche.
8. **Docs** — `AGENTS.md` §3.2 (tableau des champs) et §6, `README.md` (Utilisation), `SECURITY.md` (tableau
   « Collecte excessive »).
9. `make test`, `make static`, `make security`.

## Vérifications finales

- Le champ est chiffré au repos (aucune valeur lisible dans `org.db` ni dans IndexedDB).
- Une colonne non mappée du fichier n'est toujours ni importée ni affichée (`07-colonnes-sensibles.spec.js` vert).
- Les anciennes sauvegardes (sans le champ) se restaurent toujours.
