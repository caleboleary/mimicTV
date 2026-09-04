import type { MediaItem } from '../types';
import { rngFor } from '../rng';
import { SEC } from '../time';

export const DUMMY_TAG = 'dummy';

const BRANDS = [
  'Crunchy Crisps', 'Zap Cola', 'Turbo Sneakers', 'MegaBurger', 'Sunny Bank', 'Blaster Toys', 'Fresh Mint Gum',
  'Rocket Cereal', 'Super Suds', 'Pizza Palace', 'Value Motors', 'Gamestation', 'Cool Cats Pet Food',
  'Nite-Lite Cough Syrup', 'Family Phone Plan', 'Ultra Vision TV', 'Sparkle Cleaner', 'Chunky Soup Co',
  'Mattress Kingdom', 'Discount Dan\'s Furniture', 'Galaxy Gum', 'Power Rangers Zords', 'Lunchables', 'Surge',
  'Nerf Blaster', 'Tamagotchi', 'Skip-It', 'Crossfire', 'Lisa Frank', 'Fruit Gushers', 'Dunkaroos', 'Bagel Bites',
  'Kid Cuisine', 'Toonami Promo', 'Blockbuster Video', 'RadioShack', 'AOL Free Trial', 'Got Milk',
];

const VARIANTS = ['', ' (Summer)', ' (Holiday)', ' (Kids)', ' (Night)', ' (30 Off)', ' (New)'];

/** Length distribution weighted toward 15s and 30s spots. */
function pickLength(r: number): number {
  if (r < 0.38) return 30;
  if (r < 0.72) return 15;
  if (r < 0.84) return 60;
  if (r < 0.90) return 10;
  if (r < 0.95) return 20;
  return 45;
}

export function buildDummyCommercials(count = 100, seed = 'dummy-commercials'): MediaItem[] {
  const rng = rngFor(seed);
  const items: MediaItem[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let title = '';
    for (let tries = 0; tries < 20; tries++) {
      title = `${rng.pick(BRANDS)}${rng.pick(VARIANTS)}`;
      if (!used.has(title)) break;
    }
    used.add(title);
    const nominal = pickLength(rng.next());
    const era = rng.next() < 0.6 ? '90s' : rng.next() < 0.5 ? '80s' : '2000s';
    items.push({
      id: `dummy-ad-${i + 1}`,
      kind: 'commercial',
      title,
      path: `/media/commercials/${era}/${title.replace(/[^a-z0-9]+/gi, '_')}.mp4`,
      durationMs: nominal * SEC + Math.round((rng.next() - 0.3) * 2000),
      tags: ['commercial', era, DUMMY_TAG],
      breakPoints: [],
      breakSource: 'none',
    });
  }
  return items;
}

export function buildDummyIdsAndFiller(seed = 'dummy-ids'): MediaItem[] {
  const rng = rngFor(seed);
  const items: MediaItem[] = [];
  ['Station ID - Classic', 'Station ID - Night', 'Station ID - Sting', 'Station ID - Weekend', 'We\'ll Be Right Back', 'Coming Up Next'].forEach((title, i) => {
    items.push({
      id: `dummy-id-${i + 1}`, kind: 'network-id', title,
      path: `/media/ids/${title.replace(/[^a-z0-9]+/gi, '_')}.mp4`,
      durationMs: (4 + rng.int(6)) * SEC + rng.int(900),
      tags: ['network-id', DUMMY_TAG], breakPoints: [], breakSource: 'none',
    });
  });
  items.push({
    id: 'dummy-static-card', kind: 'filler', title: 'Static Card (image)', path: '/media/filler/static_card.png',
    durationMs: 0, tags: ['filler', 'still', DUMMY_TAG], breakPoints: [], breakSource: 'none', trimmable: true, still: true,
  });
  for (let i = 1; i <= 6; i++) {
    items.push({
      id: `dummy-glitch-${i}`, kind: 'filler', title: `Glitch Loop ${i}`, path: `/media/filler/glitch_${i}.mp4`,
      durationMs: (10 + rng.int(50)) * SEC, tags: ['filler', 'glitch', DUMMY_TAG], breakPoints: [], breakSource: 'none', trimmable: true,
    });
  }
  return items;
}
