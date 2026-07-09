import type { Comment, Project, Task } from '../../src/shared/types.js'

export const USER_ID = 'user-001'
export const OTHER_USER = 'user-002'
export const PROJECT_ID = 'proj-001'
export const TASK_ID = 'task-001'

const NOW = '2026-07-07T10:00:00.000Z'

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    projectId: PROJECT_ID,
    name: 'TaskVista 開発',
    description: 'テスト用プロジェクト',
    status: 'active',
    createdBy: USER_ID,
    memberIds: [USER_ID],
    memberEmails: ['user@example.com'],
    members: [
      { userId: USER_ID, email: 'user@example.com', displayName: 'テストユーザー' },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    isDeleted: false,
    ...overrides,
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    title: 'テストタスク',
    description: '説明',
    status: '未着手',
    priority: 'medium',
    requirement: '要望',
    assigneeId: USER_ID,
    assigneeName: 'テストユーザー',
    dueDate: '2026-07-15',
    attachments: [],
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    isDeleted: false,
    ...overrides,
  }
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    commentId: 'cmt-001',
    taskId: TASK_ID,
    content: 'テストコメント',
    authorId: USER_ID,
    authorName: 'テストユーザー',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}