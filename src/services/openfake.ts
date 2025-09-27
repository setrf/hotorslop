const HF_API_BASE = 'https://datasets-server.huggingface.co'

// OpenFake dataset (for AI images)
const OPENFAKE_DATASET_ID = 'ComplexDataLab/OpenFake'
const OPENFAKE_CONFIG = 'default'
const OPENFAKE_SPLIT = 'test'
const OPENFAKE_DATASET_CARD_URL = `https://huggingface.co/datasets/${OPENFAKE_DATASET_ID}`
const OPENFAKE_LICENSE = 'CC BY-SA 4.0'

// COCO dataset (for real images)
const COCO_DATASET_ID = 'lmms-lab/COCO-Caption2017'
const COCO_CONFIG = 'default'
const COCO_SPLIT = 'train'
const COCO_DATASET_CARD_URL = `https://huggingface.co/datasets/${COCO_DATASET_ID}`
const COCO_LICENSE = 'CC BY 4.0'

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

// Separate caches for each dataset
let openFakeRowCount: number | null = null
let cocoRowCount: number | null = null

const labelToAnswerMap: Record<string, 'ai' | 'real'> = {
  fake: 'ai',
  real: 'real',
}

const ALLOWED_MODEL_PREFIXES = ['imagen', 'gpt', 'flux'] // Removed 'real' since we get real images from COCO

// Get row count for OpenFake dataset (AI images)
const getOpenFakeRowCount = async (): Promise<number> => {
  if (openFakeRowCount !== null) return openFakeRowCount
  const params = new URLSearchParams({
    dataset: OPENFAKE_DATASET_ID,
    config: OPENFAKE_CONFIG,
    split: OPENFAKE_SPLIT,
  })

  const response = await fetch(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenFake dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[OPENFAKE_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for OpenFake')
  }
  openFakeRowCount = count
  return count
}

// Get row count for COCO dataset (real images)
const getCocoRowCount = async (): Promise<number> => {
  if (cocoRowCount !== null) return cocoRowCount
  const params = new URLSearchParams({
    dataset: COCO_DATASET_ID,
    config: COCO_CONFIG,
    split: COCO_SPLIT,
  })

  const response = await fetch(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch COCO dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[COCO_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for COCO')
  }
  cocoRowCount = count
  return count
}

type FetchDeckParams = {
  count?: number
  limitPerFetch?: number
}

// Fetch rows from OpenFake dataset (AI images)
const fetchOpenFakeRows = async (offset: number, limit: number): Promise<RowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: OPENFAKE_DATASET_ID,
    config: OPENFAKE_CONFIG,
    split: OPENFAKE_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetch(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenFake rows: ${response.status}`)
  }
  const data = (await response.json()) as RowsResponse
  return data.rows ?? []
}

// Fetch rows from COCO dataset (real images)
const fetchCocoRows = async (offset: number, limit: number): Promise<any[]> => {
  const params = new URLSearchParams({
    dataset: COCO_DATASET_ID,
    config: COCO_CONFIG,
    split: COCO_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetch(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch COCO rows: ${response.status}`)
  }
  const data = await response.json()
  return data.rows ?? []
}

const normalisePrompt = (value?: string): string => {
  if (!value) return 'Prompt unavailable — see dataset card for context.'
  return value.trim()
}

// Build image from OpenFake dataset (AI images)
const buildOpenFakeImage = (rowIdx: number, raw: Required<RowsResponse['rows'][number]>['row']): HotOrSlopImage | null => {
  const src = raw.image?.src
  const label = raw.label
  if (!src || !label) return null
  const answer = labelToAnswerMap[label]
  if (!answer) return null

  const prompt = normalisePrompt(raw.prompt)
  const rawModel = raw.model ?? (label === 'real' ? 'real' : null)
  if (!rawModel) return null
  const modelLower = rawModel.toLowerCase()
  const isAllowed = ALLOWED_MODEL_PREFIXES.some((prefix) => modelLower.startsWith(prefix))
  if (!isAllowed) return null

  return {
    id: `${OPENFAKE_SPLIT}-${rowIdx}`,
    src,
    answer,
    label: label as 'fake' | 'real',
    prompt,
    model: rawModel,
    credit: `OpenFake dataset · ${OPENFAKE_LICENSE}`,
    datasetUrl: OPENFAKE_DATASET_CARD_URL,
  }
}

