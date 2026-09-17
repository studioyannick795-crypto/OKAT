/**
 * Timeline Composition helpers — manipulate the composition JSON that
 * Vibes uses to represent a video timeline (tracks, clips, text overlays,
 * audio, effects).
 *
 * Ported 1:1 from vibes_api/composition.py.
 *
 * The web app does all of these operations **client-side** before saving
 * the composition via `PUT /api/projects/{id}` (or
 * `POST /api/projects/{id}/timeline/download` for export). This module
 * mirrors that behavior so you can build / edit timelines programmatically.
 */

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface CompositionTrack {
  id: string;
  type: string;
  label?: string;
  muted?: boolean;
  items: CompositionClip[];
}

export interface CompositionClip {
  id: string;
  trackId: string;
  name?: string;
  src?: string;
  text?: string;
  start: number;
  duration: number;
  sourceDuration?: number;
  mediaType?: string;
  trimStart?: number;
  trimEnd?: number;
  volume?: number;
  speed?: number;
  muted?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  contentItemId?: string;
  fontSize?: number;
  color?: string;
  position?: string;
  preset?: string;
  linkedItemId?: string;
  linkType?: string;
  [key: string]: unknown;
}

export interface CompositionData {
  id?: string;
  tracks: CompositionTrack[];
  duration: number;
  [key: string]: unknown;
}

