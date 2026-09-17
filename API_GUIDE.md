# Guide complet — API VibesAI via WebAPI

**Base URL :** `https://nelcia2.space-z.ai`

Toutes les routes sont sous `/api/vibes/*`. Aucune authentification requise côté client.

---

## CATÉGORIE 1: PROJECTS (Gestion de projets)

### Créer un projet
```http
POST /api/vibes/projects
Content-Type: application/json

{ "name": "Mon projet" }
```
```json
{ "id": "9694ef59-29f1-4a43-ad72-9499b568f4ce", "name": "Mon projet", "exportStatus": "draft" }
```

### Lister les projets
```http
GET /api/vibes/projects?limit=25&offset=0&sort=newest&search=
```

### Obtenir un projet
```http
GET /api/vibes/projects/{project_id}
```

### Mettre à jour
```http
PUT /api/vibes/projects/{project_id}
{ "name": "Nouveau nom" }
```

### Supprimer
```http
DELETE /api/vibes/projects/{project_id}?deleteAssets=false
```

---

## CATÉGORIE 2: GÉNÉRATION D'IMAGES (Synchrone — ~15s)

### 2a. Générer une image
```http
POST /api/vibes/images/generate
Content-Type: application/json

{
  "project_id": "<project-id>",
  "prompt": "a majestic eagle soaring over snowy mountains at sunset",
  "aspect_ratio": "16:9",
  "variations": 1,
  "resolution": "480p"
}
```
```json
{
  "success": true,
  "data": [{ "imageEntId": "13599...", "url": "https://scontent-..." }]
}
```

**Paramètres :**
- `aspect_ratio`: `"16:9"` (landscape), `"9:16"` (portrait), `"1:1"` (square)
- `variations`: 1 à 4
- `resolution`: `"480p"` (rapide) ou `"720p"` (haute qualité)

### 2b. Éditer une image
```http
POST /api/vibes/images/edit
Content-Type: application/json

{
  "source_image_ent_id": "<imageEntId>",
  "edit_prompt": "make it look like an oil painting",
  "project_id": "<project-id>"
}
```

### 2c. Upload d'image (multipart)
```http
POST /api/vibes/upload/media
Content-Type: multipart/form-data

file: <binary>
filename: test.png
project_id: <project-id>
```
```json
{
  "mediaEntId": "13599...",
  "imageUrl": "https://scontent-...",
  "uploadToken": "...",
  "contentItemId": "yGNKxhFPzr05aBEy3aRrZ",
  "sourceImageEntId": "13599...",
  "registered": true
}
```

---

## CATÉGORIE 3: GÉNÉRATION DE VIDÉOS (Asynchrone — ~30-90s)

### 3a. Générer une vidéo (t2v)
```http
POST /api/vibes/videos/generate
Content-Type: application/json

{
  "project_id": "<project-id>",
  "prompt": "ocean waves crashing on rocky shore at sunset",
  "aspect_ratio": "16:9",
  "resolution": "480p",
  "variations": 1,
  "poll": false
}
```
```json
{ "batchId": "batch-01a0b134-4e6b-762d-a92e-a6f5f271e1fb", "needsPolling": true }
```

### 3b. Polling (vérifier le statut)
```http
POST /api/vibes/batches/{batchId}/poll?timeout=180
```
```json
{
  "id": "batch-...",
  "isComplete": true,
  "content": [{ "id": "...", "videoUrl": "https://video-sin..." }]
}
```

### 3c. Animer une image (i2v)
```http
POST /api/vibes/videos/animate
Content-Type: application/json

{
  "project_id": "<project-id>",
  "batch_id": "<batch-id>",
  "content_id": "<content-id>",
  "prompt": "camera slowly zooms in",
  "poll": false
}
```

Pour une image **uploadée** :
```json
{
  "project_id": "<project-id>",
  "source_image": {
    "id": "<contentItemId>",
    "imageUrl": "https://...",
    "mediaEntId": "<mediaEntId>",
    "prompt": "uploaded image"
  },
  "prompt": "gentle motion",
  "poll": false
}
```

### 3d. Start/End Frame Video (interpolation)
```http
POST /api/vibes/videos/generate
{
  "project_id": "<project-id>",
  "prompt": "the rose slowly wilts",
  "aspect_ratio": "16:9",
  "start_frame": {
    "oil_handle": "<mediaEntId>",
    "image_url": "https://...",
    "image_ent_id": "<mediaEntId>"
  },
  "end_frame": { ... },
  "poll": false
}
```

---

## CATÉGORIE 4: TEXT TO SPEECH (TTS)

### Lister les voix
```http
GET /api/vibes/voices
```
```json
{ "voices": [{ "id": "play_ai_Marisol", "name": "Marisol" }, ...] }
```

### Synthétiser
```http
POST /api/vibes/tts
{ "text": "Hello, welcome!", "voice": "play_ai_Marisol", "output_format": "mp3" }
```
```json
{ "audioBase64": "SUQzBAAAAA...", "contentType": "audio/mpeg" }
```

