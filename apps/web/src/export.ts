import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@mimictv/core/schema/playout';
import { blocksInWindow, simulate, toPlayout, playoutFileName, programmesFor, toXmltv, DAY, type Channel, type Ruleset } from '@mimictv/core';
import { dateStart } from './store/store';

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

import type { ValidateFunction } from 'ajv';
let validator: ValidateFunction | undefined;

/** Export one day of a channel as Next playout JSON + XMLTV. Returns a status line. */
export function exportDay(ch: Channel, ruleset: Ruleset, previewDate: string): string {
  const dayStart = dateStart(previewDate), dayEnd = dayStart + DAY;
  let sim;
  try { sim = simulate(ch, ruleset, Math.max(dayEnd, ch.anchorMs + DAY)); } catch (e) { return `✗ ${(e as Error).message}`; }
  const blocks = blocksInWindow(sim, dayStart, dayEnd);
  if (blocks.length === 0) return 'Nothing scheduled that day';
  const playout = toPlayout(blocks, { clocks: ruleset.clocks });
  if (!validator) { const ajv = new Ajv2020({ strict: false }); addFormats(ajv); validator = ajv.compile(schema); }
  const ok = validator(playout);
  download(playoutFileName(blocks[0]!.start, blocks[blocks.length - 1]!.end), JSON.stringify(playout, null, 2));
  download(`${ch.tvgId}.xml`, toXmltv(ch, programmesFor(blocks, ruleset.library)), 'application/xml');
  return ok ? `✓ ${playout.items.length} items, valid against schema 0.0.3` : `✗ schema errors: ${JSON.stringify(validator.errors?.slice(0, 2))}`;
}
