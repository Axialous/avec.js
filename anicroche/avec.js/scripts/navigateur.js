import { initialiser_sculpteur, definir_variable_racine } from './sculpteur.js'

const historique = []

export const initialiser_navigateur = () =>
{
    initialiser_sculpteur()

    definir_variable_racine(`$navigate_to`, (board) => {
        if (board === null || board === undefined)
            return

        const url = new URL(String(board), location.origin)

        if (url.origin !== location.origin)
        {
            location.href = url.href
            return
        }

        const nouvelle_url = url.pathname + url.search + url.hash
        const ancienne_url = location.pathname + location.search + location.hash

        if (nouvelle_url !== ancienne_url)
            history.pushState({}, '', nouvelle_url)
    })

    definir_variable_racine(`$navigate_prev`, () => {
        history.back()
    })

    definir_variable_racine(`$navigate_post`, () => {
        history.forward()
    })

    definir_variable_racine(`$history`, (age = 0) => {
        return historique.at(-(age + 1)) ?? null
    })

    document.addEventListener('click', (e) => {
        const cible = e.target
        const lien = cible.closest('a')

        if (!lien)
            return

        e.target.blur()

        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)
            return
        if (lien.hash && lien.pathname === location.pathname)
            return
        if (lien.target === '_blank')
            return
        if (lien.hasAttribute('download'))
            return
        if (lien.href.startsWith('mailto:'))
            return
        if (lien.href.startsWith('tel:'))
            return
        if (lien.origin !== location.origin)
            return

        e.preventDefault()

        const nouvelle_url = lien.pathname + lien.search + lien.hash
        const ancienne_url = location.pathname + location.search + location.hash

        if (nouvelle_url !== ancienne_url)
        {
            history.pushState({}, '', nouvelle_url)
        }
    })

    window.addEventListener('popstate', () => {
        naviguer(location.href)
    })

    const push = history.pushState
    history.pushState = function (...args)
    {
        push.apply(this, args)
        naviguer(location.href)
    }

    const replace = history.replaceState
    history.replaceState = function (...args)
    {
        replace.apply(this, args)
        naviguer(location.href)
    }

    naviguer(location.href)
}

const naviguer = (bord) =>
{
    const lien = new URL(bord, location.origin)

    historique.push(lien.pathname + lien.search + lien.hash)

    initialiser_sculpteur()

    definir_variable_racine(`$path`, lien.pathname)
    definir_variable_racine(`$params`, Object.fromEntries(lien.searchParams))
    definir_variable_racine(`$hash`, lien.hash)

    console.log(`Navigation vers ${bord}`)
}
