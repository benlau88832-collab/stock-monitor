// ============================================================
// v9.96.0（批次 1）：轻量 Markdown 渲染（LLM 叙事报告用，零依赖）
// 覆盖：##/### 标题、| 表格、- 列表、> 引用、**粗体**、普通段落
// 说明：报告为 LLM 生成的受控 Markdown（≤600 字），简易渲染足够，不引入 react-markdown 依赖
// ============================================================
import React from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // **粗体** 分段
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<b key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</b>);
    } else if (part.trim()) {
      nodes.push(<span key={`${keyPrefix}-s${i}`}>{part}</span>);
    }
  });
  return nodes;
}

/** 简易 Markdown → React 节点（标题/表格/列表/引用/段落） */
export function renderMiniMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let listItems: string[] = [];
  let i = 0;

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return;
    const head = tableRows[0];
    const body = tableRows.slice(1).filter(r => !r.every(c => /^[-: ]+$/.test(c))); // 跳过分隔行
    out.push(
      <div key={key} className="overflow-x-auto my-1.5">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr>{head.map((c, ci) => <th key={ci} className="border border-white/10 bg-white/5 px-2 py-1 text-left text-slate-300">{c.trim()}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-white/5 px-2 py-1 text-slate-400">{renderInline(c.trim(), `${key}-${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
  };

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    out.push(
      <ul key={key} className="list-disc pl-5 my-1 text-[12px] text-slate-300 space-y-0.5">
        {listItems.map((li, liIdx) => <li key={liIdx}>{renderInline(li, `${key}-li${liIdx}`)}</li>)}
      </ul>,
    );
    listItems = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flushTable(`t${i}`); flushList(`l${i}`); continue; }

    // 表格行
    if (trimmed.startsWith("|")) {
      flushList(`l${i}`);
      const cells = trimmed.split("|").slice(1, -1);
      tableRows.push(cells);
      continue;
    }
    flushTable(`t${i}`);

    // 标题
    if (trimmed.startsWith("### ")) { out.push(<h4 key={`h3${i}`} className="mt-2 mb-1 text-[13px] font-bold text-slate-100">{renderInline(trimmed.slice(4), `h3${i}`)}</h4>); continue; }
    if (trimmed.startsWith("## ")) { out.push(<h3 key={`h2${i}`} className="mt-2.5 mb-1 text-[14px] font-black text-amber-200">{renderInline(trimmed.slice(3), `h2${i}`)}</h3>); continue; }
    // 列表
    if (/^[-*•]\s/.test(trimmed)) { listItems.push(trimmed.replace(/^[-*•]\s/, "")); continue; }
    flushList(`l${i}`);
    // 引用
    if (trimmed.startsWith(">")) { out.push(<div key={`q${i}`} className="my-1 border-l-2 border-slate-600 pl-2 text-[11px] text-slate-500 italic">{renderInline(trimmed.slice(1).trim(), `q${i}`)}</div>); continue; }
    // 普通段落
    out.push(<p key={`p${i}`} className="my-1 text-[12px] text-slate-300 leading-relaxed">{renderInline(trimmed, `p${i}`)}</p>);
  }
  flushTable(`t-end`);
  flushList(`l-end`);
  return <div className="space-y-0.5">{out}</div>;
}
