#!/usr/bin/env node
/** 编译 backend TypeScript 到 dist（本地 API / SAM 共用） */
import { spawnSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backend = resolve(ROOT, 'backend')

const r = spawnSync('npm', ['run', 'build'], {
  cwd: backend,
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

process.exit(r.status ?? 1)
