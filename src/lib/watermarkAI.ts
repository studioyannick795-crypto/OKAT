/**
 * Watermark detection — VLM-FREE.
 *
 * Detection is always coordinate-based and instant (< 1 ms):
 *   1. caller-provided `boxes` (exact normalized coords), or
 *   2. one of the 3 aspect-ratio presets (1:1 / 16:9 / 9:16), or
 *   3. a named zone preset (bottom-right / bottom-left / ...), or
 *   4. the default bottom-right box.
 *
 * No AI, no network call, no timeout. The slow Z.ai VLM path was removed
 * because it exceeded the public production gateway timeout (intermittent 502).
 */

export type WatermarkType = "text" | "logo" | "pattern" | "stamp";

export interface WatermarkBox {
  id: string;
  ymin: number; // 0..1
  xmin: number; // 0..1
  ymax: number; // 0..1
  xmax: number; // 0..1
  label: string;
  confidence: number;
  type: WatermarkType | string;
}

export interface DetectionResult {
  watermarks: WatermarkBox[];
  source:
    | "preset-ratio"
    | "preset-zone"
    | "custom-boxes"
    | "default";
  message?: string;
}

/* ------------------------------------------------------------------ */
/*  The 3 aspect ratios + named zone presets                          */
/* ------------------------------------------------------------------ */

export type AspectRatio = "1:1" | "16:9" | "9:16";

export type PresetZone =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "center"
  | "bottom-banner";

const VALID_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16"];
const VALID_PRESETS: PresetZone[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
  "center",
  "bottom-banner",
];

let boxIdSeq = 0;
function nextId(prefix: string): string {
  boxIdSeq += 1;
  return `${prefix}-${Date.now()}-${boxIdSeq}`;
}

/** Watermark box for one of the 3 supported aspect ratios (bottom-right zone). */
export function getWatermarkBoxForRatio(ratio: AspectRatio): WatermarkBox {
  switch (ratio) {
    case "1:1":
      return {
        id: nextId("ratio-1-1"),
        xmin: 0.87,
        ymin: 0.94,
        xmax: 0.97,
        ymax: 0.98,
        label: "Bottom-Right Watermark (1:1)",
        confidence: 0.92,
        type: "text",
      };
    case "16:9":
      return {
        id: nextId("ratio-16-9"),
        xmin: 0.87,
        ymin: 0.9,
        xmax: 0.97,
        ymax: 0.96,
        label: "Bottom-Right Watermark (16:9)",
        confidence: 0.92,
        type: "text",
      };
    case "9:16":
      return {
        id: nextId("ratio-9-16"),
        xmin: 0.86,
        ymin: 0.97,
        xmax: 0.98,
        ymax: 0.99,
        label: "Bottom-Right Watermark (9:16)",
        confidence: 0.92,
        type: "text",
      };
  }
}

/** Watermark box for a named zone preset. */
export function getPresetBox(preset: PresetZone): WatermarkBox {
  const id = nextId(`preset-${preset}`);
  switch (preset) {
    case "bottom-right":
      return {
        id,
        xmin: 0.87,
        ymin: 0.94,
        xmax: 0.97,
        ymax: 0.98,
        label: "Bottom-Right Watermark",
        confidence: 0.9,
        type: "text",
      };
    case "bottom-left":
      return {
        id,
        xmin: 0.02,
        ymin: 0.89,
        xmax: 0.24,
        ymax: 0.98,
        label: "Bottom-Left Watermark",
        confidence: 0.88,
        type: "logo",
      };
    case "top-right":
      return {
        id,
        xmin: 0.76,
        ymin: 0.02,
        xmax: 0.98,
        ymax: 0.11,
        label: "Top-Right Stamp",
        confidence: 0.87,
        type: "stamp",
      };
    case "top-left":
      return {
        id,
        xmin: 0.02,
        ymin: 0.02,
        xmax: 0.24,
        ymax: 0.11,
        label: "Top-Left Logo",
        confidence: 0.86,
        type: "logo",
      };
    case "center":
      return {
        id,
        xmin: 0.3,
        ymin: 0.44,
        xmax: 0.7,
        ymax: 0.56,
        label: "Center Watermark Banner",
        confidence: 0.92,
        type: "text",
      };
    case "bottom-banner":
      return {
        id,
        xmin: 0.06,
        ymin: 0.92,
        xmax: 0.94,
        ymax: 0.98,
        label: "Bottom Footer Banner",
        confidence: 0.9,
        type: "text",
      };
  }
}

export interface CustomBox {
  /** 0.0–1.0 normalized coordinates (relative to image width/height). */
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  label?: string;
  confidence?: number;
  type?: string;
}

export interface DetectOptions {
  /** Use one of the 3 aspect-ratio presets. */
  ratio?: AspectRatio;
  /** Use a named zone preset. */
  preset?: PresetZone;
  /** Provide explicit normalized boxes. */
  boxes?: CustomBox[];
}

const DEFAULT_BOX: WatermarkBox = {
  id: "wm-default",
  ymin: 0.94,
  xmin: 0.87,
  ymax: 0.98,
  xmax: 0.97,
  label: "Bottom-Right Watermark",
  confidence: 0.75,
  type: "logo",
};

/**
 * Unified detection dispatcher (VLM-FREE, always instant).
 * Priority: boxes > ratio > preset > default bottom-right.
 *
 * `imageBase64` / `mimeType` are accepted for API backward-compatibility but
 * are NOT used (no image analysis happens — detection is coordinate-based).
 */
export async function detectWatermarks(
  _imageBase64?: string,
  _mimeType: string = "image/jpeg",
  options?: DetectOptions
): Promise<DetectionResult> {
  if (options?.boxes && options.boxes.length > 0) {
    return {
      watermarks: options.boxes.map((b, i) => ({
        id: `custom-${Date.now()}-${i + 1}`,
        ymin: Math.max(0, Math.min(1, Number(b.ymin))),
        xmin: Math.max(0, Math.min(1, Number(b.xmin))),
        ymax: Math.max(0, Math.min(1, Number(b.ymax))),
        xmax: Math.max(0, Math.min(1, Number(b.xmax))),
        label: b.label || `Custom Zone ${i + 1}`,
        confidence: Number(b.confidence ?? 1.0),
        type: b.type || "custom",
      })),
      source: "custom-boxes",
      message: "Using caller-provided boxes.",
    };
  }

  if (options?.ratio && VALID_RATIOS.includes(options.ratio)) {
    return {
      watermarks: [getWatermarkBoxForRatio(options.ratio)],
      source: "preset-ratio",
      message: `Using ${options.ratio} ratio preset.`,
    };
  }

  if (options?.preset && VALID_PRESETS.includes(options.preset)) {
    return {
      watermarks: [getPresetBox(options.preset)],
      source: "preset-zone",
      message: `Using ${options.preset} zone preset.`,
    };
  }

  // Default: bottom-right watermark (most common location)
  return {
    watermarks: [{ ...DEFAULT_BOX, id: `${DEFAULT_BOX.id}-${Date.now()}` }],
    source: "default",
    message: "No ratio/preset/boxes provided — using default bottom-right box.",
  };
}
