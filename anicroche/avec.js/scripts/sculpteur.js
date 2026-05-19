import {evaluer_valeur} from "./augure.js"

export const etat_sculpteur = {
    instance: null,
    racine: null,
    prochain_id_scope: 1,
    scopes: new Map()
}

const scripts_actifs = new Map()
const observateurs   = new Set()
let nettoyages_script_en_cours = null
const contexte_script_en_cours = []

// Le nœud en cours de construction (pour tracker ses dépendances)
let noeud_courant = null

export const definir_noeud_courant = (noeud) => { noeud_courant = noeud }
export const effacer_noeud_courant = ()       => { noeud_courant = null  }

const obtenir_contexte_script_actif = () => contexte_script_en_cours.at(-1) ?? null

const empiler_contexte_script = (contexte) =>
{
    if (contexte)
        contexte_script_en_cours.push(contexte)
}

const depiler_contexte_script = (contexte) =>
{
    if (!contexte)
        return

    if (contexte_script_en_cours.at(-1) === contexte)
    {
        contexte_script_en_cours.pop()
        return
    }

    const index = contexte_script_en_cours.lastIndexOf(contexte)
    if (index === -1)
        return

    contexte_script_en_cours.splice(index, 1)
}

export const observer_sculpteur = (fn) =>
{
    observateurs.add(fn)
    return () => observateurs.delete(fn) // Retourne une fonction pour se désabonner
}

export const lire_dependance_par_clef = (clef, args = {}) =>
{
    if (typeof clef !== 'string') return undefined

    if (clef.startsWith(`arg:`))
    {
        const propriete = clef.slice(4)
        return args && Object.prototype.hasOwnProperty.call(args, propriete)
            ? args[propriete]
            : undefined
    }

    const pos = clef.indexOf(`:`)
    if (pos <= 0) return undefined

    const scope_id  = Number(clef.slice(0, pos))
    const propriete = clef.slice(pos + 1)
    if (!Number.isFinite(scope_id) || !propriete) return undefined

    const scope = etat_sculpteur.scopes.get(scope_id)
    if (!scope) return undefined

    return scope.variables[propriete]
}

const notifier = (propriete, valeur, ancienne_valeur) =>
{
    for (const fn of observateurs)
        fn(propriete, valeur, ancienne_valeur)
}

const creer_scope_interne = (parent = null) =>
{
    const scope = {
        id: etat_sculpteur.prochain_id_scope++,
        parent,
        variables: Object.create(null)
    }
    etat_sculpteur.scopes.set(scope.id, scope)
    return scope
}

const clef_dependance = (scope, propriete) => `${scope.id}:${String(propriete)}`

const trouver_scope_variable = (scope, propriete) =>
{
    let courant = scope
    while (courant)
    {
        if (Object.prototype.hasOwnProperty.call(courant.variables, propriete))
            return courant
        courant = courant.parent
    }
    return null
}

export const obtenir_scope_racine = () =>
{
    initialiser_sculpteur()
    return etat_sculpteur.racine
}

export const creer_scope = (parent = null) =>
{
    initialiser_sculpteur()
    return creer_scope_interne(parent || etat_sculpteur.racine)
}

export const lire_variable = (scope, args, propriete, suivre_dependance = true) =>
{
    initialiser_sculpteur()

    if (args && Object.prototype.hasOwnProperty.call(args, propriete))
    {
        const valeur_arg = args[propriete]

        if (valeur_arg && valeur_arg.__avec_liaison_arg === true)
        {
            const lecture_liaison = lire_variable(
                valeur_arg.scope,
                valeur_arg.args || {},
                valeur_arg.variable,
                suivre_dependance
            )

            return {
                trouve: true,
                valeur: lecture_liaison.trouve ? lecture_liaison.valeur : ``,
                est_arg: true,
                clef: lecture_liaison.clef || null
            }
        }

        if (valeur_arg && valeur_arg.__avec_expression === true)
        {
            return {
                trouve: true,
                valeur: valeur_arg.__evaluateur
                    ? valeur_arg.__evaluateur(valeur_arg.donnees)
                    : evaluer_valeur(valeur_arg.expression, valeur_arg.donnees),
                est_arg: true,
                clef: null
            }
        }

        return {
            trouve: true,
            valeur: valeur_arg,
            est_arg: true,
            clef: `arg:${String(propriete)}`
        }
    }

    const base = scope || etat_sculpteur.racine
    const scope_proprietaire = trouver_scope_variable(base, propriete)
    if (!scope_proprietaire)
    {
        if (suivre_dependance && noeud_courant && typeof propriete === 'string')
        {
            if (!noeud_courant._avec_deps)
                noeud_courant._avec_deps = new Set()
            noeud_courant._avec_deps.add(clef_dependance(base, propriete))
        }

        return {
            trouve: false,
            valeur: undefined,
            est_arg: false,
            clef: null
        }
    }

    if (suivre_dependance && noeud_courant && typeof propriete === 'string')
    {
        if (!noeud_courant._avec_deps)
            noeud_courant._avec_deps = new Set()
        noeud_courant._avec_deps.add(clef_dependance(scope_proprietaire, propriete))
    }

    return {
        trouve: true,
        valeur: scope_proprietaire.variables[propriete],
        est_arg: false,
        clef: clef_dependance(scope_proprietaire, propriete),
        scope: scope_proprietaire
    }
}

