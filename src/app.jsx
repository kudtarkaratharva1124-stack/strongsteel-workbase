import { createClient } from '@supabase/supabase-js';
import { useState, useEffect, useRef, useReducer } from 'react';

// Leaflet map (loaded dynamically)
function loadLeaflet() {
  return new Promise(resolve => {
    if (window.L) { resolve(window.L); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
}

function MapPicker({ onSelect, onClose }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    loadLeaflet().then(L => {
      if (mapInstanceRef.current) return;
      const map = L.map(mapRef.current).setView([19.4031, 72.8717], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      map.on('click', e => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) markerRef.current.remove();
        markerRef.current = L.marker([lat, lng]).addTo(map);
        setSelected({ lat: lat.toFixed(6), lng: lng.toFixed(6) });
      });
      mapInstanceRef.current = map;
    });
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, []);

  async function searchLocation() {
    if (!search.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(search)}&limit=1`);
      const data = await res.json();
      if (data.length === 0) { setSearchError('Location not found. Try a different search.'); setSearching(false); return; }
      const { lat, lon, display_name } = data[0];
      const L = window.L;
      const map = mapInstanceRef.current;
      map.setView([parseFloat(lat), parseFloat(lon)], 16);
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.marker([parseFloat(lat), parseFloat(lon)]).addTo(map);
      markerRef.current.bindPopup(display_name).openPopup();
      setSelected({ lat: parseFloat(lat).toFixed(6), lng: parseFloat(lon).toFixed(6) });
    } catch (e) { setSearchError('Search failed. Try tapping on the map directly.'); }
    setSearching(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 600, maxWidth: '95vw' }}>
        <div className="modal-title">📍 Pick site location</div>
        <button className="modal-close" onClick={onClose}><i className="ti ti-x"></i></button>
        <div className="flex gap-2" style={{ marginBottom: 10 }}>
          <input
            placeholder="Search address or place name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchLocation()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={searchLocation} disabled={searching}>
            {searching ? <span className="spinner"></span> : <i className="ti ti-search"></i>}
          </button>
        </div>
        {searchError && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{searchError}</div>}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Or tap anywhere on the map to drop a pin manually.</div>
        <div ref={mapRef} style={{ height: 360, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 14 }}></div>
        {selected && <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>✅ Selected: {selected.lat}, {selected.lng}</div>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!selected} onClick={() => { onSelect(selected); onClose(); }}>Confirm location</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── CONFIG (from .env) ────────────────────────────────────────────────────────
const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY= import.meta.env.VITE_SUPABASE_ANON_KEY;
const GEMINI_API_KEY   = import.meta.env.VITE_GEMINI_API_KEY;
const FAST2SMS_KEY     = import.meta.env.VITE_FAST2SMS_KEY;
const OFFICE_LAT       = parseFloat(import.meta.env.VITE_OFFICE_LAT  || '19.403174');
const OFFICE_LNG       = parseFloat(import.meta.env.VITE_OFFICE_LNG  || '72.8717664');
const GEOFENCE_RADIUS  = parseInt(import.meta.env.VITE_GEOFENCE_RADIUS || '150');

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DB LAYER ──────────────────────────────────────────────────────────────────
const DB = {
  async getAll(table) {
    const { data, error } = await sb.from(table).select('*');
    if (error) throw error;
    return data || [];
  },
  async insert(table, row) {
    const { data, error } = await sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async update(table, id, updates) {
    const { error } = await sb.from(table).update(updates).eq('id', id);
    if (error) throw error;
  },
  async delete(table, id) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
  },
  async getOne(table, col, val) {
    const { data, error } = await sb.from(table).select('*').eq(col, val).maybeSingle();
    if (error) throw error;
    return data;
  },
  subscribe(table, cb) {
    return sb.channel('realtime:' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        DB.getAll(table).then(cb).catch(console.warn);
      })
      .subscribe();
  }
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(ms) {
  if (ms < 0) return 'Overdue';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

async function callAI(messages, system = '') {
  const geminiMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  if (system) geminiMessages.unshift({ role: 'user', parts: [{ text: 'SYSTEM: ' + system }] });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: geminiMessages, generationConfig: { maxOutputTokens: 1000 } })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function sendOtpSms(mobile, otp) {
  if (!FAST2SMS_KEY || FAST2SMS_KEY === 'YOUR_FAST2SMS_API_KEY') {
    alert(`[Demo] OTP for ${mobile}: ${otp}\nAdd VITE_FAST2SMS_KEY in .env to send real SMS.`);
    return true;
  }
  const res = await fetch(
    `https://www.fast2sms.com/dev/bulkV2?authorization=${FAST2SMS_KEY}&route=otp&variables_values=${otp}&flash=0&numbers=${mobile}`
  );
  const data = await res.json();
  if (!data.return) throw new Error(data.message || 'SMS failed');
  return true;
}

// ── PWA SERVICE WORKER ────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const sw = `
      const CACHE='ss-v1';
      self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/']))));
      self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
    `;
    const blob = new Blob([sw], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
  });
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const styles = `
  :root{--bg:#0d0f12;--surface:#141720;--surface2:#1c2030;--border:#262b38;--border2:#2f3545;--text:#e8ecf2;--text2:#8892a4;--text3:#5a637a;--accent:#f97316;--accent-h:#ea6c0a;--danger:#ef4444;--success:#22c55e;--info:#38bdf8;--purple:#a78bfa;--font:'Inter',-apple-system,sans-serif;--radius:8px;--radius-lg:12px;}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body,#root{height:100%;}
  body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;overflow-x:hidden;}
  ::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px;}
  .app-shell{display:flex;height:100vh;}
  .sidebar{width:224px;min-width:224px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;}
  .sidebar-logo{padding:20px 18px 16px;border-bottom:1px solid var(--border);}
  .logo-wordmark{font-size:16px;font-weight:600;color:var(--text);}
  .logo-wordmark span{color:var(--accent);}
  .logo-sub{font-size:11px;color:var(--text3);margin-top:2px;}
  .sidebar-nav{flex:1;padding:10px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;}
  .nav-section-label{font-size:10px;font-weight:500;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;padding:10px 8px 4px;}
  .nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;color:var(--text2);font-size:13px;font-weight:500;transition:all 0.12s;position:relative;border:none;background:none;width:100%;text-align:left;border-radius:var(--radius);}
  .nav-item:hover{color:var(--text);background:var(--surface2);}
  .nav-item.active{color:var(--text);background:var(--surface2);}
  .nav-item.active::before{content:'';position:absolute;left:0;top:20%;height:60%;width:2.5px;background:var(--accent);border-radius:0 2px 2px 0;}
  .nav-item i{font-size:16px;flex-shrink:0;}
  .nav-badge{margin-left:auto;background:var(--danger);color:#fff;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center;}
  .sidebar-user{padding:12px 14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;}
  .user-avatar{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#000;flex-shrink:0;}
  .user-info{min-width:0;flex:1;}
  .user-name{font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .user-role{font-size:10px;color:var(--text3);text-transform:capitalize;margin-top:1px;}
  .logout-btn{background:none;border:none;color:var(--text3);cursor:pointer;padding:5px;border-radius:6px;transition:all 0.12s;display:flex;align-items:center;}
  .logout-btn:hover{color:var(--danger);background:rgba(239,68,68,0.1);}
  .main-area{flex:1;display:flex;flex-direction:column;overflow:hidden;}
  .topbar{padding:0 24px;height:52px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;background:var(--surface);flex-shrink:0;}
  .topbar-title{font-size:14px;font-weight:600;color:var(--text);}
  .topbar-right{margin-left:auto;display:flex;align-items:center;gap:12px;}
  .topbar-live{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3);}
  .live-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
  .topbar-date{font-size:12px;color:var(--text3);}
  .page-content{flex:1;overflow-y:auto;padding:24px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;}
  .card-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px;}
  .card-title i{font-size:15px;color:var(--text2);}
  .flex-col{display:flex;flex-direction:column;gap:16px;}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
  .stat-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;}
  .stat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
  .stat-title{font-size:12px;font-weight:500;color:var(--text2);}
  .stat-icon-wrap{width:30px;height:30px;border-radius:8px;background:var(--surface);display:flex;align-items:center;justify-content:center;border:1px solid var(--border);}
  .stat-icon-wrap i{font-size:15px;color:var(--text2);}
  .stat-num{font-size:28px;font-weight:600;color:var(--text);line-height:1;letter-spacing:-0.02em;}
  .stat-sub{font-size:11px;color:var(--text3);margin-top:4px;}
  .stat-num.danger{color:var(--danger);}.stat-num.success{color:var(--success);}.stat-num.purple{color:var(--purple);}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:var(--radius);font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.12s;border:none;white-space:nowrap;}
  .btn-primary{background:var(--accent);color:#fff;}.btn-primary:hover{background:var(--accent-h);}
  .btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border2);}.btn-secondary:hover{background:var(--border);}
  .btn-danger{background:rgba(239,68,68,0.12);color:var(--danger);border:1px solid rgba(239,68,68,0.3);}.btn-danger:hover{background:rgba(239,68,68,0.22);}
  .btn-success{background:rgba(34,197,94,0.12);color:var(--success);border:1px solid rgba(34,197,94,0.3);}.btn-success:hover{background:rgba(34,197,94,0.22);}
  .btn-sm{padding:5px 10px;font-size:12px;}.btn-xs{padding:3px 8px;font-size:11px;}
  .btn:disabled{opacity:0.4;cursor:not-allowed;}
  .input-group{display:flex;flex-direction:column;gap:5px;}
  .input-label{font-size:11px;font-weight:500;color:var(--text2);letter-spacing:.02em;}
  input,textarea,select{background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius);color:var(--text);font-family:var(--font);font-size:13px;padding:8px 11px;width:100%;outline:none;transition:border-color 0.12s;}
  input:focus,textarea:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(249,115,22,0.12);}
  select option{background:var(--surface2);}textarea{resize:vertical;min-height:80px;}
  .checkbox-row{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text2);}
  .checkbox-row input[type=checkbox]{width:auto;accent-color:var(--accent);}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;}
  .badge-orange{background:rgba(249,115,22,0.15);color:#fb923c;border:1px solid rgba(249,115,22,0.25);}
  .badge-red{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.25);}
  .badge-green{background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.25);}
  .badge-blue{background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.25);}
  .badge-gray{background:var(--surface2);color:var(--text2);border:1px solid var(--border2);}
  .task-item{background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;display:flex;gap:14px;align-items:flex-start;transition:all 0.12s;}
  .task-item:hover{border-color:var(--border2);}
  .task-item.priority-critical{border-left-color:var(--danger);}
  .task-item.priority-high{border-left-color:var(--accent);}
  .task-item.priority-medium{border-left-color:#fbbf24;}
  .task-item.priority-low{border-left-color:var(--info);}
  .task-item.done{opacity:0.45;}.task-item.unseen{background:var(--surface);border-color:var(--border2);}
  .task-main{flex:1;min-width:0;}
  .task-title{font-size:14px;font-weight:500;color:var(--text);}
  .task-desc{color:var(--text2);font-size:12px;margin-top:3px;line-height:1.5;}
  .task-meta{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;}
  .task-timer{font-size:11px;color:var(--text3);font-variant-numeric:tabular-nums;}
  .task-timer.overdue{color:var(--danger);}
  .task-actions{display:flex;gap:6px;flex-shrink:0;}
  .alert-banner{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius);padding:11px 16px;display:flex;align-items:center;gap:10px;color:#f87171;font-size:13px;}
  .progress-bar-wrap{background:var(--border);border-radius:4px;height:4px;overflow:hidden;}
  .progress-bar-fill{height:100%;border-radius:4px;background:var(--accent);transition:width 0.4s;}
  .gps-panel{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px 20px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;}
  .gps-ring{width:96px;height:96px;border-radius:50%;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;transition:all 0.3s;}
  .gps-ring.in-range{border-color:var(--success);}.gps-ring.out-range{border-color:var(--danger);}.gps-ring.punched-in{border-color:var(--accent);}
  .distance-num{font-size:28px;font-weight:600;color:var(--text);}
  .distance-num.in-range{color:var(--success);}.distance-num.out-range{color:var(--danger);}
  .clock-display{font-size:44px;font-weight:600;color:var(--text);text-align:center;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;}
  .clock-label{font-size:11px;text-align:center;color:var(--text3);margin-top:5px;text-transform:uppercase;letter-spacing:.06em;}
  .chat-messages{display:flex;flex-direction:column;gap:12px;overflow-y:auto;flex:1;padding-right:4px;}
  .chat-bubble{max-width:80%;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6;}
  .chat-bubble.user{background:rgba(249,115,22,0.15);border:1px solid rgba(249,115,22,0.25);color:var(--text);margin-left:auto;border-radius:12px 12px 2px 12px;}
  .chat-bubble.ai{background:var(--surface2);border:1px solid var(--border);color:var(--text2);border-radius:2px 12px 12px 12px;}
  .chat-bubble.ai .sender{font-size:10px;font-weight:600;color:var(--accent);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;}
  .chat-input-row{display:flex;gap:8px;}
  .quick-prompts{display:flex;gap:6px;flex-wrap:wrap;}
  .quick-prompt-btn{background:var(--surface2);border:1px solid var(--border2);color:var(--text2);font-size:11px;padding:4px 10px;border-radius:20px;cursor:pointer;font-family:var(--font);transition:all 0.12s;}
  .quick-prompt-btn:hover{background:var(--border);color:var(--text);}
  .ai-briefing{background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:0 var(--radius-lg) var(--radius-lg) 0;padding:14px 16px;font-size:13px;color:var(--text2);line-height:1.7;}
  .ai-briefing-label{font-size:10px;font-weight:600;color:var(--accent);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:6px;}
  .ai-dot{width:5px;height:5px;border-radius:50%;background:var(--accent);animation:blink 1.5s infinite;}
  @keyframes blink{0%,100%{opacity:1;}50%{opacity:0.2;}}
  .filter-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px;}
  .filter-tab{padding:5px 12px;border-radius:20px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid var(--border2);background:transparent;color:var(--text2);transition:all 0.12s;}
  .filter-tab.active{background:var(--accent);color:#fff;border-color:var(--accent);}
  .filter-tab:hover:not(.active){background:var(--surface2);color:var(--text);}
  .member-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);}
  .member-row:last-child{border-bottom:none;}
  .member-avatar{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;}
  .punch-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;}
  .punch-dot.in{background:var(--success);}.punch-dot.out{background:var(--text3);}
  .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .user-table{width:100%;border-collapse:collapse;}
  .user-table th{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);}
  .user-table td{padding:11px 12px;border-bottom:1px solid var(--border);font-size:13px;}
  .user-table tr:last-child td{border-bottom:none;}
  .user-table tr:hover td{background:var(--surface2);}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:1000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:480px;max-width:95vw;max-height:88vh;overflow-y:auto;position:relative;}
  .modal-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:18px;}
  .modal-close{position:absolute;top:14px;right:14px;background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:4px;border-radius:6px;transition:all 0.12s;display:flex;}
  .modal-close:hover{color:var(--danger);background:rgba(239,68,68,0.1);}
  .loading-screen{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--bg);}
  .loading-logo{font-size:20px;font-weight:600;color:var(--text);}
  .loading-logo span{color:var(--accent);}
  .loading-sub{font-size:12px;color:var(--text3);letter-spacing:.04em;}
  .loading-bar{width:180px;height:2px;background:var(--border);border-radius:2px;overflow:hidden;}
  .loading-bar-fill{height:100%;background:var(--accent);border-radius:2px;animation:load 1.5s ease-in-out infinite;}
  @keyframes load{0%{width:0%;}70%{width:90%;}100%{width:100%;}}
  .auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);}
  .auth-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:36px;width:420px;max-width:95vw;}
  .auth-logo{text-align:center;margin-bottom:28px;}
  .auth-logo-mark{font-size:22px;font-weight:600;color:var(--text);}
  .auth-logo-mark span{color:var(--accent);}
  .auth-logo-sub{font-size:12px;color:var(--text3);margin-top:3px;}
  .auth-tabs{display:flex;margin-bottom:22px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border2);}
  .auth-tab{flex:1;padding:9px;text-align:center;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:var(--text3);border:none;transition:all 0.12s;}
  .auth-tab.active{background:var(--accent);color:#fff;}
  .flex{display:flex;}.items-center{align-items:center;}.justify-between{justify-content:space-between;}.flex-wrap{flex-wrap:wrap;}.w-full{width:100%;}
  .gap-2{gap:8px;}.mt-2{margin-top:12px;}.mt-3{margin-top:20px;}
  @media(max-width:900px){
    .grid-4{grid-template-columns:1fr 1fr;}
    .sidebar{width:56px;min-width:56px;}
    .sidebar-logo,.nav-section-label,.user-info{display:none;}
    .nav-item{padding:10px;justify-content:center;}
    .nav-label{display:none;}
    .logout-btn{display:none;}
  }
`;

// Inject styles
const styleTag = document.createElement('style');
styleTag.textContent = styles;
document.head.appendChild(styleTag);

// ── LOADING ───────────────────────────────────────────────────────────────────
function LoadingScreen({ msg }) {
  return (
    <div className="loading-screen">
      <div className="loading-logo"><span>Strong</span>Steel Workbase</div>
      <div className="loading-sub">{msg || 'Connecting...'}</div>
      <div className="loading-bar"><div className="loading-bar-fill"></div></div>
    </div>
  );
}

// ── AUTH PAGE ─────────────────────────────────────────────────────────────────
function AuthPage({ onLogin, users, setUsers }) {
  const [tab, setTab] = useState('login');
  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [regData, setRegData] = useState({ username: '', password: '', name: '', designation: '', role: 'worker', mobile: '', whatsapp: '', sameWA: true, notify: true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fpStep, setFpStep] = useState('input');
  const [fpUsername, setFpUsername] = useState('');
  const [fpOtpSent, setFpOtpSent] = useState('');
  const [fpOtpEntered, setFpOtpEntered] = useState('');
  const [fpNewPass, setFpNewPass] = useState('');
  const [fpConfirm, setFpConfirm] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpSuccess, setFpSuccess] = useState('');

  async function doLogin() {
    setError('');
    if (users.length === 0) { setError('No accounts yet. Register first.'); return; }
    const u = users.find(u => u.username === loginData.username.toLowerCase().trim() && u.password === loginData.password);
    if (!u) { setError('Invalid username or password.'); return; }
    if (!u.active) { setError('Account deactivated. Contact your manager.'); return; }
    onLogin(u);
  }

  async function doRegister() {
    setError('');
    if (!regData.username || !regData.password || !regData.name || !regData.mobile) { setError('Fill all required fields.'); return; }
    if (users.find(u => u.username === regData.username)) { setError('Username already taken.'); return; }
    setSaving(true);
    const initials = regData.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#f97316', '#38bdf8', '#22c55e', '#a78bfa', '#fb923c'];
    const newUser = { username: regData.username, password: regData.password, name: regData.name, role: regData.role, designation: regData.designation, mobile: regData.mobile, whatsapp: regData.sameWA ? regData.mobile : regData.whatsapp, notify: regData.notify, active: true, avatar: initials, color: colors[users.length % colors.length] };
    try {
      const created = await DB.insert('users', newUser);
      setUsers(u => [...u, created]);
      setTab('login');
      setLoginData({ username: regData.username, password: regData.password });
    } catch (e) { setError('Error: ' + e.message); }
    setSaving(false);
  }

  function resetFp() { setFpStep('input'); setFpUsername(''); setFpOtpSent(''); setFpOtpEntered(''); setFpNewPass(''); setFpConfirm(''); setFpLoading(false); setFpSuccess(''); setError(''); }

  async function fpSendOtp() {
    setError(''); setFpLoading(true);
    const u = users.find(u => u.username === fpUsername.trim().toLowerCase());
    if (!u) { setError('Username not found.'); setFpLoading(false); return; }
    if (!u.mobile) { setError('No mobile on this account.'); setFpLoading(false); return; }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await sendOtpSms(u.mobile, otp);
      setFpOtpSent(otp); setFpStep('verify');
      setFpSuccess(`OTP sent to ****${u.mobile.slice(-4)}`);
    } catch (e) { setError('SMS failed: ' + e.message); }
    setFpLoading(false);
  }

  function fpVerifyOtp() { setError(''); if (fpOtpEntered.trim() !== fpOtpSent) { setError('Incorrect OTP.'); return; } setFpStep('reset'); setFpSuccess(''); }

  async function fpResetPassword() {
    setError('');
    if (!fpNewPass || fpNewPass.length < 4) { setError('Min 4 characters.'); return; }
    if (fpNewPass !== fpConfirm) { setError('Passwords do not match.'); return; }
    setFpLoading(true);
    const u = users.find(u => u.username === fpUsername.trim().toLowerCase());
    try {
      await DB.update('users', u.id, { password: fpNewPass });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, password: fpNewPass } : x));
      setFpStep('done');
    } catch (e) { setError('Error: ' + e.message); }
    setFpLoading(false);
  }

  function renderForgotPassword() {
    if (fpStep === 'done') return (
      <div className="flex-col" style={{ gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--success)' }}>Password updated!</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>Sign in with your new password.</div>
        <button className="btn btn-primary w-full" style={{ justifyContent: 'center' }} onClick={() => { resetFp(); setTab('login'); }}>Go to sign in</button>
      </div>
    );
    return (
      <div className="flex-col" style={{ gap: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {fpStep === 'input' && 'Enter your username. An OTP will be sent to your registered mobile.'}
          {fpStep === 'verify' && 'Enter the 6-digit OTP sent to your mobile.'}
          {fpStep === 'reset' && 'Set your new password.'}
        </div>
        {fpStep === 'input' && <>
          <div className="input-group"><label className="input-label">Username</label><input value={fpUsername} onChange={e => setFpUsername(e.target.value)} placeholder="Your username" onKeyDown={e => e.key === 'Enter' && fpSendOtp()} /></div>
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          <button className="btn btn-primary w-full" style={{ justifyContent: 'center' }} onClick={fpSendOtp} disabled={fpLoading}>{fpLoading ? <><span className="spinner"></span> Sending...</> : 'Send OTP'}</button>
        </>}
        {fpStep === 'verify' && <>
          {fpSuccess && <div style={{ fontSize: 12, color: 'var(--success)' }}>{fpSuccess}</div>}
          <div className="input-group"><label className="input-label">OTP</label><input value={fpOtpEntered} onChange={e => setFpOtpEntered(e.target.value)} placeholder="6-digit code" maxLength={6} style={{ letterSpacing: 8, fontSize: 20, textAlign: 'center' }} onKeyDown={e => e.key === 'Enter' && fpVerifyOtp()} /></div>
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          <button className="btn btn-primary w-full" style={{ justifyContent: 'center' }} onClick={fpVerifyOtp}>Verify OTP</button>
          <button className="btn btn-secondary w-full" style={{ justifyContent: 'center' }} onClick={fpSendOtp} disabled={fpLoading}>{fpLoading ? 'Resending...' : 'Resend OTP'}</button>
        </>}
        {fpStep === 'reset' && <>
          <div className="input-group"><label className="input-label">New password</label><input type="password" value={fpNewPass} onChange={e => setFpNewPass(e.target.value)} /></div>
          <div className="input-group"><label className="input-label">Confirm password</label><input type="password" value={fpConfirm} onChange={e => setFpConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && fpResetPassword()} /></div>
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          <button className="btn btn-primary w-full" style={{ justifyContent: 'center' }} onClick={fpResetPassword} disabled={fpLoading}>{fpLoading ? <><span className="spinner"></span> Saving...</> : 'Update password'}</button>
        </>}
        <button style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12 }} onClick={() => { resetFp(); setTab('login'); }}>← Back to sign in</button>
      </div>
    );
  }

  return (
    <div className="auth-page"><div className="auth-card">
      <div className="auth-logo">
        <div className="auth-logo-mark"><span>Strong</span>Steel Workbase</div>
        <div className="auth-logo-sub">Operations Management System</div>
      </div>
      {tab === 'forgot' ? (<>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>Reset your password</div>
        {renderForgotPassword()}
      </>) : (<>
        <div className="auth-tabs">
          <button className={`auth-tab${tab === 'login' ? ' active' : ''}`} onClick={() => { setError(''); setTab('login'); }}>Sign in</button>
          <button className={`auth-tab${tab === 'register' ? ' active' : ''}`} onClick={() => { setError(''); setTab('register'); }}>Register</button>
        </div>
        {tab === 'login' ? (
          <div className="flex-col" style={{ gap: 14 }}>
            <div className="input-group"><label className="input-label">Username</label><input value={loginData.username} onChange={e => setLoginData(d => ({ ...d, username: e.target.value }))} placeholder="Enter username" onKeyDown={e => e.key === 'Enter' && doLogin()} /></div>
            <div className="input-group"><label className="input-label">Password</label><input type="password" value={loginData.password} onChange={e => setLoginData(d => ({ ...d, password: e.target.value }))} placeholder="Enter password" onKeyDown={e => e.key === 'Enter' && doLogin()} /></div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
            <button className="btn btn-primary w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={doLogin}>Sign in</button>
            <div style={{ textAlign: 'center' }}><button style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12 }} onClick={() => { resetFp(); setTab('forgot'); }}>Forgot password?</button></div>
          </div>
        ) : (
          <div className="flex-col" style={{ gap: 12 }}>
            <div className="grid-2" style={{ gap: 10 }}>
              <div className="input-group"><label className="input-label">Full name *</label><input value={regData.name} onChange={e => setRegData(d => ({ ...d, name: e.target.value }))} /></div>
              <div className="input-group"><label className="input-label">Username *</label><input value={regData.username} onChange={e => setRegData(d => ({ ...d, username: e.target.value.toLowerCase() }))} /></div>
            </div>
            <div className="grid-2" style={{ gap: 10 }}>
              <div className="input-group"><label className="input-label">Password *</label><input type="password" value={regData.password} onChange={e => setRegData(d => ({ ...d, password: e.target.value }))} /></div>
              <div className="input-group"><label className="input-label">Designation</label><input value={regData.designation} onChange={e => setRegData(d => ({ ...d, designation: e.target.value }))} /></div>
            </div>
            <div className="input-group"><label className="input-label">Role</label>
              <select value={regData.role} onChange={e => setRegData(d => ({ ...d, role: e.target.value }))}>
                <option value="worker">Worker</option><option value="manager">Manager</option><option value="boss">Boss</option>
              </select>
            </div>
            <div className="input-group"><label className="input-label">Mobile *</label><input value={regData.mobile} onChange={e => setRegData(d => ({ ...d, mobile: e.target.value }))} /></div>
            <label className="checkbox-row"><input type="checkbox" checked={regData.sameWA} onChange={e => setRegData(d => ({ ...d, sameWA: e.target.checked }))} /> WhatsApp same as mobile</label>
            {!regData.sameWA && <div className="input-group"><label className="input-label">WhatsApp</label><input value={regData.whatsapp} onChange={e => setRegData(d => ({ ...d, whatsapp: e.target.value }))} /></div>}
            <label className="checkbox-row"><input type="checkbox" checked={regData.notify} onChange={e => setRegData(d => ({ ...d, notify: e.target.checked }))} /> Receive task notifications</label>
            {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
            <button className="btn btn-primary w-full" style={{ justifyContent: 'center', padding: '10px' }} onClick={doRegister} disabled={saving}>{saving ? 'Creating account...' : 'Create account'}</button>
          </div>
        )}
      </>)}
    </div></div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ currentUser, tasks, users, punchLog }) {
  const [briefing, setBriefing] = useState('');
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const myTasks = currentUser.role === 'worker' ? tasks.filter(t => t.assigned_to === currentUser.id) : tasks;
  const pendingCount = myTasks.filter(t => !t.done).length;
  const overdueCount = myTasks.filter(t => !t.done && t.deadline < Date.now()).length;
  const doneCount = myTasks.filter(t => t.done).length;
  const unseenCount = myTasks.filter(t => !t.seen && !t.done).length;
  const criticalUnseen = tasks.filter(t => t.priority === 'critical' && !t.seen && !t.done);
  function tod() { const h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; }
  useEffect(() => {
    setLoadingBriefing(true);
    callAI([{ role: 'user', content: `2-sentence professional daily briefing for steel plant team. Data: ${currentUser.name}(${currentUser.role}), Pending:${pendingCount}, Overdue:${overdueCount}, Done:${doneCount}, Critical:${criticalUnseen.length}. Start with Good ${tod()}.` }])
      .then(t => setBriefing(t))
      .catch(() => setBriefing(`Good ${tod()}, ${currentUser.name.split(' ')[0]}. You have ${pendingCount} pending tasks${overdueCount > 0 ? `, ${overdueCount} overdue` : ''}.`))
      .finally(() => setLoadingBriefing(false));
  }, []);
  const workers = users.filter(u => u.role === 'worker' && u.active);
  const todayStr = new Date().toDateString();
  const isPunchedIn = (uid) => punchLog.find(p => p.user_id === uid && p.date === todayStr && p.in_time && !p.out_time);
  return (
    <div className="flex-col">
      {criticalUnseen.length > 0 && <div className="alert-banner"><i className="ti ti-alert-triangle"></i><span>{criticalUnseen.length} critical unseen task{criticalUnseen.length !== 1 ? 's' : ''} — {criticalUnseen.map(t => t.title).join(', ')}</span></div>}
      <div className="grid-4">
        <div className="stat-card"><div className="stat-header"><span className="stat-title">Pending tasks</span><div className="stat-icon-wrap"><i className="ti ti-checklist"></i></div></div><div className="stat-num">{pendingCount}</div><div className="stat-sub">{overdueCount > 0 ? `${overdueCount} overdue` : 'All on track'}</div></div>
        <div className="stat-card"><div className="stat-header"><span className="stat-title">Completed</span><div className="stat-icon-wrap"><i className="ti ti-circle-check"></i></div></div><div className="stat-num success">{doneCount}</div><div className="stat-sub">Total finished</div></div>
        <div className="stat-card"><div className="stat-header"><span className="stat-title">Overdue</span><div className="stat-icon-wrap"><i className="ti ti-clock-exclamation"></i></div></div><div className={`stat-num${overdueCount > 0 ? ' danger' : ''}`}>{overdueCount}</div><div className="stat-sub">{overdueCount > 0 ? 'Needs attention' : 'None overdue'}</div></div>
        <div className="stat-card"><div className="stat-header"><span className="stat-title">Unseen</span><div className="stat-icon-wrap"><i className="ti ti-eye-off"></i></div></div><div className="stat-num purple">{unseenCount}</div><div className="stat-sub">Not yet viewed</div></div>
      </div>
      <div className="ai-briefing"><div className="ai-briefing-label"><div className="ai-dot"></div>AI daily briefing</div>{loadingBriefing ? <span><span className="spinner"></span> Generating...</span> : briefing}</div>
      {currentUser.role !== 'worker' && (
        <div className="card"><div className="card-title"><i className="ti ti-users"></i> Team status</div>
          {workers.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No workers added yet.</div>}
          {workers.map(w => { const wt = tasks.filter(t => t.assigned_to === w.id); const pct = wt.length > 0 ? Math.round(wt.filter(t => t.done).length / wt.length * 100) : 0; const punched = isPunchedIn(w.id); const unseen = wt.filter(t => !t.seen && !t.done).length; return (<div key={w.id} className="member-row"><div className="member-avatar" style={{ background: w.color, color: '#000' }}>{w.avatar}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}><span className={`punch-dot ${punched ? 'in' : 'out'}`}></span>{w.name}{unseen > 0 && <span className="nav-badge" style={{ marginLeft: 0 }}>{unseen}</span>}</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{w.designation || 'Worker'} · {wt.length} tasks · {pct}% done</div><div className="progress-bar-wrap mt-2" style={{ width: 160 }}><div className="progress-bar-fill" style={{ width: `${pct}%` }}></div></div></div><div style={{ flexShrink: 0, fontSize: 11, color: punched ? 'var(--success)' : 'var(--text3)' }}>{punched ? 'Punched in' : 'Absent'}</div></div>); })}
        </div>
      )}
    </div>
  );
}

// ── PUNCH PAGE ────────────────────────────────────────────────────────────────
function PunchPage({ currentUser, punchLog, setPunchLog, tasks }) {
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [distance, setDistance] = useState(null);
  const [inRange, setInRange] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(new Date());
  const [saving, setSaving] = useState(false);
  const todayKey = new Date().toDateString();
  const todayLog = punchLog.find(p => p.user_id === currentUser.id && p.date === todayKey);
  const isPunchedIn = todayLog?.in_time && !todayLog?.out_time;

  const myActiveTasks = tasks.filter(t => t.assigned_to === currentUser.id && !t.done);
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const topTask = myActiveTasks.filter(t => t.site_lat).sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0];
  const punchLat = topTask ? parseFloat(topTask.site_lat) : OFFICE_LAT;
  const punchLng = topTask ? parseFloat(topTask.site_lng) : OFFICE_LNG;
  const punchLabel = topTask ? (topTask.site_name || 'Site location') : 'Office';
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!isPunchedIn || !todayLog?.in_time_ms) return; const t = setInterval(() => setElapsed(Date.now() - todayLog.in_time_ms), 1000); return () => clearInterval(t); }, [isPunchedIn, todayLog]);
  function getGPS() { setGpsStatus('loading'); if (!navigator.geolocation) { setDistance(60); setInRange(true); setGpsStatus('ok'); return; } navigator.geolocation.getCurrentPosition(pos => { const d = Math.round(getDistance(pos.coords.latitude, pos.coords.longitude, punchLat, punchLng)); setDistance(d); setInRange(d <= GEOFENCE_RADIUS); setGpsStatus('ok'); }, () => { setDistance(60); setInRange(true); setGpsStatus('ok'); }, { timeout: 8000 }); }
  async function doPunchIn() { setSaving(true); const timeStr = now.toTimeString().slice(0, 5); try { const entry = await DB.insert('punch_log', { user_id: currentUser.id, date: todayKey, in_time: timeStr, in_time_ms: Date.now(), out_time: null, hours: null }); setPunchLog(prev => [...prev.filter(p => !(p.user_id === currentUser.id && p.date === todayKey)), entry]); } catch (e) { console.warn(e); } setElapsed(0); setSaving(false); }
  async function doPunchOut() { setSaving(true); const timeStr = now.toTimeString().slice(0, 5); const hours = ((Date.now() - todayLog.in_time_ms) / 3600000).toFixed(2); try { await DB.update('punch_log', todayLog.id, { out_time: timeStr, hours }); setPunchLog(prev => prev.map(p => p.id === todayLog.id ? { ...p, out_time: timeStr, hours } : p)); } catch (e) { console.warn(e); } setSaving(false); }
  const ringClass = isPunchedIn ? 'punched-in' : gpsStatus === 'ok' ? (inRange ? 'in-range' : 'out-range') : '';
  const gpsIcon = isPunchedIn ? 'ti-map-pin-check' : gpsStatus === 'ok' ? (inRange ? 'ti-map-pin' : 'ti-map-pin-off') : 'ti-satellite';
  return (
    <div className="flex-col">
      <div className="card"><div className="card-title"><i className="ti ti-clock"></i> Shift clock</div><div className="clock-display">{now.toTimeString().slice(0, 8)}</div><div className="clock-label">{now.toDateString()}</div>{isPunchedIn && <div style={{ textAlign: 'center', marginTop: 16 }}><div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Time on shift</div><div style={{ fontSize: 28, fontWeight: 600, color: 'var(--success)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtClock(elapsed)}</div></div>}</div>
      <div className="gps-panel"><div className={`gps-ring ${ringClass}`}><i className={`ti ${gpsIcon}`} style={{ fontSize: 34, color: isPunchedIn ? 'var(--accent)' : gpsStatus === 'ok' ? (inRange ? 'var(--success)' : 'var(--danger)') : 'var(--text3)' }}></i></div>{distance !== null && <><div className={`distance-num ${inRange ? 'in-range' : 'out-range'}`}>{distance}m</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>from {punchLabel} · geofence: {GEOFENCE_RADIUS}m</div>{inRange ? <span className="badge badge-green">Within range</span> : <span className="badge badge-red">Out of range</span>}</>}{gpsStatus === 'idle' && <button className="btn btn-secondary" onClick={getGPS}><i className="ti ti-satellite"></i> Get my location</button>}{gpsStatus === 'loading' && <span><span className="spinner"></span> Fetching GPS...</span>}{gpsStatus === 'ok' && !isPunchedIn && <button className="btn btn-success" disabled={!inRange || saving} onClick={doPunchIn} style={{ fontSize: 14, padding: '11px 28px' }}>{saving ? 'Saving...' : 'Punch in'}</button>}{isPunchedIn && <button className="btn btn-danger" onClick={doPunchOut} disabled={saving} style={{ fontSize: 14, padding: '11px 28px' }}>{saving ? 'Saving...' : 'Punch out'}</button>}{todayLog && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>{todayLog.in_time && <div>In: {todayLog.in_time}</div>}{todayLog.out_time && <div>Out: {todayLog.out_time} · Total: {todayLog.hours}h</div>}</div>}</div>
      <div className="card"><div className="card-title"><i className="ti ti-map-pin"></i> Office location</div><div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 2 }}><div>Pinnacle Industrial Park, Vasai East</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>Lat: {OFFICE_LAT}° N · Lng: {OFFICE_LNG}° E · Radius: {GEOFENCE_RADIUS}m</div></div></div>
    </div>
  );
}

// ── TASKS PAGE ────────────────────────────────────────────────────────────────
function TasksPage({ currentUser, tasks, setTasks, users }) {
  const [filter, setFilter] = useState('all');
  const [showAssign, setShowAssign] = useState(false);
  const [showDoneModal, setShowDoneModal] = useState(null);
  const [doneNote, setDoneNote] = useState('');
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', assignedTo: '', deadline: '', site_lat: null, site_lng: null, site_name: '' });
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = currentUser.role !== 'worker';
  const baseTasks = currentUser.role === 'worker' ? tasks.filter(t => t.assigned_to === currentUser.id) : tasks;
  const filtered = baseTasks.filter(t => {
    if (filter === 'pending') return !t.done;
    if (filter === 'done') return t.done;
    if (filter === 'overdue') return !t.done && t.deadline < Date.now();
    if (filter === 'unseen') return !t.seen && !t.done;
    if (filter === 'critical') return t.priority === 'critical';
    return true;
  });
  const [, forceUpdate] = useReducer(x => x + 1, 0);
  useEffect(() => { const t = setInterval(forceUpdate, 1000); return () => clearInterval(t); }, []);
  async function markSeen(task) { try { await DB.update('tasks', task.id, { seen: true }); } catch (e) { } setTasks(ts => ts.map(t => t.id === task.id ? { ...t, seen: true } : t)); }
  async function deleteTask(task) { try { await DB.delete('tasks', task.id); } catch (e) { } setTasks(ts => ts.filter(t => t.id !== task.id)); }
  async function confirmDone() { setSaving(true); try { await DB.update('tasks', showDoneModal.id, { done: true, seen: true, done_note: doneNote }); } catch (e) { } setTasks(ts => ts.map(t => t.id === showDoneModal.id ? { ...t, done: true, seen: true, done_note: doneNote } : t)); setShowDoneModal(null); setDoneNote(''); setSaving(false); }
  async function assignTask() { if (!newTask.title || !newTask.assignedTo || !newTask.deadline) return; setSaving(true); try { const task = await DB.insert('tasks', { title: newTask.title, description: newTask.description, priority: newTask.priority, assigned_to: newTask.assignedTo, assigned_by: currentUser.id, deadline: new Date(newTask.deadline).getTime(), done: false, seen: false, done_note: '', created_at: Date.now(), site_lat: newTask.site_lat, site_lng: newTask.site_lng, site_name: newTask.site_name }); setTasks(ts => [...ts, task]); } catch (e) { console.warn(e); } setNewTask({ title: '', description: '', priority: 'medium', assignedTo: '', deadline: '' }); setShowAssign(false); setSaving(false); }
  const priorityBadge = p => p === 'critical' ? <span className="badge badge-red">Critical</span> : p === 'high' ? <span className="badge badge-orange">High</span> : p === 'medium' ? <span className="badge badge-blue">Medium</span> : <span className="badge badge-gray">Low</span>;
  const getUserName = id => users.find(u => u.id === id)?.name || 'Unknown';
  return (
    <div className="flex-col">
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 8 }}>
        <div className="filter-tabs" style={{ marginBottom: 0 }}>{[['all', 'All'], ['pending', 'Pending'], ['done', 'Done'], ['overdue', 'Overdue'], ['unseen', 'Unseen'], ['critical', 'Critical']].map(([k, l]) => (<button key={k} className={`filter-tab${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>))}</div>
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowAssign(true)}><i className="ti ti-plus" style={{ fontSize: 13 }}></i> Assign task</button>}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '48px 0', fontSize: 13 }}>No tasks in this view.</div>}
      {filtered.map(task => { const isOverdue = !task.done && task.deadline < Date.now(); return (<div key={task.id} className={`task-item priority-${task.priority}${task.done ? ' done' : ''}${!task.seen && !task.done ? ' unseen' : ''}`}><div className="task-main"><div className="task-title flex items-center gap-2">{task.title}{!task.seen && !task.done && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }}></span>}</div><div className="task-desc">{task.description}</div><div className="task-meta">{priorityBadge(task.priority)}<span className={`task-timer${isOverdue ? ' overdue' : ''}`}>{task.done ? 'Completed' : isOverdue ? 'Overdue' : `${formatTime(task.deadline - Date.now())} left`}</span>{isAdmin && <span style={{ fontSize: 11, color: 'var(--text3)' }}>→ {getUserName(task.assigned_to)}</span>}{task.done && task.done_note && <span style={{ fontSize: 11, color: 'var(--success)', fontStyle: 'italic' }}>Note: {task.done_note}</span>}</div></div><div className="task-actions">{!task.seen && !task.done && <button className="btn btn-secondary btn-xs" onClick={() => markSeen(task)}><i className="ti ti-eye" style={{ fontSize: 12 }}></i></button>}{!task.done && <button className="btn btn-success btn-xs" onClick={() => setShowDoneModal(task)}><i className="ti ti-check" style={{ fontSize: 12 }}></i></button>}{isAdmin && <button className="btn btn-danger btn-xs" onClick={() => deleteTask(task)}><i className="ti ti-trash" style={{ fontSize: 12 }}></i></button>}</div></div>); })}
      {showAssign && (<div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAssign(false)}><div className="modal"><div className="modal-title">Assign new task</div><button className="modal-close" onClick={() => setShowAssign(false)}><i className="ti ti-x"></i></button><div className="flex-col" style={{ gap: 14 }}><div className="input-group"><label className="input-label">Task title *</label><input value={newTask.title} onChange={e => setNewTask(d => ({ ...d, title: e.target.value }))} /></div><div className="input-group"><label className="input-label">Description</label><textarea value={newTask.description} onChange={e => setNewTask(d => ({ ...d, description: e.target.value }))} /></div><div className="grid-2" style={{ gap: 10 }}><div className="input-group"><label className="input-label">Priority</label><select value={newTask.priority} onChange={e => setNewTask(d => ({ ...d, priority: e.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div><div className="input-group"><label className="input-label">Assign to *</label><select value={newTask.assignedTo} onChange={e => setNewTask(d => ({ ...d, assignedTo: e.target.value }))}><option value="">Select person</option>{users.filter(u => u.active && u.role !== 'boss').map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></div></div><div className="input-group"><label className="input-label">Deadline *</label><input type="datetime-local" value={newTask.deadline} onChange={e => setNewTask(d => ({ ...d, deadline: e.target.value }))} /></div><div className="input-group"><label className="input-label">Site location (optional)</label><div className="flex gap-2 items-center"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowMapPicker(true)}><i className="ti ti-map-pin"></i> {newTask.site_lat ? 'Change location' : 'Pick on map'}</button>{newTask.site_lat && <span style={{ fontSize: 11, color: 'var(--success)' }}>✅ Location set</span>}</div>{newTask.site_lat && <div style={{ marginTop: 6 }}><input placeholder="Site name (e.g. Block A, Unit 3)" value={newTask.site_name} onChange={e => setNewTask(d => ({ ...d, site_name: e.target.value }))} /></div>}</div>{showMapPicker && <MapPicker onSelect={loc => setNewTask(d => ({ ...d, site_lat: loc.lat, site_lng: loc.lng }))} onClose={() => setShowMapPicker(false)} />}<div className="flex gap-2"><button className="btn btn-primary" onClick={assignTask} disabled={saving}>{saving ? 'Saving...' : 'Assign task'}</button><button className="btn btn-secondary" onClick={() => setShowAssign(false)}>Cancel</button></div></div></div></div>)}
      {showDoneModal && (<div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowDoneModal(null)}><div className="modal" style={{ width: 400 }}><div className="modal-title">Mark as done</div><button className="modal-close" onClick={() => setShowDoneModal(null)}><i className="ti ti-x"></i></button><div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>{showDoneModal.title}</div><div className="input-group"><label className="input-label">Completion note (optional)</label><textarea value={doneNote} onChange={e => setDoneNote(e.target.value)} style={{ minHeight: 60 }} /></div><div className="flex gap-2 mt-2"><button className="btn btn-success" onClick={confirmDone} disabled={saving}>{saving ? 'Saving...' : 'Confirm done'}</button><button className="btn btn-secondary" onClick={() => setShowDoneModal(null)}>Cancel</button></div></div></div>)}
    </div>
  );
}

