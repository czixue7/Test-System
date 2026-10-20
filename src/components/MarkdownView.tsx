import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * HTML 白名单（在 rehype-sanitize 默认 schema 基础上放宽必要标签）。
 *
 * ⚠️ rehype-raw 会解析 Markdown 中的原始 HTML，**必须**紧跟 rehype-sanitize 净化。
 * 只保留 rehype-raw 时：`<script>` 与 `onerror` 这类不会执行（react-dom 会丢弃
 * 未知 on* 属性），但 `<iframe srcdoc="<script>…</script>">` 会生成一个继承父文档源、
 * 可执行内联脚本的文档。内容来源包含用户导入的 .md/.txt、从网上下载的题库，
 * 以及由这些内容喂给 AI 后生成的总结（可被提示注入）——
 * 再叠加 tauri.conf.json 里 csp: null 与始终存在的 window.__TAURI_INTERNALS__，
 * 注入脚本就能读取 localStorage['settings-storage']（含 API Key 明文）并调用 IPC。
 */
const schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // 保留知识库内容常用的语义标签（<details> 折叠块依赖 details/summary）
    'details',
    'summary',
    'figure',
    'figcaption',
    'mark',
    'kbd',
    'abbr',
    'sup',
    'sub',
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    // 代码块语言高亮只需要 language-* 的 className
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
  },
  // 连内容一起丢弃，避免脚本正文以文本形式残留
  strip: ['script', 'style'],
} as typeof defaultSchema;

/*
 * 关于图片 URL：这里**不**放宽 `data:` 协议。
 * react-markdown 自带的 defaultUrlTransform 只允许 http/https/irc/mailto/xmpp
 * 与相对路径，data: 会被清空 —— 这是一层有用的防护，而知识库正文里
 * 出现的图片本来就是相对路径或 https 链接（题库题图是 Question.images，
 * 由 Exam/Practice 直接 <img> 渲染，不经过本组件）。
 */

interface MarkdownViewProps {
  content: string;
  className?: string;
}

// Markdown 渲染组件：支持标题/列表/粗体/代码/引用/表格及 <details> 折叠块，自动适配深浅主题
const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownView;
