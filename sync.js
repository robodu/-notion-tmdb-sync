require('dotenv').config();
const { Client } = require('@notionhq/client');
const axios = require('axios');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID    = process.env.NOTION_DATABASE_ID;
const TMDB_KEY = process.env.TMDB_API_KEY;
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const REGION   = process.env.WATCH_REGION || 'US';

// ── TMDB helpers ──────────────────────────────────────────────────────────────

async function searchTMDB(title) {
  const res = await axios.get('https://api.themoviedb.org/3/search/multi', {
    headers: { Authorization: `Bearer ${TMDB_KEY}` },
    params:  { query: title, language: 'en-US', page: 1 },
  });
  return res.data.results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
}

async function getFullDetails(id, type) {
  const res = await axios.get(`https://api.themoviedb.org/3/${type}/${id}`, {
    headers: { Authorization: `Bearer ${TMDB_KEY}` },
    params:  { language: 'en-US', append_to_response: 'credits,watch/providers,videos' },
  });
  return res.data;
}

async function getSeasonEpisodes(showId, seasonNumber) {
  const res = await axios.get(
    `https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}`,
    {
      headers: { Authorization: `Bearer ${TMDB_KEY}` },
      params:  { language: 'en-US' },
    }
  );
  return res.data.episodes || [];
}

// ── Extractors ────────────────────────────────────────────────────────────────

const extractCast = d =>
  (d.credits?.cast || []).slice(0, 5).map(a => a.name).join(', ');

function extractDirector(d, type) {
  if (type === 'movie')
    return (d.credits?.crew || []).filter(c => c.job === 'Director')
           .map(c => c.name).join(', ') || 'Unknown';
  return (d.created_by || []).map(c => c.name).join(', ') || 'Unknown';
}

function extractProviders(d) {
  const p = d['watch/providers']?.results?.[REGION];
  if (!p) return null;
  const s = (p.flatrate || []).map(x => x.provider_name);
  const r = (p.rent     || []).map(x => x.provider_name);
  const parts = [];
  if (s.length) parts.push(`Stream: ${s.join(', ')}`);
  if (r.length) parts.push(`Rent: ${r.join(', ')}`);
  return parts.join(' | ') || null;
}

function extractTrailer(d) {
  const v = d.videos?.results || [];
  const t = v.find(x => x.site === 'YouTube' && x.type === 'Trailer' && x.official)
         || v.find(x => x.site === 'YouTube' && x.type === 'Trailer')
         || v.find(x => x.site === 'YouTube' && x.type === 'Teaser');
  return t ? `https://www.youtube.com/watch?v=${t.key}` : null;
}

function isAnime(d, type) {
  return type === 'tv'
    && (d.genres || []).some(g => g.id === 16)
    && (d.origin_country || []).includes('JP');
}

function label(d, type) {
  if (type === 'movie') return 'Movie';
  if (isAnime(d, type)) return 'Anime';
  return 'TV Series';
}

function isReleased(dateStr) {
  if (!dateStr) return false;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return new Date(dateStr) <= t;
}

// ── Notion page update ────────────────────────────────────────────────────────

async function updatePage(pageId, data) {
  const p = {
    Genres:   { multi_select: data.genres.map(g => ({ name: g })) },
    Score:    { number: data.score ? Math.round(data.score * 10) / 10 : null },
    Overview: { rich_text: [{ text: { content: data.overview?.slice(0, 2000) || '' } }] },
    Type:     { select: { name: data.type } },
    Status:   { status: { name: data.status } },
    Cast:     { rich_text: [{ text: { content: data.cast || '' } }] },
    Director: { rich_text: [{ text: { content: data.director || '' } }] },
    Synced:   { checkbox: true },
  };
  if (data.released)  p.Released = { date: { start: data.released } };
  if (data.runtime)   p.Runtime  = { number: data.runtime };
  if (data.poster)    p.Poster   = { url: data.poster };
  if (data.trailer)   p.Trailer  = { url: data.trailer };
  if (data.providers) p['Watch Providers'] =
    { rich_text: [{ text: { content: data.providers } }] };

  const payload = { page_id: pageId, properties: p };
  if (data.poster) payload.cover = { type: 'external', external: { url: data.poster } };

  await notion.pages.update(payload);
}

