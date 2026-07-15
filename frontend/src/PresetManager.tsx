import { useEffect, useState } from 'react'
import { Image, LoaderCircle, Palette, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from './api'
import { defaultImagePresets, defaultStylePresets, resolveImagePresets, resolveStylePresets } from './presetDefaults'
import type { ImagePreset, StylePreset, User } from './types'

type Props = { user: User; onUser: (user: User) => void }
type View = 'styles' | 'images'

export default function PresetManager({ user, onUser }: Props) {
  const [view, setView] = useState<View>('styles')
  const [styles, setStyles] = useState<StylePreset[]>(resolveStylePresets(user.preferences))
  const [images, setImages] = useState<ImagePreset[]>(resolveImagePresets(user.preferences))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setStyles(resolveStylePresets(user.preferences).map(item => ({ ...item })))
    setImages(resolveImagePresets(user.preferences).map(item => ({ ...item })))
    setDirty(false)
  }, [user])

  async function persist(payload: { style_presets?: StylePreset[]; image_presets?: ImagePreset[] }, nextMessage: string) {
    const updated = await api<User>('/api/auth/preferences', { method: 'PATCH', body: JSON.stringify(payload) })
    onUser(updated); setMessage(nextMessage); setDirty(false)
  }

  function updateStyle(id: string, changes: Partial<StylePreset>) {
    setStyles(items => items.map(item => item.id === id ? { ...item, ...changes } : item)); setDirty(true); setMessage('')
  }

  function updateImage(id: string, changes: Partial<ImagePreset>) {
    setImages(items => items.map(item => item.id === id ? { ...item, ...changes } : item)); setDirty(true); setMessage('')
  }

  async function deleteStyle(item: StylePreset) {
    if (!confirm(`删除“${item.name}”风格预设？`)) return
    const next = styles.filter(value => value.id !== item.id); setBusy(`delete-${item.id}`)
    try { await persist({ style_presets: next }, '风格预设已删除'); setStyles(next) } finally { setBusy('') }
  }

  async function deleteImage(item: ImagePreset) {
    if (!confirm(`删除“${item.name}”图片预设？`)) return
    const next = images.filter(value => value.id !== item.id); setBusy(`delete-${item.id}`)
    try { await persist({ image_presets: next }, '图片设置预设已删除'); setImages(next) } finally { setBusy('') }
  }

  async function restoreStyles() {
    const existing = new Set(styles.map(item => item.id))
    const next = [...styles, ...defaultStylePresets.filter(item => !existing.has(item.id)).map(item => ({ ...item }))]
    setBusy('restore-styles'); try { await persist({ style_presets: next }, '已恢复缺失的内置风格'); setStyles(next) } finally { setBusy('') }
  }

  async function restoreImages() {
    const existing = new Set(images.map(item => item.id))
    const next = [...images, ...defaultImagePresets.filter(item => !existing.has(item.id)).map(item => ({ ...item }))]
    setBusy('restore-images'); try { await persist({ image_presets: next }, '已恢复缺失的内置图片预设'); setImages(next) } finally { setBusy('') }
  }

  async function saveStyles() {
    const next = styles.map(item => ({ ...item, name: item.name.trim(), prompt: item.prompt.trim() })).filter(item => item.name && item.prompt)
    setBusy('save-styles'); try { await persist({ style_presets: next }, '风格预设已保存'); setStyles(next) } finally { setBusy('') }
  }

  async function saveImages() {
    const next = images.map(item => ({ ...item, name: item.name.trim() })).filter(item => item.name)
    setBusy('save-images'); try { await persist({ image_presets: next }, '图片设置预设已保存'); setImages(next) } finally { setBusy('') }
  }

  function addStyle() {
    setStyles(items => [...items, { id: `custom-style-${Date.now().toString(36)}`, name: '自定义风格', prompt: '描述需要稳定保持的视觉媒介、材质、光影、色彩、构图和细节约束。', builtin: false }]); setDirty(true)
  }

  function addImage() {
    setImages(items => [...items, { id: `custom-image-${Date.now().toString(36)}`, name: '自定义图片设置', size: '1024x1024', quality: 'auto', count: 1, background: 'auto', output_format: 'png', output_compression: 100, builtin: false }]); setDirty(true)
  }

  return <section className="settings-view preset-manager">
    <div className="view-heading"><span className="eyebrow">可复用创作约束</span><h3>预设管理</h3><p>风格提示词与图片技术参数彼此独立，所有预设仅属于当前账户。</p></div>
    <div className="preset-segments" aria-label="预设类型">
      <button className={view === 'styles' ? 'active' : ''} aria-label="风格预设" onClick={() => setView('styles')}><Palette />风格预设</button>
      <button className={view === 'images' ? 'active' : ''} aria-label="图片设置预设" onClick={() => setView('images')}><Image />图片设置预设</button>
    </div>

    {view === 'styles' ? <>
      <div className="style-preset-list">{styles.map(item => <div className="style-preset-editor" key={item.id}>
        <div className="style-preset-title"><input aria-label={`${item.name}名称`} value={item.name} onChange={event => updateStyle(item.id, { name: event.target.value })} /><button className="icon-button danger" aria-label={`删除 ${item.name}`} disabled={busy === `delete-${item.id}`} onClick={() => deleteStyle(item)}><Trash2 /></button></div>
        <textarea aria-label={`${item.name}提示词`} value={item.prompt} rows={5} onChange={event => updateStyle(item.id, { prompt: event.target.value })} />
      </div>)}</div>
      <div className="preset-actions"><button className="secondary-button" onClick={restoreStyles} disabled={busy === 'restore-styles'}><RotateCcw />恢复内置风格</button><button className="secondary-button" onClick={addStyle}><Plus />新增风格</button><button className="primary-button" aria-label="保存风格预设更改" onClick={saveStyles} disabled={!dirty || busy !== ''}>{busy === 'save-styles' ? <LoaderCircle className="spin" /> : <Save />}保存更改</button></div>
    </> : <>
      <div className="style-preset-list">{images.map(item => <div className="style-preset-editor image-preset-editor" key={item.id}>
        <div className="style-preset-title"><input aria-label={`${item.name}名称`} value={item.name} onChange={event => updateImage(item.id, { name: event.target.value })} /><button className="icon-button danger" aria-label={`删除 ${item.name}`} disabled={busy === `delete-${item.id}`} onClick={() => deleteImage(item)}><Trash2 /></button></div>
        <div className="image-preset-fields">
          <label>尺寸<input aria-label={`${item.name}尺寸`} value={item.size} onChange={event => updateImage(item.id, { size: event.target.value })} /></label>
          <label>质量<select value={item.quality} onChange={event => updateImage(item.id, { quality: event.target.value })}><option value="auto">自动</option><option value="medium">标准</option><option value="high">高</option></select></label>
          <label>数量<input type="number" min="1" max="4" value={item.count} onChange={event => updateImage(item.id, { count: Number(event.target.value) })} /></label>
          <label>背景<select value={item.background} onChange={event => updateImage(item.id, { background: event.target.value })}><option value="auto">自动</option><option value="opaque">不透明</option><option value="transparent">透明</option></select></label>
          <label>格式<select value={item.output_format} onChange={event => updateImage(item.id, { output_format: event.target.value })}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
          <label>压缩<input type="number" min="0" max="100" value={item.output_compression} onChange={event => updateImage(item.id, { output_compression: Number(event.target.value) })} /></label>
        </div>
      </div>)}</div>
      <div className="preset-actions"><button className="secondary-button" aria-label="恢复内置图片预设" onClick={restoreImages} disabled={busy === 'restore-images'}><RotateCcw />恢复内置图片预设</button><button className="secondary-button" onClick={addImage}><Plus />新增图片预设</button><button className="primary-button" aria-label="保存图片预设更改" onClick={saveImages} disabled={!dirty || busy !== ''}>{busy === 'save-images' ? <LoaderCircle className="spin" /> : <Save />}保存更改</button></div>
    </>}
    {dirty && <p className="preset-dirty" role="status">有未保存更改</p>}
    {message && <p className="form-success" role="status">{message}</p>}
  </section>
}