export interface CompositionSummary {
  duration: number;
  trackCount: number;
  totalClips: number;
  tracks: Array<{
    id: string;
    type?: string;
    label?: string;
    itemCount: number;
    duration: number;
  }>;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Generate a unique clip/track ID. */
function newId(prefix = "clip"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
//  Composition class
// ---------------------------------------------------------------------------

/**
 * A builder/manipulator for a Vibes timeline composition.
 *
 * Wrap an existing composition dict (from `getProject(id).composition`)
 * or start from scratch with `Composition.createEmpty()`.
 *
 * All operations mutate the composition in place; call `toDict()` to
 * serialize for saving.
 */
export class Composition {
  private data: CompositionData;

  constructor(data?: CompositionData | null) {
    if (data) {
      this.data = JSON.parse(JSON.stringify(data)) as CompositionData;
    } else {
      this.data = Composition.createEmpty().toDict();
    }
  }

  /** Create a fresh empty composition with one video track. */
  static createEmpty(duration = 5.0): Composition {
    return new Composition({
      id: "studio-composition",
      tracks: [
        {
          id: "video-track",
          type: "video",
          label: "Video",
          items: [],
        },
      ],
      duration,
    });
  }

  /** Build a Composition from a project dict returned by `getProject()`. */
  static fromProject(project: { composition?: CompositionData }): Composition {
    return new Composition(project?.composition ?? null);
  }

  /** Serialize to a plain dict (for `saveComposition()`). */
  toDict(): CompositionData {
    return JSON.parse(JSON.stringify(this.data)) as CompositionData;
  }

  /** Return a deep copy of this composition. */
  clone(): Composition {
    return new Composition(this.toDict());
  }

  // ---- Properties ----

  get tracks(): CompositionTrack[] {
    return this.data.tracks ?? [];
  }

  get duration(): number {
    return Number(this.data.duration ?? 0);
  }

  set duration(value: number) {
    this.data.duration = Number(value);
  }

  /** First track of type 'video' (creates one if missing). */
  get videoTrack(): CompositionTrack {
    for (const t of this.tracks) {
      if (t.type === "video") return t;
    }
    return this.addTrack({ trackType: "video", label: "Video", trackId: "video-track" });
  }

  /** First track of type 'text' (creates one if missing). */
  get textTrack(): CompositionTrack {
    for (const t of this.tracks) {
      if (t.type === "text") return t;
    }
    return this.addTrack({ trackType: "text", label: "Text", trackId: "text-track" });
  }

  /** All clips in the video track. */
  get videoItems(): CompositionClip[] {
    return this.videoTrack.items ?? [];
  }

  /** End time of the last video clip. */
  get totalVideoDuration(): number {
    if (this.videoItems.length === 0) return 0;
    return Math.max(...this.videoItems.map((c) => (c.start ?? 0) + (c.duration ?? 0)));
  }

  // ---- Track operations ----

  addTrack(opts: {
    trackType: string;
    label?: string;
    trackId?: string;
  }): CompositionTrack {
    const trackId = opts.trackId ?? newId("track");
    const label = opts.label ?? opts.trackType.charAt(0).toUpperCase() + opts.trackType.slice(1);
    const track: CompositionTrack = { id: trackId, type: opts.trackType, label, items: [] };
    if (!this.data.tracks) this.data.tracks = [];
    this.data.tracks.push(track);
    return track;
  }

  getTrack(trackId: string): CompositionTrack | undefined {
    return this.tracks.find((t) => t.id === trackId);
  }

  /** Delete an entire track and all its clips. Returns true if found. */
  deleteTrack(trackId: string): boolean {
    const before = this.tracks.length;
    this.data.tracks = this.tracks.filter((t) => t.id !== trackId);
    return this.tracks.length < before;
  }

  /** Rename a track. Returns true if found. */
  renameTrack(trackId: string, label: string): boolean {
    const t = this.getTrack(trackId);
    if (t) {
      t.label = label;
      return true;
    }
    return false;
  }

  /** Mute or unmute a track. Returns true if found. */
  muteTrack(trackId: string, muted = true): boolean {
    const t = this.getTrack(trackId);
    if (t) {
      t.muted = muted;
      return true;
    }
    return false;
  }

  // ---- Clip lookup helpers ----

  /** Find a clip by ID across all tracks.
   * @returns `[track, clip]` or `[undefined, undefined]` if not found.
   */
  findClip(clipId: string): [CompositionTrack | undefined, CompositionClip | undefined] {
    for (const t of this.tracks) {
      for (const c of t.items ?? []) {
        if (c.id === clipId) return [t, c];
      }
    }
    return [undefined, undefined];
  }

  /** Find the first clip with a matching name. Returns `[track, clip]`. */
  findClipByName(name: string): [CompositionTrack | undefined, CompositionClip | undefined] {
    for (const t of this.tracks) {
      for (const c of t.items ?? []) {
        if (c.name === name) return [t, c];
      }
    }
    return [undefined, undefined];
  }

  // ---- Adding clips ----

  addVideoClip(opts: {
    src: string;
    start: number;
    duration?: number;
    sourceDuration?: number;
    name?: string;
    trackId?: string;
    mediaType?: string;
    contentItemId?: string;
    trimStart?: number;
    trimEnd?: number;
    volume?: number;
    speed?: number;
    muted?: boolean;
    fadeIn?: number;
    fadeOut?: number;
  }): CompositionClip {
    let duration = opts.duration ?? opts.sourceDuration ?? 5.0;
    let sourceDuration = opts.sourceDuration ?? duration;

    let track: CompositionTrack | undefined;
    if (opts.trackId) track = this.getTrack(opts.trackId);
    if (!track) track = this.videoTrack;

    const clip: CompositionClip = {
      id: newId("clip"),
      trackId: track.id,
      name: opts.name ?? (opts.src ? opts.src.slice(0, 50) : "Untitled"),
      src: opts.src,
      start: Number(opts.start),
      duration: Number(duration),
      sourceDuration: Number(sourceDuration),
      mediaType: opts.mediaType ?? "video",
      trimStart: Number(opts.trimStart ?? 0),
      trimEnd: Number(opts.trimEnd ?? 0),
      volume: Number(opts.volume ?? 1),
      speed: Number(opts.speed ?? 1),
      muted: Boolean(opts.muted ?? false),
      fadeIn: Number(opts.fadeIn ?? 0),
      fadeOut: Number(opts.fadeOut ?? 0),
    };
    if (opts.contentItemId) clip.contentItemId = opts.contentItemId;

    track.items.push(clip);
    const end = clip.start + clip.duration;
    if (end > this.duration) this.duration = end;
    return clip;
  }

  addImageClip(opts: {
    src: string;
    start: number;
    duration?: number;
    name?: string;
    trackId?: string;
    contentItemId?: string;
  }): CompositionClip {
    const duration = opts.duration ?? 5.0;
    return this.addVideoClip({
      src: opts.src,
      start: opts.start,
      duration,
      sourceDuration: duration,
      name: opts.name,
      trackId: opts.trackId,
      mediaType: "image",
      contentItemId: opts.contentItemId,
    });
  }

  addAudioClip(opts: {
    src: string;
    start: number;
    duration: number;
    sourceDuration?: number;
    name?: string;
    trackId?: string;
    trackType?: string;
    trackLabel?: string;
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    trimStart?: number;
    trimEnd?: number;
    linkedItemId?: string;
    linkType?: string;
  }): CompositionClip {
    const sourceDuration = opts.sourceDuration ?? opts.duration;

    let track: CompositionTrack | undefined;
    if (opts.trackId) track = this.getTrack(opts.trackId);
    if (!track) {
      track = this.addTrack({
        trackType: opts.trackType ?? "uploaded-audio",
        label: opts.trackLabel ?? "Audio",
        trackId: opts.trackId,
      });
    }

    const clip: CompositionClip = {
      id: newId("audio"),
      trackId: track.id,
      name: opts.name ?? "Audio clip",
      src: opts.src,
      start: Number(opts.start),
      duration: Number(opts.duration),
      sourceDuration: Number(sourceDuration),
      trimStart: Number(opts.trimStart ?? 0),
      trimEnd: Number(opts.trimEnd ?? 0),
      volume: Number(opts.volume ?? 1),
      fadeIn: Number(opts.fadeIn ?? 0),
      fadeOut: Number(opts.fadeOut ?? 0),
    };
    if (opts.linkedItemId) clip.linkedItemId = opts.linkedItemId;
    if (opts.linkType) clip.linkType = opts.linkType;

    track.items.push(clip);
    const end = clip.start + clip.duration;
    if (end > this.duration) this.duration = end;
    return clip;
  }

  addTextOverlay(opts: {
    text: string;
    start: number;
    end: number;
    preset?: string;
    fontSize?: number;
    color?: string;
    position?: string;
    trackId?: string;
    clipId?: string;
  }): CompositionClip {
    const duration = Number(opts.end) - Number(opts.start);
    if (duration <= 0) throw new Error(`end (${opts.end}) must be greater than start (${opts.start})`);

    let track: CompositionTrack | undefined;
    if (opts.trackId) track = this.getTrack(opts.trackId);
    if (!track) track = this.textTrack;

    const clip: CompositionClip = {
      id: opts.clipId ?? newId("text"),
      trackId: track.id,
      text: opts.text,
      start: Number(opts.start),
      duration,
      fontSize: Number(opts.fontSize ?? 48),
      color: opts.color ?? "#FFFFFF",
      position: opts.position ?? "center",
    };
    if (opts.preset) clip.preset = opts.preset;

    track.items.push(clip);
    const end_t = clip.start + clip.duration;
    if (end_t > this.duration) this.duration = end_t;
    return clip;
  }

  // ---- Clip editing ----

  /** Set the ABSOLUTE duration of a clip. Cannot exceed sourceDuration. */
  resizeClip(opts: { clipId: string; newDuration: number; clipName?: string }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [, clip] = this.findClipByName(opts.clipName);
    if (!clip) return false;
    const maxDur = clip.sourceDuration ?? Infinity;
    const newDuration = Math.min(opts.newDuration, maxDur);
    clip.duration = Number(newDuration);
    return true;
  }

  /** Move a clip to a new start time on its track. */
  moveClip(opts: { clipId: string; startTime: number; clipName?: string }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [, clip] = this.findClipByName(opts.clipName);
    if (!clip) return false;
    clip.start = Number(opts.startTime);
    const end = clip.start + clip.duration;
    if (end > this.duration) this.duration = end;
    return true;
  }

  /** Split a clip at `atTime` (absolute timeline time).
   * @returns the new (second) clip's ID, or null if split failed.
   */
  splitClip(opts: { clipId: string; atTime: number; clipName?: string }): string | null {
    let [track, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [track, clip] = this.findClipByName(opts.clipName);
    if (!clip || !track) return null;

    const clipStart = clip.start ?? 0;
    const clipDuration = clip.duration ?? 0;
    const clipEnd = clipStart + clipDuration;

    if (opts.atTime <= clipStart || opts.atTime >= clipEnd) return null;

    const firstDuration = opts.atTime - clipStart;
    const secondDuration = clipEnd - opts.atTime;

    clip.duration = Number(firstDuration);

    const newClip: CompositionClip = JSON.parse(JSON.stringify(clip));
    newClip.id = newId("clip");
    newClip.start = Number(opts.atTime);
    newClip.duration = Number(secondDuration);
    if (clip.trimStart !== undefined) {
      newClip.trimStart = Number(clip.trimStart) + firstDuration;
    }

    track.items.push(newClip);
    track.items.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return newClip.id;
  }

  /** Duplicate a clip in place on the same track.
   * @returns the new clip's ID, or null if not found.
   */
  duplicateClip(opts: { clipId: string; clipName?: string }): string | null {
    let [track, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [track, clip] = this.findClipByName(opts.clipName);
    if (!clip || !track) return null;

    const newClip: CompositionClip = JSON.parse(JSON.stringify(clip));
    newClip.id = newId("clip");
    newClip.start = (clip.start ?? 0) + (clip.duration ?? 0);
    track.items.push(newClip);
    const end = (newClip.start ?? 0) + (newClip.duration ?? 0);
    if (end > this.duration) this.duration = end;
    return newClip.id;
  }

  /** Delete a clip by ID (or name fallback). Returns true if deleted. */
  deleteClip(opts: { clipId: string; clipName?: string }): boolean {
    let [track, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [track, clip] = this.findClipByName(opts.clipName);
    if (!clip || !track) return false;
    track.items = track.items.filter((c) => c.id !== clip!.id);
    return true;
  }

  /** Reorder clips on the video track. */
  reorderClips(opts: {
    orderedClipIds?: string[];
    clipId?: string;
    toIndex?: number;
  }): boolean {
    const track = this.videoTrack;
    if (!track) return false;

    if (opts.orderedClipIds) {
      const byId = new Map(track.items.map((c) => [c.id, c]));
      const newItems: CompositionClip[] = [];
      for (const cid of opts.orderedClipIds) {
        const c = byId.get(cid);
        if (c) newItems.push(c);
      }
      // Append any clips not in the list at the end
      for (const c of track.items) {
        if (!opts.orderedClipIds.includes(c.id)) newItems.push(c);
      }
      track.items = newItems;
      return true;
    } else if (opts.clipId !== undefined && opts.toIndex !== undefined) {
      const items = track.items;
      const idx = items.findIndex((c) => c.id === opts.clipId);
      if (idx === -1) return false;
      const [item] = items.splice(idx, 1);
      items.splice(opts.toIndex, 0, item);
      return true;
    }
    return false;
  }

  /** Extend or shrink the entire video track to a target total duration. */
  extendTimelineTo(targetDuration: number): boolean {
    if (targetDuration <= 0) return false;

    const current = this.totalVideoDuration;
    if (current === 0) {
      this.duration = Number(targetDuration);
      return true;
    }

    const diff = targetDuration - current;
    if (diff > 0) {
      const track = this.videoTrack;
      if (track && track.items.length > 0) {
        const last = track.items.reduce((a, b) => ((a.start ?? 0) > (b.start ?? 0) ? a : b));
        const maxDur = last.sourceDuration ?? Infinity;
        let newDuration = last.duration! + diff;
        if (newDuration > maxDur) newDuration = maxDur;
        last.duration = Number(newDuration);
      }
    } else if (diff < 0) {
      const track = this.videoTrack;
      if (track) {
        const items = [...track.items].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        for (const item of items) {
          const clipEnd = (item.start ?? 0) + (item.duration ?? 0);
          if ((item.start ?? 0) >= targetDuration) {
            item.duration = 0;
          } else if (clipEnd > targetDuration) {
            item.duration = targetDuration - (item.start ?? 0);
          }
        }
        track.items = track.items.filter((c) => (c.duration ?? 0) > 0);
      }
    }

    this.duration = Number(targetDuration);
    return true;
  }

  // ---- Effects / properties ----

  setFade(opts: { clipId: string; fadeIn?: number; fadeOut?: number; clipName?: string }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [, clip] = this.findClipByName(opts.clipName);
    if (!clip) return false;
    const half = (clip.duration ?? 0) / 2;
    clip.fadeIn = Number(Math.min(opts.fadeIn ?? 0, half));
    clip.fadeOut = Number(Math.min(opts.fadeOut ?? 0, half));
    return true;
  }

  setVolume(opts: { trackId: string; volume: number }): boolean {
    const track = this.getTrack(opts.trackId);
    if (!track) return false;
    for (const c of track.items ?? []) {
      c.volume = Number(Math.max(0, Math.min(1, opts.volume)));
    }
    return true;
  }

  setSpeed(opts: { clipId: string; speed: number; clipName?: string }): boolean {
    if (opts.speed < 0.1 || opts.speed > 10.0) return false;
    let [, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [, clip] = this.findClipByName(opts.clipName);
    if (!clip) return false;
    const oldSpeed = clip.speed ?? 1.0;
    const oldDuration = clip.duration ?? 0;
    const newDuration = oldDuration * (oldSpeed / opts.speed);
    clip.speed = Number(opts.speed);
    clip.duration = Number(newDuration);
    return true;
  }

  // ---- Text overlay editing ----

  updateTextOverlay(opts: {
    clipId: string;
    text?: string;
    preset?: string;
    fontSize?: number;
    color?: string;
    position?: string;
    clipName?: string;
  }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip && opts.clipName) [, clip] = this.findClipByName(opts.clipName);
    if (!clip) return false;
    if (opts.text !== undefined) clip.text = opts.text;
    if (opts.preset !== undefined) clip.preset = opts.preset;
    if (opts.fontSize !== undefined) clip.fontSize = Number(opts.fontSize);
    if (opts.color !== undefined) clip.color = opts.color;
    if (opts.position !== undefined) clip.position = opts.position;
    return true;
  }

  // ---- Audio linking ----

  unlinkAudioFromVideo(opts: { audioClipId: string }): boolean {
    let [, clip] = this.findClip(opts.audioClipId);
    if (!clip) return false;
    delete clip.linkedItemId;
    delete clip.linkType;
    return true;
  }

  linkAudioToVideo(opts: {
    audioClipId: string;
    videoClipId: string;
    linkType?: string;
  }): boolean {
    let [, audioClip] = this.findClip(opts.audioClipId);
    if (!audioClip) return false;
    audioClip.linkedItemId = opts.videoClipId;
    audioClip.linkType = opts.linkType ?? "video-audio";
    return true;
  }

  slipAudio(opts: { clipId: string; slipSeconds: number }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip) return false;
    clip.trimStart = Number(Math.max(0, (clip.trimStart ?? 0) + opts.slipSeconds));
    return true;
  }

  replaceAudio(opts: { clipId: string; newSrc: string; newDuration?: number }): boolean {
    let [, clip] = this.findClip(opts.clipId);
    if (!clip) return false;
    clip.src = opts.newSrc;
    if (opts.newDuration !== undefined) {
      clip.duration = Number(opts.newDuration);
      clip.sourceDuration = Number(opts.newDuration);
    }
    return true;
  }

  // ---- Bulk operations ----

  /** Remove every clip from every track (keeps the track structure). */
  deleteAllClips(): void {
    for (const t of this.tracks) {
      t.items = [];
    }
    this.duration = 0;
  }

  /** Remove all tracks AND clips (full reset). */
  deleteTimeline(): void {
    this.data.tracks = [];
    this.duration = 0;
  }

  // ---- Summary ----

  summary(): CompositionSummary {
    const trackSummaries = this.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      label: t.label,
      itemCount: (t.items ?? []).length,
      duration: (t.items ?? []).reduce((sum, c) => sum + (c.duration ?? 0), 0),
    }));
    return {
      duration: this.duration,
      trackCount: this.tracks.length,
      totalClips: this.tracks.reduce((sum, t) => sum + (t.items ?? []).length, 0),
      tracks: trackSummaries,
    };
  }

  toString(): string {
    const s = this.summary();
    return `<Composition duration=${s.duration.toFixed(1)}s tracks=${s.trackCount} clips=${s.totalClips}>`;
  }
}
