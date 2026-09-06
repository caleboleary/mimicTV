import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Channel } from '@mimictv/core';
import { useStore } from '../store/store';
import { copyText } from './IptvLinks';

interface Props { channel: Channel; nowTitle?: string; onClose: () => void }

type State = 'tuning' | 'playing' | 'muted' | 'error';

/**
 * Plays Next's HLS stream for one channel. Next starts transcoding on the first viewer, so the
 * playlist can take a while to appear: retry patiently rather than giving up at hls.js defaults.
 */
export default function Player({ channel, nowTitle, onClose }: Props) {
  const nextUrl = useStore((s) => s.nextUrl);
  const base = nextUrl.trim().replace(/\/+$/, '');
  const src = `${base}/channel/${channel.number}.m3u8`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('tuning');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setState('tuning');
    // Autoplay with sound needs a user gesture; ours may have expired by the time the stream is up. Fall back to muted.
    const play = () => video.play().catch(() => { video.muted = true; video.play().then(() => setState('muted')).catch(() => {}); });
    const onPlaying = () => setState((s) => (s === 'muted' ? s : 'playing'));
    video.addEventListener('playing', onPlaying);
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
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 5) setTimeout(() => hls?.startLoad(), 3000);
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
    return () => { video.removeEventListener('playing', onPlaying); hls?.destroy(); video.removeAttribute('src'); };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unmute = () => { const v = videoRef.current; if (v) { v.muted = false; setState('playing'); } };
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
        <div className="player-body">
          <video ref={videoRef} controls playsInline />
          {state === 'tuning' && <div className="player-overlay"><div className="spinner" />Tuning in… Next starts transcoding on the first viewer, so this can take 10–20 seconds.</div>}
          {state === 'muted' && <button className="player-overlay unmute" onClick={unmute}>🔇 playing muted · click for sound</button>}
          {state === 'error' && <div className="player-overlay">Couldn't play <code>{src}</code>. Is Next running at {base}, and is that address reachable from this browser?</div>}
        </div>
      </div>
    </div>
  );
}
