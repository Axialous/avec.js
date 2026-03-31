import mysql  from 'mysql2/promise'
import crypto from 'node:crypto'

import { hacher_hmac, hacher_argon2, verifier_argon2, chiffrer_aes, dechiffrer_aes } from './crypto.js'
import { evaluer, ERREUR as ERREUR_AUGURE } from './augure.js'


// ─── Pool de connexions ───────────────────────────────────────────────────────

let _pool = null

const pool = () =>
{
    if (_pool) return _pool

    const host = process.env.database_host || 'localhost'
    const port = parseInt(process.env.database_port || '3306')
    const name = process.env.database_name
    const user = process.env.database_user
    const pass = process.env.database_pass || ''

    if (!name || !user)
        throw new Error("Variables d'environnement manquantes : database_name, database_user")

    _pool = mysql.createPool({ host, port, user, password: pass, database: name })
    return _pool
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

const trouver_modele_entree = (schemas, nom) =>
    schemas.tables.find(t => (t.entry_name ?? t.name) === nom) ?? null

const trouver_modele_table = (schemas, nom) =>
    schemas.tables.find(t => t.name === nom) ?? null

const trouver_champ = (modele, nom) =>
    modele.fields.find(f => f.name === nom) ?? null

// Générer un identifiant aléatoire alphanumérique
const CHARS_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const generer_id = (taille = 12, alphabet = CHARS_ID) =>
{
    const octets = crypto.randomBytes(taille)
    return Array.from(octets).map(b => alphabet[b % alphabet.length]).join('')
}

// Valider la valeur brute contre la rule (expression augure) du champ
// contexte : { '$nom_champ': valeur | ERREUR_AUGURE }
const valider_regle = (champ, contexte) =>
{
    if (!champ?.rule) return true
    return evaluer(champ.rule, contexte)
}

// Appliquer le traitement crypto avant écriture en base
const traiter_ecriture = async (champ, valeur) =>
{
    if (valeur === null || valeur === undefined) return null
    switch (champ?.treatment)
    {
        case 'deterministic_hashing': return hacher_hmac(valeur)
        case 'hashing':               return await hacher_argon2(valeur)
        case 'encryption':            return chiffrer_aes(valeur)
        default:                      return valeur
    }
}

// Décrypter les champs AES d'une ligne (les hash sont irréversibles)
const decrypter_ligne = (modele, ligne) =>
{
    const res = { ...ligne }
    for (const champ of modele.fields)
    {
        if (champ.treatment === 'encryption' && res[champ.name] != null)
        {
            try   { res[champ.name] = dechiffrer_aes(res[champ.name]) }
            catch { res[champ.name] = null }
        }
    }
    return res
}

// Séparer les critères en déterministes (SQL) et non-déterministes (vérification JS)
const separer_criteres = (modele, criteres) =>
{
    const sql  = {}
    const post = {}
    for (const [nom, valeur] of Object.entries(criteres))
    {
        const champ = trouver_champ(modele, nom)
        if (!champ) continue
        switch (champ.treatment)
        {
            case 'deterministic_hashing': sql[nom]  = hacher_hmac(valeur); break
            case 'hashing':               post[nom] = valeur;               break
            case 'encryption':            post[nom] = valeur;               break
            default:                      sql[nom]  = valeur
        }
    }
    return { sql, post }
}

// Vérifier les critères non-SQL sur une ligne déjà lue
const verifier_post = async (modele, ligne, post) =>
{
    for (const [nom, valeur] of Object.entries(post))
    {
        const champ = trouver_champ(modele, nom)
        if (!champ) return false

        if (champ.treatment === 'hashing')
        {
            if (!ligne[nom] || !await verifier_argon2(ligne[nom], valeur))
                return false
        }
        else if (champ.treatment === 'encryption')
        {
            try   { if (dechiffrer_aes(ligne[nom]) !== String(valeur)) return false }
            catch { return false }
        }
    }
    return true
}

const construire_contexte_condition = (modele, ligne, now = new Date(), contexte_externe = {}) =>
{
    const contexte = { $now: now, ...contexte_externe }

    for (const champ of modele.fields)
    {
        const presente = Object.prototype.hasOwnProperty.call(ligne, champ.name)
        contexte[`$${champ.name}`] = presente ? ligne[champ.name] : ERREUR_AUGURE
    }

    return contexte
}

const respecter_condition = (modele, ligne, condition, now = new Date(), contexte_externe = {}, criteres = {}) =>
{
    if (!condition) return true
    const contexte = construire_contexte_condition(modele, ligne, now, contexte_externe)

    // Quand une égalité a déjà été résolue via les critères (SQL/post-vérification),
    // on réinjecte la valeur brute attendue pour que l'expression Augure ne compare
    // pas une valeur stockée (hash/chiffrement) à la valeur brute de la requête.
    for (const [nom, valeur] of Object.entries(criteres))
        contexte[`$${nom}`] = valeur

    return evaluer(condition, contexte)
}

const normaliser_condition = (condition) =>
{
    if (condition === null || condition === undefined)
        throw new Error('Condition requise : utilisez une expression Augure sous forme de chaîne')

    if (typeof condition !== 'string' || !condition.trim())
        throw new Error('Condition invalide : utilisez une expression Augure sous forme de chaîne')

    return condition.trim()
}

const normaliser_contexte_condition = (contexte) =>
{
    if (contexte === null || contexte === undefined)
        return {}

    if (typeof contexte !== 'object' || Array.isArray(contexte))
        throw new Error('Contexte invalide : utilisez un objet de variables Augure')

    return contexte
}

const normaliser_options_liste = (modele, options) =>
{
    if (options === null || options === undefined)
        return {
            order : null,
            dir   : 'asc',
            limit : null,
            offset: 0,
        }

    if (typeof options !== 'object' || Array.isArray(options))
        throw new Error('Options invalides : utilisez un objet { order, dir, limit, offset }')

    const champs_modele = new Set(modele.fields.map(f => f.name))

    const order = options.order ?? null
    if (order !== null)
    {
        if (typeof order !== 'string' || !champs_modele.has(order))
            throw new Error(`Option order invalide : champ inconnu "${order}"`)
    }

    let dir = options.dir ?? 'asc'
    if (typeof dir !== 'string')
        throw new Error('Option dir invalide : utilisez "asc" ou "desc"')
    dir = dir.toLowerCase()
    if (dir !== 'asc' && dir !== 'desc')
        throw new Error('Option dir invalide : utilisez "asc" ou "desc"')

    const limit = options.limit
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0))
        throw new Error('Option limit invalide : utilisez un entier >= 0')

    const offset = options.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0)
        throw new Error('Option offset invalide : utilisez un entier >= 0')

    return {
        order,
        dir,
        limit : limit ?? null,
        offset,
    }
}

