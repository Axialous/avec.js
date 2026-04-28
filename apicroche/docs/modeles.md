# Modèles — fichiers `.sans`

Un fichier `.sans` décrit la structure d'une table : ses champs, leurs types, leurs contraintes et ses relations avec d'autres tables. Le cadriciel génère automatiquement la table correspondante en base de données.

Les **commentaires** commencent par `#` et s'étendent jusqu'à la fin de la ligne.

---

## Structure d'un modèle

Un modèle est composé d'**annotations** (commençant par `@`) et d'une liste de champs :

```
@primary [ id ]

@unique [
    [ email ]
]

@fields [
    {
        name : id
        type : char
        size : 12
    }

    {
        name  : email
        type  : char
        size  : 0-256
        count : 0-1
    }
]
```

---

## Options de recherche

Les fonctions `$search_all()` et `$search_one()` acceptent un paramètre `options` (quatrième paramètre) permettant de configurer la projection, le tri et la pagination.

### `select` — Projection de champs

Permet de spécifier quels champs et relations retourner pour chaque résultat.

#### Format

`select` doit être **une chaîne de caractères** avec champs séparés par `;`.

#### Syntaxe

- Les **champs physiques** sont nommés directement : `id`, `pseudonyme`, `date_inscription`
- Les **relations** sont nommées directement : `coordonnees`, `gerants`
- Les **relations imbriquées** utilisent la notation pointée : `relation.champ`
- Les **virgules `,` sont utilisées pour rester au même niveau** d'une relation
- Les **points `.` descendent d'un niveau** d'une relation

#### Exemples

```javascript
// Champs simples
{ select: 'id ; pseudonyme ; date_inscription' }

// Relation simple
{ select: 'id ; coordonnees' }

// Relation imbriquée — comptes avec leurs coordonnées, montrant seulement type et coordonnee
{ select: 'id ; coordonnees.type ; coordonnees.coordonnee' }

// Relation multi-niveaux — coordonnées avec compte.id et les profils dont il est gérant
// (pseudonyme et identifiant du profil seulement)
{ select: 'is_coordonnee_of_compte.id,is_gerant_of_profils.pseudonyme,identifiant' }
```

#### Algorithme de parsing

Pour un token comme `is_coordonnee_of_compte.id,is_gerant_of_profils.pseudonyme,identifiant` :

1. Détecte le premier `.` (après `is_coordonnee_of_compte`)
2. Extrait ce qui est avant (`is_coordonnee_of_compte`) → relation à descendre
3. Extrait ce qui est avant le premier `.` du reste (`id,is_gerant_of_profils`)
4. Cherche la **dernière virgule** avant ce point → `id` (traité au niveau courant)
5. Entre virgule et point → `is_gerant_of_profils` (relation à descendre)
6. Après le point → `pseudonyme,identifiant` (passe au niveau enfant)

#### Restrictions sur relations

Les paramètres `condition` de `$search_all()`, `$search_one()`, `$delete_one()`, `$delete_all()`, `$update_one()` et `$update_all()` peuvent cibler des champs de relations imbriquées.

Exemple :

```javascript
restriction : '$is_coordonnee_of_compte.is_gerant_of_profils.id = 0GWGVSSCJYWJQLP'
```

Le moteur génère alors les JOINs nécessaires et traduit la comparaison en SQL sur l’alias de la table cible. La même valeur est aussi réutilisée dans le filtrage applicatif final lorsque c’est nécessaire.

#### Log SQL

Les requêtes construites par le moteur sont affichées dans les logs avec leurs valeurs interpolées, afin de faciliter le débogage.

Exemple :

```text
[search_all] SQL: SELECT DISTINCT `coordonnees`.* FROM `coordonnees` JOIN ... WHERE `profils_2`.`id` = '0GWGVSSCJYWJQLP'
```

### `order` — Tri

Permet de trier les résultats par un champ.

```javascript
{ order: 'date_inscription' }        // croissant (défaut)
{ order: 'date_inscription', dir: 'DESC' }  // décroissant
```

### `dir` — Direction du tri

Peut valoir `'ASC'` (croissant, défaut) ou `'DESC'` (décroissant).

### `limit` — Nombre maximum de résultats

```javascript
{ limit: 10 }   // retourne au maximum 10 résultats
{ limit: null } // pas de limite (défaut)
```

### `offset` — Décalage (pour pagination)

```javascript
{ offset: 0 }    // début (défaut)
{ offset: 20 }   // décale de 20 résultats
```

#### Exemple complet avec pagination

```javascript
const resultats = await $search_all('profils',
    `$date_creation > $depuis`,
    { $depuis: new Date('2025-01-01') },
    {
        select: 'id ; pseudonyme ; gerants.id',
        order: 'date_creation',
        dir: 'DESC',
        limit: 50,
        offset: 100
    }
)
```

---

## Annotations

### `@name`

Permet de définir le nom de la table en base de données et, optionnellement, un **nom d'entrée** (utilisé pour nommer les clefs étrangères qui pointent vers cette table).

```
@name [ comptes, compte ]
```

- Le premier élément est le nom de la table.
- Le second (optionnel) est le nom d'entrée : les clefs étrangères seront nommées `id_<nom_entree>` (ex. `id_compte`).

Si `@name` est absent, le nom du fichier `.sans` (sans extension) est utilisé comme nom de table.

### `@primary`

Déclare la clef primaire de la table. Prend une liste de noms de champs.

```
@primary [ id ]
```

### `@unique`

Déclare une ou plusieurs contraintes d'unicité. Chaque contrainte est une liste de champs (une contrainte composite peut porter sur plusieurs champs à la fois).

