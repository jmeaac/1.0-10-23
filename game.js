/* 长盛 v2 — 无依赖、本地模拟。所有写入统一经过 mutate；不发送网络请求。 */
(() => {
  'use strict';
  const KEY = 'changsheng.v2.state', OLD = 'gameHistory', LIMIT = 10000, PERIOD = 210000;
  const GROUPS = [[1,4,7,10,13,16],[2,5,8,11,14,17],[3,6,9,12,15,18]];
  const $ = id => document.getElementById(id);
  const fresh = () => ({version:2, records:[], nextId:1, mode:'instant', running:false, deadline:0});
  let state = fresh(), page = 1, busy = false, blocked = false, legacy = [];
  function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
  function classify(n) { return (n >= 14 ? '大' : '小') + (n % 2 ? '单' : '双'); }
  function calculate(numbers) {
    if (numbers.length !== 20 || new Set(numbers).size !== 20 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 80)) throw Error('原始号码无效');
    const sorted = [...numbers].sort((a,b) => a-b);
    const groups = GROUPS.map(positions => positions.map(i => sorted[i]));
    const sums = groups.map(g => g.reduce((a,b) => a+b,0));
    const digits = sums.map(n => n%10), result = digits.reduce((a,b) => a+b,0);
    return {numbers:sorted, groups, sums, digits, result, category:classify(result)};
  }
  // 拒绝采样消除取模偏差；部分 Fisher–Yates 保证无放回均匀抽样。
  function randomInt(max) {
    const values = new Uint32Array(1), boundary = Math.floor(4294967296/max)*max;
    do { crypto.getRandomValues(values); } while (values[0] >= boundary);
    return values[0]%max;
  }
  function generate() {
    const pool = Array.from({length:80},(_,i) => i+1);
    for (let i=0;i<20;i++) { const j=i+randomInt(80-i); [pool[i],pool[j]]=[pool[j],pool[i]]; }
    return pool.slice(0,20).sort((a,b) => a-b);
  }
  function readState() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    if (s.version!==2 || !Array.isArray(s.records) || s.records.length>LIMIT || !Number.isSafeInteger(s.nextId) || s.nextId<1 || !['instant','timed'].includes(s.mode) || typeof s.running!=='boolean' || !Number.isFinite(s.deadline) || (s.running && (s.mode!=='timed' || s.deadline<=0))) throw Error('保存的数据格式异常');
    let previous=0;
    for (const r of s.records) {
      if (!Number.isSafeInteger(r.id) || r.id<=previous || r.id>=s.nextId || !Number.isFinite(r.time) || Math.abs(r.time)>8640000000000000) throw Error('历史记录异常');
      calculate(r.numbers); previous=r.id;
    }
    return s;
  }
  function load() {
    try { state=readState(); blocked=false; }
    catch { state=fresh(); blocked=true; notice('无法读取本地数据（存储不可用或数据损坏）。为避免覆盖，已暂停生成；请检查浏览器权限，或使用清除功能重新开始。'); }
    try {
      const data=JSON.parse(localStorage.getItem(OLD)||'[]');
      legacy=Array.isArray(data) ? data.filter(r => r && Number.isInteger(r.result) && r.result>=0 && r.result<=27).slice(-10000) : [];
    } catch { legacy=[]; notice('旧版历史数据无法解析；清除功能仍会删除旧版数据。'); }
  }
  async function exclusive(task) {
    if (navigator.locks) return navigator.locks.request('changsheng-v2-write',task);
    return task(); // 旧浏览器请只在一个标签页使用；见说明。
  }
  async function mutate(fn) {
    if (busy || blocked) return;
    busy=true;
    try {
      await exclusive(() => {
        const next=readState(); fn(next);
        localStorage.setItem(KEY,JSON.stringify(next)); state=next;
      });
      page=1; render();
    } catch { notice('操作未保存：浏览器存储可能已满、被禁用或数据异常。请先导出已有记录，再检查存储或清除数据。'); }
    finally { busy=false; }
  }
  function append(s,count) {
    for(let i=0;i<count;i++) s.records.push({id:s.nextId++,time:Date.now(),numbers:generate()});
    s.records=s.records.slice(-LIMIT);
  }
  const fmt = time => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(time);
  const idText = id => 'SIM-'+String(id).padStart(6,'0');
  function detailHTML(calc) {
    return '<div class="numbers">'+calc.numbers.map(n=>'<span class="number">'+n+'</span>').join('')+'</div>'+calc.groups.map((g,i)=>'<div class="group"><strong>第'+['一','二','三'][i]+'区</strong> · 第'+GROUPS[i].map(n=>n+1).join('/')+'位<br>'+g.join(' + ')+' = '+calc.sums[i]+' → 个位 <strong>'+calc.digits[i]+'</strong></div>').join('');
  }
  function render() {
    const rows=state.records, last=rows[rows.length-1];
    $('drawId').textContent=last?idText(last.id):'等待首次开奖';
    if(last) {
      const c=calculate(last.numbers);
      $('result').innerHTML='<div class="result-line">'+c.digits.map((n,i)=>(i?'<span class="operator">+</span>':'')+'<span class="ball">'+n+'</span>').join('')+'<span class="operator">=</span><span class="ball sum">'+c.result+'</span></div><div class="result-meta"><span class="badge">'+c.category[0]+'</span><span class="badge alt">'+c.category[1]+'</span><small>'+fmt(last.time)+' · 北京时间</small></div>';
      $('details').innerHTML=detailHTML(c);
    } else {
      $('result').innerHTML='<div class="empty-result"><span>—</span><p>准备就绪，开始你的第一期模拟</p></div>';
      $('details').textContent='开奖后显示20个号码及三组计算过程。';
      $('calculation').open=false;
    }
    const timed=state.mode==='timed';
    $('instant').setAttribute('aria-pressed',String(!timed)); $('timed').setAttribute('aria-pressed',String(timed));
    $('instant').disabled=state.running || blocked; $('timed').disabled=state.running || blocked;
    $('modeHint').textContent=timed?'启动立即开奖，之后每3分30秒生成一期。':'无需等待，点击即可生成一期结果。';
    $('draw').textContent=timed?(state.running?'停止自动模拟':'开始自动模拟 ↗'):'生成一期 ↗';
    $('draw').disabled=blocked; $('batch').disabled=state.running || blocked; $('batchSize').disabled=state.running || blocked;
    $('export').disabled=!rows.length;
    const counts=Array(28).fill(0); let large=0,odd=0,sum=0;
    for(const r of rows) { const n=calculate(r.numbers).result; counts[n]++; sum+=n; large+=n>=14?1:0; odd+=n%2; }
    const ratio=n=>(n/rows.length*100).toFixed(1)+'%';
    $('total').textContent=rows.length.toLocaleString();
    $('sizes').textContent=rows.length?ratio(large)+' / '+ratio(rows.length-large):'—';
    $('parities').textContent=rows.length?ratio(odd)+' / '+ratio(rows.length-odd):'—';
    $('average').textContent=rows.length?(sum/rows.length).toFixed(2):'—';
    const max=Math.max(1,...counts);
    $('bars').innerHTML=counts.map((n,i)=>'<div class="bar-col" title="和值'+i+'：'+n+'次" aria-label="和值'+i+'，'+n+'次"><span class="count">'+n+'</span><div class="bar-track"><div class="bar" style="height:'+n/max*100+'%"></div></div>'+i+'</div>').join('');
    renderHistory(); tickText();
    $('legacySection').hidden=!legacy.length;
    $('legacy').replaceChildren();
    for(const r of legacy.slice(-100).reverse()) { const el=document.createElement('p'); el.textContent=String(r.date||'时间未知')+' · '+r.result+' · '+classify(r.result); $('legacy').append(el); }
    if(legacy.length>100) { const el=document.createElement('p'); el.textContent='仅展示最近100条旧版记录；全部旧版记录均包含在清除范围内。'; $('legacy').append(el); }
  }
  function renderHistory() {
    const rows=state.records, pages=Math.max(1,Math.ceil(rows.length/25)); page=Math.min(page,pages);
    $('historyCount').textContent=rows.length+'条'; $('pageInfo').textContent='第'+page+' / '+pages+'页';
    $('prev').disabled=page<=1; $('next').disabled=page>=pages;
    $('history').innerHTML=rows.length?[...rows].reverse().slice((page-1)*25,page*25).map(r=> {
      const c=calculate(r.numbers);
      return '<details><summary><span class="row-id">'+idText(r.id)+'</span><span class="row-time">'+fmt(r.time)+'</span><span class="row-digits">'+c.digits.join(' + ')+' = <span class="row-sum">'+c.result+'</span></span><span class="badge">'+c.category+'</span></summary><p class="muted">'+fmt(r.time)+' · 北京时间</p>'+detailHTML(c)+'</details>';
    }).join(''):'<div class="empty">还没有开奖记录。生成一期后，这里会保存完整计算过程。</div>';
  }
  function tickText() {
    if(!state.running) { $('timer').textContent=state.mode==='timed'?'已停止 · 间隔03:30':'每期抽取20个不重复号码'; return; }
    const seconds=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));
    $('timer').textContent='距下期 '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  }
  function tick() {
    tickText();
    if(state.running && Date.now()>=state.deadline && !busy && !blocked) mutate(s=>{
      if(s.running && Date.now()>=s.deadline) { append(s,1); s.deadline=Date.now()+PERIOD; }
    });
  }
  $('instant').onclick=()=>mutate(s=>{if(!s.running)s.mode='instant';});
  $('timed').onclick=()=>mutate(s=>{if(!s.running)s.mode='timed';});
  $('draw').onclick=()=>mutate(s=>{
    if(s.mode==='instant') append(s,1);
    else if(s.running) {s.running=false;s.deadline=0;}
    else {append(s,1);s.running=true;s.deadline=Date.now()+PERIOD;}
  });
  $('batch').onclick=()=>mutate(s=>{if(!s.running)append(s,$('batchSize').value==='1000'?1000:100);});
  $('prev').onclick=()=>{page--;renderHistory();}; $('next').onclick=()=>{page++;renderHistory();};
  $('export').onclick=()=>{
    const csv=[['模拟期号','北京时间','第一区','第二区','第三区','和值','分类','原始号码'],...state.records.map(r=>{const c=calculate(r.numbers);return [idText(r.id),fmt(r.time),...c.digits,c.result,c.category,c.numbers.join(' ')];})].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='changsheng-history-'+Date.now()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('clear').onclick=()=>{$('confirmText').value='';$('confirmClear').disabled=true;$('clearDialog').showModal();};
  $('confirmText').oninput=()=>{$('confirmClear').disabled=$('confirmText').value.trim()!=='清除';};
  $('cancelClear').onclick=()=>$('clearDialog').close();
  $('confirmClear').onclick=async()=>{
    if($('confirmText').value.trim()!=='清除' || busy)return;
    busy=true;
    try {
      await exclusive(()=>{
        // 删除本应用已知的新旧存储键；不使用 localStorage.clear()，避免误删同域其他项目。
        for(const storage of [localStorage,sessionStorage]) {
          storage.removeItem(KEY); storage.removeItem(OLD);
          if(storage.getItem(KEY)!==null || storage.getItem(OLD)!==null)throw Error('删除校验失败');
        }
      });
      state=fresh();legacy=[];page=1;blocked=false;render();$('clearDialog').close();
      notice('已清除当前浏览器中本应用的新旧历史、统计及计时状态。自动模拟已停止。');
    } catch { state.running=false;notice('未能确认全部数据已清除。自动模拟已暂停，请检查浏览器存储权限；不要将本次操作视为清除成功。'); }
    finally {busy=false;}
  };
  window.addEventListener('storage',e=>{if(e.key===KEY || e.key===OLD || e.key===null){load();render();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){load();render();tick();}});
  load();render();
  if(!navigator.locks) notice('此浏览器不支持跨标签页写入锁，请只在一个标签页运行模拟，避免同时操作覆盖记录。');
  setInterval(tick,1000);
})();
