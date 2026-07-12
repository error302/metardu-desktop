interface StatusBarProps {
  version: string;
  platform: string;
  projectPath: string;
  pointCount: number;
}

export function StatusBar({ version, platform, projectPath, pointCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-cell">
        <span className="status-label">METARDU Desktop</span>
        <span className="status-value">v{version}</span>
      </span>
      <span className="status-cell">
        <span className="status-label">Platform</span>
        <span className="status-value">{platform || '—'}</span>
      </span>
      <span className="status-cell">
        <span className="status-label">Project</span>
        <span className="status-value" title={projectPath}>{projectPath || 'none'}</span>
      </span>
      <span className="status-cell">
        <span className="status-label">Points</span>
        <span className="status-value">{pointCount}</span>
      </span>
      <span className="status-cell status-phase">
        <span className="status-label">Phase</span>
        <span className="status-value">2 — Walking Skeleton</span>
      </span>
    </footer>
  );
}
