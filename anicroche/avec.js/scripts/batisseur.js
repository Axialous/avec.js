import {charger_modele} from './heraut.js'
import {valoriser} from './scribe.js'
import {evaluer, evaluer_valeur} from './augure.js'
import {activer_style, desactiver_style} from './decorateur.js'
import {
    initialiser_sculpteur, executer_script, executer_script_async,
    activer_script, desactiver_script,
    observer_sculpteur,
    creer_scope, obtenir_scope_racine, lire_variable,
    definir_noeud_courant, effacer_noeud_courant
} from './sculpteur.js'

const chargements_en_cours = new Map()

const BALISES_SVG = new Set([
    'g',    'path',   'ellipse',
    'svg',  'rect',   'polygon',
    'use',  'stop',   'clipPath',
    'defs', 'text',   'polyline',
    'line', 'circle', 'linearGradient',
    'mask', 'symbol', 'radialGradient'
])

export const initialiser_batisseur = async () =>
{
    const corps = document.querySelector(`#avec`)

    initialiser_sculpteur()

    const index = await charger_modele(`index`)
    if (index)
    {
        const donnees = {
            dependances: index.dependances,
            scope: obtenir_scope_racine(),
            args: {},
            tenons: [],
            attente: null,
            repli: null
        }
        const enfants = construire_bloc(index.modele, donnees)
        corps.append(...enfants)
    }
}

const decapsuler = (str) =>
{
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let texte = ``
    let blocs = ``
    let pos = 0

    while (pos < str.length)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            texte += str.slice(pos, pos + 2)
            pos += 2
            continue
        }
        if (c == blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
            if (blocs.length > 0)
                texte += c
        }// À supprimer :
        else if (c == '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
            if (blocs.length > 1)
                texte+= c
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
            if (blocs.length > 1)
                texte += c
        }
        else
        {
            texte += c
        }
        pos++
    }
    return texte
}

const extraire_modele_et_classes = (str) =>
{
    const brut = str.trim()
    const parties = brut.split('.')
    const nom = parties.shift()
    const classes = parties

    if (nom.length === 0)
        throw new Error(`Nom de modèle invalide : nom manquant`)
    if (classes.some(classe => classe.length === 0))
        throw new Error(`Nom de modèle invalide : classe manquante après '.'`)

    return {
        nom,
        classes
    }
}

const appliquer_classes_racine = (noeuds, classes) =>
{
    if (!classes || classes.length === 0)
        return

    for (const noeud of noeuds)
    {
        if (noeud.nodeType === 1)
            classes.forEach(classe => noeud.classList.add(classe))
    }
}

