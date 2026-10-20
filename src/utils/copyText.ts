export async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(area);
  area.select();
  let success = false;
  try { success = document.execCommand('copy'); } catch {} finally { area.remove(); previous?.focus({ preventScroll: true }); }
  return success;
}
