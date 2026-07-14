import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import App from './App'

const user = { id: 'u1', username: 'alice', role: 'user', must_change_password: false }
const workspace = { id: 'w1', user_id: 'u1', name: '产品概念', image_count: 0, latest_asset_id: null, created_at: '', updated_at: '', runs: [] }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify(user), { status: 200 })
    if (url.endsWith('/api/workspaces')) return new Response(JSON.stringify([workspace]))
    if (url.endsWith('/api/workspaces/w1')) return new Response(JSON.stringify(workspace))
    if (url.endsWith('/api/providers')) return new Response(JSON.stringify([]))
    if (url.endsWith('/api/quota')) return new Response(JSON.stringify({ used: 0, limit: 1000 }))
    return new Response('{}', { status: 200 })
  }))
})

test('keeps image output as the primary workspace surface', async () => {
  render(<App />)
  expect(await screen.findByRole('heading', { name: '产品概念' })).toBeInTheDocument()
  expect(screen.getByLabelText('图片输出')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('描述你想生成的图片')).toBeInTheDocument()
  expect(screen.queryByText('会话记录')).not.toBeInTheDocument()
})

test('opens session history only when requested', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: '产品概念' })
  await userEvent.click(screen.getByRole('button', { name: '打开会话' }))
  expect(screen.getByText('会话记录')).toBeInTheDocument()
})

test('offers direct generation and optional prompt optimization', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: '产品概念' })
  expect(screen.getByRole('button', { name: '生成图片' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '优化提示词' })).toBeInTheDocument()
  expect(screen.getByLabelText('上传参考图')).toBeInTheDocument()
})

test('defaults theme to system and allows explicit dark mode', async () => {
  render(<App />)
  await screen.findByRole('heading', { name: '产品概念' })
  expect(document.documentElement.dataset.theme).toBeUndefined()
  await userEvent.click(screen.getByRole('button', { name: '切换主题' }))
  await userEvent.click(screen.getByRole('menuitem', { name: '深色' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
})

