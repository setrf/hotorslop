const HF_API_BASE = 'https://datasets-server.huggingface.co'

// Original dataset broken on 2025-12-22, using working fork
const SYNTHETIC_DATASET_ID = 'Anonymous460/OpenFake'
const SYNTHETIC_CONFIG = 'default'
const SYNTHETIC_SPLIT = 'test'
const SYNTHETIC_DATASET_CARD_URL = `https://huggingface.co/datasets/${SYNTHETIC_DATASET_ID}`
const SYNTHETIC_DATASET_LICENSE = 'CC BY-SA 4.0'

// Nano-Banana dataset (Google Gemini 2.5 Flash generated images)
const NANOBANANA_DATASET_ID = 'bitmind/nano-banana'
const NANOBANANA_CONFIG = 'default'
const NANOBANANA_SPLIT = 'train'
const NANOBANANA_DATASET_CARD_URL = `https://huggingface.co/datasets/${NANOBANANA_DATASET_ID}`
const NANOBANANA_DATASET_LICENSE = 'MIT'
const NANOBANANA_MODEL_NAME = 'gemini-2.5-flash'

const REAL_DATASET_ID = 'lmms-lab/COCO-Caption2017'
const REAL_CONFIG = 'default'
const REAL_SPLIT = 'val'
const REAL_DATASET_CARD_URL = `https://huggingface.co/datasets/${REAL_DATASET_ID}`
const REAL_DATASET_LICENSE = 'CC BY 4.0'

// Rapidata datasets (AI model comparison benchmarks - we extract individual images)
const RAPIDATA_DATASETS = [
  { id: 'Rapidata/Flux-2-pro_t2i_human_preference', rows: 44857 },
  { id: 'Rapidata/Seedream-3_t2i_human_preference', rows: 60030 },
  { id: 'Rapidata/Imagen-4-ultra-24-7-25_t2i_human_preference', rows: 55876 },
  { id: 'Rapidata/Recraft-v3-24-7-25_t2i_human_preference', rows: 65931 },
] as const
const RAPIDATA_LICENSE = 'CDLA-Permissive-2.0'
const RAPIDATA_CREDIT = `Rapidata benchmark · ${RAPIDATA_LICENSE}`

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

type NanoBananaRowsResponse = {
  rows: Array<{
    row_idx: number
    row: {
      id?: number
      image?: {
        src?: string
        width?: number
        height?: number
      }
      format?: string
      mode?: string
      width?: number
      height?: number
      uploadtime?: string
    }
  }>
}

type RapidataRowsResponse = {
  rows: Array<{
    row_idx: number
    row: {
      prompt?: string
      image1?: { src?: string }
      image2?: { src?: string }
      model1?: string
      model2?: string
    }
  }>
}

// Hardcoded row counts - eliminates 4 info API calls on initial load
// These values are stable and only need occasional verification
const HARDCODED_ROW_COUNTS = {
  synthetic: 27543,   // OpenFake synthetic split
  real: 40504,        // COCO-Caption2017 val split
  nanoBanana: 9457,   // Nano-Banana train split
}

let cachedSyntheticRowCount: number | null = HARDCODED_ROW_COUNTS.synthetic
let cachedRealRowCount: number | null = HARDCODED_ROW_COUNTS.real
let cachedNanoBananaRowCount: number | null = HARDCODED_ROW_COUNTS.nanoBanana

const log = (...args: unknown[]) => {
  // Centralised logging so future suppression is easy.
  console.info('[openfake]', ...args)
}

// Allowed image URL hosts for security
const ALLOWED_IMAGE_HOSTS = [
  'huggingface.co',
  'datasets-server.huggingface.co',
  'cdn-lfs.hf.co',
  'cdn-lfs-us-1.hf.co',
  'cdn-lfs.huggingface.co',
]

const isValidImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return ALLOWED_IMAGE_HOSTS.some(
      host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    )
  } catch {
    return false
  }
}