// ── Episode checklist builder ─────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

async function writeEpisodeChecklist(pageId, showId, seasons) {
  // Skip season 0 (Specials)
  const realSeasons = seasons.filter(s => s.season_number > 0);
  if (!realSeasons.length) return;

  const blocks = [];

  // Divider and header
  blocks.push({ type: 'divider', divider: {} });
  blocks.push({
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: 'Episode Tracker' } }],
      color: 'default',
    },
  });

  for (const season of realSeasons) {
    console.log(`    Fetching Season ${season.season_number}...`);
    const episodes = await getSeasonEpisodes(showId, season.season_number);

    // Season heading
    const seasonLabel = season.name && season.name !== `Season ${season.season_number}`
      ? `Season ${season.season_number} — ${season.name}`
      : `Season ${season.season_number}`;

    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: seasonLabel } }],
      },
    });

    // Episode checkboxes
    for (const ep of episodes) {
      const epLabel = `E${pad(ep.episode_number)} — ${ep.name}`;
      blocks.push({
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: epLabel } }],
          checked: false,
        },
      });
    }

    // Small delay between season fetches to stay within TMDB rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  // Notion allows max 100 blocks per append call — chunk if needed
  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + CHUNK),
    });
  }

  const total = blocks.filter(b => b.type === 'to_do').length;
  console.log(`    Added ${total} episode checkboxes across ${realSeasons.length} season(s).`);
}

// ── Main sync functions ───────────────────────────────────────────────────────

async function checkUpcoming() {
  console.log('Checking upcoming entries...');
  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'Status', status: { equals: 'Upcoming' } },
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const pg of res.results) {
    const d = pg.properties.Released?.date?.start;
    if (d && new Date(d) <= today) {
      const name = pg.properties.Name?.title?.[0]?.plain_text || '?';
      await notion.pages.update({
        page_id: pg.id,
        properties: { Status: { status: { name: 'Not Started' } } },
      });
      console.log(`  Flipped: "${name}" -> Not Started`);
    }
  }
}

async function syncNew() {
  console.log('Checking for unsynced entries...');
  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'Synced', checkbox: { equals: false } },
  });
  console.log(`Found ${res.results.length} unsynced.`);

  for (const pg of res.results) {
    const title = pg.properties.Name?.title?.[0]?.plain_text;
    if (!title) continue;
    console.log(`Syncing: "${title}"`);
    try {
      const hit = await searchTMDB(title);
      if (!hit) { console.log('  No result.'); continue; }

      const d   = await getFullDetails(hit.id, hit.media_type);
      const rel = d.release_date || d.first_air_date || null;
      const mediaLabel = label(d, hit.media_type);

      await updatePage(pg.id, {
        genres:    (d.genres || []).map(g => g.name),
        released:  rel,
        runtime:   hit.media_type === 'tv'
                   ? d.episode_run_time?.[0] || null : d.runtime || null,
        overview:  d.overview,
        score:     d.vote_average,
        poster:    d.poster_path ? `${IMG_BASE}${d.poster_path}` : null,
        type:      mediaLabel,
        status:    isReleased(rel) ? 'Not Started' : 'Upcoming',
        cast:      extractCast(d),
        director:  extractDirector(d, hit.media_type),
        providers: extractProviders(d),
        trailer:   extractTrailer(d),
      });

      // Write episode checklist for TV shows and anime
      if (hit.media_type === 'tv' && d.seasons?.length) {
        console.log(`  Writing episode checklist...`);
        await writeEpisodeChecklist(pg.id, hit.id, d.seasons);
      }

      console.log(`  Done: ${mediaLabel} | "${title}"`);
    } catch (e) { console.error(`  Error: ${e.message}`); }
  }
}

async function run() {
  console.log('-- Running sync --');
  await checkUpcoming();
  await syncNew();
  console.log('-- Done --');
}

run().then(() => process.exit(0));
