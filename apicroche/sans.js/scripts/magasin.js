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

const trouver_table = (schemas, nom_table) =>
    schemas.tables.find(t => t.name === nom_table) ?? null

const trouver_pk = (table) =>
{
    if (!table || !Array.isArray(table.primary) || table.primary.length === 0)
        return null

    const nom_pk = table.primary[0]
    return table.fields.find(f => f.name === nom_pk) ?? null
}

const construire_modele_jonction_auto = (schemas, relation) =>
{
    if (!relation?.table_jonction)
        return null

    const table_source = trouver_table(schemas, relation.table_source)
    const table_cible  = trouver_table(schemas, relation.table_cible)

    if (!table_source || !table_cible)
        return null

    const pk_source = trouver_pk(table_source)
    const pk_cible  = trouver_pk(table_cible)

    const nom_id_source = `id_${table_source.entry_name ?? table_source.name}`
    const nom_id_cible  = `id_${table_cible.entry_name  ?? table_cible.name}`

    return {
        name   : relation.table_jonction,
        entry_name: relation.table_jonction_entry ?? null,
        primary: [nom_id_source, nom_id_cible],
        unique : [],
        fields : [
            {
                name     : nom_id_source,
                type     : pk_source?.type ?? 'int',
                min      : pk_source?.min ?? null,
                max      : pk_source?.max ?? null,
                nullable : false,
                treatment: null
            },
            {
                name     : nom_id_cible,
                type     : pk_cible?.type ?? 'int',
                min      : pk_cible?.min ?? null,
                max      : pk_cible?.max ?? null,
                nullable : false,
                treatment: null
            }
        ]
    }
}

const trouver_modele_table = (schemas, nom) =>
{
    const modele_explicit = schemas.tables.find(t => t.name === nom)
    if (modele_explicit)
        return modele_explicit

    const relation = (schemas.relations ?? []).find(r => r.table_jonction === nom)
    if (!relation)
        return null

    return construire_modele_jonction_auto(schemas, relation)
}

const trouver_modele_entree = (schemas, nom) =>
{
    const modele_explicit = schemas.tables.find(t => (t.entry_name ?? t.name) === nom)
    if (modele_explicit)
        return modele_explicit

    const relation = (schemas.relations ?? []).find(r => r.table_jonction_entry === nom)
    if (relation)
        return construire_modele_jonction_auto(schemas, relation)

    // Pour les jonctions auto N-N, on accepte le nom de table comme nom d'entrée.
    return trouver_modele_table(schemas, nom)
}

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

const construire_aliases_projection_inverse = (schemas, relation) =>
{
    const table_source = trouver_table(schemas, relation.table_source)
    const table_cible  = trouver_table(schemas, relation.table_cible)

    const nom_source_table = table_source?.name ?? relation.table_source
    const nom_source_entree = table_source?.entry_name ?? table_source?.name ?? relation.table_source
    const nom_cible_entree = table_cible?.entry_name ?? table_cible?.name ?? relation.table_cible
    const nom_relation = relation.entry ?? nom_cible_entree

    return new Set([
        `is_${nom_relation}_of_${nom_source_table}`,
        `is_${nom_relation}_of_${nom_source_entree}`,
        `is_${nom_cible_entree}_of_${nom_source_table}`,
        `is_${nom_cible_entree}_of_${nom_source_entree}`,
    ])
}

const resoudre_projection_relation = (schemas, modele, token) =>
{
    for (const relation of schemas.relations ?? [])
    {
        if (relation.table_source === modele.name && relation.champ_source === token)
            return { relation, sens: 'direct' }

        if (relation.table_cible === modele.name)
        {
            const aliases = construire_aliases_projection_inverse(schemas, relation)
            if (aliases.has(token))
                return { relation, sens: 'inverse' }
        }
    }

    return null
}

const lire_ligne_par_pk = async (modele, pk_values) =>
{
    if (!modele?.primary?.length)
        return null

    const clause = modele.primary.map(champ => `\`${champ}\` = ?`).join(' AND ')
    const valeurs = modele.primary.map(champ => pk_values[champ])
    const [lignes] = await pool().query(`SELECT * FROM \`${modele.name}\` WHERE ${clause}`, valeurs)
    return lignes[0] ?? null
}

const lire_lignes_par_egalite = async (modele, champ, valeur) =>
{
    const [lignes] = await pool().query(`SELECT * FROM \`${modele.name}\` WHERE \`${champ}\` = ?`, [valeur])
    return lignes
}

const lire_lignes_par_in = async (modele, champ, valeurs) =>
{
    if (!Array.isArray(valeurs) || !valeurs.length)
        return []

    const clauses = valeurs.map(() => '?').join(', ')
    const [lignes] = await pool().query(`SELECT * FROM \`${modele.name}\` WHERE \`${champ}\` IN (${clauses})`, valeurs)
    return lignes
}

const projeter_relation = async (schemas, modele, ligne, relation, sens) =>
{
    const table_source = trouver_table(schemas, relation.table_source)
    const table_cible  = trouver_table(schemas, relation.table_cible)

    if (!table_source || !table_cible)
        return sens === 'inverse' && relation.max === 'N' && relation.min !== 'N' ? null : []

    const pk_source = table_source.primary?.[0] ?? null
    const pk_cible  = table_cible.primary?.[0] ?? null
    if (!pk_source || !pk_cible)
        return sens === 'inverse' && relation.max === 'N' && relation.min !== 'N' ? null : []

    const valeur_pk_source = ligne[pk_source]
    const valeur_pk_cible   = ligne[pk_cible]
    const entree_source     = table_source.entry_name ?? table_source.name
    const entree_cible      = table_cible.entry_name ?? table_cible.name
    const modele_source     = relation.table_source
    const modele_cible      = table_cible.entry_name ?? table_cible.name

    if (relation.table_jonction)
    {
        const cle_source = `id_${entree_source}`
        const cle_cible  = `id_${entree_cible}`

        const cle_lire = sens === 'direct' ? cle_source : cle_cible
        const cle_recherche = sens === 'direct' ? cle_cible : cle_source
        const valeur_recherche = sens === 'direct' ? valeur_pk_source : valeur_pk_cible

        if (valeur_recherche === undefined || valeur_recherche === null)
            return []

        const [jonctions] = await pool().query(
            `SELECT \`${cle_recherche}\` FROM \`${relation.table_jonction}\` WHERE \`${cle_lire}\` = ?`,
            [valeur_recherche]
        )

        const valeurs_ids = [...new Set(
            jonctions
                .map(l => l[cle_recherche])
                .filter(v => v !== undefined && v !== null)
        )]

        const cible_modele = sens === 'direct' ? table_cible : table_source
        if (!valeurs_ids.length)
            return []

        const rows = await lire_lignes_par_in(cible_modele, cible_modele.primary[0], valeurs_ids)
        return rows.map(ligne_brute => decrypter_ligne(cible_modele, ligne_brute))
    }

    if (relation.cle_etrangere)
    {
        if (sens === 'direct')
        {
            if (valeur_pk_source === undefined || valeur_pk_source === null)
                return []

            const rows = await lire_lignes_par_egalite(table_cible, relation.cle_etrangere, valeur_pk_source)
            return rows.map(ligne_brute => decrypter_ligne(table_cible, ligne_brute))
        }

        const valeur_fk = ligne[relation.cle_etrangere]
        if (valeur_fk === undefined || valeur_fk === null)
            return null

        const ligne_source = await lire_ligne_par_pk(table_source, { [pk_source]: valeur_fk })
        return ligne_source ? decrypter_ligne(table_source, ligne_source) : null
    }

    return sens === 'inverse' && relation.max === 'N' && relation.min !== 'N' ? null : []
}

const normaliser_projection_select = (select) =>
{
    if (typeof select === 'string')
    {
        return select
            .split(';')
            .map(v => v.trim())
            .filter(Boolean)
    }

    if (!Array.isArray(select) || select.length === 0)
        return []

    return select
        .filter(v => typeof v === 'string')
        .map(v => v.trim())
        .filter(Boolean)
}

const normaliser_token_projection = (token) =>
{
    if (typeof token !== 'string')
        return []

    return token
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
}

const indexer_lignes_par_clef = (lignes, clef) =>
{
    const index = new Map()
    for (const ligne of lignes)
    {
        const valeur = ligne[clef]
        if (valeur === undefined || valeur === null)
            continue

        if (!index.has(valeur))
            index.set(valeur, [])
        index.get(valeur).push(ligne)
    }
    return index
}

const construire_noeud_projection = (schemas, modele, select) =>
{
    const champs_physiques = new Set(modele.fields.map(f => f.name))
    const noeud = {
        allPhysical: false,
        fields: new Set(),
        relations: new Map()
    }

    if (!Array.isArray(select) || select.length === 0)
    {
        noeud.allPhysical = true
        return noeud
    }

    const ajouter_relation = (token, relation, sens, select_enfant = null) =>
    {
        if (!noeud.relations.has(token))
        {
            noeud.relations.set(token, {
                relation,
                sens,
                select: select_enfant
            })
            return
        }

        const courant = noeud.relations.get(token)
        if (courant.select === null)
            courant.select = select_enfant
        else if (select_enfant)
            courant.select = [...new Set([...courant.select, ...select_enfant])]
    }

    const analyser_token = (token, select_enfant = null) =>
    {
        if (!token)
            return

        if (token === '*')
        {
            noeud.allPhysical = true
            return
        }

        if (champs_physiques.has(token))
        {
            noeud.fields.add(token)
            return
        }

        const projection_relation = resoudre_projection_relation(schemas, modele, token)
        if (!projection_relation)
            throw new Error(`Option select invalide : champ ou relation inconnue "${token}"`)

        ajouter_relation(token, projection_relation.relation, projection_relation.sens, select_enfant)
    }

    for (const brut of normaliser_projection_select(select))
    {
        const token = String(brut)
        
        if (token.includes('.') && !token.startsWith('*'))
        {
            const index_point = token.indexOf('.')
            const avant_point = token.slice(0, index_point)
            const suite = token.slice(index_point + 1).trim()
            
            const index_derniere_virgule = avant_point.lastIndexOf(',')
            
            let avant_virgule = ''
            let racine = avant_point.trim()
            
            if (index_derniere_virgule >= 0)
            {
                avant_virgule = avant_point.slice(0, index_derniere_virgule).trim()
                racine = avant_point.slice(index_derniere_virgule + 1).trim()
            }
            
            if (avant_virgule)
            {
                for (const sous_token of normaliser_token_projection(avant_virgule))
                    analyser_token(sous_token)
            }
            
            const projection_relation = resoudre_projection_relation(schemas, modele, racine)
            if (!projection_relation)
                throw new Error(`Option select invalide : champ ou relation inconnue "${racine}"`)

            const modele_enfant = projection_relation.sens === 'direct'
                ? trouver_table(schemas, projection_relation.relation.table_cible)
                : trouver_table(schemas, projection_relation.relation.table_source)

            if (!modele_enfant)
                throw new Error(`Option select invalide : relation introuvable "${racine}"`)

            const select_enfant = suite ? [suite] : []
            ajouter_relation(racine, projection_relation.relation, projection_relation.sens, select_enfant)
            continue
        }

        for (const sous_token of normaliser_token_projection(token))
            analyser_token(sous_token)
    }

    return noeud
}