const normaliser_valeur_tri = (valeur) =>
{
    if (valeur === null || valeur === undefined)
        return null

    if (valeur instanceof Date)
    {
        const temps = valeur.getTime()
        return Number.isNaN(temps) ? null : temps
    }

    if (typeof valeur === 'number' || typeof valeur === 'bigint')
        return Number(valeur)

    if (typeof valeur === 'boolean')
        return valeur ? 1 : 0

    const temps = Date.parse(String(valeur))
    if (!Number.isNaN(temps))
        return temps

    return String(valeur)
}

const comparer_pour_tri = (a, b, direction) =>
{
    const va = normaliser_valeur_tri(a)
    const vb = normaliser_valeur_tri(b)

    if (va === null && vb === null) return 0
    if (va === null) return direction === 'asc' ? -1 : 1
    if (vb === null) return direction === 'asc' ? 1 : -1

    if (va < vb) return direction === 'asc' ? -1 : 1
    if (va > vb) return direction === 'asc' ? 1 : -1
    return 0
}

const appliquer_options_liste = (elements, options, lire_valeur) =>
{
    let travail = [...elements]

    if (options.order)
    {
        travail.sort((a, b) =>
            comparer_pour_tri(
                lire_valeur(a, options.order),
                lire_valeur(b, options.order),
                options.dir
            )
        )
    }

    if (options.offset > 0)
        travail = travail.slice(options.offset)

    if (options.limit !== null)
        travail = travail.slice(0, options.limit)

    return travail
}

