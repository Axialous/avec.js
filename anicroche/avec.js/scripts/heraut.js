import { definir_variable_racine, initialiser_sculpteur } from './sculpteur.js'

export const initialiser_heraut = () =>
{
    initialiser_sculpteur()

    definir_variable_racine(`$create`, async (resource, genes) => {
        const reponse = await fetch(`http://localhost:5030/${resource}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        })
        return reponse.json()
    })

    definir_variable_racine(`$search`, async (resource, params) => {
        const url = new URL(`http://localhost:5030/${resource}`)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

        const reponse = await fetch(url)
        return reponse.json()
    })

    definir_variable_racine(`$update`, async (resource, genes, params) => {
        const url = new URL(`http://localhost:5030/${resource}`)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

        const reponse = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        })
        return reponse.json()
    })

    definir_variable_racine(`$delete`, async (resource, params) => {
        const url = new URL(`http://localhost:5030/${resource}`)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

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
