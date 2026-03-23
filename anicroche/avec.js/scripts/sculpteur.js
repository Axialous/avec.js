export const etat_sculpteur = {
    instance: null,
    racine: null,
    prochain_id_scope: 1
}

const scripts_actifs = new Map()
const observateurs   = new Set()

// Le nœud en cours de construction (pour tracker ses dépendances)
let noeud_courant = null

export const definir_noeud_courant = (noeud) => { noeud_courant = noeud }
export const effacer_noeud_courant = ()       => { noeud_courant = null  }

export const observer_sculpteur = (fn) =>
{
    observateurs.add(fn)
    return () => observateurs.delete(fn) // Retourne une fonction pour se désabonner
}

const notifier = (propriete, valeur, ancienne_valeur) =>
{
    for (const fn of observateurs)
        fn(propriete, valeur, ancienne_valeur)
}

const creer_scope_interne = (parent = null) =>
{
    return {
        id: etat_sculpteur.prochain_id_scope++,
        parent,
        variables: Object.create(null)
    }
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
        return {
            trouve: true,
            valeur: args[propriete],
            est_arg: true,
            clef: `arg:${String(propriete)}`
        }
    }

    const base = scope || etat_sculpteur.racine
    const scope_proprietaire = trouver_scope_variable(base, propriete)
    if (!scope_proprietaire)
    {
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
    const cible = scope_proprietaire || base

    const ancienne_valeur = cible.variables[propriete]
    cible.variables[propriete] = valeur

    if (ancienne_valeur !== valeur)
        notifier(clef_dependance(cible, propriete), valeur, ancienne_valeur)

    return true
}

const creer_runtime = (scope, args = {}) =>
{
    const cible = Object.create(null)
    const VARIABLES_CONTEXTE_SCRIPT = new Set([`$event`, `$node`, `$vars`])

    return new Proxy(cible, {
        has(objet, propriete)
        {
            if (typeof propriete === 'string' && VARIABLES_CONTEXTE_SCRIPT.has(propriete))
                return false
            if (typeof propriete === 'string' && propriete.startsWith(`$`))
                return true
            return Reflect.has(objet, propriete)
        },

        get(objet, propriete)
        {
            if (typeof propriete === 'symbol')
                return Reflect.get(objet, propriete)

            const lecture = lire_variable(scope, args, propriete, true)
            if (lecture.trouve)
                return lecture.valeur

            return Reflect.get(objet, propriete)
        },

        set(objet, propriete, valeur)
        {
            if (typeof propriete !== 'string')
                return Reflect.set(objet, propriete, valeur)

            if (propriete.startsWith(`$`))
                return ecrire_variable(scope, args, propriete, valeur)

            return Reflect.set(objet, propriete, valeur)
        }
    })
}

export const creer_runtime_contexte = (scope, args = {}) =>
{
    initialiser_sculpteur()
    return creer_runtime(scope || etat_sculpteur.racine, args)
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

export const executer_script_async = async (script, evenement, noeud, scope = null, args = null) =>
{
    if (etat_sculpteur.instance)
    {
        try
        {
            const runtime = creer_runtime_contexte(scope || noeud?._avec_scope, args || noeud?._avec_args || {})
            const FonctionAsync = async function(){}.constructor
            await new FonctionAsync(
                `runtime`,
                `$event`,
                `$node`,
                `$vars`,
                `
                with (runtime) {
                    ${script}
                }
                `
            )(runtime, evenement, noeud, noeud?._avec_vars)
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
            const runtime = creer_runtime_contexte(scope || noeud?._avec_scope, args || noeud?._avec_args || {})
            new Function(
                `runtime`,
                `$event`,
                `$node`,
                `$vars`,
                `
                with (runtime) {
                    ${script}
                }
                `
            )(runtime, evenement, noeud, noeud?._avec_vars)
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
        const runtime = creer_runtime_contexte(scope_effectif, args)
        const fonction = new Function(
            `runtime`,
            `
            with (runtime)
            {
                ${js}
            }
            `
        )

        fonction(runtime)

        scripts_actifs.set(clef_script, {
            code: js,
            compte: 1
        })
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
            scripts_actifs.delete(clef_script)
        }
    }
}