const parser_now_relatif = (token) =>
{
    const match = /^now\s*([+-])\s*(\d+)\s*([smhd])$/i.exec(token)
    if (!match) return null

    const signe  = match[1] === '+' ? 1 : -1
    const valeur = Number(match[2])
    const unite  = match[3].toLowerCase()

    const multiplicateurs = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    }

    const multiplicateur = multiplicateurs[unite]
    if (!multiplicateur || Number.isNaN(valeur)) return null

    return new Date(Date.now() + (signe * valeur * multiplicateur))
}

const parser_litteral_condition = (token) =>
{
    if (!token) return null

    if (token.toLowerCase() === 'now')
        return new Date()

    const now_relatif = parser_now_relatif(token)
    if (now_relatif)
        return now_relatif

    if (token.startsWith('"') && token.endsWith('"'))
    {
        try   { return JSON.parse(token) }
        catch { return token.slice(1, -1) }
    }

    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('`') && token.endsWith('`')))
        return token.slice(1, -1)

    if (/^-?\d+(\.\d+)?$/.test(token))
        return Number(token)

    if (token === 'true')  return true
    if (token === 'false') return false
    if (token === 'null')  return null

    return token
}

const parser_clef_bracket = (brut) =>
{
    if (/^\d+$/.test(brut))
        return Number(brut)

    const premier = brut[0]
    const dernier = brut[brut.length - 1]
    if ((premier === '"' && dernier === '"') || (premier === "'" && dernier === "'") || (premier === '`' && dernier === '`'))
    {
        if (premier === '"')
        {
            try   { return JSON.parse(brut) }
            catch { return brut.slice(1, -1) }
        }
        return brut.slice(1, -1)
    }

    return brut
}

const lire_variable_contexte = (token, contexte) =>
{
    const racine = token.match(/^\$\w+/)?.[0]
    if (!racine)
        return { trouvee: false, valeur: undefined }

    if (!Object.prototype.hasOwnProperty.call(contexte, racine))
        return { trouvee: false, valeur: undefined }

    let valeur = contexte[racine]
    let pos = racine.length

    while (pos < token.length)
    {
        if (token[pos] === '.')
        {
            pos++
            const match = token.slice(pos).match(/^\w+/)
            if (!match)
                return { trouvee: false, valeur: undefined }
            const clef = match[0]
            if (valeur === null || valeur === undefined)
                return { trouvee: false, valeur: undefined }
            valeur = valeur[clef]
            pos += clef.length
            continue
        }

        if (token[pos] === '[')
        {
            const fin = token.indexOf(']', pos)
            if (fin === -1)
                return { trouvee: false, valeur: undefined }
            const brut = token.slice(pos + 1, fin).trim()
            const clef = parser_clef_bracket(brut)
            if (valeur === null || valeur === undefined)
                return { trouvee: false, valeur: undefined }
            valeur = valeur[clef]
            pos = fin + 1
            continue
        }

        return { trouvee: false, valeur: undefined }
    }

    return { trouvee: true, valeur }
}

