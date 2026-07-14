import { useState } from 'react'
import { Check, Images, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import type { Asset, Quota, Workspace } from './types'

type Props = {
  open: boolean
  currentId: string
  workspaces: Workspace[]
  favorites: Asset[]
  quota: Quota
  onClose: () => void
  onNew: () => void
  onLoad: (id: string) => void
  onRename: (id: string, name: string) => void
  onFavorite: (workspace: Workspace) => void
  onDelete: (id: string) => void
  onSelectFavorite: (asset: Asset) => void
}

export default function SessionDrawer(props: Props) {
  const [tab, setTab] = useState<'sessions' | 'favorites'>('sessions')
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  if (!props.open) return null

  function startRename(workspace: Workspace) { setEditing(workspace.id); setDraft(workspace.name) }
  function commitRename() {
    if (editing && draft.trim()) props.onRename(editing, draft.trim())
    setEditing('')
  }

  return <>
    <button className="drawer-scrim" aria-label="关闭会话" onClick={props.onClose} />
    <aside className="drawer session-drawer" aria-label="会话与收藏">
      <header className="drawer-header"><div><span className="eyebrow">工作记录</span><h2>创作库</h2></div><button className="icon-button" aria-label="关闭会话" onClick={props.onClose}><X /></button></header>
      <div className="drawer-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>会话</button>
        <button role="tab" aria-selected={tab === 'favorites'} onClick={() => setTab('favorites')}>收藏图片</button>
      </div>
      {tab === 'sessions' ? <>
        <button className="secondary-button new-session" onClick={props.onNew} disabled={props.quota.conversations_used >= props.quota.conversations_limit}><Plus /> 新建会话</button>
        <p className="drawer-quota">{props.quota.conversations_used} / {props.quota.conversations_limit} 个会话</p>
        <div className="session-list">{props.workspaces.map(item => <div key={item.id} className={item.id === props.currentId ? 'session-item active' : 'session-item'}>
          {editing === item.id ? <div className="rename-row"><input aria-label="会话名称" value={draft} onChange={event => setDraft(event.target.value)} /><button className="icon-button" aria-label="保存名称" onClick={commitRename}><Check /></button></div> : <button className="session-main" onClick={() => props.onLoad(item.id)}><span>{item.name}</span><small>{item.image_count} 张</small></button>}
          <div className="session-actions">
            <button className={item.favorite ? 'icon-button active-icon' : 'icon-button'} aria-label={item.favorite ? `取消收藏 ${item.name}` : `收藏 ${item.name}`} onClick={() => props.onFavorite(item)}><Star fill={item.favorite ? 'currentColor' : 'none'} /></button>
            <button className="icon-button" aria-label={`重命名 ${item.name}`} onClick={() => startRename(item)}><Pencil /></button>
            <button className="icon-button danger" aria-label={`删除 ${item.name}`} onClick={() => props.onDelete(item.id)}><Trash2 /></button>
          </div>
        </div>)}</div>
      </> : <div className="favorite-gallery">
        {props.favorites.length ? props.favorites.map(asset => <button key={asset.id} onClick={() => props.onSelectFavorite(asset)}>
          <img className="contained-thumbnail" src={asset.content_url} alt="收藏图片" /><span>{asset.prompt || '未记录提示词'}</span>
        </button>) : <div className="empty-drawer"><Images /><p>还没有收藏图片</p></div>}
      </div>}
    </aside>
  </>
}
