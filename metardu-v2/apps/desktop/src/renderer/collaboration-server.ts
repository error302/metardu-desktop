/**
 * WebSocket collaboration server for real-time multi-user survey
 * editing over LAN. Runs in the Electron main process.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CollaborationConfig {
  port?: number;
  maxConnections?: number;
  heartbeatInterval?: number;
  dataDir?: string;
}

export interface CollaborationMessage {
  type: string;
  payload: unknown;
  sender: string;
  timestamp: number;
  vectorClock?: Record<string, number>;
}

export interface ConnectedClient {
  id: string;
  name: string;
  role: "surveyor" | "office" | "viewer";
  currentView?: string;
  cursor?: { x: number; y: number };
  connectedAt: number;
  lastActivity: number;
}

export interface ProjectShare {
  projectId: string;
  version: Record<string, number>;
  data: Record<string, unknown>;
  clients: Map<string, ConnectedClient>;
  operations: Operation[];
}

export interface Operation {
  id: string;
  type: "insert" | "update" | "delete";
  path: string;
  value: unknown;
  sender: string;
  timestamp: number;
  vectorClock: Record<string, number>;
}

// ─── Server Implementation ───────────────────────────────────────

export class CollaborationServer {
  private config: Required<CollaborationConfig>;
  private projects = new Map<string, ProjectShare>();
  private clients = new Map<string, { ws: WebSocket; info: ConnectedClient }>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CollaborationConfig = {}) {
    this.config = {
      port: config.port ?? 8765,
      maxConnections: config.maxConnections ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30_000,
      dataDir: config.dataDir ?? "./collaboration-data",
    };
  }

  start(): void {
    console.log(`[collab] Starting on port ${this.config.port}`);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.config.heartbeatInterval);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [id, client] of this.clients) {
      client.ws.close(1000, "Server shutting down");
      this.clients.delete(id);
    }
  }

  handleConnection(ws: WebSocket): void {
    if (this.clients.size >= this.config.maxConnections) {
      ws.close(1013, "Server full");
      return;
    }

    const clientId = this.generateId();
    const clientInfo: ConnectedClient = {
      id: clientId,
      name: "Anonymous",
      role: "viewer",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.clients.set(clientId, { ws, info: clientInfo });
    this.send(ws, {
      type: "welcome",
      payload: { clientId, serverTime: Date.now() },
      sender: "server",
      timestamp: Date.now(),
    });

    console.log(`[collab] Client connected: ${clientId} (total: ${this.clients.size})`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as CollaborationMessage;
        this.handleMessage(clientId, msg);
      } catch (e) {
        console.error(`[collab] Invalid message from ${clientId}:`, e);
      }
    };

    ws.onclose = () => {
      this.handleDisconnect(clientId);
    };

    ws.onerror = (error) => {
      console.error(`[collab] Error from ${clientId}:`, error);
    };
  }

  private handleMessage(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    client.info.lastActivity = Date.now();

    switch (msg.type) {
      case "identify":
        this.handleIdentify(senderId, msg);
        break;
      case "join_project":
        this.handleJoinProject(senderId, msg);
        break;
      case "leave_project":
        this.handleLeaveProject(senderId);
        break;
      case "observation":
        this.handleObservation(senderId, msg);
        break;
      case "operation":
        this.handleOperation(senderId, msg);
        break;
      case "cursor_move":
        this.handleCursorMove(senderId, msg);
        break;
      case "request_sync":
        this.handleSyncRequest(senderId, msg);
        break;
      case "ping":
        this.send(client.ws, {
          type: "pong",
          payload: {},
          sender: "server",
          timestamp: Date.now(),
        });
        break;
      default:
        console.log(`[collab] Unknown message type: ${msg.type}`);
    }
  }

  private handleIdentify(clientId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { name, role } = msg.payload as { name: string; role: ConnectedClient["role"] };
    client.info.name = name || "Anonymous";
    client.info.role = role || "viewer";

    this.send(client.ws, {
      type: "identified",
      payload: { clientId, name: client.info.name, role: client.info.role },
      sender: "server",
      timestamp: Date.now(),
    });

    console.log(`[collab] Client identified: ${client.info.name} (${client.info.role})`);
  }

  private handleJoinProject(clientId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { projectId } = msg.payload as { projectId: string };
    let project = this.projects.get(projectId);

    if (!project) {
      project = {
        projectId: projectId,
        version: {},
        data: {},
        clients: new Map(),
        operations: [],
      };
      this.projects.set(projectId, project);
    }

    project.clients.set(clientId, client.info);
    client.info.currentView = projectId;

    this.send(client.ws, {
      type: "project_state",
      payload: {
        projectId: projectId,
        version: project.version,
        data: project.data,
        clients: Array.from(project.clients.values()),
        recentOperations: project.operations.slice(-50),
      },
      sender: "server",
      timestamp: Date.now(),
    });

    this.broadcastToProject(projectId, {
      type: "client_joined",
      payload: { client: client.info },
      sender: "server",
      timestamp: Date.now(),
    }, clientId);

    console.log(`[collab] ${client.info.name} joined project ${projectId}`);
  }

  private handleLeaveProject(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (projectId) {
      const project = this.projects.get(projectId);
      if (project) {
        project.clients.delete(clientId);
        this.broadcastToProject(projectId, {
          type: "client_left",
          payload: { clientId, name: client.info.name },
          sender: "server",
          timestamp: Date.now(),
        });
      }
    }
    client.info.currentView = undefined;
  }

  private handleObservation(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (!projectId) return;

    this.broadcastToProject(projectId, {
      type: "observation",
      payload: {
        ...msg.payload as Record<string, unknown>,
        station: client.info.name,
        stationId: senderId,
      },
      sender: senderId,
      timestamp: Date.now(),
    });

    console.log(`[collab] Observation from ${client.info.name}:`, (msg.payload as Record<string, unknown>).type);
  }

  private handleOperation(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (!projectId) return;

    const project = this.projects.get(projectId);
    if (!project) return;

    const op = msg.payload as Operation;
    op.id = this.generateId();
    op.sender = senderId;
    op.timestamp = Date.now();

    this.applyOperation(project, op);
    project.operations.push(op);
    this.broadcastToProject(projectId, {
      type: "operation",
      payload: op,
      sender: senderId,
      timestamp: Date.now(),
    }, senderId);

    console.log(`[collab] Operation from ${client.info.name}: ${op.type} ${op.path}`);
  }

  private handleCursorMove(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (!projectId) return;

    const { x, y, view } = msg.payload as { x: number; y: number; view: string };
    client.info.cursor = { x, y };
    client.info.currentView = view;

    this.broadcastToProject(projectId, {
      type: "cursor_update",
      payload: { clientId: senderId, name: client.info.name, x, y, view },
      sender: senderId,
      timestamp: Date.now(),
    }, senderId);
  }

  private handleSyncRequest(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const payload = msg.payload as { projectId: string };
    const project = this.projects.get(payload.projectId);
    if (!project) {
      this.send(client.ws, {
        type: "sync_response",
        payload: { error: "Project not found" },
        sender: "server",
        timestamp: Date.now(),
      });
      return;
    }

    this.send(client.ws, {
      type: "sync_response",
      payload: {
        projectId: payload.projectId,
        version: project.version,
        data: project.data,
        operations: project.operations,
      },
      sender: "server",
      timestamp: Date.now(),
    });
  }

  private applyOperation(project: ProjectShare, op: Operation): void {
    const pathParts = op.path.split("/").filter(Boolean);
    let target: Record<string, unknown> = project.data;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = pathParts[i]!;
      if (!(key in target)) {
        target[key] = {};
      }
      target = target[key] as Record<string, unknown>;
    }

    const lastKey = pathParts[pathParts.length - 1];
    if (!lastKey) return;

    switch (op.type) {
      case "insert":
      case "update":
        target[lastKey] = op.value;
        break;
      case "delete":
        delete target[lastKey];
        break;
    }

    project.version[op.sender] = (project.version[op.sender] ?? 0) + 1;
  }

  private send(ws: WebSocket, msg: CollaborationMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastToProject(
    projectId: string,
    msg: CollaborationMessage,
    excludeId?: string,
  ): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    for (const [clientId] of project.clients) {
      if (clientId === excludeId) continue;
      const client = this.clients.get(clientId);
      if (client) {
        this.send(client.ws, msg);
      }
    }
  }

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.handleLeaveProject(clientId);
    this.clients.delete(clientId);

    console.log(`[collab] Client disconnected: ${client.info.name} (total: ${this.clients.size})`);
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const [clientId, client] of this.clients) {
      if (now - client.info.lastActivity > this.config.heartbeatInterval * 2) {
        console.log(`[collab] Client timeout: ${client.info.name}`);
        client.ws.close(4000, "Heartbeat timeout");
        this.handleDisconnect(clientId);
      }
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  getStats() {
    return {
      clients: this.clients.size,
      projects: this.projects.size,
      totalOperations: Array.from(this.projects.values()).reduce(
        (sum, p) => sum + p.operations.length, 0,
      ),
    };
  }
}

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private handlers = new Map<string, (payload: unknown) => void>();

  constructor(private serverUrl: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log(`[collab-client] Connected to ${this.serverUrl}`);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as CollaborationMessage;
          const handler = this.handlers.get(msg.type);
          if (handler) handler(msg.payload);

          if (msg.type === "welcome") {
            this.clientId = (msg.payload as { clientId: string }).clientId;
          }
        } catch (e) {
          console.error("[collab-client] Parse error:", e);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[collab-client] Error:", error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log("[collab-client] Disconnected");
      };
    });
  }

  identify(name: string, role: ConnectedClient["role"] = "surveyor"): void {
    this.send({ type: "identify", payload: { name, role } });
  }

  joinProject(projectId: string): void {
    this.send({ type: "join_project", payload: { projectId } });
  }

  sendObservation(observation: Record<string, unknown>): void {
    this.send({ type: "observation", payload: observation });
  }

  sendOperation(op: Omit<Operation, "id" | "sender" | "timestamp" | "vectorClock">): void {
    this.send({ type: "operation", payload: op });
  }

  updateCursor(x: number, y: number, view: string): void {
    this.send({ type: "cursor_move", payload: { x, y, view } });
  }

  on(type: string, handler: (payload: unknown) => void): void {
    this.handlers.set(type, handler);
  }

  disconnect(): void {
    this.ws?.close(1000, "Client disconnect");
    this.ws = null;
  }

  private send(msg: Omit<CollaborationMessage, "sender" | "timestamp">): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        ...msg,
        sender: this.clientId ?? "unknown",
        timestamp: Date.now(),
      }));
    }
  }
}
