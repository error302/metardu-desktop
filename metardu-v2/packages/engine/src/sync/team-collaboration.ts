/**
 * Multi-user collaboration — team management + project sharing.
 *
 * Extends the sync client with team features:
 *   - Team member management (invite, remove, roles)
 *   - Project sharing (set visibility: private, team, public)
 *   - Activity feed (who did what, when)
 *   - Comments + annotations on projects
 *   - Role-based access control (owner, editor, viewer)
 *
 * References:
 *   - metardu web /community/directory page
 *   - metardu-access sync module
 *   - Linear's team collaboration model
 */

// ─── Types ───────────────────────────────────────────────────────

export type TeamRole = "owner" | "editor" | "viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatarUrl?: string;
  lastActiveAt?: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];
  createdAt: string;
  ownerId: string;
}

export type ProjectVisibility = "private" | "team" | "public";

export interface SharedProject {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  teamId?: string;
  visibility: ProjectVisibility;
  sharedWith: string[]; // user IDs
  lastModified: string;
  lastModifiedBy: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  action: "created" | "updated" | "deleted" | "commented" | "shared" | "signed";
  description: string;
  timestamp: string;
}

export interface ProjectComment {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
  resolved: boolean;
}

// ─── Team manager ───────────────────────────────────────────────

export class TeamManager {
  private teams: Map<string, Team> = new Map();
  private sharedProjects: Map<string, SharedProject> = new Map();
  private activities: ActivityEvent[] = [];
  private comments: Map<string, ProjectComment[]> = new Map();
  private currentUserId: string;

  constructor(userId: string, userName: string, email: string) {
    this.currentUserId = userId;
    // Auto-create a personal team.
    const personalTeam: Team = {
      id: `team_${userId}`,
      name: `${userName}'s Team`,
      members: [{ id: userId, name: userName, email, role: "owner" }],
      createdAt: new Date().toISOString(),
      ownerId: userId,
    };
    this.teams.set(personalTeam.id, personalTeam);
  }

  // ── Team management ──────────────────────────────────────────

  createTeam(name: string, description?: string): Team {
    const team: Team = {
      id: `team_${Date.now()}`,
      name,
      description,
      members: [{
        id: this.currentUserId,
        name: this.teams.values().next().value?.members[0]?.name ?? "User",
        email: this.teams.values().next().value?.members[0]?.email ?? "",
        role: "owner",
      }],
      createdAt: new Date().toISOString(),
      ownerId: this.currentUserId,
    };
    this.teams.set(team.id, team);
    return team;
  }

  inviteMember(teamId: string, name: string, email: string, role: TeamRole = "editor"): TeamMember {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found.`);
    const member: TeamMember = { id: `user_${Date.now()}`, name, email, role };
    team.members.push(member);
    return member;
  }

  removeMember(teamId: string, memberId: string): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found.`);
    team.members = team.members.filter((m) => m.id !== memberId);
  }

  updateMemberRole(teamId: string, memberId: string, role: TeamRole): void {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Team ${teamId} not found.`);
    const member = team.members.find((m) => m.id === memberId);
    if (member) member.role = role;
  }

  getTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  // ── Project sharing ──────────────────────────────────────────

  shareProject(projectId: string, teamId?: string, visibility: ProjectVisibility = "team"): SharedProject {
    const project: SharedProject = {
      id: projectId,
      name: projectId, // caller should set the real name
      ownerId: this.currentUserId,
      teamId,
      visibility,
      sharedWith: [],
      lastModified: new Date().toISOString(),
      lastModifiedBy: this.currentUserId,
    };
    this.sharedProjects.set(projectId, project);

    if (teamId) {
      const team = this.teams.get(teamId);
      if (team) {
        project.sharedWith = team.members.map((m) => m.id);
      }
    }

    this.logActivity(projectId, "shared", `Project shared with ${visibility} visibility`);
    return project;
  }

  setProjectVisibility(projectId: string, visibility: ProjectVisibility): void {
    const project = this.sharedProjects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    project.visibility = visibility;
  }

  getSharedProjects(): SharedProject[] {
    return Array.from(this.sharedProjects.values()).filter(
      (p) => p.ownerId === this.currentUserId || p.sharedWith.includes(this.currentUserId) || p.visibility === "public",
    );
  }

  canEdit(projectId: string): boolean {
    const project = this.sharedProjects.get(projectId);
    if (!project) return false;
    if (project.ownerId === this.currentUserId) return true;
    if (project.visibility === "public") return false;
    if (project.teamId) {
      const team = this.teams.get(project.teamId);
      if (!team) return false;
      const member = team.members.find((m) => m.id === this.currentUserId);
      return member?.role === "editor" || member?.role === "owner";
    }
    return false;
  }

  canView(projectId: string): boolean {
    const project = this.sharedProjects.get(projectId);
    if (!project) return false;
    if (project.visibility === "public") return true;
    if (project.ownerId === this.currentUserId) return true;
    return project.sharedWith.includes(this.currentUserId);
  }

  // ── Activity feed ────────────────────────────────────────────

  logActivity(projectId: string, action: ActivityEvent["action"], description: string): void {
    const team = this.teams.values().next().value;
    const userName = team?.members.find((m) => m.id === this.currentUserId)?.name ?? "User";
    this.activities.push({
      id: `act_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      projectId,
      userId: this.currentUserId,
      userName,
      action,
      description,
      timestamp: new Date().toISOString(),
    });
  }

  getActivityFeed(projectId?: string, limit: number = 50): ActivityEvent[] {
    let feed = this.activities;
    if (projectId) feed = feed.filter((a) => a.projectId === projectId);
    return feed.slice(-limit).reverse();
  }

  // ── Comments ─────────────────────────────────────────────────

  addComment(projectId: string, text: string): ProjectComment {
    const team = this.teams.values().next().value;
    const userName = team?.members.find((m) => m.id === this.currentUserId)?.name ?? "User";
    const comment: ProjectComment = {
      id: `cmt_${Date.now()}`,
      projectId,
      userId: this.currentUserId,
      userName,
      text,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
    const comments = this.comments.get(projectId) ?? [];
    comments.push(comment);
    this.comments.set(projectId, comments);
    this.logActivity(projectId, "commented", `Comment: "${text.substring(0, 50)}..."`);
    return comment;
  }

  resolveComment(projectId: string, commentId: string): void {
    const comments = this.comments.get(projectId);
    if (!comments) return;
    const comment = comments.find((c) => c.id === commentId);
    if (comment) comment.resolved = true;
  }

  getComments(projectId: string): ProjectComment[] {
    return this.comments.get(projectId) ?? [];
  }
}
