import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { BankIndexItem } from '../src/types';

const saved = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)}});
(globalThis as any).window = new EventTarget();
const { useDataSourceStore: source, sourcesFingerprint, updateSourcesFingerprint } = await import('../src/store/dataSourceStore');
const { validateSource } = await import('../src/utils/sourceConfig');
const { selectBankVersions, bankTimestamp, hasNewBankVersion } = await import('../src/utils/bankVersions');
const { fetchConfiguredIndex } = await import('../src/utils/sourceCatalog');
const { fetchBankContent, bankContentHash } = await import('../src/utils/bankContent');
const { checkBankUpdate, findLocalBank } = await import('../src/utils/bankIndex');
const { configuredRelease } = await import('../src/utils/releaseSources');
const { downloadApk } = await import('../src/utils/updater');

const oldRaw = JSON.stringify({name:'旧题库',questions:[{type:'subjective',content:'旧题目',correctAnswer:'旧答案'}]});
const newRaw = JSON.stringify({name:'新题库',questions:[{type:'subjective',content:'新题目',correctAnswer:'新答案'}]});
const sha = (text:string) => crypto.createHash('sha256').update(text).digest('hex');
const oldTime = '2026-10-18T00:00:00Z', newTime = '2026-10-19T00:00:00Z', mirrorTime = '2026-10-20T00:00:00Z';
const base: BankIndexItem = {bankId:'shared-bank',name:'同一题库',filename:'demo.json',downloadUrl:'files/demo.json',sha:sha(oldRaw),updatedAt:oldTime,images:[]};
const defaults = source.getState().sources;
const service = {id:'service',name:'电脑',kind:'service' as const,url:'https://controlled.test',token:'test-only-token-1234',enabled:true};
source.setState({sources:[...defaults,service]});
const calls:string[] = [];
let failure = '', disabledDuringRead = false;
globalThis.fetch = (async (input:any) => {
  const url = String(input); calls.push(url);
  if (url.includes('/contents/')) return Response.json([]);
  if (url.endsWith('bank-index.json')) {
    const entry = url.includes('gitee.com') ? base : {...base,sha:sha(newRaw),updatedAt:url.includes('controlled.test')?mirrorTime:newTime};
    return Response.json({systemBanks:[],userBanks:[entry]});
  }
  if (url.includes('releases')) {
    if (disabledDuringRead) source.getState().setUpdatesEnabled(false);
    return Response.json(url.includes('gitee') ? {releases:[{tag:{name:'v0.5.0'},release:{description:'hash:20261020',attach_files:[]}}]} : [{tag_name:'v0.5.0',body:'hash:20261020',assets:[]}]);
  }
  if (url.endsWith('app-update.json')) return Response.json({version:'0.4.0',assets:[]});
  if (url.endsWith('files/demo.json')) {
    if (url.includes('githubusercontent.com') && failure === 'offline') return new Response('offline',{status:503});
    return new Response(failure === 'corrupt-all' || (failure === 'corrupt-primary' && url.includes('githubusercontent.com')) || url.includes('gitee.com') ? oldRaw : newRaw);
  }
  throw new Error(`Unexpected controlled request: ${url}`);
}) as typeof fetch;

const catalog = await fetchConfiguredIndex('bank');
assert.equal(catalog.userBanks.length,1);
const selected = catalog.userBanks[0];
assert.equal(selected.sourceId,'default-github');
assert.equal(selected.sha,sha(newRaw));
assert.equal(selected.updatedAt,new Date(mirrorTime).toISOString());
assert.deepEqual(selected.mirrors?.map(m=>m.sourceId),['service']);
assert.equal(selected.sourceAliases?.length,2);
calls.length=0;
assert.equal((await fetchBankContent(selected)).data.name,'新题库');
assert.equal(calls.length,1);
assert(calls[0].includes('githubusercontent.com'));
failure='offline'; calls.length=0;
assert.equal((await fetchBankContent(selected)).location.sourceId,'service');
assert.equal(calls.length,2);
assert(!calls.some(url=>url.includes('gitee')),'stale mirror must never substitute for selected version');
failure='corrupt-primary';
assert.equal((await fetchBankContent(selected)).data.name,'新题库');
failure='corrupt-all';
await assert.rejects(fetchBankContent(selected),/hash 校验失败/);
failure='';
console.log('✓ 多源先按 hash 分组再按时间选最新；下载命中所选源；仅相同版本备用；损坏内容拒绝');

const entry = (item:BankIndexItem) => ({item,section:'userBanks' as const});
const same = selectBankVersions([entry(base),entry({...base,updatedAt:newTime,sourceId:'later'})]);
assert.equal(same.userBanks.length,1); assert.equal(same.userBanks[0].sourceId,undefined);
const ordered = selectBankVersions([entry(base),entry({...base,updatedAt:mirrorTime}),entry({...base,sha:sha(newRaw),updatedAt:newTime})]);
assert.equal(ordered.userBanks[0].sha,base.sha,'same-hash timestamps must be combined before comparing another hash');
const unknown = selectBankVersions([entry({...base,updatedAt:undefined}),entry({...base,sha:sha(newRaw),updatedAt:undefined})]);
assert.equal(unknown.userBanks[0].sha,base.sha);
const known = selectBankVersions([entry({...base,updatedAt:undefined}),entry({...base,sha:sha(newRaw),updatedAt:newTime})]);
assert.equal(known.userBanks[0].sha,sha(newRaw));
const independent = selectBankVersions([entry(base),entry({...base,bankId:'unrelated-bank'})]);
assert.equal(independent.userBanks.length,2,'stable IDs distinguish unrelated banks with the same name and file name');
assert.equal(bankTimestamp(1792368000),bankTimestamp(1792368000000));
assert.equal(bankTimestamp('not-a-date'),0);
console.log('✓ 相同 hash 去重保留来源顺序；三源比较无顺序漏洞；缺失时间不伪造新版本；独立 ID 不误合并');

