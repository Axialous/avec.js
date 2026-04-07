console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

import {initialiser_navigateur} from './navigateur.js'
import {initialiser_heraut} from './heraut.js'
import {initialiser_batisseur} from './batisseur.js'

/**
 * Enregistrement du Service Worker
 * Permet le caching et le mode hors-ligne
 */
const enregistrer_service_worker = async () => {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/systeme/scripts/service-worker.js')
            console.log('✓ Service Worker enregistré')
            
            // Écouter les mises à jour disponibles
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated') {
                        console.log('✓ Service Worker mis à jour')
                    }
                })
            })
        } catch (err) {
            console.error('✗ Enregistrement Service Worker échoué:', err)
        }
    }
}

const initialiser = async () => {
    await enregistrer_service_worker()
    initialiser_navigateur()
    await initialiser_heraut()
    initialiser_batisseur()
}

document.addEventListener("DOMContentLoaded", initialiser)
