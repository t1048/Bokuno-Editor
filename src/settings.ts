import { load } from '@tauri-apps/plugin-store'
import { isTauri } from '@tauri-apps/api/core'

export type Theme = 'light' | 'dark'

export interface AppSettings {
  theme: Theme
  fontSize: number
  encoding: string
  lineEnding: string
  showLineEndingMarkers: boolean
  sidebarWidth: number
  recentFiles: string[]
  lastWorkspace: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 14,
  encoding: 'auto',
  lineEnding: 'CRLF',
  showLineEndingMarkers: false,
  sidebarWidth: 250,
  recentFiles: [],
  lastWorkspace: '',
}

const STORE_FILE = 'settings.json'
const MAX_RECENT_FILES = 10

let storePromise: ReturnType<typeof load> | null = null

async function getStore() {
  if (!isTauri()) return null
  if (!storePromise) {
    storePromise = load(STORE_FILE, { defaults: {}, autoSave: false })
  }
  return storePromise
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const store = await getStore()
    if (!store) return { ...DEFAULT_SETTINGS }

    const entries = await store.entries<string>()
    const merged = { ...DEFAULT_SETTINGS }
    for (const [key, value] of entries) {
      if (key in merged) {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    const store = await getStore()
    if (!store) return

    for (const [key, value] of Object.entries(settings)) {
      await store.set(key, value)
    }
    await store.save()
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}

export function addRecentFile(recentFiles: string[], filePath: string): string[] {
  const normalized = filePath.trim()
  if (!normalized) return recentFiles

  const filtered = recentFiles.filter((p) => p !== normalized)
  return [normalized, ...filtered].slice(0, MAX_RECENT_FILES)
}