// Fetch with timeout to prevent hanging requests
const fetchWithTimeout = async (url: string, timeoutMs = 30000): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`)
    }
    throw error
  }
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
const nanoBananaCacheQueue: HotOrSlopImage[] = []
const nanoBananaCacheIds = new Set<string>()
const openFakeRealCacheQueue: HotOrSlopImage[] = []
const openFakeRealCacheIds = new Set<string>()
const rapidataCacheQueue: HotOrSlopImage[] = []
const rapidataCacheIds = new Set<string>()

// Track which Rapidata dataset to use next (round-robin for fair sampling)
let rapidataDatasetIndex = 0

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
const nanoBananaDefaultCredit = `Nano-Banana dataset · ${NANOBANANA_DATASET_LICENSE}`
const openFakeRealDefaultCredit = `OpenFake dataset (real) · ${SYNTHETIC_DATASET_LICENSE}`

const ALLOWED_MODEL_PREFIXES = ['real', 'imagen', 'gpt', 'flux']

const EXCLUDED_MODELS = [
  'gpt-image-1',
  'flux.1-schnell',
  'imagen-3.0-002',
  'imagen-4.0',
  'flux.1-dev'
]

const getSyntheticRowCount = async (): Promise<number> => {
  if (cachedSyntheticRowCount !== null) return cachedSyntheticRowCount
  const params = new URLSearchParams({
    dataset: SYNTHETIC_DATASET_ID,
    config: SYNTHETIC_CONFIG,
    split: SYNTHETIC_SPLIT,
  })

  const response = await fetchWithTimeout(`${HF_API_BASE}/info?${params.toString()}`)
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

  const response = await fetchWithTimeout(`${HF_API_BASE}/info?${params.toString()}`)
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

const getNanoBananaRowCount = async (): Promise<number> => {
  if (cachedNanoBananaRowCount !== null) return cachedNanoBananaRowCount
  const params = new URLSearchParams({
    dataset: NANOBANANA_DATASET_ID,
    config: NANOBANANA_CONFIG,
    split: NANOBANANA_SPLIT,
  })

  const response = await fetchWithTimeout(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch nano-banana dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[NANOBANANA_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for bitmind/nano-banana')
  }
  cachedNanoBananaRowCount = count
  log('Nano-Banana row count cached', { count })
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

  const response = await fetchWithTimeout(`${HF_API_BASE}/rows?${params.toString()}`)
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

  const response = await fetchWithTimeout(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch real rows: ${response.status}`)
  }
  const data = (await response.json()) as CocoRowsResponse
  log('Fetched real batch', { offset, limit, size: data.rows?.length ?? 0 })
  return data.rows ?? []
}

