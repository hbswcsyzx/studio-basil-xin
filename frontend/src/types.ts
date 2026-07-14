export type User = { id: string; username: string; role: 'user' | 'admin'; must_change_password: boolean }
export type Provider = { id: string; name: string; base_url: string; has_api_key: boolean; models: string[] }
export type Asset = { id: string; workspace_id: string; run_id: string; mime_type: string; width: number; height: number; size_bytes: number; content_url: string; download_url: string; created_at: string }
export type Run = { id: string; prompt: string; model: string; provider_id: string; params: Record<string, string | number>; status: string; error?: string; created_at: string; assets: Asset[] }
export type Workspace = { id: string; user_id: string; name: string; image_count: number; latest_asset_id: string | null; created_at: string; updated_at: string; runs?: Run[] }
export type Quota = { used: number; limit: number }

