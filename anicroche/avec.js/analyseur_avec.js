import fs   from "fs"

import {rechercher_fichier} from "./avec.js"

const erreur = (message, fichier, str, pos) =>
{
    let ligne = 1
    let colonne = 1
    for (let i = 0; i < pos; i++)
    {
        if (str[i] == '\n')
        {
            ligne++
            colonne = 1
        }
        else
            colonne++
    }
    throw new Error(`Analyseur .avec : ${fichier} ${ligne},${colonne} : ${message}`)
}

const debug = (message, str, deb, fin, json) =>
{
    let ligne_deb = 1
    let colonne_deb = 1
    for (let i = 0; i < deb; i++)
    {
        if (str[i] == '\n')
        {
            ligne_deb++
            colonne_deb = 1
        }
        else
            colonne_deb++
    }
    let ligne_fin = 1
    let colonne_fin = 1
    for (let i = 0; i < fin; i++)
    {
        if (str[i] == '\n')
        {
            ligne_fin++
            colonne_fin = 1
        }
        else
            colonne_fin++
    }
    let ind = ''
    for (let i = 0; i < json; i++) {
        ind += '    '
    }
    // console.log(`DEBUG: Analyseur .avec :${ind} ${message} : ${ligne_deb}:${colonne_deb} - ${ligne_fin}:${colonne_fin}`)
}

// Fonction utilitaire : détecte et saute un smiley, retourne la nouvelle position
const sauter_smileys = (str, pos) =>
{
    if (str[pos] === ':')
    {
        if (str[pos + 1] === ')' || str[pos + 1] === '(' || str[pos + 1] === 'x')
            return pos + 2
    }
    return pos
}

// Fonction utilitaire : détecte et saute un opérateur composé avec accolades
const sauter_operateurs_appartenance = (str, pos) =>
{
    if (str[pos] === '!' && str[pos + 1] === '-' && str[pos + 2] === '{') return pos + 3
    if (str[pos] === '!' && str[pos + 1] === '}' && str[pos + 2] === '-') return pos + 3
    if (str[pos] === '-' && str[pos + 1] === '{')                         return pos + 2
    if (str[pos] === '}' && str[pos + 1] === '-')                         return pos + 2
    return pos
}

