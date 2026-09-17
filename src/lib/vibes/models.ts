/**
 * Enums and constants for the Vibes API client.
 *
 * Ported 1:1 from vibes_api/models.py — all values are taken directly
 * from the vibes.ai Next.js bundles.
 */

/** Supported aspect ratios for image / video generation.
 *
 * Only three ratios are actually supported by the server (verified live):
 * 1:1, 9:16, and 16:9. Other values will be rejected with
 * `GENERATION_FAILED`.
 */
export enum AspectRatio {
  SQUARE = "1:1", // 1280x1280 for images
  PORTRAIT = "9:16", // 720x1280 (default in UI)
  LANDSCAPE = "16:9", // 1280x720
}

/** Supported output resolutions (shown under "Advanced" in the UI). */
export enum Resolution {
  P480 = "480p",
  P720 = "720p",
}

/** Available video generation models.
 *
 * Selecting the right model is important — different generation types
 * require different models:
 * - `midjen-short`  → text-to-video (t2v) and image-to-video (i2v)
 * - `midjen-extend` → video extension (auto/manual extend)
 * - `midjen-video-edit` → video-to-video editing (v2v)
 * - `lipsync` family → lip-sync generation
 */
export enum VideoModel {
  SHORT = "midjen-short",
  EXTEND = "midjen-extend",
  VIDEO_EDIT = "midjen-video-edit",
  LIPSYNC = "lipsync",
  LIPSYNC_ASYNC = "midjen-lipsync-async",
  LIPSYNC_EXP = "midjen-lipsync-exp",
  LIPSYNC_DIRECT = "midjen-lipsync-direct",
}

/** Available image generation models. */
export enum ImageModel {
  BASE = "midjen-base",
}

/** LLM used for prompt enhancement / parsing. */
export enum PromptModel {
  GEMINI_FLASH = "gemini-2.5-flash",
}

/** Generation type discriminator (sent in the `config.generationType` field).
 *
 * The server uses this to route the request to the correct pipeline:
 * - `t2v`  → text-to-video
 * - `t2i`  → text-to-image
 * - `i2v`  → image-to-video (start frame uploaded or selected)
 * - `extend` → extend an existing video clip (auto or manual)
 * - `v2v`  → video-to-video editing
 * - `lipsync` → lip-sync generation
 */
export enum GenerationType {
  TEXT_TO_VIDEO = "t2v",
  TEXT_TO_IMAGE = "t2i",
  IMAGE_TO_VIDEO = "i2v",
  EXTEND = "extend",
  VIDEO_TO_VIDEO = "v2v",
  LIPSYNC = "lipsync",
}

/** Type of studio ingredient.
 *
 * The three types map to UI sections in the Ingredients panel:
 * Characters, Styles, Scenes (internally "SETTING").
 */
export enum IngredientType {
  CHARACTER = "CHARACTER",
  STYLE = "STYLE",
  SETTING = "SETTING", // "Scene" in the UI
}

/** Filter for /api/studio/ingredients. */
export enum OwnerFilter {
  LIBRARY = "LIBRARY",
  VIEWER = "VIEWER",
}

/** Built-in TTS voices (41 available — use listVoices() for the full list). */
export enum VoicePreset {
  MARISOL = "play_ai_Marisol",
  GEORGE_WASHINGTON = "play_ai_1P_George_Washington",
  ABRAHAM_LINCOLN = "play_ai_1P_Abraham_Lincoln",
  JANE_AUSTEN = "play_ai_1P_Jane_Austen",
  SERAPHINE = "play_ai_1P_Seraphine",
  CELESTE = "play_ai_Celeste",
  NIGEL = "play_ai_Nigel",
  CONOR = "play_ai_Conor",
}

/** Effect presets for text overlays on the timeline. */
export enum TextOverlayPreset {
  FADE = "fade",
  SLIDE_UP = "slide-up",
  SURROUND = "surround",
  STRANGE = "strange",
  FLASH = "flash",
  SLIDE = "slide",
  CINEFADE = "cinefade",
  GLOW = "glow",
  TYPEWRITER = "typewriter",
  HIGHLIGHT = "highlight",
  GLITCH = "glitch",
}

/** Position presets for text overlays on the timeline. */
export enum TextOverlayPosition {
  CENTER = "center",
  TOP = "top",
  BOTTOM = "bottom",
  LEFT = "left",
  RIGHT = "right",
  TOP_LEFT = "top-left",
  TOP_RIGHT = "top-right",
  BOTTOM_LEFT = "bottom-left",
  BOTTOM_RIGHT = "bottom-right",
}

/** Modes used by the /api/sync endpoint (server-sent events). */
export enum SyncMode {
  POLLING = "polling",
  SSE = "sse",
}

/** Entity types accepted by /api/share-links, /api/sync, /api/collaborators. */
export enum EntityType {
  PROJECT = "project",
  CONTENT_ITEM = "content-item",
}

// ---------------------------------------------------------------------------
//  Coercion helper
// ---------------------------------------------------------------------------

/** Coerce an enum or string to its string value.
 *
 * Mirrors the Python `_coerce()` helper — callers can pass either an enum
 * member or a plain string.
 */
export function coerce(v: string): string {
  return String(v);
}
