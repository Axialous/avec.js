import { creer_fonctions_magasin, preparer_donnees } from './magasin.js'
import { creer_fonctions_mailer }  from './mailer.js'
import { evaluer, ERREUR as ERREUR_AUGURE } from './augure.js'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID, webcrypto } from 'crypto'

if (!globalThis.crypto)
    globalThis.crypto = webcrypto

const mode = process.env.mode || 'prod'
const origines_configurees = [process.env.cors_origin, process.env.app_url]
    .filter(Boolean)
    .flatMap(valeur => String(valeur).split(','))
    .map(valeur => valeur.trim())
    .filter(Boolean)

const est_origine_http = (origine) =>
{
    try
    {
        const { protocol } = new URL(origine)
        return protocol === 'http:' || protocol === 'https:'
    }
    catch
    {
        return false
    }
}

const resoudre_origine_cors = (req) =>
{
    const origine = req.headers.origin
    if (!origine)
        return origines_configurees[0] ?? null

    if (origines_configurees.includes(origine))
        return origine

    if (mode === 'dev' && est_origine_http(origine))
        return origine

    return null
}

const appliquer_cors = (req, rep) =>
{
    const origine = resoudre_origine_cors(req)
    if (origine)
        rep.setHeader('Access-Control-Allow-Origin', origine)

    rep.setHeader('Access-Control-Allow-Credentials', 'true')
    rep.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    rep.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    rep.setHeader('Vary', 'Origin')
}

// ─── $indicate ────────────────────────────────────────────────────────────────

class ReponseDeja extends Error
{
    constructor()
    {
        super('reponse_deja_envoyee')
    }
}

const est_reponse_deja = (erreur) => erreur instanceof ReponseDeja

const est_objet_simple = (valeur) =>
    valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur)

const creer_add_to_data = (data_reponse) => (clef, valeur) =>
{
    if (clef === undefined || clef === null)
        return

    const clef_normale = String(clef)
    if (Object.prototype.hasOwnProperty.call(data_reponse, clef_normale))
        return

    data_reponse[clef_normale] = valeur
}

const creer_indicate = (rep, data_reponse, executer_post_respond = null) => (statut, message, data) =>
{
    const envoyer_reponse = () =>
    {
        if (rep.headersSent)
            return

        const succes = statut >= 200 && statut < 300
        const data_base = data !== undefined ? data : {}
        const data_finale = est_objet_simple(data_base)
            ? { ...data_base, ...data_reponse }
            : data_base

        const reponse = {
            code: statut,
            [succes ? 'message' : 'error']: message,
            data: data_finale
        }

        rep.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' })
        rep.end(JSON.stringify(reponse))
    }

    if (typeof executer_post_respond === 'function')
    {
        Promise
            .resolve()
            .then(() => executer_post_respond())
            .then(() => envoyer_reponse())
            .catch((err) =>
            {
                if (est_reponse_deja(err) || rep.headersSent)
                    return

                console.log(`/!\\ erreur post_respond : ${err.message}`)

                const reponse = {
                    code: 500,
                    error: 'Erreur interne',
                    data: data_reponse
                }

                rep.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
                rep.end(JSON.stringify(reponse))
            })
    }
    else
    {
        envoyer_reponse()
    }

    throw new ReponseDeja()
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

const parser_cookies = (cookie_header) =>
{
    if (!cookie_header || typeof cookie_header !== 'string')
        return {}

    const cookies = {}
    for (const morceau of cookie_header.split(';'))
    {
        const brut = morceau.trim()
        if (!brut) continue

        const index_egal = brut.indexOf('=')
        if (index_egal <= 0) continue

        const nom = brut.slice(0, index_egal).trim()
        const valeur_brute = brut.slice(index_egal + 1)

        if (!nom) continue

        try
        {
            cookies[nom] = decodeURIComponent(valeur_brute)
        }
        catch
        {
            cookies[nom] = valeur_brute
        }
    }

    return cookies
}

const construire_request = (req) => ({
    ip: req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress,
    user_agent: req.headers['user-agent'] ?? null,
    path: new URL(req.url, 'http://localhost').pathname,
    headers: req.headers,
    cookies: parser_cookies(req.headers.cookie)
})

// ─── JWT & Cookies ────────────────────────────────────────────────────────────

const UNITES_DUREE_SECONDES = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400
}

