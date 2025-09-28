# Hot or Slop Backend Server

A Node.js/Express backend server for the Hot or Slop game that provides persistent score storage, analytics ingestion, and global leaderboards.

## Features

- **User Management**: Simple username-based user identification (no authentication required)
- **Score Persistence**: Save and retrieve game scores with detailed statistics
- **Global Leaderboards**: Real-time leaderboards with filtering options
- **Session Tracking**: Track individual game sessions, per-guess analytics, and aggregate accuracy trends
- **sql.js Database**: Pure JavaScript SQLite runtime persisted to disk—no native builds required
- **Analytics API**: Ingest batched guess events (`/api/analytics/ingest`) and expose summaries (`/api/analytics/summary`)

## Quick Start

1. **Install dependencies** (Node 18+ recommended; tested with Node 24):
   ```bash
   cd server
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env if needed
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3001` by default.

## API Endpoints

### Users
- `POST /api/users/register` - Register a new user
- `GET /api/users/:username` - Get user information and statistics

### Scores
- `POST /api/scores/save` - Save a game score
- `GET /api/scores/user/:username` - Get user's recent scores
- `GET /api/scores/user/:username/best` - Get user's best score

### Leaderboard
- `GET /api/leaderboard` - Get global leaderboard
- `GET /api/leaderboard/rank/:username` - Get user's rank
- `GET /api/leaderboard/stats` - Get leaderboard statistics

### Analytics
- `POST /api/analytics/ingest` - Store a batch of analytics events from the client
- `GET /api/analytics/summary` - Retrieve aggregate analytics for dashboards/UI widgets
- `GET /api/analytics/overview` - Expanded totals, accuracy, activity windows, and metadata counts
- `GET /api/analytics/datasets` - Per-dataset accuracy, latency, and volume metrics
- `GET /api/analytics/models` - Top models by guesses with accuracy and recency
- `GET /api/analytics/timeline` - Time bucketed guesses/accuracy (supports `range=7d|30d|90d`)
- `GET /api/analytics/players` - Opted-in player performance summaries

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Game Sessions Table
```sql
CREATE TABLE game_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  rounds_played INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  deck_size INTEGER DEFAULT 64,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

## Development

- **Database File**: `dev.db` (development) or `data/hotorslop.db` (production)
- **Persistence**: sql.js writes the database to disk after each mutation—no WAL or native extensions needed
- **Auto-migration**: Database tables are created automatically on startup
- **Hot Reload**: Uses `tsx` for TypeScript development with hot reloading

## Deployment

For production deployment:

1. Set `NODE_ENV=production` in your environment
2. Update `FRONTEND_URL` to match your frontend domain
3. The database will be stored in `data/hotorslop.db`
4. Consider using a process manager like PM2

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for CORS |
