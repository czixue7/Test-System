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

const getVconsoleEnabled = (): boolean => {
  // 注意：这里**不再**按环境（Tauri/桌面端）直接返回 false。
  // 「调试控制台」是设置页里有意常驻的开关，用户在桌面端点开后就应当生效，
  // 并在重启后保持；旧代码里的 isTauri() 恒为 false 所以这一行从未真正生效，
  // 修好 isTauri 后如果保留它，就会出现「开关能打开、重启后又没了」的不一致。
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
