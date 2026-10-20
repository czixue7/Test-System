type Asset = { name: string; browser_download_url: string };

/** Keep release selection and download selection on the same platform rules. */
export function platformAsset<T extends Asset>(assets: T[]): T | null {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const system = `${ua} ${platform}`;
  const android = system.includes('android');
  const arm64 = /aarch64|arm64/.test(system);
  const arm = !arm64 && /arm/.test(system);
  const x64 = /x86_64|x64|amd64|win64/.test(system);
  const x86 = !x64 && /x86|i[3-6]86/.test(system);
  const architecture = (name: string) => {
    if (/arm64|aarch64/.test(name)) return 'arm64';
    if (/armeabi|arm-v7|armv7/.test(name)) return 'arm';
    if (/x86_64|x64|amd64/.test(name)) return 'x64';
    if (/x86|i[3-6]86/.test(name)) return 'x86';
    return '';
  };
  const target = arm64 ? 'arm64' : arm ? 'arm' : x64 ? 'x64' : x86 ? 'x86' : '';
  const candidates = assets.filter(a => {
    const n = a.name.toLowerCase(), arch = architecture(n);
    return !target || !arch || arch === target;
  });
  const find = (check: (name: string) => boolean) => candidates.find(a=>check(a.name.toLowerCase())) ?? null;
  if (android) return (target ? find(n=>n.endsWith('.apk') && architecture(n)===target) : null)
    ?? find(n=>n.endsWith('.apk') && n.includes('universal'))
    ?? find(n=>n.endsWith('.apk'));
  if (system.includes('win')) return find(n=>n.endsWith('.exe')) ?? find(n=>n.endsWith('.msi')) ?? find(n=>n.includes('windows') && n.endsWith('.zip'));
  if (system.includes('mac')) return find(n=>n.endsWith('.dmg')) ?? find(n=>n.includes('macos') && n.endsWith('.zip'));
  if (system.includes('linux')) return find(n=>n.endsWith('.appimage')) ?? find(n=>n.includes('linux') && n.endsWith('.zip'));
  return null;
}