const convertir_duree_en_secondes = (duree, valeur_par_defaut) =>
{
    const brute = duree ?? valeur_par_defaut

    if (typeof brute === 'number' && Number.isFinite(brute) && brute >= 0)
        return Math.floor(brute)

    if (typeof brute !== 'string')
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    const match = /^\s*(\d+)\s*([smhd])\s*$/i.exec(brute)
    if (!match)
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    const valeur = Number(match[1])
    const unite  = UNITES_DUREE_SECONDES[match[2].toLowerCase()]

    if (!Number.isFinite(valeur) || valeur < 0 || !unite)
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    return valeur * unite
}

const creer_sign_token = () => async (payload = {}, options = {}) =>
{
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Payload JWT invalide : objet attendu')

    const secret = process.env.secret_jwt ?? process.env.JWT_SECRET
    if (!secret)
        throw new Error('secret_jwt manquant')

    const lifetime_secondes = convertir_duree_en_secondes(options?.lifetime, '15m')
    const maintenant = Math.floor(Date.now() / 1000)

    const claims = {
        ...payload,
        iat: maintenant,
        exp: maintenant + lifetime_secondes,
        jti: randomUUID()
    }

    const cle = new TextEncoder().encode(secret)

    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(cle)
}

const creer_verify_token = () => async (jeton) =>
{
    if (!jeton || typeof jeton !== 'string')
        return null

    const secret = process.env.secret_jwt ?? process.env.JWT_SECRET
    if (!secret)
        return null

    try
    {
        const cle = new TextEncoder().encode(secret)
        const { payload } = await jwtVerify(jeton, cle)
        return payload
    }
    catch
    {
        return null
    }
}

const creer_set_cookie = (rep) => (name, value, options = {}) =>
{
    if (!name)
        throw new Error('Nom de cookie invalide')

    const max_age = convertir_duree_en_secondes(options?.lifetime, '30d')
    const http_only = options?.httpOnly ?? true
    const secure = options?.secure ?? (process.env.NODE_ENV === 'production')
    const same_site = options?.sameSite ?? (process.env.NODE_ENV === 'production' ? 'None' : 'Lax')
    const path = options?.path ?? '/'

    const morceaux = [
        `${String(name)}=${encodeURIComponent(String(value ?? ''))}`,
        `Max-Age=${max_age}`,
        `Path=${path}`,
        `SameSite=${same_site}`
    ]

    if (http_only) morceaux.push('HttpOnly')
    if (secure) morceaux.push('Secure')

    const cookie = morceaux.join('; ')
    const entete_existant = rep.getHeader('Set-Cookie')

    if (!entete_existant)
        rep.setHeader('Set-Cookie', cookie)
    else if (Array.isArray(entete_existant))
        rep.setHeader('Set-Cookie', [...entete_existant, cookie])
    else
        rep.setHeader('Set-Cookie', [String(entete_existant), cookie])

    return cookie
}

// ─── Compilation du bloc @script ─────────────────────────────────────────────
// Transforme les déclarations  async $nom(args) { ... }
// en                           const $nom = async (args) => { ... }
// puis évalue dans un contexte injecté

