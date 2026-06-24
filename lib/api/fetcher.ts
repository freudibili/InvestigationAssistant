/** Tiny typed fetch helper for the JSON route handlers. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore — fall back to the status message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