export const ecrire_variable = (scope, args, propriete, valeur) =>
{
    initialiser_sculpteur()

    if (args && Object.prototype.hasOwnProperty.call(args, propriete))
        throw new Error(`Impossible de modifier l'argument ${propriete} : @args est en lecture seule`)

    const base = scope || etat_sculpteur.racine
    const scope_proprietaire = trouver_scope_variable(base, propriete)
    // Si on assigne une fonction à une variable commençant par '$',
    // écrire dans le scope local (base) pour éviter d'écraser une fonction
    // définie dans un scope parent.
    let cible
    if (typeof propriete === 'string' && propriete.startsWith('$') && typeof valeur === 'function')
        cible = base
    else
        cible = scope_proprietaire || base

    const ancienne_valeur = cible.variables[propriete]
    cible.variables[propriete] = valeur

    if (ancienne_valeur !== valeur)
        notifier(clef_dependance(cible, propriete), valeur, ancienne_valeur)

    return true
}

const creer_runtime = (scope, args = {}, contexte_script_source = null) =>
{
    const cible = Object.create(null)
    const VARIABLES_CONTEXTE_SCRIPT = new Set([`$event`, `$node`, `$vars`])

    const obtenir_contexte_script = () => obtenir_contexte_script_actif() || (contexte_script_source?._avec_contexte_script ?? null)

    return new Proxy(cible, {
        has(objet, propriete)
        {
            if (typeof propriete === 'string' && propriete.startsWith(`$`))
                return true
            return Reflect.has(objet, propriete)
        },

        get(objet, propriete)
        {
            if (typeof propriete === 'symbol')
                return Reflect.get(objet, propriete)

            const contexte_script = obtenir_contexte_script()
            if (typeof propriete === 'string' && contexte_script && VARIABLES_CONTEXTE_SCRIPT.has(propriete))
            {
                if (Object.prototype.hasOwnProperty.call(contexte_script, propriete))
                    return contexte_script[propriete]
            }

            const lecture = lire_variable(scope, args, propriete, true)
            if (lecture.trouve)
                return lecture.valeur

            return Reflect.get(objet, propriete)
        },

        set(objet, propriete, valeur)
        {
            if (typeof propriete !== 'string')
                return Reflect.set(objet, propriete, valeur)

            const contexte_script = obtenir_contexte_script()
            if (contexte_script && VARIABLES_CONTEXTE_SCRIPT.has(propriete))
            {
                contexte_script[propriete] = valeur
                return true
            }

            if (propriete.startsWith(`$`))
                return ecrire_variable(scope, args, propriete, valeur)

            return Reflect.set(objet, propriete, valeur)
        }
    })
}

export const creer_runtime_contexte = (scope, args = {}) =>
{
    initialiser_sculpteur()
    return creer_runtime(scope || etat_sculpteur.racine, args, scope || etat_sculpteur.racine)
}

export const definir_variable_racine = (propriete, valeur) =>
{
    initialiser_sculpteur()
    return ecrire_variable(etat_sculpteur.racine, null, propriete, valeur)
}

export const initialiser_sculpteur = () =>
{
    if (etat_sculpteur.instance) return

    etat_sculpteur.racine = creer_scope_interne(null)
    etat_sculpteur.instance = creer_runtime(etat_sculpteur.racine, {})
}

export const commencer_collecte_nettoyages = () =>
{
    nettoyages_script_en_cours = []
    return nettoyages_script_en_cours
}

export const enregistrer_nettoyage = (fn) =>
{
    if (nettoyages_script_en_cours && typeof fn === 'function')
        nettoyages_script_en_cours.push(fn)
}

