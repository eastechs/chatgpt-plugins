import { safeStorage } from "electron";

// REPLACE: shape this to your app's settings. Every key needs a default
// in DEFAULTS below.
interface SettingsSchema {
  autosave: boolean;
  notifications: boolean;
  onboardingCompleted: boolean;
  apiKeys: {
    anthropic?: string;
    openai?: string;
    gemini?: string;
  };
}

const DEFAULTS: SettingsSchema = {
  autosave: true,
  notifications: true,
  onboardingCompleted: false,
  apiKeys: {},
};

type StoreLike = {
  get: <K extends keyof SettingsSchema>(key: K) => SettingsSchema[K];
  set: <K extends keyof SettingsSchema>(
    key: K,
    value: SettingsSchema[K],
  ) => void;
};

let _store: StoreLike | null = null;
let _storePromise: Promise<StoreLike> | null = null;

export async function initSettings(): Promise<void> {
  if (_store) return;
  if (_storePromise) {
    await _storePromise;
    return;
  }

  _storePromise = (async () => {
    // Dynamic import — electron-store is ESM-only
    const { default: Store } = await import("electron-store");
    _store = new Store<SettingsSchema>({
      // REPLACE: rename to `<your-app>-settings`
      name: "myapp-settings",
      defaults: DEFAULTS,
    }) as unknown as StoreLike;
    return _store;
  })();

  await _storePromise;
}

function store(): StoreLike {
  if (!_store) {
    throw new Error("Settings not initialized. Call initSettings() first.");
  }
  return _store;
}

// ─── Generic settings ──────────────────────────────────────

export function getSetting<K extends keyof SettingsSchema>(
  key: K,
): SettingsSchema[K] {
  return store().get(key);
}

export function setSetting<K extends keyof SettingsSchema>(
  key: K,
  value: SettingsSchema[K],
): void {
  store().set(key, value);
}

// ─── Encrypted API keys ────────────────────────────────────

// REPLACE: narrow this union to your providers.
type Provider = "anthropic" | "openai" | "gemini";

export function isApiKeyEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getApiKey(provider: Provider): string | undefined {
  const encrypted = store().get("apiKeys")[provider];
  if (!encrypted) return undefined;

  try {
    const buffer = Buffer.from(encrypted, "base64");
    return safeStorage.decryptString(buffer);
  } catch {
    return undefined;
  }
}

export function setApiKey(provider: Provider, key: string): void {
  // Without an OS-level keyring, safeStorage on Linux falls back to writing a
  // "v10"-prefixed plaintext buffer. Refuse rather than persist a key that
  // would land on disk effectively unencrypted.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS keychain encryption is not available; refusing to store API key.",
    );
  }
  const encrypted = safeStorage.encryptString(key).toString("base64");
  const keys = store().get("apiKeys");
  keys[provider] = encrypted;
  store().set("apiKeys", keys);
}

export function deleteApiKey(provider: Provider): void {
  const keys = store().get("apiKeys");
  delete keys[provider];
  store().set("apiKeys", keys);
}

export function getConfiguredProviders(): Record<Provider, boolean> {
  const keys = store().get("apiKeys");
  return {
    anthropic: !!keys.anthropic,
    openai: !!keys.openai,
    gemini: !!keys.gemini,
  };
}
