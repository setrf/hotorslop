import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { fetchOpenFakeDeck, OPEN_FAKE_CONSTANTS, type HotOrSlopImage } from './services/openfake'

type GuessType = 'ai' | 'real'

type LeaderboardEntry = {
  name: string
  score: number
  rounds: number
  updatedAt: number
}

type GuessFeedback = {
  correct: boolean
  answer: GuessType
  guess: GuessType
  label: 'fake' | 'real'
  prompt: string
  model?: string | null
}

const PLAYER_STORAGE_KEY = 'hotorslop_player_name'
const LEADERBOARD_STORAGE_KEY = 'hotorslop_leaderboard'
const ONBOARDING_STORAGE_KEY = 'hotorslop_onboarded'

const sortAndTrimLeaderboard = (entries: LeaderboardEntry[]): LeaderboardEntry[] =>
  [...entries]
    .sort((a, b) => {
      if (b.score === a.score) {
        return a.updatedAt - b.updatedAt
      }
      return b.score - a.score
    })
    .slice(0, 10)

const loadLeaderboard = (): LeaderboardEntry[] => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as LeaderboardEntry[]
    if (!Array.isArray(parsed)) return []
    return sortAndTrimLeaderboard(parsed.filter(Boolean).map((entry) => ({
      ...entry,
      score: typeof entry.score === 'number' ? Math.max(0, entry.score) : 0,
      rounds: typeof entry.rounds === 'number' ? entry.rounds : 0,
    })))
  } catch (error) {
    console.warn('Could not parse leaderboard from storage', error)
    return []
  }
}

const loadPlayerName = (): string => {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(PLAYER_STORAGE_KEY) ?? ''
}

const hasFinishedOnboarding = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true'
}

const formatScore = (score: number): string => (score > 0 ? `+${score}` : `${score}`)

const DECK_SIZE = 36

const LEVEL_BANDS = [
  { name: 'Scout 👀', minScore: 0 },
  { name: 'Observer 🔍', minScore: 25 },
  { name: 'Sleuth 🕵️', minScore: 60 },
  { name: 'Examiner 🔬', minScore: 120 },
  { name: 'Analyst 📊', minScore: 200 },
  { name: 'Oracle 🔮', minScore: 320 },
]

