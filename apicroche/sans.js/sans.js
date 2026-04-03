import http from "http"
import path from "path"
import fs   from "fs"

import {generer_adn}      from "./analyseur_adn.js"
import {charger_modeles}  from "./analyseur_sans.js"
import {construire_base}  from "./scripts/batisseur.js"
import {construire_routes} from "./scripts/routeur.js"
import { demarrer_taches_periodiques } from "./scripts/planificateur.js"

console.log(`\
╔══════╗
║ SANS ║
╚══════╝`)

const adn     = generer_adn()
const schemas = charger_modeles("adn/modeles")

const afficher_schemas = ({ tables, relations }) =>
{
    const pad = (str, n) => str + ' '.repeat(Math.max(0, n - str.length))

    const formater_type = (champ) =>
    {
        const { type, min, max } = champ
        if (min === null && max === null)
            return type
        if (min === max)
            return `${type}(${min})`
        return `${type}(${min}, ${max})`
    }

    console.log(`\nSchéma — ${tables.length} table(s), ${relations.length} relation(s)\n`)

    for (const table of tables)
    {
        const titre = table.entry_name
            ? `TABLE ${table.name}  (entrée : ${table.entry_name})`
            : `TABLE ${table.name}`
        console.log(titre)

        if (table.primary.length > 0)
            console.log(`  Clef primaire : ${table.primary.join(', ')}`)

        if (table.unique.length > 0)
        {
            for (const contrainte of table.unique)
                console.log(`  Contrainte unique : [ ${contrainte.join(', ')} ]`)
        }

        if (table.fields.length > 0)
        {
            console.log('  Champs :')
            const largeur_nom  = Math.max(...table.fields.map(f => f.nullable ? f.name.length + 2 : f.name.length))
            const largeur_type = Math.max(...table.fields.map(f => formater_type(f).length))

            for (const champ of table.fields)
            {
                const nom_affiche = champ.nullable ? `(${champ.name})` : champ.name
                let ligne = `    ${pad(nom_affiche, largeur_nom)}  ${pad(formater_type(champ), largeur_type)}`
                if (champ.treatment)
                    ligne += `  → ${champ.treatment}`
                if (champ.values)
                    ligne += `  [ ${champ.values.join(' | ')} ]`
                console.log(ligne)
            }
        }
        console.log('')
    }

    if (relations.length > 0)
    {
        console.log('Relations :')
        for (const rel of relations)
        {
            let ligne = `  ${rel.table_source}.${rel.champ_source} → ${rel.table_cible}  [${rel.count}]`
            if (rel.cle_etrangere)
                ligne += `  (FK : ${rel.cle_etrangere})`
            if (rel.table_jonction)
                ligne += `  (jonction : ${rel.table_jonction})`
            console.log(ligne)
        }
        console.log('')
    }
}

afficher_schemas(schemas)

await construire_base(schemas)

const taches_periodiques = demarrer_taches_periodiques(schemas)

const routes = construire_routes(schemas, schemas.index)

const types_mime = {
    ".json":  "application/json",
    ".txt":   "text/plain",
    ".pdf":   "application/pdf",

    ".ico":   "image/x-icon",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".jpeg":  "image/jpeg",
    ".svg":   "image/svg+xml",

    ".mp3":   "audio/mpeg",
    ".mp4":   "video/mp4",

    ".ttf":   "font/ttf",
    ".otf":   "font/otf",
    ".woff":  "font/woff",
    ".woff2": "font/woff2"
}

const types_utf8 = [
    ".json",
    ".txt"
]

const composants = {
    "/depot": {
        chemin: "depot",
        recursif: true
    },
    "/systeme/images": {
        chemin: "adn/images",
        recursif: true
    },
    "/systeme/fontes": {
        chemin: "adn/fontes",
        recursif: true
    }
}

const mode = process.env.mode || "prod"
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
        rep.setHeader("Access-Control-Allow-Origin", origine)

    rep.setHeader("Access-Control-Allow-Credentials", "true")
    rep.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
    rep.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
    rep.setHeader("Vary", "Origin")
}

const rechercher_fichier = (dossier, nom, recursif) =>
{
    const fichiers = fs.readdirSync(dossier, {withFileTypes: true})

    for (const fichier of fichiers)
    {
        const chemin_complet = path.join(dossier, fichier.name)
        if (fichier.isFile() && fichier.name === nom)
            return (chemin_complet)
        if (fichier.isDirectory() && recursif)
        {
            const trouve = rechercher_fichier(chemin_complet, nom, recursif)
            if (trouve)
                return trouve
        }
    }
    return (false)
}

const repondre_json = (rep, statut, message, data) =>
{
    const succes = statut >= 200 && statut < 300
    const reponse = {
        code: statut,
        [succes ? 'message' : 'error']: message,
        data: data !== undefined ? data : {}
    }
    rep.writeHead(statut, {"Content-Type": "application/json; charset=utf-8"})
    rep.end(JSON.stringify(reponse))
}

const est_reponse_deja = (erreur) =>
    erreur && typeof erreur === 'object' && erreur.message === 'reponse_deja_envoyee'

const serveur = http.createServer(async (req, rep) =>
    {
        const url     = req.url.split('?')[0]
        const methode = req.method.toUpperCase()

        appliquer_cors(req, rep)

        if (methode === "OPTIONS")
        {
            rep.writeHead(204)
            rep.end()
            return
        }

        // Routes des modèles
        for (const route of routes)
        {
            if (route.methode === methode && route.chemin === url)
            {
                try
                {
                    await route.handler(req, rep)
                }
                catch (erreur)
                {
                    if (est_reponse_deja(erreur))
                        return

                    throw erreur
                }
                return
            }
        }

        for (const prefixe in composants)
        {
            if (req.url.startsWith(`${prefixe}/`))
            {
                const infos = composants[prefixe]
                const chemin = path.join("./", `${infos.chemin}${req.url.slice(prefixe.length)}`)
                const dossier = path.dirname(chemin)
                const fichier = path.basename(chemin)
                const chemin_reel = rechercher_fichier(dossier, fichier, infos.recursif)

                if (chemin_reel)
                {
                    const ext = path.extname(fichier).toLowerCase()
                    let contenu
                    if (types_utf8.includes(ext))
                        contenu = fs.readFileSync(chemin_reel, "utf-8")
                    else
                        contenu = fs.readFileSync(chemin_reel)
                    let type = types_mime[ext] || "application/octet-stream"
                    if (types_utf8.includes(ext))
                        type += "; charset=utf-8"
                    rep.writeHead(200, {"Content-Type": type})
                    rep.end(contenu)
                }
                else
                {
                    repondre_json(rep, 404, "Fichier introuvable")
                }
                return
            }
        }

        const mode_dev = (process.env.mode || 'prod') === 'dev'
        if (url === '/' && mode_dev)
        {
            const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf-8')
            rep.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})
            rep.end(html)
            return
        }

        repondre_json(rep, 200, `Bienvenue sur l'API ${adn.nom || "sans.js"}`)
    }
)

serveur.listen(adn.port, () =>
    {
        console.log(`Serveur en route sur le port ${adn.port}`)
    }
)
