// Erreur levée quand l'application est verrouillée (mot de passe à saisir).
export class LockedError extends Error {
  constructor() {
    super('Application verrouillée.')
    this.locked = true
  }
}

export const LOCK_EVENT = 'organigramme:locked'

export function announceLocked() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCK_EVENT))
}