const avancer_avec_blocs = (str, pos, fin, blocs, arret) =>
{
    while (pos <= fin && !arret(str, pos, blocs))
    {
        // Sauter les tokens spéciaux en priorité, hors contexte de chaîne
        if (!/^["'`]$/.test(blocs.slice(-1)))
        {
            let apres = sauter_smileys(str, pos)
            if (apres !== pos) { pos = apres; continue }

            apres = sauter_operateurs_appartenance(str, pos)
            if (apres !== pos) { pos = apres; continue }
        }

        const c = str[pos]
        if (c === blocs.slice(-1))
            blocs = blocs.slice(0, -1)
        else if (c === '(' && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += ')'
        else if (c === '[' && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += ']'
        else if (c === '{' && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += '}'
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
            blocs += '>'
        else if (c === '"' && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += '"'
        else if (c === "'" && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += "'"
        else if (c === '`' && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += '`'
        else if ((c === ')' || c === ']' || c === '}') && !/^["'`]$/.test(blocs.slice(-1)))
            return { pos, blocs, erreur: "Fermeture de bloc inattendue" }
        else if (c === '>' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
            return { pos, blocs, erreur: "Fermeture de bloc inattendue" }

        pos++
    }
    return { pos, blocs, erreur: null }
}

const valider_bloc_avec = (bloc, str, pos, fichier) =>
{
    if (bloc.type == 'instruction')
    {
        if (bloc.args[0] == `@style` || bloc.args[0] == `@script` || bloc.args[0] == `@args`)
        {
            if (bloc.args.length != 2)
                erreur(`${bloc.args[0]} doit avoir un argument : ${bloc.args[0]} [${bloc.args[0].slice(1)}]`, fichier, str, pos)
            if (bloc.enfants.length > 0)
                erreur(`${bloc.args[0]} ne doit pas avoir d'enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@if` || bloc.args[0] == `@else-if` || bloc.args[0] == `@unless` || bloc.args[0] == `@while` || bloc.args[0] == `@until`)
        {
            if (bloc.args.length != 2)
                erreur(`${bloc.args[0]} doit avoir un argument : ${bloc.args[0]} [condition]`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@else`)
        {
            if (bloc.args.length != 1)
                erreur(`${bloc.args[0]} ne doit pas avoir d'argument : ${bloc.args[0]}`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@repeat`)
        {
            if (bloc.args.length > 2)
                erreur(`${bloc.args[0]} peut avoir un argument : ${bloc.args[0]} ([nombre])`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@for-each`)
        {
            if (bloc.args.length != 4 || (bloc.args[2] != 'in' && bloc.args[2] != 'of'))
                erreur(`${bloc.args[0]} doit avoir trois arguments : ${bloc.args[0]} [variable] in|of [variable]`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@stud`)
        {
            if (bloc.args.length != 1)
                erreur(`${bloc.args[0]} ne doit pas avoir d'argument : ${bloc.args[0]}`, fichier, str, pos)
            if (bloc.enfants.length > 0)
                erreur(`${bloc.args[0]} ne doit pas avoir d'enfant`, fichier, str, pos)
        }
        else
            erreur(`${bloc.args[0]} n'est pas reconnu comme instruction`, fichier, str, pos)
    }
    else if (bloc.type == 'balise')
    {
        let balise = "";
        for (let i = 1; !/^[ >]$/.test(bloc.args[0][i]); i++)
            balise += bloc.args[0][i]

        let balises_interdites = ['!DOCTYPE', 'html', 'head', 'body', 'title', 'base', 'meta', 'link', 'noscript', 'script', 'style']
        let balises_sans_enfant = ['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'param', 'source', 'track', 'wbr']

        if (bloc.args.length != 1)
            erreur(`<${balise}> ne peut pas avoir d'argument`, fichier, str, pos)
        if (balises_interdites.includes(balise))
            erreur(`<${balise}> est une balise interdite`, fichier, str, pos)
        if (balises_sans_enfant.includes(balise) && bloc.enfants.length > 0)
            erreur(`<${balise}> ne peut pas avoir d'enfants`, fichier, str, pos)
    }
    else if (bloc.type == 'texte')
    {
        if (bloc.args.length != 1)
            erreur(`un texte ne peut pas avoir d'argument`, fichier, str, pos)
        if (bloc.enfants.length > 0)
            erreur(`un texte ne peut pas avoir d'enfants`, fichier, str, pos)
    }
    else if (bloc.type == 'modele')
    {
        if (bloc.args.length > 2)
            erreur(`un appel de modèle doit utiliser la syntaxe : ${bloc.args[0]} [argument_1, argument_2]`, fichier, str, pos)
        if (bloc.args.length == 2)
        {
            const args = bloc.args[1].trim()
            if (!(args.startsWith('[') && args.endsWith(']')))
                erreur(`les arguments d'un modèle doivent être entre crochets : ${bloc.args[0]} [argument_1, argument_2]`, fichier, str, pos)
        }
        return
    }
    else
        erreur("Syntaxe incorrecte", fichier, str, pos)
}

const extraire_modele_et_classes = (str) =>
{
    const brut = str.trim()
    const parties = brut.split('.')
    const nom = parties.shift()
    const classes = parties

    if (nom.length === 0)
        throw new Error(`Analyseur .avec : nom de modèle invalide : nom manquant`)
    if (classes.some(classe => classe.length === 0))
        throw new Error(`Analyseur .avec : nom de modèle invalide : classe manquante après '.'`)

    return {
        nom,
        classes
    }
}

const analyser_bloc_avec = (str, deb, fin, fichier, json) =>
{
    debug("Bloc", str, deb, fin, json)
    let bloc = { type: undefined, args: [], enfants: [] }

    let indentation = 0
    while (str[deb + indentation] == ' ')
        indentation++
    let pos = deb + indentation

    if (str[pos] == '\t')
        return erreur("Indentation par tabulations interdite", fichier, str, pos)
    if (str[pos] == '\n' || str[pos] == '#')
        return null

    let fini = pos > fin ? true : false
    let blocs = ''
    let deb_mot = pos
    while (!fini)
    {
        const res = avancer_avec_blocs(str, pos, fin,  blocs,
            (str, pos, blocs) => /^[ \n]$/.test(str[pos]) && blocs === '')
        if (res.erreur)
            return erreur(res.erreur, fichier, str, res.pos)
        pos = res.pos
        blocs = res.blocs

        let mot = str.substring(deb_mot, pos + 1).trim()
        if (mot.length > 0)
            bloc.args.push(mot)
        if (str[pos] == '\n' || pos >= fin)
            fini = true
        else
            deb_mot = ++pos
    }

    if (!bloc.args[0])
        return null
    else if (bloc.args[0][0] == '@')
    {
        bloc.type = 'instruction'
    }
    else if (bloc.args[0][0] == '<')
    {
        bloc.type = 'balise'
    }
    else if (/^["'`]$/.test(bloc.args[0][0]))
    {
        bloc.type = 'texte'
    }
    else if (bloc.args[0][0] == '-' && /^[a-zA-Z]$/.test(bloc.args[0][1]))
    {
        bloc.type = 'modele'
        const { nom, classes } = extraire_modele_et_classes(bloc.args[0].slice(1))
        if (classes.length > 0)
            bloc.classes = classes

        // Modèle différé : pas de chargement au moment du parsing
    }
    else if (bloc.args[0][0] == '?' && /^[a-zA-Z]$/.test(bloc.args[0][1]))
    {
        bloc.type = 'modele'
        const { nom, classes } = extraire_modele_et_classes(bloc.args[0].slice(1))
        if (classes.length > 0)
            bloc.classes = classes
        if (!json.dependances[nom])
        {
            if (analyser_dependance(nom, json) != 0)
            {
                return erreur("Chargement du modèle impossible", fichier, str, deb + indentation)
            }
        }
    }
    else if (bloc.args[0][0] == '!' && /^[a-zA-Z]$/.test(bloc.args[0][1]))
    {
        bloc.type = 'modele'
        const { nom, classes } = extraire_modele_et_classes(bloc.args[0].slice(1))
        if (classes.length > 0)
            bloc.classes = classes
        if (!json.dependances[nom])
        {
            if (analyser_dependance(nom, json) != 0)
            {
                return erreur("Chargement du modèle impossible", fichier, str, deb + indentation)
            }
        }
    }
    else if (/^[a-zA-Z]$/.test(bloc.args[0][0]))
    {
        bloc.type = 'modele'
        const { nom, classes } = extraire_modele_et_classes(bloc.args[0])
        bloc.args[0] = nom
        if (classes.length > 0)
            bloc.classes = classes

        if (!json.dependances[nom])
        {
            if (analyser_dependance(nom, json) != 0)
            {
                return erreur("Chargement du modèle impossible", fichier, str, deb + indentation)
            }
        }
    }
    if (pos < fin)
        bloc.enfants = analyser_enfants_avec(str, pos + 1, fin, fichier, json)
    valider_bloc_avec(bloc, str, deb + indentation, fichier)
    return bloc
}

const analyser_enfants_avec = (str, deb, fin, fichier, json) =>
{
    debug("Enfants", str, deb, fin, json)
    let enfants = []

    let indentation = 0
    while (str[deb + indentation] == ' ')
        indentation++

    let pos = deb
    let fini = deb >= fin ? true : false
    while (!fini)
    {
        // Sauter les lignes vides et commentaires AVANT la vérification d'indentation
        while (pos <= fin && (str[pos] === '\n' || str[pos] === '#'))
        {
            if (str[pos] === '#')
                while (pos <= fin && str[pos] !== '\n')
                    pos++
            if (pos <= fin)
                pos++
            if (pos > fin) { fini = true; break }
        }
        if (fini) break

        // Vérifier l'indentation
        for (let i = 0; i < indentation; i++)
        {
            if (pos + i > fin)               { fini = true; break }
            if (str[pos + i] == '\t')
                return erreur("Indentation par tabulations interdite", fichier, str, pos + i)
            if (str[pos + i] != ' ')
                return erreur("Erreur d'indentation", fichier, str, pos + i)
        }
        if (fini) break
        pos += indentation

        if (pos > fin)   { fini = true; continue }
        if (str[pos] == ' ') return erreur("Erreur d'indentation", fichier, str, pos)

        let deb_enf = pos
        let fin_enf = pos
        let blocs = ''
        let enf_pret = false

        while (!fini && !enf_pret)
        {
            // Avancer jusqu'à la fin de la ligne courante
            const res = avancer_avec_blocs(str, pos, fin, blocs,
                (str, pos, blocs) => str[pos] === '\n' && blocs === '')
            if (res.erreur)
                return erreur(res.erreur, fichier, str, res.pos)
            pos   = res.pos
            blocs = res.blocs
            fin_enf = pos

            if (pos >= fin) { fini = true; continue }

            // Regarder la ligne suivante
            let peek = pos + 1 // pos est sur '\n', peek est le début de la ligne suivante

            // Sauter les lignes vides et commentaires
            while (peek <= fin && (str[peek] === '\n' || str[peek] === '#'))
            {
                if (str[peek] === '#')
                    while (peek <= fin && str[peek] !== '\n')
                        peek++
                if (peek <= fin) peek++
            }
            if (peek > fin) { fini = true; continue }

            // Vérifier si la ligne suivante est encore un enfant (indentation > indentation courante)
            let espaces = 0
            while (str[peek + espaces] === ' ') espaces++

            if (espaces > indentation && str[peek + espaces] !== '\n')
            {
                // Ligne suivante = enfant du bloc courant → continuer
                pos = peek
            }
            else
            {
                // Ligne suivante = même niveau ou supérieur → fin du bloc courant
                enf_pret = true
                pos = peek
            }
        }

        let bloc = analyser_bloc_avec(str, deb_enf, fin_enf, fichier, json)
        if (bloc)
            enfants.push(bloc)
    }
    return enfants
}

const analyser_fichier_avec = (str, deb, fin, fichier, json) =>
{
    let modele = {
        type: 'fichier',
        args: [],
        enfants: []
    }
    modele.enfants = analyser_enfants_avec(str, deb, fin, fichier, json)
    return modele
}

export const analyser_avec = (str, fichier, req) =>
{
    const nom = fichier.replace(/\.avec$/, '')
    let json = {
        modele: {
            type: 'modele',
            args: [nom],
            enfants: []
        },
        dependances: {},
        connus: new Set(req?.headers['x-ac-connus']?.split(',').filter(Boolean) ?? [])
    }
    let modele = analyser_fichier_avec(str, 0, str.length - 1, fichier, json)
    json.dependances[nom] = modele
    return JSON.stringify(json)
}

const analyser_dependance = (nom, json) =>
{
    if (json.connus?.has(nom))
        return 0
    const dossier = `./adn/modeles`
    const fichier = `${nom}.avec`
    const chemin = rechercher_fichier(dossier, fichier, true)
    if (chemin)
    {
        let modele = fs.readFileSync(chemin, "utf-8")
        modele = analyser_fichier_avec(modele, 0, modele.length - 1, fichier, json)
        json.dependances[nom] = modele
        return 0
    }
    return 1
}