const fetchNanoBananaRows = async (offset: number, limit: number): Promise<NanoBananaRowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: NANOBANANA_DATASET_ID,
    config: NANOBANANA_CONFIG,
    split: NANOBANANA_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetchWithTimeout(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch nano-banana rows: ${response.status}`)
  }
  const data = (await response.json()) as NanoBananaRowsResponse
  log('Fetched nano-banana batch', { offset, limit, size: data.rows?.length ?? 0 })
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
  if (!isValidImageUrl(src)) return null
  if (label !== 'fake') return null
  const answer = labelToAnswerMap[label]
  if (!answer) return null

  const prompt = normalisePrompt(raw.prompt)
  const rawModel = raw.model
  if (!rawModel) return null
  const modelLower = rawModel.toLowerCase()

  // Check if model is excluded
  if (EXCLUDED_MODELS.includes(rawModel)) return null

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
  if (!isValidImageUrl(src)) return null

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

const buildOpenFakeRealImage = (
  rowIdx: number,
  raw: Required<RowsResponse['rows'][number]>['row']
): HotOrSlopImage | null => {
  const src = raw.image?.src
  const label = raw.label
  if (!src || !label) return null
  if (!isValidImageUrl(src)) return null
  // Only accept real images from OpenFake
  if (label !== 'real') return null

  const prompt = normalisePrompt(raw.prompt)

  return {
    id: `openfake-real-${rowIdx}`,
    src,
    answer: 'real',
    label: 'real',
    prompt,
    model: 'real',
    credit: openFakeRealDefaultCredit,
    datasetUrl: SYNTHETIC_DATASET_CARD_URL,
  }
}

const buildNanoBananaImage = (
  rowIdx: number,
  raw: Required<NanoBananaRowsResponse['rows'][number]>['row']
): HotOrSlopImage | null => {
  const src = raw.image?.src
  if (!src) return null
  if (!isValidImageUrl(src)) return null

  const identifier = raw.id !== undefined ? `${raw.id}` : `${rowIdx}`

  return {
    id: `nanobanana-${identifier}`,
    src,
    answer: 'ai',
    label: 'fake',
    prompt: 'AI-generated image from Nano-Banana dataset.',
    model: NANOBANANA_MODEL_NAME,
    credit: nanoBananaDefaultCredit,
    datasetUrl: NANOBANANA_DATASET_CARD_URL,
  }
}

const drawNanoBananaCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []

  let result = drawFromCache(nanoBananaCacheQueue, nanoBananaCacheIds, count, 'synthetic')
  if (result.length >= count) {
    return result
  }

  const totalRows = await getNanoBananaRowCount()

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && result.length < count; attempt += 1) {
    const remaining = Math.max(count - result.length, 1)
    const limit = Math.min(limitPerFetch, Math.max(remaining * 2, 12))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    const rows = await fetchNanoBananaRows(offset, limit)
    const images = rows
      .map((entry) => buildNanoBananaImage(entry.row_idx, entry.row))
      .filter((image): image is HotOrSlopImage => image !== null)

    const added = enqueueItems(nanoBananaCacheQueue, nanoBananaCacheIds, images, 'synthetic')

    let taken = 0
    const neededAfterEnqueue = count - result.length
    if (neededAfterEnqueue > 0) {
      const topUp = drawFromCache(nanoBananaCacheQueue, nanoBananaCacheIds, neededAfterEnqueue, 'synthetic')
      taken = topUp.length
      result = result.concat(topUp)
    }

    log('Nano-Banana attempt complete', {
      attempt,
      requested: count,
      accumulated: result.length,
      added,
      taken,
      offset,
      limit,
      cacheRemaining: nanoBananaCacheQueue.length,
    })

    if (added === 0 && taken === 0) {
      break
    }
  }

  return result
}

const drawSyntheticCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []
  let result = drawFromCache(syntheticCacheQueue, syntheticCacheIds, count, 'synthetic')
  if (result.length >= count) return result
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
    if (added === 0 && taken === 0) break
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

const drawOpenFakeRealCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []

  let result = drawFromCache(openFakeRealCacheQueue, openFakeRealCacheIds, count, 'real')
  if (result.length >= count) {
    return result
  }

  const totalRows = await getSyntheticRowCount()

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && result.length < count; attempt += 1) {
    const remaining = Math.max(count - result.length, 1)
    // Request more since only ~50% of rows are 'real' labeled
    const limit = Math.min(limitPerFetch, Math.max(remaining * 4, 30))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    const rows = await fetchSyntheticRows(offset, limit)
    const images = rows
      .map((entry) => buildOpenFakeRealImage(entry.row_idx, entry.row))
      .filter((image): image is HotOrSlopImage => image !== null)

    const added = enqueueItems(openFakeRealCacheQueue, openFakeRealCacheIds, images, 'real')

    let taken = 0
    const neededAfterEnqueue = count - result.length
    if (neededAfterEnqueue > 0) {
      const topUp = drawFromCache(openFakeRealCacheQueue, openFakeRealCacheIds, neededAfterEnqueue, 'real')
      taken = topUp.length
      result = result.concat(topUp)
    }

    log('OpenFake real attempt complete', {
      attempt,
      requested: count,
      accumulated: result.length,
      added,
      taken,
      offset,
      limit,
      cacheRemaining: openFakeRealCacheQueue.length,
    })

    if (added === 0 && taken === 0) {
      break
    }
  }

  return result
}

const fetchRapidataRows = async (datasetId: string, offset: number, limit: number): Promise<RapidataRowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: datasetId,
    config: 'default',
    split: 'train',
    offset: offset.toString(),
    limit: limit.toString(),
  })
  const response = await fetchWithTimeout(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) throw new Error(`Failed to fetch Rapidata rows: ${response.status}`)
  const data = (await response.json()) as RapidataRowsResponse
  log('Fetched Rapidata batch', { dataset: datasetId, offset, limit, size: data.rows?.length ?? 0 })
  return data.rows ?? []
}

const buildRapidataImages = (
  datasetId: string,
  rowIdx: number,
  row: RapidataRowsResponse['rows'][number]['row']
): HotOrSlopImage[] => {
  const results: HotOrSlopImage[] = []
  const prompt = normalisePrompt(row.prompt)

  // Extract image1
  if (row.image1?.src && row.model1 && isValidImageUrl(row.image1.src)) {
    results.push({
      id: `rapidata-${datasetId.split('/')[1]}-${rowIdx}-1`,
      src: row.image1.src,
      answer: 'ai',
      label: 'fake',
      prompt,
      model: row.model1,
      credit: RAPIDATA_CREDIT,
      datasetUrl: `https://huggingface.co/datasets/${datasetId}`,
    })
  }

  // Extract image2
  if (row.image2?.src && row.model2 && isValidImageUrl(row.image2.src)) {
    results.push({
      id: `rapidata-${datasetId.split('/')[1]}-${rowIdx}-2`,
      src: row.image2.src,
      answer: 'ai',
      label: 'fake',
      prompt,
      model: row.model2,
      credit: RAPIDATA_CREDIT,
      datasetUrl: `https://huggingface.co/datasets/${datasetId}`,
    })
  }

  return results
}

