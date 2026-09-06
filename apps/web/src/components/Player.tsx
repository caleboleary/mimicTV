import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Channel } from '@mimictv/core';
import { useStore } from '../store/store';
import { copyText } from './IptvLinks';

interface Props { channel: Channel; nowTitle?: string; onClose: () => void }

type State = 'tuning' | 'playing' | 'muted' | 'error' | 'unknown-channel';

/**
 * Plays ErsatzTV Next's HLS stream for one channel. Next starts transcoding on the first viewer,
 * so the playlist can take a while to appear: retry patiently rather than giving up at hls.js defaults.
 */
export default function Player({ channel, nowTitle, onClose }: Props) {
  const nextUrl = useStore((s) => s.nextUrl);
  const base = nextUrl.trim().replace(/\/+$/, '');
  const src = `${base}/channel/${channel.number}.m3u8`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('tuning');
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Next reads lineup.json only at startup, so a channel added since then 404s forever. Its M3U says what it actually knows.
  useEffect(() => {
    let live = true;
    fetch(`${base}/channels.m3u`).then((r) => r.text()).then((m3u) => {
      if (live && !m3u.includes(`/channel/${channel.number}.m3u8`)) setState('unknown-channel');
    }).catch(() => {});
    return () => { live = false; };
  }, [base, channel.number]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setState('tuning');
    // Autoplay with sound needs a user gesture; ours may have expired by the time the stream is up. Fall back to muted.
    const play = () => video.play().catch(() => { video.muted = true; video.play().then(() => setState('muted')).catch(() => {}); });
    const onPlaying = () => setState((s) => (s === 'muted' ? s : 'playing'));
    const onVolume = () => { setMuted(video.muted); setVolume(video.volume); };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('volumechange', onVolume);
    let hls: Hls | undefined;
    if (Hls.isSupported()) {
      hls = new Hls({
        manifestLoadingTimeOut: 60_000, manifestLoadingMaxRetry: 10, manifestLoadingRetryDelay: 2000, manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingTimeOut: 30_000, fragLoadingTimeOut: 60_000, liveSyncDurationCount: 3,
      });
      let networkRetries = 0;
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 5) setTimeout(() => { if (hls?.media) hls.startLoad(); }, 3000);
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else setState('error');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      play();
    } else {
      setState('error');
    }
    return () => { video.removeEventListener('playing', onPlaying); video.removeEventListener('volumechange', onVolume); hls?.destroy(); video.removeAttribute('src'); };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unmute = () => { const v = videoRef.current; if (v) { v.muted = false; setState('playing'); } };
  const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
  const setVol = (n: number) => { const v = videoRef.current; if (v) { v.volume = n; v.muted = n === 0; } };
  const fullscreen = () => { const el = bodyRef.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); };
  return (
    <div className="player-backdrop" onClick={onClose}>
      <div className="player" onClick={(e) => e.stopPropagation()}>
        <div className="player-head">
          <b className="mono">{channel.number}</b>
          <span>{channel.name}</span>
          {nowTitle && <span className="muted small">· now: {nowTitle}</span>}
          <div className="grow" />
          <button className="btn sm" title={src} onClick={async () => { if (await copyText(src)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? 'copied ✓' : 'copy stream link'}</button>
          <button className="btn sm" onClick={onClose}>✕</button>
        </div>
        <div className="player-body" ref={bodyRef}>
          {/* Live TV: no native controls. The timeline would only grow as segments arrive and pause makes no sense; just sound and fullscreen. */}
          <video ref={videoRef} playsInline onContextMenu={(e) => e.preventDefault()} />
          {state === 'tuning' && <div className="player-overlay"><div className="spinner" />Tuning in… ErsatzTV Next starts transcoding on the first viewer, so this can take 10–20 seconds.</div>}
          {state === 'unknown-channel' && <div className="player-overlay">ErsatzTV Next doesn't know channel {channel.number} yet. It reads the lineup only when it starts, so restart it (<code>docker restart ersatztv-next</code>) and try again.</div>}
          {state === 'muted' && <button className="player-overlay unmute" onClick={unmute}>🔇 playing muted · click for sound</button>}
          {state === 'error' && <div className="player-overlay">Couldn't play <code>{src}</code>. Is ErsatzTV Next running at {base}, and is that address reachable from this browser?</div>}
          <div className="player-bar">
            <button title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVol(Number(e.target.value))} title="Volume" />
            <span className="live"><i />LIVE</span>
            <div className="grow" />
            <button title="Fullscreen" onClick={fullscreen}>⛶</button>
          </div>
        </div>
      </div>
    </div>
  );
}
