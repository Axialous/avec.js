# Démarrage

## Structure du projet

Un projet sans.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
└── modeles/           ← fichiers .sans (organisables librement en sous-dossiers)
sans.js/               ← moteur du cadriciel (ne pas modifier)
depot/                 ← fichiers statiques servis publiquement
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur. Le cadriciel les retrouve automatiquement par leur nom, sans qu'il soit nécessaire d'indiquer le chemin complet.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN (paires `clef : valeur`) :

```
nom    : MonAPI
port   : 5030
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `nom` | texte | `sans.js` | Nom de l'API |
| `port` | nombre | `5030` | Port d'écoute du serveur (peut aussi être défini via la variable d'environnement `PORT`) |

## Variables d'environnement

Les paramètres de connexion à la base de données et le mode d'exécution sont fournis via des variables d'environnement (typiquement un fichier `.env` monté par Docker) :

| Variable | Défaut | Description |
|---|---|---|
| `database_host` | `localhost` | Hôte du serveur MySQL |
| `database_port` | `3306` | Port du serveur MySQL |
| `database_name` | — | Nom de la base de données (**obligatoire**) |
| `database_user` | — | Utilisateur MySQL (**obligatoire**) |
| `database_pass` | *(vide)* | Mot de passe MySQL |
| `mode` | `prod` | Mode d'exécution : `dev` ou `prod` |
| `schema_destructive` | `false` | Active la suppression automatique des colonnes et tables disparues du schéma en mode `dev` |
| `PORT` | `5030` | Port d'écoute HTTP |

> **Important :** la base de données doit exister avant le démarrage. sans.js ne la crée pas — il affiche une erreur si la connexion échoue.

### Différences entre les modes

| Action | `dev` | `prod` |
|---|---|---|
| Créer les tables absentes | ✓ | ✓ |
| Ajouter / modifier des colonnes | ✓ | ✓ |
| Supprimer les colonnes disparues du schéma | si `schema_destructive=true` | — |
| Supprimer les tables disparues du schéma | si `schema_destructive=true` | — |

## Fichiers statiques — route `/depot/`

Tout fichier placé dans le dossier `depot/` est accessible publiquement via la route `/depot/<nom-du-fichier>`. La recherche est récursive : les sous-dossiers sont parcourus automatiquement.

```
GET /depot/photo.png  →  depot/uploads/photo.png
```

Les types MIME courants (images, polices, audio, vidéo, JSON…) sont détectés automatiquement à partir de l'extension.
