/**
 * VibesClient — main API client implementation.
 *
 * Ported 1:1 from vibes_api/client.py.
 *
 * This is an unofficial TypeScript client for the vibes.ai API. It supports:
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
 */

import {
  AspectRatio,
  ImageModel,
  IngredientType,
  OwnerFilter,
  PromptModel,
  Resolution,
  VideoModel,
  coerce,
} from "./models";
import { buildIngredientPayload } from "./ingredients";
import type { CompositionData } from "./composition";

const BASE_URL = "https://vibes.ai";
const DEFAULT_TIMEOUT = 60;
const POLL_INTERVAL = 3.0;
const POLL_TIMEOUT = 180.0;

// ---------------------------------------------------------------------------
//  UUID v7 generator (for batch IDs)
// ---------------------------------------------------------------------------

/**
 * Generate a UUID v7 (timestamp-ordered) for batch IDs.
 *
 * The vibes.ai server expects batch IDs to follow the UUID v7 format
 * because it extracts the creation timestamp from the high 48 bits.
 *
 * Format (RFC 9562):
 *   bits 0-47:  unix_ts_ms (48 bits, big-endian)
 *   bits 48-51: version = 0x7
 *   bits 52-63: rand_a (12 bits)
 *   bits 64-65: variant = 0b10
 *   bits 66-127: rand_b (62 bits)
 */
function uuidV7(): string {
  // Timestamp (48 bits, big-endian) — high 48 bits
  const ms = Date.now();
  // Use crypto for good randomness (works in Node 19+ and all modern browsers)
  const rand = typeof crypto !== "undefined" && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(10)) // 80 bits of randomness (we need 74)
    : Uint8Array.from({ length: 10 }, () => Math.floor(Math.random() * 256));

  const bytes = new Uint8Array(16);
  const dv = new DataView(bytes.buffer);

  // Bytes 0-5: unix_ts_ms (48 bits big-endian)
  // ms is a 48-bit value; extract high 32 and low 16
  dv.setUint32(0, Math.floor(ms / 0x10000)); // upper 32 of 48 bits
  dv.setUint16(4, ms & 0xffff); // lower 16 bits

  // Bytes 6-7: version(0x7) in high nibble + 12 bits of rand_a
  // Use rand[0] and rand[1] for the 16-bit field: high nibble = 0x7, rest = rand
  const randA = ((rand[0] << 8) | rand[1]) & 0x0fff; // 12 bits
  dv.setUint16(6, (0x7 << 12) | randA);

  // Byte 8: variant (0b10) in high 2 bits + 6 bits of rand_b
  dv.setUint8(8, (0b10 << 6) | (rand[2] & 0x3f));

  // Bytes 9-15: remaining 56 bits of rand_b
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  // Format as UUID string: xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function msNow(): number {
  return Date.now();
}

