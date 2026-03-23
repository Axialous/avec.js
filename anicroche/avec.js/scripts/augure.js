import {valoriser} from './scribe.js'
import {ecrire_variable, lire_variable} from './sculpteur.js'

// ============================================================
// Types de résultat
// ============================================================

const ERREUR = ':x'
const VRAI   = ':)'
const FAUX   = ':('

const est_erreur  = (v) => v === ERREUR
const est_booleen = (v) => v === VRAI || v === FAUX
const est_nombre  = (v) => typeof v === 'number' && !isNaN(v)
const est_texte   = (v) => typeof v === 'string' && !est_erreur(v) && !est_booleen(v)
const est_liste   = (v) => Array.isArray(v)
const est_dict    = (v) => v !== null && typeof v === 'object' && !est_liste(v)

const coercer_nombre = (v) =>
{
    if (est_nombre(v)) return v
    if (est_texte(v))
    {
        const n = Number(v.replace(/_/g, ''))
        if (!isNaN(n)) return n
    }
    return ERREUR
}

const coercer_booleen = (v) =>
{
    if (est_booleen(v)) return v
    if (est_erreur(v))  return FAUX
    return ERREUR
}

// ============================================================
// Lexer
// ============================================================

const SMILEYS = [':)', ':(', ':x']

const OPERATEURS_COMPOSITES = [
    '!-{', '!}-', '-{', '}-',
    '>=', '<=', '!=', '~=',
    ':+', ':-',
    '&', '|', '!',
    '+', '-', '*', '/', '%', '^',
    '=', '>', '<',
    '(', ')'
]

const TOUS  = true
const AUCUN = false

const OPERATEURS_REGLES = {
    '(': { avant: ['('], apres: TOUS },
    ')': { avant: TOUS, apres: [')'] },
    '!': { avant: ['('], apres: AUCUN },
}