const extraire_criteres_depuis_condition = (modele, condition, contexte_condition = {}) =>
{
    const champs_modele = new Set(modele.fields.map(f => f.name))
    const criteres = {}

    const regex_egalite = /(?:^|[&(])\s*\$(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)/g
    let match

    while ((match = regex_egalite.exec(condition)) !== null)
    {
        const nom_champ = match[1]
        const token     = match[2]

        if (!champs_modele.has(nom_champ))
            continue
        if (!token)
            continue

        if (token.startsWith('$'))
        {
            const { trouvee, valeur } = lire_variable_contexte(token, contexte_condition)
            if (!trouvee)
                continue
            criteres[nom_champ] = valeur
            continue
        }

        criteres[nom_champ] = parser_litteral_condition(token)
    }

    return criteres
}

const UNITES_SQL = {
    s: 'SECOND',
    m: 'MINUTE',
    h: 'HOUR',
    d: 'DAY'
}

const traduire_now_sql = (expression) =>
{
    const expr = expression.trim().toLowerCase()
    if (expr === 'now')
        return 'NOW()'

    const match = /^now\s*([+-])\s*(\d+)\s*([smhd])$/.exec(expr)
    if (!match)
        return null

    const operation = match[1] === '+' ? 'DATE_ADD' : 'DATE_SUB'
    const valeur    = Number(match[2])
    const unite     = UNITES_SQL[match[3]]

    if (!unite || Number.isNaN(valeur))
        return null

    return `${operation}(NOW(), INTERVAL ${valeur} ${unite})`
}

const extraire_filtres_temps_sql = (modele, condition) =>
{
    const champs_modele = new Map(modele.fields.map(f => [f.name, f]))
    const clauses = []

    const regex = /\$(\w+)\s*(>=|>|<=|<)\s*(now(?:\s*[+-]\s*\d+\s*[smhd])?)/gi
    let match

    while ((match = regex.exec(condition)) !== null)
    {
        const nom_champ = match[1]
        const operateur = match[2]
        const droite    = match[3]

        const champ = champs_modele.get(nom_champ)
        if (!champ)
            continue

        // Uniquement les dates "natives" SQL pour éviter les champs chiffrés/hashés.
        if ((champ.type !== 'date' && champ.type !== 'datetime') || champ.treatment)
            continue

        const droite_sql = traduire_now_sql(droite)
        if (!droite_sql)
            continue

        clauses.push(`\`${nom_champ}\` ${operateur} ${droite_sql}`)
    }

    return clauses
}

// Construire la clause WHERE
const construire_where = (criteres_sql, clauses_supplementaires = []) =>
{
    const noms = Object.keys(criteres_sql)
    const morceaux = []

    if (noms.length)
        morceaux.push(...noms.map(n => `\`${n}\` = ?`))

    if (clauses_supplementaires.length)
        morceaux.push(...clauses_supplementaires)

    if (!morceaux.length) return { clause: '', valeurs: [] }

    return {
        clause : 'WHERE ' + morceaux.join(' AND '),
        valeurs: Object.values(criteres_sql)
    }
}

// Supprimer une ligne par sa clef primaire
const supprimer_par_pk = async (modele, ligne) =>
{
    const clause  = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
    const valeurs = modele.primary.map(c => ligne[c])
    await pool().query(`DELETE FROM \`${modele.name}\` WHERE ${clause}`, valeurs)
}

// ─── $search_one ─────────────────────────────────────────────────────────────

const creer_search_one = (schemas) => async (nom_modele, condition, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)

    const criteres = extraire_criteres_depuis_condition(modele, condition_norm, contexte_norm)
    const filtres_temps_sql = extraire_filtres_temps_sql(modele, condition_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, filtres_temps_sql)
    const besoin_post         = Object.keys(post).length > 0

    const requete  = `SELECT * FROM \`${modele.name}\` ${clause}`.trim()
    const [lignes] = await pool().query(requete, valeurs)

    const now = new Date()

    for (const ligne of lignes)
    {
        const post_ok = besoin_post ? await verifier_post(modele, ligne, post) : true
        if (!post_ok)
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        const condition_ok = respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres)

        if (!condition_ok)
            continue

        return ligne_decryptee
    }
    return null
}

// ─── $search_all ─────────────────────────────────────────────────────────────

const creer_search_all = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)
    const options_norm   = normaliser_options_liste(modele, options)

    const criteres = extraire_criteres_depuis_condition(modele, condition_norm, contexte_norm)
    const filtres_temps_sql = extraire_filtres_temps_sql(modele, condition_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, filtres_temps_sql)
    const besoin_post         = Object.keys(post).length > 0

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )

    const now = new Date()
    const resultats = []
    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres))
            continue

        resultats.push(ligne_decryptee)
    }

    return appliquer_options_liste(resultats, options_norm, (ligne, nom) => ligne[nom])
}

// ─── $delete_one ─────────────────────────────────────────────────────────────

const creer_delete_one = (schemas) => async (nom_modele, condition, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)

    const criteres = extraire_criteres_depuis_condition(modele, condition_norm, contexte_norm)
    const filtres_temps_sql = extraire_filtres_temps_sql(modele, condition_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, filtres_temps_sql)
    const besoin_post         = Object.keys(post).length > 0

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )
    const now = new Date()
    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres))
            continue

        await supprimer_par_pk(modele, ligne)
        return
    }
}

