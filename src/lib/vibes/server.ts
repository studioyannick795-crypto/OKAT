/**
 * Server-side singleton for the VibesClient.
 *
 * Reads the `meta_session` cookie from the `VIBES_META_SESSION` env var.
 * In Next.js API routes (App Router), import `getVibesClient()` to get the
 * shared client instance.
 *
 * NOTE: This file MUST only be imported from server contexts (API routes,
 * server components, server actions). Never import it into client code —
 * it contains the cookie secret.
 */

import { VibesClient } from "./client";

let _client: VibesClient | null = null;

/** Get the shared VibesClient instance (server-side only). */
export function getVibesClient(): VibesClient {
  if (_client) return _client;

  const metaSession = process.env.VIBES_META_SESSION;
  if (!metaSession) {
    throw new Error(
      "VIBES_META_SESSION environment variable is not set. " +
        "Set it to your vibes.ai meta_session cookie value " +
        "(DevTools → Application → Cookies → vibes.ai).",
    );
  }

  _client = new VibesClient({
    metaSession,
    autoRefresh: true,
  });
  return _client;
}

/** Check if the cookie is configured (without throwing). */
export function hasVibesCookie(): boolean {
  return Boolean(process.env.VIBES_META_SESSION);
}
