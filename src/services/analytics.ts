type DatasetSource = 'synthetic' | 'real';
type GuessLabel = 'fake' | 'real';
type GuessAnswer = 'ai' | 'real';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 20;
const SESSION_STORAGE_KEY = 'hotorslop_client_session_v1';

type SessionEnvelope = {
  clientSessionId: string;
  username?: string;
  deckId?: string;
  deckSize?: number;
  device?: string;
  optedIn?: boolean;
  startedAt: string;
  endedAt?: string;
};

export type GuessEventPayload = {
  deckId?: string;
  deckPosition?: number;
  cardId: string;
  datasetSource: DatasetSource;
  label: GuessLabel;
  model?: string | null;
  promptLength?: number;
  guessedAnswer: GuessAnswer;
  correct: boolean;
  latencyMs?: number;
  confidence?: number;
  timestamp?: string;
};

export type AnalyticsOverview = {
  totalSessions: number;
  totalGuesses: number;
  uniqueParticipants: number;
  globalAccuracy: number;
  averageLatencyMs: number | null;
  firstGuessAt: string | null;
  lastGuessAt: string | null;
  activeDecks: number;
  datasetCount: number;
  modelCount: number;
  guessesLast24h: number;
  guessesLast7d: number;
};

export type DatasetInsight = {
  datasetSource: DatasetSource;
  guesses: number;
  accuracy: number;
  averageLatencyMs: number | null;
  lastGuessAt: string | null;
};

export type ModelInsight = {
  model: string;
  datasetSource: DatasetSource;
  guesses: number;
  accuracy: number;
  averageLatencyMs: number | null;
  lastGuessAt: string | null;
};

export type TimelinePoint = {
  bucket: string;
  guesses: number;
  accuracy: number;
};

export type PlayerInsight = {
  player: string;
  guesses: number;
  sessions: number;
  accuracy: number;
  averageLatencyMs: number | null;
  lastGuessAt: string | null;
};

type FlushOptions = {
  useBeacon?: boolean;
};

const isBrowser = typeof window !== 'undefined';

let session: SessionEnvelope | null = null;
let eventQueue: GuessEventPayload[] = [];
let flushTimeout: number | null = null;
let listenersAttached = false;
let isFlushing = false;

const ensureSessionId = (): string => {
  if (!isBrowser) {
    return `server-${Date.now()}`;
  }

  const storage = window.sessionStorage;
  let existing = storage.getItem(SESSION_STORAGE_KEY);
  if (!existing) {
    existing = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    storage.setItem(SESSION_STORAGE_KEY, existing);
  }
  return existing;
};

const ensureListeners = () => {
  if (!isBrowser || listenersAttached) return;

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      void flush({ useBeacon: true });
    }
  };

  const handleBeforeUnload = () => {
    void flush({ useBeacon: true });
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);
  listenersAttached = true;
};

const scheduleFlush = () => {
  if (!isBrowser) return;
  if (flushTimeout !== null) return;
  flushTimeout = window.setTimeout(() => {
    flushTimeout = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
};

const sendBatch = async (batch: GuessEventPayload[], options: FlushOptions) => {
  if (!session) return;
  if (batch.length === 0) return;

  const payload = {
    session,
    events: batch.map((event) => ({
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString()
    }))
  };

  const url = `${API_BASE_URL}/analytics/ingest`;

  if (options.useBeacon && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const ok = navigator.sendBeacon(url, blob);
    if (!ok) {
      throw new Error('sendBeacon failed');
    }
    return;
  }

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: options.useBeacon === true
  });
};

const flush = async (options: FlushOptions = {}) => {
  if (!session || eventQueue.length === 0) return;
  if (isFlushing && !options.useBeacon) return;

  isFlushing = !options.useBeacon;

  try {
    while (eventQueue.length > 0) {
      const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
      try {
        await sendBatch(batch, options);
      } catch (error) {
        eventQueue = batch.concat(eventQueue);
        throw error;
      }
      if (options.useBeacon) {
        // For beacon, send one batch and exit to avoid long loops during unload.
        break;
      }
    }
  } finally {
    isFlushing = false;
  }
};

const ensureSession = () => {
  if (session) return;
  const clientSessionId = ensureSessionId();
  session = {
    clientSessionId,
    startedAt: new Date().toISOString(),
    optedIn: true,
    device: isBrowser ? navigator.userAgent : undefined
  };
};

const mergeSession = (partial: Partial<SessionEnvelope>) => {
  ensureSession();
  if (!session) return;
  session = {
    ...session,
    ...partial,
    clientSessionId: session.clientSessionId,
    startedAt: session.startedAt
  };
};

export const analytics = {
  init(partial: Partial<SessionEnvelope> = {}) {
    if (!isBrowser) return;
    ensureSession();
    mergeSession(partial);
    ensureListeners();
  },

  updateSession(partial: Partial<SessionEnvelope>) {
    if (!isBrowser) return;
    mergeSession(partial);
  },

  trackGuess(event: GuessEventPayload) {
    if (!isBrowser) return;
    ensureSession();
    eventQueue.push({ ...event });
    if (eventQueue.length >= MAX_BATCH_SIZE) {
      void flush();
    } else {
      scheduleFlush();
    }
  },

  setDeck(deckId: string, deckSize: number) {
    if (!isBrowser) return;
    mergeSession({ deckId, deckSize });
  },

  setUsername(username?: string) {
    if (!isBrowser) return;
    if (!username) return;
    mergeSession({ username: username.toLowerCase().trim() });
  },

  async flushNow() {
    await flush();
  },

  getSessionId(): string | null {
    return session?.clientSessionId ?? null;
  }
};

const getJson = async <T>(endpoint: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpoint}: ${response.status}`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || `Request to ${endpoint} failed`);
  }

  return json as T;
};

export async function fetchAnalyticsOverview(): Promise<AnalyticsOverview> {
  const data = await getJson<{ success: true; overview: AnalyticsOverview }>('/analytics/overview');
  return data.overview;
}

export async function fetchAnalyticsDatasetInsights(): Promise<DatasetInsight[]> {
  const data = await getJson<{ success: true; datasets: DatasetInsight[] }>('/analytics/datasets');
  return data.datasets;
}

export async function fetchAnalyticsModelInsights(): Promise<ModelInsight[]> {
  const data = await getJson<{ success: true; models: ModelInsight[] }>('/analytics/models');
  return data.models;
}

export async function fetchAnalyticsTimeline(range: '7d' | '30d' | '90d' = '30d'): Promise<TimelinePoint[]> {
  const data = await getJson<{ success: true; timeline: TimelinePoint[] }>(`/analytics/timeline?range=${range}`);
  return data.timeline;
}

export async function fetchAnalyticsPlayers(): Promise<PlayerInsight[]> {
  const data = await getJson<{ success: true; players: PlayerInsight[] }>('/analytics/players');
  return data.players;
}
