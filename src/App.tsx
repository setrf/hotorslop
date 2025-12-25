import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useSwipeable } from 'react-swipeable'

import './App.css'
import { fetchOpenFakeDeck, OPEN_FAKE_CONSTANTS, type HotOrSlopImage } from './services/openfake'

import { analytics, fetchPublicModelStats, type PublicModelStat } from './services/analytics'
import AdminAnalyticsPanel from './components/AdminAnalyticsPanel'

type GuessType = 'ai' | 'real'


import { getLeaderboard, saveGuess } from './services/api'
type LeaderboardEntry = {
  rank: number;
  username: string;
  current_score: number;
  high_score: number;
  total_rounds: number;
  sessions_played: number;
  avg_accuracy: number;
  last_played: string;
  is_active: boolean;
}

const PLAYER_STORAGE_KEY = 'hotorslop_player_name'
const LEADERBOARD_STORAGE_KEY = 'hotorslop_leaderboard'
const ONBOARDING_STORAGE_KEY = 'hotorslop_onboarded'
const COOKIE_CONSENT_KEY = 'hotorslop_cookie_consent'


const loadPlayerName = (): string => {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(PLAYER_STORAGE_KEY) ?? ''
}

const hasFinishedOnboarding = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true'
}

type CookiePreference = 'accepted' | 'declined'

const loadCookiePreference = (): CookiePreference | null => {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(COOKIE_CONSENT_KEY)
  return stored === 'accepted' || stored === 'declined' ? stored : null
}

const formatScore = (score: number): string => `${score}`

const DECK_SIZE = 8
const AFK_LATENCY_THRESHOLD_MS = 25_000