const tokeniser = (str) =>
{
    const tokens = []
    let pos = 0

    while (pos < str.length)
    {
        // Espaces
        if (/\s/.test(str[pos]))
        {
            pos++
            continue
        }

        // Smileys
        const smiley = SMILEYS.find(s => str.startsWith(s, pos))
        if (smiley)
        {
            tokens.push({ type: 'booleen', valeur: smiley === ':)' ? VRAI : smiley === ':(' ? FAUX : ERREUR })
            pos += smiley.length
            continue
        }

        // Chaînes entre guillemets
        if (str[pos] === '"' || str[pos] === "'" || str[pos] === '`')
        {
            const guillemet = str[pos]
            let texte = ''
            pos++
            while (pos < str.length && str[pos] !== guillemet)
            {
                if (str[pos] === '\\') { pos++; texte += str[pos] }
                else texte += str[pos]
                pos++
            }
            pos++
            tokens.push({ type: 'texte', valeur: texte })
            continue
        }

        // Regex : /pattern/flags — seulement après un opérateur ou en début d'expression
        if (str[pos] === '/')
        {
            const dernier_token = tokens.at(-1)
            if (!dernier_token || dernier_token.type === 'op')
            {
                pos++ // passe le / ouvrant
                let source = ''
                while (pos < str.length && str[pos] !== '/')
                {
                    if (str[pos] === '\\' && pos + 1 < str.length) { source += str[pos] + str[pos + 1]; pos += 2 }
                    else { source += str[pos]; pos++ }
                }
                pos++ // passe le / fermant
                let flags = ''
                while (pos < str.length && /[gimsuy]/.test(str[pos])) { flags += str[pos]; pos++ }
                tokens.push({ type: 'regex', source, flags })
                continue
            }
        }

        // Nombres
        if (/[0-9]/.test(str[pos]) || ((str[pos] === '+' || str[pos] === '-') && /[0-9]/.test(str[pos + 1]) && (tokens.length === 0 || tokens.at(-1).type === 'op')))
        {
            let num = ''
            if (str[pos] === '+' || str[pos] === '-') { num += str[pos]; pos++ }
            while (pos < str.length && /[0-9_.]/.test(str[pos])) { num += str[pos]; pos++ }
            tokens.push({ type: 'nombre', valeur: parseFloat(num.replace(/_/g, '')) })
            continue
        }

        // Variables avec multiplication implicite (3$var)
        if (tokens.length > 0 && tokens.at(-1).type === 'nombre' && str[pos] === '$')
        {
            tokens.push({ type: 'op', valeur: '*' })
        }

        // Variables
        if (str[pos] === '$')
        {
            let nom = '$'
            pos++
            while (pos < str.length && /[\w]/.test(str[pos])) { nom += str[pos]; pos++ }
            tokens.push({ type: 'variable', valeur: nom })

            // Accès profond : $var.clef, $var['clef'], $var[0]
            while (pos < str.length && (str[pos] === '.' || str[pos] === '['))
            {
                if (str[pos] === '.')
                {
                    pos++
                    let clef = ''
                    while (pos < str.length && /[\w]/.test(str[pos])) { clef += str[pos]; pos++ }
                    tokens.push({ type: 'acces', valeur: clef })
                }
                else if (str[pos] === '[')
                {
                    pos++
                    let clef = ''
                    const guillemet = str[pos] === '"' || str[pos] === "'" || str[pos] === '`' ? str[pos++] : null
                    while (pos < str.length && str[pos] !== ']' && str[pos] !== guillemet) { clef += str[pos]; pos++ }
                    if (guillemet) pos++
                    pos++ // ]
                    const clef_finale = guillemet ? clef : parseFloat(clef)
                    tokens.push({ type: 'acces', valeur: clef_finale })
                }
            }
            continue
        }

        // Listes
        if (str[pos] === '[')
        {
            pos++
            const elements = []
            let tampon = ''
            while (pos < str.length && str[pos] !== ']')
            {
                if (str[pos] === ',' || str[pos] === '\n')
                {
                    if (tampon.trim()) elements.push(tokeniser(tampon.trim())[0]?.valeur ?? tampon.trim())
                    tampon = ''
                }
                else tampon += str[pos]
                pos++
            }
            if (tampon.trim()) elements.push(tokeniser(tampon.trim())[0]?.valeur ?? tampon.trim())
            pos++ // ]
            tokens.push({ type: 'liste', valeur: elements })
            continue
        }

        // Dictionnaires
        if (str[pos] === '{')
        {
            pos++
            const dict = {}
            let tampon = ''
            const paires = []
            while (pos < str.length && str[pos] !== '}')
            {
                if (str[pos] === ',' || str[pos] === '\n')
                {
                    if (tampon.trim()) paires.push(tampon.trim())
                    tampon = ''
                }
                else tampon += str[pos]
                pos++
            }
            if (tampon.trim()) paires.push(tampon.trim())
            pos++ // }
            for (const paire of paires)
            {
                const idx = paire.indexOf(':')
                if (idx !== -1)
                {
                    const clef   = tokeniser(paire.slice(0, idx).trim())[0]?.valeur ?? paire.slice(0, idx).trim()
                    const valeur = tokeniser(paire.slice(idx + 1).trim())[0]?.valeur ?? paire.slice(idx + 1).trim()
                    dict[clef] = valeur
                }
            }
            tokens.push({ type: 'dict', valeur: dict })
            continue
        }

        // Opérateurs
        const caractere_autorise = (regle, caractere) =>
        {
            if (regle === TOUS)  return true
            if (regle === AUCUN) return caractere === undefined || /\s/.test(caractere)
            return caractere === undefined || /\s/.test(caractere) || regle.includes(caractere)
        }

        const op = OPERATEURS_COMPOSITES.find(o => str.startsWith(o, pos))
        if (op)
        {
            const regles  = OPERATEURS_REGLES[op] ?? { avant: AUCUN, apres: AUCUN }
            const car_avant = pos === 0 ? undefined : str[pos - 1]
            const car_apres = pos + op.length >= str.length ? undefined : str[pos + op.length]

            if (caractere_autorise(regles.avant, car_avant) && caractere_autorise(regles.apres, car_apres))
            {
                tokens.push({ type: 'op', valeur: op })
                pos += op.length
                continue
            }
        }

        // Texte sans guillemets
        let mot = ''
        while (pos < str.length)
        {
            const c = str[pos]
            if (/\s/.test(c)) break

            // Vérifier si un opérateur valide commence ici
            const op_ici = OPERATEURS_COMPOSITES.find(o => str.startsWith(o, pos))
            if (op_ici)
            {
                const regles  = OPERATEURS_REGLES[op_ici] ?? { avant: AUCUN, apres: AUCUN }
                const car_avant = pos === 0 ? undefined : str[pos - 1]
                const car_apres = pos + op_ici.length >= str.length ? undefined : str[pos + op_ici.length]

                if (caractere_autorise(regles.avant, car_avant) && caractere_autorise(regles.apres, car_apres))
                    break
            }

            mot += c
            pos++
        }
        if (mot.length > 0) tokens.push({ type: 'texte', valeur: mot })
    }

    return tokens
}

