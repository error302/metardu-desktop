/**
 * METARDU Desktop — App root
 *
 * Walking skeleton UI:
 *   - Top bar with app title, project name, and Import CSV button
 *   - Main area: OpenLayers map showing all imported survey points
 *   - Right sidebar: point count, last action, "Start Here" instructions
 *   - Bottom status bar: app version, project file path, point count
 *
 * The map uses OpenLayers 10 with OSM basemap (online for now; mbtiles
 * offline cache comes in M5 per the roadmap).
 */

import { useEffect, useState, useCallback } from 'react';
import { MapView } from './components/MapView.js';
import { Sidebar } from './components/Sidebar.js';
import { StatusBar } from './components/StatusBar.js';
import { TopBar } from './components/TopBar.js';
import type { SurveyPoint, ProjectRow, MetarduApi } from './types.js';

declare global {
  interface Window {
    metardu: MetarduApi;
  }
}

export default function App() {
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [platform, setPlatform] = useState('');
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [lastAction, setLastAction] = useState<string>('No project open. Click File → New Project… to begin.');
  const [loading, setLoading] = useState(false);

  // On mount: get app version + platform
  useEffect(() => {
    window.metardu.app.version().then(setAppVersion);
    window.metardu.app.platform().then(setPlatform);

    // Wire up menu handlers
    window.metardu.menu.onFileNew(() => { void handleNewProject(); });
    window.metardu.menu.onFileOpened((filePath: string) => { void handleOpenProject(filePath); });
    window.metardu.menu.onImportCsv((filePath: string) => { void handleImportCsv(filePath); });
  }, []);

  const refreshPoints = useCallback(async () => {
    if (!project) return;
    try {
      const pts = await window.metardu.db.getPoints(project.id);
      setPoints(pts);
    } catch (e) {
      setLastAction(`Error: ${(e as Error).message}`);
    }
  }, [project]);

  const handleNewProject = useCallback(async () => {
    try {
      // For walking skeleton: use a fixed path in the user's home directory
      const home = await window.metardu.app.platform();
      const defaultPath = `${home === 'win32' ? 'C:\\Users\\Public\\Documents' : '/tmp'}/metardu-walking-skeleton.metardu`;
      const name = `Walking Skeleton ${new Date().toLocaleString()}`;
      const result = await window.metardu.fs.newProject(defaultPath, name, 'KEN');
      setProjectPath(result.filePath);
      const projects = await window.metardu.db.listProjects();
      setProject(projects[0]);
      setPoints([]);
      setLastAction(`New project created: ${result.filePath}`);
      await refreshPoints();
    } catch (e) {
      setLastAction(`Error creating project: ${(e as Error).message}`);
    }
  }, [refreshPoints]);

  const handleOpenProject = useCallback(async (filePath: string) => {
    try {
      setLoading(true);
      await window.metardu.fs.openProject(filePath);
      setProjectPath(filePath);
      const projects = await window.metardu.db.listProjects();
      setProject(projects[0] ?? null);
      setLastAction(`Opened project: ${filePath}`);
      await refreshPoints();
    } catch (e) {
      setLastAction(`Error opening project: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [refreshPoints]);

  const handleImportCsv = useCallback(async (filePath: string) => {
    if (!project) {
      setLastAction('Open or create a project first.');
      return;
    }
    try {
      setLoading(true);
      const result = await window.metardu.fs.importCsv(filePath, project.id);
      setLastAction(`Imported ${result.imported} points from ${filePath.split(/[\\/]/).pop()}`);
      await refreshPoints();
    } catch (e) {
      setLastAction(`Import failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [project, refreshPoints]);

  // Auto-create a default project on first launch so the user has somewhere to import into
  useEffect(() => {
    if (!project && !projectPath) {
      handleNewProject();
    }
  }, [project, projectPath, handleNewProject]);

  return (
    <div className="app-shell">
      <TopBar
        projectName={project?.name ?? 'No project'}
        onImportCsv={handleImportCsv}
        onNewProject={handleNewProject}
        loading={loading}
      />
      <div className="app-body">
        <MapView points={points} project={project} />
        <Sidebar points={points} lastAction={lastAction} project={project} />
      </div>
      <StatusBar version={appVersion} platform={platform} projectPath={projectPath} pointCount={points.length} />
    </div>
  );
}
