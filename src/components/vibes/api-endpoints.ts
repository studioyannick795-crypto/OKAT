/**
 * Static catalogue of all 33 VibesAI API routes exposed under /api/vibes/*.
 * Used by the "API Reference" tab in the dashboard.
 */
export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  description: string
  category:
    | 'Core'
    | 'Projects'
    | 'Generation'
    | 'Media'
    | 'Batches'
    | 'Studio'
    | 'Ingredients'
    | 'Timeline'
    | 'Publishing'
    | 'Utilities'
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  { method: 'GET', path: '/api/vibes', category: 'Core', description: 'Root info — name, version and docs path.' },
  { method: 'GET', path: '/api/vibes/health', category: 'Core', description: 'Health check — pings vibes.ai and returns the authenticated user.' },
  { method: 'GET', path: '/api/vibes/me', category: 'Core', description: 'Current user profile (id, username, account status, roles).' },
  { method: 'GET', path: '/api/vibes/check-token', category: 'Core', description: 'Verify the VIBES_META_SESSION cookie is valid.' },
  { method: 'GET', path: '/api/vibes/current-cookie', category: 'Core', description: 'Echo the configured meta session cookie.' },

  { method: 'GET', path: '/api/vibes/projects', category: 'Projects', description: 'List projects (limit / offset / sort / search).' },
  { method: 'POST', path: '/api/vibes/projects', category: 'Projects', description: 'Create a project { name, composition? }.' },
  { method: 'GET', path: '/api/vibes/projects/[pid]', category: 'Projects', description: 'Get / put / delete a single project.' },
  { method: 'PUT', path: '/api/vibes/projects/[pid]', category: 'Projects', description: 'Update project name / composition.' },
  { method: 'DELETE', path: '/api/vibes/projects/[pid]', category: 'Projects', description: 'Delete a project (?deleteAssets=true).' },
  { method: 'POST', path: '/api/vibes/projects/[pid]/upload', category: 'Projects', description: 'Register uploaded files as content items in a project.' },

  { method: 'POST', path: '/api/vibes/videos/generate', category: 'Generation', description: 'Generate video variations (t2v). poll=false returns batchId fast.' },
  { method: 'POST', path: '/api/vibes/videos/extend', category: 'Generation', description: 'Extend an existing video clip by ~5 seconds.' },
  { method: 'POST', path: '/api/vibes/videos/edit', category: 'Generation', description: 'Edit a video with a text prompt (v2v).' },
  { method: 'POST', path: '/api/vibes/videos/animate', category: 'Generation', description: 'Animate a still image into a video (i2v). Accepts source_image or batch_id.' },
  { method: 'POST', path: '/api/vibes/images/generate', category: 'Generation', description: 'Synchronous image generation — returns URLs immediately.' },
  { method: 'POST', path: '/api/vibes/images/edit', category: 'Generation', description: 'Edit an existing image with a prompt.' },
  { method: 'POST', path: '/api/vibes/upload/image', category: 'Generation', description: 'Upload a base64-encoded image (no uploadToken).' },
  { method: 'POST', path: '/api/vibes/upload/media', category: 'Generation', description: 'Upload image via multipart + register in project (returns uploadToken, enables editing).' },
  { method: 'POST', path: '/api/vibes/prompts/enhance', category: 'Generation', description: 'Enhance a prompt into multiple variations.' },
  { method: 'POST', path: '/api/vibes/watermark/clean', category: 'Generation', description: 'Remove Meta AI watermark from an image (server-side sharp mirror+blur, or client-side OpenCV.js).' },
  { method: 'GET', path: '/api/vibes/image-proxy', category: 'Generation', description: 'Proxy an image URL with CORS headers (for OpenCV.js canvas readback).' },

  { method: 'GET', path: '/api/vibes/voices', category: 'Studio', description: 'List all 41 PlayAI TTS voices.' },
  { method: 'POST', path: '/api/vibes/tts', category: 'Studio', description: 'Synthesize speech { text, voice, output_format? }.' },

  { method: 'GET', path: '/api/vibes/media', category: 'Media', description: 'List media library (limit / offset / type / search).' },
  { method: 'DELETE', path: '/api/vibes/media/[itemId]', category: 'Media', description: 'Delete a single media item.' },
  { method: 'GET', path: '/api/vibes/media/[itemId]/download', category: 'Media', description: 'Download binary media (?type=video|image, ?clean=true for watermark removal).' },

  { method: 'GET', path: '/api/vibes/batches', category: 'Batches', description: 'List generation batches (limit / offset / project_id).' },
  { method: 'GET', path: '/api/vibes/batches/[bid]', category: 'Batches', description: 'Fetch full batch state incl. content items.' },
  { method: 'POST', path: '/api/vibes/batches/[bid]/poll', category: 'Batches', description: 'Poll a batch until complete (?timeout=180).' },

  { method: 'GET', path: '/api/vibes/ingredients', category: 'Ingredients', description: 'List ingredients (?owner_filter / ?ingredient_type).' },
  { method: 'POST', path: '/api/vibes/ingredients', category: 'Ingredients', description: 'Create a new ingredient.' },
  { method: 'DELETE', path: '/api/vibes/ingredients/[iid]', category: 'Ingredients', description: 'Delete an ingredient.' },
  { method: 'GET', path: '/api/vibes/moodboards', category: 'Ingredients', description: 'List moodboards.' },

  { method: 'POST', path: '/api/vibes/timeline/chat', category: 'Timeline', description: 'Conversational timeline builder (SSE events).' },
  { method: 'POST', path: '/api/vibes/timeline/export', category: 'Timeline', description: 'Render a composition to MP4 (binary response).' },

  { method: 'POST', path: '/api/vibes/publish', category: 'Publishing', description: 'Publish content to a feed (?caption / audio_types).' },
  { method: 'POST', path: '/api/vibes/lipsync', category: 'Publishing', description: 'Generate a lip-synced video from an image + audio.' },
  { method: 'GET', path: '/api/vibes/music/search', category: 'Studio', description: 'Search the music library (?q=).' },
  { method: 'POST', path: '/api/vibes/utils/parse-midjourney', category: 'Utilities', description: 'Parse Midjourney parameters out of a prompt.' },
  { method: 'POST', path: '/api/vibes/utils/validate-prompt', category: 'Utilities', description: 'Validate prompt length constraints.' },
]

export const API_CATEGORIES: ApiEndpoint['category'][] = [
  'Core',
  'Projects',
  'Generation',
  'Media',
  'Batches',
  'Studio',
  'Ingredients',
  'Timeline',
  'Publishing',
  'Utilities',
]
