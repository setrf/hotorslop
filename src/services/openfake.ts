const HF_DATASET_ID = 'ComplexDataLab/OpenFake'
const HF_CONFIG = 'default'
const HF_SPLIT = 'test'
const HF_API_BASE = 'https://datasets-server.huggingface.co'
const HF_DATASET_CARD_URL = `https://huggingface.co/datasets/${HF_DATASET_ID}`
const HF_DATASET_LICENSE = 'CC BY-SA 4.0'

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

let cachedRowCount: number | null = null

const labelToAnswerMap: Record<string, 'ai' | 'real'> = {
  fake: 'ai',
  real: 'real',
}

const defaultCredit = `OpenFake dataset · ${HF_DATASET_LICENSE}`

const ALLOWED_MODEL_PREFIXES = ['real', 'imagen', 'gpt', 'flux']

const getRowCount = async (): Promise<number> => {
  if (cachedRowCount !== null) return cachedRowCount
  const params = new URLSearchParams({
    dataset: HF_DATASET_ID,
    config: HF_CONFIG,
    split: HF_SPLIT,
  })

  const response = await fetch(`${HF_API_BASE}/info?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset info: ${response.status}`)
  }
  const json = (await response.json()) as DatasetInfoResponse
  const count = json.dataset_info?.splits?.[HF_SPLIT]?.num_examples
  if (!count || Number.isNaN(count)) {
    throw new Error('Unable to determine dataset size for OpenFake')
  }
  cachedRowCount = count
  return count
}

type FetchDeckParams = {
  count?: number
  limitPerFetch?: number
}

const fetchRows = async (offset: number, limit: number): Promise<RowsResponse['rows']> => {
  const params = new URLSearchParams({
    dataset: HF_DATASET_ID,
    config: HF_CONFIG,
    split: HF_SPLIT,
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const response = await fetch(`${HF_API_BASE}/rows?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch rows: ${response.status}`)
  }
  const data = (await response.json()) as RowsResponse
  return data.rows ?? []
}

const normalisePrompt = (value?: string): string => {
  if (!value) return 'Prompt unavailable — see dataset card for context.'
  return value.trim()
}

const buildImage = (rowIdx: number, raw: Required<RowsResponse['rows'][number]>['row']): HotOrSlopImage | null => {
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
    id: `${HF_SPLIT}-${rowIdx}`,
    src,
    answer,
    label: label as 'fake' | 'real',
    prompt,
    model: rawModel,
    credit: defaultCredit,
    datasetUrl: HF_DATASET_CARD_URL,
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
  const totalRows = await getRowCount()
  const desired = Math.max(8, count)
  const deduped = new Map<string, HotOrSlopImage>()

  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts && deduped.size < desired; attempt += 1) {
    const remaining = desired - deduped.size
    const limit = Math.min(limitPerFetch, Math.max(remaining * 2, 20))
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))
    const rows = await fetchRows(offset, limit)
    rows.forEach((entry) => {
      const rowIdx = entry.row_idx
      const image = buildImage(rowIdx, entry.row)
      if (!image) return
      deduped.set(image.id, image)
    })
  }

  if (deduped.size === 0) {
    throw new Error('OpenFake request returned no usable images')
  }

  const pool = Array.from(deduped.values())

  const labels = new Set(pool.map((item) => item.label))
  if (labels.size < 2 && pool.length < desired * 2) {
    // attempt one more fetch to diversify labels
    const limit = Math.min(limitPerFetch, desired * 2)
    const maxOffset = Math.max(totalRows - limit, 0)
    const offset = Math.floor(Math.random() * (maxOffset + 1))
    const extraRows = await fetchRows(offset, limit)
    extraRows.forEach((entry) => {
      const image = buildImage(entry.row_idx, entry.row)
      if (!image) return
      deduped.set(image.id, image)
    })
  }

  const finalPool = Array.from(deduped.values())
  if (finalPool.length < desired) {
    return shuffle(finalPool)
  }

  const fakePool = shuffle(finalPool.filter((item) => item.label === 'fake'))
  const realPool = shuffle(finalPool.filter((item) => item.label === 'real'))
  const targetFake = Math.ceil(desired / 2)
  const targetReal = Math.floor(desired / 2)

  if (fakePool.length < targetFake || realPool.length < targetReal) {
    return shuffle(finalPool).slice(0, desired)
  }

  const result: HotOrSlopImage[] = [
    ...fakePool.slice(0, targetFake),
    ...realPool.slice(0, targetReal),
  ]

  if (result.length < desired) {
    const remaining = finalPool.filter((item) => !result.includes(item))
    result.push(...remaining.slice(0, desired - result.length))
  }

  return shuffle(result).slice(0, desired)
}

export const OPEN_FAKE_CONSTANTS = {
  datasetId: HF_DATASET_ID,
  datasetUrl: HF_DATASET_CARD_URL,
  license: HF_DATASET_LICENSE,
}
