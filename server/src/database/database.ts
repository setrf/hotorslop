import Database from 'better-sqlite3';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type RunResult = {
  changes: number;
  lastInsertRowid: number;
};

class StatementWrapper {
  private stmt: Database.Statement;

  constructor(db: Database.Database, sql: string) {
    this.stmt = db.prepare(sql);
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...params) as Record<string, unknown> | undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[];
  }

  run(...params: unknown[]): RunResult {
    const info = this.stmt.run(...params);
    return {
      changes: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid)
    };
  }
}

class SqliteDatabase {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(statement: string): void {
    this.db.pragma(statement);
  }
}

let db: SqliteDatabase | null = null;
let rawDb: Database.Database | null = null;

export async function initializeDatabase(): Promise<void> {
  const databasePath = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../../data/hotorslop.db')
    : path.join(__dirname, '../../dev.db');

  const dbDir = path.dirname(databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Initialize better-sqlite3 with WAL mode for better concurrency
  rawDb = new Database(databasePath);
  rawDb.pragma('journal_mode = WAL');

  db = new SqliteDatabase(rawDb);

  createTables();

  console.log('Database connected and tables created');
}

export function getDatabase(): SqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function createTables(): void {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      rounds_played INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      deck_size INTEGER DEFAULT 64,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS leaderboard AS
    SELECT
      u.username,
      MAX(gs.score) as high_score,
      SUM(gs.rounds_played) as total_rounds,
      MAX(gs.correct_answers) as best_correct,
      COUNT(gs.id) as sessions_played,
      MAX(gs.end_time) as last_played
    FROM users u
    LEFT JOIN game_sessions gs ON u.id = gs.user_id
    GROUP BY u.id, u.username
    ORDER BY high_score DESC, total_rounds DESC
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON game_sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_score ON game_sessions(score DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_end_time ON game_sessions(end_time DESC)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      client_session_id TEXT NOT NULL,
      deck_id TEXT,
      deck_size INTEGER,
      device TEXT,
      opted_in INTEGER DEFAULT 1,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      deck_id TEXT,
      deck_position INTEGER,
      card_id TEXT NOT NULL,
      dataset_source TEXT NOT NULL,
      label TEXT NOT NULL,
      model TEXT,
      prompt_length INTEGER,
      guessed_answer TEXT NOT NULL,
      correct INTEGER NOT NULL,
      latency_ms INTEGER,
      confidence REAL,
      guess_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES analytics_sessions (id) ON DELETE CASCADE
    )
  `);

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_sessions_client ON analytics_sessions(client_session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user ON analytics_sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_guesses_session ON analytics_guesses(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_guesses_model ON analytics_guesses(model)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_guesses_dataset ON analytics_guesses(dataset_source)');
}
