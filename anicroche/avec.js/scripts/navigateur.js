import { initialiser_sculpteur, etat_sculpteur } from './sculpteur.js'

export const initialiser_navigateur = () =>
{
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

    initialiser_sculpteur()

    etat_sculpteur.instance.$path   = lien.pathname
    etat_sculpteur.instance.$params = Object.fromEntries(lien.searchParams)
    etat_sculpteur.instance.$hash   = lien.hash

    console.log(`Navigation vers ${bord}`)
}
