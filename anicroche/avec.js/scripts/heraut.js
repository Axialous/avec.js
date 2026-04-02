import { definir_variable_racine, initialiser_sculpteur, enregistrer_nettoyage } from './sculpteur.js'

const charger_adn_app = async () =>
{
    try
    {
        const reponse = await fetch(`/systeme/app.adn`, {
            headers: {
                'X-AC-Composant': `true`
            }
        })

        if (!reponse.ok)
            throw new Error(`Echec du chargement de app.adn (statut : ${reponse.status})`)

        const adn = await reponse.json()
        definir_variable_racine(`$app`, adn)

        if (adn && typeof adn === 'object' && !Array.isArray(adn))
            Object.entries(adn).forEach(([cle, valeur]) => definir_variable_racine(`$${cle}`, valeur))

        console.log(`Configuration app.adn chargée avec succès`)
        return adn
    }
    catch (erreur)
    {
        console.error(erreur)
        definir_variable_racine(`$app`, {})
        return null
    }
}

const _actions = {
    prior_requested: [],
    post_requested: []
}

const executer_actions_http = async (cas, option, contexte = undefined) =>
{
    const actions = _actions[cas]
    if (!Array.isArray(actions) || actions.length === 0)
        return option

    for (const action of [...actions])
    {
        const retour = await action(option, contexte)
        if (retour && typeof retour === 'object' && !Array.isArray(retour))
            Object.assign(option, retour)
    }

    return option
}

export const initialiser_heraut = async () =>
{
    initialiser_sculpteur()

    definir_variable_racine(`$add_action`, (cas, fn) =>
    {
        if (!Array.isArray(_actions[cas]))
            throw new Error(`Cas d'action invalide : ${cas}`)
        if (typeof fn !== 'function')
            throw new Error(`Action invalide pour ${cas}`)

        _actions[cas].push(fn)

        const nettoyage = () =>
        {
            const actions = _actions[cas]
            const index = actions.indexOf(fn)
            if (index !== -1)
                actions.splice(index, 1)
        }

        enregistrer_nettoyage(nettoyage)
        return nettoyage
    })

    const adn = await charger_adn_app()
    const api_url = adn?.api_url || `http://localhost:5030`

    const construire_url_api = (resource, params) =>
    {
        let base = api_url.endsWith(`/`) ? api_url : `${api_url}/`
        
        // Remplacer localhost par le hostname de la page actuelle
        if (base.includes('localhost')) {
            base = base.replace('localhost', window.location.hostname)
        }
        
        const url = new URL(String(resource), base)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

        return url
    }

    definir_variable_racine(`$create`, async (resource, genes) => {
        const url = construire_url_api(resource)
        const options = {
            url,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    definir_variable_racine(`$search`, async (resource, params) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'GET',
            headers: {},
            body: undefined
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    definir_variable_racine(`$update`, async (resource, genes, params) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    definir_variable_racine(`$delete`, async (resource, params) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'DELETE',
            headers: {},
            body: undefined
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })
}

export const charger_modele = async (nom, connus = []) =>
{
    try
    {
        const reponse = await fetch(`/systeme/modeles/${nom}.avec`, {
            headers: {
                'X-AC-Composant': `true`,
                'X-AC-Connus': connus.join(',')
            }
        })
        if (!reponse.ok)
        {
            throw new Error(`Echec du chargement du modèle « ${nom} » (statut : ${reponse.status})`)
        }
        const modele = await reponse.json()
        console.log(`Modèle « ${nom} » chargé avec succès`)
        return modele
    }
    catch (erreur)
    {
        console.error(erreur)
        return null
    }
}
