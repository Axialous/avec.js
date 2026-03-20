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

Déclare du code JavaScript exécuté une fois lors du premier chargement du modèle. Typiquement utilisé pour initialiser des variables réactives ou déclarer des fonctions.

```
@script [
    $compteur = 0

    $incrementer = () => { $compteur++ }
]
```

> **Note :** `@script` est exécuté une seule fois par modèle, même si celui-ci est instancié plusieurs fois dans la page. Pour du code lié à une instance spécifique, utiliser les événements `@mount` / `@unmount`.

### `@args`

Déclare les paramètres acceptés par le modèle. Les valeurs sont passées de façon positionnelle lors de l'appel du modèle.
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

Ces blocs sont **réactifs** : si une variable réactive utilisée dans la condition change, le contenu se met à jour automatiquement.

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

### Gestionnaires d'événements

Les événements DOM s'écrivent avec le préfixe `@` ou `on` :

```
<button @click="$compteur++">
<input onchange="$valeur = $event.target.value">
```

Dans le script du gestionnaire, les variables suivantes sont disponibles :

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
    @mount="$initialiser($node, $vars)"
    @unmount="$nettoyer($node, $vars)"
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

Un texte est une chaîne entre guillemets (`"`, `'` ou `` ` ``). Les variables `$var` sont interpolées :

```
"Bonjour, $nom !"
'Compteur : $compteur'
`Chemin actuel : $path`
```

> **Note :** Si une variable n'est pas définie, son nom s'affiche tel quel (ex : `$nom`).

---

## Appels de modèles

Un modèle s'appelle par son nom. Les arguments éventuels sont passés à la suite, séparés par des espaces :

```
carte "Mon titre" "Ma description"
```

Les enfants du modèle (destinés à `@stud`) se déclarent en indentation :

```
carte "Mon titre" "Ma description"
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
-contenu-lourd $section

?animation-chargement
!message-erreur
```

Des arguments peuvent être passés aux modèles d'attente et de repli de la même façon qu'aux modèles standard :

```
?chargement "Chargement en cours…"
!erreur "Impossible de charger le contenu"
```