// ============================================================
// Lecture de chaîne avec échappement
// ============================================================

const lire_chaine_caracteres = (str, donnees) =>
{
    // Entre guillemets
    if (str.length >= 2)
    {
        const g = str[0]
        if ((g === '"' || g === "'" || g === '`') && str.at(-1) === g)
        {
            str = str.slice(1, -1)
        }
    }

    // Échappement et interpolation
    let result = ''
    let pos = 0
    while (pos < str.length)
    {
        if (str[pos] === '\\') { pos++; result += str[pos] }
        else result += str[pos]
        pos++
    }

    return valoriser(result, donnees)
}

// ============================================================
// Opérateurs — une fonction par opérateur
// ============================================================

const op_addition = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na + nb
}

const op_soustraction = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na - nb
}

const op_multiplication = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na * nb
}

const op_division = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    if (nb === 0) return ERREUR
    return na / nb
}

const op_modulo = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    if (nb === 0) return ERREUR
    return na % nb
}

const op_puissance = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return Math.pow(na, nb)
}

const op_egal = (a, b) =>
{
    if (est_erreur(a) || est_erreur(b)) return ERREUR
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (!est_erreur(na) && !est_erreur(nb)) return na === nb ? VRAI : FAUX
    return String(a) === String(b) ? VRAI : FAUX
}

const op_different = (a, b) =>
{
    const r = op_egal(a, b)
    if (est_erreur(r)) return ERREUR
    return r === VRAI ? FAUX : VRAI
}

const op_superieur = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na > nb ? VRAI : FAUX
}

const op_superieur_egal = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na >= nb ? VRAI : FAUX
}

const op_inferieur = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na < nb ? VRAI : FAUX
}

const op_inferieur_egal = (a, b) =>
{
    const na = coercer_nombre(a), nb = coercer_nombre(b)
    if (est_erreur(na) || est_erreur(nb)) return ERREUR
    return na <= nb ? VRAI : FAUX
}

const op_contenu_dans = (a, b) =>
{
    if (est_erreur(a) || est_erreur(b)) return ERREUR
    if (est_liste(b)) return b.includes(a) ? VRAI : FAUX
    if (est_dict(b))  return Object.prototype.hasOwnProperty.call(b, a) ? VRAI : FAUX
    return ERREUR
}

const op_non_contenu_dans = (a, b) =>
{
    const r = op_contenu_dans(a, b)
    if (est_erreur(r)) return ERREUR
    return r === VRAI ? FAUX : VRAI
}

const op_contient = (a, b) =>
{
    if (est_erreur(a) || est_erreur(b)) return ERREUR
    if (est_liste(a)) return a.includes(b) ? VRAI : FAUX
    if (est_dict(a))  return Object.prototype.hasOwnProperty.call(a, b) ? VRAI : FAUX
    return ERREUR
}

const op_ne_contient_pas = (a, b) =>
{
    const r = op_contient(a, b)
    if (est_erreur(r)) return ERREUR
    return r === VRAI ? FAUX : VRAI
}

const op_inclure = (a, b, donnees) =>
{
    if (!est_texte(a)) return ERREUR
    const chars = lire_chaine_caracteres(b, donnees)
    if (est_erreur(chars)) return ERREUR
    return [...a].filter(c => chars.includes(c)).join('')
}

const op_exclure = (a, b, donnees) =>
{
    if (!est_texte(a)) return ERREUR
    const chars = lire_chaine_caracteres(b, donnees)
    if (est_erreur(chars)) return ERREUR
    return [...a].filter(c => !chars.includes(c)).join('')
}

const op_et = (a, b_fn) =>
{
    const ba = coercer_booleen(a)
    if (est_erreur(ba)) return ERREUR
    if (ba === FAUX) return FAUX
    return coercer_booleen(b_fn())
}

const op_ou = (a, b_fn) =>
{
    const ba = coercer_booleen(a)
    if (est_erreur(ba)) return ERREUR
    if (ba === VRAI) return VRAI
    return coercer_booleen(b_fn())
}

const op_non = (a) =>
{
    const ba = coercer_booleen(a)
    if (est_erreur(ba)) return ERREUR
    return ba === VRAI ? FAUX : VRAI
}

