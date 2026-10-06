/** Demo-only: submissions are stored in this browser and never sent anywhere. */
export function saveLocal(kind: 'signups' | 'messages', entry: Record<string, string>): boolean {
  const key = `cr.demo.${kind}`;
  try {
    const stored = localStorage.getItem(key);
    const list: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(list)) return false;
    list.push({ ...entry, savedAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
