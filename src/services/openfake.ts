const HF_API_BASE = 'https://datasets-server.huggingface.co'

const SYNTHETIC_DATASET_ID = 'ComplexDataLab/OpenFake'
const SYNTHETIC_CONFIG = 'default'
const SYNTHETIC_SPLIT = 'test'
const SYNTHETIC_DATASET_CARD_URL = `https://huggingface.co/datasets/${SYNTHETIC_DATASET_ID}`
const SYNTHETIC_DATASET_LICENSE = 'CC BY-SA 4.0'

const REAL_DATASET_ID = 'lmms-lab/COCO-Caption2017'
const REAL_CONFIG = 'default'
const REAL_SPLIT = 'val'
const REAL_DATASET_CARD_URL = `https://huggingface.co/datasets/${REAL_DATASET_ID}`
const REAL_DATASET_LICENSE = 'CC BY 4.0'

export type HotOrSlopImage = {
  id: string
  src: string
  answer: 'ai' | 'real'
  label: 'fake' | 'real'
  prompt: string
  model?: string | null
  rounds?: number
  credit: string
  datasetUrl: string
}

type DatasetInfoResponse = {
  dataset_info?: {
    splits?: {
      [key: string]: {
        num_examples?: number
      }
    }
  }
}

type RowsResponse = {
  rows: Array<{
    row_idx: number
    row: {
      image?: {
        src?: string
        width?: number
        height?: number
      }
      label?: string
      prompt?: string
      model?: string | null
    }
  }>
}

type CocoRowsResponse = {
  rows: Array<{
    row_idx: number
    row: {
      image?: {
        src?: string
        width?: number
        height?: number
      }
      answer?: string[]
      question?: string
      file_name?: string
      coco_url?: string
    }
  }>
}

let cachedSyntheticRowCount: number | null = null
let cachedRealRowCount: number | null = null

const log = (...args: unknown[]) => {
  // Centralised logging so future suppression is easy.
  console.info('[openfake]', ...args)
}

const shuffle = <T,>(items: T[]): T[] => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const MAX_CACHE_SIZE = 600
const MAX_FETCH_ATTEMPTS = 2

const syntheticCacheQueue: HotOrSlopImage[] = []
const syntheticCacheIds = new Set<string>()
const realCacheQueue: HotOrSlopImage[] = []
const realCacheIds = new Set<string>()

const trimCache = (queue: HotOrSlopImage[], idSet: Set<string>) => {
  while (queue.length > MAX_CACHE_SIZE) {
    const removed = queue.shift()
    if (removed) {
      idSet.delete(removed.id)
    }
  }
}

const enqueueItems = (
  queue: HotOrSlopImage[],
  idSet: Set<string>,
  items: HotOrSlopImage[],
  label: 'synthetic' | 'real'
): number => {
  let added = 0
  items.forEach((item) => {
    if (idSet.has(item.id)) return
    idSet.add(item.id)
    queue.push(item)
    added += 1
  })
  if (added > 0) {
    trimCache(queue, idSet)
    log(`${label} cache extended`, { added, cacheSize: queue.length })
  }
  return added
}

const drawFromCache = (
  queue: HotOrSlopImage[],
  idSet: Set<string>,
  count: number,
  label: 'synthetic' | 'real'
): HotOrSlopImage[] => {
  if (count <= 0 || queue.length === 0) return []
  if (count >= queue.length) {
    const drawn = shuffle(queue)
    queue.length = 0
    drawn.forEach((item) => idSet.delete(item.id))
    log(`${label} cache depleted`, { taken: drawn.length })
    return drawn
  }

  const indices = new Set<number>()
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * queue.length))
  }

  const drawn: HotOrSlopImage[] = []
  Array.from(indices)
    .sort((a, b) => b - a)
    .forEach((index) => {
      const [item] = queue.splice(index, 1)
      if (!item) return
      idSet.delete(item.id)
      drawn.push(item)
    })

  log(`${label} cache served`, {
    requested: count,
    served: drawn.length,
    cacheRemaining: queue.length,
  })

  return drawn
}

const labelToAnswerMap: Record<string, 'ai' | 'real'> = {
  fake: 'ai',
  real: 'real',
}

const syntheticDefaultCredit = `OpenFake dataset · ${SYNTHETIC_DATASET_LICENSE}`
const realDefaultCredit = `COCO-Caption2017 dataset · ${REAL_DATASET_LICENSE}`

const ALLOWED_MODEL_PREFIXES = ['real', 'imagen', 'gpt', 'flux']

