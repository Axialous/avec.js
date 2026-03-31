import fs   from "fs"
import path from "path"

// ─── Analyseur syntaxique ─────────────────────────────────────────────────────

const passer_blancs = (str, pos) =>
{
    while (pos < str.length && /^[ \t]$/.test(str[pos]))
        pos++
    return pos
}

const passer_separateurs = (str, pos) =>
{
    while (pos < str.length)
    {
        if (str[pos] == '#')
        {
            while (pos < str.length && str[pos] != '\n')
                pos++
        }
        else if (/^[ \t\n,]$/.test(str[pos]))
            pos++
        else
            break
    }
    return pos
}

const lire_scalaire = (str, pos) =>
{
    let valeur = ''
    while (pos < str.length)
    {
        const c = str[pos]
        if (/^["'`]$/.test(c))
        {
            const guillemet = c
            pos++
            while (pos < str.length && str[pos] != guillemet)
            {
                valeur += str[pos]
                pos++
            }
            if (pos >= str.length)
                return { valeur: "invalide", pos }
            pos++
            continue
        }
        if (/^[ \t\n,:\[\]{}#]$/.test(c))
            break
        valeur += c
        pos++
    }
    if (valeur.length == 0)
        return { valeur: "invalide", pos }
    return { valeur, pos }
}

// ─── Analyse d'un jeu de caractères style [A-Z0-9] ───────────────────────────

const analyser_chars = (str) =>
{
    if (!str) return null
    let resultat = ''
    let i = 0
    while (i < str.length)
    {
        if (i + 2 < str.length && str[i + 1] === '-')
        {
            const debut = str.charCodeAt(i)
            const fin   = str.charCodeAt(i + 2)
            for (let c = debut; c <= fin; c++)
                resultat += String.fromCharCode(c)
            i += 3
        }
        else
        {
            resultat += str[i]
            i++
        }
    }
    return resultat || null
}

const lire_regex = (str, pos) =>
{
    pos++ // passer le '/' ouvrant
    let source = ''
    while (pos < str.length && str[pos] !== '/')
    {
        if (str[pos] === '\\' && pos + 1 < str.length)
        {
            source += str[pos] + str[pos + 1]
            pos += 2
        }
        else
        {
            source += str[pos]
            pos++
        }
    }
    if (pos >= str.length)
        return { valeur: "invalide", pos }
    pos++ // passer le '/' fermant
    let flags = ''
    while (pos < str.length && /^[gimsuy]$/.test(str[pos]))
    {
        flags += str[pos]
        pos++
    }
    return { valeur: { __regex__: true, source, flags }, pos }
}

const lire_valeur = (str, pos) =>
{
    pos = passer_blancs(str, pos)
    if (pos >= str.length)
        return { valeur: "invalide", pos }
    if (str[pos] == '[')
        return lire_liste(str, pos)
    if (str[pos] == '{')
        return lire_dict(str, pos)
    return lire_scalaire(str, pos)
}

const lire_liste = (str, pos) =>
{
    pos++
    const liste = []
    while (true)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            return { valeur: "invalide", pos }
        if (str[pos] == ']')
            return { valeur: liste, pos: pos + 1 }
        const res = lire_valeur(str, pos)
        if (res.valeur === "invalide")
            return { valeur: "invalide", pos: res.pos }
        liste.push(res.valeur)
        pos = res.pos
    }
}

const lire_dict = (str, pos) =>
{
    pos++
    const dict = {}
    while (true)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            return { valeur: "invalide", pos }
        if (str[pos] == '}')
            return { valeur: dict, pos: pos + 1 }
        const res_cle = lire_scalaire(str, pos)
        if (res_cle.valeur === "invalide")
            return { valeur: "invalide", pos: res_cle.pos }
        pos = res_cle.pos
        pos = passer_blancs(str, pos)
        if (pos >= str.length || str[pos] != ':')
            return { valeur: "invalide", pos }
        pos++
        const res_val = lire_valeur(str, pos)
        if (res_val.valeur === "invalide")
            return { valeur: "invalide", pos: res_val.pos }
        dict[res_cle.valeur] = res_val.valeur
        pos = res_val.pos
    }
}

const lire_bloc_brut = (str, pos) =>
{
    if (pos >= str.length || str[pos] !== '[')
        return { valeur: "invalide", pos }
    pos++
    let profondeur = 1
    let contenu    = ''
    while (pos < str.length)
    {
        if (str[pos] === '[')
            profondeur++
        else if (str[pos] === ']')
        {
            profondeur--
            if (profondeur === 0)
                return { valeur: contenu.trim(), pos: pos + 1 }
        }
        contenu += str[pos]
        pos++
    }
    return { valeur: "invalide", pos }
}

const analyser_sans = (str) =>
{
    const annotations = {}
    let pos = 0
    while (pos < str.length)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            break
        if (str[pos] != '@')
            return "invalide"
        pos++
        const res_nom = lire_scalaire(str, pos)
        if (res_nom.valeur === "invalide")
            return "invalide"
        pos = res_nom.pos
        pos = passer_blancs(str, pos)
        const res_val = res_nom.valeur === 'script'
            ? lire_bloc_brut(str, pos)
            : lire_valeur(str, pos)
        if (res_val.valeur === "invalide")
            return "invalide"
        annotations[res_nom.valeur] = res_val.valeur
        pos = res_val.pos
    }
    return annotations
}

// ─── Transformation ───────────────────────────────────────────────────────────

const analyser_taille = (taille) =>
{
    if (taille === null || taille === undefined)
        return { min: null, max: null }
    const str    = String(taille)
    const bornes = str.match(/^(\d+)-(\d+)$/)
    if (bornes)
        return { min: parseInt(bornes[1]), max: parseInt(bornes[2]) }
    if (/^\d+$/.test(str))
    {
        const n = parseInt(str)
        return { min: n, max: n }
    }
    return { min: null, max: null }
}

const analyser_count = (count) =>
{
    if (!count)
        return { min: 1, max: 1 }
    const str   = String(count)
    const match = str.match(/^([0-9]+|N)-([0-9]+|N)$/)
    if (!match)
        return null
    return {
        min: match[1] == 'N' ? 'N' : parseInt(match[1]),
        max: match[2] == 'N' ? 'N' : parseInt(match[2])
    }
}

const resoudre_type_sql = (type_sans, taille, est_deterministe) =>
{
    const { min, max } = analyser_taille(taille)
    const fixe         = min !== null && min === max

    if (type_sans.includes('/'))
    {
        const valeurs = type_sans.split('/')
        return {
            type     : 'varchar',
            min      : min ?? 0,
            max      : max ?? Math.max(...valeurs.map(v => v.length)),
            treatment: null,
            values   : valeurs
        }
    }

    switch (type_sans)
    {
        case 'char':
            return { type: fixe ? 'char' : 'varchar', min, max, treatment: null }

        case 'text':
            return { type: 'text', min: null, max: null, treatment: null }

        case 'int':
            return { type: 'int', min: null, max: null, treatment: null }

        case 'date':
            return { type: 'date', min: null, max: null, treatment: null }

        case 'datetime':
            return { type: 'datetime', min: null, max: null, treatment: null }

        case 'boolean':
            return { type: 'boolean', min: null, max: null, treatment: null }

        case 'hash':
            if (taille !== null && taille !== undefined)
                return {
                    type     : fixe ? 'char' : 'varchar',
                    min,
                    max,
                    treatment: est_deterministe ? 'deterministic_hashing' : 'hashing'
                }
            return {
                type     : 'char',
                min      : 64,
                max      : 64,
                treatment: est_deterministe ? 'deterministic_hashing' : 'hashing'
            }

        case 'crypt':
            return {
                type     : fixe ? 'binary' : 'varbinary',
                min,
                max,
                treatment: 'encryption'
            }

        default:
            return null
    }
}

const transformer_champ = (champ_brut, champs_dans_unique) =>
{
    const type_res = resoudre_type_sql(
        champ_brut.type,
        champ_brut.size ?? null,
        champs_dans_unique.includes(champ_brut.name)
    )
    if (!type_res)
        return "invalide"

    const count    = analyser_count(champ_brut.count ?? null)
    const nullable = count ? count.min === 0 : false

    const regle_brute = champ_brut.rule ?? null
    const rule = typeof regle_brute === 'string' ? regle_brute : null

    const can_create   = typeof champ_brut.can_create   === 'string' ? champ_brut.can_create.trim()   : null
    const prior_create = typeof champ_brut.prior_create === 'string' ? champ_brut.prior_create.trim() : null
    const post_create  = typeof champ_brut.post_create  === 'string' ? champ_brut.post_create.trim()  : null
    const alt          = typeof champ_brut.alt          === 'string' ? champ_brut.alt.trim()          : null

    const chars_bruts = champ_brut.chars ?? null
    const chars_str   = Array.isArray(chars_bruts) ? chars_bruts[0] : (chars_bruts ?? null)
    const chars       = analyser_chars(chars_str)

    const length_brut = champ_brut.length ?? null
    const length      = length_brut !== null ? analyser_taille(String(length_brut)) : null

    const champ = {
        name     : champ_brut.name,
        type     : type_res.type,
        min      : type_res.min,
        max      : type_res.max,
        nullable,
        default  : champ_brut.default ?? null,
        chars,
        length,
        treatment: type_res.treatment,
        rule,
        can_create,
        prior_create,
        post_create,
        alt
    }
    if (type_res.values)
        champ.values = type_res.values
    return champ
}

const transformer_modele = (annotations, nom_fichier) =>
{
    if (annotations === "invalide")
        return "invalide"

    const name_brut  = Array.isArray(annotations.name) ? annotations.name : null
    const nom_table  = name_brut?.[0] ?? nom_fichier
    const nom_entree = name_brut?.[1] ?? null

    const primary            = Array.isArray(annotations.primary) ? annotations.primary : []
    const unique             = (Array.isArray(annotations.unique) ? annotations.unique : []).filter(Array.isArray)
    const champs_dans_unique = [...primary, ...unique.flat()]
    const champs_bruts       = Array.isArray(annotations.fields) ? annotations.fields : []
    const routes             = Array.isArray(annotations.routes) ? annotations.routes : []
    const script             = typeof annotations.script === 'string' ? annotations.script : null

    const champs    = []
    const relations = []

    for (const champ_brut of champs_bruts)
    {
        if (typeof champ_brut !== "object" || champ_brut === null || Array.isArray(champ_brut))
            return "invalide"
        if (!champ_brut.name)
            return "invalide"

        if (!champ_brut.type)
        {
            if (!champ_brut.count)
                return "invalide"
            const count = analyser_count(String(champ_brut.count))
            if (!count)
                return "invalide"
            relations.push({
                champ_source: champ_brut.name,
                table_cible : champ_brut.ref ?? champ_brut.name,
                count       : String(champ_brut.count),
                min         : count.min,
                max         : count.max
            })
            continue
        }

        const champ = transformer_champ(champ_brut, champs_dans_unique)
        if (champ === "invalide")
            return "invalide"
        champs.push(champ)
    }

    return {
        name      : nom_table,
        entry_name: nom_entree,
        primary,
        unique,
        fields    : champs,
        routes,
        script,
        _relations: relations
    }
}

// ─── Résolution des relations ─────────────────────────────────────────────────

const trouver_champ_pk = (table) =>
{
    if (table.primary.length == 0)
        return null
    return table.fields.find(f => f.name == table.primary[0]) ?? null
}

const resoudre_relations = (tables) =>
{
    const index = {}
    for (const table of tables)
        index[table.name] = table

    const relations = []

    for (const table of tables)
    {
        for (const rel of table._relations)
        {
            const table_cible = index[rel.table_cible]
            if (!table_cible)
            {
                console.log(`/!\\ relation introuvable : \`${table.name}.${rel.champ_source}\` → \`${rel.table_cible}\``)
                continue
            }

            const relation = {
                table_source: table.name,
                champ_source: rel.champ_source,
                table_cible : rel.table_cible,
                count       : rel.count,
                min         : rel.min,
                max         : rel.max
            }

            if (rel.min === 'N' && rel.max === 'N')
            {
                relation.table_jonction = `${rel.champ_source}_${table_cible.entry_name ?? table_cible.name}`
            }
            else if (rel.max === 'N')
            {
                const pk = trouver_champ_pk(table)
                if (pk)
                {
                    const nom_fk  = `id_${table.entry_name ?? table.name}`
                    const deja_la = table_cible.fields.some(f => f.name == nom_fk)
                    if (!deja_la)
                        table_cible.fields.push({
                            name     : nom_fk,
                            type     : pk.type,
                            min      : pk.min,
                            max      : pk.max,
                            nullable : false,
                            treatment: null
                        })
                    relation.cle_etrangere = nom_fk
                }
            }

            relations.push(relation)
        }
        delete table._relations
    }

    return relations
}

// ─── Chargement ───────────────────────────────────────────────────────────────

const lire_dossier = (dossier, tables) =>
{
    let entrees
    try
    {
        entrees = fs.readdirSync(dossier, { withFileTypes: true })
    }
    catch
    {
        console.log(`/!\\ dossier introuvable : ${dossier}`)
        return
    }

    for (const entree of entrees)
    {
        const chemin = path.join(dossier, entree.name)
        if (entree.isDirectory())
        {
            lire_dossier(chemin, tables)
            continue
        }
        if (!entree.isFile() || !entree.name.endsWith('.sans'))
            continue

        const nom_fichier = entree.name.slice(0, -5)
        let contenu
        try
        {
            contenu = fs.readFileSync(chemin, 'utf-8')
        }
        catch (err)
        {
            console.log(`/!\\ erreur lecture \`${entree.name}\` : ${err.message}`)
            continue
        }

        const annotations = analyser_sans(contenu)
        const table       = transformer_modele(annotations, nom_fichier)
        if (table === "invalide")
        {
            console.log(`/!\\ modèle invalide : \`${entree.name}\``)
            continue
        }

        tables.push(table)
    }
}

export const charger_modeles = (dossier) =>
{
    const tables      = []
    const noms_connus = new Set()
    lire_dossier(dossier, tables, noms_connus)
    const relations = resoudre_relations(tables)
    return { tables, relations, noms_connus }
}
