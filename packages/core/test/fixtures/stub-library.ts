import type { Library, MediaItem, Show } from '../../src/types';
import { rngFor } from '../../src/rng';
import { MIN, SEC } from '../../src/time';

interface ShowSpec {
  id: string;
  title: string;
  year: number;
  tags: string[];
  seasons: number;
  perSeason: number;
  /** Nominal episode length in minutes. */
  lengthMin: number;
  /** Nominal break offsets as fraction of runtime. */
  breakFractions: number[];
  /** Fraction of episodes that lack break metadata. */
  missingBreaks?: number;
}

const SHOWS: ShowSpec[] = [
  { id: 'parkside', title: 'Parkside', year: 1994, tags: ['sitcom', '90s'], seasons: 4, perSeason: 12, lengthMin: 22, breakFractions: [0.32, 0.66] },
  { id: 'night-shift', title: 'Night Shift', year: 1991, tags: ['sitcom', '90s'], seasons: 3, perSeason: 10, lengthMin: 22.5, breakFractions: [0.3, 0.64], missingBreaks: 0.2 },
  { id: 'the-larsons', title: 'The Larsons', year: 1988, tags: ['sitcom', '80s'], seasons: 5, perSeason: 13, lengthMin: 21.5, breakFractions: [0.35, 0.7] },
  { id: 'bad-neighbors', title: 'Bad Neighbors', year: 1997, tags: ['sitcom', '90s'], seasons: 2, perSeason: 11, lengthMin: 22, breakFractions: [0.28, 0.6], missingBreaks: 0.5 },
  { id: 'double-take', title: 'Double Take', year: 1999, tags: ['sitcom', '90s'], seasons: 3, perSeason: 12, lengthMin: 21, breakFractions: [0.33, 0.67] },
  { id: 'rocket-pals', title: 'Rocket Pals', year: 1995, tags: ['cartoon', '90s'], seasons: 2, perSeason: 13, lengthMin: 11, breakFractions: [0.5] },
  { id: 'gooey-bros', title: 'Gooey Bros', year: 1993, tags: ['cartoon', '90s'], seasons: 3, perSeason: 13, lengthMin: 11.2, breakFractions: [0.48] },
  { id: 'midnight-files', title: 'Midnight Files', year: 1996, tags: ['drama', '90s'], seasons: 2, perSeason: 8, lengthMin: 44, breakFractions: [0.2, 0.42, 0.63, 0.84] },
];

const EP_TITLES = [
  'Pilot', 'The Dinner Party', 'Road Trip', 'The Wedding', 'Fish Out of Water', 'Snow Day', 'The Interview',
  'Lost and Found', 'Big Game', 'The Neighbor', 'Reunion', 'Blackout', 'The Audition', 'Clean Sweep', 'The Bet',
  'Sick Day', 'The Promotion', 'Camping', 'Halloween', 'The Gift', 'Double Booked', 'The Move', 'Finale',
];

const BRANDS = [
  'Crunchy Crisps', 'Zap Cola', 'Turbo Sneakers', 'MegaBurger', 'Sunny Bank', 'Blaster Toys', 'Fresh Mint Gum',
  'Rocket Cereal', 'Super Suds', 'Pizza Palace', 'Value Motors', 'Gamestation', 'Cool Cats Pet Food',
  'Nite-Lite Cough Syrup', 'Family Phone Plan', 'Ultra Vision TV', 'Sparkle Cleaner', 'Chunky Soup Co',
];