const getSyntheticRowCount = async (): Promise<number> => {
  if (cachedSyntheticRowCount !== null) return cachedSyntheticRowCount
  const params = new URLSearchParams({
    dataset: SYNTHETIC_DATASET_ID,
    config: SYNTHETIC_CONFIG,
    split: SYNTHETIC_SPLIT,
  })

  const response = await fetch(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[SYNTHETIC_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for OpenFake synthetic split')
  }
  cachedSyntheticRowCount = count
  log('Synthetic row count cached', { count })
  return count
}

const getRealRowCount = async (): Promise<number> => {
  if (cachedRealRowCount !== null) return cachedRealRowCount
  const params = new URLSearchParams({
    dataset: REAL_DATASET_ID,
    config: REAL_CONFIG,
    split: REAL_SPLIT,
  })

  const response = await fetch(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch real dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[REAL_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for COCO-Caption2017')
  }
  cachedRealRowCount = count
  log('Real row count cached', { count })
  return count
}

type FetchDeckParams = {
  count?: number
  limitPerFetch?: number
}

const fetchSyntheticRows = async (offset: number, limit: number): Promise<RowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: SYNTHETIC_DATASET_ID,
    config: SYNTHETIC_CONFIG,
    split: SYNTHETIC_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetch(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch synthetic rows: ${response.status}`)
  }
  const data = (await response.json()) as RowsResponse
  log('Fetched synthetic batch', { offset, limit, size: data.rows?.length ?? 0 })
  return data.rows ?? []
}

const fetchRealRows = async (offset: number, limit: number): Promise<CocoRowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: REAL_DATASET_ID,
    config: REAL_CONFIG,
    split: REAL_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetch(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch real rows: ${response.status}`)
  }
  const data = (await response.json()) as CocoRowsResponse
  log('Fetched real batch', { offset, limit, size: data.rows?.length ?? 0 })
  return data.rows ?? []
}

const normalisePrompt = (value?: string): string => {
  if (!value) return 'Description unavailable — see dataset cards for context.'
  const trimmed = value.trim()
  if (!trimmed) return 'Description unavailable — see dataset cards for context.'
  return trimmed
}

const buildSyntheticImage = (
  rowIdx: number,
  raw: Required<RowsResponse['rows'][number]>['row']
): HotOrSlopImage | null => {
  const src = raw.image?.src
  const label = raw.label
  if (!src || !label) return null
  if (label !== 'fake') return null
  const answer = labelToAnswerMap[label]
  if (!answer) return null

  const prompt = normalisePrompt(raw.prompt)
  const rawModel = raw.model
  if (!rawModel) return null
  const modelLower = rawModel.toLowerCase()
  const isAllowed = ALLOWED_MODEL_PREFIXES.some((prefix) => modelLower.startsWith(prefix))
  if (!isAllowed) return null

  return {
    id: `${SYNTHETIC_SPLIT}-${rowIdx}`,
    src,
    answer,
    label: label as 'fake' | 'real',
    prompt,
    model: rawModel,
    credit: syntheticDefaultCredit,
    datasetUrl: SYNTHETIC_DATASET_CARD_URL,
  }
}

const buildRealImage = (
  rowIdx: number,
  raw: Required<CocoRowsResponse['rows'][number]>['row']
): HotOrSlopImage | null => {
  const src = raw.image?.src
  if (!src) return null

  const captions = Array.isArray(raw.answer) ? raw.answer.filter((item): item is string => Boolean(item?.trim())) : []
  const caption = captions.length > 0 ? captions[0] : raw.question
  const prompt = normalisePrompt(caption)

  const identifier = raw.file_name?.trim() ? raw.file_name.trim() : `${rowIdx}`

  return {
    id: `${REAL_SPLIT}-${identifier}`,
    src,
    answer: 'real',
    label: 'real',
    prompt,
    model: 'real',
    credit: realDefaultCredit,
    datasetUrl: REAL_DATASET_CARD_URL,
  }
}

const drawSyntheticCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []

  let result = drawFromCache(syntheticCacheQueue, syntheticCacheIds, count, 'synthetic')
  if (result.length >= count) {
    return result
  }

  const totalRows = await getSyntheticRowCount()

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && result.length < count; attempt += 1) {
    const remaining = Math.max(count - result.length, 1)
    const limit = Math.min(limitPerFetch, Math.max(remaining * 2, 12))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    const rows = await fetchSyntheticRows(offset, limit)
    const images = rows
      .map((entry) => buildSyntheticImage(entry.row_idx, entry.row))
      .filter((image): image is HotOrSlopImage => image !== null)

    const added = enqueueItems(syntheticCacheQueue, syntheticCacheIds, images, 'synthetic')

    let taken = 0
    const neededAfterEnqueue = count - result.length
    if (neededAfterEnqueue > 0) {
      const topUp = drawFromCache(syntheticCacheQueue, syntheticCacheIds, neededAfterEnqueue, 'synthetic')
      taken = topUp.length
      result = result.concat(topUp)
    }

    log('Synthetic attempt complete', {
      attempt,
      requested: count,
      accumulated: result.length,
      added,
      taken,
      offset,
      limit,
      cacheRemaining: syntheticCacheQueue.length,
    })

    if (added === 0 && taken === 0) {
      break
    }
  }

  return result
}

const drawRealCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []

  let result = drawFromCache(realCacheQueue, realCacheIds, count, 'real')
  if (result.length >= count) {
    return result
  }

  const totalRows = await getRealRowCount()

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && result.length < count; attempt += 1) {
    const remaining = Math.max(count - result.length, 1)
    const limit = Math.min(limitPerFetch, Math.max(remaining * 3, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    const rows = await fetchRealRows(offset, limit)
    const images = rows
      .map((entry) => buildRealImage(entry.row_idx, entry.row))
      .filter((image): image is HotOrSlopImage => image !== null)

    const added = enqueueItems(realCacheQueue, realCacheIds, images, 'real')

    let taken = 0
    const neededAfterEnqueue = count - result.length
    if (neededAfterEnqueue > 0) {
      const topUp = drawFromCache(realCacheQueue, realCacheIds, neededAfterEnqueue, 'real')
      taken = topUp.length
      result = result.concat(topUp)
    }

    log('Real attempt complete', {
      attempt,
      requested: count,
      accumulated: result.length,
      added,
      taken,
      offset,
      limit,
      cacheRemaining: realCacheQueue.length,
    })

    if (added === 0 && taken === 0) {
      break
    }
  }

  return result
}

export const fetchOpenFakeDeck = async ({
  count = 24,
  limitPerFetch = 40,
}: FetchDeckParams = {}): Promise<HotOrSlopImage[]> => {
  const desired = Math.max(8, count)
  const targetFake = Math.ceil(desired / 2)
  const targetReal = desired - targetFake

  // Use smaller limit for faster initial response
  const fastLimit = Math.min(limitPerFetch, 20)

  log('Fetching deck', { desired, targetFake, targetReal, limitPerFetch: fastLimit })
  const [initialFake, initialReal] = await Promise.all([
    drawSyntheticCards(targetFake, fastLimit),
    drawRealCards(targetReal, fastLimit),
  ])

  let combined: HotOrSlopImage[] = [...initialFake, ...initialReal]
  let fakeCount = initialFake.length
  let realCount = initialReal.length

  log('Initial draw complete', { fakeCount, realCount, combined: combined.length })

  if (fakeCount < targetFake) {
    const neededFake = Math.min(targetFake - fakeCount, Math.max(desired - combined.length, 0))
    if (neededFake > 0) {
      const extraFake = await drawSyntheticCards(neededFake, limitPerFetch)
      combined = [...combined, ...extraFake]
      fakeCount += extraFake.length
      log('Synthetic top-up applied', { added: extraFake.length, fakeCount })
    }
  }

  if (realCount < targetReal) {
    const neededReal = Math.min(targetReal - realCount, Math.max(desired - combined.length, 0))
    if (neededReal > 0) {
      const extraReal = await drawRealCards(neededReal, limitPerFetch)
      combined = [...combined, ...extraReal]
      realCount += extraReal.length
      log('Real top-up applied', { added: extraReal.length, realCount })
    }
  }

  let shortage = desired - combined.length
  if (shortage > 0) {
    const extraSynthetic = await drawSyntheticCards(Math.ceil(shortage / 2), limitPerFetch)
    combined = [...combined, ...extraSynthetic]
    fakeCount += extraSynthetic.length
    shortage = desired - combined.length
    log('Synthetic fallback draw', { added: extraSynthetic.length, shortage })
  }

  if (shortage > 0) {
    const extraReal = await drawRealCards(shortage, limitPerFetch)
    combined = [...combined, ...extraReal]
    realCount += extraReal.length
    shortage = desired - combined.length
    log('Real fallback draw', { added: extraReal.length, shortage })
  }

  if (combined.length === 0) {
    throw new Error('OpenFake request returned no usable images')
  }

  if (combined.length < desired) {
    const finalTopUp = await drawSyntheticCards(desired - combined.length, limitPerFetch)
    combined = [...combined, ...finalTopUp]
    fakeCount += finalTopUp.length
    shortage = desired - combined.length
    log('Emergency synthetic top-up', { added: finalTopUp.length, shortage })
  }

  const finalDeck = shuffle(combined).slice(0, desired)
  const finalFake = finalDeck.filter((item) => item.label === 'fake').length
  const finalReal = finalDeck.filter((item) => item.label === 'real').length
  log('Deck ready', { final: finalDeck.length, finalFake, finalReal })
  return finalDeck
}

export const OPEN_FAKE_CONSTANTS = {
  synthetic: {
    datasetId: SYNTHETIC_DATASET_ID,
    datasetUrl: SYNTHETIC_DATASET_CARD_URL,
    license: SYNTHETIC_DATASET_LICENSE,
    credit: syntheticDefaultCredit,
  },
  real: {
    datasetId: REAL_DATASET_ID,
    datasetUrl: REAL_DATASET_CARD_URL,
    license: REAL_DATASET_LICENSE,
    credit: realDefaultCredit,
  },
}