const drawRapidataCards = async (count: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  if (count <= 0) return []

  let result = drawFromCache(rapidataCacheQueue, rapidataCacheIds, count, 'synthetic')
  if (result.length >= count) return result

  // Use round-robin to ensure fair sampling across all Rapidata datasets
  const dataset = RAPIDATA_DATASETS[rapidataDatasetIndex]
  rapidataDatasetIndex = (rapidataDatasetIndex + 1) % RAPIDATA_DATASETS.length
  const totalRows = dataset.rows

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && result.length < count; attempt += 1) {
    const limit = Math.min(limitPerFetch, 20)
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    const rows = await fetchRapidataRows(dataset.id, offset, limit)
    const images = rows.flatMap((entry) => buildRapidataImages(dataset.id, entry.row_idx, entry.row))

    const added = enqueueItems(rapidataCacheQueue, rapidataCacheIds, images, 'synthetic')

    const neededAfterEnqueue = count - result.length
    if (neededAfterEnqueue > 0) {
      const topUp = drawFromCache(rapidataCacheQueue, rapidataCacheIds, neededAfterEnqueue, 'synthetic')
      result = result.concat(topUp)
    }

    log('Rapidata attempt complete', {
      attempt,
      dataset: dataset.id,
      requested: count,
      accumulated: result.length,
      added,
      cacheRemaining: rapidataCacheQueue.length,
    })

    if (added === 0) break
  }

  return result
}

