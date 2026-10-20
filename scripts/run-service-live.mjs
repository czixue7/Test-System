import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
const dir = resolve('.build-temp', `bank-sync-live-${randomUUID()}`);
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const token = `synthetic-test-${randomUUID()}`;
const mounts = [];
for (const [id, kind, filename, content] of [
  ['bank','bank','demo.json',JSON.stringify({ name:'联调题库',questions:[{type:'subjective',content:'合成题目',correctAnswer:'合成答案'}] })],
  ['knowledge','knowledge','demo.md','Synthetic published knowledge'],
  ['duty','duty','demo.json',JSON.stringify({name:'联调值班表',shifts:[]})],
]) {
  const path = resolve(dir, id); await mkdir(path, { recursive:true }); await writeFile(resolve(path, filename),content);
  mounts.push({id,kind,path,name:{bank:'题库目录',knowledge:'知识库目录',duty:'值班表目录'}[id],enabled:true});
}
await writeFile(resolve(dir,'config.json'),JSON.stringify({host:'127.0.0.1',port,accessToken:token,theme:'dark',mounts,publicUrl:'',publicPort:null}));
await writeFile(resolve('.build-temp','latest-bank-sync-fixture.json'),JSON.stringify({dir,port}));
const service = spawn(resolve('question-bank-service/src-tauri/target/release/question-bank-service.exe'), ['--headless',dir], {windowsHide:true,stdio:'ignore'});
try {
  let ready = false;
  for (let n=0;n<50;n++) {
    try { const res=await fetch(`http://127.0.0.1:${port}/api/v1/health`,{headers:{Authorization:`Bearer ${token}`}}); if(res.ok){ready=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error('Isolated packaged service did not become ready');
  const tests = spawn(process.execPath,['--import','tsx','scripts/verify-service-live.ts'],{stdio:'inherit',windowsHide:true,env:{...process.env,SERVICE_TEST_URL:`http://127.0.0.1:${port}`,SERVICE_TEST_TOKEN:token}});
  const code=await new Promise((r,j)=>{tests.once('exit',r);tests.once('error',j);});
  if(code!==0)throw Error(`Live client test failed: ${code}`);
  await new Promise(r=>setTimeout(r,5500));
  const traffic=JSON.parse(await readFile(resolve(dir,'traffic.json'),'utf8'));
  if(!traffic.upload || !traffic.download || !traffic.records.some(r=>r.method==='PUT') || !traffic.records.some(r=>r.method==='GET')) throw Error('Live traffic did not persist both directions');
  console.log(`PASS: isolated test fixture ${dir}`);
} finally {
  const done = new Promise(r=>service.once('exit',r)); service.kill(); await done;
}