const OPERATEURS_BINAIRES = {
    '+':   op_addition,
    '-':   op_soustraction,
    '*':   op_multiplication,
    '/':   op_division,
    '%':   op_modulo,
    '^':   op_puissance,
    '=':   op_egal,
    '!=':  op_different,
    '>':   op_superieur,
    '>=':  op_superieur_egal,
    '<':   op_inferieur,
    '<=':  op_inferieur_egal,
    '-{':  op_contenu_dans,
    '!-{': op_non_contenu_dans,
    '}-':  op_contient,
    '!}-': op_ne_contient_pas,
}

// ============================================================
// Parser — descente récursive
// ============================================================

const parser = (tokens) =>
{
    const etat = { tokens, pos: 0 }
    const noeud = parser_ou(etat)
    return noeud
}

const parser_ou = (etat) =>
{
    let gauche = parser_et(etat)
    while (etat.pos < etat.tokens.length && etat.tokens[etat.pos].valeur === '|')
    {
        etat.pos++
        const droite = parser_et(etat)
        gauche = { type: 'op_court_circuit', op: '|', gauche, droite }
    }
    return gauche
}

const parser_et = (etat) =>
{
    let gauche = parser_comparaison(etat)
    while (etat.pos < etat.tokens.length && etat.tokens[etat.pos].valeur === '&')
    {
        etat.pos++
        const droite = parser_comparaison(etat)
        gauche = { type: 'op_court_circuit', op: '&', gauche, droite }
    }
    return gauche
}

const OPS_COMPARAISON = new Set(['=', '!=', '>', '>=', '<', '<=', '-{', '!-{', '}-', '!}-', '~='])

const parser_comparaison = (etat) =>
{
    let premier = parser_addition(etat)
    const operandes = [premier]
    const ops = []

    while (etat.pos < etat.tokens.length && OPS_COMPARAISON.has(etat.tokens[etat.pos].valeur))
    {
        ops.push(etat.tokens[etat.pos].valeur)
        etat.pos++
        operandes.push(parser_addition(etat))
    }

    if (ops.length === 0) return premier

    // Comparaisons chaînées : a < b = c => a < b & b = c
    const paires = []
    for (let i = 0; i < ops.length; i++)
    {
        paires.push({ type: 'op_binaire', op: ops[i], gauche: operandes[i], droite: operandes[i + 1] })
    }

    return paires.reduce((acc, noeud) => ({ type: 'op_court_circuit', op: '&', gauche: acc, droite: noeud }))
}

const parser_addition = (etat) =>
{
    let gauche = parser_multiplication(etat)
    while (etat.pos < etat.tokens.length && ['+', '-', ':+', ':-'].includes(etat.tokens[etat.pos].valeur))
    {
        const op = etat.tokens[etat.pos].valeur
        etat.pos++
        const droite = parser_multiplication(etat)
        gauche = { type: 'op_binaire', op, gauche, droite }
    }
    return gauche
}

const parser_multiplication = (etat) =>
{
    let gauche = parser_puissance(etat)
    while (etat.pos < etat.tokens.length && ['*', '/', '%'].includes(etat.tokens[etat.pos].valeur))
    {
        const op = etat.tokens[etat.pos].valeur
        etat.pos++
        const droite = parser_puissance(etat)
        gauche = { type: 'op_binaire', op, gauche, droite }
    }
    return gauche
}

const parser_puissance = (etat) =>
{
    let gauche = parser_unaire(etat)
    if (etat.pos < etat.tokens.length && etat.tokens[etat.pos].valeur === '^')
    {
        etat.pos++
        const droite = parser_puissance(etat) // Associativité droite
        return { type: 'op_binaire', op: '^', gauche, droite }
    }
    return gauche
}

const parser_unaire = (etat) =>
{
    if (etat.pos < etat.tokens.length && etat.tokens[etat.pos].valeur === '!')
    {
        etat.pos++
        const operande = parser_unaire(etat)
        return { type: 'op_unaire', op: '!', operande }
    }
    return parser_primaire(etat)
}

