# avec.js — Documentation

**avec.js** est un cadriciel web orienté composants. Il permet de créer des interfaces à partir de fichiers `.avec`, un format de gabarit lisible compilé côté serveur et rendu côté client.

## Concepts fondamentaux

| Concept | Description |
|---|---|
| **Modèle** | Un fichier `.avec` décrivant un fragment d'interface réutilisable |
| **Variable de scope** | Une variable réactive résolue du scope courant vers les parents ; sa modification met à jour le DOM automatiquement |
| **Argument** | Une valeur passée à un modèle lors de son appel, locale et en lecture seule pour cette instance |
| **Tenon** | Le contenu injecté dans un modèle via `@stud` |

## Table des matières

- [Démarrage](demarrage.md) — structure du projet, configuration
- [Modèles](modeles.md) — écrire des fichiers `.avec`
- [Expressions](expressions.md) — variables, opérateurs, correspondances de motifs