const projeter_lignes_select = async (schemas, modele, lignes, select) =>
{
    const noeud = construire_noeud_projection(schemas, modele, select)
    const resultats = lignes.map(() => ({}))
    const champs_physiques = modele.fields.map(f => f.name)

    for (let i = 0; i < lignes.length; i++)
    {
        const ligne = lignes[i]
        if (noeud.allPhysical)
        {
            for (const champ of champs_physiques)
                resultats[i][champ] = ligne[champ]
        }
        else
        {
            for (const champ of noeud.fields)
                resultats[i][champ] = ligne[champ]
        }

        for (const [clef, valeur] of Object.entries(ligne))
        {
            if (typeof clef === 'string' && clef.startsWith('_can_'))
                resultats[i][clef] = valeur
        }
    }

    for (const [token, spec] of noeud.relations.entries())
    {
        const relation = spec.relation
        const sens = spec.sens
        const table_source = trouver_table(schemas, relation.table_source)
        const table_cible  = trouver_table(schemas, relation.table_cible)

        if (!table_source || !table_cible)
        {
            for (let i = 0; i < lignes.length; i++)
                resultats[i][token] = relation.table_jonction || relation.max === 'N' ? [] : null
            continue
        }

        const modele_enfant = sens === 'direct' ? table_cible : table_source
        const projection_enfant = (rows) => rows.length ? projeter_lignes_select(schemas, modele_enfant, rows, spec.select) : []

        const pk_source = trouver_pk(table_source)
        const pk_cible = trouver_pk(table_cible)

        if (relation.table_jonction)
        {
            const cle_source = `id_${table_source.entry_name ?? table_source.name}`
            const cle_cible  = `id_${table_cible.entry_name ?? table_cible.name}`
            const est_direct = sens === 'direct'
            const cle_ligne  = est_direct ? pk_source?.name : pk_cible?.name
            const cle_lire   = est_direct ? cle_source : cle_cible
            const cle_assoc  = est_direct ? cle_cible : cle_source
            const ids_lignes = [...new Set(lignes.map(ligne => ligne[cle_ligne]).filter(v => v !== undefined && v !== null))]

            if (!ids_lignes.length)
            {
                for (let i = 0; i < lignes.length; i++)
                    resultats[i][token] = []
                continue
            }

            const placeholders = ids_lignes.map(() => '?').join(', ')
            const [jonctions] = await pool().query(
                `SELECT \`${cle_lire}\`, \`${cle_assoc}\` FROM \`${relation.table_jonction}\` WHERE \`${cle_lire}\` IN (${placeholders})`,
                ids_lignes
            )

            const ids_par_ligne = indexer_lignes_par_clef(jonctions, cle_lire)
            const ids_relatifs = [...new Set(jonctions.map(ligne => ligne[cle_assoc]).filter(v => v !== undefined && v !== null))]

            const lignes_relatives = ids_relatifs.length
                ? await lire_lignes_par_in(modele_enfant, modele_enfant.primary[0], ids_relatifs)
                : []
            const map_relatives = new Map(lignes_relatives.map(ligne_rel => [ligne_rel[modele_enfant.primary[0]], decrypter_ligne(modele_enfant, ligne_rel)]))

            for (let i = 0; i < lignes.length; i++)
            {
                const id_ligne = lignes[i][cle_ligne]
                const ids = [...new Set((ids_par_ligne.get(id_ligne) ?? []).map(l => l[cle_assoc]).filter(v => v !== undefined && v !== null))]
                const valeurs = ids.map(id => map_relatives.get(id)).filter(Boolean)
                resultats[i][token] = spec.select ? await projection_enfant(valeurs) : valeurs.map(v => v)
            }

            continue
        }

        if (relation.cle_etrangere)
        {
            if (sens === 'direct')
            {
                const cle_source = pk_source?.name
                const ids_lignes = [...new Set(lignes.map(ligne => ligne[cle_source]).filter(v => v !== undefined && v !== null))]
                if (!ids_lignes.length)
                {
                    for (let i = 0; i < lignes.length; i++)
                        resultats[i][token] = []
                    continue
                }

                const rows = await lire_lignes_par_in(table_cible, relation.cle_etrangere, ids_lignes)
                const index_rows = indexer_lignes_par_clef(rows, relation.cle_etrangere)

                for (let i = 0; i < lignes.length; i++)
                {
                    const id_ligne = lignes[i][cle_source]
                    const lignes_rel = (index_rows.get(id_ligne) ?? []).map(ligne_rel => decrypter_ligne(table_cible, ligne_rel))
                    resultats[i][token] = spec.select ? await projection_enfant(lignes_rel) : lignes_rel
                }

                continue
            }

            const cle_fk = relation.cle_etrangere
            const valeurs_fk = [...new Set(lignes.map(ligne => ligne[cle_fk]).filter(v => v !== undefined && v !== null))]

            if (!valeurs_fk.length)
            {
                for (let i = 0; i < lignes.length; i++)
                    resultats[i][token] = null
                continue
            }

            const rows = await lire_lignes_par_in(table_source, pk_source.name, valeurs_fk)
            const map_rows = new Map(rows.map(ligne_rel => [ligne_rel[pk_source.name], decrypter_ligne(table_source, ligne_rel)]))

            for (let i = 0; i < lignes.length; i++)
            {
                const valeur_fk = lignes[i][cle_fk]
                const ligne_rel = map_rows.get(valeur_fk) ?? null
                if (!ligne_rel)
                {
                    resultats[i][token] = null
                    continue
                }

                resultats[i][token] = spec.select ? (await projection_enfant([ligne_rel]))[0] ?? null : ligne_rel
            }

            continue
        }

        for (let i = 0; i < lignes.length; i++)
            resultats[i][token] = relation.max === 'N' ? [] : null
    }

    return resultats
}

const projeter_ligne_select = async (schemas, modele, ligne, select) =>
{
    const resultats = await projeter_lignes_select(schemas, modele, [ligne], select)
    return resultats[0] ?? null
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
        let valeur = presente ? ligne[champ.name] : ERREUR_AUGURE

        // MySQL peut renvoyer date/datetime sous forme de chaîne ;
        // on normalise en Date pour des comparaisons fiables avec now.
        if (
            valeur !== ERREUR_AUGURE
         && valeur !== null
         && (champ.type === 'date' || champ.type === 'datetime')
         && typeof valeur === 'string'
        )
        {
            const date = new Date(valeur)
            if (!Number.isNaN(date.getTime()))
                valeur = date
        }

        contexte[`$${champ.name}`] = valeur
    }

    return contexte
}

