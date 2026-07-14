import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import Studio from './Studio'

const user = {
  id: 'u1', username: 'alice', role: 'user' as const, must_change_password: false,
  email: null, onboarding_completed: true,
  preferences: {
    default_image_provider_id: 'pi', default_image_model: 'gpt-image-2',
    default_text_provider_id: 'pt', default_text_model: 'gpt-5.5',
  },
}
const providers = [
  { id: 'pi', name: 'Image', base_url: 'https://example.com', has_api_key: true, models: ['gpt-image-2'], image_models: ['gpt-image-2'], text_models: [] },
  { id: 'pt', name: 'Text', base_url: 'https://example.com', has_api_key: true, models: ['gpt-5.5'], image_models: [], text_models: ['gpt-5.5'] },
]
const asset = { id: 'a1', workspace_id: 'w1', run_id: 'r1', mime_type: 'image/png', width: 1200, height: 800, size_bytes: 100, favorite: false, content_url: '/content', download_url: '/download', created_at: '' }
const workspace = { id: 'w1', user_id: 'u1', name: '角色设计', favorite: false, image_count: 1, latest_asset_id: 'a1', created_at: '', updated_at: '', runs: [{ id: 'r1', prompt: '角色提示词', model: 'gpt-image-2', provider_id: 'pi', params: { size: '1536x1024', quality: 'high', count: 1 }, status: 'completed' as const, created_at: '', assets: [asset] }] }

test('shows run history and reference images as thumbnails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:reference'), revokeObjectURL: vi.fn() })
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  expect(screen.getByRole('button', { name: '查看第 1 次生成' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '收藏图片' })).toBeInTheDocument()

  const reference = new File(['image'], 'character.png', { type: 'image/png' })
  await userEvent.upload(screen.getByLabelText('上传参考图'), reference)
  expect(screen.getByRole('img', { name: 'character.png' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '移除 character.png' })).toBeInTheDocument()
})

test('orders generation history from oldest to newest', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const oldAsset = { ...asset, id: 'a-old', run_id: 'r-old', content_url: '/old' }
  const newAsset = { ...asset, id: 'a-new', run_id: 'r-new', content_url: '/new' }
  const historyWorkspace = {
    ...workspace,
    runs: [
      { ...workspace.runs[0], id: 'r-new', created_at: '2026-07-14T02:00:00Z', assets: [newAsset] },
      { ...workspace.runs[0], id: 'r-old', created_at: '2026-07-14T01:00:00Z', assets: [oldAsset] },
    ],
  }

  render(<Studio user={user} workspaces={[historyWorkspace]} providers={providers} quota={{ used: 2, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  expect(screen.getAllByRole('button', { name: /查看第 .* 次生成/ }).map(button => button.getAttribute('aria-label'))).toEqual([
    '查看第 1 次生成',
    '查看第 2 次生成',
  ])
  expect(screen.getAllByRole('img', { name: '历史生成图' }).map(image => image.getAttribute('src'))).toEqual(['/old', '/new'])
})

test('keeps quota usage in settings overview instead of the main header', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 2, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  expect(screen.queryByText('2 / 1000 张')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '打开设置' }))
  expect(screen.getByRole('progressbar', { name: '图片额度' })).toHaveAttribute('aria-valuenow', '2')
  expect(screen.getByRole('progressbar', { name: '会话额度' })).toHaveAttribute('aria-valuenow', '1')
})

test('opens the session drawer without waiting for favorites to load', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => window.setTimeout(() => resolve(new Response('[]', { status: 200 })), 1000))))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '打开会话' }))

  expect(screen.getByRole('complementary', { name: '会话与收藏' })).toBeInTheDocument()
})
