/* NEXUS frontend — wires the premium UI to the real 360-agent backend. */
const API = '/api/orchestrator';
let PROJECT = 'default';
let busy = false;

/* ── Sidebar nav model ── */
const NAV = [
  {sec:'Home'},
  {id:'chat', ico:'💬', label:'New Chat', badge:''},
  {id:'history', ico:'🕘', label:'Chat History'},
  {id:'projects', ico:'📁', label:'Projects'},
  {id:'agents', ico:'🧠', label:'Agents', badge:'470'},
  {id:'artifacts', ico:'✨', label:'Artifacts'},
  {id:'skills', ico:'📚', label:'Skills Library'},
  {sec:'Platform'},
  {id:'wallet', ico:'💰', label:'Crypto Wallet'},
  {id:'testplans', ico:'🗂️', label:'Test Plan Executor'},
  {id:'connectors', ico:'🔌', label:'Connectors'},
  {id:'deployments', ico:'🚀', label:'Deployments'},
  {id:'knowledge', ico:'🗄️', label:'Knowledge Base'},
  {id:'settings', ico:'⚙️', label:'Settings'},
];

function buildNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(n=>{
    if(n.sec) return `<div class="nav-sec">${n.sec}</div>`;
    return `<div class="nav-item ${n.id==='chat'?'active':''}" data-id="${n.id}" onclick="go('${n.id}')">
      <span class="ico">${n.ico}</span><span>${n.label}</span>${n.badge?`<span class="badge">${n.badge}</span>`:''}</div>`;
  }).join('');
}

const TITLES={chat:'New Chat',agents:'Agent Dashboard',connectors:'Connectors',settings:'Settings',
  artifacts:'Artifacts',projects:'Projects',skills:'Skills Library',deployments:'Deployments',
  knowledge:'Knowledge Base',history:'Chat History',wallet:'Crypto Wallet',testplans:'Test Plan Executor'};

/* ── TOAST ── */
function toast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2600);
}

let AUTO_REFRESH=null;
function go(id){
  // stop any running auto-refresh when leaving a view
  if(AUTO_REFRESH){ clearInterval(AUTO_REFRESH); AUTO_REFRESH=null; }
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.id===id));
  document.getElementById('viewTitle').textContent = TITLES[id]||id;
  ['chat','agents','connectors','settings','artifacts','wallet'].forEach(v=>{
    const el=document.getElementById('view-'+v); if(el) el.classList.remove('active');
  });
  document.getElementById('view-generic').classList.remove('active');
  document.getElementById('inputbar').style.display = (id==='chat')?'block':'none';

  document.getElementById('fab').style.display = (id==='chat')?'grid':'none';
  if(['chat','agents','connectors','settings','artifacts','skills','deployments','projects','history','wallet','testplans'].includes(id)){
    if(id==='skills'){ document.getElementById('view-generic').classList.add('active'); loadSkills(); }
    else if(id==='deployments'){ document.getElementById('view-generic').classList.add('active'); loadDeployments(); }
    else if(id==='projects'){ document.getElementById('view-generic').classList.add('active'); loadProjects(); }
    else if(id==='history'){ document.getElementById('view-generic').classList.add('active'); loadHistory(); }
    else if(id==='testplans'){ document.getElementById('view-generic').classList.add('active'); loadTestPlans(); }
    else { document.getElementById('view-'+id).classList.add('active');
      if(id==='agents'){ loadAgents(); AUTO_REFRESH=setInterval(()=>{ if(document.getElementById('view-agents').classList.contains('active')) loadAgents(); }, 4000); }
      if(id==='connectors') loadConnectors();
      if(id==='settings') loadSettings();
      if(id==='artifacts') loadArtifacts();
      if(id==='wallet') loadWallet();
    }
  } else {
    const g=document.getElementById('view-generic'); g.classList.add('active');
    document.getElementById('genTitle').textContent = TITLES[id];
    document.getElementById('genSub').textContent = 'Connected to project memory. This section ties into the same engine.';
  }
  toggleSidebar(false);
}

function toggleSidebar(force){
  const sb=document.getElementById('sidebar'), bd=document.getElementById('backdrop');
  const open = force===undefined ? !sb.classList.contains('open') : force;
  sb.classList.toggle('open',open); bd.classList.toggle('show',open);
}

/* ── LLM status pill ── */
async function refreshLLM(){
  try{
    const r = await fetch(API+'/summary'); const j = await r.json();
    document.getElementById('agentCount').textContent = `${j.catalog.total} agents online`;
    const demo = j.llm.demo_mode;
    document.getElementById('llmDot').className = 'dot'+(demo?' demo':'');
    document.getElementById('llmLabel').textContent = demo?'Demo':'Live · '+j.llm.active;
  }catch(e){}
}

/* ── CHAT / RUN ── */
let CONV=null;  // current conversation id
function newChat(){ CONV=null; document.getElementById('msgs').innerHTML=''; document.getElementById('emptyState').style.display='block'; document.getElementById('viewTitle').textContent='New Chat'; go('chat'); }
function quick(t){ document.getElementById('prompt').value=t; send(); }
async function saveMsg(role, content){
  try{
    if(!CONV){ const r=await (await fetch(API+'/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:PROJECT})})).json(); CONV=r.conversation.id; }
    const r=await (await fetch(`${API}/conversations/${CONV}/message`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,content,project_id:PROJECT})})).json();
    if(r.title) document.getElementById('viewTitle').textContent=r.title;
  }catch(_){}
}

function addMsg(role, html){
  document.getElementById('emptyState').style.display='none';
  const m=document.createElement('div'); m.className='msg '+role;
  m.innerHTML = role==='ai' ? `<div class="who">NEXUS</div><div class="body"></div>` : `<div class="body"></div>`;
  m.querySelector('.body').innerHTML = html;
  document.getElementById('msgs').appendChild(m); scrollDown(); return m;
}
function scrollDown(){ const v=document.getElementById('view-chat'); v.scrollTop=v.scrollHeight; }
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function send(){
  if(busy) return;
  const p=document.getElementById('prompt'); let goal=p.value.trim();
  const attach=PENDING_ATTACH;
  if(!goal && !attach) return;
  if(!goal && attach) goal = attach.kind==='image' ? 'Describe/analyze this image.' : 'Review this file.';
  p.value=''; p.style.height='auto';
  // user bubble (with image thumb if attached)
  let ubody = esc(goal);
  if(attach && attach.kind==='image') ubody = `<img src="${attach.dataUrl}" style="max-width:200px;border-radius:10px;margin-bottom:6px"><br>`+ubody;
  else if(attach) ubody = `📄 ${esc(attach.name)}<br>`+ubody;
  addMsg('user', ubody);
  saveMsg('user', goal);
  const reqBody = {goal, project_id:PROJECT};
  if(CONV) reqBody.conv_id = CONV;
  if(attach && attach.kind==='image'){ reqBody.image_b64 = attach.dataUrl; }
  if(attach && attach.kind==='text'){ reqBody.goal = goal+`\n\n[Attached file: ${attach.name}]\n`+attach.text; }
  clearAttach();
  const ai = addMsg('ai', '<span class="thinking"><span class="shimmer">Thinking</span><span class="dots"><i></i><i></i><i></i></span></span>');
  const body = ai.querySelector('.body');
  CUR_GROUP=null;
  busy=true; document.getElementById('sendBtn').disabled=true;
  let finalAnswer='';

  try{
    const res = await fetch(API+'/run',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(reqBody)});
    const reader = res.body.getReader(); const dec=new TextDecoder(); let buf='';
    body.innerHTML='';
    while(true){
      const {done,value}=await reader.read(); if(done) break;
      buf += dec.decode(value,{stream:true});
      let lines = buf.split('\n'); buf = lines.pop();
      for(const line of lines){
        if(!line.startsWith('data: ')) continue;
        const payload=line.slice(6); if(payload==='[DONE]') continue;
        let ev; try{ev=JSON.parse(payload);}catch(e){continue;}
        if(ev.type==='final') finalAnswer=(ev.data&&ev.data.answer)||'';
        renderEvent(ev, body);
      }
    }
    if(finalAnswer) saveMsg('assistant', finalAnswer);
  }catch(e){ body.innerHTML='<span style="color:var(--error)">Error: '+esc(e.message)+'</span>'; }
  busy=false; document.getElementById('sendBtn').disabled=false;
  refreshLLM();  // update the pill to show which provider actually answered
}

/* Friendly one-line summary of a tool action — NO raw JSON/code in the chat. */
function toolSummary(tool, raw){
  let a={}; try{a=JSON.parse(raw||'{}');}catch(_){}
  switch(tool){
    case 'write_file': return a.path?`Writing ${a.path}`:'Writing a file';
    case 'read_file': return a.path?`Reading ${a.path}`:'Reading a file';
    case 'run_code': return `Running ${a.lang||'code'}`;
    case 'run_shell': return `Running: ${(a.cmd||'').slice(0,40)}`;
    case 'kali_exec': return `Kali: ${(a.cmd||'').slice(0,40)}`;
    case 'web_search': return `Searching: ${(a.query||'').slice(0,40)}`;
    case 'generate_image': return 'Generating an image';
    case 'edit_image': return 'Editing image with AI';
    case 'generate_video': return 'Generating a video';
    default: return tool;
  }
}
function toolResultSummary(tool, raw){
  let r={}; try{r=JSON.parse(raw||'{}');}catch(_){return 'done';}
  if(r.ok===false) return '⚠️ '+(r.error||'failed').slice(0,80);
  switch(tool){
    case 'write_file': return `Saved ${r.path||'file'}${r.bytes?` (${r.bytes}b)`:''} → Workspace`;
    case 'run_code': case 'run_shell': case 'kali_exec':
      return (r.output||'').trim().slice(0,80)||'done';
    case 'generate_image': return 'Image ready';
    case 'edit_image': return 'Image edited';
    case 'generate_video': return 'Video ready';
    default: return 'done';
  }
}
/* Strip ```code``` blocks from final answer → send to Workspace, keep chat clean. */
function stashCodeBlocks(text){
  const blocks=[]; let i=0;
  const clean=text.replace(/```(\w+)?\n?([\s\S]*?)```/g,(m,lang,code)=>{
    const extMap={python:'py',javascript:'js',typescript:'ts',html:'html',css:'css',
      bash:'sh',shell:'sh',json:'json',php:'php',ruby:'rb',go:'go',rust:'rs',
      java:'java',c:'c',cpp:'cpp','c++':'cpp',sql:'sql',yaml:'yml',jsx:'jsx',tsx:'tsx'};
    const ext=extMap[(lang||'').toLowerCase()]||'txt';
    i++; blocks.push({lang:lang||'txt',code:code.trim(),name:`snippet_${i}.${ext}`});
    return `\n📄 [Code block ${i} — open in Workspace]\n`;
  });
  return {clean, blocks};
}

// ── Cursor/Factory-style: narration prose + collapsible "N actions" groups ──
let CUR_GROUP=null;  // current open actions group element
function openGroup(body){
  const g=document.createElement('details'); g.className='actgroup';
  g.innerHTML=`<summary><span class="agc"></span><span class="agcount">actions</span><span class="chev">›</span></summary><div class="agbody"></div>`;
  body.appendChild(g); g._n=0;
  CUR_GROUP=g; return g;
}
function groupAdd(icon, label, openHref){
  if(!CUR_GROUP) return;
  const row=document.createElement('div'); row.className='agrow';
  row.innerHTML=`<span class="ic">${icon}</span><div style="flex:1">${label}</div>`+
    (openHref?`<a href="${openHref}" target="_blank" class="openf">Open file ↗</a>`:'');
  CUR_GROUP.querySelector('.agbody').appendChild(row);
  CUR_GROUP._n++;
  CUR_GROUP.querySelector('.agcount').textContent=`${CUR_GROUP._n} action${CUR_GROUP._n>1?'s':''}`;
}