const respecter_condition = (modele, ligne, condition, now = new Date(), contexte_externe = {}, criteres = {}) =>
{
    if (!condition) return true

    const extraire_condition_residuelle = (condition_brute) =>
    {
        // On ne simplifie que les conjonctions simples (&) sans parenthèses ni OR.
        // Dans les autres cas, on conserve la condition complète par sécurité.
        if (/[|()]/.test(condition_brute))
            return condition_brute

        const regex_egalite_ou_in = /^\s*\$(\w+)\s*(=|-\{)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)\s*$/

        const morceaux = condition_brute
            .split('&')
            .map(m => m.trim())
            .filter(Boolean)

        if (!morceaux.length)
            return condition_brute

        const residuels = []
        for (const morceau of morceaux)
        {
            const eqin = morceau.match(regex_egalite_ou_in)
            if (eqin)
            {
                const nom_champ = eqin[1]
                // Ce champ a déjà été injecté dans le WHERE SQL (égalité ou IN).
                if (Object.prototype.hasOwnProperty.call(criteres, nom_champ))
                    continue
            }

            // Les comparaisons simples (>, <, >=, <=) qui ont une traduction SQL
            // sont retirées de la condition résiduelle pour éviter un second filtrage JS.
            if (convertir_comparaison_simple_en_filtre_sql(modele, morceau, contexte_externe))
                continue

            if (est_comparaison_chemin_relation_sqlable(morceau))
                continue

            residuels.push(morceau)
        }

        return residuels.join(' & ')
    }

    const condition_residuelle = extraire_condition_residuelle(condition)
    if (!condition_residuelle)
        return true

    const contexte = construire_contexte_condition(modele, ligne, now, contexte_externe)

    // Quand une égalité a déjà été résolue via les critères (SQL/post-vérification),
    // on réinjecte la valeur brute attendue pour que l'expression Augure ne compare
    // pas une valeur stockée (hash/chiffrement) à la valeur brute de la requête.
    for (const [nom, valeur] of Object.entries(criteres))
        contexte[`$${nom}`] = valeur

    return evaluer(condition_residuelle, contexte)
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

const normaliser_donnees_update = (donnees) =>
{
    if (donnees === null || donnees === undefined)
        throw new Error('Données de mise à jour requises : utilisez un objet { champ: valeur }')

    if (typeof donnees !== 'object' || Array.isArray(donnees))
        throw new Error('Données de mise à jour invalides : utilisez un objet { champ: valeur }')

    if (!Object.keys(donnees).length)
        throw new Error('Données de mise à jour vides : fournissez au moins un champ')

    return donnees
}

const normaliser_options_liste = (modele, options) =>
{
    if (options === null || options === undefined)
        return {
            order : null,
            dir   : 'asc',
            limit : null,
            offset: 0,
            select: null,
            aux_conditions: {},
        }

    if (typeof options !== 'object' || Array.isArray(options))
        throw new Error('Options invalides : utilisez un objet { order, dir, limit, offset, select, aux_conditions }')

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

    let select = options.select
    if (select === undefined || select === null)
    {
        select = [...champs_modele]
    }
    else
    {
        if (typeof select !== 'string')
            throw new Error('Option select invalide : utilisez une chaîne de noms de champs séparés par des ";"')

        select = select
            .split(';')
            .map(s => s.trim())
            .filter(Boolean)

        if (select.length === 0)
            select = []
    }

    let aux_conditions = options.aux_conditions ?? {}
    if (aux_conditions === null)
        aux_conditions = {}
    if (typeof aux_conditions !== 'object' || Array.isArray(aux_conditions))
        throw new Error('Option aux_conditions invalide : utilisez un objet { cle: condition }')

    const aux_conditions_norm = {}
    for (const [cle, valeur] of Object.entries(aux_conditions))
    {
        if (typeof cle !== 'string' || !cle.trim())
            continue
        if (typeof valeur !== 'string' || !valeur.trim())
            continue
        aux_conditions_norm[cle.trim()] = valeur.trim()
    }

    return {
        order,
        dir,
        limit : limit ?? null,
        offset,
        select,
        aux_conditions: aux_conditions_norm
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

const filtrer_champs_select = (objet, champs_select) =>
{
    if (!champs_select || champs_select.length === 0)
        return objet

    const resultat = {}
    for (const champ of champs_select)
    {
        if (Object.prototype.hasOwnProperty.call(objet, champ))
            resultat[champ] = objet[champ]
    }
    return resultat
}

const dedoublonner_joins_recherche = (joins) =>
{
    const vus = new Set()
    const resultat = []

    for (const join of joins)
    {
        const cle = join && typeof join.joins === 'string' ? join.joins : null
        if (!cle || vus.has(cle))
            continue

        vus.add(cle)
        resultat.push(join)
    }

    return resultat
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

    // Support égalité (=) et IN (-{)
    const regex = /(?:^|[&(])\s*\$(\w+)\s*(=|-\{)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)/g
    let match

    while ((match = regex.exec(condition)) !== null)
    {
        const nom_champ = match[1]
        const operateur = match[2]
        const token     = match[3]

        if (!champs_modele.has(nom_champ))
            continue
        if (!token)
            continue

        let valeur
        if (token.startsWith('$'))
        {
            const { trouvee, valeur: v } = lire_variable_contexte(token, contexte_condition)
            if (!trouvee)
                continue
            valeur = v
        }
        else
        {
            valeur = parser_litteral_condition(token)
        }

        if (operateur === '=')
        {
            criteres[nom_champ] = valeur
        }
        else if (operateur === '-{')
        {
            // Toujours tableau pour IN
            criteres[nom_champ] = Array.isArray(valeur) ? valeur : (valeur instanceof Set ? Array.from(valeur) : [valeur])
        }
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

        clauses.push({
            sql    : `\`${nom_champ}\` ${operateur} ${droite_sql}`,
            valeurs: []
        })
    }

    return clauses
}

const convertir_comparaison_simple_en_filtre_sql = (modele, morceau, contexte_condition = {}) =>
{
    const match = /^\s*\$(\w+)\s*(>=|>|<=|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)\s*$/i.exec(morceau)
    if (!match)
        return null

    const nom_champ = match[1]
    const operateur = match[2]
    const token     = match[3]

    const champ = modele.fields.find(f => f.name === nom_champ)
    if (!champ || champ.treatment)
        return null

    const now_sql = traduire_now_sql(token)
    if (now_sql)
    {
        if (champ.type !== 'date' && champ.type !== 'datetime')
            return null
        return {
            sql    : `\`${nom_champ}\` ${operateur} ${now_sql}`,
            valeurs: []
        }
    }

    let valeur
    if (token.startsWith('$'))
    {
        const { trouvee, valeur: v } = lire_variable_contexte(token, contexte_condition)
        if (!trouvee)
            return null
        valeur = v
    }
    else
    {
        valeur = parser_litteral_condition(token)
    }

    if (valeur === undefined || valeur === null)
        return null

    return {
        sql    : `\`${nom_champ}\` ${operateur} ?`,
        valeurs: [valeur]
    }
}

const convertir_comparaison_null_en_filtre_sql = (modele, morceau, contexte_condition = {}) =>
{
    const match = /^\s*\$(\w+)\s*(!=|<>)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)\s*$/i.exec(morceau)
    if (!match)
        return null

    const nom_champ = match[1]
    const token     = match[3]

    const champ = modele.fields.find(f => f.name === nom_champ)
    if (!champ)
        return null

    let valeur
    if (token.startsWith('$'))
    {
        const { trouvee, valeur: v } = lire_variable_contexte(token, contexte_condition)
        if (!trouvee)
            return null
        valeur = v
    }
    else
    {
        valeur = parser_litteral_condition(token)
    }

    if (valeur !== null)
        return null

    return {
        sql    : `\`${nom_champ}\` IS NOT NULL`,
        valeurs: []
    }
}

const extraire_filtres_comparaison_sql = (modele, condition, contexte_condition = {}) =>
{
    const clauses = []
    const regex = /(?:^|([&|]))\s*(\$\w+\s*(?:>=|<=|!=|<>|>|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+))/g
    let match

    let premier_operateur = 'AND'
    const morceaux = []
    const valeurs = []

    while ((match = regex.exec(condition)) !== null)
    {
        const operateur = match[1] === '|' ? 'OR' : 'AND'
        const morceau = match[2]

        const filtre_null = convertir_comparaison_null_en_filtre_sql(modele, morceau, contexte_condition)
        if (filtre_null)
        {
            if (!morceaux.length)
                premier_operateur = operateur

            morceaux.push({ operateur, sql: filtre_null.sql })
            if (Array.isArray(filtre_null.valeurs) && filtre_null.valeurs.length)
                valeurs.push(...filtre_null.valeurs)
            continue
        }

        const filtre = convertir_comparaison_simple_en_filtre_sql(modele, morceau, contexte_condition)
        if (filtre)
        {
            if (!morceaux.length)
                premier_operateur = operateur

            morceaux.push({ operateur, sql: filtre.sql })
            if (Array.isArray(filtre.valeurs) && filtre.valeurs.length)
                valeurs.push(...filtre.valeurs)
        }
    }

    if (!morceaux.length)
        return clauses

    let sql = ''
    for (let i = 0; i < morceaux.length; i++)
    {
        const morceau = morceaux[i]
        if (i === 0)
            sql += `(${morceau.sql})`
        else
            sql += ` ${morceau.operateur} (${morceau.sql})`
    }

    if (premier_operateur === 'OR' && morceaux.length > 1)
        sql = `((${sql}))`
    else
        sql = `(${sql})`

    clauses.push({
        sql,
        valeurs
    })

    return clauses
}

const est_comparaison_chemin_relation_sqlable = (morceau) =>
    /^\s*\$\w+(?:\.\w+)+\s*(?:=|!=|<>|>=|<=|>|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)\s*$/.test(morceau)

const extraire_filtres_relation_sql = (condition, contexte_condition = {}) =>
{
    const clauses = []
    const regex = /(?:^|([&|]))\s*((?:`[^`]+`\.`[^`]+`)\s*(?:=|!=|<>|>=|<=|>|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+))/g
    let match

    let premier_operateur = 'AND'
    const morceaux = []
    const valeurs = []

    while ((match = regex.exec(condition)) !== null)
    {
        const operateur = match[1] === '|' ? 'OR' : 'AND'
        const morceau = match[2]
        const detail = /^\s*((?:`[^`]+`\.`[^`]+`))\s*(=|!=|<>|>=|<=|>|<)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s&|()]+)\s*$/.exec(morceau)
        if (!detail)
            continue

        const colonne_sql = detail[1]
        const operateur_sql = detail[2]
        const token = detail[3]

        let valeur
        if (token.startsWith('$'))
        {
            const { trouvee, valeur: v } = lire_variable_contexte(token, contexte_condition)
            if (!trouvee)
                continue
            valeur = v
        }
        else
        {
            valeur = parser_litteral_condition(token)
        }

        if (valeur === undefined)
            continue

        if (valeur === null)
        {
            if (!morceaux.length)
                premier_operateur = operateur

            if (operateur_sql === '=')
                morceaux.push({ operateur, sql: `${colonne_sql} IS NULL` })
            else if (operateur_sql === '!=' || operateur_sql === '<>')
                morceaux.push({ operateur, sql: `${colonne_sql} IS NOT NULL` })

            continue
        }

        if (!morceaux.length)
            premier_operateur = operateur

        morceaux.push({ operateur, sql: `${colonne_sql} ${operateur_sql} ?` })
        valeurs.push(valeur)
    }

    if (!morceaux.length)
        return clauses

    let sql = ''
    for (let i = 0; i < morceaux.length; i++)
    {
        const morceau = morceaux[i]
        if (i === 0)
            sql += `(${morceau.sql})`
        else
            sql += ` ${morceau.operateur} (${morceau.sql})`
    }

    if (premier_operateur === 'OR' && morceaux.length > 1)
        sql = `((${sql}))`
    else
        sql = `(${sql})`

    clauses.push({
        sql,
        valeurs
    })

    return clauses
}

const preparer_condition_recherche = (schemas, modele, condition, contexte_condition = {}) =>
{
    const condition_norm = normaliser_condition(condition)
    const { joins, condition_avec_joins } = analyser_condition_pour_joins(schemas, modele, condition_norm, contexte_condition)

    const criteres = extraire_criteres_depuis_condition(modele, condition_avec_joins, contexte_condition)
    const filtres_comparaison_sql = extraire_filtres_comparaison_sql(modele, condition_avec_joins, contexte_condition)
    const filtres_relation_sql = extraire_filtres_relation_sql(condition_avec_joins, contexte_condition)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, [...filtres_comparaison_sql, ...filtres_relation_sql])

    return {
        joins,
        condition_avec_joins,
        criteres,
        post,
        clause,
        valeurs
    }
}

