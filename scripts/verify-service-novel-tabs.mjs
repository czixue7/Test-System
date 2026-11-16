import {createServer} from 'vite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const {Browser,sleep}=await import(pathToFileURL(join(process.env.USERPROFILE,'.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')).href);
const out=resolve('local-archive/validation/service-novel-tabs');mkdirSync(out,{recursive:true});
const vite=await createServer({root:resolve('question-bank-service'),server:{port:1434,strictPort:true,host:'127.0.0.1',hmr:false,watch:null}});await vite.listen();const browser=await Browser.launch();const reports=[];
async function until(page,label,fn){const end=Date.now()+10000;while(!await page.eval(fn)){assert(Date.now()<end,label);await sleep(50);}}
try{for(const [width,theme]of [[1280,'light'],[940,'dark']]){
 const page=await browser.newPage({width,height:900,reducedMotion:true});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.isTauri=true;window.fixtureConfig={host:'127.0.0.1',port:18080,accessToken:'synthetic-fixture-only',theme:'${theme}',mounts:[{id:'bank',name:'考试题库',path:'C:/fixture/bank',kind:'bank',enabled:true},{id:'duty',name:'值班表',path:'C:/fixture/duty',kind:'duty',enabled:true},{id:'novel',name:'独立小说',path:'C:/fixture/novel',kind:'novel',enabled:true},{id:'legacy',name:'旧版小说',path:'C:/fixture/legacy',kind:'小说',enabled:true},{id:'text',name:'其他文本',path:'C:/fixture/text',kind:'text',enabled:true}],publicUrl:'',publicPort:null};window.__TAURI_INTERNALS__={invoke:async(cmd,args={})=>{if(cmd==='get_state')return {config:window.fixtureConfig,running:false,dataDir:'C:/fixture/state',metrics:{upload:0,download:0,requests:0,minutes:[],days:[],records:[]}};if(cmd==='inspect_mounts')return {banks:{userBanks:[]},duties:{userDuties:[]},knowledge:{items:[]},packages:{items:[]},texts:{items:[{mountId:'novel',path:'book.json'},{mountId:'legacy',path:'book.txt'},{mountId:'text',path:'misc.json'}],warnings:[]},warnings:[]};if(cmd==='choose_path')return 'C:/fixture/new-novel';if(cmd==='save_config'){window.fixtureConfig=structuredClone(args.config);window.lastSaved=structuredClone(args.config);return;}if(cmd==='sync_overview')return {rows:[],warnings:[]};if(cmd==='get_api_profiles')return {profiles:[],version:1};if(cmd==='set_theme'){window.fixtureConfig.theme=args.theme;return;}return null;}};`});
 await page.goto('http://127.0.0.1:1434',{settleMs:800});await until(page,'mounts',()=>document.querySelectorAll('.mount-row').length===3);
 assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.mount-name')].map(i=>i.value)),['考试题库','值班表','其他文本']);
 const click=label=>page.eval(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(!b)throw new Error(label);b.click();},label);
 await click('小说目录');await until(page,'novel only',()=>document.querySelectorAll('.mount-row').length===2);
 assert.deepEqual(await page.eval(()=>[...document.querySelectorAll('.mount-name')].map(i=>i.value)),['独立小说','旧版小说']);
 await until(page,'JSON count',()=>document.querySelector('[aria-label="小说目录内容"]')?.textContent.includes('1 JSON'));
 assert.equal(await page.eval(()=>document.querySelector('[aria-label="小说目录内容"]').textContent.includes('1 TXT')),true);
 await page.eval(()=>document.querySelector('.mount-row input[type=checkbox]').click());
 await click('＋ 添加小说文件夹');await until(page,'added novel',()=>document.querySelectorAll('.mount-row').length===3);
 await click('保存配置 *');await until(page,'saved',()=>!!window.lastSaved);
 const saved=await page.eval(()=>window.lastSaved);assert.equal(saved.mounts.length,6);assert.equal(saved.mounts.find(m=>m.id==='novel').enabled,false);assert.equal(saved.mounts.find(m=>m.id==='bank').path,'C:/fixture/bank');assert.equal(saved.mounts.find(m=>m.id==='bank').enabled,true);assert.equal(saved.mounts.find(m=>m.path==='C:/fixture/new-novel').kind,'novel');
 const metrics=await page.eval(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,rows:[...document.querySelectorAll('.mount-row')].every(e=>e.scrollWidth<=e.clientWidth+1)}));assert.equal(metrics.overflow,false);assert.equal(metrics.rows,true);assert.equal(page.consoleErrors.length,0,JSON.stringify(page.consoleErrors));
 await page.send('Page.bringToFront');const {data}=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});writeFileSync(join(out,`novels-${width}-${theme}.png`),Buffer.from(data,'base64'));
 await click('题库目录');await until(page,'return bank mounts',()=>document.querySelectorAll('.mount-row').length===3);reports.push({width,theme,separateTabs:true,legacyNovelRecognized:true,countsScoped:true,addDefaultsToNovel:true,savePreservesOtherTabs:true,metrics,errors:page.consoleErrors});await page.close();}
 writeFileSync(join(out,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
}finally{await browser.close();await vite.close();}
