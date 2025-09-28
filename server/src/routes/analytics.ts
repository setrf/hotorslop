import express from 'express';
import { z } from 'zod';
import { getDatabase } from '../database/database.js';

const router = express.Router();

const usernameSchema = z.string()
  .min(1)
  .max(50)
  .regex(/^[a-zA-Z0-9_-]+$/);

const sessionSchema = z.object({
  clientSessionId: z.string().min(1).max(120),
  username: usernameSchema.optional(),
  deckId: z.string().trim().max(120).optional(),
  deckSize: z.number().int().positive().max(1024).optional(),
  device: z.string().trim().max(200).optional(),
  optedIn: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional()
});

const guessEventSchema = z.object({
  deckId: z.string().trim().max(120).optional(),
  deckPosition: z.number().int().min(0).max(1024).optional(),
  cardId: z.string().min(1).max(180),
  datasetSource: z.enum(['synthetic', 'real']),
  label: z.enum(['fake', 'real']),
  model: z.string().trim().max(160).optional(),
  promptLength: z.number().int().min(0).max(20000).optional(),
  guessedAnswer: z.enum(['ai', 'real']),
  correct: z.boolean(),
  latencyMs: z.number().int().min(0).max(600000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string().datetime().optional()
});

const ingestSchema = z.object({
  session: sessionSchema,
  events: z.array(guessEventSchema).min(1)
});

type IngestPayload = z.infer<typeof ingestSchema>;

const normalizeUsername = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.toLowerCase().trim();
};

const toSqlBoolean = (value: boolean | undefined): number | undefined => {
  if (value === undefined) return undefined;
  return value ? 1 : 0;
};