function randomHex(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

// ---------------------------------------------------------------------------
//  Error class
// ---------------------------------------------------------------------------

/** Raised when the vibes.ai API returns an error. */
export class VibesAPIError extends Error {
  status?: number;
  code?: string;
  response?: unknown;

  constructor(
    message: string,
    opts?: { status?: number; code?: string; response?: unknown },
  ) {
    super(message);
    this.name = "VibesAPIError";
    this.status = opts?.status;
    this.code = opts?.code;
    this.response = opts?.response;
  }

  toString(): string {
    const bits = [super.toString()];
    if (this.code) bits.push(`code=${this.code}`);
    if (this.status) bits.push(`status=${this.status}`);
    return bits.join(" | ");
  }
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface VibesClientOptions {
  metaSession: string;
  cookieAck?: boolean;
  baseUrl?: string;
  timeout?: number;
  autoRefresh?: boolean;
}

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
//  VibesClient
// ---------------------------------------------------------------------------

export class VibesClient {
  baseUrl: string;
  timeout: number;
  autoRefresh: boolean;
  private metaSession: string;
  private cookieAck: boolean;
  private sessionExpired = false;

  constructor(opts: VibesClientOptions) {
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, "");
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.autoRefresh = opts.autoRefresh ?? true;
    this.metaSession = opts.metaSession;
    this.cookieAck = opts.cookieAck ?? true;
  }

  // ---- Cookie management ----

  /** Update the session cookie at runtime. */
  updateCookie(metaSession: string): void {
    this.metaSession = metaSession;
    this.sessionExpired = false;
  }

  getCurrentCookie(): string {
    return this.metaSession;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const h = new Headers({
      Cookie: `meta_session=${this.metaSession}${this.cookieAck ? ";cookie_ack=true" : ""}`,
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
    });
    if (extra) {
      const eh = new Headers(extra);
      for (const [k, v] of eh.entries()) h.set(k, v);
    }
    return h;
  }

  // ---- Low-level HTTP helpers ----

  private url(path: string): string {
    if (path.startsWith("http")) return path;
    if (!path.startsWith("/")) path = "/" + path;
    return `${this.baseUrl}${path}`;
  }

  private async check(resp: Response): Promise<any> {
    // Intercept Set-Cookie for auto-refresh (Node fetch doesn't expose it
    // as a header; we use getSetCookie() if available)
    if (this.autoRefresh) {
      try {
        const setCookies = (resp as any).headers?.getSetCookie?.() ??
          (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie")!] : []);
        for (const sc of setCookies) {
          for (const part of sc.split(";")) {
            const p = part.trim();
            if (p.startsWith("meta_session=")) {
              const newVal = p.slice("meta_session=".length);
              if (newVal && newVal !== this.metaSession) {
                this.metaSession = newVal;
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    let data: any;
    const text = await resp.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      const err = typeof data === "object" && data ? data.error : undefined;
      let msg: string;
      let code: string | undefined;
      if (typeof err === "object" && err) {
        msg = err.detail ?? err.title ?? err.message ?? "API error";
        code = err.code;
      } else if (typeof err === "string") {
        msg = err;
      } else {
        msg = `HTTP ${resp.status}`;
      }
      throw new VibesAPIError(`${msg} | response=${JSON.stringify(data).slice(0, 500)}`, {
        status: resp.status,
        code,
        response: data,
      });
    }
    return data;
  }

  private async request(
    method: string,
    path: string,
    opts?: {
      params?: Record<string, string | number | undefined | null>;
      json?: unknown;
      body?: BodyInit;
      headers?: HeadersInit;
      timeoutMs?: number;
    },
  ): Promise<any> {
    let url = this.url(path);
    if (opts?.params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== null) sp.set(k, String(v));
      }
      const qs = sp.toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }

    const controller = new AbortController();
    const timeoutMs = opts?.timeoutMs ?? this.timeout * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = this.buildHeaders(opts?.headers);
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (opts?.json !== undefined) {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(opts.json);
      } else if (opts?.body !== undefined) {
        init.body = opts.body;
      }
      const resp = await fetch(url, init);
      return await this.check(resp);
    } finally {
      clearTimeout(timer);
    }
  }

  async _get(
    path: string,
    params?: Record<string, string | number | undefined | null>,
    timeoutMs?: number,
  ): Promise<any> {
    try {
      return await this.request("GET", path, { params, timeoutMs });
    } catch (e) {
      if (e instanceof VibesAPIError && e.status === 401 && !this.sessionExpired) {
        this.sessionExpired = true;
        // No auto-relogin in this port; just raise
        this.sessionExpired = false;
      }
      throw e;
    }
  }

  async _post(path: string, jsonBody?: unknown, timeoutMs?: number): Promise<any> {
    return this.request("POST", path, { json: jsonBody, timeoutMs });
  }

  async _put(path: string, jsonBody?: unknown): Promise<any> {
    return this.request("PUT", path, { json: jsonBody });
  }

  async _delete(path: string): Promise<any> {
    return this.request("DELETE", path);
  }

  async _patch(path: string, jsonBody?: unknown): Promise<any> {
    return this.request("PATCH", path, { json: jsonBody });
  }

  /** POST with retry on transient 500 errors.
   *
   * vibes.ai's write endpoints (upload-image, upload-asset, etc.)
   * occasionally return 500s due to internal rate limiting or DB
   * contention. This helper retries up to 3 times with exponential
   * backoff before giving up.
   */
  async _postWithRetry(
    path: string,
    jsonBody?: unknown,
    maxRetries = 3,
  ): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._post(path, jsonBody);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof VibesAPIError) || e.status !== 500) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  // ------------------------------------------------------------------ //
  //  Auth & system
  // ------------------------------------------------------------------ //

  /** Return the authenticated user profile. */
  async getMe(): Promise<any> {
    return (await this._get("/api/auth/me")).user ?? {};
  }

  /** Return current system status banner (or null). */
  async getSystemStatus(): Promise<any> {
    return (await this._get("/api/system-status")).status ?? null;
  }

  /** Invalidate the current session server-side. */
  async logout(): Promise<void> {
    await this._post("/api/auth/logout");
  }

  /** Check if the current session token is valid. */
  async checkToken(): Promise<boolean> {
    try {
      await this._get("/api/auth/check-token");
      return true;
    } catch (e) {
      if (e instanceof VibesAPIError && e.status === 401) return false;
      throw e;
    }
  }

  // ------------------------------------------------------------------ //
  //  Projects
  // ------------------------------------------------------------------ //

  /** List projects in your workspace. */
  async listProjects(opts?: {
    limit?: number;
    offset?: number;
    sort?: string;
    search?: string;
    maxRetries?: number;
  }): Promise<any> {
    const params: Record<string, string | number | undefined> = {
      limit: opts?.limit ?? 25,
      offset: opts?.offset ?? 0,
      sort: opts?.sort ?? "newest",
    };
    if (opts?.search) params.search = opts.search;

    const maxRetries = opts?.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._get("/api/projects", params);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof VibesAPIError) || e.status !== 500) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  /** Fetch a single project (including composition/timeline). */
  async getProject(projectId: string): Promise<any> {
    return (await this._get(`/api/projects/${projectId}`)).project ?? {};
  }

  /** Create a new project. Returns the project dict. */
  async createProject(opts?: { name?: string; composition?: any }): Promise<any> {
    const composition = opts?.composition ?? { id: "studio-composition", tracks: [], duration: 5 };
    const body = { name: opts?.name ?? "Untitled", composition };
    return (await this._post("/api/projects", body)).project ?? {};
  }

  /** Update project name and/or composition (timeline state). */
  async updateProject(
    projectId: string,
    opts: { name?: string; composition?: any },
  ): Promise<any> {
    const body: Json = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.composition !== undefined) body.composition = opts.composition;
    return (await this._put(`/api/projects/${projectId}`, body)).project ?? {};
  }

  /** Delete a project. */
  async deleteProject(projectId: string, deleteAssets = false): Promise<void> {
    let path = `/api/projects/${projectId}`;
    if (deleteAssets) path += "?deleteAssets=true";
    await this._delete(path);
  }

  /** Duplicate a project (returns the new project). */
  async duplicateProject(projectId: string): Promise<any> {
    return (await this._post(`/api/projects/${projectId}/duplicate`)).project ?? {};
  }

  /** Shortcut for `updateProject(composition=composition)`. */
  async saveComposition(projectId: string, composition: any): Promise<any> {
    return this.updateProject(projectId, { composition });
  }

  // ------------------------------------------------------------------ //
  //  Batches (the core generation primitive)
  // ------------------------------------------------------------------ //

  /** List generation batches. */
  async listBatches(opts?: {
    limit?: number;
    offset?: number;
    projectId?: string;
    type?: string;
    maxRetries?: number;
  }): Promise<any> {
    const params: Record<string, string | number | undefined> = {
      limit: opts?.limit ?? 12,
      offset: opts?.offset ?? 0,
    };
    if (opts?.projectId) params.projectId = opts.projectId;
    if (opts?.type) params.type = opts.type;

    const maxRetries = opts?.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._get("/api/generation-batches", params);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof VibesAPIError) || e.status !== 500) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  /** List batches inside a specific project. */
  async listProjectBatches(projectId: string, limit = 6, offset = 0): Promise<any> {
    return this._get(`/api/projects/${projectId}/batches`, { limit, offset });
  }

  /** Fetch full batch state including all content items. */
  async getBatch(batchId: string): Promise<any> {
    return (await this._get(`/api/generation-batches/${batchId}`)).batch ?? {};
  }

  /** Delete a batch. */
  async deleteBatch(batchId: string): Promise<void> {
    await this._delete(`/api/generation-batches/${batchId}`);
  }

  /** Update a batch (PUT). */
  async updateBatch(batchId: string, updates: any): Promise<any> {
    return this._put(`/api/generation-batches/${batchId}`, updates);
  }

  /** Internal helper: create a generation batch and return its ID.
   *
   * Retries up to 3 times on transient 500 errors — vibes.ai's
   * /api/generation-batches endpoint occasionally returns a 500 right
   * after a previous batch was created (race condition in their DB).
   */
  private async createBatch(opts: {
    batchType: string; // "videos" or "images"
    prompt: string;
    projectId: string;
    config: any;
    count: number;
    batchId?: string;
  }): Promise<string> {
    const batchId = opts.batchId ?? `batch-${uuidV7()}`;
    const contentItemType = opts.batchType === "videos" ? "video" : "image";
    const content: any[] = [];
    for (let i = 0; i < opts.count; i++) {
      content.push({
        id: `${batchId}-content-${i}`,
        type: contentItemType,
        isLoading: true,
      });
    }
    const body = {
      id: batchId,
      type: opts.batchType,
      prompt: opts.prompt,
      timestamp: msNow(),
      isComplete: false,
      config: opts.config,
      projectId: opts.projectId,
      content,
    };
    const maxRetries = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this._post("/api/generation-batches", body);
        return batchId;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof VibesAPIError) || e.status !== 500) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  // ------------------------------------------------------------------ //
  //  VIDEO generation
  // ------------------------------------------------------------------ //

  /** Generate one or more video variations from a text prompt. */
  async generateVideo(opts: {
    projectId: string;
    prompt: string;
    aspectRatio?: string;
    resolution?: string;
    variations?: number;
    videoModel?: string;
    imageModel?: string;
    promptModel?: string;
    ingredients?: Record<string, unknown>[];
    createIngredients?: Record<string, unknown>[];
    startFrame?: Record<string, unknown>;
    endFrame?: Record<string, unknown>;
    moodboard?: Record<string, unknown>;
    poll?: boolean;
    pollInterval?: number;
    pollTimeout?: number;
  }): Promise<any> {
    const aspectRatio = coerce(opts.aspectRatio ?? AspectRatio.PORTRAIT);
    const resolution = coerce(opts.resolution ?? Resolution.P480);
    const videoModel = coerce(opts.videoModel ?? VideoModel.SHORT);
    const imageModel = coerce(opts.imageModel ?? ImageModel.BASE);
    const promptModel = coerce(opts.promptModel ?? PromptModel.GEMINI_FLASH);

    const ingPayload = buildIngredientPayload({
      ingredients: opts.ingredients,
      createIngredients: opts.createIngredients,
    });

    const genType = opts.startFrame ? "i2v" : "t2v";

    const config: any = {
      videoModel,
      imageModel,
      promptModel,
      resolution,
      aspectRatio,
      batchVariation: (opts.variations ?? 4) > 1,
      generationType: genType,
      directGeneration: true,
      ...ingPayload,
    };

    if (opts.startFrame) {
      config.directPromptImageHandle = opts.startFrame;
    }

    if (opts.endFrame) {
      const ef = opts.endFrame;
      if (ef.oil_handle) config.lastFrameOilHandle = ef.oil_handle;
      if (ef.image_url) config.lastFrameImageUrl = ef.image_url;
      if (ef.image_ent_id) config.lastFrameImageEntId = ef.image_ent_id;
    }

    if (opts.moodboard) {
      const mb = opts.moodboard;
      if (mb.moodboardCode) config.moodboardCode = mb.moodboardCode;
      if (mb.moodboardId) config.moodboardId = mb.moodboardId;
      if (mb.moodboard_name) config.moodboard_name = mb.moodboard_name;
      if (mb.moodboard_thumbnail_url) config.moodboard_thumbnail_url = mb.moodboard_thumbnail_url;
    }

    // 1) Create the batch
    const batchId = await this.createBatch({
      batchType: "videos",
      prompt: opts.prompt,
      projectId: opts.projectId,
      config,
      count: opts.variations ?? 4,
    });
    await sleep(1000); // let DB row settle

    // 2) Build inputs
    const inputConfig: any = {
      videoModel,
      imageModel,
      promptModel,
      resolution,
      aspectRatio,
      generationType: genType,
      ...ingPayload,
    };
    if (opts.startFrame) inputConfig.directPromptImageHandle = opts.startFrame;
    if (opts.endFrame) {
      const ef = opts.endFrame;
      if (ef.oil_handle) inputConfig.lastFrameOilHandle = ef.oil_handle;
      if (ef.image_url) inputConfig.lastFrameImageUrl = ef.image_url;
      if (ef.image_ent_id) inputConfig.lastFrameImageEntId = ef.image_ent_id;
    }
    if (opts.moodboard) {
      const mb = opts.moodboard;
      if (mb.moodboardCode) inputConfig.moodboardCode = mb.moodboardCode;
      if (mb.moodboardId) inputConfig.moodboardId = mb.moodboardId;
      if (mb.moodboard_name) inputConfig.moodboard_name = mb.moodboard_name;
      if (mb.moodboard_thumbnail_url) inputConfig.moodboard_thumbnail_url = mb.moodboard_thumbnail_url;
    }

    const inputs: any[] = [];
    for (let i = 0; i < (opts.variations ?? 4); i++) {
      inputs.push({
        type: "prompt",
        value: opts.prompt,
        original_prompt: opts.prompt,
        config: inputConfig,
      });
    }

    // 3) Trigger generation
    const genResp = await this._post("/api/generate/videos", {
      batchId,
      inputs,
      config,
    });

    if (opts.poll === false) return genResp;
    return this.pollBatch(batchId, {
      interval: opts.pollInterval ?? POLL_INTERVAL,
      timeout: opts.pollTimeout ?? POLL_TIMEOUT,
    });
  }

  /** Block until a batch completes (or times out). */
  async pollBatch(
    batchId: string,
    opts?: { interval?: number; timeout?: number; maxRetries?: number },
  ): Promise<any> {
    const interval = opts?.interval ?? POLL_INTERVAL;
    const timeout = opts?.timeout ?? POLL_TIMEOUT;
    const maxRetries = opts?.maxRetries ?? 3;
    const deadline = Date.now() + timeout * 1000;
    let consecutiveErrors = 0;

    while (Date.now() < deadline) {
      try {
        const batch = await this.getBatch(batchId);
        consecutiveErrors = 0;
        if (batch.isComplete || batch.hasError) return batch;
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors > maxRetries) throw e;
        await sleep(Math.min(2000, interval * 1000));
      }
      await sleep(interval * 1000);
    }
    throw new Error(`Batch ${batchId} did not complete within ${timeout}s`);
  }

  // ------------------------------------------------------------------ //
  //  IMAGE generation
  // ------------------------------------------------------------------ //

  /** Generate one or more images from a text prompt (synchronous). */
  async generateImage(opts: {
    projectId: string;
    prompt: string;
    aspectRatio?: string;
    resolution?: string;
    variations?: number;
    imageModel?: string;
    promptModel?: string;
    ingredients?: Record<string, unknown>[];
    createIngredients?: Record<string, unknown>[];
    moodboard?: Record<string, unknown>;
  }): Promise<any> {
    const aspectRatio = coerce(opts.aspectRatio ?? AspectRatio.SQUARE);
    const resolution = coerce(opts.resolution ?? Resolution.P480);
    const imageModel = coerce(opts.imageModel ?? ImageModel.BASE);
    const promptModel = coerce(opts.promptModel ?? PromptModel.GEMINI_FLASH);

    const ingPayload = buildIngredientPayload({
      ingredients: opts.ingredients,
      createIngredients: opts.createIngredients,
    });

    const config: any = {
      imageModel,
      promptModel,
      resolution,
      aspectRatio,
      batchVariation: (opts.variations ?? 1) > 1,
      generationType: "t2i",
      directGeneration: true,
      ...ingPayload,
    };
    if (opts.moodboard) {
      const mb = opts.moodboard;
      if (mb.moodboardCode) config.moodboardCode = mb.moodboardCode;
      if (mb.moodboardId) config.moodboardId = mb.moodboardId;
      if (mb.moodboard_name) config.moodboard_name = mb.moodboard_name;
      if (mb.moodboard_thumbnail_url) config.moodboard_thumbnail_url = mb.moodboard_thumbnail_url;
    }

    const batchId = await this.createBatch({
      batchType: "images",
      prompt: opts.prompt,
      projectId: opts.projectId,
      config,
      count: opts.variations ?? 1,
    });
    // CRITICAL: sleep to let the server-side DB row settle.
    // Without this, the subsequent /api/generate/images call races with
    // the batch creation and fails with "batch not found" or a 500.
    // (matches generateVideo's behavior + the Python client)
    await sleep(1000);

    const inputConfig: any = {
      imageModel,
      promptModel,
      resolution,
      aspectRatio,
      generationType: "t2i",
      ...ingPayload,
    };
    if (opts.moodboard) {
      const mb = opts.moodboard;
      if (mb.moodboardCode) inputConfig.moodboardCode = mb.moodboardCode;
      if (mb.moodboardId) inputConfig.moodboardId = mb.moodboardId;
      if (mb.moodboard_name) inputConfig.moodboard_name = mb.moodboard_name;
      if (mb.moodboard_thumbnail_url) inputConfig.moodboard_thumbnail_url = mb.moodboard_thumbnail_url;
    }

    const inputs: any[] = [];
    for (let i = 0; i < (opts.variations ?? 1); i++) {
      inputs.push({
        type: "variation",
        image_prompt: opts.prompt,
        original_prompt: opts.prompt,
        config: inputConfig,
      });
    }

    // Retry the generate call — vibes.ai's /api/generate/images endpoint
    // occasionally returns transient 500s right after batch creation
    // (same race condition as listProjects / listBatches).
    const maxRetries = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._post("/api/generate/images", { batchId, inputs, config });
      } catch (e) {
        lastErr = e;
        if (!(e instanceof VibesAPIError) || e.status !== 500) throw e;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  // ------------------------------------------------------------------ //
  //  IMAGE EDITING
  // ------------------------------------------------------------------ //

  /** Edit an existing image with a text prompt.
   *
   * Retries up to 3 times on transient errors:
   *   - HTTP 500 (server transient errors)
   *   - "This content could not be generated" (vibes.ai's generation failure
   *     — often succeeds on retry after a short delay)
   */
  async editImage(opts: {
    sourceImageEntId: string;
    editPrompt: string;
    projectId?: string;
  }): Promise<any> {
    const body: Json = {
      sourceImageEntId: opts.sourceImageEntId,
      editPrompt: opts.editPrompt,
    };
    if (opts.projectId) body.projectId = opts.projectId;

    const maxRetries = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._post("/api/generate/image-edit", body);
        // Check for vibes.ai's "content could not be generated" error in the
        // response body — it returns HTTP 200 with success:false
        if (result?.success === false || result?.error) {
          const errMsg = typeof result.error === "string"
            ? result.error
            : result.error?.message || "";
          if (errMsg.includes("could not be generated") || errMsg.includes("try a different prompt")) {
            // This is a transient generation failure — retry with a delay
            if (attempt < maxRetries) {
              await sleep(2000 * (attempt + 1)); // 2s, 4s, 6s
              continue;
            }
          }
          throw new VibesAPIError(
            typeof result.error === "string" ? result.error : JSON.stringify(result.error),
            { status: 422, response: result },
          );
        }
        return result;
      } catch (e) {
        lastErr = e;
        if (e instanceof VibesAPIError) {
          // Retry on 500 (transient server errors)
          if (e.status === 500 && attempt < maxRetries) {
            await sleep(1000 * (attempt + 1));
            continue;
          }
          // Retry on "could not be generated" (generation failure)
          if (e.message?.includes("could not be generated") && attempt < maxRetries) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
        }
        throw e;
      }
    }
    throw lastErr;
  }

  // ------------------------------------------------------------------ //
  //  VIDEO EXTEND (auto + manual)
  // ------------------------------------------------------------------ //

  /** Extend a video clip by ~5 seconds (auto or manual). */
  async extendVideo(opts: {
    projectId: string;
    sourceVideo: any;
    prompt?: string;
    poll?: boolean;
    pollInterval?: number;
    pollTimeout?: number;
  }): Promise<any> {
    const sourceVideo = opts.sourceVideo;
    const originalPrompt =
      sourceVideo.prompt ?? sourceVideo.videoPrompt ?? sourceVideo.imagePrompt ?? "";
    if (!originalPrompt) {
      throw new VibesAPIError(
        "Original prompt not available for extend. Pass the full content item dict from getBatch().",
      );
    }

    let structured = sourceVideo.structuredOutput ?? {};
    if (typeof structured === "string") {
      try {
        structured = JSON.parse(structured);
      } catch {
        structured = {};
      }
    }

    const sourceConfig = sourceVideo.config ?? {};
    const sourceVideoHandle =
      sourceVideo.videoHandle ?? structured.sourceVideoHandle ?? sourceConfig.sourceVideoHandle;
    const videoGenEntId = VibesClient.extractVideoGenEntId(sourceVideo);
    const sourceVideoUrl =
      sourceVideo.videoUrl ?? structured.sourceVideoUrl ?? sourceConfig.sourceVideoUrl;

    if (!sourceVideoHandle && !videoGenEntId) {
      throw new VibesAPIError(
        "Video handle or entity ID is required for extend. Use a video with a valid reference.",
      );
    }

    const extConfig: any = {
      ...structured,
      ...sourceConfig,
      videoModel: "midjen-extend",
      imageModel: sourceConfig.imageModel ?? "midjen-base",
      generationType: "extend",
      directGeneration: true,
      sourceContentItemIds: [{ id: sourceVideo.id, source: "extend_video" }],
    };
    if (extConfig.videoModel === "midjen-short" || extConfig.videoModel === "midjen-video-edit") {
      extConfig.videoModel = "midjen-extend";
    }

    if (sourceVideoHandle) extConfig.sourceVideoHandle = sourceVideoHandle;
    if (sourceVideoUrl && !extConfig.sourceVideoUrl) extConfig.sourceVideoUrl = sourceVideoUrl;

    const audioEntId =
      extConfig.audioSourceEntId ??
      structured.audioSourceEntId ??
      sourceConfig.audioSourceEntId;
    if (audioEntId) extConfig.audioSourceEntId = audioEntId;

    if (opts.prompt) extConfig.extendDirective = opts.prompt;

    const batchId = `extend-${Date.now()}-${randomHex(8)}`;
    const batchBody = {
      id: batchId,
      type: "videos",
      prompt: opts.prompt ?? originalPrompt,
      timestamp: msNow(),
      content: [],
      isComplete: false,
      config: extConfig,
      promptModel: extConfig.promptModel,
      imageModel: extConfig.imageModel,
      videoModel: extConfig.videoModel,
      generationStartTime: msNow(),
      isDirectGeneration: true,
      projectId: opts.projectId,
    };
    await this._post("/api/generation-batches", batchBody);
    await sleep(1000);

    const inputConfig = { ...extConfig };
    const inputs: any[] = [
      {
        type: "extend",
        mediaEntId: videoGenEntId,
        videoUrl: sourceVideoUrl,
        prompt: opts.prompt ?? originalPrompt,
        ...(opts.prompt ? { extendDirective: opts.prompt } : {}),
        config: inputConfig,
      },
    ];

    const genResp = await this._post("/api/generate/videos", {
      batchId,
      inputs,
      config: extConfig,
    });

    if (opts.poll === false) return genResp;
    return this.pollBatch(batchId, {
      interval: opts.pollInterval ?? POLL_INTERVAL,
      timeout: opts.pollTimeout ?? POLL_TIMEOUT,
    });
  }

  /** Shortcut for `extendVideo(prompt=undefined)` — the "Auto extend" button. */
  autoExtendVideo(opts: {
    projectId: string;
    sourceVideo: any;
    poll?: boolean;
  }): Promise<any> {
    return this.extendVideo({ ...opts, prompt: undefined });
  }

  /** Shortcut for `extendVideo(prompt=prompt)` — the "Manual extend" button. */
  manualExtendVideo(opts: {
    projectId: string;
    sourceVideo: any;
    prompt: string;
    poll?: boolean;
  }): Promise<any> {
    return this.extendVideo(opts);
  }

  // ------------------------------------------------------------------ //
  //  VIDEO-TO-VIDEO EDITING (v2v)
  // ------------------------------------------------------------------ //

  /** Edit an existing video with a text prompt (video-to-video). */
  async editVideo(opts: {
    projectId: string;
    sourceVideo: any;
    prompt: string;
    poll?: boolean;
    pollInterval?: number;
    pollTimeout?: number;
  }): Promise<any> {
    const sourceVideo = opts.sourceVideo;
    const originalPrompt =
      sourceVideo.prompt ?? sourceVideo.videoPrompt ?? sourceVideo.imagePrompt ?? "";
    if (!originalPrompt) {
      throw new VibesAPIError("No prompt available for video-to-video editing.");
    }

    let structured = sourceVideo.structuredOutput ?? {};
    if (typeof structured === "string") {
      try {
        structured = JSON.parse(structured);
      } catch {
        structured = {};
      }
    }

    const sourceConfig = sourceVideo.config ?? {};
    const sourceVideoHandle =
      sourceVideo.videoHandle ?? structured.sourceVideoHandle ?? sourceConfig.sourceVideoHandle;
    const videoGenEntId = VibesClient.extractVideoGenEntId(sourceVideo);
    const sourceVideoUrl =
      sourceVideo.videoUrl ?? structured.sourceVideoUrl ?? sourceConfig.sourceVideoUrl;

    if (!sourceVideoHandle && !videoGenEntId) {
      throw new VibesAPIError(
        "This video cannot be edited because it is missing required metadata (videoHandle or videoGenEntId).",
      );
    }

    const v2vConfig: any = {
      ...structured,
      ...sourceConfig,
      videoModel: "midjen-video-edit",
      imageModel: sourceConfig.imageModel ?? "midjen-base",
      editType: "v2v",
      generationType: "v2v",
      directGeneration: true,
      sourceContentItemIds: [{ id: sourceVideo.id, source: "v2v" }],
    };
    // v2v doesn't support end frame / loop
    for (const k of ["endFrameUrl", "endFrameHandle", "lastFrameOilHandle", "loop"]) {
      delete v2vConfig[k];
    }

    if (sourceVideoHandle) v2vConfig.sourceVideoHandle = sourceVideoHandle;
    if (sourceVideoUrl) v2vConfig.sourceVideoUrl = sourceVideoUrl;

    const startHandleOil =
      sourceConfig.directPromptImageHandle?.oil_handle ??
      sourceVideo.imageHandle ??
      structured.directPromptImageHandle?.oil_handle;
    if (startHandleOil) {
      v2vConfig.directPromptImageHandle = {
        oil_handle: startHandleOil,
        image_url:
          sourceVideo.imageUrl ??
          structured.directPromptImageHandle?.image_url ??
          "",
      };
    }

    const batchId = `video2video-${Date.now()}-${randomHex(8)}`;
    const batchBody = {
      id: batchId,
      type: "videos",
      prompt: opts.prompt,
      timestamp: msNow(),
      content: [],
      isComplete: false,
      config: v2vConfig,
      promptModel: v2vConfig.promptModel,
      imageModel: v2vConfig.imageModel,
      videoModel: v2vConfig.videoModel,
      generationStartTime: msNow(),
      isDirectGeneration: true,
      projectId: opts.projectId,
    };
    await this._post("/api/generation-batches", batchBody);
    await sleep(1000);

    const inputConfig = { ...v2vConfig };
    const inputs: any[] = [
      {
        type: "video",
        mediaEntId: videoGenEntId,
        videoUrl: sourceVideoUrl,
        prompt: opts.prompt,
        config: inputConfig,
      },
    ];

    const genResp = await this._post("/api/generate/videos", {
      batchId,
      inputs,
      config: v2vConfig,
    });

    if (opts.poll === false) return genResp;
    return this.pollBatch(batchId, {
      interval: opts.pollInterval ?? POLL_INTERVAL,
      timeout: opts.pollTimeout ?? POLL_TIMEOUT,
    });
  }

  // ------------------------------------------------------------------ //
  //  IMAGE-TO-VIDEO ANIMATE
  // ------------------------------------------------------------------ //

  /** Animate an existing image into a video (i2v). */
  async animateImage(opts: {
    projectId: string;
    sourceImage: any;
    prompt?: string;
    poll?: boolean;
    pollInterval?: number;
    pollTimeout?: number;
  }): Promise<any> {
    const sourceImage = opts.sourceImage;
    const originalPrompt =
      sourceImage.prompt ?? sourceImage.imagePrompt ?? sourceImage.videoPrompt ?? "";
    if (!originalPrompt) {
      throw new VibesAPIError("No prompt available for this image.");
    }

    let structured = sourceImage.structuredOutput ?? {};
    if (typeof structured === "string") {
      try {
        structured = JSON.parse(structured);
      } catch {
        structured = {};
      }
    }

    const sourceConfig = sourceImage.config ?? {};
    const imageHandleOil =
      sourceConfig.directPromptImageHandle?.oil_handle ??
      sourceImage.imageHandle ??
      structured.directPromptImageHandle?.oil_handle;
    const imageUrl =
      sourceImage.imageUrl ?? structured.directPromptImageHandle?.image_url;
    const imageEntId = VibesClient.extractImageEntId(sourceImage);

    if (!imageHandleOil && !imageEntId) {
      throw new VibesAPIError(
        "Image handle or entity ID is required for animate. Use an image with a valid reference.",
      );
    }

    const i2vConfig: any = {
      ...structured,
      ...sourceConfig,
      videoModel: "midjen-short",
      imageModel: sourceConfig.imageModel ?? "midjen-base",
      generationType: "i2v",
      directGeneration: true,
      sourceContentItemIds: [{ id: sourceImage.id, source: "i2v" }],
    };
    if (imageHandleOil) {
      i2vConfig.directPromptImageHandle = {
        oil_handle: imageHandleOil,
        image_url: imageUrl ?? "",
      };
    }
    if (opts.prompt) i2vConfig.animateDirective = opts.prompt;

    const batchId = `image2video-${Date.now()}-${randomHex(8)}`;
    const batchBody = {
      id: batchId,
      type: "videos",
      prompt: opts.prompt ?? originalPrompt,
      timestamp: msNow(),
      content: [],
      isComplete: false,
      config: i2vConfig,
      promptModel: i2vConfig.promptModel,
      imageModel: i2vConfig.imageModel,
      videoModel: i2vConfig.videoModel,
      generationStartTime: msNow(),
      isDirectGeneration: true,
      projectId: opts.projectId,
    };
    await this._post("/api/generation-batches", batchBody);
    await sleep(1000);

    const inputConfig = { ...i2vConfig };
    const inputs: any[] = [
      {
        type: "image",
        imageUrl,
        imageEntId,
        prompt: opts.prompt ?? originalPrompt,
        ...(opts.prompt ? { animateDirective: opts.prompt } : {}),
        config: inputConfig,
      },
    ];

    const genResp = await this._post("/api/generate/videos", {
      batchId,
      inputs,
      config: i2vConfig,
    });

    if (opts.poll === false) return genResp;
    return this.pollBatch(batchId, {
      interval: opts.pollInterval ?? POLL_INTERVAL,
      timeout: opts.pollTimeout ?? POLL_TIMEOUT,
    });
  }

  /** Shortcut for `animateImage(prompt=undefined)` — the "Auto animate" button. */
  autoAnimateImage(opts: { projectId: string; sourceImage: any; poll?: boolean }): Promise<any> {
    return this.animateImage({ ...opts, prompt: undefined });
  }

  /** Shortcut for `animateImage(prompt=prompt)` — the "Manual animate" button. */
  manualAnimateImage(opts: {
    projectId: string;
    sourceImage: any;
    prompt: string;
    poll?: boolean;
  }): Promise<any> {
    return this.animateImage(opts);
  }

  // ------------------------------------------------------------------ //
  //  REGENERATE BATCH (re-roll)
  // ------------------------------------------------------------------ //

  /** Regenerate a batch (re-roll with the same or new prompt). */
  async regenerateBatch(opts: {
    projectId: string;
    batchId: string;
    prompt?: string;
    poll?: boolean;
    pollInterval?: number;
    pollTimeout?: number;
  }): Promise<any> {
    const sourceBatch = await this.getBatch(opts.batchId);
    if (!sourceBatch) throw new VibesAPIError(`Batch ${opts.batchId} not found`);

    const sourcePrompt = opts.prompt ?? sourceBatch.prompt ?? "";
    const sourceConfig = sourceBatch.config ?? {};
    const batchType = sourceBatch.type ?? "videos";

    const cleanConfig: any = { ...sourceConfig };
    delete cleanConfig.sourceContentItemIds;
    delete cleanConfig.generationEndTime;
    cleanConfig.directGeneration = true;

    let genType = cleanConfig.generationType ?? "t2v";
    if (batchType === "images") genType = "t2i";

    const newBatchId = `batch-${uuidV7()}`;
    const newBatchBody = {
      id: newBatchId,
      type: batchType,
      prompt: sourcePrompt,
      timestamp: msNow(),
      content: [],
      isComplete: false,
      config: cleanConfig,
      promptModel: cleanConfig.promptModel,
      imageModel: cleanConfig.imageModel,
      videoModel: cleanConfig.videoModel,
      generationStartTime: msNow(),
      isDirectGeneration: true,
      projectId: opts.projectId,
    };
    await this._post("/api/generation-batches", newBatchBody);
    await sleep(1000);

    let inputs: any[];
    let endpoint: string;
    if (batchType === "videos") {
      inputs = [
        {
          type: "prompt",
          value: sourcePrompt,
          original_prompt: sourcePrompt,
          config: cleanConfig,
        },
      ];
      endpoint = "/api/generate/videos";
    } else {
      inputs = [
        {
          type: "variation",
          image_prompt: sourcePrompt,
          original_prompt: sourcePrompt,
          config: cleanConfig,
        },
      ];
      endpoint = "/api/generate/images";
    }

    const genResp = await this._post(endpoint, {
      batchId: newBatchId,
      inputs,
      config: cleanConfig,
    });

    if (opts.poll === false) return genResp;
    return this.pollBatch(newBatchId, {
      interval: opts.pollInterval ?? POLL_INTERVAL,
      timeout: opts.pollTimeout ?? POLL_TIMEOUT,
    });
  }

  // ------------------------------------------------------------------ //
  //  Helpers for extracting entity IDs from content items
  // ------------------------------------------------------------------ //

  /** Extract `videoGenEntId` from a content item. */
  static extractVideoGenEntId(contentItem: any): string | undefined {
    let data = contentItem.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (data && typeof data === "object") {
      return data.videoGenEntId ?? data.videoEntId;
    }
    return undefined;
  }

  /** Extract `imageEntId` from a content item. */
  static extractImageEntId(contentItem: any): string | undefined {
    let data = contentItem.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = {};
      }
    }
    if (data && typeof data === "object") {
      return data.imageEntId ?? data.image_ent_id;
    }
    return undefined;
  }

  /** Build a frame handle dict from an `uploadImage()` response. */
  static buildFrameHandle(uploadResponse: any, source = "upload"): Record<string, unknown> {
    return {
      oil_handle: uploadResponse.oilHandle ?? uploadResponse.mediaEntId,
      image_url: uploadResponse.imageUrl,
      image_ent_id: uploadResponse.mediaEntId,
      source,
    };
  }

  // ------------------------------------------------------------------ //
  //  PROMPT ENHANCEMENT
  // ------------------------------------------------------------------ //

  /** Generate 4 AI-enhanced prompt variations from a short seed. */
  async enhancePrompt(opts: {
    prompt: string;
    projectId?: string;
    batchType?: string;
    imageModel?: string;
    videoModel?: string;
    promptModel?: string;
    resolution?: string;
    aspectRatio?: string;
    systemPrompt?: string;
  }): Promise<any[]> {
    const imageModel = coerce(opts.imageModel ?? ImageModel.BASE);
    const videoModel = coerce(opts.videoModel ?? VideoModel.SHORT);
    const promptModel = coerce(opts.promptModel ?? PromptModel.GEMINI_FLASH);
    const resolution = coerce(opts.resolution ?? Resolution.P480);
    const aspectRatio = coerce(opts.aspectRatio ?? AspectRatio.PORTRAIT);

    const config = {
      imageModel,
      videoModel,
      promptModel,
      resolution,
      aspectRatio,
      generationType: opts.batchType === "videos" ? "t2v" : "t2i",
      batchVariation: true,
      directGeneration: true,
    };
    const body: Json = {
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt ?? "",
      batchId: `batch-${uuidV7()}`,
      config,
      batchType: opts.batchType ?? "videos",
    };
    if (opts.projectId) body.projectId = opts.projectId;
    const resp = await this._post("/api/generate/prompts", body);
    return resp?.data?.variations ?? [];
  }

  // ------------------------------------------------------------------ //
  //  LIP SYNC / ANIMATION
  // ------------------------------------------------------------------ //

  /** Generate a lip-synced video (image + audio + script). */
  async generateLipsync(opts: {
    projectId: string;
    imagePrompt: string;
    script: string;
    audioUrl: string;
    audioDurationMs: number;
    engine?: string;
    ingredients?: Record<string, unknown>[];
    aspectRatio?: string;
    videoOrientation?: string;
    musicTrack?: Record<string, unknown>;
    customMotionPrompt?: string;
  }): Promise<any> {
    const body: Json = {
      imagePrompt: opts.imagePrompt,
      audioUrl: opts.audioUrl,
      audioDurationMs: Math.max(2000, opts.audioDurationMs),
      script: opts.script,
      engine: opts.engine ?? "midjen",
      projectId: opts.projectId,
    };
    if (opts.ingredients) body.ingredients = opts.ingredients;
    if (opts.aspectRatio) body.aspectRatio = coerce(opts.aspectRatio);
    if (opts.videoOrientation) body.videoOrientation = opts.videoOrientation;
    if (opts.musicTrack) body.musicTrack = opts.musicTrack;
    if (opts.customMotionPrompt) body.customMotionPrompt = opts.customMotionPrompt;
    return this._post("/api/animate/generate", body);
  }

  // ------------------------------------------------------------------ //
  //  TTS (text-to-speech)
  // ------------------------------------------------------------------ //

  /** Return the list of available TTS voices. */
  async listVoices(): Promise<any[]> {
    return (await this._get("/api/studio/voices")).voices ?? [];
  }

  /** Synthesize speech via PlayAI TTS. */
  async tts(opts: {
    text: string;
    voice: string;
    outputFormat?: string;
    language?: string;
  }): Promise<any> {
    const body: Json = {
      text: opts.text,
      voice: opts.voice,
      outputFormat: opts.outputFormat ?? "mp3",
    };
    if (opts.language) body.language = opts.language;
    return this._post("/api/studio/playai/tts", body);
  }

  // ------------------------------------------------------------------ //
  //  Uploads
  // ------------------------------------------------------------------ //

  /** Upload a base64-encoded image. Returns `{ mediaEntId, imageUrl }`.
   *
   * Retries up to 3 times on transient 500 errors.
   */
  async uploadImage(imageBase64: string): Promise<any> {
    return this._postWithRetry("/api/upload-image", { image: imageBase64 });
  }

  /** Upload a base64-encoded image as a generic asset.
   *
   * Retries up to 3 times on transient 500 errors.
   */
  async uploadAsset(imageBase64: string): Promise<any> {
    return this._postWithRetry("/api/upload-asset", { image: imageBase64 });
  }

  /** Upload a video file via multipart form data. */
  async uploadVideoDirect(formData: FormData, timeoutMs = 600000): Promise<any> {
    const resp = await fetch(this.url("/api/upload-video-direct"), {
      method: "POST",
      headers: this.buildHeaders(),
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return this.check(resp);
  }

  /** Upload an audio file via multipart form data. */
  async uploadAudioDirect(formData: FormData, timeoutMs = 600000): Promise<any> {
    const resp = await fetch(this.url("/api/upload-audio-direct"), {
      method: "POST",
      headers: this.buildHeaders(),
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return this.check(resp);
  }

  /** Generic media upload (image/video) via multipart. */
  async uploadMedia(formData: FormData, timeoutMs = 600000): Promise<any> {
    const resp = await fetch(this.url("/api/upload-media"), {
      method: "POST",
      headers: this.buildHeaders(),
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return this.check(resp);
  }

  // ------------------------------------------------------------------ //
  //  Media library
  // ------------------------------------------------------------------ //

  /** List media items in your library (videos, images, audio). */
  async listMedia(opts?: {
    limit?: number;
    offset?: number;
    type?: string;
    sort?: string;
    search?: string;
  }): Promise<any> {
    const params: Record<string, string | number | undefined> = {
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
      sort: opts?.sort ?? "newest",
    };
    if (opts?.type) params.type = opts.type;
    if (opts?.search) params.search = opts.search;
    return this._get("/api/media-library", params);
  }

  /** Favorite or unfavorite a content item. */
  async favoriteContentItem(contentItemId: string, favorite = true): Promise<any> {
    return this._post(`/api/content-items/${contentItemId}/favorite`, {
      isFavorited: favorite,
    });
  }

  /** Bulk-delete content items. */
  async deleteContentItems(ids: string[]): Promise<any> {
    return this._post("/api/content-items/bulk-delete", { ids });
  }

  /** Delete a single content item. */
  async deleteContentItem(contentItemId: string): Promise<any> {
    return this._delete(`/api/content-items/${contentItemId}`);
  }

  /** Retry a failed content item. */
  async retryContentItem(contentItemId: string): Promise<any> {
    return this._post(`/api/content-items/${contentItemId}/retry`);
  }

  /** Submit feedback on a content item. */
  async feedbackContentItem(contentItemId: string, feedback: any): Promise<any> {
    return this._post(`/api/content-items/${contentItemId}/feedback`, feedback);
  }

  // ------------------------------------------------------------------ //
  //  Download
  // ------------------------------------------------------------------ //

  /** Download a generated video as MP4. Returns the binary as ArrayBuffer. */
  async downloadVideo(contentItemId: string): Promise<ArrayBuffer> {
    return this.downloadContentBinary(contentItemId, "/api/download/video");
  }

  /** Download a generated image as PNG. Returns the binary as ArrayBuffer. */
  async downloadImage(contentItemId: string): Promise<ArrayBuffer> {
    return this.downloadContentBinary(contentItemId, "/api/download/png");
  }

  /** Generic download via `/api/download/{type}`. */
  async downloadContentBinary(contentItemId: string, endpoint: string): Promise<ArrayBuffer> {
    const url = this.url(`${endpoint}?id=${contentItemId}`);
    const resp = await fetch(url, {
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(Math.max(this.timeout, 600) * 1000),
    });
    if (!resp.ok) {
      throw new VibesAPIError(`Download failed: HTTP ${resp.status}`, { status: resp.status });
    }
    return resp.arrayBuffer();
  }

  // ------------------------------------------------------------------ //
  //  Share links
  // ------------------------------------------------------------------ //

  /** Create a shareable link for a project or content item. */
  async createShareLink(opts: {
    entityType: string;
    entityId: string;
    expiresAt?: string;
    maxUses?: number;
  }): Promise<any> {
    const body: Json = { entityType: opts.entityType, entityId: opts.entityId };
    if (opts.expiresAt) body.expiresAt = opts.expiresAt;
    if (opts.maxUses !== undefined) body.maxUses = opts.maxUses;
    return (await this._post("/api/share-links", body)).shareLink ?? {};
  }

  /** List all active share links for an entity. */
  async listShareLinks(entityType: string, entityId: string): Promise<any[]> {
    return (
      (await this._get("/api/share-links", { entityType, entityId })).shareLinks ?? []
    );
  }

  /** Revoke a share link. */
  async revokeShareLink(shareLinkId: string): Promise<void> {
    await this._delete(`/api/share-links/${shareLinkId}`);
  }

  /** Revoke existing links and create a new one. */
  async resetShareLink(opts: {
    entityType: string;
    entityId: string;
    expiresAt?: string;
    maxUses?: number;
  }): Promise<any> {
    const existing = await this.listShareLinks(opts.entityType, opts.entityId);
    for (const link of existing) {
      try {
        await this.revokeShareLink(link.id);
      } catch {
        // ignore
      }
    }
    return this.createShareLink(opts);
  }

  // ------------------------------------------------------------------ //
  //  Studio ingredients (characters, styles, settings)
  // ------------------------------------------------------------------ //

  /** List studio ingredients. */
  async listIngredients(opts?: {
    ownerFilter?: string;
    ingredientType?: string;
  }): Promise<any[]> {
    const params: Record<string, string> = {
      ownerFilter: coerce(opts?.ownerFilter ?? OwnerFilter.LIBRARY),
    };
    if (opts?.ingredientType) params.ingredientType = coerce(opts.ingredientType);
    return (await this._get("/api/studio/ingredients", params)).ingredients ?? [];
  }

  /** Shortcut: list only CHARACTER ingredients. */
  listCharacters(ownerFilter?: string): Promise<any[]> {
    return this.listIngredients({ ownerFilter, ingredientType: IngredientType.CHARACTER });
  }

  /** Shortcut: list only STYLE ingredients. */
  listStyles(ownerFilter?: string): Promise<any[]> {
    return this.listIngredients({ ownerFilter, ingredientType: IngredientType.STYLE });
  }

  /** Shortcut: list only SETTING (scene) ingredients. */
  listScenes(ownerFilter?: string): Promise<any[]> {
    return this.listIngredients({ ownerFilter, ingredientType: IngredientType.SETTING });
  }

  /** Create a new studio ingredient. */
  async createIngredient(opts: {
    name: string;
    ingredientType: string;
    sourceImageEntId?: string;
    imageUrl?: string;
    description?: string;
    personality?: string;
    backstory?: string;
    coreBeliefs?: string;
  }): Promise<any> {
    const body: Json = {
      name: opts.name,
      ingredientType: coerce(opts.ingredientType),
    };
    if (opts.sourceImageEntId) body.sourceImageEntId = opts.sourceImageEntId;
    if (opts.imageUrl) body.imageUrl = opts.imageUrl;
    if (opts.description) body.description = opts.description;
    if (opts.personality) body.personality = opts.personality;
    if (opts.backstory) body.backstory = opts.backstory;
    if (opts.coreBeliefs) body.coreBeliefs = opts.coreBeliefs;
    return this._post("/api/studio/ingredients", body);
  }

  /** Delete a studio ingredient by its ID. */
  async deleteIngredient(ingredientId: string): Promise<void> {
    await this._delete(`/api/studio/ingredients/${ingredientId}`);
  }

  /** Update an existing ingredient via Meta GraphQL. */
  async updateIngredient(ingredientId: string, updates: any): Promise<any> {
    const input = { id: ingredientId, ...updates };
    const body = {
      doc_id: "26515982254723441", // UpdateIngredientMutation
      variables: { input },
    };
    return this._post("/api/meta-graphql", body);
  }

  // ------------------------------------------------------------------ //
  //  Moodboards
  // ------------------------------------------------------------------ //

  async listMoodboards(): Promise<any[]> {
    return (await this._get("/api/moodboards")).moodboards ?? [];
  }

  async getMoodboard(moodboardId: string): Promise<any> {
    return (await this._get(`/api/moodboards/${moodboardId}`)).moodboard ?? {};
  }

  async createMoodboard(name: string, moodboardCode: string, images: any[]): Promise<any> {
    const body = { name, moodboardCode, imageList: images };
    return (await this._post("/api/moodboards", body)).moodboard ?? {};
  }

  async deleteMoodboard(moodboardId: string): Promise<void> {
    await this._delete(`/api/moodboards/${moodboardId}`);
  }

  async updateMoodboard(moodboardId: string, updates: any): Promise<any> {
    return (await this._patch(`/api/moodboards/${moodboardId}`, updates)).moodboard ?? {};
  }

  async lookupMoodboardByCode(moodboardCode: string): Promise<string | null> {
    try {
      const moodboards = await this.listMoodboards();
      for (const m of moodboards) {
        if (m.moodboardCode === moodboardCode) return m.id;
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ------------------------------------------------------------------ //
  //  Music library
  // ------------------------------------------------------------------ //

  /** Search the Meta music library. */
  async searchMusic(query = "", limit = 30, cursor?: string): Promise<any> {
    const params: Record<string, string> = {};
    if (query) {
      params.q = query;
      params.limit = String(limit);
    } else {
      params.limit = "50";
    }
    if (cursor) params.cursor = cursor;
    return this._get("/api/meta-music", params);
  }

  /** Search music and filter out tracks without preview URLs. */
  async searchMusicFiltered(query = "", limit = 30, cursor?: string): Promise<any> {
    const resp = await this.searchMusic(query, limit, cursor);
    const tracks = (resp.tracks ?? []).filter((t: any) => t.preview_url);
    return { ...resp, tracks, count: tracks.length };
  }

  /** Resolve a thumbnail URL for a music track. */
  async lookupMusicThumbnail(trackId: string, title?: string): Promise<string | null> {
    let path = `/api/meta-music/lookup?id=${trackId}`;
    if (title) path += `&title=${encodeURIComponent(title)}`;
    const resp = await this._get(path);
    return resp.thumbnail_url ?? null;
  }

  /** Check original audio status. */
  async checkOriginalAudio(trackIds: string[]): Promise<any> {
    return this._post("/api/meta-music/oa-check", { trackIds });
  }

  // ------------------------------------------------------------------ //
  //  Timeline chat (streaming AI assistant)
  // ------------------------------------------------------------------ //

  static readonly DEFAULT_INSTRUCTIONS =
    "You are a creative timeline editing assistant for Vibes, a video creation tool. The user is building a video by arranging clips, music, text overlays, and effects on a timeline. The timeline is empty.";

  static readonly DEFAULT_TOOLS = [
    {
      type: "function",
      name: "generate_image",
      description: "Generate a new image from a text prompt and place it on the timeline.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed, descriptive prompt for image generation." },
          start_time: { type: "number", description: "Start time in seconds on the timeline." },
          end_time: { type: "number", description: "End time in seconds." },
          count: { type: "number", description: "Number of images to generate (1-4, default 1)." },
        },
        required: ["prompt", "start_time", "end_time"],
      },
    },
    {
      type: "function",
      name: "generate_video",
      description: "Generate a new video from a text prompt and place it on the timeline.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed, descriptive prompt for video generation." },
          start_time: { type: "number", description: "Start time in seconds on the timeline." },
          end_time: { type: "number", description: "End time in seconds." },
        },
        required: ["prompt", "start_time", "end_time"],
      },
    },
    {
      type: "function",
      name: "add_music",
      description: "Add a music track by searching the library with a mood/genre/title query.",
      parameters: {
        type: "object",
        properties: {
          music_query: { type: "string", description: 'Search query (e.g., "upbeat electronic").' },
          cover_entire_timeline: { type: "boolean", description: "If true, the music clip spans the full timeline duration." },
          start_time: { type: "number", description: "Start time in seconds (if not covering)." },
        },
        required: ["music_query"],
      },
    },
    {
      type: "function",
      name: "add_text_overlay",
      description: "Add a text overlay to the timeline.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content for the overlay." },
          start_time: { type: "number", description: "Start time in seconds." },
          end_time: { type: "number", description: "End time in seconds." },
          preset: { type: "string", description: "Optional effect preset." },
          font_size: { type: "number", description: "Font size in pixels (default 48)." },
          color: { type: "string", description: 'Text color as hex (e.g., "#FF0000").' },
          position: { type: "string", description: "Position: center (default), top-left, etc." },
        },
        required: ["text", "start_time", "end_time"],
      },
    },
  ];

  /** Stream events from the timeline AI assistant (SSE).
   * @returns an async generator yielding parsed event dicts.
   */
  async *timelineChat(opts: {
    input: string;
    instructions?: string;
    tools?: any[];
    composition?: CompositionData;
  }): AsyncGenerator<any> {
    const body: any = {
      input: opts.input,
      instructions: opts.instructions ?? VibesClient.DEFAULT_INSTRUCTIONS,
      tools: JSON.stringify(opts.tools ?? VibesClient.DEFAULT_TOOLS),
    };
    if (opts.composition !== undefined) body.composition = opts.composition;

    const resp = await fetch(this.url("/api/timeline/chat/stream"), {
      method: "POST",
      headers: this.buildHeaders({ Accept: "text/event-stream", "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(this.timeout, 300) * 1000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new VibesAPIError(
        `Stream request failed (${resp.status}): ${text.slice(0, 200)}`,
        { status: resp.status },
      );
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload);
        } catch {
          yield { type: "raw", data: payload };
        }
      }
    }
  }

  // ------------------------------------------------------------------ //
  //  Timeline export
  // ------------------------------------------------------------------ //

  /** Render the timeline to an MP4 video (synchronous). Returns MP4 bytes. */
  async exportTimeline(projectId: string, composition: CompositionData): Promise<ArrayBuffer> {
    const resp = await fetch(this.url(`/api/projects/${projectId}/timeline/download`), {
      method: "POST",
      headers: this.buildHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ composition }),
      signal: AbortSignal.timeout(Math.max(this.timeout, 600) * 1000),
    });
    if (!resp.ok) {
      let msg: string | undefined;
      try {
        const err = await resp.json();
        msg = err?.error?.title;
      } catch {
        // ignore
      }
      throw new VibesAPIError(msg ?? `Export failed: HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
    return resp.arrayBuffer();
  }

  /** Start an async (SurfGuard) timeline export. */
  async exportTimelineAsync(projectId: string, composition: CompositionData): Promise<any> {
    return this._post(`/api/projects/${projectId}/timeline/export-surfguard`, { composition });
  }

  /** Check the status of an async export. */
  async checkExportStatus(projectId: string, exportId: string): Promise<any> {
    return this._get(`/api/projects/${projectId}/timeline/export/${exportId}/status`);
  }

  /** Cancel a running async export. */
  async cancelExport(projectId: string, exportId: string): Promise<any> {
    return this._post(`/api/projects/${projectId}/timeline/export/${exportId}/cancel`);
  }

  /** Check for a pending export on a project. */
  async getPendingExport(projectId: string): Promise<any | null> {
    try {
      return await this._get(`/api/projects/${projectId}/timeline/export/pending`);
    } catch (e) {
      if (e instanceof VibesAPIError && e.status === 404) return null;
      throw e;
    }
  }

  // ------------------------------------------------------------------ //
  //  Project assets (cross-project media reuse)
  // ------------------------------------------------------------------ //

  async listProjectAssets(projectId: string): Promise<any[]> {
    return (await this._get(`/api/projects/${projectId}/assets`)).assets ?? [];
  }

  async addProjectAsset(projectId: string, asset: any): Promise<any> {
    return this._post(`/api/projects/${projectId}/assets`, asset);
  }

  async importProjectAssets(
    projectId: string,
    sourceProjectId: string,
    assetIds: string[],
  ): Promise<any> {
    return this._post(`/api/projects/${projectId}/assets/import`, {
      sourceProjectId,
      assetIds,
    });
  }

  async listAvailableAssets(
    projectId: string,
    sourceProjectId?: string,
  ): Promise<any[]> {
    let path = `/api/projects/${projectId}/assets/available`;
    if (sourceProjectId) path += `?sourceProjectId=${sourceProjectId}`;
    return (await this._get(path)).assets ?? [];
  }

  async removeProjectAsset(projectId: string, assetId: string): Promise<void> {
    await this._delete(`/api/projects/${projectId}/assets/${assetId}`);
  }

  // ------------------------------------------------------------------ //
  //  Collaborators
  // ------------------------------------------------------------------ //

  async listCollaborators(entityType: string, entityId: string): Promise<any> {
    return this._get("/api/collaborators", { entityType, entityId });
  }

  async removeCollaborator(collaboratorId: string): Promise<void> {
    await this._delete(`/api/collaborators/${collaboratorId}`);
  }

  // ------------------------------------------------------------------ //
  //  Real-time sync (SSE)
  // ------------------------------------------------------------------ //

  /** Get the last-updated timestamp for an entity. */
  async getSyncStatus(entityType: string, entityId: string): Promise<any> {
    return this._get("/api/sync", { entityType, entityId });
  }

  /** Stream real-time update notifications for an entity via SSE. */
  async *streamSyncUpdates(entityType: string, entityId: string): AsyncGenerator<any> {
    const url = this.url(`/api/sync/stream?entityType=${entityType}&entityId=${entityId}`);
    const resp = await fetch(url, {
      headers: this.buildHeaders({ Accept: "text/event-stream" }),
    });
    if (!resp.ok) {
      throw new VibesAPIError(`Sync stream failed: HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType: string | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (trimmed.startsWith("event:")) {
          eventType = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          let data: any;
          try {
            data = JSON.parse(payload);
          } catch {
            data = { raw: payload };
          }
          if (eventType) data.type = eventType;
          yield data;
          eventType = null;
        }
      }
    }
  }

  /** Stream real-time updates for a generation batch via SSE. */
  async *streamBatchUpdates(batchId: string): AsyncGenerator<any> {
    const url = this.url(`/api/generation-batches/${batchId}/stream`);
    const resp = await fetch(url, {
      headers: this.buildHeaders({ Accept: "text/event-stream" }),
    });
    if (!resp.ok) {
      throw new VibesAPIError(`Batch stream failed: HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        try {
          yield JSON.parse(payload);
        } catch {
          yield { raw: payload };
        }
      }
    }
  }

  // ------------------------------------------------------------------ //
  //  Profile & account settings
  // ------------------------------------------------------------------ //

  async uploadProfilePicture(imageBase64: string): Promise<any> {
    return this._post("/api/upload-profile-picture", { image: imageBase64 });
  }

  async deleteAccount(): Promise<any> {
    return this._post("/api/settings/delete-account");
  }

  async deleteAllMedia(): Promise<any> {
    return this._post("/api/settings/delete-all-media");
  }

  async removeAllPosts(): Promise<any> {
    return this._post("/api/settings/remove-all-posts");
  }

  // ------------------------------------------------------------------ //
  //  Bug reports & analytics
  // ------------------------------------------------------------------ //

  async reportBug(bugData: any): Promise<any> {
    return this._post("/api/bug-report", bugData);
  }

  async recordConsent(consentData: any): Promise<any> {
    return this._post("/api/consent/record", consentData);
  }

  // ------------------------------------------------------------------ //
  //  Quota & upsell
  // ------------------------------------------------------------------ //

  async getQuotaUpsell(): Promise<any | null> {
    try {
      return (await this._get("/api/quota/upsell")).upsell ?? null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ //
  //  Publishing / Posting to Vibes
  // ------------------------------------------------------------------ //

  async publishToVibes(opts: {
    contentItemId: string;
    batchId?: string;
    caption?: string;
    audioTypes?: string[];
    contentAttribution?: Record<string, unknown>;
    imageHandle?: string;
    videoHandle?: string;
    prompt?: string;
    imagePrompt?: string;
    videoPrompt?: string;
  }): Promise<any> {
    const user = await this.getMe();
    const body: Json = {
      profileId: user.id,
      profileName: user.username ?? user.displayName,
      contentItemId: opts.contentItemId,
    };
    if (opts.batchId) body.batchId = opts.batchId;
    if (opts.imageHandle) body.imageHandle = opts.imageHandle;
    if (opts.videoHandle) body.videoHandle = opts.videoHandle;
    if (opts.prompt) body.prompt = opts.prompt;
    if (opts.imagePrompt) body.imagePrompt = opts.imagePrompt;
    if (opts.videoPrompt) body.videoPrompt = opts.videoPrompt;
    if (opts.caption) body.caption = opts.caption;
    if (opts.audioTypes) body.audioTypes = opts.audioTypes;
    if (opts.contentAttribution) body.contentAttribution = opts.contentAttribution;
    return this._post("/api/meta-profiles/publish", body);
  }

  // ------------------------------------------------------------------ //
  //  Bulk upload to project
  // ------------------------------------------------------------------ //

  async bulkUploadToProject(projectId: string, files: any[]): Promise<any> {
    return this._post(`/api/projects/${projectId}/upload`, { files });
  }

  // ------------------------------------------------------------------ //
  //  Audio helpers
  // ------------------------------------------------------------------ //

  async resolveAudioUrls(audioIds: string[]): Promise<any> {
    return this._post("/api/resolve-audio-urls", { audioIds });
  }

  proxyAudioUrl(audioId: string, title?: string): string {
    let url = this.url(`/api/proxy-audio?audio_id=${audioId}`);
    if (title) url += `&title=${encodeURIComponent(title)}`;
    return url;
  }

  proxyAudioUrlSigned(signedUrl: string): string {
    return this.url(`/api/proxy-audio?signed_url=${encodeURIComponent(signedUrl)}`);
  }

  // ------------------------------------------------------------------ //
  //  Convenience: one-shot video creation
  // ------------------------------------------------------------------ //

  /** End-to-end: create project, generate videos, return result. */
  async createVideoFromPrompt(opts: {
    prompt: string;
    projectName?: string;
    aspectRatio?: string;
    resolution?: string;
    variations?: number;
  }): Promise<any> {
    const project = await this.createProject({ name: opts.projectName ?? opts.prompt.slice(0, 50) });
    const batch = await this.generateVideo({
      projectId: project.id,
      prompt: opts.prompt,
      aspectRatio: opts.aspectRatio ?? AspectRatio.LANDSCAPE,
      resolution: opts.resolution ?? Resolution.P720,
      variations: opts.variations ?? 4,
    });
    const videos = (batch.content ?? [])
      .filter((c: any) => c.videoUrl)
      .map((c: any) => ({
        id: c.id,
        videoUrl: c.videoUrl,
        imageUrl: c.imageUrl,
        prompt: c.prompt,
      }));
    return { project, batch, videos };
  }

  // ------------------------------------------------------------------ //
  //  Client-side validation helpers (static)
  // ------------------------------------------------------------------ //

  static validatePromptLength(prompt: string, maxLength = 10000): any {
    if (!prompt || typeof prompt !== "string") return { success: true, value: "" };
    if (prompt.length > maxLength) {
      return {
        success: false,
        error: `Prompt must be ${maxLength.toLocaleString()} characters or fewer`,
      };
    }
    return { success: true, value: prompt };
  }

  static validateProjectName(name: string, maxLength = 255): any {
    if (name.length > maxLength) {
      return {
        success: false,
        error: `Project name must be ${maxLength} characters or less`,
      };
    }
    return { success: true, value: name };
  }

  static validateUsername(name: string): any {
    if (name.length < 3) return { success: false, error: "Username must be at least 3 characters" };
    if (name.length > 30) return { success: false, error: "Username must be 30 characters or fewer" };
    return { success: true, value: name };
  }

  static validateMusicClipDuration(startMs: number, endMs: number, maxDurationMs = 60000): any {
    const duration = endMs - startMs;
    if (duration <= 0) return { success: false, error: "End must be greater than start" };
    if (duration > maxDurationMs) {
      return { success: false, error: `Music clips cannot exceed ${maxDurationMs / 1000}s` };
    }
    return { success: true, duration_ms: duration };
  }

  static validateMusicClipShort(startMs: number, endMs: number, maxDurationMs = 9000): any {
    const duration = endMs - startMs;
    if (duration <= 0) return { success: false, error: "End must be greater than start" };
    if (duration > maxDurationMs) {
      return { success: false, error: `Short music clips cannot exceed ${maxDurationMs / 1000}s` };
    }
    return { success: true, duration_ms: duration };
  }

  /** Parse Midjourney-style parameters from a prompt. */
  static parseMidjourneyParams(prompt: string): any {
    const params: any = {};
    let clean = prompt;

    const extract = (re: RegExp): string | null => {
      const m = prompt.match(re);
      if (m) {
        const val = m[1].trim();
        clean = clean.replace(m[0], "").trim();
        return val;
      }
      return null;
    };

    // --sref
    const srefVal = extract(/--sref\s+([^\s-]+(?:\s+[^\s-]+)*?)(?=\s+--|$)/);
    if (srefVal) {
      if (srefVal.toLowerCase() === "random") {
        params.sref_random = true;
        params.sref_value = srefVal;
      } else {
        params.sref_value = srefVal;
        const nums = srefVal.split(/\s+/).filter((x) => /^\d+$/.test(x));
        if (nums.length) params.sref_ids = nums.map(Number);
      }
    }

    // --oref
    const orefVal = extract(/--oref\s+([^\s-]+(?:\s+[^\s-]+)*?)(?=\s+--|$)/);
    if (orefVal) {
      params.oref_value = orefVal;
      const nums = orefVal.split(/\s+/).filter((x) => /^\d+$/.test(x));
      if (nums.length) params.oref_ids = nums.map(Number);
    }

    // --sw
    const swVal = extract(/--sw\s+([\d.]+)/);
    if (swVal) params.sref_weight = parseFloat(swVal);

    // --ow
    const owVal = extract(/--ow\s+([\d.]+)/);
    if (owVal) params.oref_weight = parseFloat(owVal);

    // --seed
    const seedVal = extract(/--seed\s+(\d+)/);
    if (seedVal) params.seed = parseInt(seedVal, 10);

    // --chaos / --c
    const chaosVal = extract(/--(?:chaos|c)\s+(\d+)/);
    if (chaosVal) params.chaos = parseInt(chaosVal, 10);

    // --stylize / --s
    const stylizeVal = extract(/--(?:stylize|s)\s+(\d+)/);
    if (stylizeVal) params.stylize = parseInt(stylizeVal, 10);

    // --ar
    const arVal = extract(/--ar\s+(\d+:\d+)/);
    if (arVal) params.aspect_ratio = arVal;

    // --v
    const vVal = extract(/--v\s+([\d.]+)/);
    if (vVal) params.version = parseFloat(vVal);

    // Boolean flags
    for (const flag of [
      "niji", "loop", "raw", "tile", "turbo", "relax",
      "stealth", "public", "draft", "video", "fast",
    ]) {
      const re = new RegExp(`--${flag}\\b`);
      if (re.test(prompt)) {
        params[flag] = true;
        clean = clean.replace(re, "").trim();
      }
    }

    // --style
    const styleVal = extract(/--style\s+([^\s-]+)/);
    if (styleVal) params.style = styleVal;

    clean = clean.replace(/\s+/g, " ").trim();

    return {
      cleanPrompt: clean,
      parameters: params,
      hasRandomSref: params.sref_random ?? false,
      originalSrefValue: params.sref_value ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
