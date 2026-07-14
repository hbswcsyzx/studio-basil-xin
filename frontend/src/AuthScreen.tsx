import { FormEvent, useState } from 'react'
import { Aperture, ArrowRight, LoaderCircle } from 'lucide-react'
import { api } from './api'
import type { User } from './types'

export default function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      const user = await api<User>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password }) })
      onAuth(user)
    } catch (err) { setError(err instanceof Error ? err.message : '无法登录') }
    finally { setLoading(false) }
  }

  return <main className="auth-shell">
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="brand-mark"><Aperture aria-hidden="true" /><span>Studio Basil</span></div>
      <div className="auth-copy">
        <h1 id="auth-title">{mode === 'login' ? '继续创作' : '创建账户'}</h1>
        <p>{mode === 'login' ? '进入你的图片工作台' : '只需用户名和密码'}</p>
      </div>
      <form onSubmit={submit} className="auth-form">
        <label>用户名<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} /></label>
        <label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <ArrowRight />} {mode === 'login' ? '登录' : '注册'}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
        {mode === 'login' ? '没有账户？立即注册' : '已有账户？返回登录'}
      </button>
    </section>
  </main>
}

