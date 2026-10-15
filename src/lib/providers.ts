import type { Provider } from './types';

export interface Preset {
  id: string;
  name: string;
  baseURL: string;
  blurb: string;
  keyURL?: string;
  /** Works without an API key. */
  keyless?: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'meridian',
    name: 'Meridian',
    baseURL: 'http://127.0.0.1:3456/v1',
    blurb: 'Your Claude subscription through a local Meridian proxy. Tools run here in the browser.',
    keyless: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    blurb: 'Hundreds of models behind one key, including free ones. Free models may log what you send.',
    keyURL: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    blurb: 'GPT models with your OpenAI key.',
    keyURL: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    blurb: 'Local models. Start Ollama with OLLAMA_ORIGINS set to allow this page.',
    keyless: true,
  },
];

export async function listModels(p: Pick<Provider, 'baseURL' | 'apiKey'>): Promise<string[]> {
  const res = await fetch(`${p.baseURL.replace(/\/+$/, '')}/models`, {
    headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}
