import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
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
    // 代码块语言高亮只需要 language-* 的 className；
    // 数学公式节点由 remark-math 生成 language-math / math-* 类名，交给 rehype-katex 渲染
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, /^math(-inline|-display)?$/]],
    // 知识总结里的折叠框/时间/计数样式依赖这些类名（kb-*）
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^kb-/, /^math(-inline|-display)?$/], 'style'],
    li: [...(defaultSchema.attributes?.li ?? []), 'style'],
    img: [...(defaultSchema.attributes?.img ?? []), 'style'],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^kb-/], 'style'],
    summary: [...(defaultSchema.attributes?.summary ?? []), ['className', /^kb-/]],
    // 导入的 Markdown 文档常用带内联样式的 <div>「盒子」表达表格/提示框；
    // 允许 style 但由下方 rehypeStyleGuard 逐条过滤属性，防止 CSS 注入。
    p: [...(defaultSchema.attributes?.p ?? []), 'style'],
    section: [...(defaultSchema.attributes?.section ?? []), 'style'],
    table: [...(defaultSchema.attributes?.table ?? []), 'style'],
    thead: [...(defaultSchema.attributes?.thead ?? []), 'style'],
    tbody: [...(defaultSchema.attributes?.tbody ?? []), 'style'],
    tr: [...(defaultSchema.attributes?.tr ?? []), 'style'],
    td: [...(defaultSchema.attributes?.td ?? []), 'style'],
    th: [...(defaultSchema.attributes?.th ?? []), 'style'],
    figure: ['style'],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), 'style'],
  },
  // 连内容一起丢弃，避免脚本正文以文本形式残留
  strip: ['script', 'style'],
} as typeof defaultSchema;

/*
 * 允许的内联样式属性（白名单）。这不是 XSS 防线，而是防止导入文档里
 * 的样式把整页布局顶翻（position:fixed 覆盖层等）；真正危险的 url()/
 * expression()/javascript: 会在取值层面被丢弃。
 */
const SAFE_STYLE_PROPERTY =
  /^(color|background(-color)?|border(-(top|right|bottom|left))?(-(width|style|color))?|border-radius|border-collapse|padding(-(top|right|bottom|left))?|margin(-(top|right|bottom|left))?|font-(size|weight|style|family)|text-(align|indent|transform|decoration)|line-height|letter-spacing|width|height|max-width|min-width|max-height|min-height|display|flex(-(wrap|direction|grow|shrink|basis))?|gap|grid(-template-columns)?|align-(items|content|self)|justify-(content|items|self)|list-style(-type)?|white-space|overflow(-x|-y)?|opacity|vertical-align|box-shadow|table-layout|word-break|word-wrap)$/i;
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i;

function filterStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const index = declaration.indexOf(':');
      if (index < 1) return false;
      const property = declaration.slice(0, index).trim();
      const value = declaration.slice(index + 1).trim();
      return SAFE_STYLE_PROPERTY.test(property) && !UNSAFE_STYLE_VALUE.test(value);
    })
    .join('; ');
}

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

// 在净化之后、KaTeX 渲染之前过滤用户 HTML 的内联样式（KaTeX 生成的样式不受影响）
const rehypeStyleGuard = () => (tree: HastNode) => {
  const stack: HastNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === 'element' && node.properties && typeof node.properties.style === 'string') {
      const style = filterStyle(node.properties.style);
      if (style) node.properties.style = style;
      else delete node.properties.style;
    }
    if (node.children) stack.push(...node.children);
  }
};

/*
 * 关于图片 URL：这里**不**放宽 `data:` 协议。
 * react-markdown 自带的 defaultUrlTransform 只允许 http/https/irc/mailto/xmpp
 * 与相对路径，data: 会被清空 —— 这是一层有用的防护，而知识库正文里
 * 出现的图片本来就是相对路径或 https 链接（题库题图是 Question.images，
 * 由 Exam/Practice 直接 <img> 渲染，不经过本组件）。
 */

/**
 * AI 常用 `\[ … \]` / `\( … \)` 作为公式定界符，但 Markdown 会把反斜杠当转义，
 * 最终只剩 `[ … ]` 的纯文本。这里在解析前统一改成 remark-math 认识的 $$ / $，
 * 跳过代码块，避免误改示例代码。
 */
function normalizeMathDelimiters(source: string): string {
  return source
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (match: string, body: string, offset: number, whole: string) => {
          // 独占一行时按块级公式渲染（居中、可横向滚动），否则退化为行内公式
          const lineStart = whole.lastIndexOf('\n', offset - 1) + 1;
          const lineEnd = whole.indexOf('\n', offset + match.length);
          const aloneOnLine =
            /^\s*$/.test(whole.slice(lineStart, offset)) &&
            /^\s*$/.test(whole.slice(offset + match.length, lineEnd === -1 ? whole.length : lineEnd));
          return aloneOnLine ? `$$\n${body.trim()}\n$$` : `$${body.trim()}$`;
        })
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
    })
    .join('');
}

interface MarkdownViewProps {
  content: string;
  className?: string;
}

// Markdown 渲染组件：支持标题/列表/粗体/代码/引用/表格、<details> 折叠块与数学公式，自动适配深浅主题
const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], rehypeStyleGuard, rehypeKatex]}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownView;
