// ====================== printing helpers 

// print propasals 
export const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

export function formatTasteProfile(profile) {
  const isConfig = profile.source === 'config';

  const bar = (score) => {
    const filled = Math.round(score * 10);
    return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  };
  const pct = (n) => `${Math.round(n * 100)}%`;

  const lines = [];
  lines.push('');
  lines.push(`${C.bold}${C.cyan}┌─ TASTE PROFILE ─────────────────────────────────────────${C.reset}`);
  lines.push(`${C.cyan}│${C.reset}  ${C.dim}source${C.reset}     ${isConfig ? `${C.magenta}config${C.reset}` : 'folder scan'
    }`);
  if (profile.folder) {
    lines.push(`${C.cyan}│${C.reset}  ${C.dim}folder${C.reset}     ${profile.folder}`);
  }
  lines.push(`${C.cyan}│${C.reset}  ${C.dim}scanned${C.reset}    ${profile.scannedAt}`);

  if (isConfig) {
    lines.push(`${C.cyan}│${C.reset}  ${C.dim}artists${C.reset}    ${C.bold}${profile.topArtists.length}${C.reset} ${C.dim}(declared)${C.reset}`);
  } else {
    lines.push(`${C.cyan}│${C.reset}  ${C.dim}songs${C.reset}      ${C.bold}${profile.totalSongs}${C.reset}  ${C.dim}(scored: ${profile.scoredSongs})${C.reset}`);

    const conf = profile.confidence;
    const confColor = (v) => v >= 0.7 ? C.green : v >= 0.4 ? C.yellow : C.red;
    lines.push(`${C.cyan}│${C.reset}  ${C.dim}confidence${C.reset} ${confColor(conf.artist)}artist ${pct(conf.artist)}${C.reset}  ${confColor(conf.genre)}genre ${pct(conf.genre)}${C.reset}  ${confColor(conf.album)}album ${pct(conf.album)}${C.reset}  ${confColor(conf.year)}year ${pct(conf.year)}${C.reset}`);
  }

  const section = (title, entries) => {
    lines.push(`${C.cyan}│${C.reset}`);
    lines.push(`${C.cyan}│${C.reset}  ${C.bold}${title}${C.reset}`);
    if (entries.length === 0) {
      lines.push(`${C.cyan}│${C.reset}    ${C.dim}— no data —${C.reset}`);
      return;
    }
    for (const { name, score } of entries) {
      const label = name.padEnd(22).slice(0, 22);
      lines.push(`${C.cyan}│${C.reset}    ${label} ${C.green}${bar(score)}${C.reset} ${C.dim}${score.toFixed(2)}${C.reset}`);
    }
  };

  section('Top artists', profile.topArtists);
  section('Top albums', profile.topAlbums);
  section('Top years', profile.topYears);
  if (profile.topGenres.length) section('Top genres', profile.topGenres);

  lines.push(`${C.cyan}└──────────────────────────────────────────────────────────${C.reset}`);
  lines.push('');
  return lines.join('\n');
}

export function formatProposals(proposals) {
  const lines = [];
  lines.push('');
  lines.push(`${C.bold}${C.magenta}┌─ PROPOSED TRACKS (${proposals.length}) ─────────────────────────────${C.reset}`);

  // Column widths
  const idxW = String(proposals.length).length;
  const artistW = Math.min(20, Math.max(...proposals.map(p => p.artist.length)));
  const titleW = Math.min(40, Math.max(...proposals.map(p => p.title.length)));
  const seedW = Math.min(14, Math.max(...proposals.map(p => (p.sourceArtist ?? '').length)));

  for (const [i, p] of proposals.entries()) {
    const idx = String(i + 1).padStart(idxW);
    const artist = p.artist.padEnd(artistW).slice(0, artistW);
    const title = p.title.padEnd(titleW).slice(0, titleW);
    const seed = (p.sourceArtist ?? '—').padEnd(seedW).slice(0, seedW);

    // Match score with color
    const m = p.match ?? 0;
    const matchColor = m >= 0.8 ? C.green : m >= 0.5 ? C.yellow : C.dim;
    const match = matchColor + m.toFixed(2) + C.reset;

    lines.push(`${C.magenta}│${C.reset} ${C.dim}${idx}.${C.reset}  ${C.bold}${artist}${C.reset} ${C.dim}—${C.reset} ${title}  ${match}  ${C.dim}via ${seed}${C.reset}`);
  }

  lines.push(`${C.magenta}└──────────────────────────────────────────────────────────${C.reset}`);
  lines.push('');
  return lines.join('\n');
}

// print download summary
export function formatDownloadLine({ index, total, track, status, detail }) {
  const idxStr = `[${String(index).padStart(String(total).length)}/${total}]`;
  const queryStr = `${track.artist} — ${track.title}`.slice(0, 60).padEnd(60);

  let statusStr;
  switch (status) {
    case 'start': statusStr = `${C.dim}… ${C.reset}`; break;
    case 'ok': statusStr = `${C.green}✓${C.reset} ${detail}`; break;
    case 'retry': statusStr = `${C.yellow}↻${C.reset} ${C.dim}${detail}${C.reset}`; break;
    case 'fail': statusStr = `${C.red}✗${C.reset} ${C.dim}${detail}${C.reset}`; break;
    default: statusStr = '';
  }

  return `${C.cyan}${idxStr}${C.reset} ${queryStr}  ${statusStr}`;
}

export function formatDownloadSummary(manifest, outputDir) {
  const ok = manifest.downloaded.length;
  const fail = manifest.failed.length;
  const total = ok + fail;

  const lines = [];
  lines.push('');
  lines.push(`${C.bold}${ok === total ? C.green : C.yellow}┌─ DOWNLOAD SUMMARY ──────────────────────────────────────┐${C.reset}`);
  lines.push(`${C.yellow}│${C.reset}  ${C.dim}succeeded${C.reset} ${C.green}${ok}${C.reset}`);
  lines.push(`${C.yellow}│${C.reset}  ${C.dim}failed${C.reset}    ${fail > 0 ? C.red : C.dim}${fail}${C.reset}`);
  if (fail > 0) {
    lines.push(`${C.yellow}│${C.reset}`);
    lines.push(`${C.yellow}│${C.reset}  ${C.dim}failed tracks:${C.reset}`);
    for (const f of manifest.failed) {
      lines.push(`${C.yellow}│${C.reset}    ${C.dim}·${C.reset} ${f.artist} — ${f.title}  ${C.dim}(${f.reason})${C.reset}`);
    }
  }
  lines.push(`${C.yellow}│${C.reset}`);
  lines.push(`${C.yellow}│${C.reset}  ${C.dim}output${C.reset}     ${outputDir}`);
  lines.push(`${C.yellow}└────────────────────────────────────────────────────────┘${C.reset}`);
  lines.push('');
  return lines.join('\n');
}


