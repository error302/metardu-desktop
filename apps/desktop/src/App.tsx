/**
 * METARDU Desktop — App root
 *
 * Production-grade desktop surveying platform with multi-panel workspace:
 *   - Top bar with app title, project name, and Import CSV button
 *   - Tab navigation: Map | Cadastral | Workflows | Statutory Forms
 *   - Each tab loads specialized UI panels
 *   - Bottom status bar with version + project info
 */

import { useEffect, useState, useCallback } from 'react';
import { MapView } from './components/MapView.js';
import { Sidebar } from './components/Sidebar.js';
import { StatusBar } from './components/StatusBar.js';
import { TopBar } from './components/TopBar.js';
import { CadastralWorkflowPanel } from './components/CadastralWorkflowPanel.js';
import { WorkflowDashboard } from './components/WorkflowDashboard.js';
import { StatutoryFormsPanel } from './components/StatutoryFormsPanel.js';
import type { SurveyPoint, ProjectRow, MetarduApi } from './types.js';

declare global {
  interface Window {
    metardu: MetarduApi;
  }
}

type Tab = 'map' | 'cadastral' | 'workflows' | 'forms';

export default function App() {
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [platform, setPlatform] = useState('');
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [lastAction, setLastAction] = useState<string>('No project open. Click File → New Project… to begin.');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('map');

  useEffect(() => {
    window.metardu.app.version().then(setAppVersion);
    window.metardu.app.platform().then(setPlatform);
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

      <nav className="tab-nav">
        <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          <span className="tab-icon">🗺️</span>
          <span>Map</span>
        </button>
        <button className={`tab ${activeTab === 'cadastral' ? 'active' : ''}`} onClick={() => setActiveTab('cadastral')}>
          <span className="tab-icon">🧭</span>
          <span>Cadastral Workflow</span>
        </button>
        <button className={`tab ${activeTab === 'workflows' ? 'active' : ''}`} onClick={() => setActiveTab('workflows')}>
          <span className="tab-icon">⚡</span>
          <span>All Workflows</span>
        </button>
        <button className={`tab ${activeTab === 'forms' ? 'active' : ''}`} onClick={() => setActiveTab('forms')}>
          <span className="tab-icon">📋</span>
          <span>Statutory Forms</span>
        </button>
      </nav>

      <div className="app-body">
        {activeTab === 'map' && (
          <>
            <MapView points={points} project={project} />
            <Sidebar points={points} lastAction={lastAction} project={project} />
          </>
        )}
        {activeTab === 'cadastral' && (
          <div className="panel-container">
            <CadastralWorkflowPanel projectId={project?.id} />
          </div>
        )}
        {activeTab === 'workflows' && (
          <div className="panel-container">
            <WorkflowDashboard />
          </div>
        )}
        {activeTab === 'forms' && (
          <div className="panel-container">
            <StatutoryFormsPanel projectId={project?.id} />
          </div>
        )}
      </div>

      <StatusBar version={appVersion} platform={platform} projectPath={projectPath} pointCount={points.length} />
    </div>
  );
}
