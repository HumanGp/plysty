// TODO: improve the playlist scan, support a config playlist file when there is no existing music files.
// - update and improve music recommendations

import fs, { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { Singleton } from './singleton.js';


const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ALBUM = 'Unknown Album';
const UNKNOWN_GENRE = 'Unknown Genre';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

// Genres/tags that are effectively "no signal" (YouTube categories, catch-alls)
const JUNK_GENRES = /^(people & blogs|music|entertainment|other|unknown|unknown genre)$/i;

// Artist strings like "ArrDee, LeoStayTrill" or "venbee, goddard., ArrDee"
// need splitting so the same artist aggregates under one key.
const ARTIST_SPLIT = /\s*(?:,|&|feat\.?|ft\.?|×)\s*/i;


function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function splitArtists(str) {
  if (!str) return [];
  return str
    .split(ARTIST_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isUnknown(value) {
  return !value || /^unknown\b/i.test(value);
}

export class FileService extends Singleton {
  #playlistDirPath;
  #outputDirPath;

  static AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav']);

  /**
   * @param {string} directoryPath  Source directory containing audio files.
   * @param {object} [options]
   * @param {string} [options.outputDirPath]  Optional scratch dir for generated playlists.
   *                                          Defaults to a sibling of the source dir.
   */
  constructor(directoryPath) {
    super();
    if (!directoryPath || typeof directoryPath !== 'string') {
      throw new TypeError('directoryPath must be a non-empty string');
    }
    this.#playlistDirPath = path.join(process.cwd(), directoryPath);

    console.log(this.#playlistDirPath);
  }

  get sourceDir() {
    return this.#playlistDirPath;
  }

  get outputDir() {
    return this.#outputDirPath;
  }

  /**
 * Fetch similar tracks from Last.fm based on the taste map.
 * @param {object} tasteMap - The artist bucket from getTasteProfile().tasteMap
 * @param {string[]} existingArtists - All artists currently in library (to exclude)
 * @param {object} opts
 * @param {number} [opts.limitPerArtist=3] - Similar tracks per seed artist
 * @param {number} [opts.maxArtists=5] - How many top artists to use as seeds
 * @returns {Promise<Array<{artist: string, title: string, match: number, url: string}>>}
 */
  async getRecommendations(tasteMap, existingArtists = [], { limitPerArtist = 3, maxArtists = 5 } = {}) {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) throw new Error('LASTFM_API_KEY not set');

    // 1. Pick top artists by score
    const seedArtists = Object.entries(tasteMap.artist)
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxArtists)
      .map(([name]) => name);

    const normalizedExisting = new Set(
      existingArtists.map(a => a.toLowerCase().trim())
    );

    const recommendations = [];
    const seen = new Set();

    for (const artist of seedArtists) {
      try {
        // 2. Get similar artists first (broader discovery)
        const similarUrl = new URL(LASTFM_BASE);
        similarUrl.searchParams.set('method', 'artist.getSimilar');
        similarUrl.searchParams.set('artist', artist);
        similarUrl.searchParams.set('api_key', apiKey);
        similarUrl.searchParams.set('format', 'json');
        similarUrl.searchParams.set('limit', String(limitPerArtist * 2));

        const res = await fetch(similarUrl);
        if (!res.ok) continue;
        const data = await res.json();
        const similar = data.similarartists?.artist ?? [];

        for (const s of similar) {
          const candidateName = s.name?.toLowerCase().trim();
          if (!candidateName || normalizedExisting.has(candidateName)) continue;
          if (seen.has(candidateName)) continue;

          // 3. Get a top track from this similar artist
          const trackUrl = new URL(LASTFM_BASE);
          trackUrl.searchParams.set('method', 'artist.getTopTracks');
          trackUrl.searchParams.set('artist', s.name);
          trackUrl.searchParams.set('api_key', apiKey);
          trackUrl.searchParams.set('format', 'json');
          trackUrl.searchParams.set('limit', '1');

          const trackRes = await fetch(trackUrl);
          if (!trackRes.ok) continue;
          const trackData = await trackRes.json();
          const topTrack = trackData.toptracks?.track?.[0];

          if (topTrack) {
            const key = `${s.name}|${topTrack.name}`.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              recommendations.push({
                artist: s.name,
                title: topTrack.name,
                match: parseFloat(s.match) || 0,
                url: topTrack.url || '',
                sourceArtist: artist, // which seed led here
              });
            }
          }

          if (recommendations.length >= maxArtists * limitPerArtist) break;
        }

        // Respect Last.fm rate limit (~5 req/sec)
        await new Promise(r => setTimeout(r, 250));

      } catch (err) {
        console.warn(`Recommendation fetch failed for ${artist}:`, err.message);
      }
    }

    return recommendations;
  }

  // 1. recursive scan -> array of file paths
  async #scanMusicFolder(dir) {
    const found = [];
    const walk = async (current) => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (
          entry.isFile() &&
          FileService.AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())
        ) {
          found.push(full);
        }
      }
    };
    await walk(path.resolve(dir));
    return found;
  }

  // 2. file paths -> array of song metadata objects
  async #extractSongMetadata(files) {
    const songs = [];
    for (const file of files) {
      try {
        const meta = await parseFile(file, { duration: false });
        const c = meta.common ?? {};
        songs.push({
          file,
          title: c.title ?? path.basename(file),
          artist: c.artist ?? c.albumartist ?? UNKNOWN_ARTIST,
          album: c.album ?? UNKNOWN_ALBUM,
          genre: (c.genre && c.genre[0]) ?? UNKNOWN_GENRE,
          year: c.year ?? null,
        });
      } catch (err) {
        songs.push({ file, error: err.message });
      }
    }
    return songs;
  }

  // 3. songs -> normalized taste map (with unknown-tracking + confidence)
  #buildTasteMap(
    songs,
    weights = { artist: 3, genre: 2, album: 1, year: 0.5 }
  ) {
    const raw = { artist: {}, genre: {}, album: {}, year: {} };
    const unknown = { artist: 0, genre: 0, album: 0, year: 0 };

    const bump = (bucket, key, amount, unknownKey) => {
      if (isUnknown(key)) {
        unknown[unknownKey]++;
        return;
      }
      bucket[key] = (bucket[key] ?? 0) + amount;
    };

    let totalSongs = 0;
    let scoredSongs = 0;

    for (const s of songs) {
      if (s.error) continue;
      totalSongs++;

      const hasArtist = !isUnknown(s.artist);
      const hasGenre = !isUnknown(s.genre) && !JUNK_GENRES.test(s.genre);
      const hasAlbum = !isUnknown(s.album);

      // A song only contributes to taste if it carries at least one real signal
      if (hasArtist || hasGenre || hasAlbum) scoredSongs++;

      // Artist: split "A, B feat. C" into individual artists
      if (hasArtist) {
        for (const name of splitArtists(s.artist)) {
          bump(raw.artist, name, weights.artist, 'artist');
        }
      } else {
        unknown.artist++;
      }

      // Genre: skip junk categories entirely
      if (hasGenre) {
        bump(raw.genre, s.genre, weights.genre, 'genre');
      } else {
        unknown.genre++;
      }

      if (hasAlbum) {
        bump(raw.album, s.album, weights.album, 'album');
      } else {
        unknown.album++;
      }

      if (s.year) {
        raw.year[s.year] = (raw.year[s.year] ?? 0) + weights.year;
      } else {
        unknown.year++;
      }
    }

    const normalize = (bucket) => {
      const max = Math.max(0, ...Object.values(bucket));
      if (max === 0) return bucket;
      return Object.fromEntries(
        Object.entries(bucket).map(([k, v]) => [k, +(v / max).toFixed(3)])
      );
    };

    const safeRatio = (n) => (totalSongs === 0 ? 0 : +(n / totalSongs).toFixed(2));

    return {
      totalSongs,
      scoredSongs,
      unknownTagged: unknown,
      confidence: {
        artist: safeRatio(totalSongs - unknown.artist),
        genre: safeRatio(totalSongs - unknown.genre),
        album: safeRatio(totalSongs - unknown.album),
        year: safeRatio(totalSongs - unknown.year),
      },
      artist: normalize(raw.artist),
      genre: normalize(raw.genre),
      album: normalize(raw.album),
      year: normalize(raw.year),
    };
  }

  // top-level helper: sorts by score, returns { name, score } with raw counts
  #top(bucket, n) {
    return Object.entries(bucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, score]) => ({ name, score }));
  }

  /**
   * Remove the generated output directory. Never touches the source directory.
   */
  async cleanStalePlaylist() {
    if (this.#outputDirPath === this.#playlistDirPath) {
      throw new Error('Refusing to delete: output dir equals source dir');
    }
    if (path.parse(this.#outputDirPath).root === this.#outputDirPath) {
      throw new Error('Refusing to delete: output dir is a filesystem root');
    }
    await fs.rm(this.#outputDirPath, { recursive: true, force: true });
  }

  /**
   * Scan a folder recursively, read tags, and return a JSON-serializable
   * taste profile with confidence metrics.
   *
   * @param {string} [dir]  Folder to scan (defaults to `this.sourceDir`).
   * @param {object} [options]
   * @param {number} [options.topN=5]
   */
  async getTasteProfile(dir = this.sourceDir, { topN = 5 } = {}) {
    const files = await this.#scanMusicFolder(dir);
    const songs = await this.#extractSongMetadata(files);
    const tasteMap = this.#buildTasteMap(songs);

    return {
      scannedAt: new Date().toISOString(),
      folder: path.resolve(dir),
      totalSongs: tasteMap.totalSongs,
      scoredSongs: tasteMap.scoredSongs,
      unknownTagged: tasteMap.unknownTagged,
      confidence: tasteMap.confidence,
      topArtists: this.#top(tasteMap.artist, topN),
      topGenres: this.#top(tasteMap.genre, topN),
      topAlbums: this.#top(tasteMap.album, topN),
      topYears: this.#top(tasteMap.year, topN),
      tasteMap: {
        artist: tasteMap.artist,
        genre: tasteMap.genre,
        album: tasteMap.album,
        year: tasteMap.year,
      },
    };
  }
}
