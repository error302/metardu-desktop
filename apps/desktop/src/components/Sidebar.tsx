import type { SurveyPoint, ProjectRow } from '../types.js';

interface SidebarProps {
  points: SurveyPoint[];
  lastAction: string;
  project: ProjectRow | null;
}

export function Sidebar({ points, lastAction, project }: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <h3>Project</h3>
        {project ? (
          <dl className="project-info">
            <dt>Name</dt><dd>{project.name}</dd>
            <dt>Country</dt><dd>{project.country_pack}</dd>
            <dt>CRS</dt><dd>EPSG:{project.default_crs_epsg}</dd>
            <dt>Created</dt><dd>{new Date(project.created_at).toLocaleString()}</dd>
          </dl>
        ) : (
          <p className="muted">No project open.</p>
        )}
      </section>

      <section className="sidebar-section">
        <h3>Points</h3>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-num">{points.length}</span>
            <span className="stat-label">total</span>
          </div>
          <div className="stat">
            <span className="stat-num">{points.filter((p) => p.code).length}</span>
            <span className="stat-label">coded</span>
          </div>
          <div className="stat">
            <span className="stat-num">{points.filter((p) => p.elevation !== null).length}</span>
            <span className="stat-label">elev.</span>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Last action</h3>
        <p className="last-action">{lastAction}</p>
      </section>

      {points.length > 0 && (
        <section className="sidebar-section points-list">
          <h3>Point list ({points.length})</h3>
          <table>
            <thead>
              <tr>
                <th>#</th><th>E</th><th>N</th><th>Z</th><th>Code</th>
              </tr>
            </thead>
            <tbody>
              {points.slice(0, 50).map((p) => (
                <tr key={p.point_number}>
                  <td className="pt-num">{p.point_number}</td>
                  <td className="num">{p.easting.toFixed(2)}</td>
                  <td className="num">{p.northing.toFixed(2)}</td>
                  <td className="num">{p.elevation !== null ? p.elevation.toFixed(2) : '—'}</td>
                  <td className="code">{p.code ?? ''}</td>
                </tr>
              ))}
              {points.length > 50 && (
                <tr><td colSpan={5} className="more-rows">+ {points.length - 50} more points…</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </aside>
  );
}
