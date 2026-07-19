import { CSSProperties, ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Aperture, Download, Heart, History, ImagePlus, LoaderCircle, Menu, Repeat2, Settings, Sparkles, Star, Sun, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError } from './api'
import OnboardingGuide from './OnboardingGuide'
import PresetReviewDialog from './PresetReviewDialog'
import PromptCollaboration from './PromptCollaboration'
import SessionDrawer from './SessionDrawer'
import SettingsDrawer from './SettingsDrawer'
import { validateImageSize } from './imageSize'
import { resolveImagePresets, resolveStylePresets } from './stylePresets'
import type { Asset, DerivedPresetResult, Provider, Quota, Run, User, Workspace } from './types'

type Props = {
  user: User
  workspaces: Workspace[]
  providers: Provider[]
  quota: Quota
  onUser: (user: User) => void
  onWorkspaces: (items: Workspace[]) => void
  onProviders: (items: Provider[]) => void
  onQuota: (quota: Quota) => void
  onLogout: () => void
}

type SettingsSection = 'overview' | 'models' | 'styles' | 'profile' | 'system'
const sizes = ['1024x1024', '1536x1024', '1024x1536', '2048x1152', '3840x2160']
const maxReferenceImages = 10
type LibraryReference = { id: string; content_url: string; mime_type: string; width: number; height: number; reused?: boolean }

function ReferenceThumb({ file, index, onRemove }: { file: File; index: number; onRemove: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!URL.createObjectURL) return
    const value = URL.createObjectURL(file); setSrc(value)
    return () => URL.revokeObjectURL(value)
  }, [file])
  return <div className="reference-thumb">{src ? <img className="contained-thumbnail" src={src} alt={file.name} /> : <ImagePlus />}<span className="reference-index" aria-label={`参考图 ${index}`}>{index}</span><button aria-label={`移除 ${file.name}`} onClick={onRemove}><X /></button></div>
}

function CitedAssetThumb({ asset, index, onRemove }: { asset: Asset; index: number; onRemove: () => void }) {
  return <div className="reference-thumb cited-reference"><img className="contained-thumbnail" src={asset.content_url} alt="已引用的生成图片" /><span className="reference-index" aria-label={`参考图 ${index}`}>{index}</span><button aria-label="移除引用图片" onClick={onRemove}><X /></button></div>
}

function LibraryReferenceThumb({ asset, index, onRemove }: { asset: LibraryReference; index: number; onRemove: () => void }) {
  return <div className="reference-thumb"><img className="contained-thumbnail" src={asset.content_url} alt="已选参考图" /><span className="reference-index" aria-label={`参考图 ${index}`}>{index}</span><button aria-label="移除参考图" onClick={onRemove}><X /></button></div>
}

