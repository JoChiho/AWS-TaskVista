import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handler } from '../../src/projects/handler.js'
import * as service from '../../src/projects/service.js'
import { makeProject } from '../helpers/fixtures.js'
import { createMockEvent } from '../helpers/mockEvent.js'

vi.mock('../../src/projects/service.js', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
}))

describe('projects/handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /projects でプロジェクト一覧を返す', async () => {
    const projects = [makeProject()]
    vi.mocked(service.listProjects).mockResolvedValue(projects)

    const event = createMockEvent({ method: 'GET', path: '/projects' })
    const result = await handler(event)

    expect(result.statusCode).toBe(200)
    const body = JSON.parse(result.body as string)
    expect(body.data).toEqual(projects)
    expect(body.meta.correlationId).toBeDefined()
  })

  it('POST /projects で 201 を返す', async () => {
    const project = makeProject({ name: '新規' })
    vi.mocked(service.createProject).mockResolvedValue(project)

    const event = createMockEvent({
      method: 'POST',
      path: '/projects',
      body: { name: '新規' },
    })
    const result = await handler(event)

    expect(result.statusCode).toBe(201)
    const body = JSON.parse(result.body as string)
    expect(body.data.name).toBe('新規')
  })

  it('GET /prod/projects でもプロジェクト一覧を返す', async () => {
    const projects = [makeProject()]
    vi.mocked(service.listProjects).mockResolvedValue(projects)

    const event = createMockEvent({ method: 'GET', path: '/prod/projects' })
    event.requestContext.stage = 'prod'

    const result = await handler(event)
    expect(result.statusCode).toBe(200)
  })

  it('OPTIONS リクエストで CORS プリフライトを返す', async () => {
    const event = createMockEvent({ method: 'OPTIONS', path: '/projects' })
    const result = await handler(event)
    expect(result.statusCode).toBe(204)
  })

  it('未認証リクエストで 401 を返す', async () => {
    const event = createMockEvent({ method: 'GET', path: '/projects' })
    ;(event.requestContext as { authorizer?: unknown }).authorizer = undefined

    const result = await handler(event)
    expect(result.statusCode).toBe(401)
    const body = JSON.parse(result.body as string)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})