// ── MAIL COMMAND CENTRE ───────────────────────────────────────────────────────
function EmailAI({ currentUser, users, mailSettings, setMailSettings, mailNotifications, setMailNotifications }) {
  const [draft, setDraft] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ gmailId: mailSettings.gmail_id || '', inchargeId: mailSettings.incharge_id || '' });
  const [activeTab, setActiveTab] = useState('inbox');
  const isBoss = currentUser.role === 'boss';
  const isIncharge = mailSettings.incharge_id === currentUser.id;
  const canAccess = isBoss || isIncharge;
  const isAdmin = currentUser.role !== 'worker';
  const inchargeUser = users.find(u => u.id === mailSettings.incharge_id);
  const myNotifs = mailNotifications.filter(n => n.user_id === currentUser.id && !n.read);

  async function approveSend() {
    if (!draft) return; setSending(true); await new Promise(r => setTimeout(r, 1000));
    try { const n = await DB.insert('mail_notifications', { user_id: currentUser.id, type: 'sent', from_email: '', subject: '', draft, sent_at: Date.now(), read: true }); setMailNotifications(prev => [...prev, n]); } catch (e) { }
    setSending(false); setSentOk(true); setTimeout(() => setSentOk(false), 3000);
  }

  async function saveSettings() {
    try {
      const exists = await DB.getOne('mail_settings', 'id', 'global');
      if (exists) { await DB.update('mail_settings', 'global', { gmail_id: settingsForm.gmailId, incharge_id: settingsForm.inchargeId || null }); }
      else { await DB.insert('mail_settings', { id: 'global', gmail_id: settingsForm.gmailId, incharge_id: settingsForm.inchargeId || null }); }
      setMailSettings({ ...mailSettings, gmail_id: settingsForm.gmailId, incharge_id: settingsForm.inchargeId });
      if (settingsForm.inchargeId && settingsForm.inchargeId !== mailSettings.incharge_id) {
        const n = await DB.insert('mail_notifications', { user_id: settingsForm.inchargeId, type: 'assigned', message: 'You have been assigned as Mail Incharge.', read: false });
        setMailNotifications(prev => [...prev, n]);
      }
    } catch (e) { console.warn(e); }
    setShowSettings(false);
  }

  function markNotifsRead() { setMailNotifications(prev => prev.map(n => n.user_id === currentUser.id ? { ...n, read: true } : n)); }

  if (!canAccess) return (
    <div className="flex-col" style={{ alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}>
      <i className="ti ti-lock" style={{ fontSize: 40, color: 'var(--text3)', marginBottom: 12 }}></i>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Mail Centre</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 6, textAlign: 'center', lineHeight: 1.7 }}>Access restricted to Mail Incharge and Boss only.<br />Contact your manager to be assigned.</div>
    </div>
  );

  return (
    <div className="flex-col">
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 8 }}>
        <div className="filter-tabs" style={{ marginBottom: 0 }}>{[['inbox', 'Inbox'], ['notifications', 'Notifications'], ['drafts', 'Sent drafts']].map(([k, l]) => (<button key={k} className={`filter-tab${activeTab === k ? ' active' : ''}`} onClick={() => { setActiveTab(k); if (k === 'notifications') markNotifsRead(); }}>{l}{k === 'notifications' && myNotifs.length > 0 && <span className="nav-badge" style={{ marginLeft: 6 }}>{myNotifs.length}</span>}</button>))}</div>
        <div className="flex items-center gap-2">{mailSettings.gmail_id && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{mailSettings.gmail_id}</span>}{inchargeUser && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{inchargeUser.name}</span>}{isAdmin && <button className="btn btn-secondary btn-sm" onClick={() => setShowSettings(true)}><i className="ti ti-settings" style={{ fontSize: 13 }}></i> Settings</button>}</div>
      </div>
      {!mailSettings.gmail_id && isAdmin && (<div style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}><i className="ti ti-mail-off" style={{ fontSize: 20, color: 'var(--accent)' }}></i><div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Gmail not connected yet</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Add Gmail ID and assign a Mail Incharge to activate live mail.</div></div><button className="btn btn-primary btn-sm" onClick={() => setShowSettings(true)}>Connect now</button></div>)}
      {activeTab === 'inbox' && (<div className="grid-2" style={{ gap: 16, alignItems: 'start' }}><div className="card"><div className="card-title"><i className="ti ti-inbox"></i> Inbox<span style={{ marginLeft: 'auto', fontSize: 10, color: mailSettings.gmail_id ? 'var(--success)' : 'var(--text3)' }}>{mailSettings.gmail_id ? '● Live' : '● Demo'}</span></div><div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No emails yet. Connect Gmail to see live emails.</div></div>
        <div className="flex-col"><div className="card" style={{ minHeight: 200 }}><div className="card-title"><i className="ti ti-robot"></i> AI analysis</div>{loading && <div style={{ textAlign: 'center', padding: '30px 0' }}><span className="spinner"></span><div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>Analyzing...</div></div>}{!loading && !analysis && <div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>Select an email to analyze</div>}{!loading && analysis && <pre style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{analysis}</pre>}</div>{!loading && draft && (<div className="card" style={{ borderColor: 'rgba(249,115,22,0.25)' }}><div className="card-title"><i className="ti ti-pencil"></i> AI draft reply</div><textarea value={draft} onChange={e => setDraft(e.target.value)} style={{ minHeight: 140, fontSize: 13 }} /><div className="flex gap-2 mt-2"><button className="btn btn-primary" onClick={approveSend} disabled={sending || sentOk}>{sending ? 'Sending...' : sentOk ? '✅ Sent!' : 'Approve & send'}</button><button className="btn btn-secondary" onClick={() => setDraft('')}>Discard</button></div>{sentOk && <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 8 }}>Reply sent from {mailSettings.gmail_id || 'company email'}.</div>}</div>)}</div></div>)}
      {activeTab === 'notifications' && (<div className="card"><div className="card-title"><i className="ti ti-bell"></i> Mail notifications</div>{mailNotifications.filter(n => n.user_id === currentUser.id).length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>No notifications yet.</div>}{mailNotifications.filter(n => n.user_id === currentUser.id).slice().reverse().map(n => (<div key={n.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}><i className={`ti ${n.type === 'sent' ? 'ti-send' : n.type === 'assigned' ? 'ti-user-check' : 'ti-mail'}`} style={{ fontSize: 16, color: 'var(--text3)', flexShrink: 0, marginTop: 1 }}></i><div style={{ flex: 1 }}><div style={{ fontSize: 13, color: n.read ? 'var(--text2)' : 'var(--text)', fontWeight: n.read ? 400 : 500 }}>{n.message || `New mail from ${n.from_email} — "${n.subject}"`}</div><div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{(n.sent_at || n.created_at) ? new Date(n.sent_at || n.created_at).toLocaleString('en-IN') : ''}{!n.read && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>New</span>}</div></div></div>))}</div>)}
      {activeTab === 'drafts' && (<div className="card"><div className="card-title"><i className="ti ti-send"></i> Sent drafts</div>{mailNotifications.filter(n => n.type === 'sent').length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>No drafts sent yet.</div>}{mailNotifications.filter(n => n.type === 'sent').slice().reverse().map(n => (<div key={n.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}><div className="flex justify-between items-center" style={{ marginBottom: 6 }}><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{n.subject || '(No subject)'}</div><span className="badge badge-green">Sent</span></div><div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>To: {n.from_email || 'N/A'} · {n.sent_at ? new Date(n.sent_at).toLocaleString('en-IN') : ''}</div><pre style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap', background: 'var(--surface2)', padding: '10px', borderRadius: 'var(--radius)', maxHeight: 120, overflow: 'auto' }}>{n.draft}</pre></div>))}</div>)}
      {showSettings && (<div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSettings(false)}><div className="modal"><div className="modal-title">Mail settings</div><button className="modal-close" onClick={() => setShowSettings(false)}><i className="ti ti-x"></i></button><div className="flex-col" style={{ gap: 16 }}><div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: 'var(--radius)', padding: '12px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>Add Gmail ID below. Full live sync activated when Gmail OAuth is connected.</div><div className="input-group"><label className="input-label">Company Gmail ID</label><input value={settingsForm.gmailId} onChange={e => setSettingsForm(f => ({ ...f, gmailId: e.target.value }))} placeholder="operations@yourcompany.com" /></div><div className="input-group"><label className="input-label">Mail incharge</label><select value={settingsForm.inchargeId} onChange={e => setSettingsForm(f => ({ ...f, inchargeId: e.target.value }))}><option value="">— Select person —</option>{users.filter(u => u.active).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>This person + Boss will be notified for every mail.</div></div><div className="flex gap-2"><button className="btn btn-primary" onClick={saveSettings}>Save settings</button><button className="btn btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button></div></div></div></div>)}
    </div>
  );
}

// ── AI CHAT ───────────────────────────────────────────────────────────────────
function AiChat({ currentUser, tasks, users }) {
  const [messages, setMessages] = useState([{ role: 'ai', text: "Hello! I'm your StrongSteel AI assistant. Ask me anything about tasks, operations, or safety." }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);
  const quickPrompts = currentUser.role === 'worker' ? ['What are my pending tasks?', "What's overdue?", 'Help me write an incident report', 'Safety checklist'] : ['Summarize team performance', 'Which tasks are critical?', 'Draft a shift handover note', 'Suggest priorities for today'];
  async function send(text) {
    const q = text || input.trim(); if (!q) return; setInput('');
    const newMsgs = [...messages, { role: 'user', text: q }]; setMessages(newMsgs); setLoading(true);
    const history = newMsgs.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
    const myT = currentUser.role === 'worker' ? tasks.filter(t => t.assigned_to === currentUser.id) : tasks;
    const sys = `You are StrongSteel Workbase AI assistant for an industrial steel plant. User: ${currentUser.name} (${currentUser.role}). Their tasks: ${myT.slice(0, 8).map(t => `${t.title}(${t.priority},${t.done ? 'done' : 'pending'})`).join('; ')}. Be concise and professional.`;
    try { const resp = await callAI(history, sys); setMessages(m => [...m, { role: 'ai', text: resp }]); }
    catch (e) { setMessages(m => [...m, { role: 'ai', text: 'Error: ' + e.message }]); }
    setLoading(false);
  }
  return (
    <div className="card" style={{ height: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card-title"><i className="ti ti-robot"></i> AI assistant</div>
      <div className="quick-prompts">{quickPrompts.map((p, i) => <button key={i} className="quick-prompt-btn" onClick={() => send(p)}>{p}</button>)}</div>
      <div className="chat-messages">
        {messages.map((m, i) => (<div key={i} className={`chat-bubble ${m.role}`}>{m.role === 'ai' && <div className="sender">StrongSteel AI</div>}<div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div></div>))}
        {loading && <div className="chat-bubble ai"><div className="sender">StrongSteel AI</div><span className="spinner"></span> Thinking...</div>}
        <div ref={endRef}></div>
      </div>
      <div className="chat-input-row"><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} placeholder="Ask anything..." style={{ flex: 1 }} /><button className="btn btn-primary" onClick={() => send()} disabled={loading || !input.trim()}>Send</button></div>
    </div>
  );
}

// ── MANAGE USERS ──────────────────────────────────────────────────────────────
function ManageUsers({ currentUser, users, setUsers }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', designation: '', role: 'worker', mobile: '', whatsapp: '', sameWA: true, notify: true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function toggleActive(user) { try { await DB.update('users', user.id, { active: !user.active }); setUsers(us => us.map(u => u.id === user.id ? { ...u, active: !u.active } : u)); } catch (e) { } }
  async function addUser() {
    setError(''); if (!newUser.username || !newUser.password || !newUser.name || !newUser.mobile) { setError('Fill all required fields.'); return; }
    if (users.find(u => u.username === newUser.username)) { setError('Username taken.'); return; }
    setSaving(true);
    const initials = newUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#f97316', '#38bdf8', '#22c55e', '#a78bfa', '#fb923c', '#fcd34d'];
    try { const u = await DB.insert('users', { username: newUser.username, password: newUser.password, name: newUser.name, role: newUser.role, designation: newUser.designation, mobile: newUser.mobile, whatsapp: newUser.sameWA ? newUser.mobile : newUser.whatsapp, notify: newUser.notify, active: true, avatar: initials, color: colors[users.length % colors.length] }); setUsers(us => [...us, u]); } catch (e) { setError('Error: ' + e.message); }
    setNewUser({ username: '', password: '', name: '', designation: '', role: 'worker', mobile: '', whatsapp: '', sameWA: true, notify: true }); setShowAdd(false); setSaving(false);
  }
  const roleBadge = r => r === 'boss' ? <span className="badge badge-orange">Boss</span> : r === 'manager' ? <span className="badge badge-blue">Manager</span> : <span className="badge badge-green">Worker</span>;
  return (
    <div className="flex-col">
      <div className="flex justify-between items-center"><div style={{ fontSize: 12, color: 'var(--text3)' }}>{users.length} total · {users.filter(u => u.active).length} active</div><button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}><i className="ti ti-plus" style={{ fontSize: 13 }}></i> Add user</button></div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}><table className="user-table"><thead><tr><th>User</th><th>Role</th><th>Mobile</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(u => (<tr key={u.id}><td><div className="flex items-center gap-2"><div className="member-avatar" style={{ background: u.color, color: '#000', width: 28, height: 28, fontSize: 11 }}>{u.avatar}</div><div><div style={{ fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.designation || u.username}</div></div></div></td><td>{roleBadge(u.role)}</td><td style={{ fontSize: 12, color: 'var(--text2)' }}>{u.mobile}</td><td><span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>{u.active ? 'Active' : 'Deactivated'}</span></td><td>{u.id !== currentUser.id && <button className={`btn btn-xs ${u.active ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}</td></tr>))}</tbody></table></div>
      {showAdd && (<div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}><div className="modal"><div className="modal-title">Add new user</div><button className="modal-close" onClick={() => setShowAdd(false)}><i className="ti ti-x"></i></button><div className="flex-col" style={{ gap: 12 }}><div className="grid-2" style={{ gap: 10 }}><div className="input-group"><label className="input-label">Full name *</label><input value={newUser.name} onChange={e => setNewUser(d => ({ ...d, name: e.target.value }))} /></div><div className="input-group"><label className="input-label">Username *</label><input value={newUser.username} onChange={e => setNewUser(d => ({ ...d, username: e.target.value.toLowerCase() }))} /></div></div><div className="grid-2" style={{ gap: 10 }}><div className="input-group"><label className="input-label">Password *</label><input type="password" value={newUser.password} onChange={e => setNewUser(d => ({ ...d, password: e.target.value }))} /></div><div className="input-group"><label className="input-label">Role</label><select value={newUser.role} onChange={e => setNewUser(d => ({ ...d, role: e.target.value }))}><option value="worker">Worker</option><option value="manager">Manager</option><option value="boss">Boss</option></select></div></div><div className="input-group"><label className="input-label">Designation</label><input value={newUser.designation} onChange={e => setNewUser(d => ({ ...d, designation: e.target.value }))} /></div><div className="input-group"><label className="input-label">Mobile *</label><input value={newUser.mobile} onChange={e => setNewUser(d => ({ ...d, mobile: e.target.value }))} /></div><label className="checkbox-row"><input type="checkbox" checked={newUser.sameWA} onChange={e => setNewUser(d => ({ ...d, sameWA: e.target.checked }))} /> WhatsApp same as mobile</label>{!newUser.sameWA && <div className="input-group"><label className="input-label">WhatsApp</label><input value={newUser.whatsapp} onChange={e => setNewUser(d => ({ ...d, whatsapp: e.target.value }))} /></div>}<label className="checkbox-row"><input type="checkbox" checked={newUser.notify} onChange={e => setNewUser(d => ({ ...d, notify: e.target.checked }))} /> Enable notifications</label>{error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}<div className="flex gap-2"><button className="btn btn-primary" onClick={addUser} disabled={saving}>{saving ? 'Saving...' : 'Add user'}</button><button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button></div></div></div></div>)}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [ready, setReady] = useState(false);
  const [dbMode, setDbMode] = useState('loading');
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogout, setShowLogout] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [punchLog, setPunchLog] = useState([]);
  const [mailSettings, setMailSettings] = useState({ gmail_id: '', incharge_id: '' });
  const [mailNotifications, setMailNotifications] = useState([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [u, t, p, mn] = await Promise.all([DB.getAll('users'), DB.getAll('tasks'), DB.getAll('punch_log'), DB.getAll('mail_notifications')]);
      const ms = await DB.getOne('mail_settings', 'id', 'global');
      setUsers(u); setTasks(t); setPunchLog(p); setMailNotifications(mn);
      if (ms) setMailSettings(ms);
      DB.subscribe('users', data => setUsers(data));
      DB.subscribe('tasks', data => setTasks(data));
      DB.subscribe('punch_log', data => setPunchLog(data));
      DB.subscribe('mail_notifications', data => setMailNotifications(data));
      setDbMode('supabase'); setReady(true);
    } catch (e) { console.warn('Supabase error:', e.message); setDbMode('error'); setReady(true); }
  }

  if (!ready) return <LoadingScreen msg="Connecting to Supabase..." />;
  if (dbMode === 'error') return (
    <div className="loading-screen">
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
      <div className="loading-logo">Connection Error</div>
      <div className="loading-sub" style={{ textAlign: 'center', maxWidth: 300 }}>Could not connect to database. Check your Supabase config and try again.</div>
      <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={loadData}>Retry</button>
    </div>
  );

  const unseenTasks = currentUser ? (currentUser.role === 'worker' ? tasks.filter(t => t.assigned_to === currentUser.id && !t.seen && !t.done) : tasks.filter(t => !t.seen && !t.done)) : [];
  if (!currentUser) return <AuthPage onLogin={setCurrentUser} users={users} setUsers={setUsers} />;

  const isAdmin = currentUser.role !== 'worker';
  const navItems = [
    { id: 'dashboard', icon: 'ti-layout-dashboard', label: 'Dashboard', show: true },
    { id: 'punch', icon: 'ti-clock', label: 'Punch clock', show: currentUser.role === 'worker' },
    { id: 'tasks', icon: 'ti-checklist', label: 'Tasks', show: true, badge: unseenTasks.length },
    { id: 'email', icon: 'ti-mail', label: 'Mail centre', show: true, badge: mailNotifications.filter(n => n.user_id === currentUser.id && !n.read).length },
    { id: 'chat', icon: 'ti-message-2', label: 'AI assistant', show: true },
    { id: 'users', icon: 'ti-users', label: 'Manage users', show: isAdmin },
  ].filter(n => n.show);

  const pageTitle = { dashboard: 'Dashboard', punch: 'Punch clock', tasks: 'Tasks', email: 'Mail centre', chat: 'AI assistant', users: 'Manage users' };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo"><div className="logo-wordmark"><span>Strong</span>Steel</div><div className="logo-sub">Workbase</div></div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">Navigation</div>
          {navItems.map(n => (<button key={n.id} className={`nav-item${page === n.id ? ' active' : ''}`} onClick={() => setPage(n.id)}><i className={`ti ${n.icon}`}></i><span className="nav-label">{n.label}</span>{n.badge > 0 && <span className="nav-badge">{n.badge}</span>}</button>))}
        </nav>
        <div className="sidebar-user">
          <div className="user-avatar" style={{ background: currentUser.color, color: '#000' }}>{currentUser.avatar}</div>
          <div className="user-info"><div className="user-name">{currentUser.name.split(' ')[0]}</div><div className="user-role">{currentUser.role}</div></div>
          <button className="logout-btn" onClick={() => setShowLogout(true)} title="Sign out"><i className="ti ti-logout" style={{ fontSize: 16 }}></i></button>
        </div>
      </aside>

      {showLogout && (<div className="modal-overlay" onClick={() => setShowLogout(false)}><div className="modal" style={{ width: 360, textAlign: 'center' }} onClick={e => e.stopPropagation()}><div style={{ marginBottom: 12 }}><i className="ti ti-logout" style={{ fontSize: 32, color: 'var(--text3)' }}></i></div><div className="modal-title" style={{ justifyContent: 'center', display: 'flex', marginBottom: 8 }}>Sign out?</div><div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 24 }}>Signed in as <strong style={{ color: 'var(--text)' }}>{currentUser.name}</strong></div><div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}><button className="btn btn-secondary" onClick={() => setShowLogout(false)}>Cancel</button><button className="btn btn-danger" onClick={() => { setCurrentUser(null); setShowLogout(false); }}>Sign out</button></div></div></div>)}

      <div className="main-area">
        <div className="topbar">
          <div className="topbar-title">{pageTitle[page]}</div>
          <div className="topbar-right">
            <div className="topbar-live"><div className="live-dot" style={{ background: dbMode === 'supabase' ? 'var(--success)' : '#f59e0b' }}></div>{dbMode === 'supabase' ? 'Live · Supabase' : 'Connecting...'}</div>
            <div className="topbar-date">{new Date().toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div className="page-content">
          {page === 'dashboard' && <Dashboard currentUser={currentUser} tasks={tasks} users={users} punchLog={punchLog} />}
          {page === 'punch' && <PunchPage currentUser={currentUser} punchLog={punchLog} setPunchLog={setPunchLog} tasks={tasks} />}
          {page === 'tasks' && <TasksPage currentUser={currentUser} tasks={tasks} setTasks={setTasks} users={users} />}
          {page === 'email' && <EmailAI currentUser={currentUser} users={users} mailSettings={mailSettings} setMailSettings={setMailSettings} mailNotifications={mailNotifications} setMailNotifications={setMailNotifications} />}
          {page === 'chat' && <AiChat currentUser={currentUser} tasks={tasks} users={users} />}
          {page === 'users' && isAdmin && <ManageUsers currentUser={currentUser} users={users} setUsers={setUsers} />}
        </div>
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<App />);