// ─── $delete_all ─────────────────────────────────────────────────────────────

const creer_delete_all = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)
    const options_norm   = normaliser_options_liste(modele, options)

    const criteres = extraire_criteres_depuis_condition(modele, condition_norm, contexte_norm)
    const filtres_temps_sql = extraire_filtres_temps_sql(modele, condition_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, filtres_temps_sql)
    const besoin_post         = Object.keys(post).length > 0

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )
    const now = new Date()
    const a_supprimer = []
    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres))
            continue

        a_supprimer.push({ brute: ligne, decryptee: ligne_decryptee })
    }

    const cibles = appliquer_options_liste(
        a_supprimer,
        options_norm,
        (element, nom) => element.decryptee[nom]
    )

    for (const element of cibles)
        await supprimer_par_pk(modele, element.brute)
}

// ─── Logique d'insertion (partagée par $create_one et $create_all) ────────────

const inserer_batch = async (modele, tableau) =>
{
    if (!tableau.length) return []

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // 1. Copier les données et générer les valeurs auto
    const insertions = tableau.map(d => ({ ...d }))

    for (const champ of modele.fields)
    {
        if (champ.default !== 'auto') continue

        const alphabet = champ.chars ?? CHARS_ID
        const taille   = champ.length?.max ?? champ.length?.min ?? champ.max ?? 12
        const besoin   = insertions.filter(ins => ins[champ.name] === undefined)
        if (!besoin.length) continue

        if (dans_contrainte(champ.name))
        {
            // Générer des candidats uniques dans le batch
            const utilises = new Set(
                insertions
                    .filter(ins => ins[champ.name] !== undefined)
                    .map(ins => ins[champ.name])
            )
            let tentatives = 0
            const candidats = []
            for (const ins of besoin)
            {
                let valeur
                do {
                    if (++tentatives > 1000)
                        throw new Error(`Impossible de générer des valeurs uniques pour "${champ.name}"`)
                    valeur = generer_id(taille, alphabet)
                } while (utilises.has(valeur))
                utilises.add(valeur)
                candidats.push({ ins, valeur })
            }

            // Vérifier en une seule requête lesquelles existent déjà en base
            const vals_candidates = candidats.map(c => c.valeur)
            const placeholders    = vals_candidates.map(() => '?').join(', ')
            const [rows] = await pool().query(
                `SELECT \`${champ.name}\` FROM \`${modele.name}\` WHERE \`${champ.name}\` IN (${placeholders})`,
                vals_candidates
            )
            const existantes = new Set(rows.map(r => r[champ.name]))

            // Regénérer seulement les conflits
            for (const candidat of candidats)
            {
                if (existantes.has(candidat.valeur))
                {
                    let valeur
                    let t = 0
                    do {
                        if (++t > 100)
                            throw new Error(`Impossible de générer une valeur unique pour "${champ.name}"`)
                        valeur = generer_id(taille, alphabet)
                    } while (utilises.has(valeur) || existantes.has(valeur))
                    utilises.add(valeur)
                    candidat.valeur = valeur
                }
                candidat.ins[champ.name] = candidat.valeur
            }
        }
        else
        {
            for (const ins of besoin)
                ins[champ.name] = generer_id(taille, alphabet)
        }
    }

    // 1b. Résoudre les defaults par référence ($autre_champ)
    for (const champ of modele.fields)
    {
        if (typeof champ.default !== 'string' || !champ.default.startsWith('$')) continue
        const nom_source = champ.default.slice(1)
        for (const ins of insertions)
        {
            if (ins[champ.name] === undefined && ins[nom_source] !== undefined)
                ins[champ.name] = ins[nom_source]
        }
    }

    // 2. Valider les règles
    for (let i = 0; i < insertions.length; i++)
    {
        // Construire le contexte : tous les champs connus, absents → ERREUR_AUGURE (':x')
        const contexte = {}
        for (const champ of modele.fields)
            contexte[`$${champ.name}`] = insertions[i][champ.name] ?? ERREUR_AUGURE

        for (const champ of modele.fields)
        {
            const valeur = insertions[i][champ.name]

            if (valeur !== undefined && champ.values && !champ.values.includes(String(valeur)))
                throw Object.assign(
                    new Error(`Valeur "${valeur}" non autorisée pour le champ "${champ.name}" (valeurs : ${champ.values.join(', ')})`),
                    { code: 'ENUM_VIOLATION', champ: champ.name, index: i }
                )

            if (!valider_regle(champ, contexte))
                throw Object.assign(
                    new Error(`Valeur invalide pour le champ "${champ.name}" (ligne ${i})`),
                    { code: 'RULE_VIOLATION', champ: champ.name, index: i }
                )
        }
    }

    // 3. Traitements crypto en parallèle
    const insertions_traitees = await Promise.all(
        insertions.map(async (insertion) =>
        {
            const traitee = {}
            for (const champ of modele.fields)
            {
                if (insertion[champ.name] === undefined) continue
                traitee[champ.name] = await traiter_ecriture(champ, insertion[champ.name])
            }
            return traitee
        })
    )

    // 4. INSERT batch
    const ensemble_cols = new Set()
    for (const ins of insertions_traitees)
        for (const nom of Object.keys(ins))
            ensemble_cols.add(nom)

    const cols      = [...ensemble_cols]
    const cols_q    = cols.map(n => `\`${n}\``).join(', ')
    const lignes    = insertions_traitees.map(ins => cols.map(c => ins[c] ?? null))
    const marks     = `(${cols.map(() => '?').join(', ')})`
    const all_marks = lignes.map(() => marks).join(', ')

    await pool().query(
        `INSERT INTO \`${modele.name}\` (${cols_q}) VALUES ${all_marks}`,
        lignes.flat()
    )

    // 5. Retourner les données originales + ids auto-générés
    return tableau.map((donnees, i) =>
    {
        const resultat = { ...donnees }
        for (const nom_pk of modele.primary)
        {
            if (donnees[nom_pk] === undefined && insertions[i][nom_pk] !== undefined)
                resultat[nom_pk] = insertions[i][nom_pk]
        }
        return resultat
    })
}

