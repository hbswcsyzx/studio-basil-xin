import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import Studio from './Studio'
import { defaultStylePresets } from './stylePresets'

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

test('keeps built-in style prompts independent from image dimensions', () => {
  for (const preset of defaultStylePresets) {
    expect(preset.prompt).not.toMatch(/尺寸|像素|分辨率|宽高比|横向画布|纵向画布|小尺寸/)
  }
})

test('hides transparent background for gpt-image-2', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  expect(screen.queryByRole('option', { name: '透明' })).not.toBeInTheDocument()
})

test('shows run history and reference images as thumbnails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:reference'), revokeObjectURL: vi.fn() })
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  expect(screen.getByRole('button', { name: '查看第 1 次生成' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '收藏图片' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '生成结果' })).toHaveClass('viewport-fit-image')
  expect(screen.getByRole('img', { name: '历史生成图' })).toHaveClass('contained-thumbnail')

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

test('opens editable style presets from the workspace selector', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const styleSelector = screen.getByRole('combobox', { name: '风格预设' })
  expect(screen.getByRole('option', { name: '无预设风格' })).toBeInTheDocument()
  await userEvent.selectOptions(styleSelector, '__manage__')

  expect(screen.getByRole('heading', { name: '风格预设' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '电影感提示词' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '新增自定义风格' })).toBeInTheDocument()
})

test('cites the selected generated image for a focused refinement request', async () => {
  let submitted: FormData | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/generate')) {
      submitted = init?.body as FormData
      return Response.json({ assets: [{ ...asset, id: 'a2' }] }, { status: 201 })
    }
    if (path === '/api/workspaces/w1') return Response.json(workspace)
    if (path === '/api/quota') return Response.json({ used: 2, limit: 1000, conversations_used: 1, conversations_limit: 100 })
    return Response.json([])
  }))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const prompt = screen.getByRole('textbox', { name: '描述你想生成的图片' })
  await userEvent.type(prompt, '一整段旧提示词')
  await userEvent.click(screen.getByRole('button', { name: '引用此图继续修改' }))

  expect(prompt).toHaveValue('')
  expect(screen.getByRole('img', { name: '已引用的生成图片' })).toHaveAttribute('src', '/content')
  await userEvent.type(prompt, '只把人物表情改得更严厉')
  await userEvent.click(screen.getByRole('button', { name: '生成图片' }))

  await waitFor(() => expect(submitted).toBeDefined())
  expect(submitted?.getAll('reference_asset_ids')).toEqual(['a1'])
  expect(submitted?.get('size')).toBe('2048x1152')
  expect(String(submitted?.get('prompt'))).toContain('未明确要求修改的主体身份、构图、服装与画面风格保持不变')
  expect(String(submitted?.get('prompt'))).toContain('只把人物表情改得更严厉')
})

test('drags a timeline image into the input area as a citation instead of a URL', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)
  const timelineButton = screen.getByRole('button', { name: '查看第 1 次生成' })
  const inputArea = screen.getByRole('region', { name: '图片与提示词输入区' })
  const data = new Map<string, string>()
  const dataTransfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }

  fireEvent.dragStart(timelineButton, { dataTransfer })
  expect(timelineButton).toHaveAttribute('draggable', 'true')
  expect(data.get('application/x-studio-asset-id')).toBe('a1')
  fireEvent.dragOver(inputArea, { dataTransfer })
  expect(inputArea).toHaveClass('reference-drop-active')
  fireEvent.drop(inputArea, { dataTransfer })

  expect(screen.getByRole('img', { name: '已引用的生成图片' })).toHaveAttribute('src', '/content')
  expect(screen.getByRole('textbox', { name: '描述你想生成的图片' })).not.toHaveValue('/content')
})

test('cites a timeline image from its hover action', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const citeButton = screen.getByRole('button', { name: '引用第 1 次生成继续修改' })
  expect(citeButton).toHaveAttribute('title', '引用此图继续修改')
  await userEvent.click(citeButton)

  expect(screen.getByRole('img', { name: '已引用的生成图片' })).toHaveAttribute('src', '/content')
})
