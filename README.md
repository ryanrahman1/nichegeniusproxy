# Genius API Proxy - Cloudflare Worker

A fast, edge-optimized Cloudflare Worker that proxies requests to the Genius API, parsing and returning clean JSON responses.

## Features

- ⚡ **Ultra-fast** - Runs on Cloudflare's edge network
- 🎵 **Song endpoint** - `/song/{songId}`
- 🎤 **Artist endpoint** - `/artist/{artistId}`
- 🔄 **CORS enabled** - Ready for frontend use
- 💾 **Caching** - Built-in HTTP caching headers
- 📦 **Lightweight** - No dependencies, pure JavaScript

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set your Genius API token:**
   ```bash
   npx wrangler secret put GENIUS_ACCESS_TOKEN
   ```
   Enter your Genius API access token when prompted.

3. **Configure your domain (optional):**
   Edit `wrangler.toml` and uncomment/update the `routes` section if you want to use a custom domain instead of `*.workers.dev`.

## Development

Run locally:
```bash
npm run dev
```

The worker will be available at `http://localhost:8787`

## Deployment

Deploy to Cloudflare:
```bash
npm run deploy
```

After deployment, your worker will be available at:
- `https://nichegeniusproxy.{your-subdomain}.workers.dev/song/{id}`
- `https://nichegeniusproxy.{your-subdomain}.workers.dev/artist/{id}`

Or on your custom domain if configured.

## API Endpoints

### Get Song
```
GET /song/{songId}
```

**Response:**
```json
{
  "artist_names": "Artist Name",
  "description": [...],
  "title": "Song Title",
  "language": "en",
  "release_date": "2024-01-01",
  "title_with_featured": "Song Title (feat. Artist)",
  "url": "https://genius.com/...",
  "primary_color": "#000000",
  "secondary_color": "#ffffff",
  "album": {
    "name": "Album Name",
    "primary_artist": "Artist Name",
    "release_date": "2024",
    "url": "https://genius.com/..."
  }
}
```

### Get Artist
```
GET /artist/{artistId}
```

**Response:**
```json
{
  "name": "Artist Name",
  "description": [...],
  "url": "https://genius.com/..."
}
```

## Description Format

The `description` field is a flattened array of blocks and spans:
- `paragraph` blocks contain `spans` with text, styles (bold/italic), and links
- `blockquote` blocks for quoted content
- `image` objects for embedded images

## Environment Variables

- `GENIUS_ACCESS_TOKEN` - Your Genius API access token (required)

Set via:
```bash
npx wrangler secret put GENIUS_ACCESS_TOKEN
```

## Performance

- Response time: < 100ms (typical)
- Cache: 1 hour HTTP cache
- Edge locations: 300+ worldwide