---

## CATÉGORIE 5: WATERMARK REMOVAL

```http
POST /api/vibes/watermark/clean
{ "image_url": "https://scontent-..." }
```
→ Retourne PNG binaire sans le watermark Meta AI

---

## CATÉGORIE 6: MEDIA & DOWNLOADS

### Lister la bibliothèque
```http
GET /api/vibes/media?limit=50&offset=0&type=&search=
```

### Télécharger
```http
GET /api/vibes/media/{contentId}/download?type=video
GET /api/vibes/media/{contentId}/download?type=image&clean=true
```

---

## CATÉGORIE 7: STUDIO

### Ingrédients
```http
GET /api/vibes/ingredients?owner_filter=LIBRARY&ingredient_type=CHARACTER
POST /api/vibes/ingredients
DELETE /api/vibes/ingredients/{id}
```

### Moodboards
```http
GET /api/vibes/moodboards
```

### Musique
```http
GET /api/vibes/music/search?q=lofi&limit=30
```

---

## CATÉGORIE 8: TIMELINE & PUBLISHING

### Timeline chat (assistant IA)
```http
POST /api/vibes/timeline/chat
{ "input": "add a 5 second sunset clip" }
```

### Exporter en MP4
```http
POST /api/vibes/timeline/export?project_id=<id>
{ "composition": { "tracks": [], "duration": 30 } }
```

### Publier
```http
POST /api/vibes/publish
{ "content_item_id": "<id>", "caption": "My post" }
```

---

## CATÉGORIE 9: UTILITIES

### Améliorer un prompt
```http
POST /api/vibes/prompts/enhance
{ "prompt": "a cat" }
```
```json
{ "variations": [{ "image": "...", "video": "..." }, ...] }
```

### Parser les paramètres Midjourney
```http
POST /api/vibes/utils/parse-midjourney
{ "prompt": "a cat --ar 16:9 --v 6.0 --chaos 50" }
```
```json
{
  "cleanPrompt": "a cat",
  "parameters": { "aspect_ratio": "16:9", "version": 6, "chaos": 50 }
}
```

---

## Exemples de code

### JavaScript
```javascript
const API = 'https://nelcia2.space-z.ai/api/vibes'

// 1. Create project
const { id: pid } = await fetch(`${API}/projects`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My App' })
}).then(r => r.json())

// 2. Generate image (SYNC)
const { data } = await fetch(`${API}/images/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project_id: pid, prompt: 'a cat', aspect_ratio: '1:1' })
}).then(r => r.json())
console.log('Image:', data[0].url)

// 3. Generate video (ASYNC)
const { batchId } = await fetch(`${API}/videos/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project_id: pid, prompt: 'sunset', poll: false })
}).then(r => r.json())

// 4. Poll until complete
const batch = await fetch(`${API}/batches/${batchId}/poll?timeout=180`, {
  method: 'POST'
}).then(r => r.json())
console.log('Video:', batch.content[0].videoUrl)
```

### Python
```python
import requests
API = 'https://nelcia2.space-z.ai/api/vibes'

# 1. Create project
pid = requests.post(f'{API}/projects', json={'name': 'My App'}).json()['id']

# 2. Generate image (SYNC)
img = requests.post(f'{API}/images/generate', json={
    'project_id': pid, 'prompt': 'a cat', 'aspect_ratio': '1:1'
}).json()
print('Image:', img['data'][0]['url'])

# 3. Generate video (ASYNC)
video = requests.post(f'{API}/videos/generate', json={
    'project_id': pid, 'prompt': 'sunset', 'poll': False
}).json()

# 4. Poll
batch = requests.post(f'{API}/batches/{video["batchId"]}/poll?timeout=180').json()
print('Video:', batch['content'][0]['videoUrl'])

# 5. Download
video_bytes = requests.get(
    f'{API}/media/{batch["content"][0]["id"]}/download?type=video'
).content
open('video.mp4', 'wb').write(video_bytes)
```

### cURL
```bash
# Create project
PID=$(curl -s -X POST https://nelcia2.space-z.ai/api/vibes/projects \
  -H "Content-Type: application/json" -d '{"name":"Test"}' | jq -r .id)

# Generate image
curl -s -X POST https://nelcia2.space-z.ai/api/vibes/images/generate \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"prompt\":\"a cat\",\"aspect_ratio\":\"1:1\"}"

# Generate video + poll
BID=$(curl -s -X POST https://nelcia2.space-z.ai/api/vibes/videos/generate \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"prompt\":\"sunset\",\"poll\":false}" | jq -r .batchId)

curl -s -X POST "https://nelcia2.space-z.ai/api/vibes/batches/$BID/poll?timeout=180"

# Download
curl -o video.mp4 "https://nelcia2.space-z.ai/api/vibes/media/$CID/download?type=video"
```
