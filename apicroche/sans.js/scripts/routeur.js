import { creer_fonctions_magasin, preparer_donnees } from './magasin.js'
import { creer_fonctions_mailer }  from './mailer.js'
import { evaluer, ERREUR as ERREUR_AUGURE } from './augure.js'

// ─── $indicate ────────────────────────────────────────────────────────────────

const creer_indicate = (rep) => (statut, message, data) =>
{
    const succes = statut >= 200 && statut < 300
    const reponse = {
        code: statut,
        [succes ? 'message' : 'error']: message,
        data: data !== undefined ? data : {}
    }

    rep.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' })
    rep.end(JSON.stringify(reponse))
}

// ─── Lecture du corps JSON ────────────────────────────────────────────────────

const lire_corps = (req) => new Promise((resolve) =>
{
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () =>
    {
        try   { resolve(JSON.parse(data)) }
        catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
})

// ─── Compilation du bloc @script ─────────────────────────────────────────────
// Transforme les déclarations  async $nom(args) { ... }
// en                           const $nom = async (args) => { ... }
// puis évalue dans un contexte injecté

const compiler_script = (code_brut, contexte) =>
{
    // La syntaxe $nom = async ($args) => { ... } est déjà du JS valide, pas de transformation nécessaire
    // Il suffit d'extraire les noms pour les exporter
    const noms = [...code_brut.matchAll(/(\$\w+)\s*=\s*async\s*\(/g)].map(m => m[1])
    const export_obj = `return { ${noms.join(', ')} }`

    const noms_contexte = Object.keys(contexte)
    const vals_contexte = Object.values(contexte)

    try
    {
        // eslint-disable-next-line no-new-func
        const fabrique = new Function(...noms_contexte, `${code_brut}\n${export_obj}`)
        return fabrique(...vals_contexte)
    }
    catch (err)
    {
        console.log(`/!\\ erreur de compilation du script : ${err.message}`)
        return {}
    }
}

// ─── Parsing de l'action ──────────────────────────────────────────────────────
// Format : $nom_fonction($arg1, $arg2, ...)
// Retourne { nom, args } ou null

const analyser_action = (action) =>
{
    if (!action) return null
    const match = /^(\$\w+)\(([^)]*)\)$/.exec(action.trim())
    if (!match) return null
    const nom  = match[1]
    const args = match[2].split(',').map(a => a.trim()).filter(Boolean)
    return { nom, args }
}

const citer_condition = (valeur) =>
{
    if (valeur === undefined)
        return 'null'

    const json = JSON.stringify(valeur)
    return json === undefined ? 'null' : json
}

// ─── Variables injectées dans les handlers ────────────────────────────────────
// $body → corps JSON de la requête (sera fourni au moment de l'appel)

const VARIABLES_HANDLER = ['$body']

// ─── Construction des routes ──────────────────────────────────────────────────

export const construire_routes = (schemas) =>
{
    const fonctions_magasin = creer_fonctions_magasin(schemas)
    const fonctions_mailer  = creer_fonctions_mailer()
    const routes            = []
    let premiere_route      = true

    for (const table of schemas.tables)
    {
        if (!table.routes?.length || !table.script)
            continue

        for (const route of table.routes)
        {
            const action = analyser_action(route.action)
            if (!action)
            {
                console.log(`/!\\ route sans action valide ignorée : ${route.path}`)
                continue
            }

            const chemin  = route.path
            const methode = (route.methode ?? 'POST').toUpperCase()

            const handler = async (req, rep) =>
            {
                const $body     = await lire_corps(req)
                const $indicate = creer_indicate(rep)
                const $q        = citer_condition

                const contexte_condition = { $body }
                const fonctions_magasin_requete = {
                    ...fonctions_magasin,
                    $search_one: (nom_modele, condition, contexte = {}) =>
                        fonctions_magasin.$search_one(nom_modele, condition, { ...contexte_condition, ...contexte }),
                    $search_all: (nom_modele, condition, contexte = {}) =>
                        fonctions_magasin.$search_all(nom_modele, condition, { ...contexte_condition, ...contexte }),
                    $delete_one: (nom_modele, condition, contexte = {}) =>
                        fonctions_magasin.$delete_one(nom_modele, condition, { ...contexte_condition, ...contexte }),
                    $delete_all: (nom_modele, condition, contexte = {}) =>
                        fonctions_magasin.$delete_all(nom_modele, condition, { ...contexte_condition, ...contexte }),
                }

                // Compiler le script à chaque requête pour lier $indicate à cette réponse
                const fonctions = compiler_script(table.script, {
                    ...fonctions_magasin_requete,
                    ...fonctions_mailer,
                    $indicate,
                    $q
                })

                const fn = fonctions[action.nom]
                if (typeof fn !== 'function')
                {
                    $indicate(500, 'Erreur interne')
                    return
                }

                const valeurs_args = action.args.map(arg =>
                {
                    if (arg === '$body') return $body
                    return undefined
                })

                try
                {
                    await fn(...valeurs_args)
                }
                catch (err)
                {
                    console.log(`/!\\ erreur dans ${action.nom} : ${err.message}`)
                    if (!rep.headersSent)
                        $indicate(500, 'Erreur interne')
                }
            }

            routes.push({ methode, chemin, handler })
            if (premiere_route)
            {
                console.log('\nRoutes :')
                premiere_route = false
            }
            console.log(`  ${methode.padEnd(6)} ${chemin}  →  ${action.nom}`)
        }
    }

    for (const table of schemas.tables)
    {
        // ─── Routes POST automatiques (can_create) ────────────────────────────
        const champs_can_create = table.fields.filter(f => f.can_create != null)
        if (!champs_can_create.length) continue

        const nom_entree = table.entry_name ?? table.name
        const chemin     = `/${nom_entree}`
        const methode    = 'POST'

        const handler = async (req, rep) =>
        {
            const $body     = await lire_corps(req)
            const $indicate = creer_indicate(rep)

            // Construire le contexte augure depuis le corps de la requête
            // (lire avec le nom alt si défini, stocker sous le nom interne)
            const contexte = {}
            for (const champ of table.fields)
                contexte[`$${champ.name}`] = $body[champ.alt ?? champ.name] ?? ERREUR_AUGURE

            // Vérifier toutes les conditions can_create
            for (const champ of champs_can_create)
            {
                if (!evaluer(champ.can_create, contexte))
                {
                    $indicate(403, 'Accès refusé')
                    return
                }
            }

            // Filtrer le corps : seulement les champs autorisés
            const donnees = {}
            for (const champ of champs_can_create)
            {
                const valeur_body = $body[champ.alt ?? champ.name]
                if (valeur_body !== undefined)
                    donnees[champ.name] = valeur_body
            }

            // Pré-générer les valeurs auto pour les rendre disponibles dans prior_create
            const $values = preparer_donnees(table, donnees)

            // Exécuter les prior_create avant l'insertion (tous les champs, pas seulement can_create)
            const champs_prior_create = table.fields.filter(f => f.prior_create != null)
            if (champs_prior_create.length && table.script)
            {
                const $q = citer_condition
                const fonctions = compiler_script(table.script, {
                    ...fonctions_magasin,
                    ...fonctions_mailer,
                    $indicate,
                    $q
                })
                for (const champ of champs_prior_create)
                {
                    const action = analyser_action(champ.prior_create)
                    if (!action) continue
                    const fn = fonctions[action.nom]
                    if (typeof fn !== 'function') continue
                    const valeurs_args = action.args.map(arg =>
                    {
                        if (arg === '$body')   return $body
                        if (arg === '$values') return $values
                        return undefined
                    })
                    try
                    {
                        await fn(...valeurs_args)
                    }
                    catch (err)
                    {
                        console.log(`/!\ erreur prior_create ${champ.prior_create} : ${err.message}`)
                        if (!rep.headersSent) $indicate(500, 'Erreur interne')
                        return
                    }
                    if (rep.headersSent) return
                }
            }

            try
            {
                await fonctions_magasin.$create_one(nom_entree, $values)
                $indicate(201, 'Créé')
            }
            catch (err)
            {
                if (err.code === 'RULE_VIOLATION' || err.code === 'ENUM_VIOLATION')
                {
                    $indicate(422, err.message)
                    return
                }
                console.log(`/!\ erreur POST /${nom_entree} : ${err.message}`)
                if (!rep.headersSent)
                    $indicate(500, 'Erreur interne')
            }
        }

        routes.push({ methode, chemin, handler })
        if (premiere_route)
        {
            console.log('\nRoutes :')
            premiere_route = false
        }
        console.log(`  ${methode.padEnd(6)} ${chemin}  →  can_create [${champs_can_create.map(f => f.name).join(', ')}]`)
    }

    return routes
}
