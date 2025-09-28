# Hot or Slop 🔥🤖

**"Call the fake"** - A real-time, competitive game that challenges players to distinguish between AI-generated images and real photographs. Features live global leaderboards, real-time score updates, and advanced analytics.

<p align="center">
  <img src="docs/screenshot-main.png" alt="Hot or Slop main screen" width="520" />
</p>

**🎯 Real-time AI Detection Game** • **🏆 Global Leaderboards** • **📊 Advanced Analytics** • **⚡ Live Score Updates**

## Table of Contents

1. [Gameplay Overview](#gameplay-overview)
2. [Progression & Levels](#progression--levels)
3. [Leaderboard & Percentiles](#leaderboard--percentiles)
4. [Tech Stack](#tech-stack)
5. [Architecture](#architecture)
6. [Development Workflow](#development-workflow)
7. [Project Structure](#project-structure)
8. [Dataset & Licensing](#dataset--licensing)
9. [Future Improvements](#future-improvements)
10. [Contributing](#contributing)

---

## Gameplay Overview

- **Real-time guessing** – Swipe, tap, or use keyboard shortcuts (← / →) to mark each card as `AI Generated` or `Real Photo`
- **Instant feedback** – A Hot/Slop chip confirms your guess with motivational messages and streak tracking
- **Live score updates** – Each guess immediately updates your score (+1 for correct, -1 for incorrect) and saves to the server
- **Smart deck management** – Every deck is automatically balanced 50/50 between real and fake images with intelligent prefetching
- **Active player indicators** – See which players are currently playing with green dot (🟢) indicators on the leaderboard
- **Comprehensive stats** – Score, rounds played, accuracy, streak, and level progression are always visible
- **Detailed info panel** – Current image metadata, dataset details, and complete level progression guide
- **Session persistence** – Continue where you left off across browser sessions

## Progression & Levels

Levels are tied to cumulative score (clamped at a minimum of 0) and stored locally. The HUD shows your current level, next target, progress bar, and points remaining.

| Level | Name     | Score Range | Next Unlock |
| ----- | -------- | ----------- | ----------- |
| 1     | Scout    | 0 – 24      | Unlocks Observer at 25 |
| 2     | Observer | 25 – 59     | Unlocks Sleuth at 60   |
| 3     | Sleuth   | 60 – 119    | Unlocks Examiner at 120 |
| 4     | Examiner | 120 – 199   | Unlocks Analyst at 200 |
| 5     | Analyst  | 200 – 319   | Unlocks Oracle at 320 |
| 6     | Oracle   | 320+        | Top tier |

## Leaderboard & Percentiles

- **Real-time global leaderboards** – Rankings update instantly with each guess across all connected players
- **Active player tracking** – Green dot (🟢) indicators show who's currently playing
- **Current score display** – See live scores for ongoing games, not just final scores
- **Session-based persistence** – Each guess creates/updates a database session with current score and statistics
- **Percentile curve** – Visual representation of your performance relative to all players
- **Timeframe filtering** – View leaderboards for all-time, weekly, or monthly periods
- **Cross-platform sync** – Scores persist on the server and sync across different devices/sessions

## Tech Stack

### Frontend
- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- CSS-only styling (no runtime CSS-in-JS) with custom gradients/glassmorphism
- [Hugging Face Datasets Server](https://huggingface.co/docs/datasets-server) REST calls for OpenFake synthetic imagery and COCO-Caption2017 real photos

### Backend
- [Node.js](https://nodejs.org/) + [Express.js](https://expressjs.com/) + [TypeScript](https://www.typescriptlang.org/)
- [sql.js](https://sql.js.org/) (SQLite compiled to WebAssembly) for portable, zero-native-dependency persistence
- [Zod](https://zod.dev/) for runtime type validation
- RESTful API with CORS support and analytics ingestion endpoints (works out of the box on Node 18+ including 24.x)

### Data Persistence & Real-time Features
- **Real-time score updates** – Individual guesses saved via `/api/scores/guess` endpoint with immediate leaderboard refresh
- **Live session tracking** – Current game sessions with active status indicators and real-time score display
- **Global leaderboards** – Server-side rankings with current scores, active player status, and timeframe filtering
- **Session management** – Automatic session creation/update with each guess, maintaining game state
- **Cross-platform sync** – Server-persisted scores accessible across different devices and sessions
- **Advanced analytics** – Comprehensive gameplay metrics, model performance tracking, and user behavior insights

## Architecture

### Frontend Architecture

- `App.tsx` drives the main state machine: deck management, swipe handling, keyboard shortcuts, score/level updates, and modal toggles.
- `services/openfake.ts`
  - Fetches synthetic candidates from OpenFake `test` split and real photos from COCO-Caption2017 `val`
  - Filters by allowed model prefixes (`real`, `imagen`, `gpt`, `flux`) and normalises human captions/prompts
  - Prefetches decks ahead of time, keeps client-side caches warm, and enforces a 50/50 real-vs-fake balance
  - Pulls imagery directly in the browser – the backend never proxies or stores dataset assets, conserving server bandwidth
- `services/api.ts` - Frontend API client for backend communication
- `services/analytics.ts`
  - Captures guess latency, dataset metadata, and player context entirely client side
  - Buffers analytics events, flushes via `fetch`/`sendBeacon`, and pings `/api/analytics/summary` for UI previews
  - Powers the internal analytics dashboard (header ➜ Analytics) with rich overview, dataset, model, timeline, and player insights
- UI is broken into minimal sections inside the main component to avoid additional global state managers. Hook usage includes `useCallback`/`useMemo` for derived state and memoized handlers.

### Backend Architecture

- **Database Layer** (`server/src/database/`): sql.js wrapper that mirrors SQLite semantics and persists to disk
- **API Layer** (`server/src/routes/`): RESTful endpoints for users, scores, and leaderboards
- **Service Layer** (`server/src/index.ts`): Express server with CORS, security, and routing
- **Data Models**: Structured storage for users, game sessions, and leaderboard data
- **Analytics Pipeline**: `/api/analytics/ingest` accepts batched guess events, `/api/analytics/summary` exposes aggregate stats for the in-app preview

### Analytics

- The internal dashboard (tap **Analytics** in the header) pulls from `/api/analytics/overview`, `/datasets`, `/models`, `/timeline`, and `/players` to surface advanced stats.
- Telemetry is opt-in per session; events are buffered in the browser and flushed via `sendBeacon` when players navigate away.
- Raw events are stored in `analytics_sessions` and `analytics_guesses`. Extend the backend summaries or build dashboards on top of those tables as needed.

### Data Flow

1. **User Registration**: Frontend sends username to `/api/users/register`
2. **Real-time Score Updates**: Each guess triggers `/api/scores/guess` with immediate score changes and session updates
3. **Live Leaderboard Updates**: Frontend refreshes `/api/leaderboard` after each guess to show current rankings
4. **Session Management**: Automatic session creation/maintenance with active status tracking
5. **Cross-Session Persistence**: Users can return and continue with existing server-persisted scores

## Development Workflow

### Quick Start (Full Stack)

```bash
# One-command setup for both frontend and backend
bash setup.sh

# …or manually install dependencies and start services
npm install            # install frontend packages
cd server
npm install            # install backend packages
cd ..

npm run server         # Terminal 1 – start Express API on 3001
npm run dev            # Terminal 2 – start Vite frontend on 5173
```

### Manual Setup

1. **Install frontend dependencies:**
```bash
npm install
```

2. **Set up the backend server:**
```bash
cd server
bash setup.sh
cd ..
```

3. **Start both servers:**
```bash
# Terminal 1: Start the backend server
npm run server

# Terminal 2: Start the frontend dev server
npm run dev
```

### Individual Scripts

```bash
npm run dev        # Start frontend dev server
npm run server     # Start backend server
npm run build      # Type-check then build production bundle
npm run preview    # Serve production bundle locally
npm run lint       # ESLint using the Vite/React TypeScript config
```

### Backend-Only Scripts

```bash
cd server
npm run dev        # Start backend in development mode
npm run build      # Build backend for production
npm run start      # Start production backend
```

## Project Structure

```
src/
  App.tsx        # Main component, state orchestration, UI sections
  App.css        # Component-specific styling and layout
  index.css      # Global fonts, background, resets
  main.tsx       # Application bootstrap
  services/
    openfake.ts  # Hugging Face dataset client & deck balancing
    api.ts       # Backend API client for score persistence
public/
  images/        # Local assets used during onboarding/demo
server/
  src/
    index.ts     # Express server setup and middleware
    database/
      database.ts # SQLite database initialization and schema
    routes/
      users.ts    # User management endpoints
      scores.ts   # Score saving and retrieval endpoints
      leaderboard.ts # Global leaderboard endpoints
  package.json   # Backend dependencies and scripts
  tsconfig.json  # TypeScript configuration for backend
  README.md      # Backend-specific documentation
```

## Dataset & Licensing

- **Synthetic imagery**: [ComplexDataLab/OpenFake](https://huggingface.co/datasets/ComplexDataLab/OpenFake) — CC BY-SA 4.0
- **Real photography**: [lmms-lab/COCO-Caption2017](https://huggingface.co/datasets/lmms-lab/COCO-Caption2017) — CC BY 4.0

The Info modal reiterates the licenses and links to both dataset cards. Imagery is used strictly for demonstration/testing and not redistributed.

All dataset requests originate from the client using the Hugging Face datasets server. Cached pools in `services/openfake.ts` minimise repeat downloads over a session and keep the backend isolated from third-party traffic.

## Key Features Implemented ✅

- **Real-time global leaderboards** with live score updates
- **Active player indicators** showing who's currently playing
- **Individual guess tracking** with immediate score persistence
- **Session-based gameplay** with automatic state management
- **Advanced analytics dashboard** with comprehensive metrics
- **Cross-platform score synchronization** via server persistence
- **Smart deck balancing** with 50/50 real vs AI image distribution
- **Comprehensive onboarding** with scoring explanation and dataset credits

## Future Improvements

- **WebSocket integration** for true real-time multiplayer interactions
- **Practice mode** during onboarding to help new players learn
- **Accessibility enhancements** with higher contrast and larger touch targets
- **Seasonal resets** with historical data preservation and achievements
- **Mobile app** with native swipe gestures and offline capability
- **Advanced difficulty modes** with model-specific challenges
- **Social features** like friend challenges and score sharing
- **Tournament mode** with bracket-style competitions

## Contributing

Issues and pull requests are welcome—especially around balancing, UX tweaks, new dataset filters, or accessibility fixes. If you add generators, update `ALLOWED_MODEL_PREFIXES` in `services/openfake.ts` and be sure to respect the dataset licensing.

---

Have fun calling the fake 👁️‍🗨️