const est_entoure_par_bloc = (str) =>
{
    const texte = str.trim()
    if (texte.length < 2)
        return false

    const paires = { '(':')', '[':']', '{':'}', '<':'>', '"':'"', "'":"'", '`':'`' }
    const premier = texte[0]
    const dernier = texte[texte.length - 1]
    if (!(premier in paires) || paires[premier] !== dernier)
        return false

    let blocs = ``
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }

    for (let pos = 0; pos < texte.length; pos++)
    {
        const c = texte[pos]
        if (c === ':' && /^[)(x]$/.test(texte[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
            blocs = blocs.slice(0, -1)
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
            blocs += '>'
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += ouvrants[c]

        if (blocs === `` && pos < texte.length - 1)
            return false
    }

    return blocs === ``
}

const decapsuler_si_entoure = (str) =>
{
    if (!est_entoure_par_bloc(str))
        return str.trim()
    return decapsuler(str.trim())
}

const decouper_haut_niveau = (str, separateurs) =>
{
    const brut = str.trim()
    if (brut.length === 0)
        return []

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    const parties = []
    let blocs = ``
    let debut = 0

    for (let pos = 0; pos < brut.length; pos++)
    {
        const c = brut[pos]

        if (c === ':' && /^[)(x]$/.test(brut[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }

        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (separateurs.has(c) && blocs === ``)
        {
            const partie = brut.slice(debut, pos).trim()
            if (partie.length > 0)
                parties.push(partie)
            debut = pos + 1
        }
    }

    const derniere_partie = brut.slice(debut).trim()
    if (derniere_partie.length > 0)
        parties.push(derniere_partie)

    return parties
}

const extraire_declaration_arg = (str) =>
{
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``

    for (let pos = 0; pos < str.length; pos++)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === ':' && blocs === ``)
        {
            const nom = str.slice(0, pos).trim()
            const valeur_defaut = str.slice(pos + 1).trim()

            if (nom.length === 0)
                throw new Error("@args invalide : nom d'argument manquant")
            if (/\s/.test(nom))
                throw new Error("@args invalide : séparer les arguments par ',' ou par '\\n'")
            if (valeur_defaut.length === 0)
                throw new Error("@args invalide : valeur par défaut manquante après ':'")

            return { nom, valeur_defaut }
        }
    }

    const nom = str.trim()
    if (nom.length === 0)
        throw new Error("@args invalide : nom d'argument manquant")
    if (/\s/.test(nom))
        throw new Error("@args invalide : séparer les arguments par ',' ou par '\\n'")

    return { nom, valeur_defaut: null }
}

const extraire_declarations_args = (str) =>
{
    return decouper_haut_niveau(str, new Set([',', '\n']))
        .map(extraire_declaration_arg)
}

const extraire_argument_modele = (str) =>
{
    const valeur = str.trim()
    if (/^:[)(x]$/.test(valeur))
        return { nom: null, valeur }

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``

    for (let pos = 0; pos < str.length; pos++)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === ':' && blocs === ``)
        {
            const nom = str.slice(0, pos).trim()
            const valeur = str.slice(pos + 1).trim()

            if (nom.length === 0)
                throw new Error("argument nommé invalide : nom d'argument manquant")
            if (!/^\$[a-zA-Z_][\w]*$/.test(nom))
                throw new Error(`argument nommé invalide : ${nom} n'est pas un nom d'argument valide`)
            if (valeur.length === 0)
                throw new Error(`argument nommé invalide : valeur manquante pour ${nom}`)

            return { nom, valeur }
        }
    }

    if (valeur.length === 0)
        throw new Error("argument de modèle invalide : valeur manquante")

    return { nom: null, valeur }
}

const extraire_arguments_modele = (str) =>
{
    return decouper_haut_niveau(str, new Set([',', '\n']))
        .map(extraire_argument_modele)
}

const est_bloc_crochets = (str) =>
{
    const texte = str.trim()
    return texte.startsWith('[') && texte.endsWith(']') && est_entoure_par_bloc(texte)
}

const assembler_attributs_conditionnels = (attributs) =>
{
    const resultat = []

    for (let i = 0; i < attributs.length; i++)
    {
        const courant = attributs[i]

        if (est_bloc_crochets(courant) && attributs[i + 1] == '?')
        {
            const attr_vrai = attributs[i + 2]
            if (!attr_vrai)
                throw new Error(`Attribut conditionnel invalide : attribut manquant apres '?'`)

            if (attributs[i + 3] == ':')
            {
                const attr_faux = attributs[i + 4]
                if (!attr_faux)
                    throw new Error(`Attribut conditionnel invalide : attribut manquant apres ':'`)

                resultat.push(`${courant}?${attr_vrai}:${attr_faux}`)
                i += 4
            }
            else
            {
                resultat.push(`${courant}?${attr_vrai}`)
                i += 2
            }
        }
        else
        {
            resultat.push(courant)
        }
    }

    return resultat
}