const preparer_aux_conditions_recherche = (schemas, modele, aux_conditions = {}, contexte_condition = {}) =>
{
    const clauses_select = []
    const joins = []
    const valeurs = []
    const joins_vus = new Set()

    for (const [nom_colonne, condition] of Object.entries(aux_conditions))
    {
        if (typeof condition !== 'string' || !condition.trim())
            continue

        const preparation = preparer_condition_recherche(schemas, modele, condition, contexte_condition)

        for (const join of preparation.joins)
        {
            const cle_join = join && typeof join.joins === 'string' ? join.joins : null
            if (!cle_join || joins_vus.has(cle_join))
                continue

            joins_vus.add(cle_join)
            joins.push(join)
        }

        const clause_sql = preparation.clause ? preparation.clause.replace(/^WHERE\s+/i, '') : '1'
        clauses_select.push(`CASE WHEN ${clause_sql} THEN TRUE ELSE FALSE END AS \`${nom_colonne}\``)

        if (preparation.valeurs.length)
            valeurs.push(...preparation.valeurs)
    }

    return {
        joins,
        clauses_select,
        valeurs
    }
}

// ─── JOINs pour conditions sur relations ─────────────────────────────────────

const extraire_chemins_relations_condition = (condition) =>
{
    const chemins = new Map()
    const regex = /\$([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g
    let match

    while ((match = regex.exec(condition)) !== null)
    {
        const chemin_complet = match[1]
        if (chemin_complet.includes('.'))
        {
            chemins.set(chemin_complet, chemin_complet)
        }
    }

    return Array.from(chemins.keys())
}

const generer_joins_sql = (schemas, modele_source, chemin_relation) =>
{
    const parties = chemin_relation.split('.')
    const joins = []
    let modele_courant = modele_source
    let alias_courant = modele_source.name
    let alias_compteur = 0

    for (let i = 0; i < parties.length; i++)
    {
        const nom_relation = parties[i]
        const projection_relation = resoudre_projection_relation(schemas, modele_courant, nom_relation)

        if (!projection_relation)
            continue

        const relation = projection_relation.relation
        const sens = projection_relation.sens
        const table_source = trouver_table(schemas, relation.table_source)
        const table_cible = trouver_table(schemas, relation.table_cible)

        if (!table_source || !table_cible)
            continue

        const modele_enfant = sens === 'direct' ? table_cible : table_source
        const alias_enfant = `${modele_enfant.name}_${++alias_compteur}`

        if (relation.table_jonction)
        {
            const cle_source = `id_${table_source.entry_name ?? table_source.name}`
            const cle_cible = `id_${table_cible.entry_name ?? table_cible.name}`
            const est_direct = sens === 'direct'
            const alias_jonction = `${relation.table_jonction}_${alias_compteur}`

            const cle_lire = est_direct ? cle_source : cle_cible
            const cle_assoc = est_direct ? cle_cible : cle_source
            const pk_courant = est_direct ? table_source.primary[0] : table_cible.primary[0]
            const pk_enfant = modele_enfant.primary[0]

            joins.push(
                `JOIN \`${relation.table_jonction}\` AS \`${alias_jonction}\` ON \`${alias_courant}\`.\`${pk_courant}\` = \`${alias_jonction}\`.\`${cle_lire}\``
            )
            joins.push(
                `JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_jonction}\`.\`${cle_assoc}\` = \`${alias_enfant}\`.\`${pk_enfant}\``
            )
        }
        else if (relation.cle_etrangere)
        {
            if (sens === 'direct')
            {
                joins.push(
                    `JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${table_source.primary[0]}\` = \`${alias_enfant}\`.\`${relation.cle_etrangere}\``
                )
            }
            else
            {
                joins.push(
                    `JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${relation.cle_etrangere}\` = \`${alias_enfant}\`.\`${modele_enfant.primary[0]}\``
                )
            }
        }

        alias_courant = alias_enfant
        modele_courant = modele_enfant
    }

    return {
        joins: joins.join(' '),
        modele_final: modele_courant,
        alias_final: alias_courant
    }
}

const analyser_condition_pour_joins = (schemas, modele, condition, contexte_condition = {}) =>
{
    const chemins = extraire_chemins_relations_condition(condition)
    const joins_generes = new Map()
    let condition_avec_alias = String(condition)

    for (const chemin of chemins)
    {
        const derniere_partie = chemin.lastIndexOf('.')
        if (derniere_partie === -1)
            continue

        const chemin_relations = chemin.slice(0, derniere_partie)
        const champ_final = chemin.slice(derniere_partie + 1)
        
        const generation = generer_joins_sql(schemas, modele, chemin_relations)
        if (generation.joins)
        {
            joins_generes.set(chemin_relations, generation)
            const ancien_prefix = `$${chemin}`
            const nouveau_prefix = `\`${generation.alias_final}\`.\`${champ_final}\``
            condition_avec_alias = condition_avec_alias.replace(new RegExp(`\\$${chemin.replace(/\./g, '\\.')}`, 'g'), nouveau_prefix)
        }
    }

    return {
        joins: Array.from(joins_generes.values()),
        condition_avec_joins: condition_avec_alias
    }
}

// Construire la requête SELECT complète avec JOINs
const construire_requete_recherche = (modele, joins_data, clause_where, select_supplementaire = []) =>
{
    const select_clause = select_supplementaire.length
        ? `SELECT DISTINCT \`${modele.name}\`.* , ${select_supplementaire.join(', ')} FROM \`${modele.name}\``
        : `SELECT DISTINCT \`${modele.name}\`.* FROM \`${modele.name}\``
    
    if (!joins_data || !joins_data.length)
        return select_clause + (clause_where ? ` ${clause_where}` : '')

    const all_joins = joins_data
        .map(j => j.joins)
        .filter(Boolean)
        .join(' ')

    if (!all_joins)
        return select_clause + (clause_where ? ` ${clause_where}` : '')

    return select_clause + ' ' + all_joins + (clause_where ? ` ${clause_where}` : '')
}

// Construire la clause WHERE
const construire_where = (criteres_sql, clauses_supplementaires = []) =>
{
    const noms = Object.keys(criteres_sql)
    const morceaux = []
    const valeurs = []

    if (noms.length) {
        for (const n of noms) {
            let v = criteres_sql[n]
            // Déplier les tableaux imbriqués (ex: [[a,b]] => [a,b])
            if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0])) {
                v = v[0]
            }
            if (v === null) {
                morceaux.push(`\`${n}\` IS NULL`)
                continue
            }
            if (Array.isArray(v) || v instanceof Set) {
                // Support SQL IN
                const arr = Array.isArray(v) ? v : Array.from(v)
                if (arr.length === 0) {
                    // IN () n'est jamais vrai, donc on force une condition fausse
                    morceaux.push('0')
                } else {
                    const placeholders = arr.map(() => '?').join(', ')
                    morceaux.push(`\`${n}\` IN (${placeholders})`)
                    valeurs.push(...arr)
                }
            } else {
                morceaux.push(`\`${n}\` = ?`)
                valeurs.push(v)
            }
        }
    }

    if (clauses_supplementaires.length)
    {
        for (const clause of clauses_supplementaires)
        {
            if (typeof clause === 'string')
            {
                morceaux.push(clause)
                continue
            }

            if (!clause || typeof clause.sql !== 'string')
                continue

            morceaux.push(clause.sql)
            if (Array.isArray(clause.valeurs) && clause.valeurs.length)
                valeurs.push(...clause.valeurs)
        }
    }

    if (!morceaux.length) return { clause: '', valeurs: [] }

    return {
        clause : 'WHERE ' + morceaux.join(' AND '),
        valeurs
    }
}