const compiler_script = (code_brut, contexte) =>
{
    // La syntaxe $nom = async ($args) => { ... } est déjà du JS valide, pas de transformation nécessaire
    // Il suffit d'extraire les noms pour les exporter.
    // Supporte les fonctions async ET synchrones :
    // $nom = async ($args) => { ... }
    // $nom = ($args) => { ... }
    const noms = [...code_brut.matchAll(/(\$\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)].map(m => m[1])
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

const construire_fonctions_magasin_requete = (fonctions_magasin, contexte_condition) => ({
    ...fonctions_magasin,
    $search_one: (nom_modele, condition, contexte = {}) =>
        fonctions_magasin.$search_one(nom_modele, condition, { ...contexte_condition, ...contexte }),
    $search_all: (nom_modele, condition, contexte = {}, options = undefined) =>
        fonctions_magasin.$search_all(nom_modele, condition, { ...contexte_condition, ...contexte }, options),
    $delete_one: (nom_modele, condition, contexte = {}) =>
        fonctions_magasin.$delete_one(nom_modele, condition, { ...contexte_condition, ...contexte }),
    $delete_all: (nom_modele, condition, contexte = {}, options = undefined) =>
        fonctions_magasin.$delete_all(nom_modele, condition, { ...contexte_condition, ...contexte }, options),
    $update_one: (nom_modele, condition, donnees = {}, contexte = {}) =>
        fonctions_magasin.$update_one(nom_modele, condition, donnees, { ...contexte_condition, ...contexte }),
    $update_all: (nom_modele, condition, donnees = {}, contexte = {}) =>
        fonctions_magasin.$update_all(nom_modele, condition, donnees, { ...contexte_condition, ...contexte }),
})

const executer_prior_respond = async (index, contexte, rep, $body, $request, $context, $indicate) =>
{
    if (!index)
        return { interrompu: false, fonctions: {} }

    const fonctions = compiler_script(index.script ?? '', contexte)
    if (!index?.actions || !Array.isArray(index.actions) || index.actions.length === 0)
        return { interrompu: false, fonctions }

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.prior_respond !== 'string' || !bloc.prior_respond.trim())
            continue

        if (typeof bloc.when === 'string' && bloc.when.trim())
        {
            try
            {
                if (!evaluer(bloc.when, { $request }))
                    continue
            }
            catch (err)
            {
                if (est_reponse_deja(err))
                    return { interrompu: true, fonctions }

                console.log(`/!\ erreur when prior_respond : ${err.message}`)
                if (!rep.headersSent)
                    $indicate(500, 'Erreur interne')
                return { interrompu: rep.headersSent, fonctions }
            }
        }

        const action = analyser_action(bloc.prior_respond)
        if (!action)
        {
            console.log('/!\ prior_respond ignoré : action invalide')
            continue
        }

        const fn = fonctions[action.nom]
        if (typeof fn !== 'function')
        {
            console.log(`/!\ prior_respond ignoré : fonction introuvable ${action.nom}`)
            continue
        }

        const valeurs_args = action.args.map(arg =>
        {
            if (arg === '$body') return $body
            if (arg === '$request') return $request
            if (arg === '$context') return $context
            return undefined
        })

        try
        {
            await fn(...valeurs_args)
        }
        catch (err)
        {
            if (est_reponse_deja(err))
                return { interrompu: true, fonctions }

            console.log(`/!\ erreur prior_respond ${bloc.prior_respond} : ${err.message}`)
            if (!rep.headersSent)
                $indicate(500, 'Erreur interne')
            return { interrompu: rep.headersSent, fonctions }
        }

        if (rep.headersSent)
            return { interrompu: true, fonctions }
    }

    return { interrompu: rep.headersSent, fonctions }
}

const executer_post_respond = async (index, contexte, rep, $body, $request, $context, $indicate) =>
{
    if (!index)
        return { interrompu: false, fonctions: {} }

    const fonctions = compiler_script(index.script ?? '', contexte)
    if (!index?.actions || !Array.isArray(index.actions) || index.actions.length === 0)
        return { interrompu: false, fonctions }

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.post_respond !== 'string' || !bloc.post_respond.trim())
            continue

        if (typeof bloc.when === 'string' && bloc.when.trim())
        {
            try
            {
                if (!evaluer(bloc.when, { $request }))
                    continue
            }
            catch (err)
            {
                if (est_reponse_deja(err))
                    return { interrompu: true, fonctions }

                console.log(`/!\\ erreur when post_respond : ${err.message}`)
                if (!rep.headersSent)
                    $indicate(500, 'Erreur interne')
                return { interrompu: rep.headersSent, fonctions }
            }
        }

        const action = analyser_action(bloc.post_respond)
        if (!action)
        {
            console.log('/!\\ post_respond ignoré : action invalide')
            continue
        }

        const fn = fonctions[action.nom]
        if (typeof fn !== 'function')
        {
            console.log(`/!\\ post_respond ignoré : fonction introuvable ${action.nom}`)
            continue
        }

        const valeurs_args = action.args.map(arg =>
        {
            if (arg === '$body') return $body
            if (arg === '$request') return $request
            if (arg === '$context') return $context
            return undefined
        })

        try
        {
            await fn(...valeurs_args)
        }
        catch (err)
        {
            if (est_reponse_deja(err))
                return { interrompu: true, fonctions }

            console.log(`/!\\ erreur post_respond ${bloc.post_respond} : ${err.message}`)
            if (!rep.headersSent)
                $indicate(500, 'Erreur interne')
            return { interrompu: rep.headersSent, fonctions }
        }

        if (rep.headersSent)
            return { interrompu: true, fonctions }
    }

    return { interrompu: rep.headersSent, fonctions }
}

