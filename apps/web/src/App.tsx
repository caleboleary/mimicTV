import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import GuidePage from './pages/GuidePage';
import ChannelsPage from './pages/ChannelsPage';
import ChannelEditorPage from './pages/ChannelEditorPage';
import LibraryPage from './pages/LibraryPage';
import SetupPage from './pages/SetupPage';
import BreaksPage from './pages/BreaksPage';
import HelpPage from './pages/HelpPage';
import IptvLinks from './components/IptvLinks';
import { useStore } from './store/store';

export default function App() {
  const source = useStore((s) => s.librarySource);
  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/guide" className="wordmark"><span className="mark"><span className="glow"><img src="/mimictv-256.png" alt="" /></span><img src="/mimictv-256.png" alt="" /></span><span>mimicTV</span></NavLink>
        <NavLink to="/guide">Guide</NavLink>
        <NavLink to="/channels">Channels</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/setup">Setup</NavLink>
        <NavLink to="/help">Help</NavLink>
        <div className="spacer" />
        <IptvLinks />
        <div className="small muted" style={{ padding: '10px 10px 0' }}>{source || 'no library yet'} · schema 0.0.3</div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/guide" replace />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/channels/:id" element={<ChannelEditorPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/breaks" element={<BreaksPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/preview" element={<Navigate to="/guide" replace />} />
          <Route path="/pools/*" element={<Navigate to="/library?tab=collections" replace />} />
          <Route path="/clocks/*" element={<Navigate to="/channels" replace />} />
        </Routes>
      </main>
    </div>
  );
}
