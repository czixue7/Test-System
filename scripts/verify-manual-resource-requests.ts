import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

// Execute production handlers and render functions with controlled transport.
// The real empty-list render used to issue another request on every render.
const source=fs.readFileSync('src/pages/DutySchedule.tsx','utf8');
const ast=ts.createSourceFile('DutySchedule.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const find=(name:string)=>{
  let result:ts.VariableDeclaration|undefined;
  const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)result=node;ts.forEachChild(node,visit);};
  visit(ast);assert.ok(result,`Missing production declaration: ${name}`);return result!;
};
let count=0, mode='empty';
let finish:((value:any)=>void)|undefined;
const state:any={React,console,safeArea:{top:0},loadingRemote:false,remoteDuties:[],remoteError:null,
  remoteRequestPending:{current:false},duties:[],closeAddModal:()=>{},showError:()=>{},
  checkDutyStatus:()=>({exists:false,hasUpdate:false}),handleDownloadRemote:()=>{},
  fetchDutyIndex:async()=>{count++;if(mode==='hold')return new Promise(r=>{finish=r;});if(mode==='error')throw Error('Offline');return {systemDuties:[],userDuties:[]};},
};
for(const [setter,key] of [['setLoadingRemote','loadingRemote'],['setRemoteError','remoteError'],['setRemoteDuties','remoteDuties'],['setShowDownloadPanel','showDownloadPanel']])
  state[setter]=(value:any)=>{state[key]=typeof value==='function'?value(state[key]):value;};
const openHandlers:ts.ArrowFunction[]=[];
const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onClick'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression&&ts.isArrowFunction(node.initializer.expression)&&node.initializer.expression.getText(ast).includes('setShowDownloadPanel(true)'))openHandlers.push(node.initializer.expression);ts.forEachChild(node,visit);};
visit(ast);assert.equal(openHandlers.length,1);
const code=`const ${find('fetchRemoteDutyList').getText(ast)}; const ${find('renderDownloadPanel').getText(ast)}; globalThis.handlers={fetchRemoteDutyList,renderDownloadPanel,open:${openHandlers[0].getText(ast)}};`;
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,state);
const h=state.handlers;
for(let i=0;i<5;i++)h.renderDownloadPanel();
assert.equal(count,0,'Rendering an empty panel must not fetch');
h.open();await new Promise(r=>setImmediate(r));
assert.equal(count,1,'Explicitly opening the download panel fetches once');
for(let i=0;i<20;i++)h.renderDownloadPanel();
await new Promise(r=>setImmediate(r));assert.equal(count,1,'An empty response must stay idle through repeated renders');
mode='error';await h.fetchRemoteDutyList();
for(let i=0;i<5;i++)h.renderDownloadPanel();
assert.equal(count,2,'A failed response must wait for an explicit retry');
mode='hold';const pending=h.fetchRemoteDutyList();await h.fetchRemoteDutyList();
assert.equal(count,3,'Concurrent user clicks share one in-flight request');
finish!({systemDuties:[],userDuties:[]});await pending;
mode='empty';await h.fetchRemoteDutyList();assert.equal(count,4,'Manual retry remains available after completion');
for(let i=0;i<10;i++)h.renderDownloadPanel();assert.equal(count,4);

const banks=fs.readFileSync('src/pages/DownloadBanks.tsx','utf8');
assert.doesNotMatch(banks,/\},\s*\[banks,\s*showError,\s*showInfo,\s*sourceEntries\]\)/,'Local bank/source changes must not trigger a new index request');
const manage=fs.readFileSync('src/pages/ManageBanks.tsx','utf8');
assert.doesNotMatch(manage,/useEffect\(\(\)\s*=>\s*\{\s*fetchRemoteBanks\(/,'Opening local bank management must not fetch remote files');
console.log('✓ 生产值班表渲染/处理函数：空表零循环、失败零循环、主动打开一次、并发去重、手动重试；本地题库变化不触发远程刷新');
