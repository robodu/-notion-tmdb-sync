# Notion × TMDB Auto-Sync

Automatically populates your Notion movie/TV/anime database from TMDB every 15 minutes via GitHub Actions.

## What it syncs
Genres, Score, Overview, Type (Movie/TV Series/Anime), Status, Released, Runtime, Poster, Cast, Director, Watch Providers, Trailer

## Setup

### 1. Notion Integration Token
1. Go to **app.notion.com/profile/integrations**
2. Click **New integration** → name it "TMDB Sync" → Save
3. Copy the token — it starts with **ntn_**

### 2. Connect integration to your database
1. Open your Notion database
2. Click **···** → **Connections** → **Add connection** → select TMDB Sync

### 3. Get your Database ID
Browser URL: `https://notion.so/workspace/[DATABASE_ID]?v=...`
Copy the string between the last `/` and `?v=`

### 4. TMDB API Key
1. Create a free account at **themoviedb.org**
2. Settings → API → copy the **Read Access Token** (starts with `eyJ...`)

### 5. GitHub Actions Setup
1. Push this repo to a **private** GitHub repository
2. Go to Settings → Secrets and variables → Actions
3. Add these secrets:
   - `NOTION_TOKEN` — your ntn_... token
   - `NOTION_DATABASE_ID` — your database ID
   - `TMDB_API_KEY` — your TMDB Read Access Token
   - `WATCH_REGION` — 2-letter code (NG, US, GB...)
4. Go to Actions tab → Enable workflows → Run workflow manually to test

## Usage
Add a title to the Name column in Notion, leave **Synced** unchecked. The script picks it up within 15 minutes.

---
> This product uses the TMDB API but is not endorsed or certified by TMDB.