export function buildStubLibrary(): Library {
  const rng = rngFor('mimictv-stub-library');
  const shows: Show[] = [];
  const items: MediaItem[] = [];

  for (const spec of SHOWS) {
    shows.push({ id: spec.id, title: spec.title, year: spec.year, tags: spec.tags });
    let n = 0;
    for (let s = 1; s <= spec.seasons; s++) {
      for (let e = 1; e <= spec.perSeason; e++) {
        n++;
        const durationMs = Math.round((spec.lengthMin * MIN + (rng.next() - 0.5) * 70 * SEC) / 100) * 100;
        const missing = spec.missingBreaks ? rng.next() < spec.missingBreaks : false;
        const breakPoints = missing
          ? []
          : spec.breakFractions.map((f) => Math.round(durationMs * f + (rng.next() - 0.5) * 40 * SEC));
        const title = EP_TITLES[(SHOWS.indexOf(spec) * 5 + s * 7 + e * 3) % EP_TITLES.length] ?? `Episode ${e}`;
        items.push({
          id: `${spec.id}-s${s}e${e}`,
          kind: 'episode',
          title,
          path: `/media/tv/${spec.title} (${spec.year})/Season ${String(s).padStart(2, '0')}/${spec.title} - S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')} - ${title}.mkv`,
          durationMs,
          showId: spec.id,
          season: s,
          episode: e,
          tags: spec.tags,
          breakPoints,
          breakSource: missing ? 'none' : n % 5 === 0 ? 'manual' : 'chapters',
        });
      }
    }
  }

  // Commercials: 15/30/60s across two eras.
  let c = 0;
  for (const brand of BRANDS) {
    const variants = 2 + rng.int(4);
    for (let v = 0; v < variants; v++) {
      c++;
      const lenChoices = [15, 30, 30, 30, 60];
      const len = lenChoices[rng.int(lenChoices.length)] ?? 30;
      const era = rng.next() < 0.7 ? '90s' : '80s';
      items.push({
        id: `ad-${c}`,
        kind: 'commercial',
        title: `${brand}${variants > 1 ? ` (${v + 1})` : ''}`,
        path: `/media/commercials/${era}/${brand.replace(/\s+/g, '_')}_${v + 1}.mp4`,
        durationMs: len * SEC + rng.int(1500),
        tags: ['commercial', era],
        breakPoints: [],
        breakSource: 'none',
      });
    }
  }

  // Network IDs.
  const ids = ['Station ID - Classic', 'Station ID - Night', 'Station ID - Sting', 'Station ID - Weekend', 'We\'ll Be Right Back'];
  ids.forEach((title, i) => {
    items.push({
      id: `id-${i + 1}`,
      kind: 'network-id',
      title,
      path: `/media/ids/${title.replace(/[^a-z0-9]+/gi, '_')}.mp4`,
      durationMs: (4 + rng.int(6)) * SEC + rng.int(900),
      tags: ['network-id'],
      breakPoints: [],
      breakSource: 'none',
    });
  });

  // Bumpers: short branded stings around breaks.
  ['Coming Up Next', 'We\'ll Be Right Back', 'Now Back To The Show', 'Stay Tuned'].forEach((title, i) => {
    items.push({
      id: `bumper-${i + 1}`, kind: 'bumper', title,
      path: `/media/bumpers/${title.replace(/[^a-z0-9]+/gi, '_')}.mp4`,
      durationMs: (3 + rng.int(4)) * SEC + rng.int(900),
      tags: ['bumper'], breakPoints: [], breakSource: 'none',
    });
  });

  // Filler: a trimmable static image and a few glitch/static clips.
  items.push({
    id: 'filler-static-card',
    kind: 'filler',
    title: 'Static Card (image)',
    path: '/media/filler/static_card.png',
    durationMs: 0,
    tags: ['filler', 'still'],
    breakPoints: [],
    breakSource: 'none',
    trimmable: true,
    still: true,
  });
  for (let i = 1; i <= 6; i++) {
    items.push({
      id: `filler-glitch-${i}`,
      kind: 'filler',
      title: `Glitch Loop ${i}`,
      path: `/media/filler/glitch_${i}.mp4`,
      durationMs: (10 + rng.int(50)) * SEC,
      tags: ['filler', 'glitch'],
      breakPoints: [],
      breakSource: 'none',
      trimmable: true,
    });
  }

  return { shows, items };
}
