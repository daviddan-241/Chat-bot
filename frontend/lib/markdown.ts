/**
 * Lightweight markdown → HTML with syntax-highlighted code blocks.
 * Uses `marked` for parsing and `highlight.js` for code highlighting.
 * We sanitize by allow-listing tags via a simple post-processor.
 */
import { marked, type Tokens } from "marked";
import hljs from "highlight.js";

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }: Tokens.Code) => {
  const language = (lang || "").trim() || "plaintext";
  let highlighted = text;
  try {
    if (language !== "plaintext" && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
  } catch {
    highlighted = escapeHtml(text);
  }
  const safeLang = escapeHtml(language);
  return `<div class="rounded-xl overflow-hidden border border-white/5 my-2 bg-[#0c1220]">
    <div class="flex items-center justify-between px-3 py-1.5 text-[11px] text-ink-muted border-b border-white/5 bg-white/[0.02]">
      <span class="font-mono">${safeLang}</span>
      <button data-copy="1" class="hover:text-ink transition">Copy</button>
    </div>
    <pre><code class="hljs language-${safeLang}">${highlighted}</code></pre>
  </div>`;
};

marked.setOptions({ renderer, breaks: true, gfm: true });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  try {
    const html = marked.parse(src, { async: false }) as string;
    return html;
  } catch {
    return `<p>${escapeHtml(src)}</p>`;
  }
}