router.post('/ingest', (req, res) => {
  try {
    const payload = ingestSchema.parse(req.body) as IngestPayload;
    const db = getDatabase();

    const normalizedUsername = normalizeUsername(payload.session.username);
    let userId: number | null | undefined;

    if (normalizedUsername) {
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername) as { id: number } | undefined;
      userId = user?.id ?? null;
    }

    const clientSessionId = payload.session.clientSessionId.trim();
    const existingSession = db.prepare('SELECT id FROM analytics_sessions WHERE client_session_id = ?').get(clientSessionId) as { id: number } | undefined;

    let sessionId: number;

    const optedInInt = toSqlBoolean(payload.session.optedIn);

    if (!existingSession) {
      const insert = db.prepare(`
        INSERT INTO analytics_sessions (
          user_id,
          client_session_id,
          deck_id,
          deck_size,
          device,
          opted_in,
          started_at,
          ended_at
        ) VALUES (?, ?, ?, ?, ?, COALESCE(?, 1), COALESCE(?, CURRENT_TIMESTAMP), ?)
      `);

      const result = insert.run(
        userId ?? null,
        clientSessionId,
        payload.session.deckId ?? null,
        payload.session.deckSize ?? null,
        payload.session.device ?? null,
        optedInInt,
        payload.session.startedAt ?? null,
        payload.session.endedAt ?? null
      );

      sessionId = Number(result.lastInsertRowid);
    } else {
      sessionId = existingSession.id;

      const updateFields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const updateValues: unknown[] = [];

      if (userId !== undefined) {
        updateFields.push('user_id = ?');
        updateValues.push(userId);
      }
      if (payload.session.deckId !== undefined) {
        updateFields.push('deck_id = ?');
        updateValues.push(payload.session.deckId ?? null);
      }
      if (payload.session.deckSize !== undefined) {
        updateFields.push('deck_size = ?');
        updateValues.push(payload.session.deckSize);
      }
      if (payload.session.device !== undefined) {
        updateFields.push('device = ?');
        updateValues.push(payload.session.device ?? null);
      }
      if (optedInInt !== undefined) {
        updateFields.push('opted_in = ?');
        updateValues.push(optedInInt);
      }
      if (payload.session.startedAt) {
        updateFields.push('started_at = ?');
        updateValues.push(payload.session.startedAt);
      }
      if (payload.session.endedAt) {
        updateFields.push('ended_at = ?');
        updateValues.push(payload.session.endedAt);
      }

      if (updateFields.length > 1) {
        updateValues.push(sessionId);
        db.prepare(`UPDATE analytics_sessions SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
      } else {
        db.prepare('UPDATE analytics_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
      }
    }

    const insertGuess = db.prepare(`
      INSERT INTO analytics_guesses (
        session_id,
        deck_id,
        deck_position,
        card_id,
        dataset_source,
        label,
        model,
        prompt_length,
        guessed_answer,
        correct,
        latency_ms,
        confidence,
        guess_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    payload.events.forEach((event) => {
      insertGuess.run(
        sessionId,
        event.deckId ?? payload.session.deckId ?? null,
        event.deckPosition ?? null,
        event.cardId,
        event.datasetSource,
        event.label,
        event.model ?? null,
        event.promptLength ?? null,
        event.guessedAnswer,
        event.correct ? 1 : 0,
        event.latencyMs ?? null,
        event.confidence ?? null,
        event.timestamp ?? null
      );
    });

    res.json({
      success: true,
      sessionId,
      eventsStored: payload.events.length
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors
      });
      return;
    }

    console.error('Analytics ingest error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

router.get('/summary', (_req, res) => {
  try {
    const db = getDatabase();

    const baseStats = db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) AS sessions,
        COUNT(g.id) AS guesses,
        AVG(g.correct) AS accuracy,
        AVG(g.latency_ms) AS avg_latency,
        COUNT(DISTINCT CASE WHEN s.user_id IS NOT NULL THEN s.user_id END) AS participants
      FROM analytics_sessions s
      LEFT JOIN analytics_guesses g ON g.session_id = s.id
      WHERE s.opted_in = 1
    `).get() as {
      sessions: number | null;
      guesses: number | null;
      accuracy: number | null;
      avg_latency: number | null;
      participants: number | null;
    } | undefined;

    const datasetRows = db.prepare(`
      SELECT
        g.dataset_source AS datasetSource,
        COUNT(g.id) AS guesses,
        AVG(g.correct) AS accuracy
      FROM analytics_guesses g
      INNER JOIN analytics_sessions s ON s.id = g.session_id
      WHERE s.opted_in = 1
      GROUP BY g.dataset_source
    `).all() as Array<{ datasetSource: string; guesses: number; accuracy: number | null }>;

    res.json({
      success: true,
      summary: {
        totalSessions: baseStats?.sessions ?? 0,
        totalGuesses: baseStats?.guesses ?? 0,
        uniqueParticipants: baseStats?.participants ?? 0,
        globalAccuracy: baseStats?.accuracy ? Math.round(baseStats.accuracy * 100) : 0,
        averageLatencyMs: baseStats?.avg_latency ? Math.round(baseStats.avg_latency) : null,
        datasetBreakdown: datasetRows.map((row) => ({
          datasetSource: row.datasetSource,
          guesses: row.guesses,
          accuracy: row.accuracy ? Math.round(row.accuracy * 100) : 0
        }))
      }
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

router.get('/overview', (_req, res) => {
  try {
    const db = getDatabase();

    const overviewRow = db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) AS sessions,
        COUNT(g.id) AS guesses,
        COUNT(DISTINCT CASE WHEN s.user_id IS NOT NULL THEN s.user_id END) AS participants,
        AVG(g.correct) AS accuracy,
        AVG(g.latency_ms) AS avg_latency,
        MIN(g.guess_timestamp) AS first_guess,
        MAX(g.guess_timestamp) AS last_guess,
        COUNT(DISTINCT g.deck_id) AS decks,
        COUNT(DISTINCT g.dataset_source) AS dataset_count,
        COUNT(DISTINCT CASE WHEN g.model IS NOT NULL AND TRIM(g.model) <> '' THEN LOWER(TRIM(g.model)) END) AS model_count,
        SUM(CASE WHEN g.guess_timestamp >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last_day,
        SUM(CASE WHEN g.guess_timestamp >= datetime('now', '-7 day') THEN 1 ELSE 0 END) AS last_week
      FROM analytics_sessions s
      LEFT JOIN analytics_guesses g ON g.session_id = s.id
    `).get() as {
      sessions: number | null;
      guesses: number | null;
      participants: number | null;
      accuracy: number | null;
      avg_latency: number | null;
      first_guess: string | null;
      last_guess: string | null;
      decks: number | null;
      dataset_count: number | null;
      model_count: number | null;
      last_day: number | null;
      last_week: number | null;
    } | undefined;

    res.json({
      success: true,
      overview: {
        totalSessions: overviewRow?.sessions ?? 0,
        totalGuesses: overviewRow?.guesses ?? 0,
        uniqueParticipants: overviewRow?.participants ?? 0,
        globalAccuracy: overviewRow?.accuracy ? Math.round(overviewRow.accuracy * 100) : 0,
        averageLatencyMs: overviewRow?.avg_latency ? Math.round(overviewRow.avg_latency) : null,
        firstGuessAt: overviewRow?.first_guess ?? null,
        lastGuessAt: overviewRow?.last_guess ?? null,
        activeDecks: overviewRow?.decks ?? 0,
        datasetCount: overviewRow?.dataset_count ?? 0,
        modelCount: overviewRow?.model_count ?? 0,
        guessesLast24h: overviewRow?.last_day ?? 0,
        guessesLast7d: overviewRow?.last_week ?? 0,
      },
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

router.get('/datasets', (_req, res) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT
        g.dataset_source AS datasetSource,
        COUNT(g.id) AS guesses,
        AVG(g.correct) AS accuracy,
        AVG(g.latency_ms) AS avg_latency,
        MAX(g.guess_timestamp) AS last_guess
      FROM analytics_guesses g
      INNER JOIN analytics_sessions s ON s.id = g.session_id
      WHERE s.opted_in = 1
      GROUP BY g.dataset_source
      ORDER BY guesses DESC
    `).all() as Array<{
      datasetSource: string;
      guesses: number;
      accuracy: number | null;
      avg_latency: number | null;
      last_guess: string | null;
    }>;

    res.json({
      success: true,
      datasets: rows.map((row) => ({
        datasetSource: row.datasetSource,
        guesses: row.guesses,
        accuracy: row.accuracy ? Math.round(row.accuracy * 100) : 0,
        averageLatencyMs: row.avg_latency ? Math.round(row.avg_latency) : null,
        lastGuessAt: row.last_guess ?? null,
      })),
    });
  } catch (error) {
    console.error('Analytics datasets error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/models', (_req, res) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT
        LOWER(TRIM(g.model)) AS modelKey,
        g.model AS modelRaw,
        g.dataset_source AS datasetSource,
        COUNT(g.id) AS guesses,
        AVG(g.correct) AS accuracy,
        AVG(g.latency_ms) AS avg_latency,
        MAX(g.guess_timestamp) AS last_guess
      FROM analytics_guesses g
      INNER JOIN analytics_sessions s ON s.id = g.session_id
      WHERE s.opted_in = 1 AND g.model IS NOT NULL AND TRIM(g.model) <> ''
      GROUP BY modelKey, datasetSource
      ORDER BY guesses DESC
      LIMIT 25
    `).all() as Array<{
      modelKey: string | null;
      modelRaw: string | null;
      datasetSource: string;
      guesses: number;
      accuracy: number | null;
      avg_latency: number | null;
      last_guess: string | null;
    }>;

    res.json({
      success: true,
      models: rows.map((row) => ({
        model: row.modelRaw ?? 'Unknown',
        datasetSource: row.datasetSource,
        guesses: row.guesses,
        accuracy: row.accuracy ? Math.round(row.accuracy * 100) : 0,
        averageLatencyMs: row.avg_latency ? Math.round(row.avg_latency) : null,
        lastGuessAt: row.last_guess ?? null,
      })),
    });
  } catch (error) {
    console.error('Analytics models error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/timeline', (req, res) => {
  try {
    const range = typeof req.query.range === 'string' ? req.query.range : '30d';
    const ranges: Record<string, string> = {
      '7d': "datetime('now', '-7 day')",
      '30d': "datetime('now', '-30 day')",
      '90d': "datetime('now', '-90 day')",
    };
    const bound = ranges[range] ?? ranges['30d'];

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT
        date(g.guess_timestamp) AS bucket,
        COUNT(g.id) AS guesses,
        AVG(g.correct) AS accuracy
      FROM analytics_guesses g
      INNER JOIN analytics_sessions s ON s.id = g.session_id
      WHERE s.opted_in = 1 AND g.guess_timestamp >= ${bound}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all() as Array<{ bucket: string; guesses: number; accuracy: number | null }>;

    res.json({
      success: true,
      timeline: rows.map((row) => ({
        bucket: row.bucket,
        guesses: row.guesses,
        accuracy: row.accuracy ? Math.round(row.accuracy * 100) : 0,
      })),
    });
  } catch (error) {
    console.error('Analytics timeline error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/players', (_req, res) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT
        COALESCE(u.username, 'Guest') AS player,
        COUNT(g.id) AS guesses,
        COUNT(DISTINCT s.id) AS sessions,
        AVG(g.correct) AS accuracy,
        AVG(g.latency_ms) AS avg_latency,
        MAX(g.guess_timestamp) AS last_guess
      FROM analytics_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      INNER JOIN analytics_guesses g ON g.session_id = s.id
      WHERE s.opted_in = 1
      GROUP BY player
      ORDER BY guesses DESC
      LIMIT 25
    `).all() as Array<{
      player: string;
      guesses: number;
      sessions: number;
      accuracy: number | null;
      avg_latency: number | null;
      last_guess: string | null;
    }>;

    res.json({
      success: true,
      players: rows.map((row) => ({
        player: row.player,
        guesses: row.guesses,
        sessions: row.sessions,
        accuracy: row.accuracy ? Math.round(row.accuracy * 100) : 0,
        averageLatencyMs: row.avg_latency ? Math.round(row.avg_latency) : null,
        lastGuessAt: row.last_guess ?? null,
      })),
    });
  } catch (error) {
    console.error('Analytics players error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export { router as analyticsRoutes };
