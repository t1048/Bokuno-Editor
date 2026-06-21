export type LineEndingKind = 'CRLF' | 'LF' | 'CR'

export interface LineEndingStats {
  crlfCount: number
  crCount: number
  lfCount: number
  hasMixed: boolean
  dominant: LineEndingKind
}

export const getLineEndingStats = (content: string): LineEndingStats => {
  const crlfCount = (content.match(/\r\n/g) || []).length
  const crCount = (content.match(/\r/g) || []).length - crlfCount
  const lfCount = (content.match(/\n/g) || []).length - crlfCount
  const kinds = Number(crlfCount > 0) + Number(crCount > 0) + Number(lfCount > 0)
  const hasMixed = kinds > 1

  let dominant: LineEndingKind = 'CRLF'
  if (crlfCount >= crCount && crlfCount >= lfCount) {
    dominant = 'CRLF'
  } else if (crCount >= lfCount) {
    dominant = 'CR'
  } else {
    dominant = 'LF'
  }

  return { crlfCount, crCount, lfCount, hasMixed, dominant }
}

export const buildLineEndingMap = (content: string): LineEndingKind[] => {
  const map: LineEndingKind[] = []
  for (let i = 0; i < content.length; ) {
    while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++
    if (i >= content.length) break
    if (content[i] === '\r' && content[i + 1] === '\n') { map.push('CRLF'); i += 2 }
    else if (content[i] === '\r') { map.push('CR'); i += 1 }
    else { map.push('LF'); i += 1 }
  }
  return map
}

export const normalizeLineEndings = (content: string, target: LineEndingKind): string => {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (target === 'CRLF') return normalized.replace(/\n/g, '\r\n')
  if (target === 'CR') return normalized.replace(/\n/g, '\r')
  return normalized
}

export const getTargetLineEndingCount = (stats: LineEndingStats, target: LineEndingKind): number => {
  if (target === 'CRLF') return stats.crlfCount
  if (target === 'CR') return stats.crCount
  return stats.lfCount
}

export const contentMatchesTargetLineEnding = (
  content: string,
  target: LineEndingKind
): boolean => {
  const stats = getLineEndingStats(content)
  const total = stats.crlfCount + stats.crCount + stats.lfCount
  if (total === 0) return true
  if (stats.lfCount === total) return true
  return getTargetLineEndingCount(stats, target) === total
}