// Build image from COCO dataset (real images)
const buildCocoImage = (rowIdx: number, raw: any): HotOrSlopImage | null => {
  const src = raw.image?.src || raw.image?.url
  if (!src) return null

  // COCO images are all real
  const prompt = normalisePrompt(raw.caption || raw.text || 'Real image from COCO dataset')

  return {
    id: `${COCO_SPLIT}-real-${rowIdx}`,
    src,
    answer: 'real',
    label: 'real',
    prompt,
    model: 'real',
    credit: `COCO-Caption2017 dataset · ${COCO_LICENSE}`,
    datasetUrl: COCO_DATASET_CARD_URL,
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

export const fetchOpenFakeDeck = async ({
  count = 24,
  limitPerFetch = 60,
}: FetchDeckParams = {}): Promise<HotOrSlopImage[]> => {
  const desired = Math.max(8, count)
  const targetFake = Math.ceil(desired / 2)
  const targetReal = Math.floor(desired / 2)

  // Fetch AI images from OpenFake dataset
  const fakeImages = await fetchFakeImages(targetFake, limitPerFetch)

  // Fetch real images from COCO dataset
  const realImages = await fetchRealImages(targetReal, limitPerFetch)

  const combinedImages = [...fakeImages, ...realImages]

  if (combinedImages.length === 0) {
    throw new Error('No images could be fetched from either dataset')
  }

  return shuffle(combinedImages)
}

// Fetch AI-generated images from OpenFake dataset
async function fetchFakeImages(targetCount: number, limitPerFetch: number): Promise<HotOrSlopImage[]> {
  const totalRows = await getOpenFakeRowCount()
  const deduped = new Map<string, HotOrSlopImage>()

  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts && deduped.size < targetCount; attempt += 1) {
    const remaining = targetCount - deduped.size
    const limit = Math.min(limitPerFetch, Math.max(remaining * 2, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    try {
      const rows = await fetchOpenFakeRows(offset, limit)
      rows.forEach((entry) => {
        const image = buildOpenFakeImage(entry.row_idx, entry.row)
        if (image && image.label === 'fake') {
          deduped.set(image.id, image)
        }
      })
    } catch (error) {
      console.warn('Failed to fetch from OpenFake dataset:', error)
    }
  }

  return Array.from(deduped.values()).slice(0, targetCount)
}

// Fetch real images from COCO dataset
async function fetchRealImages(targetCount: number, limitPerFetch: number): Promise<HotOrSlopImage[]> {
  const totalRows = await getCocoRowCount()
  const deduped = new Map<string, HotOrSlopImage>()

  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts && deduped.size < targetCount; attempt += 1) {
    const remaining = targetCount - deduped.size
    const limit = Math.min(limitPerFetch, Math.max(remaining * 2, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))

    try {
      const rows = await fetchCocoRows(offset, limit)
      rows.forEach((entry, index) => {
        const image = buildCocoImage(offset + index, entry.row)
        if (image) {
          deduped.set(image.id, image)
        }
      })
    } catch (error) {
      console.warn('Failed to fetch from COCO dataset:', error)
    }
  }

  return Array.from(deduped.values()).slice(0, targetCount)
}

export const OPEN_FAKE_CONSTANTS = {
  // Primary dataset for AI images
  aiDatasetId: OPENFAKE_DATASET_ID,
  aiDatasetUrl: OPENFAKE_DATASET_CARD_URL,
  aiLicense: OPENFAKE_LICENSE,
  // Secondary dataset for real images
  realDatasetId: COCO_DATASET_ID,
  realDatasetUrl: COCO_DATASET_CARD_URL,
  realLicense: COCO_LICENSE,
}
