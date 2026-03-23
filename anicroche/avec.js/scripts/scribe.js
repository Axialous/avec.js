import {lire_variable} from "./sculpteur.js"

export const valoriser = (str, donnees) =>
{
    let valeur = str.replace(/(?<!\\)\$[a-zA-Z_][\w]*/g, (nom) => {
        const lecture = lire_variable(donnees?.scope, donnees?.args || {}, nom, true)
        if (lecture.trouve)
            return String(lecture.valeur).replace(/\\/g, "\\\\")
        else
            return nom
    }).replace(/\\(.)/g, "$1")
    return valeur
}
