import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import PreviewPage from './pages/PreviewPage';
import ClocksPage from './pages/ClocksPage';
import PoolsPage from './pages/PoolsPage';
import ChannelsPage from './pages/ChannelsPage';
import LibraryPage from './pages/LibraryPage';
import { useStore } from './store/store';

export default function App() {
  const reset = useStore((s) => s.reset);
  const source = useStore((s) => s.librarySource);
  return (
    <div className="app">
      <nav className="nav">
        <div className="wordmark"><span className="dot" />mimicTV</div>
        <NavLink to="/preview">Preview</NavLink>
        <NavLink to="/clocks">Clocks</NavLink>
        <NavLink to="/pools">Pools</NavLink>
        <NavLink to="/channels">Channels</NavLink>
        <NavLink to="/library">Library</NavLink>
        <div className="spacer" />
        <button className="btn sm" onClick={() => { if (confirm('Reset pools, clocks, and channels to defaults?')) reset(); }}>Reset to defaults</button>
        <div className="small muted" style={{ padding: '10px 10px 0' }}>POC · {source === 'stub' ? 'stub library' : source} · schema 0.0.3</div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/preview" replace />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/clocks" element={<ClocksPage />} />
          <Route path="/clocks/:id" element={<ClocksPage />} />
          <Route path="/pools" element={<PoolsPage />} />
          <Route path="/pools/:id" element={<PoolsPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/library" element={<LibraryPage />} />
        </Routes>
      </main>
    </div>
  );
}