export const recuperer_nettoyages_script = () =>
{
    const nettoyages = nettoyages_script_en_cours ?? []
    nettoyages_script_en_cours = null
    return nettoyages
}

export const executer_script_async = async (script, evenement, noeud, scope = null, args = null) =>
{
    if (etat_sculpteur.instance)
    {
        try
        {
            const scope_effectif = scope || noeud?._avec_scope
            const runtime = creer_runtime_contexte(scope_effectif, args || noeud?._avec_args || {})
            const contexte_script = scope_effectif
                ? (scope_effectif._avec_contexte_script = scope_effectif._avec_contexte_script || Object.create(null))
                : null
            if (scope_effectif)
            {
                scope_effectif._avec_contexte_script.$event = evenement
                scope_effectif._avec_contexte_script.$node = noeud
                scope_effectif._avec_contexte_script.$vars = noeud?._avec_vars
            }
            empiler_contexte_script(contexte_script)
            const FonctionAsync = async function(){}.constructor
            try
            {
                await new FonctionAsync(
                    `runtime`,
                    `
                    with (runtime) {
                        ${script}
                    }
                    `
                )(runtime)
            }
            finally
            {
                depiler_contexte_script(contexte_script)
            }
        }
        catch (erreur)
        {
            console.error(`Erreur handler AVEC :`, erreur)
        }
    }
}

export const executer_script = (script, evenement, noeud, scope = null, args = null) =>
{
    if (etat_sculpteur.instance)
    {
        try
        {
            const scope_effectif = scope || noeud?._avec_scope
            const runtime = creer_runtime_contexte(scope_effectif, args || noeud?._avec_args || {})
            const contexte_script = scope_effectif
                ? (scope_effectif._avec_contexte_script = scope_effectif._avec_contexte_script || Object.create(null))
                : null
            if (scope_effectif)
            {
                scope_effectif._avec_contexte_script.$event = evenement
                scope_effectif._avec_contexte_script.$node = noeud
                scope_effectif._avec_contexte_script.$vars = noeud?._avec_vars
            }
            empiler_contexte_script(contexte_script)
            try
            {
                new Function(
                    `runtime`,
                    `
                    with (runtime) {
                        ${script}
                    }
                    `
                )(runtime)
            }
            finally
            {
                depiler_contexte_script(contexte_script)
            }
        }
        catch (erreur)
        {
            console.error(`Erreur handler AVEC :`, erreur)
        }
    }
}

export const activer_script = (modele, js, scope = null, args = {}) =>
{
    initialiser_sculpteur()

    const scope_effectif = scope || etat_sculpteur.racine
    const clef_script = `${modele}#${scope_effectif.id}`

    if (scripts_actifs.has(clef_script))
    {
        scripts_actifs.get(clef_script).compte++
    }
    else
    {
        commencer_collecte_nettoyages()
        scope_effectif._avec_contexte_script = scope_effectif._avec_contexte_script || Object.create(null)
        const runtime = creer_runtime_contexte(scope_effectif, args)
        const fonction = new Function(
            `runtime`,
            `
            with (runtime) {
                ${js}
            }
            `
        )

        try
        {
            const contexte_script = scope_effectif._avec_contexte_script
            empiler_contexte_script(scope_effectif._avec_contexte_script)
            try
            {
                fonction(runtime)
            }
            finally
            {
                depiler_contexte_script(contexte_script)
            }
            const nettoyages = recuperer_nettoyages_script()

            scripts_actifs.set(clef_script, {
                code: js,
                compte: 1,
                nettoyages
            })
        }
        catch (erreur)
        {
            const nettoyages = recuperer_nettoyages_script()
            for (const nettoyage of nettoyages)
            {
                try { nettoyage() }
                catch (nettoyage_erreur) { console.error(`Erreur nettoyage script AVEC :`, nettoyage_erreur) }
            }
            console.error(`Erreur script AVEC :`, erreur)
        }
    }
}

export const desactiver_script = (modele, scope = null) =>
{
    const scope_effectif = scope || etat_sculpteur.racine
    const clef_script = `${modele}#${scope_effectif.id}`
    const entree = scripts_actifs.get(clef_script)
    if (entree)
    {
        entree.compte--
        if (entree.compte <= 0)
        {
            for (const nettoyage of entree.nettoyages ?? [])
            {
                try { nettoyage() }
                catch (erreur) { console.error(`Erreur nettoyage script AVEC :`, erreur) }
            }
            scripts_actifs.delete(clef_script)
        }
    }
}
