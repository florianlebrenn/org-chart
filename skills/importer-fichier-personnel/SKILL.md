---
name: importer-fichier-personnel
description: Préparer et importer un vrai fichier du personnel (Excel/CSV) dans l'organigramme en ne lisant que les colonnes utiles. À utiliser dès qu'on doit inspecter, nettoyer, convertir ou importer un fichier de collaborateurs réel.
---

# Importer un fichier du personnel (sans exposer les autres colonnes)

Un fichier RH contient souvent salaire, date de naissance, n° de sécurité sociale, adresse, commentaires… **L'outil
n'utilise que** : nom complet *ou* prénom + nom, fonction, site, email, téléphone, supérieur. Tout le reste ne doit être
ni lu, ni affiché, ni recopié (conversation, journaux, tests, commits). Voir `AGENTS.md` §1 et §3.

## 1. Regarder seulement les en-têtes

```bash
uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py chemin/personnel.xlsx --entetes
```

Le script affiche les feuilles, la ligne d'en-têtes détectée, les en-têtes et le mapping proposé, **sans aucune valeur
de cellule**. N'ouvrez pas le fichier autrement (pas de `cat`, `head`, pandas `print(df)`, etc.).

## 2. Vérifier le mapping

| Champ | Requis | En-têtes reconnus (exemples) |
|---|---|---|
| `name` **ou** `first_name` + `last_name` | oui | « Nom complet », « Collaborateur » / « Prénom », « Nom » |
| `title` | non | « Fonction », « Poste » |
| `site` | conseillé | « Site », « Bâtiment de rattachement » |
| `email`, `phone` | non | « Mail », « Téléphone » |
| `manager` | non | « Supérieur hiérarchique », « N+1 », « Manager » |

Si un en-tête utile n'est pas reconnu, choisissez-le explicitement (`--garder`, ou dans l'écran d'import).
Si la seule colonne « nom » est ambiguë, demandez à la personne plutôt que d'ouvrir les données.

## 3. (Facultatif) produire une copie réduite

```bash
uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py personnel.xlsx -o personnel_organigramme.xlsx
# ou avec un choix explicite :
uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py personnel.xlsx \
  --garder "Nom,Prénom,Poste,Site,Supérieur hiérarchique" -o personnel_organigramme.xlsx
```

L'application filtre de toute façon elle-même ; la copie réduite sert à limiter ce qui circule. Elle contient encore
des données personnelles : **à importer puis à supprimer, jamais à committer** (le hook `donnees-personnelles` la bloque).

## 4. Importer

- **Interface** (recommandé) : déverrouiller → *Importer* → déposer le fichier → vérifier les colonnes (l'aperçu ne
  montre que les colonnes retenues et liste le nom des colonnes ignorées) → *Vérifier l'import* → *Confirmer*.
- **API** (mode serveur) : voir `AGENTS.md` §4.2 (session obligatoire, mot de passe saisi de façon masquée).

## 5. Contrôler le résultat

Lire le récapitulatif de simulation **avant** de confirmer :
- *Retirés* : des personnes absentes du fichier seront supprimées de l'organigramme ;
- *Points d'attention* : homonymes, supérieur introuvable, boucle, sans site, subordonnés qui perdent leur supérieur.

Rapporter à la personne uniquement des compteurs et des noms signalés par l'outil, jamais d'autres colonnes.

## 6. Nettoyer

Supprimer les copies intermédiaires (fichier réduit, exports). Ne laisser aucun fichier de données dans le dépôt.
