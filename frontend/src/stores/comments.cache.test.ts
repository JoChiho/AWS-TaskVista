import { describe, expect, it } from 'vitest'
import type { Comment } from '@/types/comment'
import { commentsFingerprint } from './comments'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    commentId: 'c1',
    taskId: 't1',
    content: 'hello',
    authorId: 'u1',
    authorName: '太郎',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('commentsFingerprint', () => {
  it('同一内容なら同じ fingerprint', () => {
    const a = [makeComment(), makeComment({ commentId: 'c2', content: 'b' })]
    const b = [makeComment({ commentId: 'c2', content: 'b' }), makeComment()]
    expect(commentsFingerprint(a)).toBe(commentsFingerprint(b))
  })

  it('content が変われば fingerprint が変わる', () => {
    const a = [makeComment({ content: 'a' })]
    const b = [makeComment({ content: 'b' })]
    expect(commentsFingerprint(a)).not.toBe(commentsFingerprint(b))
  })

  it('件数が変われば fingerprint が変わる', () => {
    const a = [makeComment()]
    const b = [makeComment(), makeComment({ commentId: 'c2' })]
    expect(commentsFingerprint(a)).not.toBe(commentsFingerprint(b))
  })

  it('空一覧どうしは同じ fingerprint（ロード完了後も空表示できる）', () => {
    expect(commentsFingerprint([])).toBe(commentsFingerprint([]))
  })
})