/* ── Image skeleton → real image swap (Grok-style) ── */
function showImageWithSkeleton(body, getUrl, altText){
  const wrap = document.createElement('div');
  wrap.className = 'img-gen-wrap'; wrap.style.cssText='margin:12px 0;';
  wrap.innerHTML = `
    <div class="img-skeleton" style="
      width:100%;max-width:380px;height:340px;border-radius:18px;
      background:var(--card,#f4f4f4);position:relative;overflow:hidden;
      display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;inset:0;background:repeating-radial-gradient(circle,rgba(0,0,0,.06) 0 1px,transparent 0 12px) 0 0/24px 24px;"></div>
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:1;">
        <span style="font-size:24px">🎨</span>
        <span class="shimmer" style="font-size:13px;color:var(--muted)">Generating…</span>
      </div>
    </div>`;
  body.appendChild(wrap); CUR_GROUP=null; scrollDown();
  const url = typeof getUrl === 'function' ? getUrl() : getUrl;
  const img = new Image();
  img.onload = () => {
    wrap.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:18px;display:block;" alt="${esc(altText||'Generated image')}">`;
    scrollDown();
  };
  img.onerror = () => {
    // Still show the image — Pollinations generates on GET, may take a moment
    setTimeout(()=>{
      wrap.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:18px;display:block;" alt="${esc(altText||'Image')}">`;
      scrollDown();
    }, 3000);
  };
  img.src = url;
}

