import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { blocksInWindow, poolItems, DAY } from '@mimictv/core';
import { useStore, dateStart } from '../store/store';
import { useSims } from '../store/useSim';
import DayStrip from '../components/DayStrip';

export default function ChannelsPage() {
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const pools = useStore((s) => s.pools);
  const library = useStore((s) => s.library);
  const previewDate = useStore((s) => s.previewDate);
  const createChannel = useStore((s) => s.createChannel);
  const duplicateChannel = useStore((s) => s.duplicateChannel);
  const removeChannel = useStore((s) => s.removeChannel);
  const sorted = useMemo(() => [...channels].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)), [channels]);
  const sims = useSims();
  const dayStart = dateStart(previewDate);
  const [showLineup, setShowLineup] = useState(false);

  const lineup = {
    server: { bind_address: '0.0.0.0', port: 8409 }, output: { folder: '/tmp/hls' }, xmltv: { folder: './xmltv' },
    channels: sorted.map((c) => ({ number: c.number, name: c.name, config: `./channels/${c.id}/channel.json`, tvg_id: c.tvgId, logo: c.logo, group: c.group })),
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Channels</h1>
        <div className="grow" />
        <button className="btn sm" onClick={() => setShowLineup((v) => !v)}>{showLineup ? 'Hide' : 'Show'} lineup.json</button>
        <button className="btn primary" onClick={() => nav(`/channels/${createChannel()}`)}>New channel</button>
      </div>
      {showLineup && <pre className="code" style={{ marginBottom: 14 }}>{JSON.stringify(lineup, null, 2)}</pre>}
      {sorted.length === 0 && (
        <div className="panel empty hero">
          <img src="/mimictv-512.png" alt="" />
          <div>No channels yet. New channel gives you a working half-hour format; you just pick the shows.</div>
        </div>
      )}
      <div className="channel-cards">
        {sorted.map((ch) => {
          const sim = sims.get(ch.id);
          const blocks = sim ? blocksInWindow(sim, dayStart, dayStart + DAY) : [];
          const label = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          const multi = ch.dayparts.filter((d) => d.endMinute == null).length > 1;
          const bands = ch.dayparts.map((d) => {
            const c = clocks.find((x) => x.id === d.clockId);
            const p = pools.find((x) => x.id === c?.program.poolId);
            if (d.endMinute != null) {
              const first = p?.filter.showIds?.[0];
              return `📌 ${label(d.startMinute)} ${first ? (library.shows.find((s) => s.id === first)?.title ?? first) : 'fixed show'}`;
            }
            const shows = p ? (p.filter.showIds?.length || new Set(poolItems(p, library).map((i) => i.showId)).size) : 0;
            return `${multi ? label(d.startMinute) + ' ' : ''}${shows} shows · ${c ? Math.round(c.program.targetMs / 60000) : '?'} min`;
          });
          return (
            <div className="panel" key={ch.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/channels/${ch.id}`)}>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                <div className="chan-num">{ch.number}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{ch.name}</div>
                  <div className="muted small">{bands.join(' · ')}</div>
                </div>
              </div>
              <DayStrip dayStart={dayStart} blocks={blocks} />
              <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn sm" onClick={() => nav(`/channels/${ch.id}`)}>Open</button>
                <button className="btn sm" onClick={() => nav(`/channels/${duplicateChannel(ch.id)}`)}>Duplicate</button>
                <div className="grow" />
                <button className="btn sm danger" onClick={() => { if (confirm('Delete channel and its private pools?')) removeChannel(ch.id); }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
