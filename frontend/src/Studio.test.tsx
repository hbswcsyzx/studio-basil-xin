import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import Studio from './Studio'
import { defaultImagePresets, defaultStylePresets, resolveImagePresets, resolveStylePresets } from './stylePresets'

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
    expect(preset.prompt.length).toBeGreaterThan(80)
  }
})

test('distinguishes uninitialized preset libraries from explicitly empty libraries', () => {
  expect(resolveStylePresets({})).toEqual(defaultStylePresets)
  expect(resolveStylePresets({ style_presets: [] })).toEqual([])
  expect(resolveImagePresets({})).toEqual(defaultImagePresets)
  expect(resolveImagePresets({ image_presets: [] })).toEqual([])
  expect(defaultImagePresets.map(item => item.id)).toEqual(['quick-square', 'landscape-2k', 'portrait-hd'])
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

test('keeps history on the left and resizes both workspace boundaries', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const resizeUser = { ...user, id: 'u-resize' }
  localStorage.removeItem('studio:u-resize:timeline-width')
  localStorage.removeItem('studio:u-resize:dock-height')
  const { container } = render(<Studio user={resizeUser} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const main = container.querySelector<HTMLElement>('.workspace-main')
  const timeline = container.querySelector<HTMLElement>('.run-timeline')
  const output = container.querySelector<HTMLElement>('.output-stage')
  const dock = container.querySelector<HTMLElement>('.generation-dock')
  const timelineResizer = container.querySelector<HTMLElement>('.timeline-resizer')
  const dockResizer = container.querySelector<HTMLElement>('.dock-resizer')

  expect(main?.firstElementChild).toBe(timeline)
  expect(timeline).toHaveClass('run-timeline')
  expect(output).toHaveClass('output-stage')
  expect(dock).toHaveClass('generation-dock')
  expect(main?.style.getPropertyValue('--timeline-width')).toBe('88px')
  expect(main?.style.getPropertyValue('--dock-height')).toBe('290px')

  fireEvent.pointerDown(timelineResizer!, { clientX: 88, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 160, clientY: 100 })
  fireEvent.pointerUp(window)
  expect(main?.style.getPropertyValue('--timeline-width')).toBe('160px')

  fireEvent.pointerDown(dockResizer!, { clientX: 500, clientY: 500 })
  fireEvent.pointerMove(window, { clientX: 500, clientY: 400 })
  fireEvent.pointerUp(window)
  expect(main?.style.getPropertyValue('--dock-height')).toBe('390px')
})

test('uses the approved compact dock layout and switches refinement modes in place', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const { container } = render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const topbarActions = container.querySelector('.topbar-actions')
  expect(topbarActions).toContainElement(screen.getByRole('button', { name: '归纳当前会话预设' }))
  expect(topbarActions).not.toHaveTextContent('提示词协作')
  expect(container.querySelector('.reference-rail')).toBeInTheDocument()
  expect(container.querySelector('.settings-generate-zone')).toBeInTheDocument()
  expect(container.querySelector('.mode-indicator')).not.toBeInTheDocument()

  expect(screen.getByRole('button', { name: '快速润色' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '切换润色模式' }))
  expect(screen.getByRole('region', { name: '提示词协作' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /采用/ })).not.toBeInTheDocument()
})

test('resizes the timeline and dock together from their corner handle', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const resizeUser = { ...user, id: 'u-corner-resize' }
  localStorage.removeItem('studio:u-corner-resize:timeline-width')
  localStorage.removeItem('studio:u-corner-resize:dock-height')
  const { container } = render(<Studio user={resizeUser} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)
  const main = container.querySelector<HTMLElement>('.workspace-main')
  const corner = container.querySelector<HTMLElement>('.corner-resizer')

  fireEvent.pointerDown(corner!, { clientX: 88, clientY: 500 })
  fireEvent.pointerMove(window, { clientX: 168, clientY: 410 })
  fireEvent.pointerUp(window)

  expect(main?.style.getPropertyValue('--timeline-width')).toBe('168px')
  expect(main?.style.getPropertyValue('--dock-height')).toBe('380px')
})

test('keeps errors in order until each notification is dismissed manually', () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const { container } = render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  expect(screen.getAllByRole('alert')[0]).toHaveClass('error-toast')
  expect(container.querySelector('.generation-dock')).not.toContainElement(screen.getAllByRole('alert')[0])

  vi.advanceTimersByTime(30_000)
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: '关闭错误提示' })[0])
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  vi.useRealTimers()
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

  expect(screen.getByRole('heading', { name: '预设管理' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '电影感提示词' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '新增风格' })).toBeInTheDocument()
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

