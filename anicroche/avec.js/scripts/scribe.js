import {lire_variable} from "./sculpteur.js"

const est_debut_identifiant = (caractere) => /[A-Za-z_]/.test(caractere)
const est_suite_identifiant = (caractere) => /[\w]/.test(caractere)

const resoudre_clef = (brut, donnees) =>
{
    if (!brut) return { trouve: false }

    if ((brut[0] === '"' || brut[0] === "'" || brut[0] === '`') && brut[brut.length - 1] === brut[0])
    {
        return { trouve: true, valeur: brut.slice(1, -1) }
    }

    if (brut[0] === '$')
    {
        const scope = donnees && donnees.scope
        const args = donnees && donnees.args ? donnees.args : {}
        const lecture = lire_variable(scope, args, brut, true)
        return lecture.trouve ? { trouve: true, valeur: lecture.valeur } : { trouve: false }
    }

    const nombre = Number(brut.replace(/_/g, ''))
    if (!Number.isNaN(nombre))
        return { trouve: true, valeur: nombre }

    return { trouve: true, valeur: brut }
}

const resoudre_acces = (valeur, clef_brute, donnees) =>
{
    const clef = resoudre_clef(clef_brute, donnees)
    if (!clef.trouve) return { trouve: false }

    // Accès par index sur les chaînes (supporte bien les caractères Unicode)
    if (typeof valeur === 'string')
    {
        const chars = Array.from(valeur)
        const index = parseInt(clef.valeur)
        if (!Number.isNaN(index) && index >= 0 && index < chars.length)
            return { trouve: true, valeur: chars[index] }
        return { trouve: false }
    }

    if (Array.isArray(valeur))
    {
        const index = parseInt(clef.valeur)
        if (isNaN(index) || index < 0 || index >= valeur.length) return { trouve: false }
        return { trouve: true, valeur: valeur[index] }
    }

    if (valeur !== null && typeof valeur === 'object')
    {
        if (!Object.prototype.hasOwnProperty.call(valeur, clef.valeur)) return { trouve: false }
        return { trouve: true, valeur: valeur[clef.valeur] }
    }

    return { trouve: false }
}

const lire_interpolation = (str, depart, donnees) =>
{
    const debut = depart
    let pos = depart

    if (str[pos] !== '$' || pos + 1 >= str.length || !est_debut_identifiant(str[pos + 1]))
        return { trouve: false }

    pos++
    let nom = '$'
    while (pos < str.length && est_suite_identifiant(str[pos])) { nom += str[pos]; pos++ }

    const scope = donnees && donnees.scope
    const args = donnees && donnees.args ? donnees.args : {}
    const lecture = lire_variable(scope, args, nom, true)
    if (!lecture.trouve)
        return { trouve: true, fin: pos, valeur: str.slice(debut, pos) }

    let valeur = lecture.valeur

    while (pos < str.length)
    {
        if (str[pos] === '.' && pos + 1 < str.length && est_debut_identifiant(str[pos + 1]))
        {
            pos++
            let clef = ''
            while (pos < str.length && est_suite_identifiant(str[pos])) { clef += str[pos]; pos++ }

            const resolution = resoudre_acces(valeur, clef, donnees)
            if (!resolution.trouve)
                return { trouve: true, fin: pos, valeur: str.slice(debut, pos) }

            valeur = resolution.valeur
            continue
        }

        if (str[pos] === '[')
        {
            pos++
            let brut = ''

            if (pos < str.length && (str[pos] === '"' || str[pos] === "'" || str[pos] === '`'))
            {
                const guillemet = str[pos]
                brut += guillemet
                pos++

                while (pos < str.length)
                {
                    const caractere = str[pos]
                    brut += caractere
                    pos++

                    if (caractere === '\\' && pos < str.length)
                    {
                        brut += str[pos]
                        pos++
                        continue
                    }

                    if (caractere === guillemet)
                        break
                }
            }
            else
            {
                while (pos < str.length && str[pos] !== ']')
                {
                    brut += str[pos]
                    pos++
                }
            }

            if (pos >= str.length || str[pos] !== ']')
                return { trouve: true, fin: pos, valeur: str.slice(debut, pos) }

            pos++
            const resolution = resoudre_acces(valeur, brut.trim(), donnees)
            if (!resolution.trouve)
                return { trouve: true, fin: pos, valeur: str.slice(debut, pos) }

            valeur = resolution.valeur
            continue
        }

        break
    }

    return { trouve: true, fin: pos, valeur: String(valeur) }
}

export const valoriser = (str, donnees) =>
{
    let result = ''
    let pos = 0

    while (pos < str.length)
    {
        if (str[pos] === '\\')
        {
            result += str[pos]
            pos++
            if (pos < str.length)
            {
                result += str[pos]
                pos++
            }
            continue
        }

        if (str[pos] === '$' && pos + 1 < str.length && est_debut_identifiant(str[pos + 1]))
        {
            const interpolation = lire_interpolation(str, pos, donnees)
            if (interpolation.trouve)
            {
                result += String(interpolation.valeur).replace(/\\/g, "\\\\")
                pos = interpolation.fin
                continue
            }
        }

        result += str[pos]
        pos++
    }

    return result.replace(/\\(.)/g, "$1")
}
