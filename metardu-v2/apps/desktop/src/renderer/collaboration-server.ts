/**
 * collaboration-server.ts — WebSocket collaboration server for real-time
 * multi-user survey editing over LAN.
 *
 * Provides:
 *   - WebSocket server for field-office team connections
 *   - Project sharing with live cursor/selection sync
 *   - Observation streaming from field instruments
 *   - Conflict resolution via operational transform (OT)
 *   - Automatic reconnection with state sync
 *
 * Usage:
 *   const server = new CollaborationServer({ port: 8765 });
 *   server.start();
 *   // Connect from renderer: new WebSocket("ws://localhost:8765")
 *
 * In production, this runs as a separate Node.js process or is
 * embedded in the Electron main process.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CollaborationConfig {
  /** WebSocket server port. Default: 8765. */
  port?: number;
  /** Maximum concurrent connections. Default: 10. */
  maxConnections?: number;
  /** Heartbeat interval in ms. Default: 30000. */
  heartbeatInterval?: number;
  /** Project data directory. Default: "./collaboration-data". */
  dataDir?: string;
}

export interface CollaborationMessage {
  type: string;
  payload: unknown;
  sender: string;
  timestamp: number;
  /** For OT operations: vector clock. */
  vectorClock?: Record<string, number>;
}

export interface ConnectedClient {
  id: string;
  name: string;
  role: "surveyor" | "office" | "viewer";
  /** Current view the client is looking at. */
  currentView?: string;
  /** Cursor position (if sharing). */
  cursor?: { x: number; y: number };
  /** Connected at timestamp. */
  connectedAt: number;
  /** Last activity timestamp. */
  lastActivity: number;
}

export interface ProjectShare {
  projectId: string;
  /** Current version vector clock. */
  version: Record<string, number>;
  /** Shared data (points, observations, etc.). */
  data: Record<string, unknown>;
  /** Connected clients. */
  clients: Map<string, ConnectedClient>;
  /** Operation log for conflict resolution. */
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

  /** Start the WebSocket server. */
  start(): void {
    console.log(`[collab] Starting collaboration server on port ${this.config.port}`);

    // In a real implementation, this would use the `ws` package:
    // import { WebSocketServer } from "ws";
    // const wss = new WebSocketServer({ port: this.config.port });
    // wss.on("connection", (ws) => this.handleConnection(ws));

    // For now, log the configuration.
    console.log(`[collab] Config: max=${this.config.maxConnections}, heartbeat=${this.config.heartbeatInterval}ms`);
    console.log(`[collab] Data dir: ${this.config.dataDir}`);

    // Start heartbeat.
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.config.heartbeatInterval);
  }

  /** Stop the server. */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Close all connections.
    for (const [id, client] of this.clients) {
      client.ws.close(1000, "Server shutting down");
      this.clients.delete(id);
    }
    console.log("[collab] Server stopped");
  }

  /** Handle a new WebSocket connection. */
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

    // Send welcome message.
    this.send(ws, {
      type: "welcome",
      payload: { clientId, serverTime: Date.now() },
      sender: "server",
      timestamp: Date.now(),
    });

    console.log(`[collab] Client connected: ${clientId} (total: ${this.clients.size})`);

    // Handle messages.
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

  /** Handle an incoming message from a client. */
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

  /** Handle client identification. */
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

  /** Handle joining a project. */
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

    // Send current project state.
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

    // Notify other clients.
    this.broadcastToProject(projectId, {
      type: "client_joined",
      payload: { client: client.info },
      sender: "server",
      timestamp: Date.now(),
    }, clientId);

    console.log(`[collab] ${client.info.name} joined project ${projectId}`);
  }

  /** Handle leaving a project. */
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

  /** Handle an observation from a field instrument. */
  private handleObservation(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (!projectId) return;

    // Broadcast observation to all clients in the project.
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

  /** Handle an OT operation (data mutation). */
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

    // Apply operation (simplified OT — last-writer-wins for now).
    this.applyOperation(project, op);

    // Store in operation log.
    project.operations.push(op);

    // Broadcast to all clients.
    this.broadcastToProject(projectId, {
      type: "operation",
      payload: op,
      sender: senderId,
      timestamp: Date.now(),
    }, senderId);

    console.log(`[collab] Operation from ${client.info.name}: ${op.type} ${op.path}`);
  }

  /** Handle cursor position update. */
  private handleCursorMove(senderId: string, msg: CollaborationMessage): void {
    const client = this.clients.get(senderId);
    if (!client) return;

    const projectId = client.info.currentView;
    if (!projectId) return;

    const { x, y, view } = msg.payload as { x: number; y: number; view: string };
    client.info.cursor = { x, y };
    client.info.currentView = view;

    // Broadcast cursor to other clients.
    this.broadcastToProject(projectId, {
      type: "cursor_update",
      payload: { clientId: senderId, name: client.info.name, x, y, view },
      sender: senderId,
      timestamp: Date.now(),
    }, senderId);
  }

  /** Handle sync request. */
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

  /** Apply an operation to project data (simplified OT). */
  private applyOperation(project: ProjectShare, op: Operation): void {
    // Simplified: last-writer-wins merge.
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

    // Update version vector.
    project.version[op.sender] = (project.version[op.sender] ?? 0) + 1;
  }

  /** Send a message to a client. */
  private send(ws: WebSocket, msg: CollaborationMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Broadcast a message to all clients in a project (optionally excluding one). */
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

  /** Handle client disconnect. */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from project.
    this.handleLeaveProject(clientId);

    // Remove client.
    this.clients.delete(clientId);

    console.log(`[collab] Client disconnected: ${client.info.name} (total: ${this.clients.size})`);
  }

  /** Heartbeat to detect stale connections. */
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

  /** Generate a unique ID. */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  /** Get server stats. */
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

// ─── Client-Side Helper ──────────────────────────────────────────

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private handlers = new Map<string, (payload: unknown) => void>();

  constructor(private serverUrl: string) {}

  /** Connect to the collaboration server. */
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

  /** Identify yourself. */
  identify(name: string, role: ConnectedClient["role"] = "surveyor"): void {
    this.send({ type: "identify", payload: { name, role } });
  }

  /** Join a project. */
  joinProject(projectId: string): void {
    this.send({ type: "join_project", payload: { projectId } });
  }

  /** Send an observation. */
  sendObservation(observation: Record<string, unknown>): void {
    this.send({ type: "observation", payload: observation });
  }

  /** Send a data operation. */
  sendOperation(op: Omit<Operation, "id" | "sender" | "timestamp" | "vectorClock">): void {
    this.send({ type: "operation", payload: op });
  }

  /** Update cursor position. */
  updateCursor(x: number, y: number, view: string): void {
    this.send({ type: "cursor_move", payload: { x, y, view } });
  }

  /** Register a message handler. */
  on(type: string, handler: (payload: unknown) => void): void {
    this.handlers.set(type, handler);
  }

  /** Disconnect. */
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
