/**
 * Service Worker pour Anicroche
 * Gère le caching et le mode hors-ligne
 */

const VERSION = 'v1'
const CACHE_ASSETS = `${VERSION}-assets`
const CACHE_API = `${VERSION}-api`

const ASSETS_A_CACHER = [
    '/',
    '/systeme/scripts/architecte.js',
    '/systeme/scripts/navigateur.js',
    '/systeme/scripts/heraut.js',
    '/systeme/scripts/batisseur.js',
    '/systeme/scripts/augure.js',
    '/systeme/scripts/decorateur.js',
    '/systeme/scripts/sculpteur.js',
    '/systeme/scripts/scribe.js',
    '/systeme/images/favicon.svg',
    '/systeme/images/favicon.ico',
    '/systeme/app.webmanifest'
]

/**
 * Installation du Service Worker
 * Pré-cache les assets essentiels
 */
self.addEventListener('install', event => {
    console.log(`[SW] Installation (${VERSION})`)
    
    event.waitUntil(
        caches.open(CACHE_ASSETS)
            .then(cache => {
                console.log(`[SW] Caching ${ASSETS_A_CACHER.length} assets`)
                return cache.addAll(ASSETS_A_CACHER)
            })
            .then(() => self.skipWaiting())
            .catch(err => console.error('[SW] Installation échouée:', err))
    )
})

/**
 * Activation du Service Worker
 * Nettoie les anciens caches
 */
self.addEventListener('activate', event => {
    console.log('[SW] Activation')
    
    event.waitUntil(
        caches.keys().then(names => {
            return Promise.all(
                names
                    .filter(name => {
                        const isOld = name !== CACHE_ASSETS && name !== CACHE_API
                        if (isOld) console.log(`[SW] Suppression du cache: ${name}`)
                        return isOld
                    })
                    .map(name => caches.delete(name))
            )
        }).then(() => {
            console.log('[SW] Prise de contrôle des clients')
            return self.clients.claim()
        })
    )
})

/**
 * Stratégie de fetch
 * - API: network-first (réseau d'abord, cache en fallback)
 * - Assets: cache-first (cache d'abord, réseau en fallback)
 */
self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)

    // Ignorer les requêtes non-GET
    if (request.method !== 'GET') {
        return
    }

    // API calls: network-first strategy
    if (url.pathname.startsWith('/api')) {
        return event.respondWith(
            fetch(request)
                .then(response => {
                    // Sauvegarder la réponse en cache
                    if (response.ok) {
                        const clonedResponse = response.clone()
                        caches.open(CACHE_API).then(cache => {
                            cache.put(request, clonedResponse)
                        })
                    }
                    return response
                })
                .catch(() => {
                    // Fallback sur le cache si le réseau échoue
                    return caches.match(request)
                        .then(response => response || new Response('Offline', { status: 503 }))
                })
        )
    }

    // Static assets: cache-first strategy
    event.respondWith(
        caches.match(request)
            .then(response => {
                if (response) {
                    return response
                }
                return fetch(request)
                    .then(response => {
                        // Cacher les réponses réussies
                        if (response.ok && request.method === 'GET') {
                            const clonedResponse = response.clone()
                            caches.open(CACHE_ASSETS).then(cache => {
                                cache.put(request, clonedResponse)
                            })
                        }
                        return response
                    })
            })
            .catch(() => {
                // Page de fallback si offline et pas en cache
                return caches.match('/')
            })
    )
})
