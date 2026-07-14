import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Aperture, Check, ChevronDown, Download, History, ImagePlus, LoaderCircle, Menu, Moon, Plus, Settings, Sparkles, Sun, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError } from './api'
import SettingsDrawer from './SettingsDrawer'
import type { Asset, Provider, Quota, User, Workspace } from './types'

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

const sizes = ['1024x1024', '1536x1024', '1024x1536', '2048x1152', '3840x2160']

export default function Studio(props: Props) {
  const [currentId, setCurrentId] = useState(props.workspaces[0]?.id ?? '')
  const [workspace, setWorkspace] = useState<Workspace | null>(props.workspaces[0] ?? null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(props.user.must_change_password)
  const [themeMenu, setThemeMenu] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<File[]>([])
  const [providerId, setProviderId] = useState(props.providers[0]?.id ?? '')
  const provider = props.providers.find(item => item.id === providerId) ?? props.providers[0]
  const [model, setModel] = useState(provider?.models.find(item => item.includes('image')) ?? provider?.models[0] ?? '')
  const [llmModel, setLlmModel] = useState(provider?.models.find(item => !item.includes('image')) ?? '')
  const [size, setSize] = useState('2048x1152')
  const [quality, setQuality] = useState('high')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState<'generate' | 'optimize' | ''>('')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!providerId && props.providers[0]) chooseProvider(props.providers[0].id)
  }, [props.providers, providerId])

  const assets = useMemo(() => workspace?.runs?.flatMap(run => run.assets) ?? [], [workspace])
  const selected = assets.find(asset => asset.id === selectedId) ?? assets[0]

  async function loadWorkspace(id: string) {
    const detail = await api<Workspace>(`/api/workspaces/${id}`)
    setCurrentId(id); setWorkspace(detail); setSelectedId(detail.runs?.[0]?.assets[0]?.id ?? ''); setSessionsOpen(false)
  }

  async function newWorkspace() {
    const item = await api<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: `新会话 ${props.workspaces.length + 1}` }) })
    props.onWorkspaces([item, ...props.workspaces]); await loadWorkspace(item.id)
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('删除这个会话及其中所有图片？')) return
    await api(`/api/workspaces/${id}`, { method: 'DELETE' })
    const remaining = props.workspaces.filter(item => item.id !== id)
    props.onWorkspaces(remaining)
    if (id === currentId) {
      if (remaining[0]) await loadWorkspace(remaining[0].id)
      else { setWorkspace(null); setCurrentId('') }
    }
  }

  function chooseProvider(id: string) {
    setProviderId(id)
    const next = props.providers.find(item => item.id === id)
    setModel(next?.models.find(item => item.includes('image')) ?? next?.models[0] ?? '')
    setLlmModel(next?.models.find(item => !item.includes('image')) ?? '')
  }

  function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 4)
    setReferences(files)
  }

  async function generate() {
    setError('')
    if (!provider) { setSettingsOpen(true); setError('请先添加中转站并获取模型'); return }
    if (!workspace) { await newWorkspace(); return }
    if (!model) { setSettingsOpen(true); setError('请选择可用的图片模型'); return }
    if (!prompt.trim()) { setError('请输入提示词'); return }
    setBusy('generate')
    try {
      const form = new FormData()
      form.set('provider_id', provider.id); form.set('model', model); form.set('prompt', prompt)
      form.set('size', size); form.set('quality', quality); form.set('count', String(count))
      references.forEach(file => form.append('references', file))
      const run = await api<{ assets: Asset[] }>(`/api/workspaces/${workspace.id}/generate`, { method: 'POST', body: form })
      const detail = await api<Workspace>(`/api/workspaces/${workspace.id}`)
      setWorkspace(detail); setSelectedId(run.assets[0]?.id ?? ''); setReferences([])
      props.onQuota({ ...props.quota, used: props.quota.used + run.assets.length })
      props.onWorkspaces(props.workspaces.map(item => item.id === detail.id ? { ...item, image_count: detail.image_count, updated_at: detail.updated_at } : item))
    } catch (err) {
      if (err instanceof ApiError && typeof err.detail === 'object' && err.detail && 'code' in err.detail) setError('已达到 1000 张配额，请打开会话删除不需要的图片')
      else setError(err instanceof Error ? err.message : '生成失败')
    } finally { setBusy('') }
  }

  async function optimize() {
    setError('')
    if (!provider || !workspace || !llmModel) { setSettingsOpen(true); setError('请选择用于优化提示词的语言模型'); return }
    if (!prompt.trim()) { setError('请先输入提示词'); return }
    setBusy('optimize')
    try {
      const result = await api<{ suggestion: string }>(`/api/workspaces/${workspace.id}/optimize`, { method: 'POST', body: JSON.stringify({ provider_id: provider.id, model: llmModel, prompt }) })
      setPrompt(result.suggestion)
    } catch (err) { setError(err instanceof Error ? err.message : '优化失败') }
    finally { setBusy('') }
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm('删除这张图片？')) return
    await api(`/api/assets/${asset.id}`, { method: 'DELETE' })
    if (workspace) setWorkspace(await api<Workspace>(`/api/workspaces/${workspace.id}`))
    props.onQuota({ ...props.quota, used: Math.max(0, props.quota.used - 1) })
    setSelectedId('')
  }

  function applyTheme(value: 'system' | 'light' | 'dark') {
    localStorage.setItem('studio-theme', value)
    if (value === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = value
    setThemeMenu(false)
  }

  return <div className="studio-shell">
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button" onClick={() => setSessionsOpen(true)} aria-label="打开会话"><Menu /></button>
        <div className="compact-brand"><Aperture /><span>Studio</span></div>
      </div>
      <div className="topbar-title"><h1>{workspace?.name ?? '新会话'}</h1><span>{props.quota.used} / {props.quota.limit}</span></div>
      <div className="topbar-actions">
        <div className="theme-control"><button className="icon-button" aria-label="切换主题" onClick={() => setThemeMenu(!themeMenu)}><Sun /></button>
          {themeMenu && <div className="menu" role="menu"><button role="menuitem" onClick={() => applyTheme('system')}>跟随系统</button><button role="menuitem" onClick={() => applyTheme('light')}>浅色</button><button role="menuitem" onClick={() => applyTheme('dark')}>深色</button></div>}
        </div>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="打开设置"><Settings /></button>
      </div>
    </header>

    <main className="workspace-main">
      <section className="output-stage" aria-label="图片输出">
        {selected ? <>
          <div className="selected-image-wrap"><img src={selected.content_url} alt="生成结果" className="selected-image" /></div>
          <div className="image-actions"><a className="icon-button" href={selected.download_url} aria-label="下载图片"><Download /></a><button className="icon-button danger" aria-label="删除图片" onClick={() => deleteAsset(selected)}><Trash2 /></button></div>
        </> : <div className="empty-output"><ImagePlus /><h2>从一个想法开始</h2><p>输入提示词，或添加参考图</p></div>}
        {assets.length > 1 && <div className="filmstrip">{assets.map(asset => <button key={asset.id} className={asset.id === selected?.id ? 'thumb active' : 'thumb'} onClick={() => setSelectedId(asset.id)}><img src={asset.content_url} alt="生成缩略图" /></button>)}</div>}
      </section>

      <section className="generation-dock" aria-label="生成设置">
        <div className="prompt-row">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="描述你想生成的图片" rows={3} />
          <div className="prompt-actions">
            <input ref={uploadRef} id="reference-upload" className="sr-only" type="file" accept="image/*" multiple onChange={addReferences} aria-label="上传参考图" />
            <button className="icon-button" onClick={() => uploadRef.current?.click()} aria-label="选择参考图"><Upload /></button>
            <button className="secondary-button optimize-button" onClick={optimize} disabled={busy !== ''}>{busy === 'optimize' ? <LoaderCircle className="spin" /> : <Sparkles />}<span>优化提示词</span></button>
          </div>
        </div>
        {references.length > 0 && <div className="reference-list">{references.map(file => <span key={`${file.name}-${file.size}`}>{file.name}<button onClick={() => setReferences(references.filter(item => item !== file))} aria-label={`移除 ${file.name}`}><X /></button></span>)}</div>}
        <div className="parameter-row">
          <label>上游<select value={provider?.id ?? ''} onChange={e => chooseProvider(e.target.value)}><option value="">未配置</option>{props.providers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>图片模型<select value={model} onChange={e => setModel(e.target.value)}><option value="">选择模型</option>{provider?.models.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>尺寸<select value={size} onChange={e => setSize(e.target.value)}>{sizes.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>质量<select value={quality} onChange={e => setQuality(e.target.value)}><option value="auto">自动</option><option value="medium">标准</option><option value="high">高</option></select></label>
          <label>张数<select value={count} onChange={e => setCount(Number(e.target.value))}>{[1,2,3,4].map(item => <option key={item}>{item}</option>)}</select></label>
          <button className="primary-button generate-button" onClick={generate} disabled={busy !== ''}>{busy === 'generate' ? <LoaderCircle className="spin" /> : <Aperture />} 生成图片</button>
        </div>
        <div className="llm-model-row"><span>提示词模型</span><select value={llmModel} onChange={e => setLlmModel(e.target.value)}><option value="">未选择</option>{provider?.models.map(item => <option key={item}>{item}</option>)}</select></div>
        {error && <p className="dock-error" role="alert">{error}</p>}
      </section>
    </main>

    {sessionsOpen && <><button className="drawer-scrim" aria-label="关闭会话" onClick={() => setSessionsOpen(false)} /><aside className="drawer session-drawer">
      <header className="drawer-header"><div><span className="eyebrow">项目</span><h2>会话记录</h2></div><button className="icon-button" aria-label="关闭会话" onClick={() => setSessionsOpen(false)}><X /></button></header>
      <button className="secondary-button new-session" onClick={newWorkspace}><Plus /> 新建会话</button>
      <div className="session-list">{props.workspaces.map(item => <div key={item.id} className={item.id === currentId ? 'session-item active' : 'session-item'}>
        <button onClick={() => loadWorkspace(item.id)}><span>{item.name}</span><small>{item.image_count} 张</small></button>
        <button className="icon-button danger" aria-label={`删除 ${item.name}`} onClick={() => deleteWorkspace(item.id)}><Trash2 /></button>
      </div>)}</div>
    </aside></>}

    <SettingsDrawer open={settingsOpen} user={props.user} providers={props.providers} onClose={() => setSettingsOpen(false)} onProviders={props.onProviders} onUser={props.onUser} onLogout={props.onLogout} />
  </div>
}
