const express = require('express');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const readmeContent = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf-8');

app.get('/', (req, res) => {
  const htmlContent = marked.parse(readmeContent);
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code Toolkit</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .header {
      background: linear-gradient(135deg, #161b22 0%, #1f2937 100%);
      border-bottom: 1px solid #30363d;
      padding: 20px 40px;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header h1 {
      font-size: 1.4rem;
      color: #f0f6fc;
      font-weight: 700;
    }
    .header .badge {
      background: #238636;
      color: #fff;
      font-size: 0.75rem;
      padding: 2px 10px;
      border-radius: 12px;
      font-weight: 600;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 40px 40px;
    }
    .content h1 { display: none; }
    .content h2 {
      font-size: 1.5rem;
      color: #f0f6fc;
      border-bottom: 1px solid #30363d;
      padding-bottom: 8px;
      margin: 40px 0 16px;
    }
    .content h3 {
      font-size: 1.1rem;
      color: #79c0ff;
      margin: 24px 0 12px;
    }
    .content h4 {
      font-size: 1rem;
      color: #d2a8ff;
      margin: 16px 0 8px;
    }
    .content p { margin: 12px 0; color: #c9d1d9; }
    .content a { color: #58a6ff; text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content code {
      background: #161b22;
      border: 1px solid #30363d;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.85em;
      color: #f0f6fc;
    }
    .content pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin: 16px 0;
    }
    .content pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.875em;
      color: #e6edf3;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 0.875rem;
    }
    .content th {
      background: #161b22;
      color: #f0f6fc;
      padding: 10px 14px;
      text-align: left;
      border: 1px solid #30363d;
      font-weight: 600;
    }
    .content td {
      padding: 10px 14px;
      border: 1px solid #30363d;
      color: #c9d1d9;
      vertical-align: top;
    }
    .content tr:nth-child(even) td { background: #0d1117; }
    .content tr:nth-child(odd) td { background: #161b22; }
    .content ul, .content ol {
      margin: 12px 0 12px 24px;
    }
    .content li { margin: 4px 0; }
    .content blockquote {
      border-left: 4px solid #388bfd;
      padding: 8px 16px;
      background: #161b22;
      border-radius: 0 8px 8px 0;
      margin: 16px 0;
      color: #8b949e;
    }
    .content hr {
      border: none;
      border-top: 1px solid #30363d;
      margin: 32px 0;
    }
    .content img { max-width: 100%; height: auto; border-radius: 8px; }
    .toc {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 32px;
    }
    .toc h3 { color: #f0f6fc; margin: 0 0 12px; font-size: 1rem; }
    .toc ul { margin: 0 0 0 16px; }
    .toc li { margin: 4px 0; }
    .toc a { color: #58a6ff; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Claude Code Toolkit</h1>
    <span class="badge">135 Agents · 176+ Plugins · 42 Commands</span>
  </div>
  <div class="container">
    <div class="content">
      ${htmlContent}
    </div>
  </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code Toolkit viewer running on http://0.0.0.0:${PORT}`);
});
