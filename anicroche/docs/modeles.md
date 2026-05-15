# Modèles — fichiers `.avec`

Un fichier `.avec` décrit un fragment d'interface réutilisable. Il est composé de **blocs** organisés par **indentation** (espaces uniquement — les tabulations sont interdites). Les blocs plus indentés sont les enfants du bloc précédent.

Les **commentaires** commencent par `#` et s'étendent jusqu'à la fin de la ligne.

```
# Ceci est un commentaire
<div>
    "Bonjour" # Ceci aussi
```

Un bloc peut être :
- une [instruction](#instructions-) (commence par `@`)
- une [balise HTML](#balises-html) (commence par `<`)
- un [texte](#textes) (entre guillemets `"`, `'` ou `` ` ``)
- un [appel de modèle](#appels-de-modèles) (nom du modèle)

---

## Instructions `@`

### `@style`

Déclare les styles CSS du modèle. Ils sont injectés dans la page au montage du modèle et retirés à son démontage.

```
@style [
    .ma-classe {
        color: red;
    }
]
```

### `@script`

Déclare du code JavaScript exécuté une fois lors du premier chargement d'une instance de modèle. Typiquement utilisé pour initialiser des variables de scope ou déclarer des fonctions.

Le bloc `@script` est du JavaScript standard : il utilise `true`, `false` et `null` comme n'importe quel code JS, et les chaînes `:)`, `:(`, `:x` ou `:o` y restent de simples textes.

```
@script [
    $compteur = 0

    $incrementer = () => { $compteur++ }
]
```

> **Note :** `@script` est exécuté une seule fois **par instance de modèle** (c'est-à-dire par scope). Les variables déclarées dans `@script` sont accessibles à cette instance et à tous ses enfants. Pour du code lié à un nœud DOM spécifique, utiliser les événements `@mount` / `@unmount`.

### `@args`

Déclare les paramètres acceptés par le modèle. Les valeurs sont passées lors de l'appel du modèle entre crochets, en positionnel et/ou en nommé.
Une valeur par défaut peut être déclarée avec `:`.

```
@args [$titre, $description : "Aucune description"]
```

Les arguments sont séparés par `,` ou par un retour à la ligne.

```
@args [
    $titre,
    $couleur : bleu,
    $message : 'Bonjour'
]
```

Les arguments sont accessibles dans les textes, les expressions et les scripts (`@script`, événements, `@mount`, `@unmount`).

Les arguments sont **en lecture seule** : une affectation sur un argument déclenche une erreur.

En cas de conflit de nom, `@args` est prioritaire sur une variable de scope.

### Conditionnelles

```
@if [$condition]
    "affiché si la condition est vraie"

@else-if [$autre-condition]
    "affiché si l'autre condition est vraie"

@else
    "affiché sinon"
```

`@unless` est l'inverse de `@if` : le bloc est affiché si la condition est **fausse**.

```
@unless [$connecte]
    "Veuillez vous connecter"
```

Ces blocs sont **réactifs** : si une variable de scope utilisée dans la condition change, le contenu se met à jour automatiquement.

### Boucles

**Répétition n fois :**

```
@repeat [3]
    "Je suis répété trois fois"
```

**Tant que** (évalue la condition avant chaque itération) :

```
@while [$condition]
    "affiché tant que la condition est vraie"
```

**Jusqu'à ce que** (évalue la condition avant chaque itération) :

```
@until [$condition]
    "affiché tant que la condition est fausse"
```

**Faire… tant que** (exécute au moins une fois, puis évalue la condition) :

```
@repeat
    "contenu exécuté au moins une fois"
@while [$condition]
```

**Faire… jusqu'à ce que** (exécute au moins une fois, puis évalue la condition) :

```
@repeat
    "contenu exécuté au moins une fois"
@until [$condition]
```

> Dans les formes `@repeat` + `@while`/`@until`, les deux instructions doivent être au même niveau d'indentation (sœurs dans le même bloc parent).

**Parcours de collection** :

```
@for-each $element of $elements
    "affiché pour chaque valeur (tableau ou itérable)"

@for-each $i in $elements
    "affiché pour chaque indice (0,1,2...)"

@for-each $k in $objet
    "affiché pour chaque clé d'objet"

@for-each $v of $objet
    "affiché pour chaque valeur d'objet"

`in` renvoie les clés/indices : indices numériques pour tableaux et chaînes, clés pour objets.
`of` renvoie les valeurs : éléments pour tableaux/itérables, caractères pour chaînes, valeurs pour objets.
`in` parcourt les clés ou indices, `of` parcourt les valeurs ou l'itérable selon la source.

### `@static`

Désactive la **réactivité** des instructions enfantes directes. Exception au démarrage : si une dépendance vaut `null` au montage, elle reste surveillée jusqu'à ce qu'elle passe à une valeur non-`null` — à ce moment la transition se déclenche une dernière fois, puis la réactivité s'arrête définitivement pour cette dépendance.

```
@static
    @if [$authentification = interdite & $connecte]
        "Déjà connecté"

    @else-if [$authentification = requise & ! $connecte]
        "Pas encore connecté"

    @else
        contenu-par-defaut
```

Cela est utile pour :

- Les branches conditionnelles qui ne doivent pas être réévaluées après le chargement initial (optimisation performance).
- Les décisions prises une seule fois, au montage du modèle.
- Les données chargées tardivement (`null` au départ), figées après leur première résolution.

> **Note :** `@static` n'affecte que les **enfants directs** (première génération). Les instructions imbriquées plus profondément conservent leur réactivité normale.

### `@stud`

Marque un emplacement où le contenu passé en enfant lors de l'appel du modèle sera inséré. Un modèle peut en contenir plusieurs : le contenu apparaîtra à chacun des emplacements.

```
# Modèle "encart" :
<section>
    <h2>
        @stud
    <p>
        @stud

# Appel — le titre et le paragraphe affichent tous deux le même contenu :
encart
    "Mon texte injecté"
```

---

## Balises HTML

Une balise s'écrit avec les chevrons HTML, suivie d'attributs optionnels :

```
<div .ma-classe #mon-id attribut-booleen attribut="valeur">
    "enfant"
```

### Attributs

| Syntaxe | Effet |
|---|---|
| `.classe` | Ajoute une classe CSS |
| `#id` | Définit l'identifiant |
| `attr` seul | Attribut booléen (ex : `disabled`, `hidden`) |
| `attr="valeur"` | Attribut avec valeur (supporte l'interpolation de variables `$var`) |
| `class="a b"` | Définit les classes CSS (remplace les précédentes) |

### Attributs conditionnels

Un attribut peut être appliqué conditionnellement avec la syntaxe :

```
[condition] ? attribut
```

Avec une branche alternative :

```
[condition] ? attribut_si_vrai : attribut_si_faux
```

La condition suit la même syntaxe que `@if` / `@else-if` / `@unless`.

Exemples :

```
<input
    .champ
    [$requis] ? required
    [!$modifiable] ? readonly
>

<button
    [$actif] ? .actif : .inactif
    [$edition] ? @click="$enregistrer()" : @click="$ouvrir()"
>
```

Les attributs conditionnels sont réactifs : quand la condition change, l'attribut appliqué est mis à jour automatiquement.

### Gestionnaires d'événements

Les événements DOM s'écrivent avec le préfixe `@` ou `on` :

```
<button @click="$compteur++">
<input onchange="$valeur = $event.target.value">
```

Dans le script du gestionnaire, les variables suivantes sont disponibles, et elles restent accessibles dans toute fonction appelée depuis ce script (fonctions imbriquées, callbacks passés en argument, etc.) :

| Variable | Description |
|---|---|
| `$event` | L'objet événement DOM |
| `$node` | L'élément DOM sur lequel l'événement s'est produit |
| `$vars` | Les [variables de nœud](expressions.md#variables-de-nœud) de l'élément |

**Événements spéciaux** (non-DOM, gérés par le cadriciel) :

| Événement | Déclenchement |
|---|---|
| `@mount="script"` | Quand l'élément est inséré dans le DOM |
| `@unmount="script"` | Quand l'élément est retiré du DOM (peut être asynchrone) |

```
<div
    @mount="$initialiser()"
    @unmount="$nettoyer()"
>
```

### Balises interdites

Les balises suivantes sont gérées directement par le cadriciel et ne peuvent pas être utilisées dans les modèles :

`!DOCTYPE` `html` `head` `body` `title` `base` `meta` `link` `noscript` `script` `style`

### Balises sans enfant

Les balises HTML à fermeture automatique ne peuvent pas avoir de blocs enfants :

`area` `br` `col` `embed` `hr` `img` `input` `param` `source` `track` `wbr`

### Balises SVG

Les balises SVG sont supportées nativement. Le cadriciel applique automatiquement l'espace de noms SVG aux éléments reconnus (`svg`, `path`, `circle`, `rect`, `g`, `use`, etc.).

```
<svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10">
```

---

## Textes

Un texte est une chaîne entre guillemets (`"`, `'` ou `` ` ``). Les variables `$var` sont interpolées, y compris leurs accès directs (`$var.attr`, `$var['clef']`, `$var[$autre_var]`) :

```
"Bonjour, $nom !"
'Compteur : $compteur'
`Chemin actuel : $path`
```

> **Note :** Si une variable n'est pas définie, son nom s'affiche tel quel (ex : `$nom`).

---

## Appels de modèles

Un modèle s'appelle par son nom. Les arguments éventuels sont passés entre crochets `[...]`.

Chaque argument peut être :
- positionnel : `"Mon titre"`
- nommé : `$titre : "Mon titre"`

Les arguments sont séparés par `,` ou par retour à la ligne (on peut mélanger).

Règles d'attribution :
- Un argument nommé (`$nom : valeur`) est affecté au paramètre portant ce nom.
- Un argument positionnel (`valeur`) est affecté au premier paramètre encore non affecté.
- Un conflit d'affectation (même paramètre défini deux fois) déclenche une erreur.
- Un argument nommé inconnu déclenche une erreur.

```
carte ["Mon titre", "Ma description"]
```

```
carte [
    $titre : "Mon titre",
    "Ma description"
]
```

Les enfants du modèle (destinés à `@stud`) se déclarent en indentation :

```
carte ["Mon titre", "Ma description"]
    "Contenu injecté dans @stud"
    <span>
        "autre enfant"
```

### Types de chargement

| Syntaxe | Nom | Description |
|---|---|---|
| `nom` | Modèle standard | Chargé de façon synchrone au moment du parsing du modèle parent |
| `-nom` | Modèle différé | Chargé de façon asynchrone après le rendu initial |
| `?nom` | Modèle d'attente | Affiché pendant le chargement d'un modèle différé |
| `!nom` | Modèle de repli | Affiché si le chargement d'un modèle différé échoue |

`?nom` et `!nom` déclarent des comportements pour les modèles différés (`-nom`) présents dans le **même bloc parent**. Ils ne s'affichent pas directement.

```
-contenu-lourd [$section]

?animation-chargement
!message-erreur
```

Des arguments peuvent être passés aux modèles d'attente et de repli de la même façon qu'aux modèles standard :

```
?chargement ["Chargement en cours…"]
!erreur ["Impossible de charger le contenu"]
```

### Suffixe de classe

Un appel de modèle peut être suivi d'un ou plusieurs **suffixes de classe** séparés par des points `.`. Ces classes seront ajoutées à tous les nœuds de premier niveau produits par le modèle.

```
defilement.onglet
```

Cet appel charge le modèle `defilement` et ajoute la classe `onglet` à chacun de ses nœuds racines.

Plusieurs classes peuvent être ajoutées en les enchaînant :

```
section.bloc.actif
```

Cela fonctionne avec tous les types de chargement (standard, différé, d'attente et de repli) :

```
-contenu-principal.hero

?animation-chargement.grande

!message-erreur.alerte.critique
```
