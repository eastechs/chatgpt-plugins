/**
 * Validates an API key by making a lightweight authenticated request to the provider.
 *
 * Returns true only on a successful (2xx) response. Failures, timeouts, and
 * connection errors all return false so an unverifiable key never gets saved.
 */

const TIMEOUT_MS = 10_000;

export type Provider = "anthropic" | "openai" | "gemini";

export async function validateApiKey(
  provider: Provider,
  key: string,
): Promise<boolean> {
  switch (provider) {
    case "anthropic":
      return validateAnthropic(key);
    case "openai":
      return validateOpenAi(key);
    case "gemini":
      return validateGemini(key);
  }
}

async function validateAnthropic(key: string): Promise<boolean> {
  return safeRequest("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });
}

async function validateOpenAi(key: string): Promise<boolean> {
  return safeRequest("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
}

async function validateGemini(key: string): Promise<boolean> {
  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models",
  );
  url.searchParams.set("key", key);
  return safeRequest(url.toString());
}

async function safeRequest(url: string, init?: RequestInit): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.ok;
  } catch {
    // Timeouts and connection errors both fail closed — refuse to save a key
    // we couldn't actually verify.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
