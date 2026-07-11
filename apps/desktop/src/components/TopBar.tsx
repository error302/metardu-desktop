import { useState } from 'react';

interface TopBarProps {
  projectName: string;
  onImportCsv: () => void;
  onNewProject: () => void;
  loading: boolean;
}

export function TopBar({ projectName, onImportCsv, onNewProject, loading }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div className="logo">
          <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="12" fill="none" stroke="#D97706" strokeWidth="1.5" />
            <circle cx="14" cy="14" r="8" fill="none" stroke="#D97706" strokeWidth="1" />
            <line x1="14" y1="2" x2="14" y2="26" stroke="#D97706" strokeWidth="1" />
            <line x1="2" y1="14" x2="26" y2="14" stroke="#D97706" strokeWidth="1" />
            <text x="14" y="17" textAnchor="middle" fontSize="6" fontWeight="700" fill="#D97706" fontFamily="JetBrains Mono, monospace">BM</text>
          </svg>
        </div>
        <div className="app-title">
          <span className="app-name">METARDU</span>
          <span className="app-subtitle">Desktop</span>
        </div>
      </div>

      <div className="top-bar-center">
        <span className="project-name" title={projectName}>{projectName}</span>
      </div>

      <div className="top-bar-right">
        <button
          className="btn btn-secondary"
          onClick={() => setMenuOpen(!menuOpen)}
          disabled={loading}
        >
          File
        </button>
        {menuOpen && (
          <div className="dropdown">
            <button onClick={() => { onNewProject(); setMenuOpen(false); }}>New Project…</button>
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) onImportCsv();
            };
            input.click();
          }}
          disabled={loading}
        >
          {loading ? 'Working…' : 'Import CSV'}
        </button>
      </div>
    </header>
  );
}
