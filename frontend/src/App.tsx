import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { api } from './api'
import AuthScreen from './AuthScreen'
import Studio from './Studio'
import type { Provider, Quota, User, Workspace } from './types'
import './styles.css'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [quota, setQuota] = useState<Quota>({ used: 0, limit: 1000 })
  const [loading, setLoading] = useState(true)

  async function loadStudio(nextUser: User) {
    setUser(nextUser)
    const [workspaceItems, providerItems, quotaValue] = await Promise.all([
      api<Workspace[]>('/api/workspaces'), api<Provider[]>('/api/providers'), api<Quota>('/api/quota'),
    ])
    let items = workspaceItems
    if (items.length === 0) {
      const first = await api<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: '未命名会话' }) })
      items = [first]
    }
    const detail = await api<Workspace>(`/api/workspaces/${items[0].id}`)
    setWorkspaces([detail, ...items.slice(1)]); setProviders(providerItems); setQuota(quotaValue)
  }

  useEffect(() => {
    const theme = localStorage.getItem('studio-theme')
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    api<User>('/api/auth/me').then(loadStudio).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null); setWorkspaces([]); setProviders([])
  }

  if (loading) return <main className="loading-screen"><LoaderCircle className="spin" /><span>正在打开工作台</span></main>
  if (!user) return <AuthScreen onAuth={async next => { setLoading(true); try { await loadStudio(next) } finally { setLoading(false) } }} />
  return <Studio user={user} workspaces={workspaces} providers={providers} quota={quota} onUser={setUser} onWorkspaces={setWorkspaces} onProviders={setProviders} onQuota={setQuota} onLogout={logout} />
}