const truncate = (value: string, max = 140): string => {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

type DatasetSource = {
  label: string
  url: string
  license: string
  credit: string
}

const DATASET_SOURCES: DatasetSource[] = [
  {
    label: 'OpenFake (synthetic)',
    url: OPEN_FAKE_CONSTANTS.synthetic.datasetUrl,
    license: OPEN_FAKE_CONSTANTS.synthetic.license,
    credit: OPEN_FAKE_CONSTANTS.synthetic.credit,
  },
  {
    label: 'Nano-Banana (synthetic)',
    url: OPEN_FAKE_CONSTANTS.nanoBanana.datasetUrl,
    license: OPEN_FAKE_CONSTANTS.nanoBanana.license,
    credit: OPEN_FAKE_CONSTANTS.nanoBanana.credit,
  },
  {
    label: 'COCO-Caption2017 (real)',
    url: OPEN_FAKE_CONSTANTS.real.datasetUrl,
    license: OPEN_FAKE_CONSTANTS.real.license,
    credit: OPEN_FAKE_CONSTANTS.real.credit,
  },
  {
    label: 'OpenFake (real)',
    url: OPEN_FAKE_CONSTANTS.openFakeReal.datasetUrl,
    license: OPEN_FAKE_CONSTANTS.openFakeReal.license,
    credit: OPEN_FAKE_CONSTANTS.openFakeReal.credit,
  },
]

const generateDeckId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `deck_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())


function App() {
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerName())
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const initialOnboardingNeeded = useMemo(() => !(hasFinishedOnboarding() && loadPlayerName()), [])
  const [showOnboarding, setShowOnboarding] = useState(initialOnboardingNeeded)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false)
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false)
  const [modelStats, setModelStats] = useState<PublicModelStat[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [deckResults, setDeckResults] = useState<{ correct: number; total: number } | null>(null)
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'shared'>('idle')
  const [cookiePreference, setCookiePreference] = useState<CookiePreference | null>(() => loadCookiePreference())
  const showCookieBanner = cookiePreference === null

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0 })
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (showOnboarding || isInfoOpen || isLeaderboardOpen || isAnalyticsOpen) return
    window.scrollTo({ top: 0, left: 0 })
  }, [isAnalyticsOpen, isInfoOpen, isLeaderboardOpen, showOnboarding])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const gtag = (window as typeof window & { gtag?: (...args: unknown[]) => void }).gtag

    if (cookiePreference === 'accepted') {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted')
      analytics.updateSession({ optedIn: true })
      if (typeof gtag === 'function') {
        gtag('consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted' })
      }
    } else if (cookiePreference === 'declined') {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, 'declined')
      analytics.updateSession({ optedIn: false })
      if (typeof gtag === 'function') {
        gtag('consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied' })
      }
    } else {
      analytics.updateSession({ optedIn: false })
      if (typeof gtag === 'function') {
        gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied' })
      }
    }
  }, [cookiePreference])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const originalOverflow = document.body.style.overflow
    if (showOnboarding || isLeaderboardOpen || isInfoOpen || isAnalyticsOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isAnalyticsOpen, isInfoOpen, isLeaderboardOpen, showOnboarding])

  const [deck, setDeck] = useState<HotOrSlopImage[]>([])
  const [isLoadingDeck, setIsLoadingDeck] = useState(true)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [stats, setStats] = useState({ total: 0, correct: 0 })
  const [streak, setStreak] = useState(0)
  const [perfectDeckStreak, setPerfectDeckStreak] = useState(0)
  const [isLocked, setIsLocked] = useState(false)
  const [offset, setOffset] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [activeGuess, setActiveGuess] = useState<GuessType | null>(null)
  const resultTimeoutRef = useRef<number | null>(null)
  const cardAdvanceTimeoutRef = useRef<number | null>(null)
  const activeGuessTimeoutRef = useRef<number | null>(null)
  const nextDeckRef = useRef<HotOrSlopImage[] | null>(null)
  const isPrefetchingRef = useRef(false)
  const cardRevealTimeRef = useRef<number>(nowMs())
  const currentDeckIdRef = useRef<string>(generateDeckId())
  const nextDeckIdRef = useRef<string | null>(null)
  const hasLoadedInitialDeckRef = useRef(false)
  const deckStatsRef = useRef({ correct: 0, total: 0 })

  const handlers = useSwipeable({
    onSwiping: (eventData) => {
      setOffset(eventData.deltaX)
      setRotation(eventData.deltaX / 20) // Adjust divisor for desired rotation speed
    },
    onSwiped: (eventData) => {
      if (eventData.dir === 'Left') {
        handleGuess('ai')
      } else if (eventData.dir === 'Right') {
        handleGuess('real')
      }
      setOffset(0)
      setRotation(0)
    },
    preventScrollOnSwipe: true,
    trackMouse: true,
  })

  const overlayActive = showOnboarding || isLeaderboardOpen || isInfoOpen || isAnalyticsOpen

  const currentCard = deck[currentIndex]
  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
  const accuracyDisplay = stats.total ? `${accuracy}%` : '—'

  const prefetchDeck = useCallback(async () => {
    if (isPrefetchingRef.current) return
    if (nextDeckRef.current) return
    isPrefetchingRef.current = true
    try {
      // Prefetch larger deck to maintain buffer
      const next = await fetchOpenFakeDeck({ count: DECK_SIZE + 20 })
      nextDeckRef.current = next
      nextDeckIdRef.current = generateDeckId()
      console.log(`Prefetched ${next.length} images for buffer`)
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
        const deckId = nextDeckIdRef.current ?? generateDeckId()
        nextDeckIdRef.current = null
        currentDeckIdRef.current = deckId
        analytics.setDeck(deckId, items.length)
        setDeck(items)
        setCurrentIndex(0)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {}, 200)
        }
        setIsLoadingDeck(false)
        hasLoadedInitialDeckRef.current = true
        void prefetchDeck()
        return
      }

      setIsLoadingDeck(true)
      try {
        const items = await fetchOpenFakeDeck({ count: DECK_SIZE })
        const deckId = generateDeckId()
        currentDeckIdRef.current = deckId
        analytics.setDeck(deckId, items.length)
        setDeck(items)
        setCurrentIndex(0)
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {}, 200)
        }
        hasLoadedInitialDeckRef.current = true
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

  const loadGlobalLeaderboard = useCallback(async () => {
    try {
      const response = await getLeaderboard(50, 'all')
      setLeaderboard(response.leaderboard)
    } catch (error) {
      console.error('Failed to load leaderboard:', error)
    }
  }, [])

  useEffect(() => {
    analytics.init({ deckSize: DECK_SIZE })
    loadGlobalLeaderboard()

    // Fetch public model stats for info panel
    fetchPublicModelStats()
      .then(setModelStats)
      .catch((error) => console.warn('Failed to load model stats:', error))
  }, [loadGlobalLeaderboard])

  useEffect(() => {
    if (!playerName) return
    analytics.setUsername(playerName)
  }, [playerName])

  useEffect(() => {
    loadDeck()
  }, [loadDeck])

  // Smart preloader to maintain 8+ image buffer
  useEffect(() => {
    if (!hasLoadedInitialDeckRef.current) return

    const maintainImageBuffer = async () => {
      const targetBuffer = 8 // Maintain at least 8 images for smooth gameplay

      try {
        // Continuously preload to maintain small buffer
        while (true) {
          if (isPrefetchingRef.current) {
            await new Promise(resolve => setTimeout(resolve, 500))
            continue
          }

          const currentBuffer = (deck.length - currentIndex) + (nextDeckRef.current?.length || 0)
          if (currentBuffer < targetBuffer) {
            console.log(`Buffer low (${currentBuffer}), preloading more images...`)
            await fetchOpenFakeDeck({ count: Math.min(targetBuffer, 12), limitPerFetch: 8 })
          }

          // Wait before checking again - longer delay to avoid excessive API calls
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      } catch (error) {
        console.warn('Buffer maintenance failed:', error)
      }
    }

    // Start maintaining buffer immediately after initial load
    maintainImageBuffer()
  }, [deck.length, currentIndex])

  useEffect(() => {
    if (deck.length === 0) return
    // With smaller deck (8), prefetch earlier (at card 2+)
    if (currentIndex >= 2) {
      void prefetchDeck()
    }
  }, [currentIndex, deck.length, prefetchDeck])

  useEffect(() => {
    if (!currentCard) return
    cardRevealTimeRef.current = nowMs()
  }, [currentCard?.id])

  useEffect(() => {
    return () => {
      if (resultTimeoutRef.current) window.clearTimeout(resultTimeoutRef.current)
      void analytics.flushNow()
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

  const advanceCard = useCallback(() => {
    if (deck.length === 0) return
    setCurrentIndex((prev) => {
      const next = prev + 1
      if (next >= deck.length) {
        // Deck completed - save results and show share modal
        const results = { ...deckStatsRef.current }
        if (results.total > 0) {
          setDeckResults(results)
          setShareStatus('idle')
          setShowShareModal(true)
        }
        // Reset deck stats for next deck
        deckStatsRef.current = { correct: 0, total: 0 }
        void loadDeck(true)
        return 0
      }
      return next
    })
  }, [deck.length, loadDeck])

  const handleGuess = useCallback(
    async (guess: GuessType) => {
      if (isLocked || !currentCard) return
      setIsLocked(true)

      const correct = currentCard.answer === guess
      const latencyMs = Math.max(0, Math.round(nowMs() - (cardRevealTimeRef.current ?? nowMs())))
      const isAfkGuess = latencyMs > AFK_LATENCY_THRESHOLD_MS
      const datasetSource = currentCard.label === 'fake' ? 'synthetic' : 'real'

      if (isAfkGuess) {
        feedbackCounterRef.current += 1
        const inactivitySeconds = latencyMs / 1000
        setFeedbackMessage({
          id: feedbackCounterRef.current,
          message: `Guess skipped after ${inactivitySeconds.toFixed(1)}s of inactivity — no score change.`,
          type: 'error',
        })

        if (resultTimeoutRef.current) {
          window.clearTimeout(resultTimeoutRef.current)
        }
        if (cardAdvanceTimeoutRef.current) {
          window.clearTimeout(cardAdvanceTimeoutRef.current)
        }

        cardAdvanceTimeoutRef.current = window.setTimeout(() => {
          advanceCard()
          setIsLocked(false)
          cardAdvanceTimeoutRef.current = null
        }, 420)

        resultTimeoutRef.current = window.setTimeout(() => {
          setFeedbackMessage(null)
          resultTimeoutRef.current = null
        }, 2200)

        return
      }

      analytics.trackGuess({
        deckId: currentDeckIdRef.current,
        deckPosition: currentIndex,
        cardId: currentCard.id,
        datasetSource,
        label: currentCard.label,
        model: currentCard.model ?? null,
        promptLength: currentCard.prompt?.length,
        guessedAnswer: guess,
        correct,
        latencyMs,
        timestamp: new Date().toISOString(),
      })

      void analytics.flushNow().catch(() => {
        // Swallow flush errors; analytics dashboards surface failures separately.
      })

      const scoreChange = correct ? 1 : -1
      const nextScore = Math.max(0, score + scoreChange)
      const nextTotal = stats.total + 1
      const nextCorrect = stats.correct + (correct ? 1 : 0)
      const nextStreak = correct ? streak + 1 : 0

      // Save guess to server and update local state
      try {
        await saveGuess(playerName, scoreChange, correct, DECK_SIZE)
      } catch (error) {
        console.warn('Failed to save guess to server:', error)
        // Continue with local state update even if server save fails
      }

      setScore(nextScore)
      setStats({ total: nextTotal, correct: nextCorrect })
      setStreak(nextStreak)

      // Track deck-level stats for share feature
      deckStatsRef.current.total += 1
      if (correct) {
        deckStatsRef.current.correct += 1
      }

      // Track perfect deck streaks
      if (correct && nextTotal > 0 && nextTotal % DECK_SIZE === 0) {
        const deckAccuracy = nextCorrect / nextTotal
        if (deckAccuracy === 1.0) {
          setPerfectDeckStreak(prev => prev + 1)
        }
      }

      // Enhanced feedback messages based on streak
      const getFeedbackMessage = (isCorrect: boolean, currentStreak: number, perfectDecks: number) => {
        if (isCorrect) {
          if (perfectDecks > 0) return `PERFECT DECK! ${perfectDecks} in a row! 👑`
          if (currentStreak >= 10) return "INCREDIBLE! You're on FIRE! 🔥"
          if (currentStreak >= 7) return "AMAZING STREAK! Keep it up! 🚀"
          if (currentStreak >= 5) return "FANTASTIC! You're crushing it! 💪"
          if (currentStreak >= 3) return "Great job! Building momentum! ⚡"
          return "Hot! 🔥"
        } else {
          if (currentStreak >= 5) return "Streak broken! No worries, bounce back! 💪"
          if (currentStreak >= 3) return "Close call! Keep trying! 🎯"
          return "Slop! 🤢"
        }
      }

      const getMotivationalMessage = (isCorrect: boolean, answer: GuessType) => {
        if (isCorrect) {
          return `You nailed it — that was ${answer === 'ai' ? 'AI generated' : 'a real capture'}! 🎯`
        } else {
          return `It was actually ${answer === 'ai' ? 'AI generated' : 'a real photo'}. Nice try! 😅`
        }
      }

      const feedbackText = getFeedbackMessage(correct, correct ? nextStreak : 0, perfectDeckStreak)
      const motivationalMessage = getMotivationalMessage(correct, currentCard.answer)

      feedbackCounterRef.current += 1
      setFeedbackMessage({
        id: feedbackCounterRef.current,
        message: `${feedbackText} ${motivationalMessage}`,
        type: correct ? 'success' : 'error',
        reveal: {
          answer: currentCard.answer,
          model: currentCard.model ?? null,
          prompt: currentCard.prompt,
        },
      })

      if (resultTimeoutRef.current) {
        window.clearTimeout(resultTimeoutRef.current)
      }

      resultTimeoutRef.current = window.setTimeout(() => {
        setFeedbackMessage(null)
        resultTimeoutRef.current = null
      }, 4000)

      // Auto-advance to next card after brief delay
      if (cardAdvanceTimeoutRef.current) {
        window.clearTimeout(cardAdvanceTimeoutRef.current)
      }
      cardAdvanceTimeoutRef.current = window.setTimeout(() => {
        advanceCard()
        setIsLocked(false)
        cardAdvanceTimeoutRef.current = null
      }, 600)

      // Refresh leaderboard immediately after each guess to show updated rankings
      loadGlobalLeaderboard().catch(error => {
        console.warn('Failed to refresh leaderboard:', error)
      })
    },
    [
      advanceCard,
      currentCard,
      isLocked,
      loadGlobalLeaderboard,
      perfectDeckStreak,
      playerName,
      score,
      stats.correct,
      stats.total,
      streak,
    ]
  )

  const triggerGuess = useCallback(
    (type: GuessType) => {
      if (activeGuessTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(activeGuessTimeoutRef.current)
      }

      setActiveGuess(type)

      if (typeof window !== 'undefined') {
        activeGuessTimeoutRef.current = window.setTimeout(() => {
          setActiveGuess(null)
          activeGuessTimeoutRef.current = null
        }, 260)
      }

      handleGuess(type)
    },
    [handleGuess]
  )

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (overlayActive) return
      if (isLocked || !currentCard || isLoadingDeck) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        triggerGuess('ai')
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        triggerGuess('real')
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentCard, isLoadingDeck, isLocked, overlayActive, triggerGuess])

  useEffect(() => {
    return () => {
      if (activeGuessTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(activeGuessTimeoutRef.current)
        activeGuessTimeoutRef.current = null
      }
      if (cardAdvanceTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(cardAdvanceTimeoutRef.current)
        cardAdvanceTimeoutRef.current = null
      }
    }
  }, [])


  const handleLogout = useCallback(() => {
    // Clear all stored data
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY)
      window.localStorage.removeItem(LEADERBOARD_STORAGE_KEY)
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    }

    // Reset all state
    setPlayerName('')
    setLeaderboard([])
    setScore(0)
    setStats({ total: 0, correct: 0 })
    setStreak(0)
    setPerfectDeckStreak(0)
    setCurrentIndex(0)
    setIsLocked(false)
    setOffset(0)
    setRotation(0)
    setDeckError(null)
    setDeck([])
    setIsLoadingDeck(true)
    setActiveGuess(null)
    setFeedbackMessage(null)
    feedbackCounterRef.current = 0

    // Close all modals
    setIsInfoOpen(false)
    setIsLeaderboardOpen(false)
    setIsAnalyticsOpen(false)

    // Clear any existing timeouts
    if (resultTimeoutRef.current) {
      window.clearTimeout(resultTimeoutRef.current)
      resultTimeoutRef.current = null
    }
    if (activeGuessTimeoutRef.current) {
      window.clearTimeout(activeGuessTimeoutRef.current)
      activeGuessTimeoutRef.current = null
    }
    if (cardAdvanceTimeoutRef.current) {
      window.clearTimeout(cardAdvanceTimeoutRef.current)
      cardAdvanceTimeoutRef.current = null
    }

    // Reset analytics session
    analytics.updateSession({ username: undefined })

    // Show onboarding again
    setShowOnboarding(true)
  }, [])

  const handleAcceptCookies = useCallback(() => {
    setCookiePreference('accepted')
  }, [])

  const handleDeclineCookies = useCallback(() => {
    setCookiePreference('declined')
  }, [])

  const handleShare = useCallback(async () => {
    if (!deckResults) return

    const accuracy = Math.round((deckResults.correct / deckResults.total) * 100)
    const emoji = accuracy === 100 ? '🏆' : accuracy >= 75 ? '🔥' : accuracy >= 50 ? '👍' : '😅'
    const shareText = `${emoji} Hot or Slop - I got ${deckResults.correct}/${deckResults.total} (${accuracy}%) spotting AI-generated images!\n\nCan you beat my score? Play at:`
    const shareUrl = 'https://hotorslop.mertgulsun.com'

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'Hot or Slop Results',
          text: shareText,
          url: shareUrl,
        })
        setShareStatus('shared')
        return
      } catch (error) {
        // User cancelled or share failed, fall back to clipboard
        if ((error as Error).name === 'AbortError') return
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`)
      setShareStatus('copied')
    } catch {
      console.warn('Failed to copy to clipboard')
    }
  }, [deckResults])

  const handleCloseShareModal = useCallback(() => {
    setShowShareModal(false)
    setDeckResults(null)
    setShareStatus('idle')
  }, [])

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
    return leaderboard.findIndex((entry) => entry.username.toLowerCase() === playerName.toLowerCase())
  }, [leaderboard, playerName])

  const percentileData = useMemo(() => {
    const baseScores = leaderboard.map((entry) => entry.high_score)
    const scores = [...baseScores, score]
    if (scores.length === 0) {
      return { scores: [0, 1], percentile: 0.5 }
    }
    const sorted = [...scores].sort((a, b) => a - b)

    if (playerRank >= 0 && leaderboard.length > 0) {
      const percentile = leaderboard.length === 1 ? 1 : 1 - playerRank / leaderboard.length
      return { scores: sorted, percentile }
    }

    const belowOrEqual = sorted.filter((value) => value <= score).length
    const percentile = belowOrEqual / sorted.length
    return { scores: sorted, percentile }
  }, [leaderboard, playerRank, score])

  const percentileDisplay = Math.round(percentileData.percentile * 100)

  const controlsDisabled = isLocked || isLoadingDeck || !currentCard || overlayActive
  const showLoadingOverlay = isLoadingDeck && deck.length > 0
  const shellClassName = [
    'app-shell',
    showOnboarding ? 'splash-active' : '',
    (isLeaderboardOpen || isInfoOpen || isAnalyticsOpen) && !showOnboarding ? 'panel-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  type FeedbackBanner = {
    id: number
    message: string
    type: 'success' | 'error'
    reveal?: {
      answer: 'ai' | 'real'
      model: string | null
      prompt: string
    }
  }
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackBanner | null>(null)
  const feedbackCounterRef = useRef(0)

  const getGuessButtonClassName = useCallback(
    (type: GuessType) =>
      ['guess-button', type === 'ai' ? 'ai' : 'real', activeGuess === type ? 'active' : '']
        .filter(Boolean)
        .join(' '),
    [activeGuess]
  )

  // ... (rest of the component)

  return (
    <div className={shellClassName}>
      <div className="app-content">
        <header className="top-bar">
          <div className="brand-stack">
            <h2 className="brand-heading">Hot or Slop 🔥🤖</h2>
            <p className="brand-subtitle">
              A visual Turing test where the crowd probes the state of generative image models and tracks our collective
              ability to call the fake.
            </p>
          </div>
        </header>

        <main
          className="minimal-main"
          aria-hidden={showOnboarding}
          style={showOnboarding ? { pointerEvents: 'none' } : undefined}
        >
          {currentCard ? (
            <>
              <div className="card-controls">
                <div className="controls">
                  <button
                    type="button"
                    className={getGuessButtonClassName('ai')}
                    onClick={() => triggerGuess('ai')}
                    disabled={controlsDisabled}
                  >
                    🤖 AI Generated
                  </button>
                  <button
                    type="button"
                    className={getGuessButtonClassName('real')}
                    onClick={() => triggerGuess('real')}
                    disabled={controlsDisabled}
                  >
                    📸 Real Photo
                  </button>
                </div>
                <p className="swipe-hint">Swipe left for AI, right for real — or tap the buttons / use ← → keys.</p>
              </div>
              <div
                className="image-card"
                {...handlers}
                style={{
                  transform: `translateX(${offset}px) rotate(${rotation}deg)`,
                  transition: offset === 0 ? 'transform 0.3s ease-out' : 'none',
                }}
                role="img"
                aria-label={`${truncate(currentCard.prompt, 160)} — guess if it is real or AI generated`}
              >
                {/* Swipe direction indicators */}
                <div
                  className="swipe-indicator swipe-indicator-left"
                  style={{
                    opacity: Math.max(0, Math.min(1, Math.abs(offset) / 150)) * (offset < 0 ? 1 : 0)
                  }}
                >
                  <div className="swipe-indicator-content">
                    <span className="swipe-label">AI-Generated</span>
                  </div>
                </div>
                <div
                  className="swipe-indicator swipe-indicator-right"
                  style={{
                    opacity: Math.max(0, Math.min(1, Math.abs(offset) / 150)) * (offset > 0 ? 1 : 0)
                  }}
                >
                  <div className="swipe-indicator-content">
                    <span className="swipe-label">Real</span>
                  </div>
                </div>
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
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-button primary"
              onClick={() => setIsInfoOpen(true)}
              aria-expanded={isInfoOpen}
              aria-controls="info-panel"
              disabled={overlayActive && !isInfoOpen}
            >
              Info ℹ️
            </button>
            <button
              type="button"
              className="icon-button outline"
              onClick={() => setIsLeaderboardOpen(true)}
              aria-expanded={isLeaderboardOpen}
              aria-controls="leaderboard-panel"
              disabled={overlayActive && !isLeaderboardOpen}
            >
              Leaderboard 🏆
            </button>
            <button
              type="button"
              className="icon-button outline"
              onClick={() => setIsAnalyticsOpen(true)}
              aria-expanded={isAnalyticsOpen}
              aria-controls="analytics-panel"
              disabled={overlayActive && !isAnalyticsOpen}
            >
              Analytics 📊
            </button>
            <button
              type="button"
              className="icon-button subtle logout"
              onClick={handleLogout}
              disabled={overlayActive}
              title="Logout and change player"
            >
              Logout 🚪
            </button>
          </div>

        </main>
      </div>
      {feedbackMessage && (
        <div
          key={feedbackMessage.id}
          className={`feedback-toast ${feedbackMessage.type}`}
          role="status"
          aria-live="polite"
        >
          <div className="feedback-toast-main">{feedbackMessage.message}</div>
          {feedbackMessage.reveal && (
            <div className="feedback-toast-reveal">
              <span className="feedback-toast-type">
                {feedbackMessage.reveal.answer === 'ai' ? '🤖 AI' : '📸 Real'}
              </span>
              {feedbackMessage.reveal.answer === 'ai' && feedbackMessage.reveal.model && (
                <span className="feedback-toast-model">{feedbackMessage.reveal.model}</span>
              )}
              <span className="feedback-toast-prompt">{truncate(feedbackMessage.reveal.prompt, 80)}</span>
            </div>
          )}
        </div>
      )}

      {showShareModal && deckResults && (
        <div className="share-overlay" role="dialog" aria-modal="true">
          <div className="share-panel">
            <div className="share-header">
              <h2>Deck Complete!</h2>
              <button type="button" className="icon-button ghost" onClick={handleCloseShareModal}>
                ✕
              </button>
            </div>
            <div className="share-results">
              <div className="share-score">
                <span className="share-score-value">{deckResults.correct}/{deckResults.total}</span>
                <span className="share-score-label">Correct</span>
              </div>
              <div className="share-accuracy">
                <span className="share-accuracy-value">
                  {Math.round((deckResults.correct / deckResults.total) * 100)}%
                </span>
                <span className="share-accuracy-label">Accuracy</span>
              </div>
            </div>
            <p className="share-message">
              {deckResults.correct === deckResults.total
                ? 'Perfect score! You have an eagle eye for AI.'
                : deckResults.correct >= deckResults.total * 0.75
                ? 'Great job! You can spot the fakes.'
                : deckResults.correct >= deckResults.total * 0.5
                ? 'Not bad! Keep practicing to improve.'
                : 'The AI is getting better! Keep training your eye.'}
            </p>
            <div className="share-actions">
              <button type="button" className="share-button primary" onClick={handleShare}>
                {shareStatus === 'copied' ? 'Copied!' : shareStatus === 'shared' ? 'Shared!' : 'Share Results'}
              </button>
              <button type="button" className="share-button secondary" onClick={handleCloseShareModal}>
                Continue Playing
              </button>
            </div>
          </div>
        </div>
      )}

      {showCookieBanner && (
        <div className="cookie-banner" role="dialog" aria-live="polite">
          <div className="cookie-content">
            <p>
              We use cookies and local storage to keep sessions, analytics, and leaderboards in sync. Accept to share usage data for
              research, or decline to continue with minimal tracking.
            </p>
            <div className="cookie-actions">
              <button type="button" className="cookie-button positive" onClick={handleAcceptCookies}>
                Accept
              </button>
              <button type="button" className="cookie-button" onClick={handleDeclineCookies}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

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
              <h2>About Hot or Slop</h2>
              <button type="button" className="icon-button ghost" onClick={() => setIsInfoOpen(false)}>
                Close
              </button>
            </div>
            <section className="info-section">
              <h3>What is this?</h3>
              <p className="info-text">
                <strong>Hot or Slop</strong> is a game that challenges you to distinguish between AI-generated images and real photographs.
                Test your ability to spot synthetic content in a fun, competitive environment!
              </p>
              <p className="info-text">
                Swipe, tap, or use arrow keys to make your guess. Correct answers earn points while wrong answers deduct them.
                Build streaks, climb the leaderboard, and sharpen your detection skills!
              </p>
            </section>
            <section className="info-section">
              <h3>Current image</h3>
              {currentCard ? (
                <>
                  <p className="info-text" title={currentCard.prompt}>{currentCard.prompt}</p>
                  <p className="info-meta">
                    Guess first to reveal metadata.
                  </p>
                </>
              ) : (
                <p className="info-text">No card loaded yet.</p>
              )}
            </section>
            {modelStats.length > 0 && (
              <section className="info-section">
                <h3>Most Convincing AI Models</h3>
                <p className="info-text">
                  Which AI models fool humans the most? Here are the top performers ranked by "fool rate" — the percentage of times players incorrectly guessed an AI image was real.
                </p>
                <div className="model-stats-list">
                  {modelStats.slice(0, 5).map((stat, index) => (
                    <div key={stat.model} className="model-stat-item">
                      <span className="model-rank">#{index + 1}</span>
                      <span className="model-name">{stat.model}</span>
                      <span className="model-fool-rate">{stat.foolRate}% fooled</span>
                    </div>
                  ))}
                </div>
                <p className="info-meta">Based on {modelStats.reduce((sum, m) => sum + m.guesses, 0).toLocaleString()} guesses (min. 10 per model)</p>
              </section>
            )}

            <section className="info-section">
              <h3>Dataset</h3>
              <p className="info-text">
                Synthetic images stream from the OpenFake dataset ({OPEN_FAKE_CONSTANTS.synthetic.license}) and Nano-Banana
                dataset ({OPEN_FAKE_CONSTANTS.nanoBanana.license}); real photos come from COCO-Caption2017
                ({OPEN_FAKE_CONSTANTS.real.license}) and OpenFake ({OPEN_FAKE_CONSTANTS.openFakeReal.license}). Metadata stays in sync with all sources.
              </p>
              <div className="dataset-links">
                {DATASET_SOURCES.map((source) => (
                  <a
                    key={source.url}
                    className="secondary-button"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.label}
                  </a>
                ))}
              </div>
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
                      <th>Current Score</th>
                      <th>High Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((entry) => {
                      const isPlayer = entry.username.toLowerCase() === playerName.toLowerCase()
                      return (
                        <tr key={entry.username} className={`${isPlayer ? 'highlight' : ''} ${entry.is_active ? 'active' : ''}`}>
                          <td>{entry.rank}</td>
                          <td>
                            {entry.username}
                            {/* Active indicator removed per design update */}
                          </td>
                          <td>{entry.total_rounds}</td>
                          <td>{formatScore(entry.current_score)}</td>
                          <td>{formatScore(entry.high_score)}</td>
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
              Imagery credit: <a href={OPEN_FAKE_CONSTANTS.synthetic.datasetUrl} target="_blank" rel="noreferrer">OpenFake</a>{' '}
              ({OPEN_FAKE_CONSTANTS.synthetic.license}) ·{' '}
              <a href={OPEN_FAKE_CONSTANTS.nanoBanana.datasetUrl} target="_blank" rel="noreferrer">Nano-Banana</a>{' '}
              ({OPEN_FAKE_CONSTANTS.nanoBanana.license}) ·{' '}
              <a href={OPEN_FAKE_CONSTANTS.real.datasetUrl} target="_blank" rel="noreferrer">COCO-Caption2017</a>{' '}
              ({OPEN_FAKE_CONSTANTS.real.license}).
            </p>
          </div>
        </div>
      )}

      {isAnalyticsOpen && (
        <AdminAnalyticsPanel onClose={() => setIsAnalyticsOpen(false)} />
      )}

      {showOnboarding && (
        <div className="splash-layer" role="dialog" aria-modal="true">
          <Onboarding
            initialName={playerName}
            onComplete={handleOnboardingComplete}
            datasetSources={DATASET_SOURCES}
          />
        </div>
      )}

    </div>
  )
}

type OnboardingProps = {
  initialName: string
  datasetSources: DatasetSource[]
  onComplete: (name: string) => void
}

const Onboarding = ({ initialName, datasetSources, onComplete }: OnboardingProps) => {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const credits = datasetSources.length > 0 ? datasetSources : DATASET_SOURCES

  const slides = useMemo(
    () => [
      {
        title: '🎯 Spot the Difference',
        body: 'Can you tell AI-generated images from real photographs? Each image is either created by artificial intelligence or captured by a real camera.',
      },
      {
        title: '🏆 How to Score',
        body: 'Correct answer: +1 point\nWrong answer: -1 point\nBuild streaks for bonus motivation\nClimb the global leaderboard!',
      },
      {
        title: '🚀 Ready to Play?',
        body: 'Choose your player name to get started. Your scores will be saved and you can compete with others on the leaderboard.',
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

  

  return (
    <div className="onboarding-single">
      <div className="onboarding-panel">
        <header className="onboarding-header">
          <span className="brand-mark">Hot or Slop 🔥🤖</span>
        </header>

        <main className="onboarding-content">
          <div className="slide-content">
            <h2>{slides[step].title}</h2>
            <p>{slides[step].body}</p>
          </div>
        </main>

        <footer className="onboarding-footer">
        {step === slides.length - 1 && (
          <div className="name-capture">
            <label htmlFor="playerName">Name</label>
            <input
              id="playerName"
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 18))}
              placeholder="Enter your display name"
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
            <small>Choose a name (2-18 characters) - this is how you'll appear on the leaderboard!</small>
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

          <div className="onboarding-progress">
            <div className="step-dots" role="tablist" aria-label="Onboarding progress">
              {slides.map((_, index) => (
                <span key={index} className={index === step ? 'active' : ''} aria-hidden />
              ))}
            </div>
          </div>

          <div className="onboarding-credits">
            <p className="info-meta">
              Imagery credit:{' '}
              {credits.map((source, index) => (
                <span key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> ({source.license})
                  {index < credits.length - 1 ? ' · ' : '.'}
                </span>
              ))}
            </p>
          </div>
        </footer>
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