const extraire_attribut_conditionnel = (str) =>
{
    const brut = str.trim()
    if (brut.length === 0)
        return null

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``
    let pos_point_interrogation = -1
    let pos_deux_points = -1

    for (let pos = 0; pos < brut.length; pos++)
    {
        const c = brut[pos]
        if (c === ':' && /^[)(x]$/.test(brut[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }

        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === '?' && blocs === `` && pos_point_interrogation < 0)
        {
            pos_point_interrogation = pos
        }
        else if (c === ':' && blocs === `` && pos_point_interrogation >= 0 && pos_deux_points < 0)
        {
            pos_deux_points = pos
        }
    }

    if (pos_point_interrogation < 0)
        return null

    const condition = brut.slice(0, pos_point_interrogation).trim()
    if (!est_bloc_crochets(condition))
        throw new Error(`Attribut conditionnel invalide : la condition doit etre entre crochets []`)

    const attr_vrai = pos_deux_points < 0
        ? brut.slice(pos_point_interrogation + 1).trim()
        : brut.slice(pos_point_interrogation + 1, pos_deux_points).trim()

    if (attr_vrai.length === 0)
        throw new Error(`Attribut conditionnel invalide : attribut manquant apres '?'`)

    const attr_faux = pos_deux_points < 0
        ? null
        : brut.slice(pos_deux_points + 1).trim()

    if (pos_deux_points >= 0 && (!attr_faux || attr_faux.length === 0))
        throw new Error(`Attribut conditionnel invalide : attribut manquant apres ':'`)

    return {
        condition,
        attr_vrai,
        attr_faux
    }
}

const appliquer_attribut_brut = (noeud, attribut, donnees) =>
{
    if (attribut[0] == `#`)
    {
        const id = valoriser(attribut.slice(1), donnees)
        noeud.id = id
        return () => {
            if (noeud.id === id)
                noeud.id = ``
        }
    }

    if (attribut[0] == `.`)
    {
        const classe = valoriser(attribut.slice(1), donnees)
        const classes = classe.split(/\s+/).filter(Boolean)
        classes.forEach(c => noeud.classList.add(c))
        return () => classes.forEach(c => noeud.classList.remove(c))
    }

    if (!attribut.includes(`=`))
    {
        noeud.setAttribute(attribut, ``)
        return () => noeud.removeAttribute(attribut)
    }

    if (attribut.startsWith('on') || attribut[0] == '@')
    {
        initialiser_sculpteur()

        let [evenement, ...reste] = attribut.split('=')
        evenement = evenement[0] == `@` ? evenement.slice(1) : evenement.slice(2)
        const script = decapsuler(reste.join('='))

        if (evenement === 'mount' || evenement === 'unmount')
        {
            if (!noeud._avec_actions)
                noeud._avec_actions = {}

            noeud._avec_actions[evenement] = script
            return () => {
                if (noeud._avec_actions?.[evenement] === script)
                    delete noeud._avec_actions[evenement]
            }
        }

        const gestionnaire = (e) => {
            executer_script(script, e, noeud, noeud._avec_scope, noeud._avec_args)
        }
        noeud.addEventListener(evenement, gestionnaire)
        return () => noeud.removeEventListener(evenement, gestionnaire)
    }

    const [clef, ...reste] = attribut.split(`=`)
    const valeur_brute = reste.join(`=`)
    const valeur = valoriser(decapsuler(valeur_brute), donnees)
    appliquer_attribut(noeud, clef, valeur)
    return () => {
        if (clef === 'id')
            noeud.id = ``
        else if (clef === 'class')
            noeud.className = ``
        else
            noeud.removeAttribute(clef)
    }
}

const construire_bloc = (bloc, donnees) =>
{
    switch (bloc.type)
    {
    case `fichier`:
        return construire_fichier(bloc, donnees)
    case `instruction`:
        return construire_enfants(bloc, donnees)
    case `balise`:
        return construire_balise(bloc, donnees)
    case `texte`:
        return construire_texte(bloc, donnees)
    case `modele`:
        return construire_modele(bloc, donnees)
    default:
        return []
    }
}

const construire_fichier = (bloc, donnees) =>
{
    // Faire en sorte que le style fonctionne pour l'index
    return construire_enfants(bloc, donnees)
}

const construire_enfants = (bloc, donnees) =>
{
    // Pré-scan : les modèles d'attente (?) et de repli (!) déclarés à ce niveau priment sur ceux hérités
    for (const enfant of bloc.enfants)
    {
        if (enfant.type === 'modele')
        {
            if (enfant.args[0][0] === '?' && /^[a-zA-Z]$/.test(enfant.args[0][1]))
                donnees = { ...donnees, attente: enfant }
            else if (enfant.args[0][0] === '!' && /^[a-zA-Z]$/.test(enfant.args[0][1]))
                donnees = { ...donnees, repli: enfant }
        }
    }

    let enfants = []
    let elsable = false
    for (let i = 0; i < bloc.enfants.length; i++)
    {
        const enfant = bloc.enfants[i]
        if (enfant.type === `instruction`)
        {
            switch (enfant.args[0])
            {
            case `@if`:
            case `@else-if`:
            case `@else`:
            case `@unless`:
            {
                // Collecter tous les blocs de la chaîne conditionnelle
                const chaine = []

                // Reculer si on est sur un @else-if ou @else
                let debut = i
                while (debut > 0)
                {
                    const precedent = bloc.enfants[debut - 1]
                    if (
                        precedent.type === `instruction` &&
                        [`@if`, `@else-if`, `@unless`].includes(precedent.args[0])
                    )
                        debut--
                    else
                        break
                }

                // Avancer pour collecter toute la chaîne depuis i
                let fin = i
                if (enfant.args[0] === `@if` || enfant.args[0] === `@unless`)
                {
                    chaine.push(enfant)
                    fin = i + 1
                    while (fin < bloc.enfants.length)
                    {
                        const suivant = bloc.enfants[fin]
                        if (
                            suivant.type === `instruction` &&
                            [`@else-if`, `@else`].includes(suivant.args[0])
                        )
                        {
                            chaine.push(suivant)
                            fin++
                        }
                        else break
                    }
                    i = fin - 1
                    elsable = false

                    enfants.push(...construire_conditionnel(chaine, donnees))
                }
                else if (enfant.args[0] === `@else-if` || enfant.args[0] === `@else`)
                {
                    // Ces cas sont désormais gérés dans la collecte du @if
                    // On les ignore ici car ils ont déjà été consommés
                    elsable = false
                }
                break
            }

            // ...existing code... (les autres cas @repeat, @while, etc.)
            case `@repeat`:
                if (enfant.args.length > 1)
                {
                    const limite = +evaluer(decapsuler(enfant.args[1]), donnees)
                    for (let j = 0; j < limite; j++)
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@while`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (evaluer(decapsuler(bloc.enfants[i + 1].args[1]), donnees))
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@until`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (!evaluer(decapsuler(bloc.enfants[i + 1].args[1]), donnees))
                }
                elsable = false
                break
            case `@while`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (evaluer(decapsuler(enfant.args[1]), donnees))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@until`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (!evaluer(decapsuler(enfant.args[1]), donnees))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@for-each`:
                enfants.push(...construire_for_each(enfant, donnees))
                elsable = false
                break
            case `@stud`:
                if (donnees.tenons.length > 0)
                {
                    const tenon = donnees.tenons.at(-1)
                    const bloc_tenon = {
                        type: `instruction`,
                        args: [`@stud`],
                        enfants: tenon.enfants
                    }
                    const donnees_tenon = {
                        ...tenon.donnees,
                        scope: donnees.scope,
                        tenons: donnees.tenons.slice(0, -1)
                    }
                    enfants.push(...construire_enfants(bloc_tenon, donnees_tenon))
                }
                elsable = false
                break
            default:
                elsable = false
            }
        }
        else
        {
            enfants.push(...construire_bloc(enfant, donnees))
            elsable = false
        }
    }
    return enfants
}

// Évalue quelle branche de la chaîne conditionnelle doit s'afficher
const evaluer_chaine = (chaine, donnees) =>
{
    for (const branche of chaine)
    {
        switch (branche.args[0])
        {
        case `@if`:
        case `@else-if`:
            if (evaluer(decapsuler(branche.args[1]), donnees))
                return branche
            break
        case `@unless`:
            if (!evaluer(decapsuler(branche.args[1]), donnees))
                return branche
            break
        case `@else`:
            return branche
        }
    }
    return null
}

// Construit un bloc conditionnel réactif avec des ancres
const construire_conditionnel = (chaine, donnees) =>
{
    const ancre_debut = document.createComment(`@if`)
    const ancre_fin   = document.createComment(`/@if`)

    // Tracker les dépendances des conditions
    for (const branche of chaine)
    {
        if (branche.args[1])
        {
            definir_noeud_courant(ancre_debut)
            evaluer(decapsuler(branche.args[1]), donnees)
            effacer_noeud_courant()
        }
    }

    const deps_condition = ancre_debut._avec_deps ?? new Set()

    // Construire le contenu initial
    let branche_active = evaluer_chaine(chaine, donnees)
    const noeuds_actifs = branche_active
        ? construire_enfants(branche_active, donnees)
        : []

    if (deps_condition.size > 0)
    {
        let transition_en_cours = false
        let branche_en_attente  = null

        const executer_transition = async (cible) =>
        {
            transition_en_cours = true

            const noeuds_a_supprimer = []
            let noeud = ancre_debut.nextSibling
            while (noeud && noeud !== ancre_fin)
            {
                noeuds_a_supprimer.push(noeud)
                noeud = noeud.nextSibling
            }

            await Promise.all(noeuds_a_supprimer.map(n => demonter_noeud(n)))

            for (const n of noeuds_a_supprimer)
            {
                if (n.parentNode) n.parentNode.removeChild(n)
            }

            for (const n of noeuds_a_supprimer)
            {
                nettoyer_noeud(n)
            }

            if (cible)
            {
                const nouveaux_noeuds = construire_enfants(cible, donnees)
                ancre_fin.before(...nouveaux_noeuds)

                queueMicrotask(() => {
                    nouveaux_noeuds.forEach(n => {
                        if (n.nodeType === 1 && document.contains(n))
                            monter_noeud(n)
                    })
                })
            }

            transition_en_cours = false

            if (branche_en_attente !== null)
            {
                const prochaine   = branche_en_attente
                branche_en_attente = null
                executer_transition(prochaine)
            }
        }

        const desabonner = observer_sculpteur((propriete) =>
        {
            if (!deps_condition.has(propriete)) return

            if (!ancre_debut.parentNode)
            {
                desabonner()
                return
            }

            const nouvelle_branche = evaluer_chaine(chaine, donnees)

            if (nouvelle_branche === branche_active) return

            branche_active = nouvelle_branche

            if (transition_en_cours)
                branche_en_attente = nouvelle_branche
            else
                executer_transition(nouvelle_branche)
        })
    }

    return [ancre_debut, ...noeuds_actifs, ancre_fin]
}

const normaliser_iteration = (valeur, operateur) =>
{
    if (valeur == null)
        return []
    // Arrays
    if (Array.isArray(valeur))
    {
        if (operateur === `in`)
            return Array.from({ length: valeur.length }, (_, i) => i)
        return Array.from(valeur)
    }

    // Strings
    if (typeof valeur === 'string')
    {
        if (operateur === `in`)
            return Array.from({ length: valeur.length }, (_, i) => i)
        return Array.from(valeur)
    }

    // Plain objects
    if (valeur !== null && typeof valeur === 'object')
    {
        if (operateur === `in`)
            return Object.keys(valeur)
        return Object.values(valeur)
    }

    // Fallback for generic iterables
    if (typeof valeur === 'object' && typeof valeur[Symbol.iterator] === 'function')
    {
        const arr = Array.from(valeur)
        if (operateur === `in`)
            return Array.from({ length: arr.length }, (_, i) => i)
        return arr
    }

    return []
}

const construire_for_each = (bloc, donnees) =>
{
    const ancre_debut = document.createComment(`@for-each`)
    const ancre_fin = document.createComment(`/@for-each`)
    const variable_brut = bloc.args[1]
    const operateur = bloc.args[2]
    const source_brute = bloc.args[3]

    // Extraire le nom de variable attendu (ex: [$profil] -> $profil)
    const variable_nom = decapsuler_si_entoure(variable_brut).trim()
    if (!/^[\$][a-zA-Z_][\w]*$/.test(variable_nom))
        throw new Error(`@for-each invalide : nom de variable attendu, obtenu '${variable_brut}'`)

    let noeuds_rendus = []
    let deps_source = new Set()

    const construire_noeuds = () =>
    {
        definir_noeud_courant(ancre_debut)
        // Essayer d'obtenir la valeur réelle de l'expression (liste, objet, etc.)
        const expr = decapsuler_si_entoure(source_brute)
        // Toujours évaluer la valeur via le parseur pour gérer les accès profonds ($compte.profils)
        const source = evaluer_valeur(expr, donnees)
        effacer_noeud_courant()

        // aucun log de débogage en production

        deps_source = ancre_debut._avec_deps ?? new Set()
        const iterations = normaliser_iteration(source, operateur)
        const noeuds = []

        for (const element of iterations)
        {
            const scope_enfant = creer_scope(donnees.scope)
            scope_enfant.variables[variable_nom] = element

            const donnees_enfant = {
                ...donnees,
                scope: scope_enfant
            }

            noeuds.push(...construire_enfants({ enfants: bloc.enfants }, donnees_enfant))
        }

        return noeuds
    }

    const rendre = async () =>
    {
        const noeuds_a_supprimer = []
        let noeud = ancre_debut.nextSibling
        while (noeud && noeud !== ancre_fin)
        {
            noeuds_a_supprimer.push(noeud)
            noeud = noeud.nextSibling
        }

        await Promise.all(noeuds_a_supprimer.map(n => demonter_noeud(n)))

        for (const n of noeuds_a_supprimer)
        {
            if (n.parentNode)
                n.parentNode.removeChild(n)
        }

        for (const n of noeuds_a_supprimer)
            nettoyer_noeud(n)

        noeuds_rendus = construire_noeuds()
        ancre_fin.before(...noeuds_rendus)

        queueMicrotask(() => {
            noeuds_rendus.forEach(n => {
                if (n.nodeType === 1 && document.contains(n))
                    monter_noeud(n)
            })
        })
    }

    noeuds_rendus = construire_noeuds()

    let rendu_en_cours = false
    let rerendu_en_attente = false

    const executer_rendu = async () =>
    {
        if (rendu_en_cours)
        {
            rerendu_en_attente = true
            return
        }

        rendu_en_cours = true
        await rendre()
        rendu_en_cours = false

        if (rerendu_en_attente)
        {
            rerendu_en_attente = false
            executer_rendu()
        }
    }

    if (deps_source.size > 0)
    {
        const desabonner = observer_sculpteur((propriete) =>
        {
            if (!deps_source.has(propriete)) return

            if (!ancre_debut.parentNode)
            {
                desabonner()
                return
            }

            executer_rendu()
        })
    }

    return [ancre_debut, ...noeuds_rendus, ancre_fin]
}

const construire_texte = (bloc, donnees) =>
{
    const noeud = document.createTextNode(``)

    // Tracker les dépendances lors de la première valorisation
    definir_noeud_courant(noeud)
    noeud.textContent = valoriser(decapsuler(bloc.args[0]), donnees)
    effacer_noeud_courant()

    // Si des variables ont été lues, s'abonner aux changements
    if (noeud._avec_deps?.size > 0)
    {
        const desabonner = observer_sculpteur((propriete) =>
        {
            if (!noeud._avec_deps.has(propriete)) return

            // Le nœud est-il encore dans le DOM ?
            if (!document.contains(noeud))
            {
                desabonner()
                return
            }

            noeud.textContent = valoriser(decapsuler(bloc.args[0]), donnees)
        })
    }

    return [noeud]
}

const construire_balise = (bloc, donnees) =>
{
    const str = decapsuler(bloc.args[0]).trim()
    let attributs = decouper_haut_niveau(str, new Set([' ', '\n', '\r', '\t']))
    const etiquette = attributs.shift()
    attributs = assembler_attributs_conditionnels(attributs)
    
    const ESPACE_SVG = 'http://www.w3.org/2000/svg'
    const noeud = BALISES_SVG.has(etiquette)
        ? document.createElementNS(ESPACE_SVG, etiquette)
        : document.createElement(etiquette)
    
    noeud._avec_vars = Object.create(null)
    noeud._avec_scope = donnees.scope
    noeud._avec_args = donnees.args || {}

    for (const attribut of attributs)
    {
        const conditionnel = extraire_attribut_conditionnel(attribut)
        if (conditionnel)
        {
            let nettoyer = null
            const appliquer_conditionnel = () =>
            {
                if (nettoyer)
                {
                    nettoyer()
                    nettoyer = null
                }

                const condition_valide = !!evaluer(decapsuler(conditionnel.condition), donnees)
                const cible = condition_valide ? conditionnel.attr_vrai : conditionnel.attr_faux
                if (!cible)
                    return

                nettoyer = appliquer_attribut_brut(noeud, cible, donnees)
            }

            definir_noeud_courant(noeud)
            appliquer_conditionnel()
            effacer_noeud_courant()

            if (noeud._avec_deps?.size > 0)
            {
                const desabonner = observer_sculpteur((propriete) =>
                {
                    if (!noeud._avec_deps.has(propriete)) return
                    if (!document.contains(noeud)) { desabonner(); return }

                    definir_noeud_courant(noeud)
                    appliquer_conditionnel()
                    effacer_noeud_courant()
                })
            }
        }
        else if (attribut[0] == `#`)
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (attribut[0] == `.`)
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (!attribut.includes(`=`))
        {
            noeud.setAttribute(attribut, ``)
        }
        else if (attribut.startsWith('on') || attribut[0] == '@')
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (attribut.includes(`=`) && !attribut.startsWith('on') && attribut[0] !== '@')
        {
            const [clef, ...reste] = attribut.split(`=`)
            let valeur_brute = reste.join(`=`)

            // Tracker les dépendances de cet attribut
            definir_noeud_courant(noeud)
            let valeur = valoriser(decapsuler(valeur_brute), donnees)
            effacer_noeud_courant()

            appliquer_attribut(noeud, clef, valeur)

            // S'abonner si des variables ont été lues
            if (noeud._avec_deps?.size > 0)
            {
                const desabonner = observer_sculpteur((propriete) =>
                {
                    if (!noeud._avec_deps.has(propriete)) return
                    if (!document.contains(noeud)) { desabonner(); return }

                    definir_noeud_courant(noeud)
                    const nouvelle_valeur = valoriser(decapsuler(valeur_brute), donnees)
                    effacer_noeud_courant()

                    appliquer_attribut(noeud, clef, nouvelle_valeur)
                })
            }
        }
    }

    const enfants = construire_enfants(bloc, donnees)
    noeud.append(...enfants)

    queueMicrotask(() => {
        if (document.contains(noeud))
        {
            monter_noeud(noeud)
        }
    })

    return [noeud]
}

// Fonction utilitaire extraite pour éviter la duplication
const appliquer_attribut = (noeud, clef, valeur) =>
{
    switch (clef)
    {
    case `id`:
        noeud.id = valeur
        break
    case `class`:
        noeud.className = ``
        valeur.split(/\s+/).forEach(c => c && noeud.classList.add(c))
        break
    default:
        noeud.setAttribute(clef, valeur)
    }
}

const construire_modele = (bloc, donnees) =>
{
    const nom_complet = bloc.args[0]
    const est_attente  = nom_complet[0] === '?'
    const est_repli    = nom_complet[0] === '!'
    const differe      = nom_complet[0] === '-'
    const info_modele  = extraire_modele_et_classes((differe || est_attente || est_repli) ? nom_complet.slice(1) : nom_complet)
    const nom          = info_modele.nom
    const classes      = bloc.classes ?? info_modele.classes

    // Modèle d'attente ou de repli : déjà pris en compte par le pré-scan, on ne construit rien
    if (est_attente || est_repli)
        return []

    if (differe && !donnees.dependances[nom])
    {
        // Construire les nœuds du modèle d'attente
        const bloc_attente = donnees.attente
        const nom_attente  = bloc_attente?.args[0].slice(1)
        const noeuds_attente = nom_attente && donnees.dependances[nom_attente]
            ? construire_modele(
                { type: 'modele', args: [nom_attente, ...bloc_attente.args.slice(1)], enfants: [] },
                donnees
              )
            : []
                appliquer_classes_racine(noeuds_attente, classes)

        const ancre = document.createComment(`-${nom}`)

        if (!chargements_en_cours.has(nom))
        {
            const promesse = charger_modele(nom, Object.keys(donnees.dependances)).then(json =>
            {
                chargements_en_cours.delete(nom)
                if (!json) return
                for (const [clef, val] of Object.entries(json.dependances))
                {
                    if (!donnees.dependances[clef])
                        donnees.dependances[clef] = val
                }
            })
            chargements_en_cours.set(nom, promesse)
        }

        (async () =>
        {
            await chargements_en_cours.get(nom)

            if (!ancre.parentNode) return

            // Supprimer le modèle d'attente
            for (const n of noeuds_attente)
            {
                await demonter_noeud(n)
                nettoyer_noeud(n)
                n.parentNode?.removeChild(n)
            }

            if (!donnees.dependances[nom])
            {
                // Échec de chargement : afficher le modèle de repli
                const bloc_repli   = donnees.repli
                const nom_repli    = bloc_repli?.args[0].slice(1)
                const noeuds_repli = nom_repli && donnees.dependances[nom_repli]
                    ? construire_modele(
                        { type: 'modele', args: [nom_repli, ...bloc_repli.args.slice(1)], enfants: [] },
                        donnees
                      )
                    : []
                appliquer_classes_racine(noeuds_repli, classes)
                ancre.after(...noeuds_repli)
                ancre.remove()
                queueMicrotask(() => noeuds_repli.forEach(n => {
                    if (n.nodeType === 1 && document.contains(n)) monter_noeud(n)
                }))
                return
            }

            const noeuds = construire_modele({ ...bloc, args: [nom, ...bloc.args.slice(1)] }, donnees)
            appliquer_classes_racine(noeuds, classes)
            ancre.after(...noeuds)
            ancre.remove()

            queueMicrotask(() => {
                noeuds.forEach(n => {
                    if (n.nodeType === 1 && document.contains(n))
                        monter_noeud(n)
                })
            })
        })()

        return [ancre, ...noeuds_attente]
    }

    const modele = donnees.dependances[nom]
    const scope_modele = creer_scope(donnees.scope)
    const args = {}

    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@args`)
        {
            const declarations = extraire_declarations_args(decapsuler(enfant.args[1]))
            const declarations_par_nom = new Map()
            for (const declaration of declarations)
            {
                declarations_par_nom.set(declaration.nom, declaration)
            }

            const affectations = new Map()
            const arguments_appel = bloc.args[1]
                ? extraire_arguments_modele(decapsuler(bloc.args[1]))
                : []

            const obtenir_premier_argument_libre = () =>
            {
                for (const declaration of declarations)
                {
                    if (!affectations.has(declaration.nom))
                        return declaration.nom
                }
                return null
            }

            for (const argument_appel of arguments_appel)
            {
                if (argument_appel.nom)
                {
                    if (!declarations_par_nom.has(argument_appel.nom))
                        throw new Error(`argument nommé inconnu : ${argument_appel.nom}`)
                    if (affectations.has(argument_appel.nom))
                        throw new Error(`conflit d'affectation : ${argument_appel.nom} est défini plusieurs fois`)

                    affectations.set(argument_appel.nom, argument_appel.valeur)
                    continue
                }

                const argument_libre = obtenir_premier_argument_libre()
                if (!argument_libre)
                    throw new Error(`trop d'arguments positionnels passés au modèle ${nom}`)

                affectations.set(argument_libre, argument_appel.valeur)
            }

            for (const declaration of declarations)
            {
                const { nom, valeur_defaut } = declaration
                const valeur_brute = affectations.has(nom)
                    ? affectations.get(nom)
                    : (valeur_defaut ?? ``)
                const valeur_decapsule = decapsuler_si_entoure(valeur_brute)

                if (/^\$[a-zA-Z_][\w]*$/.test(valeur_decapsule))
                {
                    args[nom] = {
                        __avec_liaison_arg: true,
                        variable: valeur_decapsule,
                        scope: donnees.scope,
                        args: donnees.args || {}
                    }
                    continue
                }
                
                const lecture = lire_variable(donnees.scope, donnees.args || {}, valeur_decapsule, false)
                if (lecture.trouve)
                {
                    args[nom] = lecture.valeur
                }
                else
                {
                    args[nom] = valoriser(valeur_decapsule, donnees)
                }
            }
        }
    }

    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@style`)
        {
            const css = decapsuler(enfant.args[1])
            activer_style(nom, css)
        }
        if (enfant.type === `instruction` && enfant.args[0] === `@script`)
        {
            const js = decapsuler(enfant.args[1])
            activer_script(nom, js, scope_modele, args)
        }
    }

    const donnees_modele = {
        ...donnees,
        scope: scope_modele,
        args: args,
        tenons: [...donnees.tenons, { enfants: bloc.enfants, donnees }]
    }

    const noeuds = construire_bloc(modele, donnees_modele)
    appliquer_classes_racine(noeuds, classes)
    noeuds.forEach(noeud => { if (!noeud._avec_modele) noeud._avec_modele = nom })

    return noeuds
}

const monter_noeud = (noeud) =>
{
    if (noeud.nodeType === 1)
    {
        if (noeud._avec_actions?.mount)
        {
            executer_script(noeud._avec_actions.mount, null, noeud, noeud._avec_scope, noeud._avec_args)
        }
    }
}

const demonter_noeud = async (noeud) =>
{
    if (noeud.nodeType === 1)
    {
        if (noeud._avec_actions?.unmount)
        {
            await executer_script_async(noeud._avec_actions.unmount, null, noeud, noeud._avec_scope, noeud._avec_args)
        }

        await Promise.all([...noeud.children].map(enfant => demonter_noeud(enfant)))
    }
}

const nettoyer_noeud = (noeud) =>
{
    if (noeud.nodeType === 1)
    {
        if (noeud._avec_modele)
        {
            desactiver_style(noeud._avec_modele)
            desactiver_script(noeud._avec_modele, noeud._avec_scope)
        }

        for (const enfant of noeud.children)
        {
            nettoyer_noeud(enfant)
        }
    }
}
