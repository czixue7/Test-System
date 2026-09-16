/**
 * 统一的 Tauri 运行环境判定。
 *
 * ⚠️ 必须用 `__TAURI_INTERNALS__`：
 * Tauri v2 只有在 `app.withGlobalTauri = true` 时才会把 API 注入 `window.__TAURI__`
 * （见 @tauri-apps/cli 的 config.schema.json，该项默认 false），而本项目
 * `src-tauri/tauri.conf.json` 没有开启它。Tauri 官方 JS API 自己用的也是
 * `__TAURI_INTERNALS__`。
 *
 * 历史缺陷：多处各自实现了 `'__TAURI__' in window`，导致 isTauri() 恒为 false ——
 * plugin-store 从未加载（持久化全部退化为 localStorage）、
 * 桌面端还错误地显示了「调试控制台」开关并真的启动了 vConsole。
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.__TAURI_INTERNALS__ !== 'undefined' || '__TAURI__' in w;
}

/** 是否处于 Android WebView（用于键盘/安全区等移动端分支） */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.toLowerCase().includes('android');
}
