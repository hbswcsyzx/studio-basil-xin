import { FormEvent, useState } from 'react'
import { KeyRound, LoaderCircle, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { api } from './api'
import type { Provider, User } from './types'

type Props = {
  open: boolean
  user: User
  providers: Provider[]
  onClose: () => void
  onProviders: (providers: Provider[]) => void
  onUser: (user: User) => void
  onLogout: () => void
}

export default function SettingsDrawer(props: Props) {
  const [name, setName] = useState('我的中转站')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  async function addProvider(event: FormEvent) {
    event.preventDefault(); setBusy('save'); setError('')
    try {
      const provider = await api<Provider>('/api/providers', { method: 'POST', body: JSON.stringify({ name, base_url: baseUrl, api_key: apiKey }) })
      await api(`/api/providers/${provider.id}/models`, { method: 'POST' })
      props.onProviders(await api<Provider[]>('/api/providers')); setBaseUrl(''); setApiKey('')
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy('') }
  }

  async function refresh(id: string) {
    setBusy(`refresh-${id}`); setError('')
    try {
      const result = await api<{ models: string[] }>(`/api/providers/${id}/models`, { method: 'POST' })
      props.onProviders(props.providers.map(provider => provider.id === id ? { ...provider, models: result.models } : provider))
    } catch (err) { setError(err instanceof Error ? err.message : '获取模型失败') }
    finally { setBusy('') }
  }

  async function remove(id: string) {
    if (!confirm('删除这个上游配置？')) return
    await api(`/api/providers/${id}`, { method: 'DELETE' })
    props.onProviders(props.providers.filter(provider => provider.id !== id))
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy('password'); setError('')
    try {
      const user = await api<User>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) })
      props.onUser(user); setCurrentPassword(''); setNewPassword('')
    } catch (err) { setError(err instanceof Error ? err.message : '修改失败') }
    finally { setBusy('') }
  }

  if (!props.open) return null
  return <>
    <button className="drawer-scrim" aria-label="关闭设置" onClick={props.onClose} />
    <aside className="drawer settings-drawer" aria-label="设置侧栏">
      <header className="drawer-header"><div><span className="eyebrow">设置</span><h2>上游与账户</h2></div><button className="icon-button" onClick={props.onClose} aria-label="关闭设置"><X /></button></header>
      <div className="drawer-content">
        {props.user.must_change_password && <div className="notice warning"><KeyRound /><span>管理员初始密码需要立即修改。</span></div>}
        <section className="settings-section">
          <div className="section-heading"><h3>OpenAI 兼容上游</h3><span>{props.providers.length}</span></div>
          {props.providers.map(provider => <div className="provider-row" key={provider.id}>
            <div><strong>{provider.name}</strong><span>{provider.base_url}</span><small>{provider.models.length ? `${provider.models.length} 个模型` : '尚未获取模型'}</small></div>
            <button className="icon-button" onClick={() => refresh(provider.id)} aria-label={`刷新 ${provider.name} 模型`} disabled={busy === `refresh-${provider.id}`}><RefreshCw className={busy === `refresh-${provider.id}` ? 'spin' : ''} /></button>
            <button className="icon-button danger" onClick={() => remove(provider.id)} aria-label={`删除 ${provider.name}`}><Trash2 /></button>
          </div>)}
          <form className="settings-form" onSubmit={addProvider}>
            <label>名称<input value={name} onChange={e => setName(e.target.value)} required /></label>
            <label>中转站地址<input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://example.com" required /></label>
            <label>API Key<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." required /></label>
            <button className="secondary-button" disabled={busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" /> : <Plus />} 添加并获取模型</button>
          </form>
        </section>
        <section className="settings-section">
          <h3>修改密码</h3>
          <form className="settings-form" onSubmit={changePassword}>
            <label>当前密码<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /></label>
            <label>新密码<input type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required /></label>
            <button className="secondary-button" disabled={busy === 'password'}><Save /> 保存密码</button>
          </form>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="text-button danger-text" onClick={props.onLogout}>退出登录</button>
      </div>
    </aside>
  </>
}
