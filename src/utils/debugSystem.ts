import { sanitizeDebugUrl } from './debugValues';

export function getDebugSystemInfo(): Record<string, unknown> {
  const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType?.('resource') as PerformanceResourceTiming[];
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const mb = (size: number) => (size / 1048576).toFixed(1) + ' MB';
  return {
    路由: window.location.pathname + window.location.search + window.location.hash, 地址: sanitizeDebugUrl(window.location.href),
    视窗: `${window.innerWidth} × ${window.innerHeight}`, 屏幕: `${screen.width} × ${screen.height}`, 像素比例: window.devicePixelRatio,
    主题: document.documentElement.classList.contains('dark') ? '深色' : '浅色', 布局: document.documentElement.dataset.theme || 'immersive',
    浏览器: navigator.userAgent, 语言: navigator.language, 在线状态: navigator.onLine ? '在线' : '离线',
    页面运行: (performance.now() / 1000).toFixed(1) + ' s', DOM元素: document.querySelectorAll('*').length,
    DOM就绪: navigation?.domContentLoadedEventEnd ? Math.round(navigation.domContentLoadedEventEnd - navigation.startTime) + ' ms' : '尚未完成或不可用',
    页面加载: navigation?.loadEventEnd ? Math.round(navigation.loadEventEnd - navigation.startTime) + ' ms' : '尚未完成或不可用',
    JS内存: memory ? `${mb(memory.usedJSHeapSize)} / ${mb(memory.totalJSHeapSize)}（上限 ${mb(memory.jsHeapSizeLimit)}）` : '当前浏览器未提供',
    资源条数: resources?.length || 0,
    资源: (resources || []).slice(-30).map(resource => ({ 地址: sanitizeDebugUrl(resource.name), 类型: resource.initiatorType, 耗时: Math.round(resource.duration) + ' ms', 传输字节: resource.transferSize })),
  };
}