assert.equal(hasNewBankVersion({sourceSha:sha(newRaw),sourceUpdatedAt:mirrorTime},base),false);
assert.equal(hasNewBankVersion({sourceSha:sha(newRaw),sourceUpdatedAt:mirrorTime},{...base,updatedAt:undefined}),false);
assert.equal(hasNewBankVersion({sourceSha:base.sha,sourceUpdatedAt:oldTime},selected),true);
assert.equal(hasNewBankVersion({sourceSha:selected.sha,sourceUpdatedAt:oldTime},selected),false);
const local = {id:'local',name:'本机题库',questions:[],createdAt:oldTime,updatedAt:'2099-01-01T00:00:00Z',sourceSha:base.sha,sourceBankId:base.bankId,sourceFilename:'repo:old-location:demo.json',sourceType:'user' as const,sourceUpdatedAt:oldTime};
assert.equal(checkBankUpdate(local,catalog).hasUpdate,true);
assert.equal(findLocalBank(selected,[local])?.id,'local');
assert.equal(findLocalBank({...selected,bankId:'unrelated-bank'},[local]),undefined);
const bytes = new TextEncoder().encode(newRaw);
const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
assert.equal(await bankContentHash(bytes,blob),blob);
assert.equal(await bankContentHash(bytes,sha(newRaw)),sha(newRaw));
console.log('✓ 管理页跨来源定位同一题库、不回退旧版本、本机编辑时间不冒充发布时间；兼容 Git SHA-1 和 SHA-256');

assert.equal(validateSource({...defaults[0],url:defaults[1].url}).kind,'github');
assert.equal(validateSource({...defaults[1],url:defaults[0].url}).kind,'gitee');
const bankFingerprint = sourcesFingerprint(), updateFingerprint = updateSourcesFingerprint();
source.getState().setUpdatesEnabled(false); calls.length=0;
await assert.rejects(configuredRelease(),/软件更新已关闭/);
await assert.rejects(downloadApk('https://unused.test/app.apk','test.apk'),/软件更新已关闭/);
assert.equal(calls.length,0);
assert.equal(sourcesFingerprint(),bankFingerprint);
assert.notEqual(updateSourcesFingerprint(),updateFingerprint);
assert.equal((await fetchConfiguredIndex('bank')).userBanks.length,1,'bank catalogs remain available with software updates disabled');
source.getState().setUpdatesEnabled(true);
disabledDuringRead=true;
await assert.rejects(configuredRelease(),/已修改/);
disabledDuringRead=false; source.getState().setUpdatesEnabled(true);
await source.persist.rehydrate(); assert.equal(source.getState().updatesEnabled,true);
console.log('✓ 软件更新类型按地址识别平台；开关持久化、阻止更新请求及下载，不影响题库获取；在途结果失效');

const manifest = JSON.parse(fs.readFileSync('bank-index.json','utf8'));
assert(manifest.systemBanks.every((item:any) => decodeURIComponent(item.downloadUrl).includes('/Question_bank/public/banks/')));
assert(manifest.userBanks.every((item:any) => decodeURIComponent(item.downloadUrl).includes('/Question_bank/private/')));
for (const item of [...manifest.systemBanks,...manifest.userBanks]) {
  assert(item.bankId && bankTimestamp(item.updatedAt));
  const relative = decodeURIComponent(new URL(item.downloadUrl).pathname.split('/main/')[1]);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(relative)).digest('hex'),item.sha);
  for (const image of item.images ?? []) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${item.imagePath}/${image.filename}`)).digest('hex'),image.sha);
}
console.log('✓ bank-index.json 每个条目均有 bankId / updatedAt，hash 与本地实际文件一致');

source.setState({sources:[defaults[0]]});
const directoryCalls:string[]=[];
globalThis.fetch = (async(input:any)=>{
  const url=String(input);
  if(url.endsWith('bank-index.json')) return new Response('missing',{status:404});
  const directory=decodeURIComponent(new URL(url).pathname.split('/contents/')[1]);
  directoryCalls.push(directory);
  const dir=(name:string)=>({name,path:`${directory}/${name}`,type:'dir'});
  const file=(name:string)=>({name,type:'file',sha:base.sha,download_url:`https://gitee.com/zixue7/Test-System/raw/main/${directory}/${name}`});
  if(directory==='Question_bank/public/banks')return Response.json([dir('内置目录')]);
  if(directory==='Question_bank/public/banks/内置目录')return Response.json([file('内置.json')]);
  if(directory==='Question_bank/private/Question')return Response.json([dir('分类')]);
  if(directory==='Question_bank/private/Question/分类')return Response.json([dir('私人目录')]);
  if(directory==='Question_bank/private/Question/分类/私人目录')return Response.json([file('私人.json')]);
  throw new Error(`Unexpected directory: ${directory}`);
}) as typeof fetch;
const discovered=await fetchConfiguredIndex('bank');
assert.equal(discovered.systemBanks.length,1);assert.equal(discovered.userBanks.length,1);
assert(discovered.systemBanks[0].downloadUrl.includes('Question_bank/public/banks/'));
assert(discovered.userBanks[0].downloadUrl.includes('Question_bank/private/Question/'));
assert(directoryCalls.every(path=>path.startsWith('Question_bank/public/banks')||path.startsWith('Question_bank/private/Question')));
console.log('✓ 公开/私人题库索引及图片均使用新路径；索引缺失时按新目录递归发现并正确分类');
