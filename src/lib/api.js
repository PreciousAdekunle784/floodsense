let csrf = null;
export const setCsrf = (t) => { csrf = t; };

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined), credentials: 'same-origin' });
  } catch {
    const e = new Error('Cannot reach the FloodSense server. Check your connection and try again.');
    e.network = true;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status;
    e.fields = data?.fields;
    throw e;
  }
  return data;
}
