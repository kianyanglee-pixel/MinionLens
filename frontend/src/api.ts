const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();

  try {
    return JSON.parse(body) as T;
  } catch {
    const preview = body.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(
      `Backend returned ${response.status} ${response.statusText || ''} instead of JSON` +
      `${preview ? `: ${preview}` : '.'}`
    );
  }
}
