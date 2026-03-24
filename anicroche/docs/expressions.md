# Expressions

Les expressions permettent de calculer des valeurs dans les conditions, les boucles, les attributs et les arguments. Elles s'écrivent entre crochets `[…]`.

```
@if [$compteur > 0]
<div class="theme-$theme" style="opacity: $opacite">
```

---

## Variables

### Variables de scope

Les variables de scope sont des variables réactives préfixées par `$`. Elles sont accessibles dans les expressions, les textes et les scripts.

Chaque instance de modèle possède son propre scope. La résolution d'une variable se fait en remontant la chaîne des scopes : modèle courant → parent → ... → racine.

```
@if [$connecte]

<div class="theme-$theme">

"Bonjour $nom !"
```

Lorsqu'une variable de scope change de valeur, le cadriciel met à jour automatiquement toutes les parties du DOM qui en dépendent.

Si une variable existe déjà dans un scope parent, une affectation depuis un enfant met à jour la variable du parent.

Si une variable n'existe dans aucun parent, l'affectation crée la variable dans le scope courant.

**Variables de scope prédéfinies à la racine** (gérées automatiquement par le cadriciel) :

| Variable | Type | Description |
|---|---|---|
| `$path` | texte | Chemin de l'URL courante (ex : `/page/42`) |
| `$params` | dictionnaire | Paramètres de l'URL (ex : `{q: "recherche"}`) |
| `$hash` | texte | Fragment de l'URL (ex : `#section`) |
| `$navigate` | fonction | Navigue vers une URL (`$navigate('/connexion')`, `$navigate('/article/42?q=test')`) |

Ces variables sont mises à jour à chaque navigation sans rechargement de page.

### Arguments de modèle

Les arguments déclarés via `@args` sont des variables locales à l'instance du modèle. Ils s'utilisent dans les expressions, les textes et les scripts.

Les arguments sont **en lecture seule** : toute tentative d'affectation d'un argument provoque une erreur.

En cas de conflit de nom, `@args` est prioritaire sur les variables de scope.

```
@args [$titre, $couleur : "bleu"]

<h1 style="color: $couleur">
    "$titre"
```

### Variables de nœud

Les variables de nœud (`$vars`) permettent de stocker des données associées à un élément DOM précis. Elles persistent entre le montage et le démontage de l'élément, mais ne sont **accessibles que dans les scripts** (`@script`, `@mount`, `@unmount` et gestionnaires d'événements) — pas dans les expressions ni les textes du gabarit.

```
@script [
    $monter = ($node, $vars) =>
    {
        $vars.intervalle = setInterval(() => { ... }, 1000)
    }

    $demonter = ($node, $vars) =>
    {
        clearInterval($vars.intervalle)
        $vars.intervalle = null
    }
]

<div
    @mount="$monter($node, $vars)"
    @unmount="$demonter($node, $vars)"
>
```

### Accès profond

Les variables de type liste ou dictionnaire supportent l'accès à leurs éléments par notation pointée ou par index :

```
@if [$utilisateur.actif]

"$utilisateur.nom"

@if [$liste[0] = "premier"]
```

---

## Littéraux

| Type | Syntaxe | Exemples |
|---|---|---|
| Nombre | Chiffres, `.` pour les décimaux, `_` comme séparateur visuel | `42`, `3.14`, `-7`, `1_000_000` |
| Texte | Entre guillemets simples, doubles ou obliques | `"bonjour"`, `'monde'`, `` `texte` `` |
| Booléen vrai | `:)` | `@if [:)]` |
| Booléen faux | `:(` | `@unless [:(]` |
| Erreur | `:x` | (résultat interne, rarement utilisé directement) |
| Liste | `[elem1, elem2, …]` | `[1, 2, 3]`, `["a", "b"]` |
| Dictionnaire | `{clef: valeur, …}` | `{nom: "Alice", age: 30}` |

---

## Opérateurs

### Arithmétiques

| Opérateur | Description | Exemple |
|---|---|---|
| `+` | Addition | `$a + 1` |
| `-` | Soustraction | `$total - $remise` |
| `*` | Multiplication | `$prix * 2` |
| `/` | Division | `$valeur / 100` |
| `%` | Modulo | `$n % 2` |
| `^` | Puissance | `2 ^ 8` |

### Comparaison

| Opérateur | Description |
|---|---|
| `=` | Égalité (numérique ou textuelle) |
| `!=` | Différence |
| `>` | Supérieur |
| `>=` | Supérieur ou égal |
| `<` | Inférieur |
| `<=` | Inférieur ou égal |

Les comparaisons peuvent être **chaînées** : `1 < $n < 10` est équivalent à `1 < $n & $n < 10`.

### Logiques

| Opérateur | Description |
|---|---|
| `&` | Et logique (court-circuit : le membre droit n'est pas évalué si le gauche est faux) |
| `\|` | Ou logique (court-circuit : le membre droit n'est pas évalué si le gauche est vrai) |
| `!` | Non logique |

### Appartenance

Ces opérateurs vérifient si une valeur est présente dans une liste, ou si une clé est présente dans un dictionnaire.

| Opérateur | Description | Exemple |
|---|---|---|
| `a -{ b` | `a` est contenu dans `b` | `$role -{ ["admin", "modo"]` |
| `a !-{ b` | `a` n'est pas contenu dans `b` | `$role !-{ $roles_interdits` |
| `b }- a` | `b` contient `a` | `$liste }- $element` |
| `b !}- a` | `b` ne contient pas `a` | `$dict !}- "clef"` |

```
@if [$role -{ ["admin", "moderateur"]]
    "Menu d'administration"
```

### Filtrage de texte

| Opérateur | Description | Exemple |
|---|---|---|
| `texte :+ "chars"` | Garde uniquement les caractères listés dans `chars` | `$saisie :+ "0123456789"` |
| `texte :- "chars"` | Supprime les caractères listés dans `chars` | `$saisie :- " \t"` |

```
# Ne conserver que les chiffres d'une saisie :
@if [($saisie :+ "0123456789") = $saisie]
    "La saisie est un nombre valide"
```

### Correspondance de motif (`~=`)

L'opérateur `~=` vérifie si un texte correspond à un motif. Il peut capturer des segments du texte dans des variables réactives.

**Correspondance simple :**

```
@if [$path ~= '/accueil']
```

**Capture d'un segment dans une variable réactive :**

```
@if [$path ~= '/<$id>']
# $id contient la partie capturée
```

**Capture avec caractères autorisés (`:+`) — s'arrête dès qu'un caractère non listé est rencontré :**

```
@if [$path ~= '/<$id :+ abcdefghijklmnopqrstuvwxyz0123456789->']
```

**Capture avec caractères d'arrêt (`:−`) — s'arrête dès qu'un caractère listé est rencontré :**

```
@if [$path ~= '/<$id :- />']
```

**Arrêt sur le caractère suivant immédiatement le `>` du gabarit :**

```
@if [$path ~= '/<$section>/<$id>']
# $section capture tout jusqu'au premier /, $id capture tout jusqu'à la fin
```

Les variables capturées sont écrites dans le scope courant (ou dans un parent si la variable existe déjà) et immédiatement disponibles dans les expressions, les textes et les scripts.

**Exemple complet — routeur :**

```
@if [$path ~= '/']
    page-accueil

@else-if [$path ~= '/article/<$id :+ 0123456789>']
    page-article $id

@else
    page-404
```
