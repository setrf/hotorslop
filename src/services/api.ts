const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface User {
  id: number;
  username: string;
  created_at: string;
  last_seen: string;
  stats?: {
    total_sessions: number;
    total_rounds: number;
    high_score: number;
    avg_accuracy: number;
  };
}

export interface GameSession {
  score: number;
  rounds_played: number;
  correct_answers: number;
  accuracy: number;
  start_time: string;
  end_time: string;
  deck_size: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  high_score: number;
  total_rounds: number;
  sessions_played: number;
  avg_accuracy: number;
  last_played: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

// API utility functions
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const result: ApiResponse<T> = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'API request failed');
  }

  return result.data as T;
}

// User API functions
export async function registerUser(username: string): Promise<User> {
  return apiRequest<User>('/users/register', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function getUser(username: string): Promise<User> {
  return apiRequest<User>(`/users/${encodeURIComponent(username)}`);
}

// Score API functions
export async function saveScore(
  username: string,
  score: number,
  roundsPlayed: number,
  correctAnswers: number,
  deckSize: number = 64
): Promise<{ session_id: number; message: string }> {
  return apiRequest('/scores/save', {
    method: 'POST',
    body: JSON.stringify({
      username,
      score,
      rounds_played: roundsPlayed,
      correct_answers: correctAnswers,
      deck_size: deckSize,
    }),
  });
}

export async function getUserScores(username: string, limit: number = 10): Promise<GameSession[]> {
  return apiRequest<GameSession[]>(`/scores/user/${encodeURIComponent(username)}?limit=${limit}`);
}

export async function getUserBestScore(username: string): Promise<GameSession | null> {
  try {
    return await apiRequest<GameSession>(`/scores/user/${encodeURIComponent(username)}/best`);
  } catch (error) {
    return null;
  }
}

// Leaderboard API functions
export async function getLeaderboard(limit: number = 50, timeframe: string = 'all'): Promise<{
  timeframe: string;
  total_players: number;
  leaderboard: LeaderboardEntry[];
}> {
  return apiRequest(`/leaderboard?limit=${limit}&timeframe=${timeframe}`);
}

export async function getUserRank(username: string): Promise<{
  rank: number;
  total_players: number;
  user_best_score: number;
}> {
  return apiRequest(`/leaderboard/rank/${encodeURIComponent(username)}`);
}

export async function getLeaderboardStats(): Promise<{
  total_players: number;
  total_sessions: number;
  total_rounds: number;
  avg_score: number;
  highest_score: number;
  global_accuracy: number;
}> {
  return apiRequest('/leaderboard/stats');
}

// Error handling utility
export function handleApiError(error: any): string {
  if (error.message?.includes('NetworkError') || error.message?.includes('fetch')) {
    return 'Unable to connect to server. Please check your connection.';
  }
  if (error.message?.includes('404')) {
    return 'User not found. Please check the username.';
  }
  if (error.message?.includes('400')) {
    return 'Invalid data provided. Please check your input.';
  }
  return error.message || 'An unexpected error occurred.';
}