// ─── Variables injectées dans les handlers ────────────────────────────────────
// $body → corps JSON de la requête (sera fourni au moment de l'appel)

const VARIABLES_HANDLER = ['$body', '$request']

// ─── Construction des routes ──────────────────────────────────────────────────

export const construire_routes = (schemas, index = null) =>
{
    const fonctions_magasin = creer_fonctions_magasin(schemas)
    const fonctions_mailer  = creer_fonctions_mailer()
    const index_routes      = index ?? schemas.index ?? null
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
                appliquer_cors(req, rep)

                const $body     = await lire_corps(req)
                const $request  = construire_request(req)
                const $context  = {}
                const data_reponse = {}
                const $add_to_data = creer_add_to_data(data_reponse)
                let contexte_script = null
                let post_respond_execute = false
                let post_respond_en_cours = false
                const executer_post_respond_safe = async () =>
                {
                    if (post_respond_execute || post_respond_en_cours || !contexte_script)
                        return

                    post_respond_en_cours = true
                    let post_respond = null
                    try
                    {
                        post_respond = await executer_post_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate_brut)
                    }
                    finally
                    {
                        post_respond_en_cours = false
                    }

                    if (post_respond.interrompu)
                        return

                    Object.assign(contexte_script, post_respond.fonctions)
                    post_respond_execute = true
                }
                const $indicate_brut = creer_indicate(rep, data_reponse)
                const $indicate = creer_indicate(rep, data_reponse, executer_post_respond_safe)
                const $q        = citer_condition
                const $sign_token = creer_sign_token()
                const $verify_token = creer_verify_token()
                const $set_cookie = creer_set_cookie(rep)

                const contexte_condition = { $body }
                const fonctions_magasin_requete = construire_fonctions_magasin_requete(fonctions_magasin, contexte_condition)
                contexte_script = {
                    ...fonctions_magasin_requete,
                    ...fonctions_mailer,
                    $indicate,
                    $add_to_data,
                    $body,
                    $request,
                    $context,
                    $sign_token,
                    $verify_token,
                    $set_cookie,
                    $q
                }

                const prior_respond = await executer_prior_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate)
                if (prior_respond.interrompu)
                    return

                Object.assign(contexte_script, prior_respond.fonctions)

                // Compiler le script à chaque requête pour lier $indicate à cette réponse
                const fonctions = compiler_script(table.script, contexte_script)

                const fn = fonctions[action.nom]
                if (typeof fn !== 'function')
                {
                    $indicate(500, 'Erreur interne')
                    return
                }

                const valeurs_args = action.args.map(arg =>
                {
                    if (arg === '$body') return $body
                    if (arg === '$request') return $request
                    return undefined
                })

                try
                {
                    await fn(...valeurs_args)
                }
                catch (err)
                {
                    if (est_reponse_deja(err))
                        return

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
                appliquer_cors(req, rep)

            const $body     = await lire_corps(req)
            const $request  = construire_request(req)
            const $context  = {}
            const data_reponse = {}
            const $add_to_data = creer_add_to_data(data_reponse)
            let contexte_script = null
            let post_respond_execute = false
            let post_respond_en_cours = false
            const executer_post_respond_safe = async () =>
            {
                if (post_respond_execute || post_respond_en_cours || !contexte_script)
                    return

                post_respond_en_cours = true
                let post_respond = null
                try
                {
                    post_respond = await executer_post_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate_brut)
                }
                finally
                {
                    post_respond_en_cours = false
                }

                if (post_respond.interrompu)
                    return

                Object.assign(contexte_script, post_respond.fonctions)
                post_respond_execute = true
            }
            const $indicate_brut = creer_indicate(rep, data_reponse)
            const $indicate = creer_indicate(rep, data_reponse, executer_post_respond_safe)
            const $sign_token = creer_sign_token()
            const $verify_token = creer_verify_token()
            const $set_cookie = creer_set_cookie(rep)
            const contexte_condition = { $body }
            const fonctions_magasin_requete = construire_fonctions_magasin_requete(fonctions_magasin, contexte_condition)
            contexte_script = {
                ...fonctions_magasin_requete,
                ...fonctions_mailer,
                $indicate,
                $add_to_data,
                $body,
                $request,
                $context,
                $sign_token,
                $verify_token,
                $set_cookie,
                $q: citer_condition
            }

            const prior_respond = await executer_prior_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate)
            if (prior_respond.interrompu)
                return

            Object.assign(contexte_script, prior_respond.fonctions)

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

            const champs_prior_create = table.fields.filter(f => f.prior_create != null)
            const champs_post_create  = table.fields.filter(f => f.post_create != null)

            let fonctions = null
            if ((champs_prior_create.length || champs_post_create.length) && table.script)
            {
                fonctions = compiler_script(table.script, contexte_script)
            }

            // Exécuter les prior_create avant l'insertion (tous les champs, pas seulement can_create)
            if (champs_prior_create.length && fonctions)
            {
                for (const champ of champs_prior_create)
                {
                    const action = analyser_action(champ.prior_create)
                    if (!action) continue
                    const fn = fonctions[action.nom]
                    if (typeof fn !== 'function')
                    {
                        console.log(`/!\ prior_create ignoré : fonction introuvable ${action.nom}`)
                        continue
                    }
                    const valeurs_args = action.args.map(arg =>
                    {
                        if (arg === '$body')   return $body
                        if (arg === '$request') return $request
                        if (arg === '$values') return $values
                        return undefined
                    })
                    try
                    {
                        await fn(...valeurs_args)
                    }
                    catch (err)
                    {
                        if (est_reponse_deja(err))
                            return

                        console.log(`/!\ erreur prior_create ${champ.prior_create} : ${err.message}`)
                        if (!rep.headersSent) $indicate(500, 'Erreur interne')
                        return
                    }
                }
            }

            try
            {
                const valeurs_creees = await fonctions_magasin.$create_one(nom_entree, $values)
                Object.assign($values, valeurs_creees)

                // Exécuter les post_create après l'insertion SQL
                if (champs_post_create.length && fonctions)
                {
                    for (const champ of champs_post_create)
                    {
                        const action = analyser_action(champ.post_create)
                        if (!action) continue
                        const fn = fonctions[action.nom]
                        if (typeof fn !== 'function')
                        {
                            console.log(`/!\ post_create ignoré : fonction introuvable ${action.nom}`)
                            continue
                        }
                        const valeurs_args = action.args.map(arg =>
                        {
                            if (arg === '$body')   return $body
                            if (arg === '$request') return $request
                            if (arg === '$values') return $values
                            return undefined
                        })
                        try
                        {
                            await fn(...valeurs_args)
                        }
                        catch (err)
                        {
                            if (est_reponse_deja(err))
                                return

                            console.log(`/!\ erreur post_create ${champ.post_create} : ${err.message}`)
                            if (!rep.headersSent) $indicate(500, 'Erreur interne')
                            return
                        }
                    }
                }

                if (!rep.headersSent)
                    $indicate(201, 'Créé')
            }
            catch (err)
            {
                if (est_reponse_deja(err))
                    return

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

    const chemins_options = [...new Set(routes.map(route => route.chemin))]
    for (const chemin of chemins_options)
    {
        routes.push({
            methode: 'OPTIONS',
            chemin,
            handler: (req, rep) =>
            {
                appliquer_cors(req, rep)
                rep.writeHead(204)
                rep.end()
            }
        })
    }

    return routes
}
