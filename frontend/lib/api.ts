import { router } from 'expo-router';
import { API_BASE } from '@/constants/api';
import { CLIENT_VERSION } from '@/constants/version';

export class UpdateRequiredError extends Error {
  constructor() { super('client below minimum version'); this.name = 'UpdateRequiredError'; }
}

/** fetch() against the backend with the compatibility header; a 426 means
 * this bundle is too old to play — route to the blocking update screen. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-Client-Version': String(CLIENT_VERSION) },
  });
  if (res.status === 426) {
    router.replace('/update-required');
    throw new UpdateRequiredError();
  }
  return res;
}