const parser_primaire = (etat) =>
{
    const token = etat.tokens[etat.pos]

    if (!token) return { type: 'erreur' }

    if (token.valeur === '(')
    {
        etat.pos++
        const noeud = parser_ou(etat)
        etat.pos++ // )
        return noeud
    }

    etat.pos++

    if (token.type === 'nombre' || token.type === 'texte' || token.type === 'booleen' || token.type === 'liste' || token.type === 'dict')
    {
        let noeud = { type: 'valeur', valeur: token.valeur }

        // Accès profond sur valeur littérale (rare mais possible)
        while (etat.pos < etat.tokens.length && etat.tokens[etat.pos].type === 'acces')
        {
            noeud = { type: 'acces', cible: noeud, clef: etat.tokens[etat.pos].valeur }
            etat.pos++
        }

        return noeud
    }

    if (token.type === 'variable')
    {
        let noeud = { type: 'variable', valeur: token.valeur }

        while (etat.pos < etat.tokens.length && etat.tokens[etat.pos].type === 'acces')
        {
            noeud = { type: 'acces', cible: noeud, clef: etat.tokens[etat.pos].valeur }
            etat.pos++
        }

        return noeud
    }

    if (token.type === 'regex')
        return { type: 'regex', source: token.source, flags: token.flags }

    return { type: 'erreur' }
}

// ============================================================
// Correspondance de motif
// ============================================================

const op_correspondance = (chaine, motif_brut, donnees) =>
{
    if (!est_texte(chaine)) return ERREUR

    // Décomposer le motif en segments fixes et captures
    const segments = []
    let pos = 0

    while (pos < motif_brut.length)
    {
        if (motif_brut[pos] === '<' && motif_brut[pos + 1] === '$')
        {
            // Début d'une capture
            pos += 2 // Saute <$
            let nom = ''
            while (pos < motif_brut.length && motif_brut[pos] !== '>' && motif_brut[pos] !== ' ') { nom += motif_brut[pos]; pos++ }

            let mode     = null // null, ':+', ':-'
            let filtrage = null

            if (motif_brut[pos] === ' ')
            {
                pos++ // Saute l'espace
                if (motif_brut.startsWith(':+', pos))      { mode = ':+'; pos += 2 }
                else if (motif_brut.startsWith(':-', pos)) { mode = ':-'; pos += 2 }

                if (mode)
                {
                    pos++ // Saute l'espace après l'opérateur
                    let chars_brut = ''
                    if (motif_brut[pos] === '"' || motif_brut[pos] === "'" || motif_brut[pos] === '`')
                    {
                        const g = motif_brut[pos++]
                        while (pos < motif_brut.length && motif_brut[pos] !== g)
                        {
                            if (motif_brut[pos] === '\\') { pos++; chars_brut += motif_brut[pos] }
                            else chars_brut += motif_brut[pos]
                            pos++
                        }
                        pos++ // Ferme guillemet
                    }
                    else
                    {
                        while (pos < motif_brut.length && motif_brut[pos] !== '>') { chars_brut += motif_brut[pos]; pos++ }
                    }
                    filtrage = valoriser(chars_brut, donnees)
                }
            }

            pos++ // Saute >
            const delimiteur = pos < motif_brut.length ? motif_brut[pos] : null
            segments.push({ type: 'capture', nom, mode, filtrage, delimiteur })
        }
        else
        {
            // Segment fixe
            let texte = ''
            while (pos < motif_brut.length && !(motif_brut[pos] === '<' && motif_brut[pos + 1] === '$'))
            {
                texte += motif_brut[pos]; pos++
            }
            segments.push({ type: 'fixe', texte })
        }
    }

    // Faire correspondre la chaîne avec les segments
    const captures = {}
    let pos_chaine = 0

    for (let i = 0; i < segments.length; i++)
    {
        const seg = segments[i]

        if (seg.type === 'fixe')
        {
            if (!chaine.startsWith(seg.texte, pos_chaine)) return FAUX
            pos_chaine += seg.texte.length
        }
        else if (seg.type === 'capture')
        {
            const prochain_fixe = segments[i + 1]?.type === 'fixe' ? segments[i + 1].texte : null
            let valeur_capturee = ''

            while (pos_chaine < chaine.length)
            {
                const c = chaine[pos_chaine]

                // Arrêt sur le délimiteur suivant
                if (prochain_fixe && chaine.startsWith(prochain_fixe, pos_chaine)) break
                if (seg.delimiteur && c === seg.delimiteur && !prochain_fixe) break

                // Filtrage
                if (seg.mode === ':+' && seg.filtrage && !seg.filtrage.includes(c)) break
                if (seg.mode === ':-' && seg.filtrage &&  seg.filtrage.includes(c)) break

                valeur_capturee += c
                pos_chaine++
            }

            // Stocker la capture — liste si doublon
            if (seg.nom in captures)
            {
                if (!est_liste(captures[seg.nom]))
                    captures[seg.nom] = [captures[seg.nom]]
                captures[seg.nom].push(valeur_capturee)
            }
            else
            {
                captures[seg.nom] = valeur_capturee
            }
        }
    }

    // Vérifier que toute la chaîne a été consommée
    if (pos_chaine !== chaine.length) return FAUX

    // Écrire les variables capturées dans le runtime
    for (const [nom, valeur] of Object.entries(captures))
    {
        ecrire_variable(donnees?.scope, donnees?.args || {}, `$${nom}`, valeur)
    }

    return VRAI
}

