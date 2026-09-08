import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskStatus, WorkerTask } from "./types.js";

const STATE_SCHEMA_VERSION = 1;

export class WorkerState {
  readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    const versionRow = this.database
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (versionRow.user_version > STATE_SCHEMA_VERSION) {
      this.database.close();
      throw new Error(
        `State database schema ${versionRow.user_version} is newer than supported schema ${STATE_SCHEMA_VERSION}`,
      );
    }
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        project_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        task_id TEXT,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (project_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        request TEXT NOT NULL,
        agent_profile TEXT,
        status TEXT NOT NULL,
        status_message_id TEXT,
        codex_session_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        agent_profile TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, thread_id, agent_profile)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    if (versionRow.user_version === 0) {
      this.database.exec(`PRAGMA user_version = ${STATE_SCHEMA_VERSION}`);
    }
  }

  close(): void {
    this.database.close();
  }

  recoverInterruptedTasks(): number {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database
        .prepare("UPDATE tasks SET status = 'interrupted', updated_at = ? WHERE status IN ('queued', 'running')")
        .run(now);
      this.database
        .prepare("DELETE FROM messages WHERE task_id IN (SELECT task_id FROM tasks WHERE status = 'interrupted')")
        .run();
      this.database.exec("COMMIT");
      return Number(result.changes);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  isBootstrapped(projectId: string): boolean {
    const row = this.database
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(`bootstrapped:${projectId}`) as { value: string } | undefined;
    return row?.value === "1";
  }

  markBootstrapped(projectId: string): void {
    this.database
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, '1')")
      .run(`bootstrapped:${projectId}`);
  }

  hasMessage(projectId: string, messageId: string): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM messages WHERE project_id = ? AND message_id = ?")
        .get(projectId, messageId),
    );
  }

  markSeen(projectId: string, threadId: string, messageId: string): void {
    this.database
      .prepare(
        "INSERT OR IGNORE INTO messages (project_id, message_id, thread_id, seen_at) VALUES (?, ?, ?, ?)",
      )
      .run(projectId, messageId, threadId, new Date().toISOString());
  }

  claimTask(task: WorkerTask): boolean {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const claimed = this.database
        .prepare(
          "INSERT OR IGNORE INTO messages (project_id, message_id, thread_id, task_id, seen_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(task.projectId, task.messageId, task.threadId, task.id, now);
      if (Number(claimed.changes) === 0) {
        this.database.exec("ROLLBACK");
        return false;
      }
      this.database
        .prepare(`
          INSERT INTO tasks (
            task_id, project_id, thread_id, message_id, actor_id, action,
            request, agent_profile, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `)
        .run(
          task.id,
          task.projectId,
          task.threadId,
          task.messageId,
          task.actorId ?? null,
          task.action,
          task.request,
          task.agentProfile ?? null,
          now,
          now,
        );
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateTask(
    taskId: string,
    status: TaskStatus,
    values: { statusMessageId?: string; codexSessionId?: string; error?: string } = {},
  ): void {
    const current = this.database
      .prepare("SELECT status_message_id, codex_session_id, error FROM tasks WHERE task_id = ?")
      .get(taskId) as
      | { status_message_id: string | null; codex_session_id: string | null; error: string | null }
      | undefined;
    if (!current) return;
    this.database
      .prepare(`
        UPDATE tasks
        SET status = ?, status_message_id = ?, codex_session_id = ?, error = ?, updated_at = ?
        WHERE task_id = ?
      `)
      .run(
        status,
        values.statusMessageId ?? current.status_message_id,
        values.codexSessionId ?? current.codex_session_id,
        values.error ?? current.error,
        new Date().toISOString(),
        taskId,
      );
  }

  getSession(projectId: string, threadId: string, agentProfile?: string): string | undefined {
    const row = this.database
      .prepare(
        "SELECT session_id FROM sessions WHERE project_id = ? AND thread_id = ? AND agent_profile = ?",
      )
      .get(projectId, threadId, agentProfile ?? "default") as
      | { session_id: string }
      | undefined;
    return row?.session_id;
  }

  setSession(
    projectId: string,
    threadId: string,
    sessionId: string,
    agentProfile?: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO sessions (project_id, thread_id, agent_profile, session_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, thread_id, agent_profile)
        DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
      `)
      .run(
        projectId,
        threadId,
        agentProfile ?? "default",
        sessionId,
        new Date().toISOString(),
      );
  }
}
