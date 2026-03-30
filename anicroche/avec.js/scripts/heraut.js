import { definir_variable_racine, initialiser_sculpteur } from './sculpteur.js'

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

export const initialiser_heraut = async () =>
{
    initialiser_sculpteur()

    const adn = await charger_adn_app()
    const api_url = adn?.api_url || `http://localhost:5030`

    const construire_url_api = (resource, params) =>
    {
        const base = api_url.endsWith(`/`) ? api_url : `${api_url}/`
        const url = new URL(String(resource), base)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

        return url
    }

    definir_variable_racine(`$create`, async (resource, genes) => {
        const url = construire_url_api(resource)
        const reponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        })
        return reponse.json()
    })

    definir_variable_racine(`$search`, async (resource, params) => {
        const url = construire_url_api(resource, params)

        const reponse = await fetch(url)
        return reponse.json()
    })

    definir_variable_racine(`$update`, async (resource, genes, params) => {
        const url = construire_url_api(resource, params)

        const reponse = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        })
        return reponse.json()
    })

    definir_variable_racine(`$delete`, async (resource, params) => {
        const url = construire_url_api(resource, params)

        const reponse = await fetch(url, { method: 'DELETE' })
        return reponse.json()
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
