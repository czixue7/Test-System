import Collapse from './Collapse';
import React, { useRef, useState } from 'react';
import { AIProfile, useSettingsStore } from '../store/settingsStore';
import { APIGradingService } from '../utils/apiGradingService';
import { useToast } from '../hooks/useToast';
import ConfirmDialog from './ConfirmDialog';

const blank = { name: '', apiEndpoint: '', apiKey: '', apiModel: '', apiProvider: '', apiPassword: '' };
const inputClass = 'w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500';

const AIProfileSettings: React.FC = () => {
  const { aiProfiles, activeAIProfileId, saveAIProfile, activateAIProfile, deleteAIProfile } = useSettingsStore();
  const { showSuccess, showError } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(blank);
  const [testing, setTesting] = useState(false);
  const testLock = useRef(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [deleting, setDeleting] = useState<AIProfile | null>(null);
  const active = aiProfiles.find(p => p.id === activeAIProfileId);

  const edit = (profile?: AIProfile) => {
    setEditing(profile?.id ?? 'new');
    setDraft(profile ? { ...profile } : { ...blank });
    setResult(null);
  };
  const validated = () => {
    const data = { ...draft, name: draft.name.trim(), apiEndpoint: draft.apiEndpoint.trim(), apiKey: draft.apiKey.trim(), apiModel: draft.apiModel.trim() };
    if (!data.name || !data.apiEndpoint || !data.apiKey || !data.apiModel) {
      showError('请填写配置名称、API 地址、Key 和模型名称');
      return null;
    }
    try {
      const url = new URL(data.apiEndpoint);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      showError('请输入有效的 HTTP 或 HTTPS API 地址');
      return null;
    }
    return data;
  };
  const save = () => {
    const data = validated();
    if (!data) return;
    saveAIProfile(data, editing === 'new' ? undefined : editing ?? undefined);
    setEditing(null);
    showSuccess('配置已保存');
  };
  const test = async () => {
    if (testLock.current) return;
    const data = validated();
    if (!data) return;
    testLock.current = true;
    setTesting(true);
    setResult(null);
    try {
      // Test the draft independently so the currently selected AI is never overwritten.
      const service = new APIGradingService();
      service.setConfig({ apiKey: data.apiKey, endpoint: data.apiEndpoint, model: data.apiModel });
      setResult(await service.testConnection());
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : '连接测试失败' });
    } finally {
      testLock.current = false;
      setTesting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="w-full px-4 py-3 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">API 配置</span>
          <span className="text-xs text-blue-500 truncate">{active?.name || '未配置'} · {aiProfiles.length} 条 {expanded ? '⌃' : '⌄'}</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">保存多个 AI 配置，点击条目即可切换</p>
      </button>
      <Collapse open={expanded}>
        <div className="px-3 py-2.5 border-t border-gray-200 dark:border-gray-600 space-y-2">
          {!aiProfiles.length && <p className="text-sm text-gray-500 dark:text-gray-400">还没有保存的配置，添加第一个 AI 开始使用。</p>}
          {aiProfiles.map(profile => (
            <div key={profile.id} className={`ai-profile-row ${profile.id === activeAIProfileId ? 'ai-profile-row--active' : ''}`}>
              <button disabled={testing} aria-pressed={profile.id === activeAIProfileId} onClick={() => { activateAIProfile(profile.id); showSuccess(`已切换到 ${profile.name}`); }} className="ai-profile-select disabled:opacity-50">
                <div className="ai-profile-heading">
                  <span className="ai-profile-name" title={profile.name}>{profile.name}</span>
                  {profile.id === activeAIProfileId && <span className="ai-profile-active">使用中</span>}
                </div>
                <div className="ai-profile-meta">
                  <span className="ai-profile-model" title={profile.apiModel}>{profile.apiModel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="ai-profile-endpoint" title={profile.apiEndpoint}>{profile.apiEndpoint}</span>
                </div>
              </button>
              <div className="ai-profile-actions">
                <button disabled={testing} onClick={() => edit(profile)} aria-label={`编辑 ${profile.name}`} title="编辑配置" className="ai-profile-action">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></svg>
                </button>
                <button disabled={testing} onClick={() => setDeleting(profile)} aria-label={`删除 ${profile.name}`} title="删除配置" className="ai-profile-action ai-profile-action--delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>
                </button>
              </div>
            </div>
          ))}
          {editing === null ? (
            <button onClick={() => edit()} className="w-full py-2.5 rounded-xl border border-dashed border-blue-400 text-sm text-blue-500">＋ 添加 AI 配置</button>
          ) : (
            <form onSubmit={event => { event.preventDefault(); if (!testing) save(); }} className="space-y-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 p-3">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">{editing === 'new' ? '添加 AI 配置' : '编辑 AI 配置'}</h3>
              {([
                ['name', '配置名称', '如：日常判题 / 知识总结'],
                ['apiEndpoint', 'API 地址', 'https://api.example.com/v1/chat/completions'],
                ['apiKey', 'API Key', '请输入 API Key'],
                ['apiModel', '模型名称', '如 glm-4-flash'],
              ] as const).map(([key, label, placeholder]) => (
                <label key={key} className="block text-xs text-gray-600 dark:text-gray-300">
                  {label}
                  <input required disabled={testing} type={key === 'apiKey' ? 'password' : key === 'apiEndpoint' ? 'url' : 'text'} autoComplete="off" value={draft[key]} onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setResult(null); }} placeholder={placeholder} className={`${inputClass} mt-1 disabled:opacity-50`} />
                </label>
              ))}
              <div className="flex gap-2">
                <button type="submit" disabled={testing} className="flex-1 h-10 rounded-lg bg-blue-500 text-white text-sm disabled:opacity-50">保存配置</button>
                <button type="button" disabled={testing} onClick={test} className="flex-1 h-10 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm disabled:opacity-50">{testing ? '测试中…' : '测试连接'}</button>
                <button type="button" disabled={testing} onClick={() => setEditing(null)} className="px-2 text-sm text-gray-500 disabled:opacity-50">取消</button>
              </div>
              {result && <p role="status" className={`text-xs break-words ${result.success ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{result.message}{result.success ? '，点击保存配置以保留' : ''}</p>}
            </form>
          )}
        </div>
      </Collapse>
      <ConfirmDialog open={!!deleting} title="删除 AI 配置" message={`确定删除“${deleting?.name ?? ''}”？${deleting?.id === activeAIProfileId ? '删除后将使用剩余的第一条配置。' : ''}`} onCancel={() => setDeleting(null)} onConfirm={() => {
        if (!deleting) return;
        deleteAIProfile(deleting.id);
        if (editing === deleting.id) setEditing(null);
        setDeleting(null);
        showSuccess('配置已删除');
      }} />
    </div>
  );
};

export default AIProfileSettings;
