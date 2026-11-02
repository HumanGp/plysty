# plsty

A cron script I wrote because I got tired of hearing the same songs. Runs on weekend nights, nukes the old playlist, builds a new one, shuffles it. That's it.

Entry point is `index.js`. Services live in `services/` — I keep related logic bundled together there. Still rough around the edges.

## Why it's weird

I can't afford to pay for music APIs (and the devs get the coffee money, not the artists anyway), so the script botifies my Telegram account and pulls audio from Telegram bots. It runs as me. Fetches files, saves them to the playlist folder. Done.

The recommender is just a wrapped fetch to Last.fm. Not smart. Works-ish. If you know a better way, PRs welcome.

## Setup

Drop these in `.env`:

```txt
LASTFM_API_KEY=
LASTFM_SHARED_SECRET=
APP_API_ID=
APP_API_HASH=
SESSION_STRING=
```
First four you grab from Last.fm and [my.telegram.org](https://my.telegram.org). Leave `SESSION_STRING` empty first time.

Run it once:

```bash
node index.js
```

It'll walk you through Telegram auth (phone, code, 2FA if you have it), then spits out a SESSION_STRING. Paste that into .env. From then on it runs non-interactive.

Don't commit .env. That session string is your whole account.

## Running it
Give it a config (your taste seeds) and it builds from that. Give it nothing and it scans the existing playlist folder and figures out taste from there. Either way: old playlist gone, new one built, shuffled, saved.

## Cron
Give it a config (your taste seeds) and it builds from that. Give it nothing and it scans the existing playlist folder and figures out taste from there. Either way: old playlist gone, new one built, shuffled, saved.


```
0 23 * * 6,0  cd /path/to/project && node index.js >> logs/cron.log 2>&1
```

## Data shapes
The network layer (Last.fm + Telegram) spits out a few plain objects that the rest of the pipeline consumes. If you're poking at services/ or writing your own renderers, here's what you get back.

** Taste profile**
What the scanner returns after digesting a folder (or a config). Consumed by formatTasteProfile.

```JS 
{
  folder: '/path/to/playlist',
  scannedAt: '2026-11-02T21:00:00.000Z',
  totalSongs: 128,
  scoredSongs: 94,
  confidence: {
    artist: 0.82,   // 0..1
    genre:  0.41,
    album:  0.55,
    year:   0.30,
  },
  topArtists: [ { name: 'Burial', score: 0.93 }, ... ],  // score 0..1
  topAlbums:  [ { name: 'Untrue', score: 0.71 }, ... ],
  topYears:   [ { name: '2017',   score: 0.44 }, ... ],
  topGenres:  [ { name: 'dubstep', score: 0.38 }, ... ], // may be empty
}
```

Empty topGenres (or any section) means the library has no usable tags — the renderer prints — no data (untagged library) — instead of crashing.

**propasals**
The list of candidate tracks the recommender wants to download. Consumed by formatProposals. Each item:

```js 
{
  artist: 'Burial',
  title: 'Archangel',
  sourceArtist: 'Burial',  // seed that surfaced this track; null if unknown
  match: 0.87,             // 0..1 relevance score from Last.fm
}
```

match is just whatever the Last.fm wrapper computes — treat it as a hint, not a guarantee. sourceArtist is what gets shown in the via … column so you can see why a track showed up.

**Download manifest**
What the downloader accumulates while pulling files from Telegram bots. Consumed by formatDownloadSummary.

```js 
{
  downloaded: [
    { artist: 'Burial', title: 'Archangel', path: '/path/to/playlist/Burial - Archangel.mp3' },
    ...
  ],
  failed: [
    { artist: '...', title: '...', reason: 'no bot match' | 'timeout' | ... },
    ...
  ],
}
```
```
```

```
```

downloaded.length + failed.length is the total attempted. Each failed entry keeps a human-readable reason so the summary can list them line by line.

**Per-track download event**
Streamed one line at a time during download. Consumed by formatDownloadLine.

```js 
{
  index: 3,          // 1-based
  total: 25,
  track: { artist: 'Burial', title: 'Archangel' },
  status: 'start' | 'ok' | 'retry' | 'fail',
  detail: 'saved to /path/...' | 'retry 2/3' | 'no bot match' | '',
}
```
```
```
```
```

