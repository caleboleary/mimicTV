import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProbeJsonl, importProbeLibrary, guessKind, parseEpisode, parseShowFolder, cleanEpisodeTitle } from '../src/index';
import { buildDummyCommercials } from './fixtures/dummy';

const text = readFileSync(new URL('./fixtures/probe-sample.jsonl', import.meta.url), 'utf8');

describe('probe import', () => {
  const parsed = parseProbeJsonl(text);
  const { library, roots } = importProbeLibrary(parsed.records);

  it('reads the header, records, and errors', () => {
    expect(parsed.header?.mimictv_probe).toBe(1);
    expect(parsed.header?.roots.length).toBe(5);
    expect(parsed.records.length).toBe(26);
    expect(parsed.errors.some((e) => e.includes('broken.mkv'))).toBe(true);
  });

  it('guesses kinds from root folders', () => {
    const kinds = Object.fromEntries(roots.map((r) => [r.root.split('/').pop(), r.kind]));
    expect(kinds).toEqual({ tv: 'episode', commercials: 'commercial', ids: 'network-id', filler: 'filler', movies: 'movie' });
  });

  it('parses shows, seasons, and episodes from paths', () => {
    expect(library.shows.map((s) => s.title)).toEqual(['Night Shift', 'Parkside', 'Rocket Pals']);
    const p = library.items.filter((i) => i.showId === 'parkside-1994');
    expect(p.map((i) => `${i.season}x${i.episode}`)).toEqual(['1x1', '1x2', '1x3', '2x1', '2x2']);
    expect(p[0]!.title).toBe('Ep 01');
    expect(p[3]!.title).toBe('Episode 1');
    const rp = library.items.find((i) => i.showId === 'rocket-pals-1995')!;
    expect(rp.season).toBe(1);
    expect(library.shows.find((s) => s.id === 'parkside-1994')?.year).toBe(1994);
    expect(library.shows.find((s) => s.id === 'night-shift-1991')?.title).toBe('Night Shift');
  });

  it('turns chapters into break points and images into stills', () => {
    const withBreaks = library.items.filter((i) => i.kind === 'episode' && i.breakPoints.length > 0);
    expect(withBreaks.length).toBeGreaterThan(0);
    for (const i of withBreaks) for (const b of i.breakPoints) expect(b).toBeGreaterThan(0);
    const still = library.items.find((i) => i.path.endsWith('.png'))!;
    expect(still.still).toBe(true);
    expect(still.kind).toBe('filler');
    const movie = library.items.find((i) => i.kind === 'movie')!;
    expect(movie.title).toBe('Big Buck Bunny');
    expect(movie.media?.videoCodec).toBe('h264');
  });

  it('respects per-root kind overrides', () => {
    const idsRoot = roots.find((r) => r.root.endsWith('/ids'))!.root;
    const { library: lib2 } = importProbeLibrary(parsed.records, { rootKinds: { [idsRoot]: 'filler' } });
    expect(lib2.items.filter((i) => i.kind === 'network-id').length).toBe(0);
  });

  it('parses episode patterns', () => {
    expect(parseEpisode('Show - S01E02 - Title')?.episode).toBe(2);
    expect(parseEpisode('show.s03e11.pilot')).toMatchObject({ season: 3, episode: 11 });
    expect(parseEpisode('Show - 2x05')).toMatchObject({ season: 2, episode: 5 });
    expect(parseEpisode("Foster's Home for Imaginary Friends 501 Cheese a Go-Go")).toMatchObject({ season: 5, episode: 1 });
    expect(parseEpisode('Some Movie 2007 1080p WEB-DL')).toBeUndefined();
    expect(parseEpisode('Something (480p)')).toBeUndefined();
    expect(guessKind('/mnt/user/Bumpers', '/mnt/user/Bumpers/x.mp4', 5000)).toBe('bumper');
  });
});

describe('release-style folder names', () => {
  it('extracts clean show titles and years', () => {
    expect(parseShowFolder('SpongeBob SquarePants (1999) S01-S15 720p AMZN H264 x264 AAC-ZERO00')).toEqual({ title: 'SpongeBob SquarePants', year: 1999 });
    expect(parseShowFolder('AAAHH, REAL MONSTERS (1994-1997) - Complete ANIMATED TV Series, S01-S04 - 480p DVDRip x264')).toEqual({ title: 'AAAHH, REAL MONSTERS', year: 1994 });
    expect(parseShowFolder('The Powerpuff Girls (1998) Season 1-6 S01-S06 + Specials (480p Mixed x265 HEVC 10bit AAC 2.0 Ghost)')).toEqual({ title: 'The Powerpuff Girls', year: 1998 });
    expect(parseShowFolder('Johnny Bravo S01-S04 (1997)')).toEqual({ title: 'Johnny Bravo', year: 1997 });
    expect(parseShowFolder('Stargate SG-1')).toEqual({ title: 'Stargate SG-1', year: 0 });
    expect(parseShowFolder('Dexters Lab Seasons 1-5 Verified Vidz')).toEqual({ title: 'Dexters Lab', year: 0 });
    expect(parseShowFolder('[TV] Rugrats S01-S09 (1990-2006) Complete Series')).toEqual({ title: 'Rugrats', year: 1990 });
    expect(parseShowFolder('DEXTERS LAB[SEASONS 1-5][VERIFIED-VIDZ]')).toEqual({ title: 'DEXTERS LAB', year: 0 });
    expect(parseShowFolder('Teen Titans S05 1080p BluRay DDP 2.0 x265-EDGE2020')).toEqual({ title: 'Teen Titans', year: 0 });
    expect(parseShowFolder('The.Fairly.OddParents.2001')).toEqual({ title: 'The Fairly OddParents', year: 2001 });
  });
  it('cleans episode titles', () => {
    expect(cleanEpisodeTitle('The Switching Hour (480p - DVDRip)')).toBe('The Switching Hour');
    expect(cleanEpisodeTitle('Monsters, Get Real [1080p x265]')).toBe('Monsters, Get Real');
    expect(cleanEpisodeTitle('Pilot 720p WEB-DL')).toBe('Pilot');
    expect(cleanEpisodeTitle('The Bet (Part 1)')).toBe('The Bet (Part 1)');
    expect(cleanEpisodeTitle('-E02 - Dog Gone and All You Can\'t Eat (720p - Web-DL)')).toBe('Dog Gone and All You Can\'t Eat');
    expect(cleanEpisodeTitle('Ben.10.Secret.of.the.Omnitrix.2007.1080p.WEB-DL.x265')).toBe('Ben 10 Secret of the Omnitrix 2007');
  });
});

describe('dummy interstitials', () => {
  it('makes 100 commercials weighted to 15s and 30s', () => {
    const ads = buildDummyCommercials(100);
    expect(ads.length).toBe(100);
    expect(new Set(ads.map((a) => a.id)).size).toBe(100);
    const near = (s: number) => ads.filter((a) => Math.abs(a.durationMs - s * 1000) < 2500).length;
    expect(near(15) + near(30)).toBeGreaterThan(60);
    expect(ads.every((a) => a.kind === 'commercial' && a.tags.includes('dummy'))).toBe(true);
  });
});
