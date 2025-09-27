import express from 'express';
import { z } from 'zod';
import { getDatabase } from '../database/database.js';

const router = express.Router();

// Validation schemas
const usernameSchema = z.string()
  .min(1, 'Username is required')
  .max(50, 'Username must be 50 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens');

// Get or create user by username
router.post('/register', async (req, res) => {
  try {
    const { username } = z.object({ username: usernameSchema }).parse(req.body);

    const db = getDatabase();
    const normalizedUsername = username.toLowerCase().trim();

    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      // Create new user
      const result = db.prepare(`
        INSERT INTO users (username)
        VALUES (?)
      `).run(normalizedUsername);

      user = {
        id: result.lastInsertRowid,
        username: normalizedUsername,
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString()
      };
    } else {
      // Update last seen
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        last_seen: user.last_seen
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors
      });
    } else {
      console.error('User registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Get user by username
router.get('/:username', async (req, res) => {
  try {
    const usernameParam = usernameSchema.parse(req.params.username);
    const db = getDatabase();
    const normalizedUsername = usernameParam.toLowerCase().trim();

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    // Get user's game statistics
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(rounds_played) as total_rounds,
        MAX(score) as high_score,
        AVG(CAST(correct_answers AS FLOAT) / rounds_played) as avg_accuracy
      FROM game_sessions
      WHERE user_id = ?
    `).get(user.id) as any;

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        last_seen: user.last_seen,
        stats: {
          total_sessions: stats.total_sessions || 0,
          total_rounds: stats.total_rounds || 0,
          high_score: stats.high_score || 0,
          avg_accuracy: stats.avg_accuracy ? Math.round(stats.avg_accuracy * 100) : 0
        }
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid username format'
      });
    } else {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

export { router as userRoutes };