// ─── Pré-génération des valeurs (hors vérif DB) pour prior_create ─────────────
// Génère les valeurs auto des champs hors contrainte et résout les defaults par
// référence, sans toucher la base. Permet d'exposer les valeurs générées
// (ex. clef à 9 chiffres) dans les scripts prior_create via $enregistrement.

export const preparer_donnees = (modele, donnees) =>
{
    const resultat = { ...donnees }

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // Valeurs auto hors contrainte (pas de vérification d'unicité en base)
    for (const champ of modele.fields)
    {
        if (champ.default !== 'auto')               continue
        if (dans_contrainte(champ.name))            continue
        if (resultat[champ.name] !== undefined)     continue
        const alphabet = champ.chars ?? CHARS_ID
        const taille   = champ.length?.max ?? champ.length?.min ?? champ.max ?? 12
        resultat[champ.name] = generer_id(taille, alphabet)
    }

    // Defaults par référence ($autre_champ)
    for (const champ of modele.fields)
    {
        if (typeof champ.default !== 'string' || !champ.default.startsWith('$')) continue
        const nom_source = champ.default.slice(1)
        if (resultat[champ.name] === undefined && resultat[nom_source] !== undefined)
            resultat[champ.name] = resultat[nom_source]
    }

    return resultat
}

// ─── $create_one ─────────────────────────────────────────────────────────────

const creer_create_one = (schemas) => async (nom_modele, donnees = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const [resultat] = await inserer_batch(modele, [donnees])
    return resultat
}

// ─── $create_all ─────────────────────────────────────────────────────────────

const creer_create_all = (schemas) => async (nom_modele, tableau = []) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    return inserer_batch(modele, tableau)
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export const creer_fonctions_magasin = (schemas) => ({
    $search_one: creer_search_one(schemas),
    $search_all: creer_search_all(schemas),
    $delete_one: creer_delete_one(schemas),
    $delete_all: creer_delete_all(schemas),
    $create_one: creer_create_one(schemas),
    $create_all: creer_create_all(schemas),
})