test('numbers mixed references in the same order sent for generation', async () => {
  let submitted: FormData | undefined
  const libraryAsset = { id: 'library-1', content_url: '/library-1', mime_type: 'image/png', width: 800, height: 800 }
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:upload'), revokeObjectURL: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/reference-assets' && init?.method === 'POST') return Response.json([])
    if (path === '/api/reference-assets') return Response.json([libraryAsset])
    if (path.endsWith('/generate')) {
      submitted = init?.body as FormData
      return Response.json({ id: 'r2', prompt: 'combine', model: 'gpt-image-2', params: {}, status: 'running', assets: [] }, { status: 202 })
    }
    return Response.json([])
  }))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  await userEvent.click(screen.getByRole('button', { name: '引用此图继续修改' }))
  await userEvent.click(screen.getByRole('button', { name: '打开参考图库' }))
  const libraryImage = await screen.findByRole('img', { name: '参考图库图片' })
  await userEvent.click(libraryImage.closest('button')!)
  await userEvent.upload(screen.getByLabelText('上传参考图'), new File(['image'], 'upload.png', { type: 'image/png' }))

  expect(screen.getByLabelText('参考图 1')).toHaveTextContent('1')
  expect(screen.getByLabelText('参考图 2')).toHaveTextContent('2')
  expect(screen.getByLabelText('参考图 3')).toHaveTextContent('3')

  await userEvent.type(screen.getByRole('textbox', { name: '描述你想生成的图片' }), '按参考图编号组合人物')
  await userEvent.click(screen.getByRole('button', { name: '生成图片' }))
  await waitFor(() => expect(submitted).toBeDefined())

  const orderedReferences = Array.from(submitted!.entries())
    .filter(([key]) => ['reference_asset_ids', 'library_reference_ids', 'references'].includes(key))
    .map(([key]) => key)
  expect(orderedReferences).toEqual(['reference_asset_ids', 'library_reference_ids', 'references'])
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

test('shows and submits the selected generation count separately from reference count', async () => {
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

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '尺寸' }), '3840x2160')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '质量' }), 'medium')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '数量' }), '3')
  await userEvent.click(screen.getByRole('button', { name: '引用此图继续修改' }))

  await userEvent.type(screen.getByRole('textbox', { name: '描述你想生成的图片' }), '只调整人物面部')
  await userEvent.click(screen.getByRole('button', { name: '生成图片' }))
  await waitFor(() => expect(submitted).toBeDefined())

  expect(submitted?.get('size')).toBe('3840x2160')
  expect(submitted?.get('quality')).toBe('medium')
  expect(submitted?.get('count')).toBe('3')
})

test('applies image presets independently and marks manual changes as custom settings', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  const imagePreset = screen.getByRole('combobox', { name: '图片设置预设' })
  await userEvent.selectOptions(imagePreset, 'quick-square')
  expect(screen.getByRole('combobox', { name: '尺寸' })).toHaveValue('1024x1024')
  expect(screen.getByRole('combobox', { name: '质量' })).toHaveValue('auto')
  expect(screen.getByRole('combobox', { name: '数量' })).toHaveValue('1')
  expect(imagePreset).toHaveValue('quick-square')

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '质量' }), 'high')
  expect(imagePreset).toHaveValue('custom')

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '风格预设' }), 'card')
  expect(screen.getByRole('combobox', { name: '尺寸' })).toHaveValue('1024x1024')
  expect(screen.getByRole('combobox', { name: '质量' })).toHaveValue('high')
})

test('derives editable presets from only the current conversation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/workspaces/w1/derive-presets') return Response.json({
      summary: '归纳当前会话偏好',
      style_draft: { name: '冷峻人物', prompt: '冷色、真实材质、克制光影并突出人物表情和轮廓，避免无关装饰抢夺主体注意力。', confidence: 0.8, accepted: ['冷色'], changes: ['表情更严厉'], uncertain: [] },
      image_draft: { name: '横向高质量', size: '2048x1152', quality: 'high', count: 1, background: 'auto', output_format: 'png', output_compression: 100, confidence: 0.7, accepted: ['横向'], changes: [], uncertain: [] },
      statistics: { successful_runs: 1, generated_images: 1, favorite_images: 0, refinement_steps: 0, failed_runs_excluded: 0, representative_images: 1 },
      used_visual_analysis: true, fallback_reason: null,
    })
    return Response.json([])
  }))
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  await userEvent.click(screen.getByRole('button', { name: '归纳当前会话预设' }))

  expect(await screen.findByRole('dialog', { name: '归纳预设' })).toBeInTheDocument()
  expect(screen.getByText('归纳当前会话偏好')).toBeInTheDocument()
})

test('does not send an image model to prompt optimization', async () => {
  const invalidTextUser = { ...user, preferences: { ...user.preferences, default_text_provider_id: 'pi', default_text_model: 'seedream-5.0' } }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  render(<Studio user={invalidTextUser} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  await userEvent.type(screen.getByRole('textbox', { name: '描述你想生成的图片' }), 'blue circle')
  await userEvent.click(screen.getByRole('button', { name: '快速润色' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('默认文本模型')
})

test('sends style, image settings, and reference images to prompt optimization', async () => {
  let submitted: FormData | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/optimize')) { submitted = init?.body as FormData; return Response.json({ suggestion: '润色后的提示词' }) }
    return Response.json([])
  }))
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:reference'), revokeObjectURL: vi.fn() })
  render(<Studio user={user} workspaces={[workspace]} providers={providers} quota={{ used: 1, limit: 1000, conversations_used: 1, conversations_limit: 100 }} onUser={vi.fn()} onWorkspaces={vi.fn()} onProviders={vi.fn()} onQuota={vi.fn()} onLogout={vi.fn()} />)

  await userEvent.selectOptions(screen.getByRole('combobox', { name: '风格预设' }), 'card')
  await userEvent.upload(screen.getByLabelText('上传参考图'), new File(['image'], 'reference.png', { type: 'image/png' }))
  await userEvent.type(screen.getByRole('textbox', { name: '描述你想生成的图片' }), '只保留主体')
  await userEvent.click(screen.getByRole('button', { name: '快速润色' }))
  await waitFor(() => expect(submitted).toBeDefined())

  expect(submitted?.get('style_prompt')).toContain('卡牌')
  expect(submitted?.get('size')).toBe('2048x1152')
  expect(submitted?.get('quality')).toBe('high')
  expect(submitted?.get('references')).toBeInstanceOf(File)
})
