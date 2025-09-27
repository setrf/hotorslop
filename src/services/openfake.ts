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

const shuffle = <T,>(items: T[]): T[] => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
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

const fetchSyntheticPool = async (desired: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  const totalRows = await getSyntheticRowCount()
  const deduped = new Map<string, HotOrSlopImage>()
  const maxAttempts = 6

  for (let attempt = 0; attempt < maxAttempts && deduped.size < desired * 2; attempt += 1) {
    const remaining = Math.max(desired - deduped.size, 1)
    const limit = Math.min(limitPerFetch, Math.max(remaining * 3, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))
    const rows = await fetchSyntheticRows(offset, limit)
    rows.forEach((entry) => {
      const image = buildSyntheticImage(entry.row_idx, entry.row)
      if (!image) return
      deduped.set(image.id, image)
    })
    log('Synthetic attempt complete', {
      attempt,
      deduped: deduped.size,
      desired,
      offset,
      limit,
    })
  }

  return shuffle(Array.from(deduped.values()))
}

const fetchRealPool = async (desired: number, limitPerFetch: number): Promise<HotOrSlopImage[]> => {
  const totalRows = await getRealRowCount()
  const deduped = new Map<string, HotOrSlopImage>()
  const maxAttempts = 6

  for (let attempt = 0; attempt < maxAttempts && deduped.size < desired * 2; attempt += 1) {
    const remaining = Math.max(desired - deduped.size, 1)
    const limit = Math.min(limitPerFetch, Math.max(remaining * 3, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))
    const rows = await fetchRealRows(offset, limit)
    rows.forEach((entry) => {
      const image = buildRealImage(entry.row_idx, entry.row)
      if (!image) return
      deduped.set(image.id, image)
    })
    log('Real attempt complete', {
      attempt,
      deduped: deduped.size,
      desired,
      offset,
      limit,
    })
  }

  return shuffle(Array.from(deduped.values()))
}

export const fetchOpenFakeDeck = async ({
  count = 24,
  limitPerFetch = 60,
}: FetchDeckParams = {}): Promise<HotOrSlopImage[]> => {
  const desired = Math.max(8, count)
  const targetFake = Math.ceil(desired / 2)
  const targetReal = desired - targetFake

  log('Fetching deck', { desired, targetFake, targetReal, limitPerFetch })
  const [fakePool, realPool] = await Promise.all([
    fetchSyntheticPool(Math.max(targetFake, desired), limitPerFetch),
    fetchRealPool(Math.max(targetReal, desired), limitPerFetch),
  ])

  log('Pools ready', { fakePool: fakePool.length, realPool: realPool.length })
  if (fakePool.length === 0 && realPool.length === 0) {
    throw new Error('OpenFake request returned no usable images')
  }

  const fakeSelection = fakePool.slice(0, targetFake)
  const realSelection = realPool.slice(0, targetReal)

  let combined: HotOrSlopImage[] = [...fakeSelection, ...realSelection]
  log('Initial selection', { combined: combined.length })

  if (combined.length < desired) {
    const fallbackPool = shuffle([
      ...fakePool.slice(targetFake),
      ...realPool.slice(targetReal),
    ])
    combined = [...combined, ...fallbackPool.slice(0, desired - combined.length)]
    log('Applied fallback pool', { combined: combined.length })
  }

  if (combined.length < desired) {
    const emergencyPool = shuffle([...fakePool, ...realPool])
    combined = emergencyPool.slice(0, desired)
    log('Applied emergency pool', { combined: combined.length })
  }

  const finalDeck = shuffle(combined).slice(0, desired)
  log('Deck ready', { final: finalDeck.length })
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
