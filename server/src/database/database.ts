import initSqlJs, {
  type Database as SqlJsDatabase,
  type Statement as SqlJsStatement,
  type SqlJsStatic
} from 'sql.js';
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
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string,
    private readonly persist: () => void
  ) {}

  private bind(stmt: SqlJsStatement, params: unknown[]): void {
    if (!params || params.length === 0) return;
    stmt.bind(params as SqlValue[]);
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql);
    try {
      this.bind(stmt, params);
      if (!stmt.step()) return undefined;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql);
    try {
      this.bind(stmt, params);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params: unknown[]): RunResult {
    const stmt = this.db.prepare(this.sql);
    try {
      this.bind(stmt, params);
      // Step through the statement to ensure side effects occur.
      while (stmt.step()) {
        // no-op: stepping executes the statement.
      }
    } finally {
      stmt.free();
    }

    const info = this.db.exec('SELECT changes() AS changes, last_insert_rowid() AS last_insert_rowid');
    const result: RunResult = { changes: 0, lastInsertRowid: 0 };

    if (info.length > 0 && info[0].values.length > 0) {
      const columns = info[0].columns;
      const values = info[0].values[0];
      const changesIndex = columns.indexOf('changes');
      const idIndex = columns.indexOf('last_insert_rowid');
      if (changesIndex >= 0) {
        result.changes = Number(values[changesIndex] ?? 0);
      }
      if (idIndex >= 0) {
        result.lastInsertRowid = Number(values[idIndex] ?? 0);
      }
    }

    this.persist();
    return result;
  }
}

class SqliteDatabase {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly persist: () => void
  ) {}

  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql, this.persist);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.persist();
  }

  pragma(statement: string): void {
    this.db.exec(`PRAGMA ${statement}`);
    this.persist();
  }
}

type SqlValue = number | string | Uint8Array | null;

let sqlModule: SqlJsStatic | null = null;
let db: SqliteDatabase | null = null;
let rawDb: SqlJsDatabase | null = null;
let databasePath: string;

const loadSqlModule = async (): Promise<SqlJsStatic> => {
  if (sqlModule) return sqlModule;
  sqlModule = await initSqlJs({
    locateFile: (file: string) => path.join(path.resolve(__dirname, '../../'), 'node_modules/sql.js/dist', file)
  });
  return sqlModule;
};

const persistDatabase = () => {
  if (!rawDb || !databasePath) return;
  const data = rawDb.export();
  fs.writeFileSync(databasePath, Buffer.from(data));
};

export async function initializeDatabase(): Promise<void> {
  const SQL = await loadSqlModule();

  databasePath = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, '../../data/hotorslop.db')
    : path.join(__dirname, '../../dev.db');

  const dbDir = path.dirname(databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  let fileBuffer: Uint8Array | undefined;
  if (fs.existsSync(databasePath)) {
    const buffer = fs.readFileSync(databasePath);
    fileBuffer = new Uint8Array(buffer);
  }

  rawDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
  db = new SqliteDatabase(rawDb, persistDatabase);

  // Align with previous behaviour; not all pragmas affect sql.js but kept for compatibility.
  rawDb.exec('PRAGMA journal_mode = WAL');

  createTables();
  persistDatabase();

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
