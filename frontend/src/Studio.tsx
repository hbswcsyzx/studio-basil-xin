import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Aperture, Download, Heart, History, ImagePlus, LoaderCircle, Menu, Settings, Sparkles, Star, Sun, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError } from './api'
import OnboardingGuide from './OnboardingGuide'
import SessionDrawer from './SessionDrawer'
import SettingsDrawer from './SettingsDrawer'
import { validateImageSize } from './imageSize'
import { resolveStylePresets } from './stylePresets'
import type { Asset, Provider, Quota, Run, User, Workspace } from './types'

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

function ReferenceThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!URL.createObjectURL) return
    const value = URL.createObjectURL(file); setSrc(value)
    return () => URL.revokeObjectURL(value)
  }, [file])
  return <div className="reference-thumb">{src ? <img className="contained-thumbnail" src={src} alt={file.name} /> : <ImagePlus />}<button aria-label={`移除 ${file.name}`} onClick={onRemove}><X /></button></div>
}

function CitedAssetThumb({ asset, onRemove }: { asset: Asset; onRemove: () => void }) {
  return <div className="reference-thumb cited-reference"><img className="contained-thumbnail" src={asset.content_url} alt="已引用的生成图片" /><button aria-label="移除引用图片" onClick={onRemove}><X /></button></div>
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
  const [style, setStyle] = useState('')
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
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [draggingAssetId, setDraggingAssetId] = useState('')
  const [favoriteAssets, setFavoriteAssets] = useState<Asset[]>([])
  const uploadRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const runs = workspace?.runs ?? []
  const timelineRuns = useMemo(() => [...runs].reverse(), [runs])
  const assets = useMemo(() => runs.flatMap(run => run.assets), [runs])
  const selected = assets.find(asset => asset.id === selectedId) ?? assets[0]
  const imageProvider = props.providers.find(item => item.id === props.user.preferences.default_image_provider_id)
  const textProvider = props.providers.find(item => item.id === props.user.preferences.default_text_provider_id)
  const imageModel = props.user.preferences.default_image_model ?? ''
  const textModel = props.user.preferences.default_text_model ?? ''
  const stylePresets = useMemo(() => resolveStylePresets(props.user.preferences), [props.user.preferences])
  const effectiveSize = size === 'custom' ? `${customWidth}x${customHeight}` : size

  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    if (imageModel === 'gpt-image-2' && background === 'transparent') setBackground('auto')
  }, [background, imageModel])

  function openSettings(section: SettingsSection = 'overview') { setSettingsSection(section); setSettingsOpen(true) }

  async function loadWorkspace(id: string, preferredAsset = '') {
    const detail = await api<Workspace>(`/api/workspaces/${id}`)
    setCurrentId(id); setWorkspace(detail); setSelectedId(preferredAsset || detail.runs?.[0]?.assets[0]?.id || ''); setReferences([]); setReferencedAssets([]); setSessionsOpen(false)
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

  function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setReferences(current => [...current, ...files].slice(0, Math.max(0, 4 - referencedAssets.length)))
    event.target.value = ''
  }

  function citeAsset(asset: Asset) {
    if (referencedAssets.some(item => item.id === asset.id)) return
    if (references.length + referencedAssets.length >= 4) { setError('参考图总数不能超过 4 张'); return }
    setReferencedAssets(current => [...current, asset])
    setPrompt('')
    setError('')
    window.requestAnimationFrame(() => promptRef.current?.focus())
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
    setPrompt(run.prompt); setStyle('')
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
      references.forEach(file => form.append('references', file))
      const run = await api<{ assets: Asset[] }>(`/api/workspaces/${workspace.id}/generate`, { method: 'POST', body: form })
      const detail = await api<Workspace>(`/api/workspaces/${workspace.id}`)
      setWorkspace(detail); setSelectedId(run.assets[0]?.id ?? ''); setReferences([]); setReferencedAssets([])
      props.onQuota({ ...props.quota, used: props.quota.used + run.assets.length })
      props.onWorkspaces(props.workspaces.map(item => item.id === detail.id ? { ...item, image_count: detail.image_count, updated_at: detail.updated_at } : item))
    } catch (err) {
      if (err instanceof ApiError && typeof err.detail === 'object' && err.detail && 'code' in err.detail) setError('已达到 1000 张图片配额，请在创作库中清理不需要的图片')
      else setError(err instanceof Error ? err.message : '生成失败，请重试')
      try { setWorkspace(await api<Workspace>(`/api/workspaces/${workspace.id}`)) } catch { /* keep current result */ }
    } finally { setBusy('') }
  }

  async function optimize() {
    setError('')
    if (!textProvider || !textModel) { openSettings('models'); setError('请先在设置中选择默认文本模型'); return }
    if (!workspace || !prompt.trim()) { setError('请先输入提示词'); return }
    setBusy('optimize')
    try {
      const result = await api<{ suggestion: string }>(`/api/workspaces/${workspace.id}/optimize`, { method: 'POST', body: JSON.stringify({ provider_id: textProvider.id, model: textModel, prompt }) })
      setPrompt(result.suggestion)
    } catch (err) { setError(err instanceof Error ? err.message : '润色失败，请重试') }
    finally { setBusy('') }
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

  return <div className="studio-shell">
    <header className="topbar">
      <div className="topbar-left"><button className="icon-button" onClick={openSessions} aria-label="打开会话"><Menu /></button><div className="compact-brand"><Aperture /><span>Basil Studio</span></div></div>
      <div className="topbar-title"><h1>{workspace?.name ?? '新会话'}</h1></div>
      <div className="topbar-actions"><div className="theme-control"><button className="icon-button" aria-label="切换主题" onClick={() => setThemeMenu(!themeMenu)}><Sun /></button>{themeMenu && <div className="menu" role="menu"><button role="menuitem" onClick={() => applyTheme('system')}>跟随系统</button><button role="menuitem" onClick={() => applyTheme('light')}>浅色</button><button role="menuitem" onClick={() => applyTheme('dark')}>深色</button></div>}</div><button className="icon-button" onClick={() => openSettings()} aria-label="打开设置"><Settings /></button></div>
    </header>

    <main className="workspace-main">
      <aside className="run-timeline" aria-label="历史刻度"><div className="timeline-title"><History /><span>{runs.length}</span></div><div className="timeline-scroll">{timelineRuns.map((run, runIndex) => run.assets.length ? run.assets.map(asset => <div key={asset.id} className="timeline-thumb-shell"><button className={asset.id === selected?.id ? 'timeline-thumb active' : 'timeline-thumb'} aria-label={`查看第 ${runIndex + 1} 次生成`} title="拖到输入区以引用" draggable onDragStart={event => startAssetDrag(event, asset)} onDragEnd={() => setDraggingAssetId('')} onClick={() => restoreRun(run, asset.id)}><img draggable={false} className="contained-thumbnail" src={asset.content_url} alt="历史生成图" />{asset.favorite && <Star className="thumb-star" fill="currentColor" />}</button><button className="timeline-cite" aria-label={`引用第 ${runIndex + 1} 次生成继续修改`} title="引用此图继续修改" onClick={() => citeAsset(asset)}><PlusIcon /></button></div>) : <button key={run.id} className="timeline-failed" aria-label={`查看失败的第 ${runIndex + 1} 次生成`} onClick={() => restoreRun(run)}><X /><span>失败</span></button>)}</div></aside>

      <section className="output-stage" aria-label="图片输出">
        {selected ? <><div className="selected-image-wrap"><img key={selected.id} src={selected.content_url} alt="生成结果" className="selected-image viewport-fit-image" /></div><div className="image-actions"><button className="icon-button" aria-label="引用此图继续修改" title="引用此图继续修改" onClick={() => citeAsset(selected)}><ImagePlus /></button><button className={selected.favorite ? 'icon-button active-icon' : 'icon-button'} aria-label={selected.favorite ? '取消收藏图片' : '收藏图片'} onClick={() => favoriteAsset(selected)}><Heart fill={selected.favorite ? 'currentColor' : 'none'} /></button><a className="icon-button" href={selected.download_url} aria-label="下载图片"><Download /></a><button className="icon-button danger" aria-label="删除图片" onClick={() => deleteAsset(selected)}><Trash2 /></button></div><div className="image-meta">{selected.width} × {selected.height}</div></> : <div className="empty-output"><ImagePlus /><h2>从一个想法开始</h2><p>输入提示词，或添加参考图</p></div>}
        {busy === 'generate' && <div className="generation-overlay" role="status"><LoaderCircle className="spin" /><strong>{references.length + referencedAssets.length ? '正在参考图片生成' : '正在生成图片'}</strong><span>已等待 {elapsed} 秒，结果返回后会自动保存</span></div>}
      </section>

      <section className="generation-dock" aria-label="生成设置">
        <div role="region" aria-label="图片与提示词输入区" className={draggingAssetId ? 'dock-section input-zone reference-drop-active' : 'dock-section input-zone'} onDragOver={allowAssetDrop} onDrop={dropAsset} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingAssetId('') }}><div className="dock-heading"><span>01</span><strong>输入</strong></div><textarea ref={promptRef} aria-label="描述你想生成的图片" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述你想生成的图片" rows={4} /><div className="input-tools"><input ref={uploadRef} id="reference-upload" className="sr-only" type="file" accept="image/*" multiple onChange={addReferences} aria-label="上传参考图" /><button className="secondary-button" onClick={() => uploadRef.current?.click()}><Upload /> 参考图</button><label className="compact-select"><span className="sr-only">风格预设</span><select aria-label="风格预设" value={style} onChange={event => { if (event.target.value === '__manage__') { setStyle(''); openSettings('styles') } else setStyle(event.target.value) }}><option value="">无预设风格</option>{stylePresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="__manage__">管理 / 自定义风格…</option></select></label><button className="secondary-button" onClick={optimize} disabled={busy !== ''}>{busy === 'optimize' ? <LoaderCircle className="spin" /> : <Sparkles />} 一键润色</button></div>{references.length + referencedAssets.length > 0 && <div className="reference-grid">{referencedAssets.map(asset => <CitedAssetThumb key={asset.id} asset={asset} onRemove={() => setReferencedAssets(current => current.filter(item => item.id !== asset.id))} />)}{references.map(file => <ReferenceThumb key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setReferences(current => current.filter(item => item !== file))} />)}{references.length + referencedAssets.length < 4 && <button className="reference-add" aria-label="继续添加参考图" onClick={() => uploadRef.current?.click()}><PlusIcon /></button>}</div>}</div>

        <div className="dock-section params-zone"><div className="dock-heading"><span>02</span><strong>图片设置</strong></div><div className="parameter-grid"><label>尺寸<select value={size} onChange={event => setSize(event.target.value)}><option value="1024x1024">1:1 · 1024</option><option value="1536x1024">3:2 · 横向</option><option value="1024x1536">2:3 · 纵向</option><option value="2048x1152">16:9 · 2K</option><option value="3840x2160">16:9 · 4K</option><option value="custom">自定义</option></select></label>{size === 'custom' && <div className="custom-size"><label>宽<input type="number" min="256" max="3840" step="16" value={customWidth} onChange={event => setCustomWidth(Number(event.target.value))} /></label><span>×</span><label>高<input type="number" min="256" max="3840" step="16" value={customHeight} onChange={event => setCustomHeight(Number(event.target.value))} /></label></div>}<label>质量<select value={quality} onChange={event => setQuality(event.target.value)}><option value="auto">自动</option><option value="medium">标准</option><option value="high">高</option></select></label><label>数量<select value={count} onChange={event => setCount(Number(event.target.value))}>{[1,2,3,4].map(item => <option key={item}>{item}</option>)}</select></label></div><details className="advanced-settings"><summary>更多设置</summary><div><label>背景<select value={background} onChange={event => setBackground(event.target.value)}><option value="auto">自动</option><option value="opaque">不透明</option>{imageModel !== 'gpt-image-2' && <option value="transparent">透明</option>}</select></label><label>格式<select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>{outputFormat !== 'png' && <label>压缩<input type="number" min="0" max="100" value={compression} onChange={event => setCompression(Number(event.target.value))} /></label>}</div></details></div>

        <div className="dock-section action-zone"><div className="dock-heading"><span>03</span><strong>生成</strong></div><div className={references.length + referencedAssets.length ? 'mode-indicator reference-mode' : 'mode-indicator'}><span>生成 {count} 张</span><small>{references.length + referencedAssets.length ? `${references.length + referencedAssets.length} 张参考图` : '无参考图'}</small><small>{effectiveSize} · {quality === 'high' ? '高质量' : quality === 'medium' ? '标准' : '自动'}</small></div><button className="primary-button generate-button" onClick={generate} disabled={busy !== ''}>{busy === 'generate' ? <LoaderCircle className="spin" /> : <Aperture />} 生成图片</button></div>
        {error && <p className="dock-error" role="alert">{error}</p>}
      </section>
    </main>

    <SessionDrawer open={sessionsOpen} currentId={currentId} workspaces={props.workspaces} favorites={favoriteAssets} quota={props.quota} onClose={() => setSessionsOpen(false)} onNew={newWorkspace} onLoad={loadWorkspace} onRename={renameWorkspace} onFavorite={favoriteWorkspace} onDelete={deleteWorkspace} onSelectFavorite={selectFavorite} />
    <SettingsDrawer open={settingsOpen} user={props.user} providers={props.providers} quota={props.quota} initialSection={settingsSection} onClose={() => setSettingsOpen(false)} onProviders={props.onProviders} onUser={props.onUser} onLogout={props.onLogout} />
    {showGuide && <OnboardingGuide onConfigure={() => finishGuide(true)} onLater={() => finishGuide(false)} />}
  </div>
}

function PlusIcon() { return <span aria-hidden="true">+</span> }
