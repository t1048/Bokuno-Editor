import { describe, it, expect } from 'vitest'
import {
  normalizeLineEndings,
  getLineEndingStats,
  buildLineEndingMap,
  contentMatchesTargetLineEnding,
} from './lineEndings'

describe('normalizeLineEndings', () => {
  it('converts LF to CRLF', () => {
    expect(normalizeLineEndings('a\nb', 'CRLF')).toBe('a\r\nb')
  })

  it('converts CRLF to LF', () => {
    expect(normalizeLineEndings('a\r\nb', 'LF')).toBe('a\nb')
  })

  it('converts mixed to CR', () => {
    expect(normalizeLineEndings('a\r\nb\nc', 'CR')).toBe('a\rb\rc')
  })
})

describe('getLineEndingStats', () => {
  it('detects mixed line endings', () => {
    const stats = getLineEndingStats('a\r\nb\nc')
    expect(stats.hasMixed).toBe(true)
    expect(stats.crlfCount).toBe(1)
    expect(stats.lfCount).toBe(1)
  })
})

describe('buildLineEndingMap', () => {
  it('maps each line ending', () => {
    expect(buildLineEndingMap('a\r\nb\n')).toEqual(['CRLF', 'LF'])
  })
})

describe('contentMatchesTargetLineEnding', () => {
  it('accepts LF-only content for any target', () => {
    expect(contentMatchesTargetLineEnding('a\nb', 'CRLF')).toBe(true)
  })
})
