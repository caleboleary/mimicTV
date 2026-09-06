import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';

/** The app is usually opened over plain http on the LAN, where navigator.clipboard is unavailable; fall back to the old selection trick. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* insecure context or denied */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
}

/** Nav footer: the two links a TV app needs, served by Next itself. */
export default function IptvLinks() {
  const nextUrl = useStore((s) => s.nextUrl);
  const base = nextUrl.trim().replace(/\/+$/, '');
  const [copied, setCopied] = useState<string>();
  const copy = async (key: string, url: string) => {
    if (await copyText(url)) { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? undefined : c)), 1500); } else window.prompt('Copy this link', url);
  };
  if (!base) {
    return (
      <div className="iptv">
        <div className="small muted">Watch in a TV app</div>
        <Link to="/setup" className="small">Set Next's address in Setup →</Link>
      </div>
    );
  }
  const links = [['m3u', 'M3U playlist', `${base}/channels.m3u`], ['xmltv', 'XMLTV guide', `${base}/xmltv.xml`]] as const;
  return (
    <div className="iptv">
      <div className="small muted">Watch in a TV app</div>
      {links.map(([key, label, url]) => (
        <button key={key} className="link-row" title={url} onClick={() => copy(key, url)}>
          <span>{label}</span><b>{copied === key ? 'copied ✓' : 'copy'}</b>
        </button>
      ))}
    </div>
  );
}