// ============================================================
// Évaluateur
// ============================================================

const evaluer_noeud = (noeud, donnees) =>
{
    switch (noeud.type)
    {
    case 'valeur':
        if (est_texte(noeud.valeur))
            return valoriser(noeud.valeur, donnees)
        return noeud.valeur

    case 'erreur':
        return ERREUR

    case 'variable':
    {
        const lecture = lire_variable(donnees?.scope, donnees?.args || {}, noeud.valeur, true)
        return lecture.trouve ? lecture.valeur : ERREUR
    }

    case 'acces':
    {
        const cible = evaluer_noeud(noeud.cible, donnees)
        if (est_erreur(cible)) return ERREUR
        if (est_liste(cible))
        {
            const idx = parseInt(noeud.clef)
            if (isNaN(idx) || idx < 0 || idx >= cible.length) return ERREUR
            return cible[idx]
        }
        if (est_dict(cible))
        {
            if (!Object.prototype.hasOwnProperty.call(cible, noeud.clef)) return ERREUR
            return cible[noeud.clef]
        }
        return ERREUR
    }

    case 'op_binaire':
    {
        if (noeud.op === '~=')
        {
            const gauche = evaluer_noeud(noeud.gauche, donnees)

            // Regex : $champ ~= /pattern/flags
            if (noeud.droite.type === 'regex')
            {
                if (est_erreur(gauche)) return FAUX
                try
                {
                    const regex = new RegExp(noeud.droite.source, noeud.droite.flags)
                    return regex.test(String(gauche)) ? VRAI : FAUX
                }
                catch { return ERREUR }
            }

            // Pattern de capture : $champ ~= "<$var> ..."
            const brut = noeud.droite.type === 'valeur' ? noeud.droite.valeur : ERREUR
            if (est_erreur(brut)) return ERREUR
            return op_correspondance(gauche, brut, donnees)
        }

        const gauche = evaluer_noeud(noeud.gauche, donnees)

        if (noeud.op === ':+' || noeud.op === ':-')
        {
            const extraire_brut = (n) =>
            {
                if (n.type === 'valeur')   return n.valeur
                if (n.type === 'variable') return n.valeur
                return ERREUR
            }
            const brut = extraire_brut(noeud.droite)
            if (est_erreur(brut)) return ERREUR
            if (noeud.op === ':+') return op_inclure(gauche, brut, donnees)
            if (noeud.op === ':-') return op_exclure(gauche, brut, donnees)
        }

        const droite = evaluer_noeud(noeud.droite, donnees)
        const fn = OPERATEURS_BINAIRES[noeud.op]
        if (!fn) return ERREUR
        return fn(gauche, droite)
    }

    case 'op_court_circuit':
    {
        const gauche = evaluer_noeud(noeud.gauche, donnees)
        if (noeud.op === '&') return op_et(gauche, () => evaluer_noeud(noeud.droite, donnees))
        if (noeud.op === '|') return op_ou(gauche, () => evaluer_noeud(noeud.droite, donnees))
        return ERREUR
    }

    case 'op_unaire':
    {
        const operande = evaluer_noeud(noeud.operande, donnees)
        if (noeud.op === '!') return op_non(operande)
        return ERREUR
    }

    default:
        return ERREUR
    }
}

// ============================================================
// Export
// ============================================================

export const evaluer = (str, donnees) =>
{
    try
    {
        const tokens = tokeniser(str)
        const ast    = parser(tokens)
        const result = evaluer_noeud(ast, donnees)
        return est_booleen(result) ? result === VRAI : !est_erreur(result)
    }
    catch (e)
    {
        return false
    }
}
