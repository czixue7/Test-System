import assert from 'node:assert/strict';
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},configurable:true});
(globalThis as any).window=new EventTarget();
const nav=(userAgent:string,platform:string)=>Object.defineProperty(globalThis,'navigator',{value:{userAgent,platform},configurable:true});
nav('Android arm64','Linux aarch64');
const {useDataSourceStore:store}=await import('../src/store/dataSourceStore');
const {configuredRelease}=await import('../src/utils/releaseSources');
const {platformAsset}=await import('../src/utils/updateAssets');
const {checkUpdate,downloadApk}=await import('../src/utils/updater');
const {useUpdaterStore}=await import('../src/store/updaterStore');
for(const source of store.getState().sources)store.getState().deleteSource(source.id);
store.getState().saveSource({id:'packages',kind:'service',name:'软件包',url:'https://packages.test/prefix',token:'package-test-token-1234',enabled:true});
let releases:any[]=[
  {version:'0.4.4',versionHash:'2026102101',assets:[{name:'app_v0.4.4_build2026102101_arm64.apk',browser_download_url:'/files/p/app.apk'}]},
  {version:'0.5.0',versionHash:'9',assets:[{name:'app_v0.5.0_build9_x64.exe',browser_download_url:'/files/p/app.exe'}]},
];
globalThis.fetch=(async(url:any,init:any)=>{
  assert.equal(String(url),'https://packages.test/prefix/app-update.json');
  assert.equal(init.headers.Authorization,'Bearer package-test-token-1234');
  return Response.json(releases);
}) as any;
let result=await configuredRelease();
assert.equal(result.latest_version,'0.4.4');assert.equal(result.version_hash,'2026102101');
assert.equal(result.assets[0].browser_download_url,'https://packages.test/prefix/files/p/app.apk');
assert.equal((await checkUpdate()).hasUpdate,true);
nav('Windows NT 10.0; Win64; x64','Win32');
result=await configuredRelease();assert.equal(result.latest_version,'0.5.0');assert.equal(result.version_hash,'9');
// Downloading from a desktop service must use native auth rather than window.open.
let native:any;
let revealed=false;
(globalThis as any).window.__TAURI_INTERNALS__={transformCallback:()=>1,invoke:async(command:string,args:any)=>{
  if(command==='install_apk') {
    assert.ok(args.apkPath.startsWith('C:\\Downloads\\app-update-'));
    revealed=true;return '已尝试打开下载目录，请关闭当前程序后手动安装或替换便携版';
  }
  assert.equal(command,'download_apk');native=args;return `C:\\Downloads\\${args.filename}`;
}};
await downloadApk(result.assets[0].browser_download_url,'app.exe');
assert.equal(native.bearerToken,'package-test-token-1234');
useUpdaterStore.setState({updateInfo:{hasUpdate:true,latestVersion:'0.5.0',downloadUrl:result.assets[0].browser_download_url,assetName:result.assets[0].name,versionHash:'9'},downloadedFilePath:'',checkingUpdate:false,downloadStatus:'idle'});
await useUpdaterStore.getState().startDownload();
assert.equal(useUpdaterStore.getState().downloadStatus,'downloaded');assert.ok(native.filename.endsWith('.exe'));
await useUpdaterStore.getState().installUpdate();assert.equal(revealed,true);
delete (globalThis as any).window.__TAURI_INTERNALS__;
releases=[{version:'9.0.0',versionHash:'123',assets:[{name:'app.exe',browser_download_url:'https://outside.test/app.exe'}]}];
await assert.rejects(configuredRelease(),/有效更新/);
nav('Android x86','Linux i686');
assert.equal(platformAsset([{name:'app_arm64.apk',browser_download_url:'/arm64'}]),null);
assert.equal(platformAsset([{name:'app_arm64.apk',browser_download_url:'/arm64'},{name:'app_universal.apk',browser_download_url:'/universal'}])?.browser_download_url,'/universal');
console.log('✓ 服务台更新：平台独立选版本、任意数字构建号、相对路径前缀、鉴权下载、桌面原生下载、越界地址拒绝、架构过滤');
