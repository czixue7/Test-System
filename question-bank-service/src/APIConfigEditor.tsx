// Primary: selected API profile; secondary: space and profile list; tertiary: storage help.
// Save is the form action. Existing panel/input/line/muted/accent tokens and 8/16/24 spacing apply.
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { APIProfile, APIConfigDocument, emptyAPIConfig, editAPIConfig, mergeAPIConfig, profilesFromAPIConfig, validateAPIConfig, MAX_API_CONCURRENCY, validAPIConcurrency } from '../../shared/apiConfigSync';

type Envelope = { revision: number; data: APIConfigDocument | null };
export interface APIConfigTransport {
  spaces(): Promise<string[]>;
  load(space: string): Promise<Envelope>;
  save(space: string, baseRevision: number, data: APIConfigDocument): Promise<{ status: number; envelope: Envelope }>;
}
const transport: APIConfigTransport = {
  spaces: async () => [...new Set((await invoke<{ rows: { space: string }[] }>('get_sync_overview')).rows.map(row => row.space))],
  load: space => invoke('get_api_config', { space }),
  save: (space, baseRevision, data) => invoke('save_api_config', { space, baseRevision, data }),
};
const validateEnvelope = (value: Envelope) => {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('API 配置版本无效');
  if (value.data !== null) validateAPIConfig(value.data);
};
export default function APIConfigEditor({ enabled, request = transport }: { enabled: boolean; request?: APIConfigTransport }) {
  const [spaces, setSpaces] = useState<string[]>([]);
  const [space, setSpace] = useState('');
  const [loaded, setLoaded] = useState<Envelope | null>(null);
  const [profiles, setProfiles] = useState<APIProfile[]>([]);
  const [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    request.spaces().then(values => { if (!disposed) setSpaces(values); }).catch(() => {});
    return () => { disposed = true; };
  }, [enabled, request]);
  const active = profiles.find(profile => profile.id === selected);
  const choose = (id: string) => { setSelected(id); setReveal(false); };
  const apply = (next: Envelope) => {
    validateEnvelope(next);
    const items = profilesFromAPIConfig(next.data ?? emptyAPIConfig());
    setLoaded(next); setProfiles(items); setDirty(false); setReveal(false);
    setSelected(current => items.some(profile => profile.id === current) ? current : items[0]?.id ?? '');
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!loaded) return;
    for (const profile of profiles) {
      if (!validAPIConcurrency(profile.concurrency)) throw new Error(`并发限制请输入 1–${MAX_API_CONCURRENCY} 的整数`);
      if (![profile.name, profile.apiKey, profile.apiModel, profile.apiEndpoint].every(value => value.trim()))
        throw new Error('请填写每个配置的名称、接口地址、模型和 API Key');
      try { if (!['http:', 'https:'].includes(new URL(profile.apiEndpoint).protocol)) throw new Error(); }
      catch { throw new Error('接口地址必须为 HTTP 或 HTTPS 地址'); }
    }
    let document = editAPIConfig(loaded.data ?? emptyAPIConfig(), profiles);
    let current = loaded;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await request.save(space, current.revision, document);
      validateEnvelope(result.envelope);
      if (result.status === 200) {
        apply(result.envelope); setSpaces(values => [...new Set([...values, space])]);
        setMessage('已保存到同步空间。客户端勾选 API 配置后，点击手动同步即可获取；冲突配置已保留副本。');
        return;
      }
      if (result.status !== 409) throw new Error('API 配置保存失败');
      current = result.envelope;
      document = mergeAPIConfig(document, current.data);
    }
    throw new Error('其他设备正在修改配置，请稍后再保存；本次编辑仍保留在页面中');
  };
  const change = (patch: Partial<APIProfile>) => {
    setProfiles(items => items.map(profile => profile.id === selected ? { ...profile, ...patch } : profile));
    setDirty(true); setMessage('');
  };
  return <section className="panel api-config-panel" aria-label="API 配置管理">
    <div className="panel-head"><div><h2>与答题软件同步 API 配置</h2><p>填写客户端相同的空间 ID。包含完整 Key 和接口密码，配置选择仍由各设备自行决定。</p></div></div>
    <div className="api-space-controls">
      <label>同步空间 ID<input aria-label="同步空间 ID" list="api-config-spaces" autoComplete="off" value={space} disabled={!enabled || busy || dirty} onChange={event => { setSpace(event.target.value); setLoaded(null); setProfiles([]); setMessage(''); setError(''); setReveal(false); }} placeholder="粘贴客户端的空间 ID" /></label>
      <datalist id="api-config-spaces">{spaces.map(id => <option key={id} value={id} />)}</datalist>
      <button disabled={!enabled || busy || dirty || !/^[a-zA-Z0-9_-]{1,100}$/.test(space)} onClick={() => void run(async () => { apply(await request.load(space)); setMessage('配置已载入'); })}>{busy ? '处理中…' : '载入空间'}</button>
    </div>
    {!enabled && <p className="sync-storage-hint">请在桌面版服务台中管理配置。</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {loaded && <>
      <div className="api-profile-layout">
        <aside className="api-profile-list" aria-label="API 配置列表">
          <div className="api-list-heading"><strong>{profiles.length} 个配置</strong><button disabled={busy} onClick={() => {
            const id = crypto.randomUUID();
            setProfiles(items => [...items, { id, name: '新配置', apiKey: '', apiModel: '', apiEndpoint: '', apiProvider: '', apiPassword: '', concurrency: 2 }]);
            choose(id); setDirty(true); setMessage('');
          }}>＋ 新增</button></div>
          {profiles.map(profile => <button className={profile.id === selected ? 'selected' : ''} aria-pressed={profile.id === selected} key={profile.id} disabled={busy} onClick={() => choose(profile.id)}><strong>{profile.name || '未命名配置'}</strong><small>{profile.apiModel || '未填写模型'}</small></button>)}
          {!profiles.length && <p className="sync-storage-hint">此空间没有 API 配置。新增配置，或在客户端手动同步上传。</p>}
        </aside>
        {active && <div className="api-profile-form">
          <div className="api-form-heading"><h3>编辑配置</h3><button disabled={busy} onClick={() => { const items = profiles.filter(profile => profile.id !== selected); setProfiles(items); choose(items[0]?.id ?? ''); setDirty(true); setMessage(''); }}>删除此配置</button></div>
          <div className="api-profile-fields">
            {([['name', '配置名称'], ['apiEndpoint', '接口地址'], ['apiModel', '模型'], ['apiProvider', '提供方（可选）'], ['apiKey', 'API Key'], ['apiPassword', '接口密码（可选）']] as const).map(([key, label]) => <label key={key}>{label}<input value={active[key]} disabled={busy} type={['apiKey', 'apiPassword'].includes(key) && !reveal ? 'password' : 'text'} autoComplete="off" spellCheck={false} onChange={event => change({ [key]: event.target.value })} /></label>)}
            <label>并发限制<input aria-label="并发限制" type="number" min={1} max={MAX_API_CONCURRENCY} step={1} disabled={busy} value={Number.isNaN(active.concurrency) ? '' : active.concurrency ?? 2} onChange={event => change({ concurrency: event.currentTarget.valueAsNumber })} /><small>知识总结请求数，默认 2。</small></label>
          </div>
          <label className="api-reveal"><input type="checkbox" checked={reveal} onChange={event => setReveal(event.target.checked)} />显示 Key 和接口密码</label>
        </div>}
      </div>
      <footer className="api-config-footer"><span>{dirty ? '有未保存修改' : `空间版本 ${loaded.revision}`} · 删除操作保存后生效</span><div><button disabled={!dirty || busy} onClick={() => { apply(loaded); setError(''); setMessage('已放弃未保存修改'); }}>放弃修改</button><button disabled={!dirty || busy} onClick={() => void run(save)}>保存到同步空间</button></div></footer>
    </>}
    <p className="sync-storage-path">API 配置保存在此电脑的应用数据目录 / sync / 空间 ID / config.json。当前为本机明文存储，请使用可信电脑和访问链接。</p>
  </section>;
}
