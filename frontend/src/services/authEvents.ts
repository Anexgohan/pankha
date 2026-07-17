// Tiny pub/sub bridging transport-level auth failures (REST 401, WebSocket
// close 4401) to the AuthContext without circular imports.

type AuthRequiredListener = () => void;
const listeners = new Set<AuthRequiredListener>();

export function subscribeAuthRequired(listener: AuthRequiredListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAuthRequired(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('Error in authRequired listener:', error);
    }
  }
}
