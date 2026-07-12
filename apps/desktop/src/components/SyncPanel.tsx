/**
 * Sync Panel — Field-to-Office Sync UI
 *
 * Shows sync status, field sessions pulled from metardu web,
 * and allows the surveyor to import sessions into the current project.
 *
 * Workflow:
 *   1. Surveyor configures sync endpoint (ArdhiSasa or custom)
 *   2. App auto-syncs on launch + every 5 minutes
 *   3. New field sessions appear in the list
 *   4. Surveyor clicks "Import" to load points into the current project
 *   5. Points appear on the map + in the points table
 */

import { useEffect, useState, useCallback } from 'react';

interface FieldSession {
  sessionId: string;
  surveyorName: string;
  projectName: string;
  county: string;
  surveyType: string;
  startDate: string;
  instrument: { type: string; brand: string; model?: string };
  points: Array<{
    pointNumber: string;
    easting: number;
    northing: number;
    elevation?: number;
    code?: string;
    source: string;
    timestamp: string;
  }>;
  crs: string;
  syncStatus: string;
  syncedAt?: string;
}

interface SyncStatus {
  configured: boolean;
  online: boolean;
  lastSync: string | null;
  sessionCount: number;
}

export function SyncPanel({ onImportSession }: { onImportSession?: (session: FieldSession) => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [sessions, setSessions] = useState<FieldSession[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [surveyorId, setSurveyorId] = useState('');
  const [lastSyncResult, setLastSyncResult] = useState<string>('');

  const refreshStatus = useCallback(() => {
    // In production: const s = await window.metardu.sync.status();
    // For now simulate
    setStatus({
      configured: endpoint.length > 0,
      online: navigator.onLine,
      lastSync: new Date().toISOString(),
      sessionCount: sessions.length,
    });
  }, [endpoint, sessions.length]);

  useEffect(() => {
    refreshStatus();
    // Listen for sync events
    const handleSyncStarted = () => setSyncing(true);
    const handleSyncComplete = (e: unknown, result: any) => {
      setSyncing(false);
      setLastSyncResult(`${result.sessionsPulled} sessions pulled, ${result.totalPoints} points`);
      refreshStatus();
    };
    const handleSyncError = (e: unknown, err: string) => {
      setSyncing(false);
      setLastSyncResult(`Error: ${err}`);
    };
    const handleSessionPulled = (e: unknown, session: FieldSession) => {
      setSessions((prev) => {
        if (prev.find((s) => s.sessionId === session.sessionId)) return prev;
        return [...prev, session];
      });
    };

    window.addEventListener('sync:started', handleSyncStarted as any);
    window.addEventListener('sync:complete', handleSyncComplete as any);
    window.addEventListener('sync:error', handleSyncError as any);
    window.addEventListener('sync:session-pulled', handleSessionPulled as any);

    return () => {
      window.removeEventListener('sync:started', handleSyncStarted as any);
      window.removeEventListener('sync:complete', handleSyncComplete as any);
      window.removeEventListener('sync:error', handleSyncError as any);
      window.removeEventListener('sync:session-pulled', handleSessionPulled as any);
    };
  }, [refreshStatus]);

  const handleConfigure = useCallback(() => {
    // In production: await window.metardu.sync.configure({ endpoint, apiKey, autoSync, surveyorId });
    setShowConfig(false);
    refreshStatus();
  }, [endpoint, apiKey, autoSync, surveyorId, refreshStatus]);

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    // In production: const result = await window.metardu.sync.now();
    // For demo, simulate pulling a session
    setTimeout(() => {
      const mockSession: FieldSession = {
        sessionId: `fs_${Date.now()}`,
        surveyorName: 'J. Surveyor',
        projectName: 'Field Survey 2026-07-12',
        county: 'Nairobi',
        surveyType: 'cadastral',
        startDate: new Date().toISOString(),
        instrument: { type: 'total_station', brand: 'topcon' },
        points: [
          { pointNumber: 'BM1', easting: 517234.56, northing: 9876543.21, elevation: 1523.45, code: 'BM', source: 'total_station', timestamp: new Date().toISOString() },
          { pointNumber: 'P2', easting: 517300.00, northing: 9876600.00, elevation: 1524.00, code: 'CTRL', source: 'total_station', timestamp: new Date().toISOString() },
          { pointNumber: 'P3', easting: 517350.00, northing: 9876650.00, elevation: 1525.50, code: 'BLDG', source: 'total_station', timestamp: new Date().toISOString() },
        ],
        crs: 'EPSG:21037',
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
      };
      setSessions((prev) => [...prev, mockSession]);
      setSyncing(false);
      setLastSyncResult('1 session pulled, 3 points');
      refreshStatus();
    }, 1000);
  }, [refreshStatus]);

  const handleImport = useCallback((session: FieldSession) => {
    if (onImportSession) {
      onImportSession(session);
    }
  }, [onImportSession]);

  const handleImportFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.field-session';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // In production: const session = await window.metardu.sync.importFile(file.path);
        // For now read it
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const session = JSON.parse(reader.result as string) as FieldSession;
            setSessions((prev) => [...prev, session]);
          } catch {
            // Invalid file
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, []);

  return (
    <div className="sync-panel">
      <div className="sync-header">
        <h3>Field Sync</h3>
        <div className={`sync-status ${(status?.configured && status?.online) ? 'online' : 'offline'}`}>
          {status?.configured
            ? status.online
              ? `● Online${status.lastSync ? ` · Last: ${new Date(status.lastSync).toLocaleTimeString()}` : ''}`
              : '● Offline (will sync when online)'
            : '○ Not configured'}
        </div>
      </div>

      {!status?.configured ? (
        <div className="sync-not-configured">
          <p>Connect metardu web (field) to metardu desktop (office).</p>
          <p className="sync-hint">
            When a surveyor picks up points in the field with the web app,
            they automatically appear here when you return to the office.
          </p>
          <button onClick={() => setShowConfig(true)} className="btn btn-primary">
            Configure Sync
          </button>
        </div>
      ) : (
        <div className="sync-connected">
          <div className="sync-actions">
            <button onClick={handleSyncNow} disabled={syncing} className="btn btn-primary">
              {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
            </button>
            <button onClick={() => setShowConfig(!showConfig)} className="btn btn-secondary btn-sm">
              Settings
            </button>
            <button onClick={handleImportFile} className="btn btn-secondary btn-sm">
              📁 Import File
            </button>
          </div>

          {lastSyncResult && (
            <div className="sync-last-result">{lastSyncResult}</div>
          )}

          {showConfig && (
            <div className="sync-config-form">
              <input placeholder="Sync endpoint URL" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              <input placeholder="API key (optional)" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <input placeholder="Surveyor ID (optional)" value={surveyorId} onChange={(e) => setSurveyorId(e.target.value)} />
              <label>
                <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
                Auto-sync every 5 minutes
              </label>
              <button onClick={handleConfigure} className="btn btn-primary btn-sm">Save</button>
            </div>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="sync-sessions">
          <h4>Field Sessions ({sessions.length})</h4>
          {sessions.map((session) => (
            <div key={session.sessionId} className="sync-session-card">
              <div className="sync-session-header">
                <span className="sync-session-project">{session.projectName}</span>
                <span className="sync-session-date">{new Date(session.startDate).toLocaleDateString()}</span>
              </div>
              <div className="sync-session-meta">
                <span>📍 {session.county}</span>
                <span>📐 {session.surveyType}</span>
                <span>🔧 {session.instrument.brand}</span>
                <span>👤 {session.surveyorName}</span>
                <span>🎯 {session.points.length} points</span>
              </div>
              <div className="sync-session-points">
                {session.points.slice(0, 5).map((p) => (
                  <span key={p.pointNumber} className="sync-point-chip" title={`E:${p.easting} N:${p.northing} Z:${p.elevation ?? 'N/A'}`}>
                    {p.pointNumber}
                  </span>
                ))}
                {session.points.length > 5 && (
                  <span className="sync-point-more">+{session.points.length - 5} more</span>
                )}
              </div>
              <button onClick={() => handleImport(session)} className="btn btn-primary btn-sm sync-import-btn">
                Import to Project
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
