export async function contentHash(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Compatibility guard: banks are downloaded from published folders only. */
export async function syncQuestionBanks(
  _config: { url: string; token: string; space: string },
  _enabled: () => boolean,
): Promise<void> {
  throw new Error('题库同步存储已停用，请从题库下载页手动获取');
}
