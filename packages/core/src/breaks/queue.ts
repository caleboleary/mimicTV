/**
 * The analysis queue: measuring is one show at a time (ffmpeg-bound), but a request that arrives
 * while another show runs joins the queue instead of being refused, so a user can line up days of
 * analysis and walk away. FIFO, one entry per folder: re-requesting a queued show replaces it where
 * it stands, keeping its place with the newer settings. Pure ordering; the service runs the ffmpeg.
 */

/** Anything identified by the show folder it measures can sit in the queue. */
export interface QueuedAnalyze { folder: string }

export interface AnalyzeQueue<T extends QueuedAnalyze> {
  running?: T;
  pending: T[];
}

export type AnalyzeAdmission =
  | { status: 'started' }
  | { status: 'queued'; position: number }
  | { status: 'running' };

/**
 * Accept a request for a show. An idle queue starts it now. A request for the show already being
 * analyzed is the same run asked for twice. Otherwise the show joins the queue; position is 1-based.
 */
export function admitAnalyze<T extends QueuedAnalyze>(q: AnalyzeQueue<T>, req: T): AnalyzeAdmission {
  if (!q.running && q.pending.length === 0) { q.running = req; return { status: 'started' }; }
  if (q.running?.folder === req.folder) return { status: 'running' };
  const at = q.pending.findIndex((p) => p.folder === req.folder);
  if (at >= 0) q.pending[at] = req;
  else q.pending.push(req);
  return { status: 'queued', position: at >= 0 ? at + 1 : q.pending.length };
}

/** The run in progress finished: drop it and take the next show, or undefined when the queue is empty. */
export function advanceAnalyze<T extends QueuedAnalyze>(q: AnalyzeQueue<T>): T | undefined {
  q.running = q.pending.shift();
  return q.running;
}

/** Pull a queued show; false if it wasn't waiting. The running show is never touched. */
export function dequeueAnalyze<T extends QueuedAnalyze>(q: AnalyzeQueue<T>, folder: string): boolean {
  const at = q.pending.findIndex((p) => p.folder === folder);
  if (at < 0) return false;
  q.pending.splice(at, 1);
  return true;
}