```
@unique [
    [ email ]
    [ nom prenom ]
]
```

> **Note :** lorsqu'un champ de type `hash` fait partie d'une contrainte `@unique`, un algorithme de hachage déterministe est utilisé afin qu'une même valeur produise toujours le même hash, permettant la comparaison.

### `@fields`

Déclare la liste des champs de la table. Chaque champ est un bloc `{ }` contenant ses propriétés.

---

## Propriétés d'un champ

| Propriété | Obligatoire | Description |
|---|---|---|
| `name` | oui | Nom du champ (et de la colonne en base) |
| `type` | oui (sauf relation) | Type du champ |
| `size` | non | Taille ou longueur maximale |
| `count` | non | Cardinalité — défaut : `1-1` |
| `ref` | non | Nom de la table liée (si différent de `name`) |

### `type`

Détermine le type de la colonne en base de données :

| Type | Description | Équivalent SQL |
|---|---|---|
| `char` | Texte à longueur fixe ou variable (selon `size`) | `CHAR` / `VARCHAR` |
| `text` | Texte long | `TEXT` |
| `int` | Nombre entier | `INTEGER` |
| `date` | Date seule | `DATE` |
| `datetime` | Date et heure | `DATETIME` |
| `boolean` | Valeur vraie ou fausse | `BOOLEAN` |
| `hash` | Valeur hachée (non réversible) | `CHAR` / `BINARY(32)` |
| `crypt` | Valeur chiffrée (réversible) | `BINARY` / `VARBINARY` |
| `a/b/c` | Type énuméré — valeur stockée directement, validée par le cadriciel | `VARCHAR` |

### `size`

Indique la taille du champ.

- Une valeur fixe (`size : 12`) produit un type à longueur fixe (ex. `CHAR(12)`).
- Une valeur préfixée par `0-` (`size : 0-256`) produit un type à longueur variable (ex. `VARCHAR(256)`), signifiant que le contenu peut être vide.

### `count`

Indique la cardinalité du champ ou de la relation :

| `count` | Signification |
|---|---|
| `1-1` | Valeur obligatoire — une et une seule *(défaut)* |
| `0-1` | Valeur optionnelle — zéro ou une |
| `1-N` | Relation obligatoire — une au minimum |
| `0-N` | Relation optionnelle — zéro ou plusieurs |
| `N-N` | Relation many-to-many — table de jonction générée automatiquement (voir ci-dessous) |

### Tables de jonction (relation `N-N`)

Lorsqu'une relation `N-N` est déclarée, sans.js génère automatiquement une **table de jonction** nommée :

```
<name_du_champ>_<entree_de_la_table_cible>
```

C'est le `name` du champ de relation (pas le nom de la table source) qui sert de préfixe, ce qui permet d'avoir plusieurs relations N-N vers la même table cible sans collision.

Cette table contient deux colonnes :

| Colonne | Type | Description |
|---|---|---|
| `id_<entree_source>` | même type que la PK source | Référence vers l'entrée source |
| `id_<entree_cible>` | même type que la PK cible | Référence vers l'entrée cible |

La **clef primaire composite** porte sur les deux colonnes.

```
# modèle articles — deux relations N-N vers profils (entry_name: profil)
{ name: auteurs   ref: profils   count: N-N }  →  table auteurs_profil
{ name: lecteurs  ref: profils   count: N-N }  →  table lecteurs_profil
```

### `ref`

Dans le cas d'une relation, permet de nommer le champ différemment de la table qu'il référence.

```
@fields [
    {
        name  : contacts
        ref   : coordonnees
        count : 0-N
    }
]
```

Ici, le champ s'appelle `contacts` mais pointe vers la table `coordonnees`. Sans `ref`, le `name` est utilisé directement pour résoudre la table liée.

---

## Hooks de création

Pour les routes `POST` automatiques générées par sans.js, un champ peut définir des hooks :

| Propriété | Moment d'exécution | Description |
|---|---|---|
| `can_create` | avant insertion | Condition augure à valider (`403` si faux) |
| `prior_create` | juste avant l'`INSERT` SQL | Appel d'une fonction du bloc `@script` |
| `post_create` | juste après l'`INSERT` SQL | Appel d'une fonction du bloc `@script` |

Exemple :

```
{
    name         : code
    type         : hash
    can_create   : "$type = authentification"
    prior_create : $preparer_code($values)
    post_create  : $notifier_creation($values)
}
```

Les fonctions appelées par `prior_create` et `post_create` doivent être déclarées dans `@script`.

Dans ces scripts, le cadriciel injecte aussi `$add_to_data(key, value)` :

- Cela ajoute `value` à la clef `key` de l'objet `data` de la réponse API.
- Cela fonctionne aussi bien avec une réponse explicite via `$indicate(...)` qu'avec la réponse automatique `201 Créé`.

Les arguments reconnus sont :

| Argument | Valeur |
|---|---|
| `$body` | Corps JSON brut de la requête |
| `$values` | Valeurs prêtes à être insérées (et, en `post_create`, enrichies avec les valeurs auto générées lors de la création, comme l'identifiant primaire) |

---

## Exemple complet

```
@primary [ id ]

@unique [
    [ hachage_coordonnee ]
]

@fields [
    {
        name : id
        type : char
        size : 15
    }

    {
        name : type
        type : courriel/telephone
        size : 0-16
    }

    {
        name : coordonnee
        type : crypt
        size : 0-512
    }

    {
        name : hachage_coordonnee
        type : hash
    }

    {
        name : est_principale
        type : boolean
    }
]
```
