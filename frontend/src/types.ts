export type StylePreset = {
  id: string
  name: string
  prompt: string
  builtin: boolean
}

export type UserPreferences = {
  default_image_provider_id?: string
  default_image_model?: string
  default_text_provider_id?: string
  default_text_model?: string
  history_summary_enabled?: boolean
  style_presets?: StylePreset[]
}

export type User = {
  id: string
  username: string
  role: 'user' | 'admin'
  must_change_password: boolean
  email: string | null
  onboarding_completed: boolean
  preferences: UserPreferences
}

export type Provider = {
  id: string
  name: string
  base_url: string
  has_api_key: boolean
  models: string[]
  image_models: string[]
  text_models: string[]
}

export type Asset = {
  id: string
  workspace_id: string
  run_id: string
  mime_type: string
  width: number
  height: number
  size_bytes: number
  favorite: boolean
  content_url: string
  download_url: string
  created_at: string
  prompt?: string
  model?: string
}

export type Run = {
  id: string
  prompt: string
  model: string
  provider_id: string
  params: Record<string, string | number | string[]>
  status: 'running' | 'completed' | 'failed'
  error?: string
  created_at: string
  assets: Asset[]
}

export type Workspace = {
  id: string
  user_id: string
  name: string
  favorite: boolean
  image_count: number
  latest_asset_id: string | null
  created_at: string
  updated_at: string
  runs?: Run[]
}

export type Quota = {
  used: number
  limit: number
  conversations_used: number
  conversations_limit: number
}

export type SystemSettings = {
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_sender: string
  smtp_tls: boolean
  has_smtp_password: boolean
}
