// apps/web/src/app/lib/api-fetch.ts
// 
// Drop-in fetch wrapper used by all client components.
// Automatically appends X-DraftChess-CSRF: 1 to every request so individual
// call sites don't have to remember. Also sets Content-Type: application/json
// when a body is provided.
//
// Usage:
//   import { apiFetch } from "@/app/lib/api-fetch";
//   const res = await apiFetch(`/api/game/${gameId}/move`, {
//     method: "POST",
//     body: JSON.stringify({ from, to, promotion }),
//   });

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-draftchess-csrf", "1");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(input, { ...init, headers });
}
