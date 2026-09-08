export type JsonObject = Record<string, unknown>;

export interface BridgeProtocol {
  name: string;
  version: number;
}

export interface BridgeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BridgeEnvelope<T = unknown> {
  protocol: BridgeProtocol;
  kind: string;
  operation: string;
  ok: boolean;
  sessionId?: string;
  sequence?: number;
  data?: T;
  error?: BridgeError;
}

export interface CommentActor {
  id: string;
  name?: string;
}

export interface CommentMessage {
  id: string;
  content: string;
  author?: CommentActor;
  createdAt?: string;
  editedAt?: string;
}

export interface CommentAnchor {
  documentId: string;
  path: string;
  state: "attached" | "collapsed" | string;
  sourceRangeUtf16?: { from: number; to: number };
  visibleRangeUtf16?: { from: number; to: number };
  text?: string;
  before?: string;
  after?: string;
}

export interface CommentThread {
  id: string;
  state: string;
  messages: CommentMessage[];
  anchors: CommentAnchor[];
  anchorState?: string;
  detachedReason?: string;
}

export interface ProjectDescriptor {
  id: string;
  name?: string;
}

export interface DocumentDescriptor {
  id: string;
  path: string;
  remoteVersion: number;
  contentHash: string;
}

export interface CommentSnapshot {
  project: ProjectDescriptor;
  documents: DocumentDescriptor[];
  threads: CommentThread[];
}

export interface ThreadContext {
  project: ProjectDescriptor;
  documents: DocumentDescriptor[];
  thread: CommentThread;
}

export interface CommentEventData {
  type: string;
  projectId: string;
  threadId: string;
  messageId?: string;
  actor?: CommentActor;
  observedAt?: string;
}

export type AgentName = "codex" | "kimi";

export type TaskAction = "ask" | "suggest" | "edit" | "compile";

export interface Trigger {
  agent?: AgentName;
  action: TaskAction;
  request: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "needs_input"
  | "blocked"
  | "failed"
  | "interrupted";

export interface WorkerTask {
  id: string;
  projectId: string;
  threadId: string;
  messageId: string;
  actorId?: string;
  agent: AgentName;
  action: TaskAction;
  request: string;
}

export interface AgentValidation {
  name: string;
  status: "passed" | "failed" | "not_run";
  summary: string;
}

export interface AgentChangedFile {
  path: string;
  summary: string;
}

export interface AgentResult {
  schemaVersion: 1;
  taskId: string;
  status: "completed" | "no_changes" | "needs_input" | "blocked";
  summary: string;
  changedFiles: AgentChangedFile[];
  validation: AgentValidation[];
  question: string | null;
  warnings: string[];
}

export interface AgentProgress {
  phase: string;
  detail: string;
}
