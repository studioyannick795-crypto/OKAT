/**
 * Vibes AI — Unofficial TypeScript API Client for vibes.ai
 *
 * Ported 1:1 from the Python `VibesAI-api` package (v1.5.1).
 *
 * Supports:
 *   - Project management (list / create / get / update / delete / duplicate)
 *   - Text-to-video generation (midjen-short, 9:16/16:9/1:1, 480p/720p)
 *   - Text-to-image generation (midjen-base, multiple aspect ratios)
 *   - Video extend (auto + manual) — extend a video by ~5 seconds
 *   - Video-to-video editing (v2v) — re-render with a directive
 *   - Image-to-video animate (auto + manual) — animate a still image
 *   - Batch regeneration — re-roll with same or new prompt
 *   - Start/end frame support (image-to-video with keyframes)
 *   - Ingredients (characters, styles, scenes)
 *   - Moodboards — apply style references
 *   - Image editing (prompt-driven)
 *   - Prompt enhancement (returns 4 AI-rewritten variations)
 *   - Lip sync / animation generation
 *   - Text-to-speech (TTS) with 41 preset voices
 *   - Media library (list / favorite / delete / download)
 *   - Generation batch polling & SSE streaming
 *   - Share links
 *   - Timeline chat (streaming AI assistant)
 *   - Music / audio clip extraction
 *   - Direct file uploads (image / video / audio / profile picture)
 *   - Timeline export to MP4 (sync + async SurfGuard)
 *   - Real-time sync (SSE for collaborative editing)
 *   - Account settings, quota, bug reports, etc.
 *
 * Authentication: cookie-based. Provide your `meta_session` cookie value
 * (obtained from your browser after logging in at https://vibes.ai).
 *
 * @example
 * ```ts
 * import { VibesClient, AspectRatio, Resolution } from "@/lib/vibes";
 *
 * const client = new VibesClient({ metaSession: "e60e910a-...-K54E" });
 * const project = await client.createProject({ name: "My Video" });
 * const batch = await client.generateVideo({
 *   projectId: project.id,
 *   prompt: "A serene mountain landscape at sunset",
 *   aspectRatio: AspectRatio.LANDSCAPE,
 *   resolution: Resolution.P720,
 *   variations: 4,
 * });
 * ```
 */

export { VibesClient, VibesAPIError } from "./client";
export type { VibesClientOptions } from "./client";

export * from "./models";
export {
  IngredientRef,
  CreateIngredient,
  buildIngredientPayload,
} from "./ingredients";
export {
  Composition,
  type CompositionData,
  type CompositionTrack,
  type CompositionClip,
  type CompositionSummary,
} from "./composition";