const truncate = (value: string, max = 140): string => {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function App() {
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerName())
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => loadLeaderboard())
  const initialOnboardingNeeded = useMemo(() => !(hasFinishedOnboarding() && loadPlayerName()), [])
  const [showOnboarding, setShowOnboarding] = useState(initialOnboardingNeeded)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const originalOverflow = document.body.style.overflow
    if (showOnboarding || isLeaderboardOpen || isInfoOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isInfoOpen, isLeaderboardOpen, showOnboarding])

  const [deck, setDeck] = useState<HotOrSlopImage[]>([])
  const [isLoadingDeck, setIsLoadingDeck] = useState(true)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [stats, setStats] = useState({ total: 0, correct: 0 })
  const [streak, setStreak] = useState(0)
  const [cardMotion, setCardMotion] = useState<'idle' | 'left' | 'right' | 'enter'>('enter')
  const [feedback, setFeedback] = useState<GuessFeedback | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartXRef = useRef<number | null>(null)
  const resultTimeoutRef = useRef<number | null>(null)
  const feedbackTimeoutRef = useRef<number | null>(null)
  const nextDeckRef = useRef<HotOrSlopImage[] | null>(null)
  const isPrefetchingRef = useRef(false)

  const overlayActive = showOnboarding || isLeaderboardOpen || isInfoOpen

  const currentCard = deck[currentIndex]
  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
  const accuracyDisplay = stats.total ? `${accuracy}%` : '—'

  const prefetchDeck = useCallback(async () => {
    if (isPrefetchingRef.current) return
    if (nextDeckRef.current) return
    isPrefetchingRef.current = true
    try {
      const next = await fetchOpenFakeDeck({ count: DECK_SIZE })
      nextDeckRef.current = next
    } catch (error) {
      console.warn('Failed to prefetch OpenFake deck', error)
    } finally {
      isPrefetchingRef.current = false
    }
  }, [])

  const loadDeck = useCallback(
    async (preferPrefetch = false) => {
      setDeckError(null)

      if (preferPrefetch && nextDeckRef.current) {
        const items = nextDeckRef.current
        nextDeckRef.current = null
        setDeck(items)
        setCurrentIndex(0)
        setCardMotion('enter')
        setDragOffset(0)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => setCardMotion('idle'), 200)
        }
        setIsLoadingDeck(false)
        void prefetchDeck()
        return
      }

      setIsLoadingDeck(true)
      try {
        const items = await fetchOpenFakeDeck({ count: DECK_SIZE })
        setDeck(items)
        setCurrentIndex(0)
        setCardMotion('enter')
        setDragOffset(0)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => setCardMotion('idle'), 200)
        }
      } catch (error) {
        console.error('Failed to fetch OpenFake deck', error)
        setDeckError('Could not reach the OpenFake dataset. Check your connection and try again.')
      } finally {
        setIsLoadingDeck(false)
        void prefetchDeck()
      }
    },
    [prefetchDeck]
  )

  useEffect(() => {
    loadDeck()
  }, [loadDeck])

  useEffect(() => {
    if (deck.length === 0) return
    if (currentIndex >= deck.length - 4) {
      void prefetchDeck()
    }
  }, [currentIndex, deck, prefetchDeck])

  useEffect(() => {
    return () => {
      if (resultTimeoutRef.current) window.clearTimeout(resultTimeoutRef.current)
      if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isLeaderboardOpen) return undefined
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLeaderboardOpen(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isLeaderboardOpen])

  useEffect(() => {
    if (!isInfoOpen) return undefined
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsInfoOpen(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isInfoOpen])

  useEffect(() => {
    if (showOnboarding) {
      setIsInfoOpen(false)
      setIsLeaderboardOpen(false)
    }
  }, [showOnboarding])

  const persistPlayerName = useCallback((name: string) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PLAYER_STORAGE_KEY, name)
  }, [])

  const persistOnboarding = useCallback(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
  }, [])

  const persistLeaderboard = useCallback((entries: LeaderboardEntry[]) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries))
  }, [])

  const updateLeaderboard = useCallback(
    (name: string, candidateScore: number, candidateRounds: number) => {
      if (!name) return
      const safeScore = Math.max(0, candidateScore)
      setLeaderboard((prev) => {
        const now = Date.now()
        const index = prev.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase())

        if (index >= 0) {
          if (safeScore <= prev[index].score) {
            return prev
          }
          const updated = [...prev]
          updated[index] = { ...updated[index], score: safeScore, rounds: candidateRounds, updatedAt: now }
          const sorted = sortAndTrimLeaderboard(updated)
          persistLeaderboard(sorted)
          return sorted
        }

        const withNew = sortAndTrimLeaderboard([...prev, { name, score: safeScore, rounds: candidateRounds, updatedAt: now }])
        persistLeaderboard(withNew)
        return withNew
      })
    },
    [persistLeaderboard]
  )

  const advanceCard = useCallback(() => {
    if (deck.length === 0) return
    setCardMotion('enter')
    setCurrentIndex((prev) => {
      const next = prev + 1
      if (next >= deck.length) {
        void loadDeck(true)
        return 0
      }
      return next
    })
    window.setTimeout(() => {
      setCardMotion('idle')
    }, 250)
  }, [deck.length, loadDeck])

  const scheduleFeedbackClear = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current)
    }
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null)
    }, 3200)
  }, [])

  const handleGuess = useCallback(
    (guess: GuessType) => {
      if (isLocked || !currentCard) return
      setIsLocked(true)
      setCardMotion(guess === 'real' ? 'right' : 'left')
      setDragOffset(0)

      const correct = currentCard.answer === guess

      const nextScore = Math.max(0, score + (correct ? 1 : -1))
      const nextTotal = stats.total + 1
      const nextCorrect = stats.correct + (correct ? 1 : 0)
      const nextStreak = correct ? streak + 1 : 0

      setScore(nextScore)
      setStats({ total: nextTotal, correct: nextCorrect })
      setStreak(nextStreak)

      if (playerName) {
        updateLeaderboard(playerName, nextScore, nextTotal)
      }

      setFeedback({
        correct,
        answer: currentCard.answer,
        guess,
        label: currentCard.label,
        prompt: currentCard.prompt,
        model: currentCard.model ?? null,
      })
      scheduleFeedbackClear()

      if (resultTimeoutRef.current) {
        window.clearTimeout(resultTimeoutRef.current)
      }

      resultTimeoutRef.current = window.setTimeout(() => {
        advanceCard()
        setIsLocked(false)
      }, 820)
    },
    [advanceCard, currentCard, isLocked, playerName, scheduleFeedbackClear, score, stats.correct, stats.total, streak, updateLeaderboard]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isLocked || !currentCard || isLoadingDeck || overlayActive) return
      dragStartXRef.current = event.clientX
      setDragOffset(0)
      ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    },
    [currentCard, isLoadingDeck, isLocked, overlayActive]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null || isLocked || isLoadingDeck || overlayActive) return
      const delta = event.clientX - dragStartXRef.current
      setDragOffset(delta)
    },
    [isLoadingDeck, isLocked, overlayActive]
  )

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null) return
      const delta = event.clientX - dragStartXRef.current
      dragStartXRef.current = null
      if (Math.abs(delta) > 120) {
        handleGuess(delta > 0 ? 'real' : 'ai')
      } else {
        setDragOffset(0)
      }
    },
    [handleGuess]
  )

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (overlayActive) return
      if (isLocked || !currentCard || isLoadingDeck) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleGuess('ai')
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleGuess('real')
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentCard, handleGuess, isLoadingDeck, isLocked, overlayActive])

  const handleInfoBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        setIsInfoOpen(false)
      }
    },
    []
  )

  const handleLeaderboardBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        setIsLeaderboardOpen(false)
      }
    },
    []
  )

  const handleOnboardingComplete = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      setPlayerName(trimmed)
      setShowOnboarding(false)
      persistPlayerName(trimmed)
      persistOnboarding()
    },
    [persistOnboarding, persistPlayerName]
  )

  const playerRank = useMemo(() => {
    if (!playerName) return -1
    return leaderboard.findIndex((entry) => entry.name.toLowerCase() === playerName.toLowerCase())
  }, [leaderboard, playerName])

  const percentileData = useMemo(() => {
    const baseScores = leaderboard.map((entry) => entry.score)
    const scores = [...baseScores, score]
    if (scores.length === 0) {
      return { scores: [0, 1], percentile: 0.5 }
    }
    const sorted = [...scores].sort((a, b) => a - b)
    const belowOrEqual = sorted.filter((value) => value <= score).length
    const percentile = belowOrEqual / sorted.length
    return { scores: sorted, percentile }
  }, [leaderboard, score])

  const levelInfo = useMemo(() => {
    const bands = LEVEL_BANDS
    let current = bands[0]
    let next: (typeof LEVEL_BANDS)[number] | null = null
    for (let i = 0; i < bands.length; i += 1) {
      const band = bands[i]
      if (score >= band.minScore) {
        current = band
        next = bands[i + 1] ?? null
      } else {
        next = band
        break
      }
    }
    const lowerBound = current.minScore
    const nextTarget = next ? next.minScore : null
    let progress = 1
    if (nextTarget !== null) {
      const span = nextTarget - lowerBound || 1
      progress = Math.min(1, Math.max(0, (score - lowerBound) / span))
    }
    return {
      index: bands.indexOf(current),
      name: current.name,
      lowerBound,
      nextTarget,
      nextName: next?.name ?? null,
      progress,
    }
  }, [score])

  const percentileDisplay = Math.round(percentileData.percentile * 100)

  const controlsDisabled = isLocked || isLoadingDeck || !currentCard || overlayActive
  const showLoadingOverlay = isLoadingDeck && deck.length > 0
  const shellClassName = ['app-shell', showOnboarding ? 'splash-active' : '', (isLeaderboardOpen || isInfoOpen) && !showOnboarding ? 'panel-active' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClassName}>
      <div className="app-content">
        <header className="top-bar">
          <div className="brand-stack">
            <span className="brand-mark">Hot or Slop 🔥🤖</span>
            <h1 className="brand-title">Call the fake. 👁️‍🗨️</h1>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsInfoOpen(true)}
              aria-expanded={isInfoOpen}
              aria-controls="info-panel"
              disabled={overlayActive && !isInfoOpen}
            >
              Info ℹ️
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setIsLeaderboardOpen(true)}
              aria-expanded={isLeaderboardOpen}
              aria-controls="leaderboard-panel"
              disabled={overlayActive && !isLeaderboardOpen}
            >
              Leaderboard 🏆
            </button>
          </div>
        </header>

        <main
          className="minimal-main"
          aria-hidden={showOnboarding}
          style={showOnboarding ? { pointerEvents: 'none' } : undefined}
        >
          <div className={`card-wrapper ${showLoadingOverlay ? 'busy' : ''}`}>
            <section className="session-stats">
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Score</span>
                  <span className="stat-value">{formatScore(score)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Rounds</span>
                  <span className="stat-value">{stats.total}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Accuracy</span>
                  <span className="stat-value">{accuracyDisplay}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Streak</span>
                  <span className="stat-value">{streak}</span>
                </div>
              </div>
            </section>

            <section className="session-level">
              <div className="level-summary">
                <div>
                  <span className="stat-label">Current</span>
                  <span className="stat-value">Level {levelInfo.index + 1} · {levelInfo.name}</span>
                </div>
                <div>
                  <span className="stat-label">Next</span>
                  <span className="stat-value">
                    {levelInfo.nextTarget !== null ? `Level ${levelInfo.index + 2} · ${levelInfo.nextName} (${formatScore(levelInfo.nextTarget)})` : 'Maxed'}
                  </span>
                </div>
              </div>
              <div className="level-progress">
                <div className="level-progress-fill" style={{ width: `${Math.round(levelInfo.progress * 100)}%` }} />
              </div>
              <span className="level-progress-label">
                {levelInfo.nextTarget !== null
                  ? `${Math.max(0, levelInfo.nextTarget - score)} points to ${levelInfo.nextName}`
                  : 'You’ve reached the top tier.'}
              </span>
            </section>

            {currentCard ? (
              <>
                <div className="card-controls">
                  <div className="controls">
                    <button
                      type="button"
                      className="guess-button ai"
                      onClick={() => handleGuess('ai')}
                      disabled={controlsDisabled}
                    >
                      🤖 AI Generated
                    </button>
                    <button
                      type="button"
                      className="guess-button real"
                      onClick={() => handleGuess('real')}
                      disabled={controlsDisabled}
                    >
                      📸 Real Photo
                    </button>
                  </div>
                  <p className="swipe-hint">Swipe left for AI 🤖, right for real 📸 — or tap the buttons / use ← → keys.</p>
                </div>
                <div
                  className={`image-card ${cardMotion !== 'idle' ? `motion-${cardMotion}` : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  style={{
                    transform:
                      cardMotion === 'idle' && !isLoadingDeck
                        ? `translateX(${dragOffset}px) rotate(${dragOffset * 0.02}deg)`
                        : undefined,
                  }}
                  role="img"
                  aria-label={`${truncate(currentCard.prompt, 160)} — guess if it is real or AI generated`}
                >
                  <img src={currentCard.src} alt="" draggable={false} />
                </div>
              </>
            ) : (
              <div className="card-placeholder">
                {isLoadingDeck ? (
                  <>
                    <span className="loading-pip" />
                    <p>Streaming fresh heat from OpenFake… 🔥</p>
                  </>
                ) : deckError ? (
                  <>
                    <p>{deckError} 😅</p>
                    <button type="button" onClick={() => loadDeck()}>
                      Retry fetch 🔄
                    </button>
                  </>
                ) : (
                  <p>Cards will reload once new images arrive. 📥</p>
                )}
              </div>
            )}
            {showLoadingOverlay && (
              <div className="card-loading" aria-hidden>
                <span className="loading-ring" />
                <span>Loading new images… 📷</span>
              </div>
            )}
          </div>

          {feedback && (
            <div className={`feedback-chip ${feedback.correct ? 'hot' : 'slop'}`} role="status">
              <div className="feedback-primary">
                <strong>{feedback.correct ? 'Hot! 🔥' : 'Slop! 🤢'}</strong>
                <span>
                  {feedback.correct
                    ? `You nailed it — that was ${feedback.answer === 'ai' ? 'AI generated' : 'a real capture'}. 🎯`
                    : `It was actually ${feedback.answer === 'ai' ? 'AI generated' : 'a real photo'}. 😅`}
                </span>
              </div>
              <p className="feedback-meta">
                {feedback.answer === 'ai' ? `Source model: ${feedback.model ?? 'Unspecified — see OpenFake metadata.'}` : null}
              </p>
            </div>
          )}

          {currentCard && !isLoadingDeck && (
            <p className="swipe-hint">Swipe left for AI 🤖, right for real 📸 — or tap the buttons / use ← → keys.</p>
          )}
        </main>
      </div>

      {isInfoOpen && (
        <div
          className="panel-layer info-layer"
          role="dialog"
          aria-modal="true"
          id="info-panel"
          onClick={handleInfoBackdropClick}
        >
          <div className="info-panel">
            <div className="panel-heading">
              <h2>Session details</h2>
              <button type="button" className="icon-button ghost" onClick={() => setIsInfoOpen(false)}>
                Close
              </button>
            </div>
            <section className="info-section">
              <h3>Current image</h3>
              {currentCard ? (
                <>
                  <p className="info-text" title={currentCard.prompt}>{currentCard.prompt}</p>
                  <p className="info-meta">
                    {feedback
                      ? feedback.answer === 'ai'
                        ? `Model: ${feedback.model ?? 'Not provided'} · Label: Synthetic`
                        : 'Label: Real capture'
                      : 'Guess first to reveal metadata.'}
                  </p>
                </>
              ) : (
                <p className="info-text">No card loaded yet.</p>
              )}
            </section>
            <section className="info-section">
              <h3>Level list</h3>
              <ul className="level-list">
                {LEVEL_BANDS.map((band, index) => (
                  <li key={band.name}>Level {index + 1} · {band.name} — {index < LEVEL_BANDS.length - 1 ? `${formatScore(band.minScore)} · next at ${formatScore(LEVEL_BANDS[index + 1].minScore)}` : `${formatScore(band.minScore)}+`}</li>
                ))}
              </ul>
            </section>
            <section className="info-section">
              <h3>Dataset</h3>
              <p className="info-text">
                Images stream live from the OpenFake dataset ({OPEN_FAKE_CONSTANTS.license}). Metadata stays in sync with
                the source.
              </p>
              <a
                className="secondary-button"
                href={OPEN_FAKE_CONSTANTS.datasetUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open dataset
              </a>
            </section>
          </div>
        </div>
      )}

      {isLeaderboardOpen && (
        <div
          className="panel-layer leaderboard-layer"
          role="dialog"
          aria-modal="true"
          id="leaderboard-panel"
          onClick={handleLeaderboardBackdropClick}
        >
          <div className="leaderboard-panel">
            <div className="panel-heading">
              <h2>Leaderboard</h2>
              <button type="button" className="icon-button ghost" onClick={() => setIsLeaderboardOpen(false)}>
                Close
              </button>
            </div>
            <PercentileCurve
              scores={percentileData.scores}
              percentile={percentileData.percentile}
              displayValue={percentileDisplay}
            />
            <div className="leaderboard-table">
              {leaderboard.length === 0 ? (
                <p className="leaderboard-empty">Be the first to log a score. 🥇</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Rounds</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((entry, index) => {
                      const isPlayer = entry.name.toLowerCase() === playerName.toLowerCase()
                      return (
                        <tr key={entry.name} className={isPlayer ? 'highlight' : ''}>
                          <td>{index + 1}</td>
                          <td>{entry.name}</td>
                          <td>{entry.rounds}</td>
                          <td>{formatScore(entry.score)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {playerRank >= 0 ? (
                <p className="leaderboard-more">You are #{playerRank + 1}. Keep climbing. ⬆️</p>
              ) : (
                <p className="leaderboard-more">Play a round to stake your claim. 🎮</p>
              )}
            </div>
            <p className="leaderboard-license">
              Imagery credit: <a href={OPEN_FAKE_CONSTANTS.datasetUrl} target="_blank" rel="noreferrer">OpenFake</a>{' '}
              ({OPEN_FAKE_CONSTANTS.license}). Scores remain on this device only.
            </p>
          </div>
        </div>
      )}

      {showOnboarding && (
        <div className="splash-layer" role="dialog" aria-modal="true">
          <Onboarding
            initialName={playerName}
            leaderboard={leaderboard}
            onComplete={handleOnboardingComplete}
            datasetUrl={OPEN_FAKE_CONSTANTS.datasetUrl}
            datasetLicense={OPEN_FAKE_CONSTANTS.license}
          />
        </div>
      )}

    </div>
  )
}

type OnboardingProps = {
  initialName: string
  leaderboard: LeaderboardEntry[]
  datasetUrl: string
  datasetLicense: string
  onComplete: (name: string) => void
}

const Onboarding = ({ initialName, leaderboard, datasetUrl, datasetLicense, onComplete }: OnboardingProps) => {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const slides = useMemo(
    () => [
      {
        title: 'Spot the synthetic 👁️‍🗨️',
        body: 'One image at a time. Decide if what you see is a true capture or an AI fabrication. 🤖',
      },
      {
        title: 'Score with certainty 🎯',
        body: 'Every correct call is +1, every miss is -1. Streaks push you up the leaderboard. 🏆',
      },
      {
        title: 'Tag your run 🏷️',
        body: 'Images stream from the CC BY-SA 4.0 OpenFake dataset. Drop a handle so your score sticks. 💾',
      },
    ],
    []
  )

  useEffect(() => {
    if (step === slides.length - 1) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
      return () => window.clearTimeout(timer)
    }
  }, [step, slides.length])

  const nextStep = () => {
    if (step < slides.length - 1) {
      setStep(step + 1)
      return
    }
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    onComplete(trimmed)
  }

  const prevStep = () => {
    if (step === 0) return
    setStep(step - 1)
  }

  const topThree = leaderboard.slice(0, 3)

  return (
    <div className="onboarding">
      <div className="onboarding-panel">
        <span className="brand-mark">Hot or Slop 🔥🤖</span>
        <h2>{slides[step].title}</h2>
        <p>{slides[step].body}</p>
        {step === slides.length - 1 && (
          <div className="name-capture">
            <label htmlFor="playerName">Name</label>
            <input
              id="playerName"
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 18))}
              placeholder="e.g. NeonNinja"
              autoComplete="off"
              maxLength={18}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const trimmed = name.trim()
                  if (trimmed.length >= 2) {
                    event.preventDefault()
                    onComplete(trimmed)
                  }
                }
              }}
            />
            <small>18 characters max. This is how you appear on the board.</small>
          </div>
        )}
        <div className="onboarding-controls">
          <button type="button" className="ghost" onClick={prevStep} disabled={step === 0}>
            Back
          </button>
          <button
            type="button"
            onClick={nextStep}
            disabled={step === slides.length - 1 && name.trim().length < 2}
          >
            {step === slides.length - 1 ? 'Let me in' : 'Next'}
          </button>
        </div>
        <div className="step-dots" role="tablist" aria-label="Onboarding progress">
          {slides.map((_, index) => (
            <span key={index} className={index === step ? 'active' : ''} aria-hidden />
          ))}
        </div>
        <p className="info-meta">
          Imagery credit: <a href={datasetUrl} target="_blank" rel="noreferrer">OpenFake</a> ({datasetLicense}).
        </p>
      </div>
      <div className="onboarding-feed">
        <h3>Current heat check</h3>
        {topThree.length === 0 ? (
          <p>No one on the board yet. Your run starts now. 🚀</p>
        ) : (
          <ul>
            {topThree.map((entry, index) => (
              <li key={entry.name}>
                <span className="rank">#{index + 1}</span>
                <span className="name">{entry.name}</span>
                <span className="score">{formatScore(entry.score)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="onboarding-tip">Swipe left for AI 🤖, right for real 📸. Buttons and keys work too!</p>
      </div>
    </div>
  )
}

type PercentileCurveProps = {
  scores: number[]
  percentile: number
  displayValue: number
}

const PercentileCurve = ({ scores, percentile, displayValue }: PercentileCurveProps) => {
  const width = 520
  const height = 110
  const padding = 20

  const sorted = scores.length === 0 ? [0, 1] : [...scores]
  if (sorted.length === 1) {
    sorted.push(sorted[0])
  }
  sorted.sort((a, b) => a - b)

  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const range = max - min || 1
  const count = sorted.length

  const points = sorted.map((value, index) => {
    const x = padding + (index / (count - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return [x, y] as const
  })

  const clamp = (val: number, low: number, high: number) => Math.min(Math.max(val, low), high)
  const position = clamp(percentile * (count - 1), 0, count - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.min(count - 1, lowerIndex + 1)
  const t = position - lowerIndex
  const lowerPoint = points[lowerIndex]
  const upperPoint = points[upperIndex]
  const markerX = lowerPoint[0] + (upperPoint[0] - lowerPoint[0]) * t
  const markerY = lowerPoint[1] + (upperPoint[1] - lowerPoint[1]) * t

  const polylinePoints = points.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <div className="percentile-card">
      <div className="percentile-header">
        <span className="percentile-label">Percentile</span>
        <span className="percentile-value">{displayValue}<span>%</span></span>
      </div>
      <svg
        className="percentile-curve"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`You are in the ${displayValue}th percentile`}
      >
        <polyline points={polylinePoints} />
        <circle cx={markerX} cy={markerY} r={5} />
      </svg>
    </div>
  )
}

export default App
