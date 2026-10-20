import assert from 'node:assert/strict';
import { syncQuestionBanks, contentHash } from '../src/utils/questionBankSync';
let requests=0;
globalThis.fetch=(async()=>{requests++;throw new Error('Unexpected network request');}) as typeof fetch;
for(const enabled of [true,false]) {
  await assert.rejects(syncQuestionBanks({url:'https://example.test',token:'synthetic',space:'one'},()=>enabled),/同步存储已停用/);
}
assert.equal(requests,0,'Legacy bank sync must not request manifests or upload local banks');
assert.equal(await contentHash('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
console.log('✓ 题库同步存储入口停用且零网络请求，发布文件 SHA-256 校验保留');