function renderEvent(ev, body){
  // Handle coordinator's raw image_result events (no data wrapper)
  if(ev.type==='image_result'){
    const th=body.querySelector('.thinking'); if(th) th.remove();
    const s=body.querySelector('.statusline'); if(s) s.remove();
    if(ev.url){
      showImageWithSkeleton(body, ev.url, ev.prompt||'');
    } else if(ev.path){
      const url = `${API}/file/${PROJECT}/${encodeURIComponent(ev.path)}`;
      showImageWithSkeleton(body, url, ev.prompt||ev.instruction||'');
    }
    return;
  }
  const d=ev.data||{};
  if(ev.type==='status'){
    const th=body.querySelector('.thinking'); if(th) th.remove();
    let s=body.querySelector('.statusline'); if(!s){s=document.createElement('div');s.className='statusline event live';body.appendChild(s);}
    const phaseIcon={planning:'🧠',routing:'🎯',executing:'⚙️',integrating:'🧩',
      verifying:'✅',inspecting:'🕵️',answering:'💬',deploying:'🚀'}[d.phase]||'⏳';
    s.innerHTML=`<div class="lbl">${phaseIcon} <span class="shimmer">${esc((d.phase||'working'))}</span> <span class="dots" style="display:inline-flex;gap:3px"><i style="width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block"></i></span></div>`;
  } else if(ev.type==='plan'){
    const s=body.querySelector('.statusline'); if(s) s.remove();
    const p=document.createElement('div'); p.className='narr';
    p.innerHTML=`<b>Plan</b> · ${d.tasks.length} step${d.tasks.length>1?'s':''}<br><span style="color:var(--text2)">${d.tasks.map((t,i)=>(i+1)+'. '+esc(t.title)).join('<br>')}</span>`;
    body.appendChild(p);
  } else if(ev.type==='route'){
    /* keep quiet — routing shows via narration */
  } else if(ev.type==='narration'){
    const s=body.querySelector('.statusline'); if(s) s.remove();
    CUR_GROUP=null; // narration ends a group
    if(d.text && d.text.trim()){
      const p=document.createElement('div'); p.className='narr';
      const {clean}=stashCodeBlocks(d.text);
      p.innerHTML=esc(clean);
      body.appendChild(p);
    }
  } else if(ev.type==='actions_start'){
    openGroup(body);
  } else if(ev.type==='actions_end'){
    CUR_GROUP=null;
  } else if(ev.type==='agent'){
    /* completion shown via narration/final */
  } else if(ev.type==='tool_start'){
    if(!CUR_GROUP) openGroup(body);
    groupAdd('🔧', esc(toolSummary(d.tool,d.args_preview)));
  } else if(ev.type==='tool_result'){
    // upgrade the last row to a 'Created X · Open file' style and show media
    try{
      const r=JSON.parse(d.result_preview||'{}');
      if(r.ok && (d.tool==='generate_image'||d.tool==='edit_image')){
        if(r.path){
          const url=`${API}/file/${PROJECT}/${encodeURIComponent(r.path)}`;
          showImageWithSkeleton(body, url, r.prompt||'');
        } else if(r.url){
          showImageWithSkeleton(body, r.url, r.prompt||'');
        }
      } else if(r.ok && r.path && d.tool==='generate_video'){
        const m=document.createElement('div'); m.style.margin='8px 0';
        m.innerHTML=`<video controls style="max-width:100%;border-radius:12px" src="${API}/file/${PROJECT}/${encodeURIComponent(r.path)}"></video>`;
        body.appendChild(m); CUR_GROUP=null;
      } else if(CUR_GROUP){
        const rows=CUR_GROUP.querySelectorAll('.agrow'); const last=rows[rows.length-1];
        if(last){
          const href = (r.ok && r.path)?`${API}/file/${PROJECT}/${encodeURIComponent(r.path)}`:'';
          last.querySelector('div').innerHTML = esc(toolResultSummary(d.tool, d.result_preview));
          if(href){ const a=document.createElement('a'); a.href=href; a.target='_blank'; a.className='openf'; a.textContent='Open file ↗'; last.appendChild(a); }
        }
      }
    }catch(_){}
  } else if(ev.type==='question'){
    const s=body.querySelector('.statusline'); if(s) s.remove();
    const e=document.createElement('div'); e.className='event'; e.style.borderColor='var(--accent)';
    e.innerHTML=`<div class="lbl" style="color:var(--accent)">❓ ${esc(d.question||'A quick question')}</div>
      <div class="qopts" style="margin-top:8px"></div>
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">…or just type your own answer below.</div>`;
    const wrap=e.querySelector('.qopts');
    (d.options||[]).forEach(o=>{
      const b=document.createElement('button'); b.className='btn sec qopt';
      b.style.cssText='margin:4px 6px 0 0'; b.textContent=o;
      b.onclick=()=>answerQuestion(o);
      wrap.appendChild(b);
    });
    body.appendChild(e);
  } else if(ev.type==='deploy'){
    const e=document.createElement('div'); e.className='event';
    e.style.borderColor = d.ok?'var(--success)':'var(--error)';
    e.innerHTML = d.ok
      ? `<div class="lbl" style="color:var(--success)">🚀 Deployed to ${esc(d.target)}</div>`+
        (d.url?`<div class="sub"><a href="${esc(d.url)}" target="_blank" style="color:var(--accent)">${esc(d.url)}</a></div>`:'')+
        (d.monitored?`<div class="sub">📡 Added to uptime monitor + self-ping</div>`:'')+
        (d.note?`<div class="sub">${esc(d.note)}</div>`:'')
      : `<div class="lbl" style="color:var(--error)">⚠️ Deploy to ${esc(d.target)} failed</div><div class="sub">${esc(d.error||'')}</div>`;
    body.appendChild(e);
  } else if(ev.type==='final'){
    const s=body.querySelector('.statusline'); if(s) s.remove();
    CUR_GROUP=null;
    const {clean, blocks}=stashCodeBlocks(d.answer||'');
    if(blocks.length){ window.LAST_CODE=blocks; saveBlocksToWorkspace(blocks); }
    const e=document.createElement('div');
    e.style.cssText='margin-top:10px;font-size:16px;line-height:1.55;';
    // provider badge — shows which model/API answered
    const provBadge = d.provider
      ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;display:flex;align-items:center;gap:4px">
           <span style="width:6px;height:6px;border-radius:50%;background:var(--success);display:inline-block"></span>
           via ${esc(d.provider)}${d.model?' · '+esc(d.model):''}
         </div>`
      : '';
    e.innerHTML=`<div class="body">${esc(clean)}</div>`+
      (blocks.length?`<button class="btn sec" style="margin-top:10px;padding:8px 14px;font-size:13px" onclick="openWS();selectWSTab('preview');setTimeout(runPreview,300)">▶ Preview & files</button>`:'')+
      provBadge;
    body.appendChild(e);
  }
  scrollDown();
}
function answerQuestion(ans){
  const p=document.getElementById('prompt'); p.value=ans;
  document.querySelectorAll('.qopt').forEach(b=>b.disabled=true);
  send();
}
async function saveBlocksToWorkspace(blocks){
  for(const b of blocks){
    try{ await fetch(`${API}/workspace/${PROJECT}/write`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({path:b.name,content:b.code})}); }catch(_){}
  }
}

/* ── AGENT DASHBOARD ── */
async function loadAgents(){
  const wrap=document.getElementById('agentsWrap');
  wrap.innerHTML='<div class="empty">Loading agents…</div>';
  const r=await fetch(API+'/fleet'); const j=await r.json();
  const c=j.status_counts;
  let hl={}; try{ hl=await (await fetch(API+'/health')).json(); }catch(_){}
  const allReady = hl.all_ready;
  let html=`<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span class="dot" style="${allReady?'':'background:var(--warning)'}"></span>
    <div><b>${allReady?'All agents ready & healthy':'Some agents warming up'}</b>
    <div style="font-size:12px;color:var(--muted)">${hl.healthy||0}/${hl.total||j.summary.total} healthy · live heartbeat · uptime ${Math.round((hl.uptime_seconds||0)/60)}m</div></div></div>
  <div class="statbar">
    <div class="stat"><div class="n">${j.summary.total}</div><div class="l">Total Agents</div></div>
    <div class="stat"><div class="n" style="color:var(--success)">${hl.ready||((c.online||0)+(c.completed||0))}</div><div class="l">Ready</div></div>
    <div class="stat"><div class="n" style="color:var(--warning)">${hl.working||c.running||0}</div><div class="l">Working</div></div>
    <div class="stat"><div class="n">${Object.keys(j.summary.domains).length}</div><div class="l">Domains</div></div>
  </div>`;
  const dom=await (await fetch(API+'/domains')).json();
  for(const [name,agents] of Object.entries(dom)){
    html+=`<div class="domhdr">${name} <span class="cnt">${agents.length}</span></div><div class="grid">`;
    html+=agents.slice(0,12).map(a=>card(a)).join('');
    if(agents.length>12) html+=`<div class="acard" style="display:grid;place-items:center;color:var(--muted)">+${agents.length-12} more workers</div>`;
    html+='</div>';
  }
  wrap.innerHTML=html;
}
function card(a){
  return `<div class="acard">
    <div class="name"><span class="sdot s-${a.status}"></span>${a.name}</div>
    <div class="dom">${a.domain} · ${a.tier}</div>
    <div class="task">${a.task||'<span style="color:var(--success)">● Online</span>'}</div>
    <div class="bar"><i style="width:${a.progress||0}%"></i></div></div>`;
}

/* ── CONNECTORS ── */
async function loadConnectors(){
  const wrap=document.getElementById('connWrap');
  const j=await (await fetch(API+'/connectors')).json();
  wrap.innerHTML=`<div class="card"><h3>Connectors</h3>
    <p style="color:var(--text2);font-size:13px">Tap <b>Connect</b>, paste your token, and it's saved + tested instantly. Real API calls — no copying into Settings.</p>`+
    j.connectors.map(c=>`<div class="conn" id="conn_${c.id}">
      <div class="ci">${c.label[0]}</div>
      <div style="flex:1"><div class="cn">${c.label}</div><div class="cs">${c.fields.join(', ')}</div></div>
      <span class="tag ${c.connected?'on':'off'}">${c.connected?'Connected':'Not set'}</span>
      <button class="btn sec" style="padding:6px 12px;font-size:12px;margin-left:8px" onclick="toggleConnect('${c.id}','${esc(c.label)}',${JSON.stringify(c.fields).replace(/"/g,'&quot;')},${c.has_test})">${c.connected?'Manage':'Connect'}</button>
    </div><div id="form_${c.id}"></div>`).join('')+`</div>
    <div id="connResult" style="font-size:13px;color:var(--text2);padding:0 4px"></div>`;
}
function toggleConnect(id,label,fields,hasTest){
  const box=document.getElementById('form_'+id);
  if(box.innerHTML){ box.innerHTML=''; return; }
  box.innerHTML=`<div style="background:var(--bg2);border-radius:14px;padding:12px;margin:6px 0">
    ${fields.map(f=>`<div class="field"><label>${f}</label><input id="cf_${id}_${f}" placeholder="Paste ${f}" autocomplete="off" autocapitalize="off"></div>`).join('')}
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn" onclick="saveConnect('${id}',${JSON.stringify(fields).replace(/"/g,'&quot;')},${hasTest})">Save & Connect</button>
      ${hasTest?`<button class="btn sec" onclick="testConn('${id}')">Test</button>`:''}
      <span id="cmsg_${id}" style="font-size:12px"></span>
    </div></div>`;
}
async function saveConnect(id,fields,hasTest){
  const updates={};
  fields.forEach(f=>{ const el=document.getElementById('cf_'+id+'_'+f); if(el&&el.value.trim()) updates[f]=el.value.trim(); });
  if(!Object.keys(updates).length){ document.getElementById('cmsg_'+id).innerHTML='<span style="color:var(--error)">Enter a value</span>'; return; }
  await fetch(API+'/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});
  document.getElementById('cmsg_'+id).innerHTML='<span style="color:var(--success)">✓ Saved</span>';
  toast(id+' connected'); refreshLLM();
  if(hasTest){ await testConn(id); }
  setTimeout(loadConnectors, 800);
}
async function testConn(id){
  const out=document.getElementById('connResult'); if(out) out.textContent='Testing '+id+'…';
  const cmsg=document.getElementById('cmsg_'+id);
  const r=await (await fetch(API+`/connectors/${id}/test`,{method:'POST'})).json();
  const msg = r.ok ? `✅ ${id}: `+esc(JSON.stringify(r)).slice(0,140)
                   : `⚠️ ${id}: `+esc(r.error||JSON.stringify(r)).slice(0,160);
  const col = r.ok?'var(--success)':'var(--error)';
  if(out) out.innerHTML=`<span style="color:${col}">${msg}</span>`;
  if(cmsg) cmsg.innerHTML=`<span style="color:${col}">${r.ok?'✓ verified':'failed'}</span>`;
}

/* ── SETTINGS / KEY VAULT ── */
const KEY_GROUPS=[
  {h:'Model Providers',keys:[
    ['custom_api_base_url','Custom API Base URL'],['custom_api_key','Custom API Key'],
    ['custom_model_frontier','Custom Model · Frontier (optional — leave blank for default)'],['custom_model_balanced','Custom Model · Balanced (optional — leave blank for default)'],
    ['groq_api_key','① Groq API Key (gsk_… — tried FIRST, free)'],
    ['openai_api_key','② OpenAI API Key (sk-…)'],
    ['openrouter_api_key','③ OpenRouter API Key (sk-or-…)'],
    ['hf_token','④ HuggingFace Token (hf_…)'],
    ['deepseek_api_key','⑥ DeepSeek API Key'],
    ['xai_api_key','Grok / xAI API Key (xai-…)'],['tavily_api_key','Tavily Search Key'],
    ['cerebras_api_key','Cerebras API Key (free tier — cerebras.ai)'],
    ['sambanova_api_key','SambaNova API Key (free tier — sambanova.ai)'],
    ['together_api_key','Together.AI API Key (free tier — together.ai)'],
    ['mistral_api_key','Mistral API Key (free tier — mistral.ai)'],
    ['gemini_api_key','Google Gemini API Key (free 60 RPM — aistudio.google.com)'],
    ['fireworks_api_key','Fireworks.AI API Key (free credits — fireworks.ai)'],
    ['novita_api_key','Novita.AI API Key (free credits — novita.ai)'],
    ['cohere_api_key','Cohere API Key (free tier — cohere.com)'],
    ['serper_api_key','Serper Search Key (free 2500 req — serper.dev)'],
    ['bing_search_api_key','Bing Search Key (free tier — azure.microsoft.com)']]},
  {h:'Custom Kali Linux',keys:[['kali_api_url','Kali API URL'],['kali_api_key','Kali API Key']]},
  {h:'Deploy & Code',keys:[['github_token','GitHub Token'],['vercel_token','Vercel Token'],
    ['netlify_token','Netlify Token'],['render_api_key','Render API Key'],['railway_token','Railway Token']]},
  {h:'Payments',keys:[['stripe_secret_key','Stripe Secret Key'],['flutterwave_secret_key','Flutterwave Secret Key']]},
  {h:'Social',keys:[['tiktok_token','TikTok Token'],['instagram_token','Instagram Token'],
    ['facebook_token','Facebook Token'],['x_bearer_token','X (Twitter) Bearer'],['linkedin_token','LinkedIn Token']]},
];
async function loadSettings(){
  const wrap=document.getElementById('setWrap');
  const st=(await (await fetch(API+'/keys')).json()).fields;
  const ins=await (await fetch(API+'/instructions')).json();
  const masterCard=`<div class="card"><h3>🧭 Master Instructions (overrides everything)</h3>
    <p style="color:var(--text2);font-size:13px">Applied ahead of every agent, the coordinator and the verifier. Sets your defaults, tone, coding style & rules.</p>
    <textarea id="masterIns" style="width:100%;min-height:120px;border:1px solid var(--border);border-radius:14px;padding:12px;background:var(--bg2);color:var(--text);font-size:15px" placeholder="e.g. Always write complete production code with no placeholders. Default stack: Python + React. Tone: direct.">${esc(ins.text||'')}</textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
      <button class="btn" onclick="saveMaster()">Save Master Instructions</button>
      <span id="masterMsg" style="color:var(--success);font-size:13px"></span></div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px">
      <b>Always-on floor (cannot be disabled):</b> ${esc(ins.floor||'')}</div></div>`;
  const pushCard=`<div class="card"><h3>🚀 Push NEXUS to GitHub</h3>
    <p style="color:var(--text2);font-size:13px">Add your GitHub token in “Deploy & Code” below, then push this whole app to a repo.</p>
    <div class="field"><label>Target repo (owner/name)</label><input id="pushRepo" placeholder="daviddan-241/Chat-bot"></div>
    <div class="field"><label>Commit message</label><input id="pushMsg" placeholder="Deploy via NEXUS"></div>
    <div style="display:flex;gap:8px;align-items:center"><button class="btn" onclick="pushSelf()">Push to GitHub</button>
      <span id="pushOut" style="font-size:13px"></span></div></div>`;
  const insp=await (await fetch(API+'/inspector/status')).json();
  const inspCard=`<div class="card"><h3>🕵️ AI-Detection Inspector</h3>
    <p style="color:var(--text2);font-size:13px">Final pass that checks every answer reads natural/human and rewrites AI-tells (keeps code untouched).</p>
    <label style="display:flex;align-items:center;gap:10px;font-weight:600">
      <input type="checkbox" id="inspToggle" ${insp.enabled?'checked':''} onchange="toggleInspector(this.checked)" style="width:20px;height:20px">
      Humanize & inspect outputs automatically</label>
    <div style="margin-top:10px"><label style="font-size:13px;color:var(--text2)">Paste AI text here:</label>
    <textarea id="inspTest" placeholder="Paste any AI text…" style="width:100%;min-height:80px;border:1px solid var(--border);border-radius:12px;padding:10px;background:var(--bg2);color:var(--text)"></textarea>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sec" onclick="checkAI()">Check score</button><button class="btn" onclick="humanizeNow()">Humanize</button></div>
    <div id="inspOut" style="margin-top:8px;font-size:13px"></div>
    <div id="humanBox" style="display:none;margin-top:12px">
      <label style="font-size:13px;color:var(--success);font-weight:600">✓ Human version (copy this):</label>
      <textarea id="humanOut" readonly style="width:100%;min-height:110px;border:1px solid var(--success);border-radius:12px;padding:10px;background:var(--bg2);color:var(--text)"></textarea>
      <button class="btn" style="margin-top:6px" onclick="copyHuman()">📋 Copy human text</button>
    </div></div></div>`;
  const diagCard=`<div class="card"><h3>🔌 Model Connection</h3>
    <p style="color:var(--text2);font-size:13px">If chat says “Demo” or gets stuck, test your model here to see the real error.</p>
    <button class="btn" onclick="testLLM()">Test Model Connection</button>
    <div id="llmTestOut" style="margin-top:8px;font-size:13px"></div></div>`;
  const provCard=`<div class="card" id="provCard">
    <h3>⚡ AI Provider Status <span id="provCount" style="font-size:13px;font-weight:400;color:var(--text2)"></span></h3>
    <p style="color:var(--text2);font-size:13px;margin-bottom:14px">All 18 providers in the fallback chain. NEXUS tries them top-to-bottom — first configured one wins. Click <b>Test</b> to send a live ping.</p>
    <div id="provList"><div style="color:var(--text2);font-size:13px;padding:12px 0">Loading…</div></div>
  </div>`;
  wrap.innerHTML = provCard + diagCard + masterCard + inspCard + pushCard + KEY_GROUPS.map(g=>`<div class="card"><h3>${g.h}</h3>`+
    g.keys.map(([k,lbl])=>{
      const f=st[k]||{}; const ph=f.set?(f.masked||f.value||'•••• saved'):'';
      return `<div class="field"><label>${lbl} ${f.set?'<span style="color:var(--success)">✓ saved</span>':''}</label>
        <input id="k_${k}" placeholder="${ph||'Enter '+lbl}" autocomplete="off"></div>`;
    }).join('')+`</div>`).join('')+
    `<button class="btn" onclick="saveKeys()">Save Keys</button>
     <span id="saveMsg" style="margin-left:12px;color:var(--success)"></span>`;
  loadProviders();
}
async function loadProviders(){
  const list=document.getElementById('provList');
  const count=document.getElementById('provCount');
  if(!list) return;
  try{
    const j=await(await fetch('/api/providers/status')).json();
    const ps=j.providers||[];
    const on=ps.filter(p=>p.configured).length;
    if(count) count.textContent=`· ${on}/${ps.length} configured`;
    list.innerHTML=ps.map(p=>{
      const dot=p.active?'🟢':p.configured?'🔵':'⚪';
      const badge=p.active?`<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:20px;padding:2px 7px;margin-left:6px">ACTIVE</span>`:'';
      const key=p.key_masked?`<span style="font-size:11px;color:var(--muted);font-family:monospace">${esc(p.key_masked)}</span>`:'<span style="font-size:11px;color:var(--muted)">no key</span>';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:18px;flex-shrink:0">${dot}</span>
        <div style="flex:1;min-width:0">
          <span style="font-weight:600;font-size:14px">${esc(p.label)}</span>${badge}
          <div>${key}</div>
        </div>
        <button class="btn sec" style="padding:5px 12px;font-size:12px;flex-shrink:0" onclick="testProvider('${p.name}',this)">Test</button>
        <div id="ptest_${p.name}" style="font-size:12px;min-width:60px;text-align:right"></div>
      </div>`;
    }).join('');
  }catch(e){
    if(list) list.innerHTML=`<div style="color:var(--error);font-size:13px">Failed to load provider status: ${esc(String(e))}</div>`;
  }
}

async function testProvider(name, btn){
  const out=document.getElementById('ptest_'+name);
  if(btn) btn.disabled=true;
  if(out) out.innerHTML='<span style="color:var(--muted)">testing…</span>';
  try{
    const j=await(await fetch(`/api/providers/test/${name}`,{method:'POST'})).json();
    if(out) out.innerHTML=j.ok
      ?`<span style="color:var(--success)">✓ ${esc(j.reply||'OK')}</span>`
      :`<span style="color:var(--error)" title="${esc(j.error||'')}">✗ fail</span>`;
  }catch(e){
    if(out) out.innerHTML=`<span style="color:var(--error)">✗ err</span>`;
  }
  if(btn) btn.disabled=false;
}

async function saveKeys(){
  const updates={};
  KEY_GROUPS.forEach(g=>g.keys.forEach(([k])=>{
    const v=document.getElementById('k_'+k); if(v && v.value.trim()) updates[k]=v.value.trim();
  }));
  await fetch(API+'/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updates)});
  document.getElementById('saveMsg').textContent='✓ Saved & applied';
  refreshLLM(); loadSettings();
}

/* ── ARTIFACTS (workspace files) ── */
async function loadArtifacts(){
  const wrap=document.getElementById('artWrap');
  const j=await (await fetch(API+`/workspace/${PROJECT}/files`)).json();
  if(!j.files || !j.files.length){ wrap.innerHTML='<div class="empty"><div class="big">✨</div><h2>No artifacts yet</h2><p style="color:var(--text2)">Files agents create (code, scripts, images) appear here.</p></div>'; return; }
  const icon=p=>{const e=p.split('.').pop().toLowerCase();
    if(['png','jpg','jpeg','gif','webp'].includes(e))return '🖼️';
    if(['mp4','mov','webm'].includes(e))return '🎬';
    if(['html','htm'].includes(e))return '🌐'; return '📄';};
  wrap.innerHTML='<div class="card"><h3>Artifacts · '+PROJECT+' ('+j.files.length+')</h3>'+
    j.files.map(f=>`<div class="conn">
      <div class="ci">${icon(f.path)}</div>
      <div style="flex:1;min-width:0" onclick="openArtifact('${encodeURIComponent(f.path)}')">
        <div class="cn" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.path}</div>
        <div class="cs">${f.size} bytes · tap to open</div></div>
      <a class="btn sec" style="padding:6px 10px;font-size:12px;text-decoration:none" href="${API}/file/${PROJECT}/${encodeURIComponent(f.path)}" target="_blank">⤓</a>
    </div>`).join('')+'</div><div id="artView"></div>';
}
async function openArtifact(encPath){
  const path=decodeURIComponent(encPath);
  const ext=path.split('.').pop().toLowerCase();
  const view=document.getElementById('artView');
  if(['png','jpg','jpeg','gif','webp'].includes(ext)){
    view.innerHTML=`<div class="card"><h3>${esc(path)}</h3><img src="${API}/file/${PROJECT}/${encodeURIComponent(path)}" style="max-width:100%;border-radius:12px"></div>`;
  } else if(['mp4','mov','webm'].includes(ext)){
    view.innerHTML=`<div class="card"><h3>${esc(path)}</h3><video controls style="max-width:100%;border-radius:12px" src="${API}/file/${PROJECT}/${encodeURIComponent(path)}"></video></div>`;
  } else if(['html','htm'].includes(ext)){
    view.innerHTML=`<div class="card"><h3>${esc(path)} · Preview</h3><iframe src="${API}/preview/${PROJECT}/${encodeURIComponent(path)}" style="width:100%;height:50vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe></div>`;
  } else {
    const r=await (await fetch(`${API}/workspace/${PROJECT}/file?path=${encodeURIComponent(path)}`)).json();
    view.innerHTML=`<div class="card"><h3>${esc(path)}</h3><pre style="background:var(--bg2);border-radius:12px;padding:12px;overflow:auto;font-size:13px;white-space:pre-wrap">${esc(r.content||'')}</pre></div>`;
  }
  view.scrollIntoView({behavior:'smooth'});
}

/* ──────────────────────────────────────────────────────────────────
   KEYBOARD STABILITY (iOS): keep the input glued above the keyboard and
   let the message list scroll independently. We resize .main to the
   visualViewport height so the page itself never scrolls under the keyboard.
   ────────────────────────────────────────────────────────────────── */
function applyViewport(){
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  // pin to the visual viewport offset (handles iOS keyboard + scroll)
  const main = document.querySelector('.main');
  if(vv && main){ main.style.transform = `translateY(${vv.offsetTop}px)`; }
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', applyViewport);
  window.visualViewport.addEventListener('scroll', applyViewport);
}
window.addEventListener('resize', applyViewport);
window.addEventListener('orientationchange', ()=>setTimeout(applyViewport,200));
applyViewport();

/* ── input autosize + enter-to-send ── */
const ta=document.getElementById('prompt');
ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';});
ta.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
// keep latest messages visible when keyboard opens, without moving the input
ta.addEventListener('focus',()=>setTimeout(()=>{applyViewport();scrollDown();},300));

/* ──────────────────────────────────────────────────────────────────
   WORKSPACE PANEL
   ────────────────────────────────────────────────────────────────── */
let WS_TAB='files', WS_FILE=null;
const WS_TABS=[['files','Files'],['code','Code'],['preview','Preview'],['terminal','Terminal'],['deploy','Deploy']];
function openWS(){
  document.getElementById('ws').classList.add('open');
  document.getElementById('wsBackdrop').classList.add('show');
  document.getElementById('wsProject').textContent=PROJECT;
  renderWSTabs(); selectWSTab('files');
}
function closeWS(){
  document.getElementById('ws').classList.remove('open');
  document.getElementById('wsBackdrop').classList.remove('show');
}
function renderWSTabs(){
  document.getElementById('wsTabs').innerHTML=WS_TABS.map(([id,l])=>
    `<div class="ws-tab ${id===WS_TAB?'active':''}" onclick="selectWSTab('${id}')">${l}</div>`).join('');
}
async function selectWSTab(tab){
  WS_TAB=tab; renderWSTabs();
  const body=document.getElementById('wsBody');
  if(tab==='files'){
    const j=await (await fetch(`${API}/workspace/${PROJECT}/files`)).json();
    body.innerHTML = (j.files&&j.files.length)
      ? j.files.map(f=>`<div class="ws-file" onclick="openWSFile('${f.path}')">📄 ${f.path} <span style="margin-left:auto;color:var(--muted);font-size:12px">${f.size}b</span></div>`).join('')
      : '<div class="empty"><div class="big">📁</div><p style="color:var(--text2)">No files yet. Ask NEXUS to build something.</p></div>';
  } else if(tab==='code'){
    if(!WS_FILE){ body.innerHTML='<p style="color:var(--text2)">Pick a file in the Files tab to view/edit.</p>'; return; }
    const r=await (await fetch(`${API}/workspace/${PROJECT}/file?path=${encodeURIComponent(WS_FILE)}`)).json();
    body.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:8px"><b style="flex:1">${WS_FILE}</b>
      <button class="btn" onclick="saveWSFile()">Save</button></div>
      <textarea id="wsCode" style="width:100%;height:calc(100% - 50px);min-height:240px;border:1px solid var(--border);border-radius:12px;padding:12px;font-family:ui-monospace,monospace;font-size:13px;background:var(--bg2);color:var(--text)">${esc(r.content||'')}</textarea>`;
  } else if(tab==='preview'){
    body.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <button class="btn" onclick="runPreview()">▶ Run Preview</button>
      <button class="btn sec" onclick="stopPreview()">■ Stop</button>
      <span id="pvStatus" style="font-size:12px;color:var(--muted)"></span></div>
      <div id="pvArea" style="flex:1;min-height:300px"><p style="color:var(--text2)">Tap <b>Run Preview</b> to launch this project (frontend or backend) live before deploying.</p></div>`;
    detectPreview();
  } else if(tab==='terminal'){
    body.innerHTML=`<div class="term" id="termOut">NEXUS terminal · runs in the project workspace\n$ </div>
      <div class="term-in"><input id="termCmd" placeholder="ls, python app.py, npm install…" autocapitalize="off" autocomplete="off">
      <button class="btn" onclick="runTerm()">Run</button></div>
      <label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13px;color:var(--text2)"><input type="checkbox" id="termKali"> Run on custom Kali Linux</label>`;
    document.getElementById('termCmd').addEventListener('keydown',e=>{if(e.key==='Enter')runTerm();});
  } else if(tab==='deploy'){
    body.innerHTML=`<div class="card"><h3>Deploy this project</h3>
      <p style="color:var(--text2);font-size:14px">Real deploys. Add tokens in Settings first.</p>
      <div class="field"><label>GitHub repo (owner/name)</label><input id="depRepo" placeholder="me/my-app"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="btn" onclick="doDeploy('github')">Push to GitHub</button>
        <button class="btn" onclick="doDeploy('netlify')">Deploy → Netlify</button>
        <button class="btn" onclick="doDeploy('vercel')">Deploy → Vercel</button>
      </div>
      <h3 style="margin-top:16px">Paywall generator (for client apps)</h3>
      <p style="color:var(--text2);font-size:13px">Adds real Stripe/Flutterwave paywall + revenue tracking to THIS project.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sec" onclick="genPaywall('stripe')">+ Stripe paywall</button>
        <button class="btn sec" onclick="genPaywall('flutterwave')">+ Flutterwave paywall</button>
      </div>
      <div id="depOut" style="margin-top:12px;font-size:13px"></div></div>`;
  }
}
async function detectPreview(){
  const st=document.getElementById('pvStatus'); if(!st) return;
  try{ const s=await (await fetch(`${API}/livepreview/${PROJECT}/status`)).json();
    st.textContent='Detected: '+s.detected+(s.running?' · running':''); }catch(_){}
}
async function runPreview(){
  const area=document.getElementById('pvArea'), st=document.getElementById('pvStatus');
  area.innerHTML='<p style="color:var(--muted)">Launching preview…</p>';
  let r; try{ r=await (await fetch(`${API}/livepreview/${PROJECT}/start`,{method:'POST'})).json(); }
  catch(e){ area.innerHTML='<p style="color:var(--error)">'+esc(e.message)+'</p>'; return; }
  if(!r.ok){ area.innerHTML='<p style="color:var(--error)">⚠️ '+esc(r.error||'failed')+'</p>'; return; }
  st.textContent='Running: '+r.kind;
  const il=(r.install_log&&r.install_log.length)?`<div style="font-size:11px;color:var(--muted);margin-top:4px">🔧 ${r.install_log.map(esc).join(' · ')}${r.autofixed?' · auto-fixed: '+esc(r.autofixed):''}</div>`:'';
  const deployBar=`<div style="margin-top:10px"><div style="font-size:13px;color:var(--text2);margin-bottom:6px">Looks good? Deploy this preview:</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" onclick="deployPreview('netlify')">Netlify</button>
      <button class="btn" onclick="deployPreview('vercel')">Vercel</button>
      <button class="btn" onclick="deployPreview('render')">Render</button>
      <button class="btn" onclick="deployPreview('railway')">Railway</button>
    </div><div id="pvDeploy" style="margin-top:8px;font-size:13px"></div></div>`;
  if(r.mode==='server'){
    area.innerHTML=`<iframe src="${API}/live/${PROJECT}/" style="width:100%;height:45vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">Live ${r.kind} backend · <a href="${API}/live/${PROJECT}/" target="_blank" style="color:var(--accent)">open full</a></div>${il}${deployBar}`;
  } else if(r.mode==='file'){
    area.innerHTML=`<iframe src="${API}/preview/${PROJECT}/${encodeURIComponent(r.entry)}" style="width:100%;height:45vh;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe>${il}${deployBar}`;
  } else if(r.mode==='output'){
    area.innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:6px">Ran ${esc(r.entry)} ${r.success?'✅':'⚠️'}</div>
      <pre style="background:#10100E;color:#D4F5C4;border-radius:12px;padding:12px;overflow:auto;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${esc(r.output||'(no output)')}</pre>${il}${deployBar}`;
  }
}
async function deployPreview(target){
  const out=document.getElementById('pvDeploy');
  out.innerHTML=`Deploying to ${target}… (auto-adding requirements & config)`;
  let r; try{ r=await (await fetch(`${API}/deploy/${target}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project_id:PROJECT,name:'nexus-'+PROJECT.slice(0,8)})})).json(); }
  catch(e){ out.innerHTML='<span style="color:var(--error)">'+esc(e.message)+'</span>'; return; }
  if(r.ok){
    out.innerHTML=`<span style="color:var(--success)">✅ Deployed to ${target}:</span> <a href="${r.url}" target="_blank" style="color:var(--accent)">${esc(r.url||'')}</a>`+
      (r.note?`<br><small style="color:var(--muted)">${esc(r.note)}</small>`:'')+
      ((r.log&&r.log.length)?`<br><small style="color:var(--muted)">${r.log.map(esc).join(' · ')}</small>`:'');
    toast('Deployed to '+target);
  } else {
    out.innerHTML=`<span style="color:var(--error)">⚠️ ${esc(r.error||'failed')}</span>`+
      ((r.log&&r.log.length)?`<br><small style="color:var(--muted)">${r.log.map(esc).join(' · ')}</small>`:'');
  }
}
async function stopPreview(){
  await fetch(`${API}/livepreview/${PROJECT}/stop`,{method:'POST'});
  const area=document.getElementById('pvArea'); if(area) area.innerHTML='<p style="color:var(--text2)">Preview stopped.</p>';
  detectPreview();
}
function openWSFile(p){ WS_FILE=p; selectWSTab('code'); }
async function saveWSFile(){
  const content=document.getElementById('wsCode').value;
  await fetch(`${API}/workspace/${PROJECT}/write`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:WS_FILE,content})});
  toast('Saved '+WS_FILE);
}
async function runTerm(){
  const inp=document.getElementById('termCmd'); const cmd=inp.value.trim(); if(!cmd) return;
  const out=document.getElementById('termOut'); const kali=document.getElementById('termKali').checked;
  out.textContent += cmd+'\n'; inp.value='';
  const r=await (await fetch(`${API}/workspace/${PROJECT}/exec`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cmd,kali})})).json();
  out.textContent += (r.output||r.error||'(no output)')+'\n$ '; out.scrollTop=out.scrollHeight;
}
async function doDeploy(target){
  const out=document.getElementById('depOut'); out.textContent='Deploying to '+target+'…';
  const payload={project_id:PROJECT};
  if(target==='github'){ const repo=document.getElementById('depRepo').value.trim();
    if(!repo){out.innerHTML='<span style="color:var(--error)">Enter a repo name first.</span>';return;}
    payload.repo=repo; payload.create=true; }
  const r=await (await fetch(`${API}/deploy/${target}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)})).json();
  if(r.ok){ out.innerHTML=`<span style="color:var(--success)">✅ Deployed:</span> <a href="${r.url}" target="_blank" style="color:var(--accent)">${r.url}</a><br><small style="color:var(--muted)">${(r.log||[]).join(' · ')}</small>`; toast('Deployed to '+target); }
  else { out.innerHTML=`<span style="color:var(--error)">⚠️ ${esc(r.error||'failed')}</span><br><small style="color:var(--muted)">${(r.log||[]).join(' · ')}</small>`; }
}

/* ──────────────────────────────────────────────────────────────────
   SKILLS LIBRARY
   ────────────────────────────────────────────────────────────────── */
async function loadSkills(){
  const g=document.getElementById('view-generic'); g.classList.add('active');
  const wrap=g.querySelector('.wrap');
  wrap.innerHTML=`<div class="card"><h3>Skills Library</h3>
    <p style="color:var(--text2);font-size:14px">Upload PDF, TXT, DOCX, ZIP, image, audio or video. NEXUS distills it into reusable methods, frameworks & best-practices that agents apply automatically.</p>
    <div class="drop" id="drop" onclick="document.getElementById('skillInput').click()">
      <div style="font-size:32px">📥</div><b>Tap to upload</b><div style="font-size:13px">or drop a file here</div></div>
    <div id="skillMsg" style="margin-top:10px;font-size:13px;color:var(--text2)"></div>
  </div><div id="skillList"></div>`;
  const drop=document.getElementById('drop');
  ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
  drop.addEventListener('drop',e=>{ if(e.dataTransfer.files[0]) uploadSkill(e.dataTransfer.files[0]); });
  renderSkillList();
}
async function renderSkillList(){
  const j=await (await fetch(`${API}/skills`)).json();
  const list=document.getElementById('skillList'); if(!list) return;
  list.innerHTML = j.skills.length ? j.skills.map(s=>`<div class="skill">
    <div class="st">📚 ${esc(s.title||s.filename)} <span style="color:var(--muted);font-size:12px">(${s.kind})</span></div>
    <div style="color:var(--text2);font-size:13px;margin-top:4px">${esc(s.summary||'')}</div>
    <div class="chips">${[...(s.methods||[]),...(s.frameworks||[]),...(s.best_practices||[])].slice(0,6).map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div>
    <button class="btn sec" style="margin-top:8px;padding:6px 12px;font-size:12px" onclick="delSkill('${s.id}')">Remove</button>
  </div>`).join('') : '<div class="empty" style="padding:30px"><p style="color:var(--text2)">No skills yet.</p></div>';
}
function onSkillFile(inp){ if(inp.files[0]) uploadSkill(inp.files[0]); inp.value=''; }
async function uploadSkill(file){
  const msg=document.getElementById('skillMsg'); if(msg) msg.textContent='Extracting & distilling '+file.name+'…';
  const fd=new FormData(); fd.append('file',file); fd.append('project_id','global');
  try{
    const r=await (await fetch(`${API}/skills/upload`,{method:'POST',body:fd})).json();
    if(r.ok){ if(msg) msg.innerHTML='<span style="color:var(--success)">✅ Learned: '+esc(r.skill.title)+'</span>'; toast('Skill learned'); renderSkillList(); }
    else if(msg) msg.innerHTML='<span style="color:var(--error)">⚠️ '+esc(r.error)+'</span>';
  }catch(e){ if(msg) msg.textContent='Error: '+e.message; }
}
async function delSkill(id){ await fetch(`${API}/skills/${id}`,{method:'DELETE'}); toast('Removed'); renderSkillList(); }

/* ══════════════════════════════════════════════════════════════════
   CRYPTO WALLET
   ══════════════════════════════════════════════════════════════════ */
let WLT_COIN = 'ltc';
let WLT_WALLETS = {ltc:[], xmr:[]};

async function loadWallet(){
  const wrap = document.getElementById('walletWrap');
  wrap.innerHTML = '<div style="color:var(--muted);padding:40px;text-align:center"><span class="spinner"></span> Loading wallets…</div>';
  try {
    const r = await (await fetch('/api/wallet/list')).json();
    WLT_WALLETS = {ltc: r.ltc||[], xmr: r.xmr||[]};
  } catch(e) { WLT_WALLETS = {ltc:[],xmr:[]}; }
  renderWallet();
}

function renderWallet(){
  const wrap = document.getElementById('walletWrap');
  const coin = WLT_COIN;
  const wallets = WLT_WALLETS[coin] || [];
  const coinMeta = {
    ltc: {name:'Litecoin', symbol:'LTC', color:'#bfbbbb', icon:'Ł', note:'Full send/receive via free blockchain APIs'},
    xmr: {name:'Monero', symbol:'XMR', color:'#F26822', icon:'ɱ', note:'Private by design · view-key balance · offline keygen'},
  };
  const m = coinMeta[coin];

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <div class="coin-tabs">
        <button class="coin-tab ${coin==='ltc'?'active':''}" onclick="switchCoin('ltc')">Ł Litecoin</button>
        <button class="coin-tab ${coin==='xmr'?'active':''}" onclick="switchCoin('xmr')">ɱ Monero</button>
      </div>
      <button class="btn" style="margin-left:auto" onclick="newWallet('${coin}')">＋ New ${m.symbol} Wallet</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:-10px 0 16px">${m.note}</p>
    <div id="wlt-list"></div>
    <div id="wlt-msg" style="margin-top:12px;font-size:13px"></div>`;

  const list = document.getElementById('wlt-list');
  if(!wallets.length){
    list.innerHTML = `<div class="wallet-empty"><div class="big">${m.icon}</div>
      <p>No ${m.name} wallets yet.</p>
      <button class="btn" onclick="newWallet('${coin}')">Generate ${m.symbol} wallet</button></div>`;
    return;
  }
  list.innerHTML = wallets.map((w,i) => walletCard(w, coin, i)).join('');
}

function walletCard(w, coin, idx){
  const sym = coin==='ltc'?'LTC':'XMR';
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(w.address)}&margin=8`;
  const ts = w.created ? new Date(w.created*1000).toLocaleDateString() : '';
  return `<div class="wallet-card" id="wcard-${idx}">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <span style="font-weight:700;font-size:16px">${esc(w.label||'Wallet')}</span>
        <span class="wallet-badge">${sym}</span>
        ${ts?`<span style="font-size:12px;color:var(--muted);margin-left:8px">${ts}</span>`:''}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn sec" style="padding:6px 12px;font-size:12px" onclick="checkBalance('${coin}','${esc(w.address)}',${idx})">Check Balance</button>
        <button class="btn sec" style="padding:6px 12px;font-size:12px;color:var(--error)" onclick="deleteWallet('${coin}','${esc(w.address)}')">Delete</button>
      </div>
    </div>
    <div class="addr" onclick="copyText('${esc(w.address)}')" title="Click to copy">${esc(w.address)}</div>
    <div class="bal" id="bal-${idx}"><small style="font-size:13px;color:var(--muted)">Balance not loaded — click Check Balance</small></div>
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:10px">
      <div class="qr-box"><img src="${qr}" alt="QR" loading="lazy" style="width:120px;height:120px;border-radius:10px"></div>
      <div style="flex:1;min-width:180px">
        <button class="btn sec" style="padding:6px 12px;font-size:12px;margin-bottom:8px" onclick="toggleKeys('${coin}','${esc(w.address)}',${idx})">Show Private Keys ▾</button>
        <div id="keys-${idx}" style="display:none"></div>
      </div>
    </div>
    <div class="send-form" id="send-${idx}" style="display:none"></div>
    <div style="margin-top:10px">
      <button class="btn sec" style="padding:6px 14px;font-size:13px" onclick="toggleSend('${coin}','${esc(w.address)}',${idx})">📤 Send ${sym}</button>
    </div>
  </div>`;
}

function switchCoin(c){ WLT_COIN=c; renderWallet(); }

async function newWallet(coin){
  const label = prompt(`Label for this ${coin.toUpperCase()} wallet:`, 'lab-wallet');
  if(label===null) return;
  const msg = document.getElementById('wlt-msg');
  msg.innerHTML = '<span class="spinner"></span> Generating wallet offline…';
  try {
    const r = await (await fetch(`/api/wallet/new/${coin}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:label||'default'})})).json();
    if(r.ok){
      toast(`${coin.toUpperCase()} wallet generated`);
      msg.innerHTML = `<span style="color:var(--success)">✅ Wallet ready — address saved locally.</span>`;
      WLT_WALLETS[coin].unshift({address:r.address, label:r.label||label, created:r.created});
      renderWallet();
    } else {
      msg.innerHTML = `<span style="color:var(--error)">⚠️ ${esc(r.error)}</span>`;
    }
  } catch(e){ msg.innerHTML = `<span style="color:var(--error)">Error: ${esc(e.message)}</span>`; }
}

async function checkBalance(coin, address, idx){
  const el = document.getElementById('bal-'+idx);
  el.innerHTML = '<span class="spinner"></span> Checking…';
  try {
    const r = await (await fetch(`/api/wallet/${coin}/balance/${encodeURIComponent(address)}`)).json();
    if(r.balance !== null && r.balance !== undefined){
      const sym = coin==='ltc'?'LTC':'XMR';
      el.innerHTML = `<span style="font-size:22px;font-weight:700">${parseFloat(r.balance).toFixed(8)}</span> <small>${sym}</small>
        ${r.received!==undefined?`<div style="font-size:12px;color:var(--muted);margin-top:2px">Received: ${parseFloat(r.received||0).toFixed(8)} · Tx: ${r.tx_count||0} · <a href="${r.explorer||'#'}" target="_blank" style="color:var(--accent)">Explorer ↗</a></div>`:''}
        ${r.note?`<div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(r.note)}</div>`:''}`;
    } else {
      el.innerHTML = `<span style="font-size:13px;color:var(--muted)">${esc(r.note||r.error||'No balance data')}</span>`;
    }
  } catch(e){ el.innerHTML = `<span style="color:var(--error);font-size:13px">Error: ${esc(e.message)}</span>`; }
}

async function toggleKeys(coin, address, idx){
  const el = document.getElementById('keys-'+idx);
  if(el.style.display==='none'){
    el.style.display='block';
    el.innerHTML = '<span class="spinner"></span> Loading…';
    try {
      const r = await (await fetch(`/api/wallet/${coin}/get/${encodeURIComponent(address)}`)).json();
      if(!r.ok){ el.innerHTML=`<span style="color:var(--error)">${esc(r.error)}</span>`; return; }
      const w = r.wallet;
      const rows = [];
      if(coin==='ltc'){
        rows.push(['WIF Key', w.wif||''], ['Private Hex', w.private_hex||''], ['Public Hex', w.public_hex||'']);
      } else {
        rows.push(['Seed Phrase', w.seed_phrase||''], ['Spend Key', w.spend_key||''], ['View Key', w.view_key||'']);
      }
      el.innerHTML = `<div style="margin-top:6px">
        <div style="font-size:11px;color:var(--error);font-weight:600;margin-bottom:8px">⚠️ Never share private keys. Store offline securely.</div>
        ${rows.map(([k,v])=>`<div class="key-row">
          <span class="kl">${k}</span>
          <span class="kv">${esc(v)}</span>
          <span class="copy" onclick="copyText('${esc(v)}')" title="Copy">📋</span>
        </div>`).join('')}
      </div>`;
    } catch(e){ el.innerHTML=`<span style="color:var(--error)">${esc(e.message)}</span>`; }
  } else { el.style.display='none'; }
}

function toggleSend(coin, address, idx){
  const el = document.getElementById('send-'+idx);
  if(el.style.display==='none'){
    const sym = coin==='ltc'?'LTC':'XMR';
    el.style.display='block';
    el.innerHTML = `<h4>📤 Send ${sym}</h4>
      <input type="text" id="sendTo-${idx}" placeholder="Destination address">
      <input type="number" id="sendAmt-${idx}" placeholder="Amount (${sym})" step="0.00000001" min="0">
      ${coin==='ltc'?`<input type="text" id="sendWif-${idx}" placeholder="WIF private key (if not stored here)">`:''}
      <div id="sendOut-${idx}" style="font-size:13px;margin-top:8px"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" onclick="doSend('${coin}','${esc(address)}',${idx})">Confirm Send</button>
        <button class="btn sec" onclick="document.getElementById('send-${idx}').style.display='none'">Cancel</button>
      </div>`;
  } else { el.style.display='none'; }
}

async function doSend(coin, fromAddr, idx){
  const to = (document.getElementById('sendTo-'+idx)||{}).value||'';
  const amt = parseFloat((document.getElementById('sendAmt-'+idx)||{}).value||0);
  const wif = (document.getElementById('sendWif-'+idx)||{}).value||'';
  const out = document.getElementById('sendOut-'+idx);
  if(!to||!amt){ out.innerHTML='<span style="color:var(--error)">Enter destination and amount.</span>'; return; }
  out.innerHTML = '<span class="spinner"></span> Broadcasting…';
  try {
    const body = {from:fromAddr, to, amount:amt};
    if(wif) body.wif=wif;
    const r = await (await fetch(`/api/wallet/${coin}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    if(r.ok){
      out.innerHTML = `<span style="color:var(--success)">✅ Sent ${r.amount} ${coin.toUpperCase()}<br>
        TXID: <a href="${r.explorer||'#'}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${esc(r.txid||'')}</a></span>`;
    } else if(r.send_command){
      out.innerHTML = `<div style="margin-top:8px">
        <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${esc(r.note||'Use the CLI command below to send.')}</div>
        <pre style="background:#10100E;color:#7FFF7F;border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap;overflow:auto">${esc(r.send_command)}</pre>
        <button class="btn sec" style="margin-top:6px;padding:6px 12px;font-size:12px" onclick="copyText('${esc(r.send_command)}')">Copy command</button></div>`;
    } else {
      out.innerHTML = `<span style="color:var(--error)">⚠️ ${esc(r.error||'failed')}</span>`;
    }
  } catch(e){ out.innerHTML=`<span style="color:var(--error)">Error: ${esc(e.message)}</span>`; }
}

async function deleteWallet(coin, address){
  if(!confirm(`Delete ${coin.toUpperCase()} wallet ${address.slice(0,16)}…? This removes it from local storage.`)) return;
  const r = await (await fetch(`/api/wallet/${coin}/delete/${encodeURIComponent(address)}`,{method:'DELETE'})).json();
  if(r.ok){ toast('Wallet removed'); loadWallet(); }
  else toast('Error: '+(r.error||'failed'));
}

function copyText(t){
  navigator.clipboard.writeText(t).then(()=>toast('Copied!')).catch(()=>{
    const el=document.createElement('textarea'); el.value=t;
    document.body.appendChild(el); el.select(); document.execCommand('copy'); el.remove(); toast('Copied!');
  });
}

/* ══════════════════════════════════════════════════════════════════
   TEST PLAN EXECUTOR
   ─ Human-in-the-loop with 50 s auto-proceed countdown
   ─ Visual YAML plan builder (no external editor needed)
   ─ Kali Linux routing toggle
   ══════════════════════════════════════════════════════════════════ */
let TP_PLAN    = null;
let TP_IDX     = 0;
let TP_KALI    = true;
let TP_LOG     = [];
let TP_RUNNING = false;
let TP_TIMER   = null;   // setInterval handle for countdown
let TP_SECS    = 50;     // countdown seconds remaining
const TP_AUTO_SECS = 50; // reset value

/* ── Build steps from the visual form ──────────────────────────── */
let BP_STEPS = [];  // builder steps [{name,desc,cmd}]

function loadTestPlans(){
  const g = document.getElementById('view-generic'); g.classList.add('active');
  const wrap = g.querySelector('.wrap');
  wrap.innerHTML = `
  <div class="card" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn" id="tpTabRun" onclick="tpTab('run')" style="flex:1">▶ Run Plan</button>
      <button class="btn sec" id="tpTabBuild" onclick="tpTab('build')" style="flex:1">🛠 Build Plan</button>
    </div>
    <div id="tpRunPanel">
      <h3 style="margin:0 0 8px">Test Plan Executor</h3>
      <p style="color:var(--text2);font-size:13px;margin:0 0 12px">
        Load a YAML plan → each step waits for your click.<br>
        <b>Auto-proceeds after 50 s</b> if you don't act — click ⏸ to pause auto-run.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" onclick="document.getElementById('planInput').click()">📂 Load YAML</button>
        <button class="btn sec" onclick="loadExamplePlan()">Load example</button>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2)">
          <input type="checkbox" id="tpKali" ${TP_KALI?'checked':''} onchange="TP_KALI=this.checked"> Kali Linux
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2)">
          <input type="checkbox" id="tpAutoRun" checked> Auto-proceed (50 s)
        </label>
      </div>
      <input type="file" id="planInput" style="display:none" accept=".yaml,.yml,.json" onchange="onPlanFile(this)">
      <div id="tpStatus" style="font-size:13px;color:var(--muted);margin-top:10px">No plan loaded.</div>
    </div>
    <div id="tpBuildPanel" style="display:none">
      <h3 style="margin:0 0 8px">Plan Builder</h3>
      <p style="color:var(--text2);font-size:13px;margin:0 0 10px">Build a YAML plan visually — add steps, then run or export.</p>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <input id="bpName" placeholder="Plan name" style="flex:2;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:14px">
        <input id="bpDesc" placeholder="Description (optional)" style="flex:3;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:14px">
      </div>
      <div id="bpStepList" style="margin-bottom:10px"></div>
      <button class="btn sec" onclick="bpAddStep()" style="width:100%;margin-bottom:10px">＋ Add Step</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="bpRunPlan()">▶ Run this plan</button>
        <button class="btn sec" onclick="bpExportYaml()">⬇ Export YAML</button>
        <button class="btn sec" onclick="bpClear()">🗑 Clear</button>
      </div>
    </div>
  </div>
  <div id="tpPlanCard" style="display:none" class="card">
    <div id="tpPlanHeader"></div>
    <div id="tpSteps"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center">
      <button class="btn" id="tpRunBtn" onclick="tpManualRun()">▶ Run Step</button>
      <button class="btn sec" id="tpPauseBtn" onclick="tpTogglePause()">⏸ Pause auto</button>
      <button class="btn sec" onclick="skipStep()">⏭ Skip</button>
      <button class="btn sec" style="color:var(--error)" onclick="stopPlan()">■ Stop</button>
      <button class="btn sec" onclick="downloadLog()">⬇ Log</button>
      <span id="tpCountdown" style="font-size:13px;color:var(--accent);font-weight:600;margin-left:4px"></span>
    </div>
  </div>`;
  renderBpSteps();
}

let TP_PAUSED = false;
function tpTab(t){
  document.getElementById('tpRunPanel').style.display   = t==='run'  ?'block':'none';
  document.getElementById('tpBuildPanel').style.display = t==='build'?'block':'none';
  document.getElementById('tpTabRun').className   = t==='run'  ?'btn':'btn sec';
  document.getElementById('tpTabBuild').className = t==='build'?'btn':'btn sec';
}

/* ── Countdown helpers ─────────────────────────────────────────── */
function tpStartCountdown(){
  tpClearCountdown();
  if(!document.getElementById('tpAutoRun')?.checked) return;
  TP_SECS = TP_AUTO_SECS;
  _updateCountdownEl();
  TP_TIMER = setInterval(()=>{
    if(TP_PAUSED||TP_RUNNING) return;
    TP_SECS--;
    _updateCountdownEl();
    if(TP_SECS<=0){ tpClearCountdown(); runNextStep(); }
  }, 1000);
}
function tpClearCountdown(){
  if(TP_TIMER){ clearInterval(TP_TIMER); TP_TIMER=null; }
  _updateCountdownEl();
}
function _updateCountdownEl(){
  const el=document.getElementById('tpCountdown'); if(!el) return;
  if(TP_TIMER && !TP_PAUSED && TP_SECS>0)
    el.textContent=`Auto in ${TP_SECS}s`;
  else if(TP_PAUSED)
    el.textContent='⏸ Paused';
  else
    el.textContent='';
}
function tpTogglePause(){
  TP_PAUSED=!TP_PAUSED;
  const btn=document.getElementById('tpPauseBtn');
  if(btn) btn.textContent = TP_PAUSED?'▶ Resume auto':'⏸ Pause auto';
  _updateCountdownEl();
}
function tpManualRun(){ tpClearCountdown(); runNextStep(); }

/* ── Plan loading ──────────────────────────────────────────────── */
function loadExamplePlan(){
  parsePlanYaml(`name: Recon Plan
description: Ping, port scan, banner grab
kali: true
steps:
  - name: Host alive check
    desc: Verify target responds to ICMP
    cmd: ping -c 2 -W 1 10.0.0.1 && echo ALIVE || echo DOWN
  - name: Fast port scan
    desc: Top 100 ports via nmap
    cmd: nmap -T4 -F 10.0.0.1
  - name: Service versions
    desc: Detect service banners
    cmd: nmap -sV --version-intensity 3 -p 22,80,443,8080 10.0.0.1
  - name: HTTP headers
    desc: Grab HTTP response headers
    cmd: curl -sI --max-time 8 http://10.0.0.1 || echo no-http
  - name: DNS info
    desc: DNS records for target
    cmd: dig +short 10.0.0.1 || nslookup 10.0.0.1`, 'recon-plan.yaml');
}

function onPlanFile(inp){
  const f=inp.files[0]; if(!f) return; inp.value='';
  new FileReader().onload = e => parsePlanYaml(e.target.result, f.name);
  const rd=new FileReader(); rd.onload=e=>parsePlanYaml(e.target.result,f.name); rd.readAsText(f);
}

function parsePlanYaml(text, filename){
  try {
    const plan={name:filename,description:'',steps:[],kali:true};
    let cur=null;
    for(const raw of text.split('\n')){
      const line=raw.trimEnd(), ind=raw.length-raw.trimStart().length;
      if(!line.trim()||line.trim().startsWith('#')) continue;
      if(ind===0){
        const m=line.match(/^(\w+)\s*:\s*(.*)/); if(!m) continue;
        const [,k,v]=m;
        if(k==='name') plan.name=v.trim();
        else if(k==='description') plan.description=v.trim();
        else if(k==='kali') plan.kali=v.trim()!=='false';
        cur=null;
      } else if(line.trim().startsWith('-')&&ind<=2){
        cur={name:'Step '+(plan.steps.length+1),desc:'',cmd:''};
        plan.steps.push(cur);
        const inl=line.trim().slice(1).trim();
        if(inl){const m2=inl.match(/^(\w+)\s*:\s*(.*)/);if(m2)cur[m2[1].trim()]=m2[2].trim();}
      } else if(cur&&ind>2){
        const m3=line.trim().match(/^(\w+)\s*:\s*(.*)/);
        if(m3){const[,k,v]=m3;cur[k.trim()]=v.trim();}
      }
    }
    if(!plan.steps.length){
      const el=document.getElementById('tpStatus'); if(el) el.innerHTML='<span style="color:var(--error)">No steps found. Check YAML format.</span>';
      return;
    }
    TP_PLAN=plan; TP_IDX=0; TP_LOG=[]; TP_RUNNING=false; TP_PAUSED=false;
    TP_KALI=plan.kali!==false;
    const kChk=document.getElementById('tpKali'); if(kChk) kChk.checked=TP_KALI;
    renderPlan();
  } catch(e){
    const el=document.getElementById('tpStatus'); if(el) el.innerHTML=`<span style="color:var(--error)">Parse error: ${esc(e.message)}</span>`;
  }
}

function renderPlan(){
  const pc=document.getElementById('tpPlanCard'); if(pc) pc.style.display='block';
  const st=document.getElementById('tpStatus');
  if(st) st.innerHTML=`<span style="color:var(--success)">✅ <b>${esc(TP_PLAN.name)}</b> — ${TP_PLAN.steps.length} steps loaded</span>`;
  const ph=document.getElementById('tpPlanHeader');
  if(ph) ph.innerHTML=`<h3 style="margin:0 0 4px">${esc(TP_PLAN.name)}</h3>${TP_PLAN.description?`<p style="color:var(--text2);font-size:13px;margin:0 0 10px">${esc(TP_PLAN.description)}</p>`:''}`;
  renderSteps();
  tpStartCountdown();
}

function renderSteps(){
  const el=document.getElementById('tpSteps'); if(!TP_PLAN||!el) return;
  el.innerHTML=TP_PLAN.steps.map((s,i)=>{
    const log=TP_LOG.find(l=>l.idx===i);
    const active=i===TP_IDX&&!TP_RUNNING;
    const st=log?(log.status==='ok'?'✅':(log.status==='skip'?'⏭':'⚠️')):(i<TP_IDX?'⏭':'○');
    const bg=active?'background:var(--accent-light);border-color:var(--accent)':'';
    return `<div style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;transition:.2s;${bg}">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px;flex-shrink:0">${i===TP_IDX&&TP_RUNNING?'<span class="spinner"></span>':st}</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">Step ${i+1}: ${esc(s.name||'')}</div>
          ${s.desc?`<div style="font-size:12px;color:var(--text2)">${esc(s.desc)}</div>`:''}
        </div>
        ${active?`<span style="font-size:11px;color:var(--accent);font-weight:600">← current</span>`:''}
      </div>
      <pre style="background:var(--bg2);border-radius:8px;padding:8px 10px;font-size:12px;font-family:ui-monospace,monospace;margin:8px 0 0;overflow:auto;white-space:pre-wrap">${esc(s.cmd)}</pre>
      ${log&&log.output?`<pre style="background:#10100E;color:#D4F5C4;border-radius:8px;padding:8px 10px;font-size:12px;font-family:ui-monospace,monospace;margin:6px 0 0;max-height:200px;overflow:auto">${esc(log.output)}</pre>`:''}
    </div>`;
  }).join('');
  const runBtn=document.getElementById('tpRunBtn');
  if(runBtn){
    runBtn.disabled=TP_RUNNING||TP_IDX>=TP_PLAN.steps.length;
    runBtn.textContent=TP_IDX>=TP_PLAN.steps.length?'✅ Complete':
      `▶ Run Step ${TP_IDX+1}: ${esc((TP_PLAN.steps[TP_IDX]||{}).name||'')}`;
  }
}

async function runNextStep(){
  if(!TP_PLAN||TP_RUNNING||TP_IDX>=TP_PLAN.steps.length) return;
  tpClearCountdown();
  const step=TP_PLAN.steps[TP_IDX];
  TP_RUNNING=true; renderSteps();
  try {
    const kali=document.getElementById('tpKali')?.checked;
    const ep=kali?'/api/kali-exec':'/api/shell';
    const body=kali?{cmd:step.cmd,timeout:90,session:'testplan'}:{command:step.cmd,timeout:90};
    const r=await (await fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    const out=r.output||r.stdout||r.error||'(no output)';
    const ok=r.ok!==false&&r.success!==false;
    TP_LOG.push({idx:TP_IDX,step:step.name,cmd:step.cmd,output:out,status:ok?'ok':'err'});
    TP_IDX++;
  } catch(e){
    TP_LOG.push({idx:TP_IDX,step:step.name,cmd:step.cmd,output:'Error: '+e.message,status:'err'});
    TP_IDX++;
  }
  TP_RUNNING=false; renderSteps();
  if(TP_IDX>=TP_PLAN.steps.length){
    tpClearCountdown(); toast('✅ Plan complete — '+TP_PLAN.steps.length+' steps');
  } else {
    tpStartCountdown();  // start countdown for next step
  }
}

function skipStep(){
  if(!TP_PLAN||TP_RUNNING||TP_IDX>=TP_PLAN.steps.length) return;
  tpClearCountdown();
  TP_LOG.push({idx:TP_IDX,step:(TP_PLAN.steps[TP_IDX]||{}).name,cmd:'',output:'(skipped by user)',status:'skip'});
  TP_IDX++; renderSteps();
  if(TP_IDX<TP_PLAN.steps.length) tpStartCountdown();
}

function stopPlan(){
  tpClearCountdown(); TP_RUNNING=false; TP_PAUSED=false;
  TP_IDX=TP_PLAN?TP_PLAN.steps.length:0; renderSteps(); toast('Plan stopped');
}

function downloadLog(){
  if(!TP_PLAN) return;
  const txt=[
    `# Test Plan Log — ${TP_PLAN.name}`,
    `# Date: ${new Date().toISOString()}`,
    `# Steps: ${TP_PLAN.steps.length}  Executed: ${TP_LOG.length}`,
    '',
    ...TP_LOG.map(l=>[
      `## Step ${l.idx+1}: ${l.step}`,
      `$ ${l.cmd}`,
      l.output,
      `Status: ${l.status}`,
      '─'.repeat(60),
    ].join('\n')),
  ].join('\n\n');
  const a=document.createElement('a');
  a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(txt);
  a.download=`testplan-log-${Date.now()}.txt`; a.click();
}

/* ── Visual plan BUILDER ───────────────────────────────────────── */
function renderBpSteps(){
  const el=document.getElementById('bpStepList'); if(!el) return;
  if(!BP_STEPS.length){
    el.innerHTML='<p style="color:var(--muted);font-size:13px;text-align:center;padding:16px">No steps yet — click ＋ Add Step</p>';
    return;
  }
  el.innerHTML=BP_STEPS.map((s,i)=>`
    <div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px;background:var(--card)">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:13px;color:var(--muted)">Step ${i+1}</span>
        <div style="flex:1"></div>
        <button onclick="bpMoveStep(${i},-1)" style="font-size:14px;padding:2px 6px;border-radius:6px;background:var(--bg2);border:1px solid var(--border)">▲</button>
        <button onclick="bpMoveStep(${i},1)"  style="font-size:14px;padding:2px 6px;border-radius:6px;background:var(--bg2);border:1px solid var(--border)">▼</button>
        <button onclick="bpDelStep(${i})" style="font-size:14px;padding:2px 6px;border-radius:6px;background:var(--bg2);border:1px solid var(--border);color:var(--error)">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
        <input value="${esc(s.name)}" placeholder="Step name" onchange="BP_STEPS[${i}].name=this.value"
          style="padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px">
        <input value="${esc(s.desc)}" placeholder="Description" onchange="BP_STEPS[${i}].desc=this.value"
          style="padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px">
      </div>
      <textarea rows="2" onchange="BP_STEPS[${i}].cmd=this.value"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:#10100E;color:#D4F5C4;font-family:ui-monospace,monospace;font-size:13px;resize:vertical"
        placeholder="Command to run…">${esc(s.cmd)}</textarea>
    </div>`).join('');
}

function bpAddStep(){
  BP_STEPS.push({name:'Step '+(BP_STEPS.length+1),desc:'',cmd:''});
  renderBpSteps();
}
function bpDelStep(i){ BP_STEPS.splice(i,1); renderBpSteps(); }
function bpMoveStep(i,d){
  const j=i+d; if(j<0||j>=BP_STEPS.length) return;
  [BP_STEPS[i],BP_STEPS[j]]=[BP_STEPS[j],BP_STEPS[i]]; renderBpSteps();
}
function bpClear(){ if(!confirm('Clear all steps?')) return; BP_STEPS=[]; renderBpSteps(); }

function bpExportYaml(){
  const name=(document.getElementById('bpName')||{}).value||'My Plan';
  const desc=(document.getElementById('bpDesc')||{}).value||'';
  const yaml=[
    `name: ${name}`,
    `description: ${desc}`,
    `kali: ${TP_KALI}`,
    `steps:`,
    ...BP_STEPS.map(s=>[
      `  - name: ${s.name}`,
      `    desc: ${s.desc||''}`,
      `    cmd: ${s.cmd}`,
    ].join('\n')),
  ].join('\n');
  const a=document.createElement('a');
  a.href='data:text/yaml;charset=utf-8,'+encodeURIComponent(yaml);
  a.download=name.replace(/\W+/g,'-').toLowerCase()+'.yaml'; a.click();
}

function bpRunPlan(){
  const name=(document.getElementById('bpName')||{}).value||'Built Plan';
  const desc=(document.getElementById('bpDesc')||{}).value||'';
  if(!BP_STEPS.length){ toast('Add at least one step first'); return; }
  const yaml=[
    `name: ${name}`,`description: ${desc}`,`kali: ${TP_KALI}`,`steps:`,
    ...BP_STEPS.map(s=>`  - name: ${s.name}\n    desc: ${s.desc||''}\n    cmd: ${s.cmd}`),
  ].join('\n');
  parsePlanYaml(yaml, name);
  tpTab('run');
}

/* ──────────────────────────────────────────────────────────────────
   DEPLOYMENTS VIEW (shortcut to deploy current project)
   ────────────────────────────────────────────────────────────────── */
async function loadDeployments(){
  const g=document.getElementById('view-generic'); g.classList.add('active');
  const wrap=g.querySelector('.wrap');
  const conns=(await (await fetch(`${API}/connectors`)).json()).connectors;
  const dep=conns.filter(c=>['github','vercel','netlify','render','railway'].includes(c.id));
  wrap.innerHTML=`<div class="card"><h3>Deployments</h3>
    <p style="color:var(--text2);font-size:14px">Project: <b>${PROJECT}</b>. Deploy buttons make real API calls.</p>
    <div style="margin:10px 0">${dep.map(c=>`<div class="conn"><div class="ci">${c.label[0]}</div>
      <div><div class="cn">${c.label}</div><div class="cs">${c.connected?'Ready':'Add token in Settings'}</div></div>
      <span class="tag ${c.connected?'on':'off'}">${c.connected?'Connected':'Off'}</span></div>`).join('')}</div>
    <div class="field"><label>GitHub repo (owner/name)</label><input id="depRepo" placeholder="me/my-app"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" onclick="doDeploy('github')">Push to GitHub</button>
      <button class="btn" onclick="doDeploy('netlify')">Deploy → Netlify</button>
      <button class="btn" onclick="doDeploy('vercel')">Deploy → Vercel</button>
    </div><div id="depOut" style="margin-top:12px;font-size:13px"></div></div>`;
}

/* ──────────────────────────────────────────────────────────────────
   ATTACH + VOICE
   ────────────────────────────────────────────────────────────────── */
let PENDING_ATTACH=null;  // {name, kind:'image'|'text', dataUrl?, text?}
function onAttach(inp){
  const f=inp.files[0]; if(!f) return;
  if(f.type.startsWith('image/')){
    const rd=new FileReader();
    rd.onload=()=>{ PENDING_ATTACH={name:f.name,kind:'image',dataUrl:rd.result};
      showAttachChip(); toast('Image attached'); };
    rd.readAsDataURL(f);
  } else if(f.type.startsWith('text')||/\.(txt|md|json|csv|py|js|html|css|ts|php|rb|go|rs|java|c|cpp|sql|yml|yaml)$/i.test(f.name)){
    const rd=new FileReader();
    rd.onload=()=>{ PENDING_ATTACH={name:f.name,kind:'text',text:rd.result.slice(0,8000)};
      showAttachChip(); toast('File attached'); };
    rd.readAsText(f);
  } else {
    toast('Tip: large docs/zips/videos work best in Skills Library');
  }
  inp.value='';
}
function showAttachChip(){
  let bar=document.getElementById('attachBar');
  if(!bar){ bar=document.createElement('div'); bar.id='attachBar';
    bar.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 14px;max-width:900px;margin:0 auto';
    document.getElementById('inputbar').prepend(bar); }
  const a=PENDING_ATTACH;
  bar.innerHTML=`<div style="display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:6px 10px;font-size:13px">
    ${a.kind==='image'?`<img src="${a.dataUrl}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">`:'📄'}
    <span>${esc(a.name)}</span>
    <span style="cursor:pointer;color:var(--muted)" onclick="clearAttach()">✕</span></div>`;
}
function clearAttach(){ PENDING_ATTACH=null; const b=document.getElementById('attachBar'); if(b) b.remove(); }
let REC=null, RECING=false;
function toggleVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('Voice input not supported on this browser'); return; }
  const btn=document.getElementById('voiceBtn');
  if(RECING){ REC&&REC.stop(); return; }
  REC=new SR(); REC.interimResults=true; REC.continuous=false;
  REC.onstart=()=>{RECING=true; btn.style.color='var(--accent)'; toast('Listening…');};
  REC.onresult=e=>{ let t=''; for(const r of e.results) t+=r[0].transcript;
    document.getElementById('prompt').value=t; document.getElementById('prompt').dispatchEvent(new Event('input')); };
  REC.onend=()=>{RECING=false; btn.style.color='';};
  REC.onerror=()=>{RECING=false; btn.style.color=''; toast('Voice error');};
  REC.start();
}

/* ── model connection diagnostic ── */
async function testLLM(){
  const out=document.getElementById('llmTestOut'); out.textContent='Testing model connection…';
  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),22000); // 22s browser-side hard stop
  try{
    const r=await (await fetch(API+'/llm/test',{method:'POST',signal:ctrl.signal})).json();
    clearTimeout(tid);
    if(r.ok){ out.innerHTML=`<span style="color:var(--success)">✅ ${r.provider} responded in ${r.latency_ms}ms.</span><br><small style="color:var(--muted)">Reply: ${esc(r.model_reply||'')}</small>`; toast('Model live'); }
    else { out.innerHTML=`<span style="color:var(--error)">⚠️ ${esc(r.error||'no provider configured')}</span>`+(r.hint?`<br><small style="color:var(--muted)">${esc(r.hint)}</small>`:'')+
      (r.demo_mode?`<br><small style="color:var(--muted)">Add a Groq key (free) → <a href="https://console.groq.com" target="_blank" style="color:var(--accent)">console.groq.com</a> → paste in Settings below → Save → Test again.</small>`:''); }
  }catch(e){
    clearTimeout(tid);
    out.innerHTML=`<span style="color:var(--error)">⚠️ ${e.name==='AbortError'?'Timed out — check your key and base URL.':esc(e.message)}</span>`;
  }
}

/* ── AI-detection inspector ── */
async function toggleInspector(on){
  await fetch(API+'/inspector/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:on})});
  toast('Inspector '+(on?'enabled':'disabled'));
}
async function checkAI(){
  const text=document.getElementById('inspTest').value; if(!text) return;
  const r=await (await fetch(API+'/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})).json();
  const col=r.ai_score>=40?'var(--error)':r.ai_score>=22?'var(--warning)':'var(--success)';
  document.getElementById('inspOut').innerHTML=`<b style="color:${col}">${r.ai_score}/100 — ${r.label}</b>`+
    (r.tells.length?'<br>'+r.tells.map(t=>'• '+esc(t)).join('<br>'):'');
}
async function humanizeNow(){
  const text=document.getElementById('inspTest').value; if(!text) return;
  document.getElementById('inspOut').textContent='Humanizing…';
  const r=await (await fetch(API+'/humanize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,auto:true})})).json();
  // keep the ORIGINAL in the input; put the human version in its own copy box
  document.getElementById('humanBox').style.display='block';
  document.getElementById('humanOut').value=r.text;
  document.getElementById('inspOut').innerHTML=`<span style="color:var(--success)">✓ Humanized — ${r.final.ai_score}/100 (${r.final.label}). Copy below.</span>`;
}
async function copyHuman(){
  const t=document.getElementById('humanOut');
  t.select();
  try{ await navigator.clipboard.writeText(t.value); toast('Copied human text'); }
  catch(_){ document.execCommand('copy'); toast('Copied'); }
}

/* ── Master Instructions + GitHub self-push ── */
async function saveMaster(){
  const text=document.getElementById('masterIns').value;
  await fetch(API+'/instructions',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text,scope:'global'})});
  document.getElementById('masterMsg').textContent='✓ Saved — now overrides every agent';
  toast('Master instructions saved');
}
async function pushSelf(){
  const repo=document.getElementById('pushRepo').value.trim();
  const message=document.getElementById('pushMsg').value.trim()||'Deploy via NEXUS';
  const out=document.getElementById('pushOut');
  if(!repo){ out.innerHTML='<span style="color:var(--error)">Enter owner/name</span>'; return; }
  out.textContent='Pushing…';
  const r=await (await fetch(API+'/git/push-self',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({repo,message})})).json();
  out.innerHTML = r.ok ? `<span style="color:var(--success)">✅ Pushed → </span><a href="${r.repo}" target="_blank" style="color:var(--accent)">${r.repo}</a>`
                       : `<span style="color:var(--error)">⚠️ ${esc(r.error||'failed')}</span>`;
  if(r.ok) toast('Pushed to GitHub');
}

/* ──────────────────────────────────────────────────────────────────
   PROJECTS (isolated memory) + active-project switcher
   ────────────────────────────────────────────────────────────────── */
/* ── CHAT HISTORY ── */
async function loadHistory(){
  const g=document.getElementById('view-generic'); g.classList.add('active');
  const wrap=g.querySelector('.wrap');
  wrap.innerHTML='<div class="card"><h3>Chat History</h3><div id="histList" style="margin-top:6px">Loading…</div></div>';
  const j=await (await fetch(`${API}/conversations`)).json();
  const list=document.getElementById('histList');
  if(!j.conversations.length){ list.innerHTML='<p style="color:var(--text2)">No saved chats yet. Start a conversation and it appears here.</p>'; return; }
  list.innerHTML=j.conversations.map(c=>{
    const when=new Date((c.updated_at||0)*1000).toLocaleString();
    return `<div class="conn">
      <div class="ci">💬</div>
      <div style="flex:1;min-width:0" onclick="openConversation('${c.id}')">
        <div class="cn" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</div>
        <div class="cs">${c.message_count} msg · ${esc(when)}</div></div>
      <button class="btn sec" style="padding:6px 10px;font-size:12px" onclick="openConversation('${c.id}')">Open</button>
      <button class="btn sec" style="padding:6px 10px;font-size:12px;margin-left:6px" onclick="deleteConversation('${c.id}',event)">✕</button>
    </div>`;
  }).join('');
}
async function openConversation(cid){
  const r=await (await fetch(`${API}/conversations/${cid}`)).json();
  if(!r.ok){ toast('Not found'); return; }
  CONV=cid;
  go('chat');
  const msgs=document.getElementById('msgs'); msgs.innerHTML='';
  document.getElementById('emptyState').style.display='none';
  document.getElementById('viewTitle').textContent=r.conversation.title||'Chat';
  for(const m of r.conversation.messages){
    if(m.role==='user') addMsg('user', esc(m.content));
    else { const {clean}=stashCodeBlocks(m.content||''); addMsg('ai', esc(clean)); }
  }
  scrollDown();
}
async function deleteConversation(cid, e){
  if(e) e.stopPropagation();
  await fetch(`${API}/conversations/${cid}`,{method:'DELETE'});
  if(CONV===cid) newChat();
  toast('Deleted'); loadHistory();
}

async function loadProjects(){
  const g=document.getElementById('view-generic'); g.classList.add('active');
  const wrap=g.querySelector('.wrap');
  const j=await (await fetch(`${API}/projects`)).json();
  wrap.innerHTML=`<div class="card"><h3>Projects</h3>
    <p style="color:var(--text2);font-size:14px">Each project has its own isolated workspace, memory & artifacts. Active: <b>${PROJECT}</b></p>
    <div style="display:flex;gap:8px;margin-top:8px"><input id="newProjName" placeholder="New project name…" style="flex:1;padding:11px 14px;border-radius:14px;border:1px solid var(--border);background:var(--bg2);color:var(--text)">
    <button class="btn" onclick="createProject()">Create</button></div></div>
    <div id="projList"></div>`;
  renderProjList(j);
}
function renderProjList(j){
  const el=document.getElementById('projList'); if(!el) return;
  const row=p=>`<div class="conn">
    <div class="ci">${(p.name||'P')[0].toUpperCase()}</div>
    <div style="flex:1"><div class="cn">${esc(p.name)} ${p.id===PROJECT?'<span style="color:var(--accent);font-size:11px">● active</span>':''}</div>
      <div class="cs">${p.file_count||0} files · ${p.id}</div></div>
    <button class="btn sec" style="padding:6px 10px;font-size:12px" onclick="switchProject('${p.id}','${esc(p.name)}')">Open</button>
    <button class="btn sec" style="padding:6px 10px;font-size:12px;margin-left:6px" onclick="archiveProject('${p.id}')">${p.archived?'Unarchive':'Archive'}</button>
  </div>`;
  el.innerHTML=`<div class="card"><h3>Active</h3>${(j.active||[]).map(row).join('')||'<p style="color:var(--text2)">None yet.</p>'}</div>`+
    ((j.archived||[]).length?`<div class="card"><h3>Archived</h3>${j.archived.map(row).join('')}</div>`:'');
}
async function createProject(){
  const name=document.getElementById('newProjName').value.trim(); if(!name) return;
  const r=await (await fetch(`${API}/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json();
  toast('Project created'); switchProject(r.project.id, r.project.name); loadProjects();
}
function switchProject(id,name){ PROJECT=id; toast('Switched to '+(name||id)); document.getElementById('wsProject').textContent=id; loadProjects(); }
async function archiveProject(id){
  const j=await (await fetch(`${API}/projects`)).json();
  const p=[...(j.active||[]),...(j.archived||[])].find(x=>x.id===id);
  await fetch(`${API}/projects/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:!p.archived})});
  loadProjects();
}

/* generate paywall into the active project (for client apps) */
async function genPaywall(provider){
  const out=document.getElementById('depOut')||document.getElementById('skillMsg');
  const r=await (await fetch(`${API}/paywall/${provider}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project_id:PROJECT,price_label:'Pro Plan',amount:2500})})).json();
  toast(r.ok?('Paywall ('+provider+') generated'):'Failed');
  if(out) out.innerHTML = r.ok?`<span style="color:var(--success)">✅ Wrote: ${r.files.join(', ')}</span>`:`<span style="color:var(--error)">${esc(r.error)}</span>`;
}

buildNav(); refreshLLM(); setInterval(refreshLLM, 15000);
