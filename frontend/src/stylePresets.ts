import type { StylePreset, UserPreferences } from './types'

export const defaultStylePresets: StylePreset[] = [
  { id: 'cinematic', name: '电影感', prompt: '电影感构图，真实材质，克制的景深与光影。', builtin: true },
  { id: 'illustration', name: '商业插画', prompt: '精致商业插画，清晰轮廓，主体层级明确。', builtin: true },
  { id: 'anime', name: '日系动画', prompt: '高质量日系动画视觉，人物一致性优先，细节干净。', builtin: true },
  { id: 'product', name: '产品摄影', prompt: '高端产品摄影，准确材质，背景简洁，主体突出。', builtin: true },
  { id: 'card', name: '卡牌插图', prompt: '精致卡牌插图，主体轮廓鲜明，视觉层级清晰，信息详略得当。', builtin: true },
]

export function resolveStylePresets(preferences: UserPreferences): StylePreset[] {
  return preferences.style_presets?.length ? preferences.style_presets : defaultStylePresets
}