export default function Studio(props: Props) {
  const [currentId, setCurrentId] = useState(props.workspaces[0]?.id ?? '')
  const [workspace, setWorkspace] = useState<Workspace | null>(props.workspaces[0] ?? null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(props.user.must_change_password)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(props.user.must_change_password ? 'profile' : 'overview')
  const [showGuide, setShowGuide] = useState(!props.user.onboarding_completed)
  const [themeMenu, setThemeMenu] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<File[]>([])
  const [referencedAssets, setReferencedAssets] = useState<Asset[]>([])
  const [libraryReferences, setLibraryReferences] = useState<LibraryReference[]>([])
  const [libraryItems, setLibraryItems] = useState<LibraryReference[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [refinementMode, setRefinementMode] = useState<'quick' | 'collaborate'>('quick')
  const [style, setStyle] = useState('')
  const [imagePreset, setImagePreset] = useState('landscape-2k')
  const [size, setSize] = useState('2048x1152')
  const [customWidth, setCustomWidth] = useState(1600)
  const [customHeight, setCustomHeight] = useState(896)
  const [quality, setQuality] = useState('high')
  const [count, setCount] = useState(1)
  const [background, setBackground] = useState('auto')
  const [outputFormat, setOutputFormat] = useState('png')
  const [compression, setCompression] = useState(100)
  const [busy, setBusy] = useState<'generate' | 'optimize' | ''>('')
  const [elapsed, setElapsed] = useState(0)
  const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([])
  const [selectedId, setSelectedId] = useState('')
  const [draggingAssetId, setDraggingAssetId] = useState('')
  const [favoriteAssets, setFavoriteAssets] = useState<Asset[]>([])
  const [deriving, setDeriving] = useState(false)
  const [derivedResult, setDerivedResult] = useState<DerivedPresetResult | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [timelineWidth, setTimelineWidth] = useState(() => Number(localStorage.getItem(`studio:${props.user.id}:timeline-width`)) || 88)
  const [dockHeight, setDockHeight] = useState(() => Number(localStorage.getItem(`studio:${props.user.id}:dock-height`)) || 290)
  const uploadRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const nextErrorIdRef = useRef(1)

  function setError(message: string) {
    if (!message) return
    const id = nextErrorIdRef.current++
    setErrors(current => [...current, { id, message }])
  }

  const runs = workspace?.runs ?? []
  const activeRun = runs.find(run => run.status === 'running')
  const timelineRuns = useMemo(() => [...runs].reverse(), [runs])
  const assets = useMemo(() => runs.flatMap(run => run.assets), [runs])
  const selected = assets.find(asset => asset.id === selectedId) ?? assets[0]
  const imageProvider = props.providers.find(item => item.id === props.user.preferences.default_image_provider_id)
  const textProvider = props.providers.find(item => item.id === props.user.preferences.default_text_provider_id)
  const imageModel = props.user.preferences.default_image_model ?? ''
  const textModel = props.user.preferences.default_text_model ?? ''
  const stylePresets = useMemo(() => resolveStylePresets(props.user.preferences), [props.user.preferences])
  const imagePresets = useMemo(() => resolveImagePresets(props.user.preferences), [props.user.preferences])
  const effectiveSize = size === 'custom' ? `${customWidth}x${customHeight}` : size
  const totalReferences = references.length + referencedAssets.length + libraryReferences.length
  const isGenerating = busy === 'generate' || Boolean(activeRun)

  useEffect(() => {
    if (!isGenerating) { setElapsed(0); return }
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [isGenerating])

  useEffect(() => {
    if (!workspace || !activeRun) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      let keepPolling = true
      try {
        const detail = await api<Workspace>(`/api/workspaces/${workspace.id}`)
        if (cancelled) return
        const updatedRun = (detail.runs ?? []).find(run => run.id === activeRun.id)
        setWorkspace(detail)
        if (updatedRun && updatedRun.status !== 'running') {
          keepPolling = false
          if (updatedRun.status === 'completed') {
            setSelectedId(updatedRun.assets[0]?.id ?? '')
            setReferences([]); setReferencedAssets([])
            props.onQuota({ ...props.quota, used: props.quota.used + updatedRun.assets.length })
            props.onWorkspaces(props.workspaces.map(item => item.id === detail.id ? { ...item, image_count: detail.image_count, updated_at: detail.updated_at } : item))
          } else setError(updatedRun.error || '生成失败，请重试')
        }
      } catch { /* Keep polling while a transient refresh fails. */ }
      if (!cancelled && keepPolling) timer = window.setTimeout(poll, 2500)
    }
    timer = window.setTimeout(poll, 1200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [activeRun?.id, workspace?.id])

  useEffect(() => { localStorage.setItem(`studio:${props.user.id}:timeline-width`, String(timelineWidth)) }, [timelineWidth, props.user.id])
  useEffect(() => { localStorage.setItem(`studio:${props.user.id}:dock-height`, String(dockHeight)) }, [dockHeight, props.user.id])

  function startResize(kind: 'timeline' | 'dock' | 'both', startX: number, startY: number) {
    const initialTimelineWidth = timelineWidth
    const initialDockHeight = dockHeight
    const move = (event: PointerEvent) => {
      if (kind === 'timeline' || kind === 'both') setTimelineWidth(Math.max(64, Math.min(280, initialTimelineWidth + event.clientX - startX)))
      if (kind === 'dock' || kind === 'both') setDockHeight(Math.max(220, Math.min(520, initialDockHeight + startY - event.clientY)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = kind === 'timeline' ? 'col-resize' : kind === 'dock' ? 'row-resize' : 'nwse-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  useEffect(() => {
    if (imageModel === 'gpt-image-2' && background === 'transparent') setBackground('auto')
  }, [background, imageModel])

  useEffect(() => {
    if (imagePreset !== 'custom' && !imagePresets.some(item => item.id === imagePreset)) setImagePreset('custom')
  }, [imagePreset, imagePresets])

  function openSettings(section: SettingsSection = 'overview') { setSettingsSection(section); setSettingsOpen(true) }

  function applyImagePreset(id: string) {
    if (id === 'custom') { setImagePreset('custom'); return }
    const preset = imagePresets.find(item => item.id === id)
    if (!preset) return
    const sizeError = validateImageSize(preset.size)
    if (sizeError) { setError(sizeError); return }
    if (imageModel === 'gpt-image-2' && preset.background === 'transparent') { setError('当前生图模型不支持透明背景，请修改这个图片预设'); return }
    if (sizes.includes(preset.size)) setSize(preset.size)
    else {
      const [width, height] = preset.size.split('x').map(Number)
      setSize('custom'); setCustomWidth(width); setCustomHeight(height)
    }
    setQuality(preset.quality); setCount(preset.count); setBackground(preset.background)
    setOutputFormat(preset.output_format); setCompression(preset.output_compression)
    setImagePreset(id); setError('')
  }

  async function loadWorkspace(id: string, preferredAsset = '') {
    const detail = await api<Workspace>(`/api/workspaces/${id}`)
    setCurrentId(id); setWorkspace(detail); setSelectedId(preferredAsset || detail.runs?.[0]?.assets[0]?.id || ''); setReferences([]); setReferencedAssets([]); setLibraryReferences([]); setSessionsOpen(false)
  }

  async function newWorkspace() {
    if (props.quota.conversations_used >= props.quota.conversations_limit) { setError('已达到 100 个会话上限，请先删除不需要的会话'); return }
    const item = await api<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: `新会话 ${props.workspaces.length + 1}` }) })
    props.onWorkspaces([item, ...props.workspaces]); props.onQuota({ ...props.quota, conversations_used: props.quota.conversations_used + 1 }); await loadWorkspace(item.id)
  }

  async function renameWorkspace(id: string, name: string) {
    const updated = await api<Workspace>(`/api/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    props.onWorkspaces(props.workspaces.map(item => item.id === id ? { ...item, name: updated.name } : item))
    if (workspace?.id === id) setWorkspace({ ...workspace, name: updated.name })
  }

  async function favoriteWorkspace(item: Workspace) {
    const updated = await api<Workspace>(`/api/workspaces/${item.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: !item.favorite }) })
    props.onWorkspaces(props.workspaces.map(value => value.id === item.id ? { ...value, favorite: updated.favorite } : value))
    if (workspace?.id === item.id) setWorkspace({ ...workspace, favorite: updated.favorite })
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('删除这个会话及其中所有图片？')) return
    await api(`/api/workspaces/${id}`, { method: 'DELETE' })
    const remaining = props.workspaces.filter(item => item.id !== id)
    props.onWorkspaces(remaining); props.onQuota({ ...props.quota, conversations_used: Math.max(0, props.quota.conversations_used - 1) })
    if (id === currentId) {
      if (remaining[0]) await loadWorkspace(remaining[0].id)
      else { setWorkspace(null); setCurrentId('') }
    }
  }

  function openSessions() {
    setSessionsOpen(true)
    api<Asset[]>('/api/assets/favorites').then(setFavoriteAssets).catch(() => setFavoriteAssets([]))
  }

  async function selectFavorite(asset: Asset) { await loadWorkspace(asset.workspace_id, asset.id) }

  async function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const allowed = files.slice(0, Math.max(0, maxReferenceImages - totalReferences))
    if (!allowed.length) { setError(`参考图总数不能超过 ${maxReferenceImages} 张`); return }
    setReferences(current => [...current, ...allowed])
    const form = new FormData(); allowed.forEach(file => form.append('files', file))
    try {
      const stored = await api<LibraryReference[]>('/api/reference-assets', { method: 'POST', body: form })
      if (stored.length) {
        setReferences(current => current.filter(file => !allowed.includes(file)))
        setLibraryReferences(current => [...current, ...stored.filter(item => !current.some(existing => existing.id === item.id))].slice(0, maxReferenceImages - referencedAssets.length))
      }
    } catch (err) { setError(err instanceof Error ? err.message : '参考图上传失败') }
  }

  function citeAsset(asset: Asset) {
    if (referencedAssets.some(item => item.id === asset.id)) return
    if (totalReferences >= maxReferenceImages) { setError(`参考图总数不能超过 ${maxReferenceImages} 张`); return }
    setReferencedAssets(current => [...current, asset])
    setPrompt('')
    setError('')
    window.requestAnimationFrame(() => promptRef.current?.focus())
  }

  async function openReferenceLibrary() {
    try { setLibraryItems(await api<LibraryReference[]>('/api/reference-assets')); setLibraryOpen(true) }
    catch (err) { setError(err instanceof Error ? err.message : '参考图库加载失败') }
  }

  function selectLibraryReference(asset: LibraryReference) {
    if (totalReferences >= maxReferenceImages) { setError(`参考图总数不能超过 ${maxReferenceImages} 张`); return }
    if (libraryReferences.some(item => item.id === asset.id)) return
    setLibraryReferences(current => [...current, asset]); setLibraryOpen(false); setError('')
  }

  function startAssetDrag(event: DragEvent<HTMLButtonElement>, asset: Asset) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/x-studio-asset-id', asset.id)
    setDraggingAssetId(asset.id)
  }

  function allowAssetDrop(event: DragEvent<HTMLElement>) {
    if (!draggingAssetId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function dropAsset(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const assetId = event.dataTransfer.getData('application/x-studio-asset-id')
    setDraggingAssetId('')
    const asset = assets.find(item => item.id === assetId)
    if (asset) citeAsset(asset)
  }

  function restoreRun(run: Run, assetId = '') {
    setPrompt(run.prompt); setStyle(''); setImagePreset('custom')
    const citedIds = Array.isArray(run.params.reference_asset_ids) ? run.params.reference_asset_ids : []
    setReferencedAssets(citedIds.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is Asset => Boolean(asset)))
    setReferences([])
    if (typeof run.params.size === 'string') {
      const nextSize = String(run.params.size)
      if (sizes.includes(nextSize)) setSize(nextSize)
      else { setSize('custom'); const [width, height] = nextSize.split('x').map(Number); if (width) setCustomWidth(width); if (height) setCustomHeight(height) }
    }
    if (typeof run.params.quality === 'string') setQuality(String(run.params.quality))
    if (typeof run.params.count === 'number') setCount(Number(run.params.count))
    if (typeof run.params.background === 'string') setBackground(String(run.params.background))
    if (typeof run.params.output_format === 'string') setOutputFormat(String(run.params.output_format))
    if (typeof run.params.output_compression === 'number') setCompression(Number(run.params.output_compression))
    setSelectedId(assetId || run.assets[0]?.id || '')
  }

  async function generate() {
    setError('')
    if (!imageProvider || !imageModel) { openSettings('models'); setError('请先在设置中选择默认生图模型'); return }
    if (!workspace) { await newWorkspace(); return }
    if (!prompt.trim()) { setError('请输入提示词'); return }
    const sizeError = validateImageSize(effectiveSize)
    if (sizeError) { setError(sizeError); return }
    setBusy('generate')
    try {
      const form = new FormData()
      const stylePrompt = stylePresets.find(item => item.id === style)?.prompt
      const preservationPrompt = referencedAssets.length ? '编辑要求：未明确要求修改的主体身份、构图、服装与画面风格保持不变。' : ''
      const finalPrompt = [preservationPrompt, prompt.trim(), stylePrompt].filter(Boolean).join('\n')
      form.set('provider_id', imageProvider.id); form.set('model', imageModel); form.set('prompt', finalPrompt)
      form.set('size', effectiveSize); form.set('quality', quality); form.set('count', String(count))
      form.set('background', background); form.set('output_format', outputFormat); form.set('output_compression', String(compression))
      referencedAssets.forEach(asset => form.append('reference_asset_ids', asset.id))
      libraryReferences.forEach(asset => form.append('library_reference_ids', asset.id))
      references.forEach(file => form.append('references', file))
      const run = await api<Run>(`/api/workspaces/${workspace.id}/generate`, { method: 'POST', body: form })
      if (run.status === 'completed') {
        const detail = await api<Workspace>(`/api/workspaces/${workspace.id}`)
        setWorkspace(detail); setSelectedId(run.assets[0]?.id ?? ''); setReferences([]); setReferencedAssets([])
        props.onQuota({ ...props.quota, used: props.quota.used + run.assets.length })
        props.onWorkspaces(props.workspaces.map(item => item.id === detail.id ? { ...item, image_count: detail.image_count, updated_at: detail.updated_at } : item))
      } else setWorkspace(current => current?.id === workspace.id ? { ...current, runs: [run, ...(current.runs ?? [])] } : current)
    } catch (err) {
      let hasBackgroundRun = false
      try {
        const detail = await api<Workspace>(`/api/workspaces/${workspace.id}`)
        setWorkspace(detail)
        hasBackgroundRun = (detail.runs ?? []).some(run => run.status === 'running')
      } catch { /* The original network error remains actionable. */ }
      if (!hasBackgroundRun) {
        if (err instanceof ApiError && typeof err.detail === 'object' && err.detail && 'code' in err.detail) setError('已达到 1000 张图片配额，请在创作库中清理不需要的图片')
        else setError(err instanceof Error ? err.message : '生成失败，请重试')
      }
    } finally { setBusy('') }
  }

  async function optimize() {
    setError('')
    if (!textProvider || !textModel || !textProvider.text_models.includes(textModel)) { openSettings('models'); setError('当前默认文本模型无效或属于图片模型，请在设置中重新选择语言模型'); return }
    if (!workspace || !prompt.trim()) { setError('请先输入提示词'); return }
    setBusy('optimize')
    try {
      const form = new FormData()
      form.set('provider_id', textProvider.id); form.set('model', textModel); form.set('prompt', prompt)
      form.set('style_prompt', stylePresets.find(item => item.id === style)?.prompt ?? '')
      form.set('size', effectiveSize); form.set('quality', quality); form.set('count', String(count))
      form.set('background', background); form.set('output_format', outputFormat); form.set('output_compression', String(compression))
      referencedAssets.forEach(asset => form.append('reference_asset_ids', asset.id))
      libraryReferences.forEach(asset => form.append('library_reference_ids', asset.id))
      references.forEach(file => form.append('references', file))
      const result = await api<{ suggestion: string }>(`/api/workspaces/${workspace.id}/optimize`, { method: 'POST', body: form })
      setPrompt(result.suggestion)
    } catch (err) { setError(err instanceof Error ? err.message : '润色失败，请重试') }
    finally { setBusy('') }
  }

  async function derivePresets() {
    setError('')
    if (!textProvider || !textModel) { openSettings('models'); setError('请先在设置中选择默认文本模型'); return }
    if (!workspace || !runs.some(run => run.status === 'completed' && run.assets.length > 0)) { setError('当前会话还没有成功生成的图片，暂时无法归纳预设'); return }
    setDeriving(true)
    try {
      const result = await api<DerivedPresetResult>(`/api/workspaces/${workspace.id}/derive-presets`, { method: 'POST' })
      setDerivedResult(result); setReviewOpen(true)
    } catch (err) { setError(err instanceof Error ? err.message : '归纳预设失败，请重试') }
    finally { setDeriving(false) }
  }

  async function favoriteAsset(asset: Asset) {
    const updated = await api<Asset>(`/api/assets/${asset.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: !asset.favorite }) })
    if (workspace) setWorkspace({ ...workspace, runs: runs.map(run => ({ ...run, assets: run.assets.map(item => item.id === updated.id ? updated : item) })) })
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm('删除这张图片？')) return
    await api(`/api/assets/${asset.id}`, { method: 'DELETE' })
    if (workspace) setWorkspace(await api<Workspace>(`/api/workspaces/${workspace.id}`))
    props.onQuota({ ...props.quota, used: Math.max(0, props.quota.used - 1) }); setSelectedId('')
  }

  function applyTheme(value: 'system' | 'light' | 'dark') {
    localStorage.setItem('studio-theme', value)
    if (value === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = value
    setThemeMenu(false)
  }

  async function finishGuide(openModels: boolean) {
    setShowGuide(false)
    if (!props.user.onboarding_completed) {
      try { props.onUser(await api<User>('/api/auth/preferences', { method: 'PATCH', body: JSON.stringify({ onboarding_completed: !openModels }) })) } catch { /* guide can still close */ }
    }
    if (openModels) openSettings('models')
  }

  function switchRefinementMode() {
    if (refinementMode === 'quick' && (!textProvider || !textModel || !textProvider.text_models.includes(textModel))) {
      openSettings('models')
      setError('请先在设置中选择有效的默认文本模型')
      return
    }
    setRefinementMode(current => current === 'quick' ? 'collaborate' : 'quick')
  }

  return <div className="studio-shell">
    <header className="topbar">
      <div className="topbar-left"><button className="icon-button" onClick={openSessions} aria-label="打开会话"><Menu /></button><div className="compact-brand"><Aperture /><span>Basil Studio</span></div></div>
      <div className="topbar-title"><h1>{workspace?.name ?? '新会话'}</h1></div>
      <div className="topbar-actions"><button className="derive-preset-button" aria-label="归纳当前会话预设" title="从当前会话归纳预设" onClick={derivePresets} disabled={deriving}>{deriving ? <LoaderCircle className="spin" /> : <Sparkles />}<span>{deriving ? '归纳中' : '归纳预设'}</span></button><div className="theme-control"><button className="icon-button" aria-label="切换主题" onClick={() => setThemeMenu(!themeMenu)}><Sun /></button>{themeMenu && <div className="menu" role="menu"><button role="menuitem" onClick={() => applyTheme('system')}>跟随系统</button><button role="menuitem" onClick={() => applyTheme('light')}>浅色</button><button role="menuitem" onClick={() => applyTheme('dark')}>深色</button></div>}</div><button className="icon-button" onClick={() => openSettings()} aria-label="打开设置"><Settings /></button></div>
    </header>

    {errors.length > 0 && <div className="error-stack" aria-label="错误通知">
      {errors.map(error => <div className="error-toast" role="alert" key={error.id}><AlertCircle /><span>{error.message}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setErrors(current => current.filter(item => item.id !== error.id))}><X /></button></div>)}
    </div>}

    <main className="workspace-main" style={{ '--timeline-width': `${timelineWidth}px`, '--dock-height': `${dockHeight}px` } as CSSProperties}>
      <aside className="run-timeline" aria-label="历史刻度"><div className="timeline-title"><History /><span>{runs.length}</span></div><div className="timeline-scroll">{timelineRuns.map((run, runIndex) => run.assets.length ? run.assets.map(asset => <div key={asset.id} className="timeline-thumb-shell"><button className={asset.id === selected?.id ? 'timeline-thumb active' : 'timeline-thumb'} aria-label={`查看第 ${runIndex + 1} 次生成`} title="拖到输入区以引用" draggable onDragStart={event => startAssetDrag(event, asset)} onDragEnd={() => setDraggingAssetId('')} onClick={() => restoreRun(run, asset.id)}><img draggable={false} className="contained-thumbnail" src={asset.content_url} alt="历史生成图" />{asset.favorite && <Star className="thumb-star" fill="currentColor" />}</button><button className="timeline-cite" aria-label={`引用第 ${runIndex + 1} 次生成继续修改`} title="引用此图继续修改" onClick={() => citeAsset(asset)}><PlusIcon /></button></div>) : <button key={run.id} className="timeline-failed" aria-label={`查看失败的第 ${runIndex + 1} 次生成`} onClick={() => restoreRun(run)}><X /><span>失败</span></button>)}</div></aside><div className="panel-resizer timeline-resizer" role="separator" aria-label="调整历史刻度宽度" aria-orientation="vertical" onPointerDown={event => startResize('timeline', event.clientX, event.clientY)} />

      <section className="output-stage" aria-label="图片输出">
        {selected ? <><div className="selected-image-wrap"><img key={selected.id} src={selected.content_url} alt="生成结果" className="selected-image viewport-fit-image" /></div><div className="image-actions"><button className="icon-button" aria-label="引用此图继续修改" title="引用此图继续修改" onClick={() => citeAsset(selected)}><ImagePlus /></button><button className={selected.favorite ? 'icon-button active-icon' : 'icon-button'} aria-label={selected.favorite ? '取消收藏图片' : '收藏图片'} onClick={() => favoriteAsset(selected)}><Heart fill={selected.favorite ? 'currentColor' : 'none'} /></button><a className="icon-button" href={selected.download_url} aria-label="下载图片"><Download /></a><button className="icon-button danger" aria-label="删除图片" onClick={() => deleteAsset(selected)}><Trash2 /></button></div><div className="image-meta">{selected.width} × {selected.height}</div></> : <div className="empty-output"><ImagePlus /><h2>从一个想法开始</h2><p>输入提示词，或添加参考图</p></div>}
        {isGenerating && <div className="generation-overlay" role="status"><LoaderCircle className="spin" /><strong>正在生成图片</strong><span>已等待 {elapsed} 秒，结果返回后会自动保存</span></div>}
      </section>

      <div className="panel-resizer dock-resizer" role="separator" aria-label="调整生成面板高度" aria-orientation="horizontal" onPointerDown={event => startResize('dock', event.clientX, event.clientY)} />
      <div className="panel-resizer corner-resizer" role="separator" aria-label="同时调整历史刻度宽度和生成面板高度" onPointerDown={event => startResize('both', event.clientX, event.clientY)} />

      <section className="generation-dock" aria-label="生成设置">
        <div role="region" aria-label="图片与提示词输入区" className={draggingAssetId ? 'dock-section input-zone reference-drop-active' : 'dock-section input-zone'} onDragOver={allowAssetDrop} onDrop={dropAsset} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingAssetId('') }}>
          <div className="reference-rail">
            <input ref={uploadRef} id="reference-upload" className="sr-only" type="file" accept="image/*" multiple onChange={addReferences} aria-label="上传参考图" />
            <div className="reference-rail-actions"><button className="icon-button" aria-label="添加参考图" title="添加参考图" onClick={() => uploadRef.current?.click()}><Upload /></button><button className="icon-button" aria-label="打开参考图库" title="参考图库" onClick={openReferenceLibrary}><ImagePlus /></button></div>
            <div className="reference-grid">
              {referencedAssets.map((asset, index) => <CitedAssetThumb key={asset.id} asset={asset} index={index + 1} onRemove={() => setReferencedAssets(current => current.filter(item => item.id !== asset.id))} />)}
              {libraryReferences.map((asset, index) => <LibraryReferenceThumb key={asset.id} asset={asset} index={referencedAssets.length + index + 1} onRemove={() => setLibraryReferences(current => current.filter(item => item.id !== asset.id))} />)}
              {references.map((file, index) => <ReferenceThumb key={`${file.name}-${file.size}-${file.lastModified}`} file={file} index={referencedAssets.length + libraryReferences.length + index + 1} onRemove={() => setReferences(current => current.filter(item => item !== file))} />)}
              {totalReferences < maxReferenceImages && <button className="reference-add" aria-label="继续添加参考图" onClick={() => uploadRef.current?.click()}><PlusIcon /></button>}
            </div>
          </div>

          <div className="prompt-workspace">
            <div className="prompt-toolbar">
              <label className="compact-select"><span className="sr-only">风格预设</span><select aria-label="风格预设" value={style} onChange={event => { if (event.target.value === '__manage__') { setStyle(''); openSettings('styles') } else setStyle(event.target.value) }}><option value="">无预设风格</option>{stylePresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="__manage__">管理 / 自定义风格…</option></select></label>
              <div className={`refinement-card ${refinementMode}`}>
                <button className="refinement-mode-control" aria-label={refinementMode === 'quick' ? '快速润色' : '提示词协作'} onClick={() => refinementMode === 'quick' ? optimize() : document.querySelector<HTMLTextAreaElement>('[aria-label="继续与提示词助手沟通"]')?.focus()} disabled={busy !== ''}>{busy === 'optimize' ? <LoaderCircle className="spin" /> : <Sparkles />}<span>{refinementMode === 'quick' ? '快速润色' : '提示词协作'}</span></button>
                <button className="refinement-flip" aria-label="切换润色模式" title="切换润色模式" onClick={switchRefinementMode}><Repeat2 /></button>
              </div>
            </div>
            {refinementMode === 'quick' ? <textarea ref={promptRef} aria-label="描述你想生成的图片" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述你想生成的图片" rows={4} /> : <PromptCollaboration active workspaceId={workspace?.id ?? ''} providerId={textProvider?.id ?? ''} model={textModel} stylePrompt={stylePresets.find(item => item.id === style)?.prompt ?? ''} settings={{ size: effectiveSize, quality, count: String(count), background, output_format: outputFormat }} referenceAssetIds={referencedAssets.map(asset => asset.id)} libraryReferenceIds={libraryReferences.map(asset => asset.id)} onSuggestion={setPrompt} onError={setError} />}
          </div>
        </div>

        <div className="dock-section settings-generate-zone">
          <div className="dock-heading"><span>02</span><strong>图片设置</strong></div>
          <label className="image-preset-select"><span>预设</span><select aria-label="图片设置预设" value={imagePreset} onChange={event => applyImagePreset(event.target.value)}><option value="custom">自定义设置</option>{imagePresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="parameter-grid"><label>尺寸<select value={size} onChange={event => { setSize(event.target.value); setImagePreset('custom') }}><option value="1024x1024">1:1 · 1024</option><option value="1536x1024">3:2 · 横向</option><option value="1024x1536">2:3 · 纵向</option><option value="2048x1152">16:9 · 2K</option><option value="3840x2160">16:9 · 4K</option><option value="custom">自定义</option></select></label>{size === 'custom' && <div className="custom-size"><label>宽<input type="number" min="256" max="3840" step="16" value={customWidth} onChange={event => { setCustomWidth(Number(event.target.value)); setImagePreset('custom') }} /></label><span>×</span><label>高<input type="number" min="256" max="3840" step="16" value={customHeight} onChange={event => { setCustomHeight(Number(event.target.value)); setImagePreset('custom') }} /></label></div>}<label>质量<select value={quality} onChange={event => { setQuality(event.target.value); setImagePreset('custom') }}><option value="auto">自动</option><option value="medium">标准</option><option value="high">高</option></select></label><label>数量<select value={count} onChange={event => { setCount(Number(event.target.value)); setImagePreset('custom') }}>{[1,2,3,4].map(item => <option key={item}>{item}</option>)}</select></label></div>
          <details className="advanced-settings"><summary>更多设置</summary><div><label>背景<select value={background} onChange={event => { setBackground(event.target.value); setImagePreset('custom') }}><option value="auto">自动</option><option value="opaque">不透明</option>{imageModel !== 'gpt-image-2' && <option value="transparent">透明</option>}</select></label><label>格式<select value={outputFormat} onChange={event => { setOutputFormat(event.target.value); setImagePreset('custom') }}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>{outputFormat !== 'png' && <label>压缩<input type="number" min="0" max="100" value={compression} onChange={event => { setCompression(Number(event.target.value)); setImagePreset('custom') }} /></label>}</div></details>
          <button className="primary-button generate-button" onClick={generate} disabled={busy !== '' || Boolean(activeRun)}>{isGenerating ? <LoaderCircle className="spin" /> : <Aperture />} 生成图片</button>
        </div>
      </section>
    </main>

    {libraryOpen && <div className="reference-library-popover" role="dialog" aria-label="参考图库"><header><strong>参考图库</strong><button className="icon-button" onClick={() => setLibraryOpen(false)}><X /></button></header><div>{libraryItems.map(asset => <button key={asset.id} className="library-item" onClick={() => selectLibraryReference(asset)}><img src={asset.content_url} alt="参考图库图片" /><span>{asset.width} × {asset.height}</span></button>) || <p>暂无已上传参考图</p>}</div></div>}
    <SessionDrawer open={sessionsOpen} currentId={currentId} workspaces={props.workspaces} favorites={favoriteAssets} quota={props.quota} onClose={() => setSessionsOpen(false)} onNew={newWorkspace} onLoad={loadWorkspace} onRename={renameWorkspace} onFavorite={favoriteWorkspace} onDelete={deleteWorkspace} onSelectFavorite={selectFavorite} />
    <SettingsDrawer open={settingsOpen} user={props.user} providers={props.providers} quota={props.quota} initialSection={settingsSection} onClose={() => setSettingsOpen(false)} onProviders={props.onProviders} onUser={props.onUser} onLogout={props.onLogout} />
    <PresetReviewDialog open={reviewOpen} result={derivedResult} user={props.user} onClose={() => setReviewOpen(false)} onUser={props.onUser} />
    {showGuide && <OnboardingGuide onConfigure={() => finishGuide(true)} onLater={() => finishGuide(false)} />}
  </div>
}

function PlusIcon() { return <span aria-hidden="true">+</span> }