// Quick fetch for progressive loading - gets minimum viable deck fast
export const fetchQuickDeck = async (count = 4): Promise<HotOrSlopImage[]> => {
  const targetFake = Math.ceil(count / 2)
  const targetReal = count - targetFake

  log('Quick fetch starting', { count, targetFake, targetReal })

  // Only fetch from 2 sources (1 synthetic, 1 real) for speed
  const [synthetic, real] = await Promise.all([
    drawSyntheticCards(targetFake, 12),
    drawRealCards(targetReal, 12),
  ])

  const combined = shuffle([...synthetic, ...real])
  log('Quick fetch complete', { synthetic: synthetic.length, real: real.length })

  return combined.slice(0, count)
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

  // Split fake images evenly: OpenFake (~33%), Nano-Banana (~33%), Rapidata (~34%)
  const targetOpenFake = Math.ceil(targetFake * 0.33)
  const targetNanoBanana = Math.ceil(targetFake * 0.33)
  const targetRapidata = targetFake - targetOpenFake - targetNanoBanana

  // Split real images between COCO (~60%) and OpenFake real (~40%)
  const targetCocoReal = Math.ceil(targetReal * 0.6)
  const targetOpenFakeReal = targetReal - targetCocoReal

  log('Fetching deck', {
    desired,
    targetFake,
    targetOpenFake,
    targetNanoBanana,
    targetRapidata,
    targetReal,
    targetCocoReal,
    targetOpenFakeReal,
    limitPerFetch: fastLimit,
  })

  const [initialOpenFake, initialNanoBanana, initialRapidata, initialCocoReal, initialOpenFakeReal] = await Promise.all([
    drawSyntheticCards(targetOpenFake, fastLimit),
    drawNanoBananaCards(targetNanoBanana, fastLimit),
    drawRapidataCards(targetRapidata, fastLimit),
    drawRealCards(targetCocoReal, fastLimit),
    drawOpenFakeRealCards(targetOpenFakeReal, fastLimit),
  ])

  let combined: HotOrSlopImage[] = [...initialOpenFake, ...initialNanoBanana, ...initialRapidata, ...initialCocoReal, ...initialOpenFakeReal]
  let fakeCount = initialOpenFake.length + initialNanoBanana.length + initialRapidata.length
  let realCount = initialCocoReal.length + initialOpenFakeReal.length

  log('Initial draw complete', {
    openFake: initialOpenFake.length,
    nanoBanana: initialNanoBanana.length,
    rapidata: initialRapidata.length,
    cocoReal: initialCocoReal.length,
    openFakeReal: initialOpenFakeReal.length,
    fakeCount,
    realCount,
    combined: combined.length,
  })

  if (fakeCount < targetFake) {
    const neededFake = Math.min(targetFake - fakeCount, Math.max(desired - combined.length, 0))
    if (neededFake > 0) {
      // Try Rapidata first, then nano-banana, then OpenFake for variety
      const extraRapidata = await drawRapidataCards(Math.ceil(neededFake / 3), limitPerFetch)
      combined = [...combined, ...extraRapidata]
      fakeCount += extraRapidata.length
      log('Rapidata top-up applied', { added: extraRapidata.length, fakeCount })

      let stillNeeded = targetFake - fakeCount
      if (stillNeeded > 0) {
        const extraNanoBanana = await drawNanoBananaCards(Math.ceil(stillNeeded / 2), limitPerFetch)
        combined = [...combined, ...extraNanoBanana]
        fakeCount += extraNanoBanana.length
        log('Nano-Banana top-up applied', { added: extraNanoBanana.length, fakeCount })
      }

      stillNeeded = targetFake - fakeCount
      if (stillNeeded > 0) {
        const extraOpenFake = await drawSyntheticCards(stillNeeded, limitPerFetch)
        combined = [...combined, ...extraOpenFake]
        fakeCount += extraOpenFake.length
        log('Synthetic top-up applied', { added: extraOpenFake.length, fakeCount })
      }
    }
  }

  if (realCount < targetReal) {
    const neededReal = Math.min(targetReal - realCount, Math.max(desired - combined.length, 0))
    if (neededReal > 0) {
      // Try OpenFake real first for variety, then fall back to COCO
      const extraOpenFakeReal = await drawOpenFakeRealCards(Math.ceil(neededReal / 2), limitPerFetch)
      combined = [...combined, ...extraOpenFakeReal]
      realCount += extraOpenFakeReal.length
      log('OpenFake real top-up applied', { added: extraOpenFakeReal.length, realCount })

      const stillNeededReal = targetReal - realCount
      if (stillNeededReal > 0) {
        const extraCocoReal = await drawRealCards(stillNeededReal, limitPerFetch)
        combined = [...combined, ...extraCocoReal]
        realCount += extraCocoReal.length
        log('COCO real top-up applied', { added: extraCocoReal.length, realCount })
      }
    }
  }

  let shortage = desired - combined.length
  if (shortage > 0) {
    const extraRapidata = await drawRapidataCards(Math.ceil(shortage / 4), limitPerFetch)
    combined = [...combined, ...extraRapidata]
    fakeCount += extraRapidata.length
    shortage = desired - combined.length
    log('Rapidata fallback draw', { added: extraRapidata.length, shortage })
  }

  if (shortage > 0) {
    const extraNanoBanana = await drawNanoBananaCards(Math.ceil(shortage / 3), limitPerFetch)
    combined = [...combined, ...extraNanoBanana]
    fakeCount += extraNanoBanana.length
    shortage = desired - combined.length
    log('Nano-Banana fallback draw', { added: extraNanoBanana.length, shortage })
  }

  if (shortage > 0) {
    const extraSynthetic = await drawSyntheticCards(Math.ceil(shortage / 2), limitPerFetch)
    combined = [...combined, ...extraSynthetic]
    fakeCount += extraSynthetic.length
    shortage = desired - combined.length
    log('Synthetic fallback draw', { added: extraSynthetic.length, shortage })
  }

  if (shortage > 0) {
    const extraOpenFakeReal = await drawOpenFakeRealCards(Math.ceil(shortage / 2), limitPerFetch)
    combined = [...combined, ...extraOpenFakeReal]
    realCount += extraOpenFakeReal.length
    shortage = desired - combined.length
    log('OpenFake real fallback draw', { added: extraOpenFakeReal.length, shortage })
  }

  if (shortage > 0) {
    const extraReal = await drawRealCards(shortage, limitPerFetch)
    combined = [...combined, ...extraReal]
    realCount += extraReal.length
    shortage = desired - combined.length
    log('COCO real fallback draw', { added: extraReal.length, shortage })
  }

  if (combined.length === 0) {
    throw new Error('Could not fetch images from datasets')
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
  nanoBanana: {
    datasetId: NANOBANANA_DATASET_ID,
    datasetUrl: NANOBANANA_DATASET_CARD_URL,
    license: NANOBANANA_DATASET_LICENSE,
    model: NANOBANANA_MODEL_NAME,
    credit: nanoBananaDefaultCredit,
  },
  real: {
    datasetId: REAL_DATASET_ID,
    datasetUrl: REAL_DATASET_CARD_URL,
    license: REAL_DATASET_LICENSE,
    credit: realDefaultCredit,
  },
  openFakeReal: {
    datasetId: SYNTHETIC_DATASET_ID,
    datasetUrl: SYNTHETIC_DATASET_CARD_URL,
    license: SYNTHETIC_DATASET_LICENSE,
    credit: openFakeRealDefaultCredit,
  },
  rapidata: {
    datasets: RAPIDATA_DATASETS.map((d) => d.id),
    license: RAPIDATA_LICENSE,
    credit: RAPIDATA_CREDIT,
  },
}
