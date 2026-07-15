import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import PresetManager from './PresetManager'
import { defaultStylePresets } from './presetDefaults'
import type { User } from './types'

const user: User = {
  id: 'u1', username: 'alice', role: 'user', must_change_password: false,
  email: null, onboarding_completed: true, preferences: {},
}

test('renames and saves a built-in style preset', async () => {
  let body: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return Response.json({ ...user, preferences: body })
  }))
  const onUser = vi.fn()
  render(<PresetManager user={user} onUser={onUser} />)

  const name = screen.getByRole('textbox', { name: '电影感名称' })
  expect(name).toBeEnabled()
  await userEvent.clear(name)
  await userEvent.type(name, '克制电影感')
  expect(screen.getByText('有未保存更改')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '保存风格预设更改' }))

  await waitFor(() => expect(body).toBeDefined())
  expect((body?.style_presets as Array<{ name: string }>)[0].name).toBe('克制电影感')
  expect(onUser).toHaveBeenCalled()
})

test('deletes a built-in style immediately and keeps an explicit saved list', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true))
  let body: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return Response.json({ ...user, preferences: body })
  }))
  render(<PresetManager user={user} onUser={vi.fn()} />)

  await userEvent.click(screen.getByRole('button', { name: '删除 电影感' }))

  await waitFor(() => expect(body).toBeDefined())
  expect((body?.style_presets as Array<{ id: string }>).map(item => item.id)).not.toContain('cinematic')
  expect((body?.style_presets as unknown[]).length).toBe(defaultStylePresets.length - 1)
})

test('manages image-setting presets independently and restores missing defaults', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true))
  const responses: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    responses.push(body)
    return Response.json({ ...user, preferences: body })
  }))
  render(<PresetManager user={user} onUser={vi.fn()} />)

  await userEvent.click(screen.getByRole('button', { name: '图片设置预设' }))
  expect(screen.getByRole('textbox', { name: '横向 2K名称' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '删除 横向 2K' }))
  await waitFor(() => expect(responses).toHaveLength(1))
  expect((responses[0].image_presets as Array<{ id: string }>).map(item => item.id)).not.toContain('landscape-2k')

  await userEvent.click(screen.getByRole('button', { name: '恢复内置图片预设' }))
  await waitFor(() => expect(responses).toHaveLength(2))
  expect((responses[1].image_presets as Array<{ id: string }>).map(item => item.id)).toContain('landscape-2k')
})
