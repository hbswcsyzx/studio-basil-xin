import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Check, CircleUserRound, Database, KeyRound, LoaderCircle, Mail, Palette, Plus, RefreshCw, Save, ServerCog, Settings2, Trash2, X } from 'lucide-react'
import { api } from './api'
import PresetManager from './PresetManager'
import type { Provider, Quota, SystemSettings, User } from './types'

type Section = 'overview' | 'models' | 'styles' | 'profile' | 'system'
type Props = {
  open: boolean
  user: User
  providers: Provider[]
  quota: Quota
  initialSection?: Section
  onClose: () => void
  onProviders: (providers: Provider[]) => void
  onUser: (user: User) => void
  onLogout: () => void
}

const emptySystem: SystemSettings = { smtp_host: '', smtp_port: 587, smtp_username: '', smtp_sender: '', smtp_tls: true, has_smtp_password: false }
const modelValue = (providerId?: string, model?: string) => providerId && model ? `${providerId}::${model}` : ''
const parseModelValue = (value: string) => { const index = value.indexOf('::'); return index < 0 ? ['', ''] : [value.slice(0, index), value.slice(index + 2)] }

export default function SettingsDrawer(props: Props) {
  const [section, setSection] = useState<Section>('overview')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [username, setUsername] = useState(props.user.username)
  const [email, setEmail] = useState(props.user.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [imageDefault, setImageDefault] = useState('')
  const [textDefault, setTextDefault] = useState('')
  const [historySummary, setHistorySummary] = useState(false)
  const [system, setSystem] = useState<SystemSettings>(emptySystem)
  const [smtpPassword, setSmtpPassword] = useState('')

  const imageOptions = useMemo(() => props.providers.flatMap(provider => provider.image_models.map(model => ({ provider, model }))), [props.providers])
  const textOptions = useMemo(() => props.providers.flatMap(provider => provider.text_models.map(model => ({ provider, model }))), [props.providers])
  const selectedImage = imageOptions.find(item => modelValue(item.provider.id, item.model) === imageDefault)
  const selectedText = textOptions.find(item => modelValue(item.provider.id, item.model) === textDefault)

  useEffect(() => {
    if (!props.open) return
    setSection(props.initialSection ?? (props.user.must_change_password ? 'profile' : 'overview'))
    setUsername(props.user.username); setEmail(props.user.email ?? '')
    setImageDefault(modelValue(props.user.preferences.default_image_provider_id, props.user.preferences.default_image_model))
    setTextDefault(modelValue(props.user.preferences.default_text_provider_id, props.user.preferences.default_text_model))
    setHistorySummary(Boolean(props.user.preferences.history_summary_enabled))
    setError(''); setSuccess('')
  }, [props.open, props.initialSection, props.user])

  useEffect(() => {
    if (!props.open || section !== 'system' || props.user.role !== 'admin') return
    api<SystemSettings>('/api/system/settings').then(setSystem).catch(err => setError(err instanceof Error ? err.message : '无法读取系统设置'))
  }, [props.open, section, props.user.role])

  function resetMessage() { setError(''); setSuccess('') }

  async function addProvider(event: FormEvent) {
    event.preventDefault(); setBusy('save'); resetMessage()
    try {
      const provider = await api<Provider>('/api/providers', { method: 'POST', body: JSON.stringify({ name, base_url: baseUrl, api_key: apiKey }) })
      await api(`/api/providers/${provider.id}/models`, { method: 'POST' })
      props.onProviders(await api<Provider[]>('/api/providers'))
      setName(''); setBaseUrl(''); setApiKey(''); setSuccess('渠道已添加，模型分类已更新')
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy('') }
  }

  async function refresh(id: string) {
    setBusy(`refresh-${id}`); resetMessage()
    try {
      await api(`/api/providers/${id}/models`, { method: 'POST' })
      props.onProviders(await api<Provider[]>('/api/providers')); setSuccess('模型列表已刷新')
    } catch (err) { setError(err instanceof Error ? err.message : '获取模型失败') }
    finally { setBusy('') }
  }

  async function remove(id: string) {
    if (!confirm('删除这个渠道配置？')) return
    await api(`/api/providers/${id}`, { method: 'DELETE' })
    props.onProviders(props.providers.filter(provider => provider.id !== id))
  }

  async function saveDefaults() {
    resetMessage()
    if (!imageDefault || !textDefault) { setError('请选择默认生图模型和文本模型'); return }
    const [imageProviderId, imageModel] = parseModelValue(imageDefault)
    const [textProviderId, textModel] = parseModelValue(textDefault)
    setBusy('defaults')
    try {
      const user = await api<User>('/api/auth/preferences', { method: 'PATCH', body: JSON.stringify({
        default_image_provider_id: imageProviderId, default_image_model: imageModel,
        default_text_provider_id: textProviderId, default_text_model: textModel,
        history_summary_enabled: historySummary, onboarding_completed: true,
      }) })
      props.onUser(user); setSuccess('默认模型已保存，创作时无需再次选择')
    } catch (err) { setError(err instanceof Error ? err.message : '保存默认模型失败') }
    finally { setBusy('') }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy('profile'); resetMessage()
    try {
      props.onUser(await api<User>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ username, email }) }))
      setSuccess('个人信息已保存')
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy('') }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy('password'); resetMessage()
    try {
      props.onUser(await api<User>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }))
      setCurrentPassword(''); setNewPassword(''); setSuccess('密码已更新')
    } catch (err) { setError(err instanceof Error ? err.message : '修改失败') }
    finally { setBusy('') }
  }

  async function saveSystem(event: FormEvent) {
    event.preventDefault(); setBusy('system'); resetMessage()
    try {
      setSystem(await api<SystemSettings>('/api/system/settings', { method: 'PATCH', body: JSON.stringify({ ...system, smtp_password: smtpPassword || undefined }) }))
      setSmtpPassword(''); setSuccess('系统设置已保存')
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy('') }
  }

  if (!props.open) return null
  return <>
    <button className="drawer-scrim" aria-label="关闭设置" onClick={props.onClose} />
    <aside className="drawer settings-drawer" aria-label="设置侧栏">
      <header className="drawer-header"><div><span className="eyebrow">Studio Basil</span><h2>设置</h2></div><button className="icon-button" onClick={props.onClose} aria-label="关闭设置"><X /></button></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置目录">
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Settings2 />概览</button>
          <button className={section === 'models' ? 'active' : ''} onClick={() => setSection('models')}><Database />添加模型</button>
          <button className={section === 'styles' ? 'active' : ''} onClick={() => setSection('styles')}><Palette />预设管理</button>
          <button className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}><CircleUserRound />个人信息</button>
          {props.user.role === 'admin' && <button className={section === 'system' ? 'active' : ''} onClick={() => setSection('system')}><ServerCog />系统设置</button>}
        </nav>
        <div className="settings-content">
          {props.user.must_change_password && <div className="notice warning"><KeyRound /><span>管理员初始密码需要立即修改。</span></div>}

          {section === 'overview' && <section className="settings-view">
            <div className="view-heading"><span className="eyebrow">当前状态</span><h3>工作台概览</h3><p>正常创作时不会显示渠道和模型，默认值只在这里管理。</p></div>
            <dl className="settings-summary">
              <div><dt>已添加渠道</dt><dd>{props.providers.length}</dd></div>
              <div><dt>默认生图</dt><dd>{selectedImage ? `${selectedImage.provider.name} · ${selectedImage.model}` : '尚未设置'}</dd></div>
              <div><dt>默认文本</dt><dd>{selectedText ? `${selectedText.provider.name} · ${selectedText.model}` : '尚未设置'}</dd></div>
            </dl>
            <div className="quota-summary" aria-label="额度使用情况">
              <div className="quota-meter">
                <div><span>图片额度</span><strong>{props.quota.used} / {props.quota.limit}</strong></div>
                <div className="quota-track" role="progressbar" aria-label="图片额度" aria-valuemin={0} aria-valuemax={props.quota.limit} aria-valuenow={props.quota.used}><span style={{ width: `${Math.min(100, Math.max(0, props.quota.limit ? props.quota.used / props.quota.limit * 100 : 0))}%` }} /></div>
              </div>
              <div className="quota-meter">
                <div><span>会话额度</span><strong>{props.quota.conversations_used} / {props.quota.conversations_limit}</strong></div>
                <div className="quota-track" role="progressbar" aria-label="会话额度" aria-valuemin={0} aria-valuemax={props.quota.conversations_limit} aria-valuenow={props.quota.conversations_used}><span style={{ width: `${Math.min(100, Math.max(0, props.quota.conversations_limit ? props.quota.conversations_used / props.quota.conversations_limit * 100 : 0))}%` }} /></div>
              </div>
            </div>
            <button className="secondary-button" onClick={() => setSection('models')}>管理渠道与默认模型</button>
          </section>}

          {section === 'models' && <section className="settings-view">
            <div className="view-heading"><span className="eyebrow">渠道与模型</span><h3>添加模型</h3><p>添加渠道后自动获取模型，并按用途分类。</p></div>
            <div className="provider-list">{props.providers.map(provider => <div className="provider-row" key={provider.id}>
              <div><strong>{provider.name}</strong><span>{provider.base_url}</span><small>{provider.image_models.length} 个生图 · {provider.text_models.length} 个文本</small></div>
              <button className="icon-button" onClick={() => refresh(provider.id)} aria-label={`刷新 ${provider.name} 模型`} disabled={busy === `refresh-${provider.id}`}><RefreshCw className={busy === `refresh-${provider.id}` ? 'spin' : ''} /></button>
              <button className="icon-button danger" onClick={() => remove(provider.id)} aria-label={`删除 ${provider.name}`}><Trash2 /></button>
              <div className="model-tags"><span>生图：{provider.image_models.join('、') || '无'}</span><span>文本：{provider.text_models.join('、') || '无'}</span></div>
            </div>)}</div>
            <form className="settings-form provider-form" onSubmit={addProvider}>
              <h4>添加新渠道</h4>
              <label>渠道名称<input value={name} onChange={event => setName(event.target.value)} placeholder="例如 Basil Image" required /></label>
              <label>中转站地址<input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://example.com" required /></label>
              <label>API Key<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-..." required /></label>
              <button className="secondary-button" disabled={busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" /> : <Plus />} 添加并获取模型</button>
            </form>
            <div className="default-models">
              <h4>常用模型</h4>
              <label>默认生图模型<select value={imageDefault} onChange={event => setImageDefault(event.target.value)}><option value="">请选择</option>{imageOptions.map(item => <option key={modelValue(item.provider.id, item.model)} value={modelValue(item.provider.id, item.model)}>{item.provider.name} · {item.model}</option>)}</select></label>
              <label>默认文本模型<select value={textDefault} onChange={event => setTextDefault(event.target.value)}><option value="">请选择</option>{textOptions.map(item => <option key={modelValue(item.provider.id, item.model)} value={modelValue(item.provider.id, item.model)}>{item.provider.name} · {item.model}</option>)}</select></label>
              <label className="toggle-row"><input type="checkbox" checked={historySummary} onChange={event => setHistorySummary(event.target.checked)} /><span>允许未来基于本账户历史总结本地创作模板</span></label>
              <button className="primary-button" onClick={saveDefaults} disabled={busy === 'defaults'}>{busy === 'defaults' ? <LoaderCircle className="spin" /> : <Check />} 保存为默认</button>
            </div>
          </section>}

          {section === 'styles' && <PresetManager user={props.user} onUser={props.onUser} />}

          {section === 'profile' && <section className="settings-view">
            <div className="view-heading"><span className="eyebrow">账户</span><h3>个人信息</h3></div>
            <form className="settings-form" onSubmit={saveProfile}><label>用户名<input value={username} onChange={event => setUsername(event.target.value)} required /></label><label>邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></label><button className="secondary-button" disabled={busy === 'profile'}><Save /> 保存个人信息</button></form>
            <form className="settings-form separated-form" onSubmit={changePassword}><h4>修改密码</h4><label>当前密码<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label><label>新密码<input type="password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label><button className="secondary-button" disabled={busy === 'password'}><KeyRound /> 更新密码</button></form>
            <button className="text-button danger-text" onClick={props.onLogout}>退出登录</button>
          </section>}

          {section === 'system' && props.user.role === 'admin' && <section className="settings-view">
            <div className="view-heading"><span className="eyebrow">管理员</span><h3>系统设置</h3><p>SMTP 密码加密保存，不会在页面中回显。</p></div>
            <form className="settings-form" onSubmit={saveSystem}><label>SMTP 主机<input value={system.smtp_host} onChange={event => setSystem({ ...system, smtp_host: event.target.value })} /></label><label>端口<input type="number" min="1" max="65535" value={system.smtp_port} onChange={event => setSystem({ ...system, smtp_port: Number(event.target.value) })} /></label><label>用户名<input value={system.smtp_username} onChange={event => setSystem({ ...system, smtp_username: event.target.value })} /></label><label>密码<input type="password" value={smtpPassword} onChange={event => setSmtpPassword(event.target.value)} placeholder={system.has_smtp_password ? '已设置，留空则不修改' : ''} /></label><label>发件地址<input type="email" value={system.smtp_sender} onChange={event => setSystem({ ...system, smtp_sender: event.target.value })} /></label><label className="toggle-row"><input type="checkbox" checked={system.smtp_tls} onChange={event => setSystem({ ...system, smtp_tls: event.target.checked })} /><span><Mail /> 使用 TLS</span></label><button className="primary-button" disabled={busy === 'system'}><Save /> 保存系统设置</button></form>
          </section>}

          {error && <p className="form-error settings-message" role="alert">{error}</p>}
          {success && <p className="form-success settings-message" role="status">{success}</p>}
        </div>
      </div>
    </aside>
  </>
}
