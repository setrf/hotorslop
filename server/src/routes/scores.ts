import express from 'express';
import { z } from 'zod';
import { getDatabase } from '../database/database.js';

const router = express.Router();

// Validation schemas
const saveScoreSchema = z.object({
  username: z.string().min(1).max(50),
  score: z.number().int().min(0),
  rounds_played: z.number().int().min(0),
  correct_answers: z.number().int().min(0),
  deck_size: z.number().int().min(1).default(64)
});

// Save or update user score
router.post('/save', async (req, res) => {
  try {
    const { username, score, rounds_played, correct_answers, deck_size } = saveScoreSchema.parse(req.body);

    const db = getDatabase();
    const normalizedUsername = username.toLowerCase().trim();

    // Get or create user
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(normalizedUsername);
      user = { id: result.lastInsertRowid, username: normalizedUsername };
    } else {
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    }

    // Save game session
    const result = db.prepare(`
      INSERT INTO game_sessions (user_id, score, rounds_played, correct_answers, deck_size, end_time)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(user.id, score, rounds_played, correct_answers, deck_size);

    res.json({
      success: true,
      session_id: result.lastInsertRowid,
      message: 'Score saved successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors
      });
    } else {
      console.error('Save score error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Get user's recent scores
router.get('/user/:username', async (req, res) => {
  try {
    const usernameParam = z.string().parse(req.params.username);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const db = getDatabase();
    const normalizedUsername = usernameParam.toLowerCase().trim();

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    const sessions = db.prepare(`
      SELECT
        score,
        rounds_played,
        correct_answers,
        start_time,
        end_time,
        deck_size,
        ROUND((CAST(correct_answers AS FLOAT) / rounds_played) * 100) as accuracy
      FROM game_sessions
      WHERE user_id = ?
      ORDER BY end_time DESC
      LIMIT ?
    `).all(user.id, limit) as any[];

    res.json({
      success: true,
      sessions: sessions.map(session => ({
        score: session.score,
        rounds_played: session.rounds_played,
        correct_answers: session.correct_answers,
        accuracy: session.accuracy || 0,
        start_time: session.start_time,
        end_time: session.end_time,
        deck_size: session.deck_size
      }))
    });
  } catch (error) {
    console.error('Get user scores error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user's best score
router.get('/user/:username/best', async (req, res) => {
  try {
    const usernameParam = z.string().parse(req.params.username);
    const db = getDatabase();
    const normalizedUsername = usernameParam.toLowerCase().trim();

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    const bestSession = db.prepare(`
      SELECT
        score,
        rounds_played,
        correct_answers,
        start_time,
        end_time,
        deck_size,
        ROUND((CAST(correct_answers AS FLOAT) / rounds_played) * 100) as accuracy
      FROM game_sessions
      WHERE user_id = ? AND score = (SELECT MAX(score) FROM game_sessions WHERE user_id = ?)
      ORDER BY end_time DESC
      LIMIT 1
    `).get(user.id, user.id) as any;

    if (!bestSession) {
      res.json({
        success: true,
        best_score: null
      });
      return;
    }

    res.json({
      success: true,
      best_score: {
        score: bestSession.score,
        rounds_played: bestSession.rounds_played,
        correct_answers: bestSession.correct_answers,
        accuracy: bestSession.accuracy || 0,
        achieved_at: bestSession.end_time,
        deck_size: bestSession.deck_size
      }
    });
  } catch (error) {
    console.error('Get best score error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Save individual guess and update current score
router.post('/guess', async (req, res) => {
  try {
    const guessSchema = z.object({
      username: z.string().min(1).max(50),
      score_change: z.number().int(), // +1 for correct, -1 for incorrect
      correct: z.boolean(),
      deck_size: z.number().int().min(1).default(64)
    });

    const { username, score_change, correct, deck_size } = guessSchema.parse(req.body);

    const db = getDatabase();
    const normalizedUsername = username.toLowerCase().trim();

    // Get or create user
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(normalizedUsername);
      user = { id: result.lastInsertRowid, username: normalizedUsername };
    } else {
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    }

    // Get current session or create new one
    let currentSession = db.prepare(`
      SELECT * FROM game_sessions
      WHERE user_id = ? AND end_time IS NULL
      ORDER BY start_time DESC
      LIMIT 1
    `).get(user.id) as any;

    if (!currentSession) {
      // Start new session
      const result = db.prepare(`
        INSERT INTO game_sessions (user_id, score, rounds_played, correct_answers, deck_size, start_time)
        VALUES (?, 0, 0, 0, ?, CURRENT_TIMESTAMP)
      `).run(user.id, deck_size);
      currentSession = {
        id: result.lastInsertRowid,
        user_id: user.id,
        score: 0,
        rounds_played: 0,
        correct_answers: 0,
        deck_size: deck_size
      };
    }

    // Update session with new guess
    const newScore = Math.max(0, currentSession.score + score_change);
    const newRoundsPlayed = currentSession.rounds_played + 1;
    const newCorrectAnswers = currentSession.correct_answers + (correct ? 1 : 0);

    db.prepare(`
      UPDATE game_sessions
      SET score = ?, rounds_played = ?, correct_answers = ?, end_time = NULL
      WHERE id = ?
    `).run(newScore, newRoundsPlayed, newCorrectAnswers, currentSession.id);

    res.json({
      success: true,
      session_id: currentSession.id,
      current_score: newScore,
      rounds_played: newRoundsPlayed,
      correct_answers: newCorrectAnswers,
      message: 'Guess recorded successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors
      });
    } else {
      console.error('Save guess error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

export { router as scoreRoutes };
