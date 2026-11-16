import React, { Suspense } from 'react';

interface Props {
  content: string;
  className?: string;
}

const PlainText: React.FC<Props> = ({ content, className = '' }) => (
  <div className={`markdown-body whitespace-pre-wrap break-words ${className}`}>{content}</div>
);

// Markdown 渲染依赖较大（KaTeX 等），独立成 chunk；加载失败时降级为纯文本，避免整页打不开
const MarkdownView = React.lazy(() =>
  import('./MarkdownView').catch(() => ({ default: PlainText })),
);

/**
 * Markdown 渲染兜底：解析/渲染抛出异常时直接显示纯文本，
 * 保证知识条目、AI 回答等内容至少能看，不会整页空白。
 */
class MarkdownErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('[MarkdownView] 渲染失败，已降级为纯文本', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const SafeMarkdownView: React.FC<Props> = (props) => (
  <MarkdownErrorBoundary fallback={<PlainText {...props} />}>
    <Suspense fallback={<PlainText {...props} />}>
      <MarkdownView {...props} />
    </Suspense>
  </MarkdownErrorBoundary>
);

export default SafeMarkdownView;
