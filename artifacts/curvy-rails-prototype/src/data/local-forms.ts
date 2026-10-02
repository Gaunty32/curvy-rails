/** Demo-only: submissions are stored in this browser and never sent anywhere. */
export function saveLocal(kind: 'signups' | 'messages', entry: Record<string, string>) {
  const key = `cr.demo.${kind}`;
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push({ ...entry, savedAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* ignore */ }
}
