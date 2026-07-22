import { env } from "@/lib/env";

/**
 * Custom typed fetch client wrapper for API requests.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${env.NEXT_PUBLIC_API_URL}${path}`;
  
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `API Client Error [${response.status}] ${response.statusText}: ${errorText}`
    );
  }

  return response.json() as Promise<T>;
}
