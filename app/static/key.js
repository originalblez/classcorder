// Holds the Mistral API key. It is kept in memory and in sessionStorage (cleared when
// the tab closes), and saved long-term only in the browser's password manager.

const SESSION_KEY = 'mistral-api-key';
const CREDENTIAL_ID = 'mistral-api-key';

let key = null;

const session = {
  get() { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(SESSION_KEY, v); } catch {} },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} },
};

// Returns the key without asking the user, or null. In Chrome and Edge this can
// fetch the saved key from the password manager silently.
export async function loadKey() {
  key ??= session.get();
  if (!key && window.PasswordCredential) {
    try {
      const cred = await navigator.credentials.get({ password: true, mediation: 'silent' });
      if (cred?.id === CREDENTIAL_ID) key = cred.password;
    } catch {}
  }
  if (key) session.set(key);
  return key;
}

export async function saveKey(value) {
  key = value;
  session.set(value);
  // Chrome and Edge: store explicitly. Safari offers to save from the form submission instead.
  if (window.PasswordCredential) {
    try {
      await navigator.credentials.store(new PasswordCredential({ id: CREDENTIAL_ID, password: value, name: 'Mistral API key' }));
    } catch {}
  }
}

export function forgetKey() {
  key = null;
  session.clear();
  navigator.credentials?.preventSilentAccess?.().catch(() => {});
}
