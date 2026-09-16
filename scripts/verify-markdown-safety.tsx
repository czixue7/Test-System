/**
 * Markdown 渲染安全回归测试（C8）。
 * 运行：npm run test:security
 *
 * 断言 rehype-raw + rehype-sanitize 组合能拦掉注入向量，
 * 同时不误伤知识库依赖的合法标签（<details> 折叠块、表格、粗体）。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownView from '../src/components/MarkdownView';

const render = (md: string) => renderToStaticMarkup(React.createElement(MarkdownView, { content: md }));

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  ✗ ${name}`);
  }
}

const mustNotContain = (html: string, needle: string) => {
  if (html.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`输出中不应包含 ${needle}，实际 HTML：${html.slice(0, 300)}`);
  }
};

const mustContain = (html: string, needle: string) => {
  if (!html.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`输出中应包含 ${needle}，实际 HTML：${html.slice(0, 300)}`);
  }
};

console.log('\nC8 — Markdown HTML 注入必须被净化');

check('iframe srcdoc 注入被移除（关键利用链）', () => {
  const html = render('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
  mustNotContain(html, '<iframe');
  mustNotContain(html, 'srcdoc');
});

check('script 标签（含内容）被移除', () => {
  const html = render('<script>alert(1)</script>');
  mustNotContain(html, '<script');
  mustNotContain(html, 'alert(1)');
});

check('img onerror 属性被移除、标签本身保留', () => {
  const html = render('<img src="x" onerror="alert(1)">');
  mustNotContain(html, 'onerror');
  mustContain(html, '<img');
});

check('javascript: 协议链接被拦截', () => {
  const html = render('[点我](javascript:alert(1))');
  mustNotContain(html, 'javascript:');
});

check('style / object / form / embed 被移除', () => {
  mustNotContain(render('<style>body{display:none}</style>'), '<style');
  mustNotContain(render('<object data="x"></object>'), '<object');
  mustNotContain(render('<form action="/x"><input name="a"></form>'), '<form');
  mustNotContain(render('<embed src="x">'), '<embed');
});

check('事件属性 onclick 被移除', () => {
  const html = render('<div onclick="alert(1)">内容</div>');
  mustNotContain(html, 'onclick');
});

console.log('\n合法性 — 知识库依赖的标签必须保留');

check('<details>/<summary> 折叠块保留', () => {
  const html = render('<details><summary>标题</summary>正文内容</details>');
  mustContain(html, '<details');
  mustContain(html, '<summary');
  mustContain(html, '正文内容');
});

check('GFM 表格保留', () => {
  const html = render('| 项目 | 值 |\n| --- | --- |\n| 温度 | 21 |');
  mustContain(html, '<table');
  mustContain(html, '温度');
});

check('常规 Markdown（粗体/列表/代码）保留', () => {
  const html = render('**粗体**\n\n- 一\n- 二\n\n`code`');
  mustContain(html, '<strong');
  mustContain(html, '<li');
  mustContain(html, '<code');
});

check('data: 协议图片被清空（defaultUrlTransform 的防护，不放开）', () => {
  const html = render('<img src="data:image/png;base64,iVBORw0KGgo=" alt="题图">');
  mustContain(html, '<img');
  mustNotContain(html, 'data:image/png');
});

check('相对路径与 https 图片保留', () => {
  mustContain(render('<img src="/banks/第三周考题/image/13-1.jpg" alt="题图">'), '/banks/');
  mustContain(render('<img src="https://example.com/a.png" alt="题图">'), 'https://example.com/a.png');
});

console.log(`\n${'='.repeat(64)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log('\n失败明细：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('全部通过 ✅');
