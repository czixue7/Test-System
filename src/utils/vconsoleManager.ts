type VConsoleInstance = {
  destroy: () => void;
};

let vconsoleInstance: VConsoleInstance | null = null;

const localizeVConsole = () => {
  const tabList = document.querySelectorAll('.vc-tabbar-item');
  const tabNames: Record<string, string> = {
    'Log': '日志',
    'System': '系统',
    'Network': '网络',
    'Element': '元素',
    'Storage': '存储',
  };
  
  tabList.forEach((tab) => {
    const text = tab.textContent || '';
    if (tabNames[text]) {
      tab.textContent = tabNames[text];
    }
  });
  
  const switchBtn = document.querySelector('.vc-switch');
  if (switchBtn) {
    switchBtn.textContent = '调试';
  }
};

export const initVConsole = async (): Promise<void> => {
  if (vconsoleInstance) return;
  
  const VConsole = await import('vconsole');
  vconsoleInstance = new VConsole.default({
    defaultPlugins: ['system', 'network', 'element', 'storage'],
    target: '#root',
  });
  
  setTimeout(localizeVConsole, 100);
  console.log('vConsole 已初始化');
};

export const destroyVConsole = (): void => {
  if (vconsoleInstance) {
    vconsoleInstance.destroy();
    vconsoleInstance = null;
    console.log('vConsole 已销毁');
  }
};

export const isVConsoleReady = (): boolean => {
  return vconsoleInstance !== null;
};

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

const getVconsoleEnabled = (): boolean => {
  // PC 版本(Tauri)不启用 vConsole
  if (isTauri()) {
    return false;
  }
  
  try {
    const stored = localStorage.getItem('settings-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.state?.vconsoleEnabled ?? false;
    }
  } catch {
    // ignore
  }
  return false;
};

export const initVConsoleOnStartup = async (): Promise<void> => {
  const vconsoleEnabled = getVconsoleEnabled();
  if (vconsoleEnabled) {
    await initVConsole();
  }
};