const formater_valeur_sql_debug = (valeur) =>
{
    if (valeur === null || valeur === undefined)
        return 'NULL'

    if (valeur instanceof Date)
        return `'${valeur.toISOString().replace('T', ' ').replace('Z', '')}'`

    if (Array.isArray(valeur))
        return `(${valeur.map(formater_valeur_sql_debug).join(', ')})`

    if (typeof valeur === 'number' || typeof valeur === 'bigint')
        return String(valeur)

    if (typeof valeur === 'boolean')
        return valeur ? '1' : '0'

    return `'${String(valeur).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

const rendre_requete_sql_debug = (requete, valeurs = []) =>
{
    let index = 0
    return requete.replace(/\?/g, () => {
        if (index >= valeurs.length)
            return '?'

        return formater_valeur_sql_debug(valeurs[index++])
    })
}

const construire_set_update = async (modele, donnees) =>
{
    const morceaux = []
    const valeurs  = []

    for (const [nom_champ, valeur_brute] of Object.entries(donnees))
    {
        const champ = trouver_champ(modele, nom_champ)
        if (!champ)
            throw new Error(`Champ de mise à jour inconnu : ${nom_champ}`)

        if (typeof valeur_brute === 'string')
        {
            const valeur_now_sql = traduire_now_sql(valeur_brute)
            if (valeur_now_sql)
            {
                morceaux.push(`\`${nom_champ}\` = ${valeur_now_sql}`)
                continue
            }

            const valeur_temps = parser_litteral_condition(valeur_brute)
            if (valeur_temps instanceof Date && !Number.isNaN(valeur_temps.getTime()))
            {
                morceaux.push(`\`${nom_champ}\` = ?`)
                valeurs.push(valeur_temps)
                continue
            }

            const expression = valeur_brute.match(/^\s*(\w+)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/)
            if (expression)
            {
                const champ_source_nom = expression[1]
                const operateur        = expression[2]
                const delta            = Number(expression[3])
                const champ_source     = trouver_champ(modele, champ_source_nom)

                if (!champ_source)
                    throw new Error(`Champ source inconnu dans l'expression de mise à jour : ${champ_source_nom}`)
                if (champ.treatment || champ_source.treatment)
                    throw new Error(`Expression arithmétique non autorisée pour un champ traité : ${nom_champ}`)

                morceaux.push(`\`${nom_champ}\` = \`${champ_source_nom}\` ${operateur} ?`)
                valeurs.push(delta)
                continue
            }
        }

        morceaux.push(`\`${nom_champ}\` = ?`)
        valeurs.push(await traiter_ecriture(champ, valeur_brute))
    }

    return {
        clause : 'SET ' + morceaux.join(', '),
        valeurs
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

const creer_search_one = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)
    const options_norm   = normaliser_options_liste(modele, options)

    const preparation = preparer_condition_recherche(schemas, modele, condition_norm, contexte_norm)
    const preparation_aux = preparer_aux_conditions_recherche(schemas, modele, options_norm.aux_conditions, contexte_norm)

    const joins = dedoublonner_joins_recherche([...preparation.joins, ...preparation_aux.joins])
    const clauses_select = preparation_aux.clauses_select
    const valeurs = [...preparation_aux.valeurs, ...preparation.valeurs]
    const besoin_post = Object.keys(preparation.post).length > 0

    const requete  = construire_requete_recherche(modele, joins, preparation.clause, clauses_select)
    console.log('[search_one] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[search_one] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)

    const now = new Date()

    for (const ligne of lignes)
    {
        const post_ok = besoin_post ? await verifier_post(modele, ligne, preparation.post) : true
        if (!post_ok)
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        const condition_ok = respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, preparation.criteres)

        if (!condition_ok)
            continue

        return await projeter_ligne_select(schemas, modele, ligne_decryptee, options_norm.select)
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

    const preparation = preparer_condition_recherche(schemas, modele, condition_norm, contexte_norm)
    const preparation_aux = preparer_aux_conditions_recherche(schemas, modele, options_norm.aux_conditions, contexte_norm)

    const joins = dedoublonner_joins_recherche([...preparation.joins, ...preparation_aux.joins])
    const clauses_select = preparation_aux.clauses_select
    const valeurs = [...preparation_aux.valeurs, ...preparation.valeurs]
    const besoin_post = Object.keys(preparation.post).length > 0

    const requete = construire_requete_recherche(modele, joins, preparation.clause, clauses_select)
    console.log('[search_all] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[search_all] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)

    const now = new Date()
    const resultats = []
    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, preparation.post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, preparation.criteres))
            continue

        resultats.push(ligne_decryptee)
    }

    const resultats_paginees = appliquer_options_liste(resultats, options_norm, (ligne, nom) => ligne[nom])
    return await projeter_lignes_select(schemas, modele, resultats_paginees, options_norm.select)
}

