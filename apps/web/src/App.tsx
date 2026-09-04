import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import GuidePage from './pages/GuidePage';
import ChannelsPage from './pages/ChannelsPage';
import ChannelEditorPage from './pages/ChannelEditorPage';
import LibraryPage from './pages/LibraryPage';
import { useStore } from './store/store';

export default function App() {
  const reset = useStore((s) => s.reset);
  const source = useStore((s) => s.librarySource);
  return (
    <div className="app">
      <nav className="nav">
        <div className="wordmark"><span className="dot" />mimicTV</div>
        <NavLink to="/guide">Guide</NavLink>
        <NavLink to="/channels">Channels</NavLink>
        <NavLink to="/library">Library</NavLink>
        <div className="spacer" />
        <button className="btn sm" onClick={() => { if (confirm('Reset everything to the stub library and demo channels?')) reset(); }}>Reset to defaults</button>
        <div className="small muted" style={{ padding: '10px 10px 0' }}>POC · {source === 'stub' ? 'stub library' : source} · schema 0.0.3</div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/guide" replace />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/channels/:id" element={<ChannelEditorPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/preview" element={<Navigate to="/guide" replace />} />
          <Route path="/pools/*" element={<Navigate to="/library?tab=collections" replace />} />
          <Route path="/clocks/*" element={<Navigate to="/channels" replace />} />
        </Routes>
      </main>
    </div>
  );
}
