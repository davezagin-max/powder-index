/**
 * Browser-side helper for calling this app's own API.
 * The key travels only in a request header to our own origin.
 */
import type { ApiResponse, ErrorKind } from "./api";

const KEY_HEADER = "x-anthropic-key";

const NETWORK_ERROR = {
  kind: "server" as ErrorKind,
  message: "Could not reach the server. Check your connection and try again.",
};

export async function callApi<D>(
  path: string,
  body: unknown,
  apiKey: string | null,
  signal?: AbortSignal,
): Promise<ApiResponse<D>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { [KEY_HEADER]: apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  try {
    return (await res.json()) as ApiResponse<D>;
  } catch {
    // Not our envelope: the function is missing or crashed before it could answer.
    return {
      ok: false,
      error: {
        kind: "server",
        message:
          res.status === 404
            ? "The Ask API is not running. Start it with `pnpm dev:api`."
            : `The server returned an unexpected response (HTTP ${res.status}).`,
      },
    };
  }
}