// ─── $delete_one ─────────────────────────────────────────────────────────────

const creer_delete_one = (schemas) => async (nom_modele, condition, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const condition_norm = normaliser_condition(condition)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)

    const { joins, condition_avec_joins } = analyser_condition_pour_joins(schemas, modele, condition_norm, contexte_norm)
    
    const criteres = extraire_criteres_depuis_condition(modele, condition_avec_joins, contexte_norm)
    const filtres_comparaison_sql = extraire_filtres_comparaison_sql(modele, condition_avec_joins, contexte_norm)
    const filtres_relation_sql = extraire_filtres_relation_sql(condition_avec_joins, contexte_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, [...filtres_comparaison_sql, ...filtres_relation_sql])
    const besoin_post         = Object.keys(post).length > 0

    const requete = construire_requete_recherche(modele, joins, clause)
    console.log('[delete_one] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[delete_one] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)
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

    const { joins, condition_avec_joins } = analyser_condition_pour_joins(schemas, modele, condition_norm, contexte_norm)
    
    const criteres = extraire_criteres_depuis_condition(modele, condition_avec_joins, contexte_norm)
    const filtres_comparaison_sql = extraire_filtres_comparaison_sql(modele, condition_avec_joins, contexte_norm)
    const filtres_relation_sql = extraire_filtres_relation_sql(condition_avec_joins, contexte_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, [...filtres_comparaison_sql, ...filtres_relation_sql])
    const besoin_post         = Object.keys(post).length > 0

    const requete = construire_requete_recherche(modele, joins, clause)
    console.log('[delete_all] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[delete_all] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)
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
        { ...options_norm, select: null },
        (element, nom) => element.decryptee[nom]
    )

    for (const element of cibles)
        await supprimer_par_pk(modele, element.brute)
}

