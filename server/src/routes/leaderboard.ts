import express from 'express';
import { z } from 'zod';
import { getDatabase } from '../database/database.js';

const router = express.Router();

// Get global leaderboard
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const timeframe = req.query.timeframe as string || 'all';

    const db = getDatabase();

    let dateFilter = '';
    const now = new Date();

    if (timeframe === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = `AND gs.end_time >= '${weekAgo.toISOString()}'`;
    } else if (timeframe === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dateFilter = `AND gs.end_time >= '${monthAgo.toISOString()}'`;
    }

    const leaderboard = db.prepare(`
      SELECT
        u.username,
        MAX(gs.score) as high_score,
        SUM(gs.rounds_played) as total_rounds,
        COUNT(gs.id) as sessions_played,
        MAX(gs.end_time) as last_played,
        ROUND(AVG(CAST(gs.correct_answers AS FLOAT) / gs.rounds_played) * 100) as avg_accuracy
      FROM users u
      INNER JOIN game_sessions gs ON u.id = gs.user_id ${dateFilter}
      GROUP BY u.id, u.username
      ORDER BY high_score DESC, total_rounds DESC
      LIMIT ?
    `).all(limit) as any[];

    res.json({
      success: true,
      timeframe,
      total_players: leaderboard.length,
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        high_score: entry.high_score,
        total_rounds: entry.total_rounds,
        sessions_played: entry.sessions_played,
        avg_accuracy: entry.avg_accuracy || 0,
        last_played: entry.last_played
      }))
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user's rank
router.get('/rank/:username', async (req, res) => {
  try {
    const { username } = z.string().parse(req.params.username);
    const db = getDatabase();
    const normalizedUsername = username.toLowerCase().trim();

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername) as any;

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    const userBestScore = db.prepare(`
      SELECT MAX(score) as best_score
      FROM game_sessions
      WHERE user_id = ?
    `).get(user.id) as any;

    if (!userBestScore.best_score) {
      res.json({
        success: true,
        rank: null,
        total_players: 0
      });
      return;
    }

    const rank = db.prepare(`
      SELECT COUNT(DISTINCT u.id) + 1 as user_rank
      FROM users u
      INNER JOIN game_sessions gs ON u.id = gs.user_id
      WHERE gs.score > ?
    `).get(userBestScore.best_score) as any;

    const totalPlayers = db.prepare(`
      SELECT COUNT(DISTINCT u.id) as count
      FROM users u
      INNER JOIN game_sessions gs ON u.id = gs.user_id
    `).get() as any;

    res.json({
      success: true,
      rank: rank.user_rank,
      total_players: totalPlayers.count,
      user_best_score: userBestScore.best_score
    });
  } catch (error) {
    console.error('Get user rank error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get leaderboard statistics
router.get('/stats', async (req, res) => {
  try {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT u.id) as total_players,
        COUNT(gs.id) as total_sessions,
        SUM(gs.rounds_played) as total_rounds,
        AVG(gs.score) as avg_score,
        MAX(gs.score) as highest_score,
        AVG(CAST(gs.correct_answers AS FLOAT) / gs.rounds_played) as global_accuracy
      FROM users u
      LEFT JOIN game_sessions gs ON u.id = gs.user_id
    `).get() as any;

    res.json({
      success: true,
      stats: {
        total_players: stats.total_players || 0,
        total_sessions: stats.total_sessions || 0,
        total_rounds: stats.total_rounds || 0,
        avg_score: stats.avg_score ? Math.round(stats.avg_score) : 0,
        highest_score: stats.highest_score || 0,
        global_accuracy: stats.global_accuracy ? Math.round(stats.global_accuracy * 100) : 0
      }
    });
  } catch (error) {
    console.error('Get leaderboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export { router as leaderboardRoutes };