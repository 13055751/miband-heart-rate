import React, { useEffect, useRef, useState } from 'react'

// Default configuration. Will be merged with saved config from localStorage
const DEFAULT_CONFIG = {
  useSSE: true,
  sseUrl: 'http://127.0.0.1:3030/events',
  latestUrl: 'http://127.0.0.1:3030/latest',
  pollInterval: 1000,
  smoothingWindow: 5,
  showChart: true,
  showNumber: true,
  enableAlarm: true,
  alarmHigh: 180,
  alarmLow: 40,
  theme: {
    bg: 'rgba(0,0,0,0.4)',
    text: '#ffffff',
    accent: '#ff4d4f',
    fontSize: 72
  },
  floatingMode: false
}

function loadConfig(){
  try{
    const raw = localStorage.getItem('miband_config_v1');
    if(!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {...DEFAULT_CONFIG, ...parsed};
  }catch(e){ return DEFAULT_CONFIG }
}

function saveConfig(cfg){
  try{ localStorage.setItem('miband_config_v1', JSON.stringify(cfg)); }catch(e){}
}

export default function App(){
  const [cfg, setCfg] = useState(loadConfig);
  const [data, setData] = useState([]); // {t,hr}
  const [status, setStatus] = useState('等待数据…');
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const alarmRef = useRef(null);
  const sseRef = useRef(null);
  const pollRef = useRef(null);

  // persist config on change
  useEffect(()=>{ saveConfig(cfg); }, [cfg]);

  // initialize audio (simple beep synthesized as data URI)
  useEffect(()=>{
    const ctx = typeof window !== 'undefined' && window.AudioContext ? new AudioContext() : null;
    if(!ctx) return;
    alarmRef.current = ctx;
  },[])

  // small helper: play simple beep
  function playBeep(){
    try{
      const ctx = alarmRef.current;
      if(!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.value = 0.05;
      o.start(); o.stop(ctx.currentTime + 0.12);
    }catch(e){}
  }

  // connect SSE or polling
  useEffect(()=>{
    // cleanup previous
    if(sseRef.current){ try{sseRef.current.close()}catch(e){} sseRef.current=null }
    if(pollRef.current){ clearInterval(pollRef.current); pollRef.current=null }

    if(cfg.useSSE){
      try{
        const es = new EventSource(cfg.sseUrl);
        sseRef.current = es;
        es.onopen = ()=> setStatus('SSE 已连接');
        es.onerror = ()=>{
          setStatus('SSE 连接失败，回退轮询');
          es.close(); sseRef.current=null; startPolling();
        }
        es.onmessage = e => {
          try{
            const obj = JSON.parse(e.data);
            addPoint(obj);
          }catch(_){ }
        }
      }catch(e){ startPolling(); }
    }else{
      startPolling();
    }

    function startPolling(){
      if(pollRef.current) return;
      setStatus('轮询中…');
      pollRef.current = setInterval(async ()=>{
        try{
          const r = await fetch(cfg.latestUrl, {cache:'no-store'});
          if(!r.ok) throw new Error('no');
          const j = await r.json(); addPoint(j);
        }catch(e){ setStatus('无法获取数据'); }
      }, cfg.pollInterval);
    }

    return ()=>{
      if(sseRef.current){ try{sseRef.current.close()}catch(e){} sseRef.current=null }
      if(pollRef.current){ clearInterval(pollRef.current); pollRef.current=null }
    }
  }, [cfg.useSSE, cfg.sseUrl, cfg.latestUrl, cfg.pollInterval]);

  // push incoming points
  function addPoint(obj){
    if(!obj || typeof obj.hr !== 'number') return;
    setData(prev => {
      const next = [...prev, {t: obj.ts||Date.now(), hr: obj.hr}];
      if(next.length > 240) next.splice(0, next.length-240);
      return next;
    });
  }

  // render chart using Chart.js from CDN
  useEffect(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if(chartRef.current){ chartRef.current.destroy(); chartRef.current=null }
    chartRef.current = new window.Chart(ctx, {
      type: 'line', data: { labels: [], datasets:[{data:[], borderWidth:2, tension:0.25, fill:false, pointRadius:0}]},
      options: { animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{suggestedMin:30, suggestedMax:200}} }
    });
    return ()=>{ chartRef.current?.destroy(); chartRef.current=null }
  },[])

  // whenever data changes, update chart and check alarms
  useEffect(()=>{
    if(!chartRef.current) return;
    const hrs = data.map(d=>d.hr);
    const times = data.map(d=>new Date(d.t).toLocaleTimeString());
    let plot = hrs;
    if(cfg.smoothingWindow > 1){ plot = sma(hrs, cfg.smoothingWindow); }
    chartRef.current.data.labels = times; chartRef.current.data.datasets[0].data = plot; chartRef.current.update();

    if(plot.length===0){ setStatus('等待数据…'); return }
    const last = plot[plot.length-1];
    if(cfg.showNumber){ /* do nothing here (render below) */ }

    if(cfg.enableAlarm && (last >= cfg.alarmHigh || last <= cfg.alarmLow)){
      setStatus(last >= cfg.alarmHigh ? '极高心率' : '过低心率');
      playBeep();
    }else{
      setStatus('正常');
    }
  }, [data, cfg.smoothingWindow, cfg.enableAlarm, cfg.alarmHigh, cfg.alarmLow]);

  function sma(values, window){ if(!values||window<=1) return values; const out=[]; for(let i=0;i<values.length;i++){ const s=Math.max(0,i-window+1); const slice=values.slice(s,i+1); const avg=slice.reduce((a,b)=>a+b,0)/slice.length; out.push(avg);} return out }

  // UI handlers
  function updateCfg(patch){ setCfg(prev=>{ const next = {...prev, ...patch}; saveConfig(next); return next }); }

  // export CSV
  function exportCSV(){
    const csv = 'time,hr\n' + data.map(d=>`${new Date(d.t).toISOString()},${d.hr}`).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='hr.csv'; a.click(); URL.revokeObjectURL(url);
  }

  // floating draggable behaviour for pure browser mode
  useEffect(()=>{
    if(!cfg.floatingMode) return;
    const el = document.getElementById('floating-box'); if(!el) return;
    let dragging=false, ox=0, oy=0;
    function down(e){ dragging=true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop }
    function move(e){ if(!dragging) return; el.style.left = (e.clientX-ox)+'px'; el.style.top = (e.clientY-oy)+'px' }
    function up(){ dragging=false }
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return ()=>{ el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)}
  }, [cfg.floatingMode]);

  // render
  const lastHr = (()=>{ if(data.length===0) return '--'; const arr = data.map(d=>d.hr); const plot = cfg.smoothingWindow>1? sma(arr, cfg.smoothingWindow) : arr; return Math.round(plot[plot.length-1]); })();

  const main = (
    <div id="app" className="min-w-[320px] min-h-[140px] rounded-xl p-3" style={{background: cfg.theme.bg, color: cfg.theme.text, fontSize: 14}}>
      <div className="flex items-center justify-between window-drag">
        <div>
          <div className="text-sm opacity-80">心率（实时）</div>
          {cfg.showNumber && <div style={{fontSize: cfg.theme.fontSize+'px', fontWeight:700,lineHeight:1}}>{lastHr}</div>}
          <div className="text-xs opacity-70">状态：{status}</div>
        </div>
        <div className="window-btn">
          <div className="flex gap-2">
            <button className="px-2 py-1 rounded bg-black/30" onClick={()=>updateCfg({showChart: !cfg.showChart})}>{cfg.showChart? '隐藏图表':'显示图表'}</button>
            <button className="px-2 py-1 rounded bg-black/30" onClick={exportCSV}>导出</button>
          </div>
        </div>
      </div>

      {cfg.showChart && <div className="mt-2" style={{height:120}}>
        <canvas ref={canvasRef} width={600} height={120}></canvas>
      </div>}

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer">设置</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <label className="col-span-2">连接方式</label>
          <div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.useSSE} onChange={e=>updateCfg({useSSE: e.target.checked})}/> 使用 SSE</label>
          </div>
          <div>
            <button className="px-2 py-1 rounded bg-black/20" onClick={()=>{ navigator.clipboard?.writeText(JSON.stringify(cfg)).catch(()=>{});}}>复制配置</button>
          </div>

          <label className="col-span-2">URLs</label>
          <input className="col-span-2 p-1 rounded bg-black/20" value={cfg.sseUrl} onChange={e=>updateCfg({sseUrl:e.target.value})} />
          <input className="col-span-2 p-1 rounded bg-black/20" value={cfg.latestUrl} onChange={e=>updateCfg({latestUrl:e.target.value})} />

          <label>轮询间隔(ms)</label>
          <input type="number" className="p-1 rounded bg-black/10" value={cfg.pollInterval} onChange={e=>updateCfg({pollInterval: Number(e.target.value) || 1000})} />

          <label>平滑窗口</label>
          <input type="range" min="1" max="20" value={cfg.smoothingWindow} onChange={e=>updateCfg({smoothingWindow: Number(e.target.value)})} />

          <label>报警阈值上限</label>
          <input type="number" value={cfg.alarmHigh} onChange={e=>updateCfg({alarmHigh: Number(e.target.value)})} />
          <label>报警阈值下限</label>
          <input type="number" value={cfg.alarmLow} onChange={e=>updateCfg({alarmLow: Number(e.target.value)})} />

          <label>主题色（accent）</label>
          <input type="color" value={cfg.theme.accent} onChange={e=>updateCfg({theme:{...cfg.theme, accent:e.target.value}})} />

          <label>字体大小</label>
          <input type="range" min="28" max="140" value={cfg.theme.fontSize} onChange={e=>updateCfg({theme:{...cfg.theme,fontSize: Number(e.target.value)}})} />

          <label>悬浮模式</label>
          <div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.floatingMode} onChange={e=>updateCfg({floatingMode: e.target.checked})}/> 启用页面内悬浮（非 Electron）</label>
          </div>

          <div className="col-span-2 mt-2">
            <button className="px-3 py-1 rounded bg-black/30" onClick={()=>{ localStorage.removeItem('miband_config_v1'); location.reload();}}>重置配置</button>
          </div>
        </div>
      </details>
    </div>
  )

  // when floatingMode flag is on, wrap with a small draggable container
  if(cfg.floatingMode){
    return (
      <div id="floating-box" className={`floating p-2`} style={{left: 'auto', top:'auto'}}>
        {main}
      </div>
    )
  }

  // normal full UI
  return (
    <div className="p-4 min-h-screen bg-gradient-to-br from-black/60 to-black/40 flex items-start justify-center" style={{minWidth:320}}>
      <div className="rounded-xl p-1" style={{width:360}}>{main}</div>
    </div>
  )
}