// ─── $update_all ─────────────────────────────────────────────────────────────

const creer_update_one = (schemas) => async (nom_modele, condition, donnees, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const condition_norm = normaliser_condition(condition)
    const donnees_norm   = normaliser_donnees_update(donnees)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)

    const { joins, condition_avec_joins } = analyser_condition_pour_joins(schemas, modele, condition_norm, contexte_norm)
    
    const criteres = extraire_criteres_depuis_condition(modele, condition_avec_joins, contexte_norm)
    const filtres_comparaison_sql = extraire_filtres_comparaison_sql(modele, condition_avec_joins, contexte_norm)
    const filtres_relation_sql = extraire_filtres_relation_sql(condition_avec_joins, contexte_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, [...filtres_comparaison_sql, ...filtres_relation_sql])
    const besoin_post         = Object.keys(post).length > 0

    const requete = construire_requete_recherche(modele, joins, clause)
    console.log('[update_one] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[update_one] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)

    const now = new Date()
    let cible = null

    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres))
            continue

        cible = ligne
        break
    }

    if (!cible)
        return 0

    const { clause: set_clause, valeurs: set_valeurs } = await construire_set_update(modele, donnees_norm)
    const clause_pk  = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
    const valeurs_pk = modele.primary.map(c => cible[c])

    const [resultat] = await pool().query(
        `UPDATE \`${modele.name}\` ${set_clause} WHERE ${clause_pk}`,
        [...set_valeurs, ...valeurs_pk]
    )

    return Number(resultat?.affectedRows || 0)
}

// ─── $update_all ─────────────────────────────────────────────────────────────

const creer_update_all = (schemas) => async (nom_modele, condition, donnees, contexte_condition = {}) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const condition_norm = normaliser_condition(condition)
    const donnees_norm   = normaliser_donnees_update(donnees)
    const contexte_norm  = normaliser_contexte_condition(contexte_condition)

    const { joins, condition_avec_joins } = analyser_condition_pour_joins(schemas, modele, condition_norm, contexte_norm)
    
    const criteres = extraire_criteres_depuis_condition(modele, condition_avec_joins, contexte_norm)
    const filtres_comparaison_sql = extraire_filtres_comparaison_sql(modele, condition_avec_joins, contexte_norm)
    const filtres_relation_sql = extraire_filtres_relation_sql(condition_avec_joins, contexte_norm)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql, [...filtres_comparaison_sql, ...filtres_relation_sql])
    const besoin_post         = Object.keys(post).length > 0

    const requete = construire_requete_recherche(modele, joins, clause)
    console.log('[update_all] SQL:', rendre_requete_sql_debug(requete, valeurs))
    if (valeurs.length) console.log('[update_all] Valeurs:', valeurs)
    const [lignes] = await pool().query(requete, valeurs)

    const now = new Date()
    const cibles = []
    for (const ligne of lignes)
    {
        if (besoin_post && !await verifier_post(modele, ligne, post))
            continue

        const ligne_decryptee = decrypter_ligne(modele, ligne)
        if (!respecter_condition(modele, ligne_decryptee, condition_norm, now, contexte_norm, criteres))
            continue

        cibles.push(ligne)
    }

    if (!cibles.length)
        return 0

    const { clause: set_clause, valeurs: set_valeurs } = await construire_set_update(modele, donnees_norm)
    let mises_a_jour = 0

    for (const ligne of cibles)
    {
        const clause_pk  = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
        const valeurs_pk = modele.primary.map(c => ligne[c])

        const [resultat] = await pool().query(
            `UPDATE \`${modele.name}\` ${set_clause} WHERE ${clause_pk}`,
            [...set_valeurs, ...valeurs_pk]
        )

        mises_a_jour += Number(resultat?.affectedRows || 0)
    }

    return mises_a_jour
}

// ─── Logique d'insertion (partagée par $create_one et $create_all) ────────────

const inserer_batch = async (modele, tableau) =>
{
    if (!tableau.length) return []

    const normaliser_donnees_insertion = (donnees) =>
    {
        const normalisees = { ...donnees }

        for (const champ of modele.fields)
        {
            if (!champ.alt)
                continue

            if (normalisees[champ.name] !== undefined)
                continue

            if (Object.prototype.hasOwnProperty.call(normalisees, champ.alt))
                normalisees[champ.name] = normalisees[champ.alt]
        }

        return normalisees
    }

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // 1. Copier les données et générer les valeurs auto
    const insertions = tableau.map(normaliser_donnees_insertion)

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

    // 5. Relire les lignes insérées pour retourner les valeurs stockées en base.
    const lire_lignes_inserees = async () =>
    {
        if (!modele.primary.length)
            return []

        const clauses = []
        const valeurs = []

        for (const insertion of insertions)
        {
            const tous_les_pk_sont_definis = modele.primary.every(nom_pk => insertion[nom_pk] !== undefined)
            if (!tous_les_pk_sont_definis)
                continue

            const clause = modele.primary.map(nom_pk =>
            {
                valeurs.push(insertion[nom_pk])
                return `\`${nom_pk}\` = ?`
            }).join(' AND ')

            clauses.push(`(${clause})`)
        }

        if (!clauses.length)
            return []

        const [rows] = await pool().query(
            `SELECT * FROM \`${modele.name}\` WHERE ${clauses.join(' OR ')}`,
            valeurs
        )

        return rows
    }

    const lignes_inserees = await lire_lignes_inserees()
    const cle_ligne = (ligne) => modele.primary.map(nom_pk => String(ligne[nom_pk])).join('::')
    const lignes_par_clef = new Map(lignes_inserees.map(ligne => [cle_ligne(ligne), ligne]))

    return insertions.map((insertion) =>
    {
        const cle = cle_ligne(insertion)
        const ligne_base = lignes_par_clef.get(cle) ?? {}
        const resultat = {}

        for (const champ of modele.fields)
        {
            if (Object.prototype.hasOwnProperty.call(ligne_base, champ.name))
                resultat[champ.name] = ligne_base[champ.name]

            if (champ.alt && insertion[champ.name] !== undefined)
                resultat[champ.alt] = insertion[champ.name]
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
    $update_one: creer_update_one(schemas),
    $update_all: creer_update_all(schemas),
    $create_one: creer_create_one(schemas),
    $create_all: creer_create_all(schemas),
})