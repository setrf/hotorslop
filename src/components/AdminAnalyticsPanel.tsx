import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  fetchAnalyticsOverview,
  fetchAnalyticsDatasetInsights,
  fetchAnalyticsModelInsights,
  fetchAnalyticsTimeline,
  fetchAnalyticsPlayers,
  type AnalyticsOverview,
  type DatasetInsight,
  type ModelInsight,
  type TimelinePoint,
  type PlayerInsight,
  type PlayerInsightsParams,
  type ModelInsightsParams,
} from '../services/analytics'

type AdminAnalyticsPanelProps = {
  onClose: () => void
}

type TimelineRange = '7d' | '30d' | '90d'
type PlayerSortColumn = 'guesses' | 'sessions' | 'accuracy' | 'avg_latency' | 'last_guess' | 'player'
type ModelSortColumn = 'guesses' | 'accuracy' | 'avg_latency' | 'last_guess' | 'modelKey'
type SortOrder = 'asc' | 'desc'

const PAGE_SIZE = 25

const humaniseRange = (range: TimelineRange) => {
  switch (range) {
    case '7d':
      return 'Last 7 days'
    case '30d':
      return 'Last 30 days'
    case '90d':
      return 'Last 90 days'
    default:
      return range
  }
}

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString()
}

const formatAccuracy = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—'
  return `${value}%`
}

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const AdminAnalyticsPanel = ({ onClose }: AdminAnalyticsPanelProps) => {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [datasets, setDatasets] = useState<DatasetInsight[]>([])
  const [models, setModels] = useState<ModelInsight[]>([])
  const [modelsTotal, setModelsTotal] = useState(0)
  const [modelsOffset, setModelsOffset] = useState(0)
  const [modelsSortBy, setModelsSortBy] = useState<ModelSortColumn>('guesses')
  const [modelsSortOrder, setModelsSortOrder] = useState<SortOrder>('desc')
  const [timelineRange, setTimelineRange] = useState<TimelineRange>('30d')
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [players, setPlayers] = useState<PlayerInsight[]>([])
  const [playersTotal, setPlayersTotal] = useState(0)
  const [playersOffset, setPlayersOffset] = useState(0)
  const [playersSortBy, setPlayersSortBy] = useState<PlayerSortColumn>('guesses')
  const [playersSortOrder, setPlayersSortOrder] = useState<SortOrder>('desc')

  const loadAnalytics = useCallback(async (playerParams?: PlayerInsightsParams, modelParams?: ModelInsightsParams) => {
    setIsLoading(true)
    setError(null)
    try {
      const [overviewData, datasetData, modelData, playerData, timelineData] = await Promise.all([
        fetchAnalyticsOverview(),
        fetchAnalyticsDatasetInsights(),
        fetchAnalyticsModelInsights({
          limit: PAGE_SIZE,
          offset: modelParams?.offset ?? modelsOffset,
          sortBy: modelParams?.sortBy ?? modelsSortBy,
          sortOrder: modelParams?.sortOrder ?? modelsSortOrder,
        }),
        fetchAnalyticsPlayers({
          limit: PAGE_SIZE,
          offset: playerParams?.offset ?? playersOffset,
          sortBy: playerParams?.sortBy ?? playersSortBy,
          sortOrder: playerParams?.sortOrder ?? playersSortOrder,
        }),
        fetchAnalyticsTimeline(timelineRange),
      ])

      setOverview(overviewData)
      setDatasets(datasetData)
      setModels(modelData.models)
      setModelsTotal(modelData.total)
      setPlayers(playerData.players)
      setPlayersTotal(playerData.total)
      setTimeline(timelineData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analytics')
    } finally {
      setIsLoading(false)
    }
  }, [timelineRange, playersOffset, playersSortBy, playersSortOrder, modelsOffset, modelsSortBy, modelsSortOrder])

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  const handlePlayerSort = (column: PlayerSortColumn) => {
    const newOrder = playersSortBy === column && playersSortOrder === 'desc' ? 'asc' : 'desc'
    setPlayersSortBy(column)
    setPlayersSortOrder(newOrder)
    setPlayersOffset(0)
  }

  const handleModelSort = (column: ModelSortColumn) => {
    const newOrder = modelsSortBy === column && modelsSortOrder === 'desc' ? 'asc' : 'desc'
    setModelsSortBy(column)
    setModelsSortOrder(newOrder)
    setModelsOffset(0)
  }

  const handlePlayersPage = (direction: 'prev' | 'next') => {
    const newOffset = direction === 'next' ? playersOffset + PAGE_SIZE : Math.max(0, playersOffset - PAGE_SIZE)
    setPlayersOffset(newOffset)
  }

  const handleModelsPage = (direction: 'prev' | 'next') => {
    const newOffset = direction === 'next' ? modelsOffset + PAGE_SIZE : Math.max(0, modelsOffset - PAGE_SIZE)
    setModelsOffset(newOffset)
  }

  const getSortIndicator = (column: string, currentSort: string, order: SortOrder) => {
    if (column !== currentSort) return ''
    return order === 'desc' ? ' ▼' : ' ▲'
  }

  const timelineTotals = useMemo(() => {
    if (timeline.length === 0) return { guesses: 0, accuracy: 0 }
    const guesses = timeline.reduce((sum, point) => sum + point.guesses, 0)
    const accuracy = Math.round(
      timeline.reduce((sum, point) => sum + point.accuracy * point.guesses, 0) / (guesses || 1)
    )
    return { guesses, accuracy }
  }, [timeline])

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="panel-layer analytics-layer"
      role="dialog"
      aria-modal="true"
      id="analytics-panel"
      onClick={handleBackdropClick}
    >
      <div className="analytics-panel">
        <div className="panel-heading">
          <h2>Analytics dashboard</h2>
          <div className="analytics-actions">
            <button type="button" className="secondary-button" onClick={() => void loadAnalytics()} disabled={isLoading}>
              Refresh
            </button>
            <button type="button" className="icon-button ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {error ? (
          <p className="info-text">{error}</p>
        ) : isLoading ? (
          <p className="info-text">Loading analytics…</p>
        ) : (
          <div className="analytics-content">
            <section className="analytics-section">
              <h3>Overview</h3>
              {overview ? (
                <div className="analytics-metric-grid">
                  <article>
                    <span className="metric-value">{formatNumber(overview.totalGuesses)}</span>
                    <span className="metric-label">Total guesses</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.totalSessions)}</span>
                    <span className="metric-label">Sessions</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.uniqueParticipants)}</span>
                    <span className="metric-label">Players opted in</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatAccuracy(overview.globalAccuracy)}</span>
                    <span className="metric-label">Global accuracy</span>
                  </article>
                  <article>
                    <span className="metric-value">{overview.averageLatencyMs ? `${overview.averageLatencyMs.toLocaleString()} ms` : '—'}</span>
                    <span className="metric-label">Avg reaction</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.guessesLast24h)}</span>
                    <span className="metric-label">Guesses · 24h</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.guessesLast7d)}</span>
                    <span className="metric-label">Guesses · 7d</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.activeDecks)}</span>
                    <span className="metric-label">Decks observed</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.datasetCount)}</span>
                    <span className="metric-label">Datasets</span>
                  </article>
                  <article>
                    <span className="metric-value">{formatNumber(overview.modelCount)}</span>
                    <span className="metric-label">Models</span>
                  </article>
                  <article className="metric-span">
                    <span className="metric-label">First guess recorded</span>
                    <span className="metric-value subtle">{formatTimestamp(overview.firstGuessAt)}</span>
                  </article>
                  <article className="metric-span">
                    <span className="metric-label">Most recent guess</span>
                    <span className="metric-value subtle">{formatTimestamp(overview.lastGuessAt)}</span>
                  </article>
                </div>
              ) : (
                <p className="info-text">No overview data yet.</p>
              )}
            </section>

            <section className="analytics-section">
              <div className="section-header">
                <h3>Timeline</h3>
                <div className="range-toggle" role="group" aria-label="Timeline range">
                  {(['7d', '30d', '90d'] as TimelineRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={range === timelineRange ? 'active' : ''}
                      onClick={() => setTimelineRange(range)}
                    >
                      {humaniseRange(range)}
                    </button>
                  ))}
                </div>
              </div>
              {timeline.length === 0 ? (
                <p className="info-text">No guesses recorded during this window.</p>
              ) : (
                <div className="timeline-card">
                  <header>
                    <div>
                      <span className="metric-value">{timelineTotals.guesses.toLocaleString()}</span>
                      <span className="metric-label">Guesses in window</span>
                    </div>
                    <div>
                      <span className="metric-value">{timelineTotals.accuracy}%</span>
                      <span className="metric-label">Weighted accuracy</span>
                    </div>
                  </header>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Guesses</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.map((point) => (
                        <tr key={point.bucket}>
                          <td>{point.bucket}</td>
                          <td>{point.guesses.toLocaleString()}</td>
                          <td>{point.accuracy}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="analytics-section">
              <h3>Dataset performance</h3>
              {datasets.length === 0 ? (
                <p className="info-text">No dataset analytics yet.</p>
              ) : (
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Guesses</th>
                      <th>Accuracy</th>
                      <th>Avg reaction</th>
                      <th>Last guess</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.map((dataset) => (
                      <tr key={dataset.datasetSource}>
                        <td>{dataset.datasetSource === 'synthetic' ? 'Synthetic (OpenFake + Nano-Banana)' : 'Real (COCO + OpenFake)'}</td>
                        <td>{dataset.guesses.toLocaleString()}</td>
                        <td>{dataset.accuracy}%</td>
                        <td>{dataset.averageLatencyMs ? `${dataset.averageLatencyMs.toLocaleString()} ms` : '—'}</td>
                        <td>{formatTimestamp(dataset.lastGuessAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="analytics-section">
              <div className="section-header">
                <h3>Model leaderboard</h3>
                <span className="section-count">{modelsTotal} total</span>
              </div>
              {models.length === 0 ? (
                <p className="info-text">Model metadata has not been logged yet.</p>
              ) : (
                <>
                  <table className="analytics-table sortable">
                    <thead>
                      <tr>
                        <th className="sortable-header" onClick={() => handleModelSort('modelKey')}>
                          Model{getSortIndicator('modelKey', modelsSortBy, modelsSortOrder)}
                        </th>
                        <th>Dataset</th>
                        <th className="sortable-header" onClick={() => handleModelSort('guesses')}>
                          Guesses{getSortIndicator('guesses', modelsSortBy, modelsSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handleModelSort('accuracy')}>
                          Accuracy{getSortIndicator('accuracy', modelsSortBy, modelsSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handleModelSort('avg_latency')}>
                          Avg reaction{getSortIndicator('avg_latency', modelsSortBy, modelsSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handleModelSort('last_guess')}>
                          Last guess{getSortIndicator('last_guess', modelsSortBy, modelsSortOrder)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((model) => (
                        <tr key={`${model.model}-${model.datasetSource}`}>
                          <td>{model.model}</td>
                          <td>{model.datasetSource === 'synthetic' ? 'Synthetic' : 'Real'}</td>
                          <td>{model.guesses.toLocaleString()}</td>
                          <td>{model.accuracy}%</td>
                          <td>{model.averageLatencyMs ? `${model.averageLatencyMs.toLocaleString()} ms` : '—'}</td>
                          <td>{formatTimestamp(model.lastGuessAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {modelsTotal > PAGE_SIZE && (
                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleModelsPage('prev')}
                        disabled={modelsOffset === 0 || isLoading}
                      >
                        Previous
                      </button>
                      <span className="pagination-info">
                        {modelsOffset + 1}–{Math.min(modelsOffset + PAGE_SIZE, modelsTotal)} of {modelsTotal}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleModelsPage('next')}
                        disabled={modelsOffset + PAGE_SIZE >= modelsTotal || isLoading}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="analytics-section">
              <div className="section-header">
                <h3>Player insights</h3>
                <span className="section-count">{playersTotal} total</span>
              </div>
              {players.length === 0 ? (
                <p className="info-text">No opted-in players yet.</p>
              ) : (
                <>
                  <table className="analytics-table sortable">
                    <thead>
                      <tr>
                        <th className="sortable-header" onClick={() => handlePlayerSort('player')}>
                          Player{getSortIndicator('player', playersSortBy, playersSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handlePlayerSort('sessions')}>
                          Sessions{getSortIndicator('sessions', playersSortBy, playersSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handlePlayerSort('guesses')}>
                          Guesses{getSortIndicator('guesses', playersSortBy, playersSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handlePlayerSort('accuracy')}>
                          Accuracy{getSortIndicator('accuracy', playersSortBy, playersSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handlePlayerSort('avg_latency')}>
                          Avg reaction{getSortIndicator('avg_latency', playersSortBy, playersSortOrder)}
                        </th>
                        <th className="sortable-header" onClick={() => handlePlayerSort('last_guess')}>
                          Last guess{getSortIndicator('last_guess', playersSortBy, playersSortOrder)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.map((player) => (
                        <tr key={player.player}>
                          <td>{player.player}</td>
                          <td>{player.sessions.toLocaleString()}</td>
                          <td>{player.guesses.toLocaleString()}</td>
                          <td>{player.accuracy}%</td>
                          <td>{player.averageLatencyMs ? `${player.averageLatencyMs.toLocaleString()} ms` : '—'}</td>
                          <td>{formatTimestamp(player.lastGuessAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {playersTotal > PAGE_SIZE && (
                    <div className="pagination-controls">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handlePlayersPage('prev')}
                        disabled={playersOffset === 0 || isLoading}
                      >
                        Previous
                      </button>
                      <span className="pagination-info">
                        {playersOffset + 1}–{Math.min(playersOffset + PAGE_SIZE, playersTotal)} of {playersTotal}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handlePlayersPage('next')}
                        disabled={playersOffset + PAGE_SIZE >= playersTotal || isLoading}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminAnalyticsPanel
