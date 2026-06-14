import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react'
import { io } from 'socket.io-client'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners, MeasuringStrategy } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'

// ─── socket ──────────────────────────────────────────────────────────────────
let _sock = null
const getSock = () => { if (!_sock) _sock = io({ transports: ['websocket', 'polling'] }); return _sock }

// ─── constants ───────────────────────────────────────────────────────────────
const PRI = {
  urgent: { label: 'Urgent', hex: '#b91c1c', light: '#fef2f2', dark: '#3b0d0d' },
  high: { label: 'High', hex: '#c2410c', light: '#fff7ed', dark: '#3b1a08' },
  medium: { label: 'Medium', hex: '#92400e', light: '#fffbeb', dark: '#2e1f00' },
  low: { label: 'Low', hex: '#1e40af', light: '#eff6ff', dark: '#0d1f3b' },
  none: { label: 'None', hex: '#78716c', light: '#fafaf9', dark: '#1c1917' },
}
const LABELS = [
  { name: 'Feature', l: ['#dbeafe', '#1e40af'], d: ['#1e3a5f', '#93c5fd'] },
  { name: 'Bug', l: ['#dcfce7', '#166534'], d: ['#052e16', '#86efac'] },
  { name: 'Design', l: ['#fce7f3', '#9d174d'], d: ['#4a0e2f', '#f9a8d4'] },
  { name: 'Research', l: ['#f5f3ff', '#5b21b6'], d: ['#2e1065', '#c4b5fd'] },
  { name: 'Backend', l: ['#fff7ed', '#9a3412'], d: ['#431407', '#fdba74'] },
  { name: 'Frontend', l: ['#ecfeff', '#155e75'], d: ['#042f2e', '#67e8f9'] },
]
const LOG_C = { TASK: '#b45309', COLUMN: '#0369a1', MEMBER: '#15803d', COMMENT: '#7c3aed', BOARD: '#be185d' }

// ─── utils ───────────────────────────────────────────────────────────────────
const between = (p, n) => { if (p == null && n == null) return 1000; if (p == null) return n / 2; if (n == null) return p + 1000; return (p + n) / 2 }
const relTime = iso => { const d = Date.now() - new Date(iso), s = Math.floor(d / 1000); if (s < 60) return 'just now'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago` }
const fmtTs = iso => new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const monoTs = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}` }

const fmtAction = (action, meta = {}) => {
  const m = meta
  switch (action) {
    case 'MEMBER_JOINED': return `joined as ${m.role || 'member'}`
    case 'MEMBER_LEFT': return `left (${Math.round((m.sessionDuration || 0) / 1000)}s)`
    case 'TASK_CREATED': return `created in "${m.columnName || '?'}"`
    case 'TASK_MOVED': return `moved ${m.fromColumn} → ${m.toColumn}`
    case 'TASK_DELETED': return `deleted task`
    case 'TASK_DUPLICATED': return `duplicated "${m.sourceTitle}"`
    case 'TASK_ARCHIVED': return `archived`
    case 'TASK_UNARCHIVED': return `unarchived`
    case 'TASK_PINNED': return `pinned`
    case 'TASK_UNPINNED': return `unpinned`
    case 'TASK_PRIORITY_CHANGED': return `priority changed`
    case 'TASK_RENAMED': return `renamed`
    case 'TASK_DUE_DATE_SET': return `due date updated`
    case 'TASK_ASSIGNEES_CHANGED': return `assignees updated`
    case 'TASK_CHECKLIST_UPDATED': return `checklist updated`
    case 'TASK_UPDATED': return `updated`
    case 'COMMENT_ADDED': return `commented on "${m.taskTitle || 'task'}"`
    case 'COMMENT_DELETED': return `deleted a comment`
    case 'COLUMN_CREATED': return `created column`
    case 'COLUMN_RENAMED': return `renamed column`
    case 'COLUMN_DELETED': return `deleted column`
    case 'COLUMN_WIP_CHANGED': return `WIP limit set`
    case 'BOARD_RENAMED': return `renamed board`
    default: return action.toLowerCase().replace(/_/g, ' ')
  }
}

// ─── theme ───────────────────────────────────────────────────────────────────
function mkTheme(dark) {
  if (dark) return {
    bg: '#0f0f0f', canvas: '#161616', surface: '#1c1c1c', surface2: '#242424',
    border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.12)',
    text: '#f0f0f0', text2: '#8a8a8a', text3: '#4a4a4a',
    accent: '#e8e0d4', accentBg: 'rgba(232,224,212,0.08)',
    shadow: 'rgba(0,0,0,0.6)', shadow2: 'rgba(0,0,0,0.85)',
    header: '#0f0f0f', input: '#0a0a0a', divider: 'rgba(255,255,255,0.05)',
    danger: '#ef4444', dangerBg: 'rgba(239,68,68,0.1)', success: '#22c55e',
    card: 'rgba(22,22,22,0.98)', col: 'rgba(18,18,18,0.7)',
    // legacy compat
    brown: '#c9a96e', brownBg: 'rgba(201,169,110,0.1)', brownText: '#e8d5b0',
  }
  return {
    bg: '#fafaf8', canvas: '#f2f0ec', surface: '#ffffff', surface2: '#f7f6f3',
    border: 'rgba(0,0,0,0.06)', border2: 'rgba(0,0,0,0.11)',
    text: '#111111', text2: '#6b6b6b', text3: '#aaaaaa',
    accent: '#111111', accentBg: 'rgba(17,17,17,0.05)',
    shadow: 'rgba(0,0,0,0.06)', shadow2: 'rgba(0,0,0,0.16)',
    header: '#ffffff', input: '#f7f6f3', divider: 'rgba(0,0,0,0.05)',
    danger: '#dc2626', dangerBg: 'rgba(220,38,38,0.06)', success: '#16a34a',
    card: '#ffffff', col: 'rgba(242,240,236,0.8)',
    brown: '#111111', brownBg: 'rgba(17,17,17,0.05)', brownText: '#111111',
  }
}
const ThemeCtx = createContext({})
function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => localStorage.getItem('kp6-theme') === 'dark' || (!localStorage.getItem('kp6-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches))
  const toggle = useCallback(() => setDark(d => { const n = !d; localStorage.setItem('kp6-theme', n ? 'dark' : 'light'); return n }), [])
  const t = useMemo(() => mkTheme(dark), [dark])
  useEffect(() => {
    document.body.style.background = t.bg
    document.body.style.margin = '0'
    document.documentElement.style.setProperty('--sb', dark ? '#2a2a2a' : '#d0cfc9')
  }, [dark, t])
  return <ThemeCtx.Provider value={{ dark, toggle, t }}>{children}</ThemeCtx.Provider>
}
const useTheme = () => useContext(ThemeCtx)

// ─── global styles injected once ─────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--sb,#d0cfc9);border-radius:99px}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleUp{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes slideIn{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes slideUp{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes dropGlow{0%,100%{opacity:.7}50%{opacity:1}}
@keyframes lift{from{transform:rotate(0) scale(1)}to{transform:rotate(2.5deg) scale(1.04)}}
@keyframes toastIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes cardFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`
function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = GLOBAL_CSS
    document.head.appendChild(el)
    return () => document.head.removeChild(el)
  }, [])
  return null
}

// ─── icons ───────────────────────────────────────────────────────────────────
const Svg = (paths, opts = {}) => (props) => {
  const { w = 1.75, c = [], l = [], pl = [], r = [] } = opts
  const { style: sx, ...rest } = props
  return <svg {...rest} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', flexShrink: 0, ...(sx || {}) }}>
    {[].concat(paths || []).map((d, i) => <path key={i} d={d} />)}
    {c.map((x, i) => <circle key={i} cx={x[0]} cy={x[1]} r={x[2]} />)}
    {l.map((x, i) => <line key={i} x1={x[0]} y1={x[1]} x2={x[2]} y2={x[3]} />)}
    {pl.map((x, i) => <polyline key={i} points={x} />)}
    {r.map((x, i) => <rect key={i} x={x[0]} y={x[1]} width={x[2]} height={x[3]} rx={x[4] || 0} />)}
  </svg>
}
const Ic = {
  Plus: Svg('M12 5v14M5 12h14'),
  X: Svg('M18 6L6 18M6 6l12 12'),
  Check: Svg('M20 6L9 17l-5-5', { w: 2.5 }),
  Search: Svg('M21 21l-4.35-4.35', { c: [[11, 11, 8]] }),
  Moon: Svg('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'),
  Sun: Svg(['M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42'], { c: [[12, 12, 5]] }),
  Grip: Svg('', { c: [[9, 5, 1.1], [9, 12, 1.1], [9, 19, 1.1], [15, 5, 1.1], [15, 12, 1.1], [15, 19, 1.1]], w: 0 }),
  Pen: Svg(['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z']),
  Trash: Svg(['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6']),
  Flag: Svg(['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7']),
  Cal: Svg(['M3 4h18v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4z', 'M16 2v4', 'M8 2v4', 'M3 10h18']),
  Send: Svg(['M22 2L11 13', 'M22 2L15 22l-4-9-9-4z']),
  Link: Svg(['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71']),
  Copy: Svg(['M8 8v13h13V8H8z', 'M15 8V3H3v13h5']),
  Users: Svg(['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], { c: [[9, 7, 4]] }),
  Pin: Svg(['M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z'], { c: [[12, 10, 3]] }),
  Arc: Svg(['M21 8v13H3V8', 'M23 3H1v5h22V3z', 'M10 12h4']),
  Dup: Svg(['M8 8v13h13V8H8z', 'M15 8V3H3v13h5']),
  Chev: Svg('M6 9l6 6 6-6'),
  ChevR: Svg('M9 18l6-6-6-6'),
  Term: Svg(['M4 17l6-6-6-6', 'M12 19h8']),
  Layers: Svg(['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5']),
  Zap: Svg('M13 2L3 14h9l-1 8 10-12h-9l1-8z', { w: 2 }),
  Slash: Svg('', { c: [[12, 12, 10]], l: [[4.93, 4.93, 19.07, 19.07]] }),
  Info: Svg(['M12 16v-4', 'M12 8h.01'], { c: [[12, 12, 10]] }),
  Cmd: Svg('M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z'),
  Clock: Svg('', { c: [[12, 12, 10]], l: [[12, 6, 12, 12], [12, 12, 16, 14]] }),
  Cog: Svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
  Bar: Svg(['M18 20V10', 'M12 20V4', 'M6 20v-6'], { l: [[2, 20, 22, 20]] }),
  Arrow: Svg('M5 12h14M12 5l7 7-7 7'),
  Sparkle: Svg(['M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z'], { w: 1.5 }),
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function Av({ name = '?', color = '#555', size = 28, sx = {} }) {
  const init = name.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
  return <div style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#fff', fontWeight: 600, fontSize: size * .36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, userSelect: 'none', fontFamily: "'Inter',sans-serif", letterSpacing: '-.02em', ...sx }}>{init}</div>
}

function Tip({ label, children, pos = 'bottom' }) {
  const [v, setV] = useState(false)
  const p2 = {
    top: { bottom: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)' },
    right: { left: 'calc(100% + 7px)', top: '50%', transform: 'translateY(-50%)' },
    left: { right: 'calc(100% + 7px)', top: '50%', transform: 'translateY(-50%)' },
  }[pos] || {}
  return <div style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setV(true)} onMouseLeave={() => setV(false)}>
    {children}
    {v && label && <div style={{
      position: 'absolute', ...p2,
      background: '#111', color: '#f0f0f0', fontSize: 11, fontWeight: 500,
      padding: '4px 9px', borderRadius: 5, whiteSpace: 'nowrap',
      zIndex: 99999,  // ← was 9999, needs to be higher than modal
      pointerEvents: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,.4)',
      fontFamily: "'Inter',sans-serif", letterSpacing: '.01em'
    }}>{label}</div>}
  </div>
}

const ToastCtx = createContext(() => { })
function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const { t } = useTheme()
  const show = useCallback((msg, type = 'info') => { const id = Date.now(); setItems(p => [...p, { id, msg, type }]); setTimeout(() => setItems(p => p.filter(x => x.id !== id)), 4200) }, [])
  return <ToastCtx.Provider value={show}>
    {children}
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => {
        const c = { info: t.accent, success: t.success, warn: '#d97706', error: t.danger }[item.type] || t.accent
        return <div key={item.id} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '11px 16px', fontSize: 13, fontWeight: 500, color: t.text, boxShadow: `0 8px 32px ${t.shadow2}`, display: 'flex', alignItems: 'center', gap: 10, minWidth: 250, maxWidth: 340, animation: 'toastIn .28s cubic-bezier(.16,1,.3,1)', fontFamily: "'Inter',sans-serif" }}>
          {item.msg}
        </div>
      })}
    </div>
  </ToastCtx.Provider>
}
const useToast = () => useContext(ToastCtx)

function Modal({ children, onClose, width = 720 }) {
  useEffect(() => { const h = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 56, paddingBottom: 32, overflowY: 'auto' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div style={{ width: '100%', maxWidth: width, margin: '0 16px', animation: 'scaleUp .18s cubic-bezier(.16,1,.3,1)' }} onClick={e => e.stopPropagation()}>{children}</div>
  </div>
}

function Btn({ children, onClick, primary, danger, ghost, small, disabled, sx = {}, Icon }) {
  const { t, dark } = useTheme()
  const base = {
    padding: small ? '5px 12px' : '8px 16px', borderRadius: 6,
    border: primary ? 'none' : danger ? `1px solid ${t.danger}30` : ghost ? 'none' : `1px solid ${t.border2}`,
    background: primary ? t.text : danger ? t.dangerBg : ghost ? 'transparent' : t.surface2,
    color: primary ? (dark ? '#000' : '#fff') : danger ? t.danger : t.text2,
    fontWeight: 500, fontSize: small ? 11.5 : 13, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'Inter',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6,
    transition: 'all .15s', opacity: disabled ? .4 : 1, letterSpacing: '-.01em', ...sx
  }
  return <button style={base} onClick={onClick} disabled={disabled}
    onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(.97)')}
    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
    {Icon && <Icon width={13} height={13} />}{children}
  </button>
}

function Mi({ Icon, label, onClick, danger, t }) {
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', background: 'none', border: 'none', padding: '7px 12px', borderRadius: 6, color: danger ? t.danger : t.text2, fontSize: 13, cursor: 'pointer', fontFamily: "'Inter',sans-serif", transition: 'background .1s', textAlign: 'left', letterSpacing: '-.01em' }}
    onMouseEnter={e => e.currentTarget.style.background = danger ? t.dangerBg : t.surface2}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
    <Icon width={13} height={13} />{label}
  </button>
}

// ─── useInView hook ───────────────────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, visible]
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
// Mini Kanban demo data for hero
const DEMO_COLS = [
  {
    id: 'todo', name: 'To Do', color: '#6b7280', tasks: [
      { id: 'd1', title: 'Design token audit', label: 'Design', labelC: ['#fce7f3', '#9d174d'], pri: 'high', priC: '#c2410c', av: 'SR', avC: '#7c3aed' },
      { id: 'd2', title: 'Write onboarding copy', label: 'Feature', labelC: ['#dbeafe', '#1e40af'], pri: 'medium', priC: '#92400e', av: 'IK', avC: '#0369a1' },
    ]
  },
  {
    id: 'prog', name: 'In Progress', color: '#2563eb', tasks: [
      { id: 'd3', title: 'WebSocket latency pass', label: 'Backend', labelC: ['#fff7ed', '#9a3412'], pri: 'urgent', priC: '#b91c1c', av: 'IK', avC: '#0369a1' },
      { id: 'd4', title: 'Drag-and-drop refactor', label: 'Frontend', labelC: ['#ecfeff', '#155e75'], pri: 'high', priC: '#c2410c', av: 'MR', avC: '#be185d' },
    ]
  },
  {
    id: 'rev', name: 'Review', color: '#7c3aed', tasks: [
      { id: 'd5', title: 'Auth flow redesign', label: 'Design', labelC: ['#fce7f3', '#9d174d'], pri: 'high', priC: '#c2410c', av: 'SR', avC: '#7c3aed' },
    ]
  },
  {
    id: 'done', name: 'Done', color: '#16a34a', tasks: [
      { id: 'd6', title: 'CI/CD pipeline setup', label: 'Feature', labelC: ['#dbeafe', '#1e40af'], pri: 'none', priC: '#78716c', av: 'IK', avC: '#0369a1' },
      { id: 'd7', title: 'Fractional indexing', label: 'Backend', labelC: ['#fff7ed', '#9a3412'], pri: 'none', priC: '#78716c', av: 'MR', avC: '#be185d' },
    ]
  },
]

function MiniKanban() {
  const { t, dark } = useTheme()
  const [cols, setCols] = useState(DEMO_COLS)
  const [dragging, setDragging] = useState(null) // {cardId, srcColId}
  const [overCol, setOverCol] = useState(null)
  const ghostRef = useRef()

  const handleMouseDown = (e, cardId, colId) => {
    e.preventDefault()
    setDragging({ cardId, colId })
    if (ghostRef.current) {
      const card = e.currentTarget.closest('[data-card]')
      ghostRef.current.innerHTML = card ? card.innerHTML : ''
      ghostRef.current.style.width = card ? card.offsetWidth + 'px' : '200px'
    }
  }

  useEffect(() => {
    if (!dragging) return
    const move = e => {
      if (!ghostRef.current) return
      const gw = ghostRef.current.offsetWidth
      ghostRef.current.style.left = (e.clientX - gw / 2) + 'px'
      ghostRef.current.style.top = (e.clientY - 18) + 'px'
      ghostRef.current.classList.add('active')
    }
    const up = e => {
      ghostRef.current && ghostRef.current.classList.remove('active')
      if (overCol && overCol !== dragging.colId) {
        setCols(prev => {
          const next = prev.map(c => ({ ...c, tasks: [...c.tasks] }))
          const src = next.find(c => c.id === dragging.colId)
          const tgt = next.find(c => c.id === overCol)
          if (!src || !tgt) return prev
          const idx = src.tasks.findIndex(t => t.id === dragging.cardId)
          if (idx === -1) return prev
          const [card] = src.tasks.splice(idx, 1)
          tgt.tasks.push(card)
          return next
        })
      }
      setDragging(null)
      setOverCol(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, overCol])

  const priColors = { urgent: '#b91c1c', high: '#c2410c', medium: '#92400e', low: '#1e40af', none: '#9ca3af' }

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* Ghost element */}
      <div ref={ghostRef} style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', opacity: 0, background: t.card, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '10px 12px', boxShadow: `0 20px 60px ${t.shadow2}`, transform: 'rotate(2deg) scale(1.03)', transition: 'opacity .1s', minHeight: 60 }}
        className="drag-ghost" />
      <style>{`.drag-ghost.active{opacity:1!important}`}</style>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '16px', background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
        {cols.map(col => (
          <div key={col.id}
            onMouseEnter={() => dragging && setOverCol(col.id)}
            onMouseLeave={() => dragging && setOverCol(null)}
            style={{
              borderRadius: 8, padding: '10px',
              background: overCol === col.id && dragging ? `${col.color}10` : dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
              border: `1.5px solid ${overCol === col.id && dragging ? col.color + '50' : t.border}`,
              transition: 'all .2s',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, fontWeight: 600, color: t.text, textTransform: 'uppercase', letterSpacing: '.05em', flex: 1 }}>{col.name}</span>
              <span style={{ fontSize: 9, color: t.text3, fontFamily: "'DM Mono',monospace" }}>{col.tasks.length}</span>
            </div>
            <div style={{ minHeight: 40 }}>
              {col.tasks.map(task => (
                <div key={task.id} data-card
                  onMouseDown={e => handleMouseDown(e, task.id, col.id)}
                  style={{
                    background: dragging?.cardId === task.id ? 'transparent' : t.card,
                    border: `1px solid ${dragging?.cardId === task.id ? 'transparent' : t.border}`,
                    borderLeft: `2px solid ${priColors[task.pri] || '#9ca3af'}`,
                    borderRadius: 6, padding: '8px 10px', marginBottom: 5,
                    cursor: 'grab',
                    opacity: dragging?.cardId === task.id ? .3 : 1,
                    transition: 'opacity .15s,box-shadow .15s',
                    boxShadow: `0 1px 3px ${t.shadow}`,
                  }}
                  onMouseEnter={e => { if (dragging?.cardId !== task.id) e.currentTarget.style.boxShadow = `0 3px 10px ${t.shadow}` }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 1px 3px ${t.shadow}` }}>
                  <span style={{ fontSize: 8.5, fontWeight: 600, padding: '1px 5px', borderRadius: 99, background: task.labelC[0], color: task.labelC[1], display: 'inline-block', marginBottom: 4 }}>{task.label}</span>
                  <p style={{ fontSize: 11, fontWeight: 500, color: t.text, lineHeight: 1.35, marginBottom: 5 }}>{task.title}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 8.5, fontWeight: 600, color: priColors[task.pri], opacity: .85, textTransform: 'capitalize' }}>{task.pri}</span>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: task.avC, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6.5, fontWeight: 700, color: '#fff' }}>{task.av}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnimatedCounter({ target, duration = 1200 }) {
  const [count, setCount] = useState(0)
  const [ref, visible] = useInView(0.5)
  useEffect(() => {
    if (!visible) return
    let start = null
    const step = ts => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setCount(Math.floor(ease * target))
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [visible, target, duration])
  return <span ref={ref}>{count.toLocaleString()}</span>
}

function LandingPage({ onGetStarted }) {
  const { dark, toggle, t } = useTheme()
  const [scrollY, setScrollY] = useState(0)
  const [heroRef, heroVisible] = useInView(0)
  const [featRef, featVisible] = useInView(0.1)
  const [howRef, howVisible] = useInView(0.1)
  const [statsRef, statsVisible] = useInView(0.1)

  useEffect(() => {
    const h = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  const scrolled = scrollY > 30

  const features = [
    { Icon: Ic.Zap, title: 'Sub-50ms sync', desc: 'Every move, comment, and status change propagates across all connected clients in real time — no polling, no page refreshes.' },
    { Icon: Ic.Users, title: 'Live presence', desc: 'See cursor positions, active task views, and typing indicators. Your team is visible, not invisible.' },
    { Icon: Ic.Term, title: 'Full audit trail', desc: 'Every action logged with actor, timestamp, and a before/after diff. Total accountability, zero guesswork.' },
    { Icon: Ic.Flag, title: 'Priority signals', desc: 'Urgent through Low, colour-coded across every card, column header, and filter. Nothing falls through the cracks.' },
    { Icon: Ic.Cal, title: 'WIP enforcement', desc: 'Set per-column limits. Cards turn red when exceeded. Your flow stays healthy without a process manager.' },
    { Icon: Ic.Layers, title: 'Conflict resolution', desc: 'Optimistic UI with version vectors. Concurrent edits are detected, compared, and resolved — not silently dropped.' },
  ]

  const logos = ['Linear', 'Vercel', 'Stripe', 'Railway', 'Supabase', 'PlanetScale', 'Fly.io', 'Render']

  // staggered fade classes
  const fade = (delay = 0, visible = true) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(16px)',
    transition: `opacity .6s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .6s cubic-bezier(.16,1,.3,1) ${delay}ms`,
  })

  return (
    <div style={{ background: t.bg, color: t.text, overflowX: 'hidden', fontFamily: "'Inter',sans-serif" }}>

      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px',
        background: scrolled ? (dark ? 'rgba(15,15,15,0.95)' : 'rgba(250,250,248,0.95)') : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? `1px solid ${t.border}` : '1px solid transparent',
        transition: 'background .35s, border-color .35s, backdrop-filter .35s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic.Layers width={13} height={13} style={{ color: dark ? '#000' : '#fff' }} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, color: t.text, letterSpacing: '-.03em' }}>KanbanPro</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={toggle} style={{ background: 'none', border: `1px solid ${t.border2}`, borderRadius: 6, padding: '6px', cursor: 'pointer', color: t.text2, display: 'flex', transition: 'border-color .15s' }} onMouseEnter={e => e.currentTarget.style.borderColor = t.text} onMouseLeave={e => e.currentTarget.style.borderColor = t.border2}>
            {dark ? <Ic.Sun width={14} height={14} /> : <Ic.Moon width={14} height={14} />}
          </button>
          <button onClick={onGetStarted} style={{ background: 'none', border: `1px solid ${t.border2}`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', color: t.text2, fontWeight: 500, fontSize: 13, fontFamily: "'Inter',sans-serif", transition: 'all .15s', letterSpacing: '-.01em' }} onMouseEnter={e => { e.currentTarget.style.borderColor = t.text; e.currentTarget.style.color = t.text }} onMouseLeave={e => { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.color = t.text2 }}>Sign in</button>
          <button onClick={onGetStarted} style={{ background: t.text, border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', color: dark ? '#000' : '#fff', fontWeight: 600, fontSize: 13, fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em', transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>Get started</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section ref={heroRef} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px 0', position: 'relative', overflow: 'hidden' }}>

        {/* Subtle grid bg */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'} 1px,transparent 1px),linear-gradient(90deg,${dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'} 1px,transparent 1px)`, backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse 70% 70% at 50% 30%,black,transparent)', WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 30%,black,transparent)', pointerEvents: 'none' }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 780, width: '100%' }}>
          <div style={{ ...fade(0, heroVisible), display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${t.border2}`, borderRadius: 99, padding: '5px 14px 5px 8px', marginBottom: 28, background: t.surface }}>
            <div style={{ background: t.text, borderRadius: 99, padding: '2px 7px', fontSize: 10, fontWeight: 600, color: dark ? '#000' : '#fff', letterSpacing: '.04em' }}>NEW</div>
            <span style={{ fontSize: 12.5, color: t.text2, letterSpacing: '-.01em' }}>Fractional indexing + conflict resolution</span>
            <Ic.Arrow width={12} height={12} style={{ color: t.text3 }} />
          </div>

          <h1 style={{ ...fade(60, heroVisible), fontSize: 'clamp(36px,5.5vw,72px)', fontWeight: 600, color: t.text, lineHeight: 1.06, letterSpacing: '-2.5px', marginBottom: 22 }}>
            The real-time workspace<br />
            <span style={{ color: t.text3, fontWeight: 400 }}>teams actually stay in.</span>
          </h1>

          <p style={{ ...fade(120, heroVisible), fontSize: 17, color: t.text2, lineHeight: 1.65, maxWidth: 520, margin: '0 auto 36px', fontWeight: 400, letterSpacing: '-.01em' }}>
            Kanban boards with sub-50ms sync, live presence, full audit trails, and conflict resolution built in from day one.
          </p>

          <div style={{ ...fade(180, heroVisible), display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={onGetStarted} style={{ padding: '11px 28px', borderRadius: 7, border: 'none', background: t.text, color: dark ? '#000' : '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: "'Inter',sans-serif", letterSpacing: '-.02em', transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              Create a board — free
            </button>
            <button onClick={onGetStarted} style={{ padding: '11px 22px', borderRadius: 7, border: `1px solid ${t.border2}`, background: 'transparent', color: t.text, fontWeight: 500, fontSize: 14, cursor: 'pointer', fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em', transition: 'border-color .15s' }} onMouseEnter={e => e.currentTarget.style.borderColor = t.text} onMouseLeave={e => e.currentTarget.style.borderColor = t.border2}>
              Join with room code
            </button>
          </div>
          <p style={{ ...fade(220, heroVisible), fontSize: 12, color: t.text3, letterSpacing: '-.01em' }}>No account · No credit card · Works in any browser</p>
        </div>

        {/* Hero board */}
        <div style={{ ...fade(280, heroVisible), position: 'relative', zIndex: 1, width: '100%', maxWidth: 1000, marginTop: 52, padding: '0 24px' }}>
          <div style={{
            background: t.surface,
            borderRadius: '12px 12px 0 0',
            border: `1px solid ${t.border}`,
            borderBottom: 'none',
            boxShadow: `0 -2px 40px ${dark ? 'rgba(0,0,0,.7)' : 'rgba(0,0,0,.1)'},0 0 0 1px ${t.border}`,
            overflow: 'hidden',
          }}>
            {/* Window chrome */}
            <div style={{ background: dark ? t.canvas : t.surface2, borderBottom: `1px solid ${t.border}`, padding: '0 16px', height: 40, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
              </div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <div style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', borderRadius: 5, padding: '3px 14px', fontSize: 11, color: t.text3, fontFamily: "'DM Mono',monospace" }}>localhost:3001</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {['IK', 'SR', 'MR', 'AT'].map((av, i) => (
                  <div key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: ['#0369a1', '#7c3aed', '#be185d', '#0f766e'][i], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: '#fff', marginLeft: i ? -5 : 0, border: `1.5px solid ${t.surface}` }}>{av}</div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 99, padding: '2px 7px', marginLeft: 6 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', letterSpacing: '.04em' }}>LIVE</span>
                </div>
              </div>
            </div>
            <MiniKanban />
          </div>
        </div>
      </section>

      {/* ── LOGO STRIP ── */}
      <div style={{ borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`, padding: '14px 0', overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 0, animation: 'marquee 22s linear infinite', width: 'max-content' }}>
          {[...logos, ...logos].map((name, i) => (
            <span key={i} style={{ fontSize: 12, fontWeight: 600, color: t.text3, letterSpacing: '-.02em', opacity: .5, padding: '0 28px', whiteSpace: 'nowrap', borderRight: `1px solid ${t.border}` }}>{name}</span>
          ))}
        </div>
      </div>

      {/* ── STATS ── */}
      <section ref={statsRef} style={{ padding: '72px 5%', borderBottom: `1px solid ${t.border}` }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0 }}>
          {[
            { n: 50000, suffix: 'K+', label: 'tasks shipped per day', prefix: '' },
            { n: 12, suffix: 'K+', label: 'teams worldwide', prefix: '' },
            { n: 99, suffix: '.9%', label: 'uptime SLA', prefix: '' },
            { n: 50, suffix: 'ms', label: 'p99 sync latency', prefix: '<' },
          ].map(({ n, suffix, label, prefix }, i) => (
            <div key={i} style={{ ...fade(i * 80, statsVisible), textAlign: 'center', padding: '24px 0', borderRight: i < 3 ? `1px solid ${t.border}` : 'none' }}>
              <div style={{ fontSize: 'clamp(32px,4vw,48px)', fontWeight: 600, color: t.text, letterSpacing: '-2px', lineHeight: 1, marginBottom: 6, fontFamily: "'Inter',sans-serif" }}>
                {prefix}<AnimatedCounter target={n} />{suffix}
              </div>
              <div style={{ fontSize: 12.5, color: t.text3, letterSpacing: '-.01em' }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section ref={featRef} style={{ padding: '96px 5%' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ marginBottom: 56, ...fade(0, featVisible) }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Capabilities</p>
            <h2 style={{ fontSize: 'clamp(28px,3.5vw,44px)', fontWeight: 600, color: t.text, letterSpacing: '-1.5px', lineHeight: 1.1, maxWidth: 480 }}>
              Infrastructure-grade features. Product-grade UX.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px', background: t.border, borderRadius: 10, overflow: 'hidden' }}>
            {features.map(({ Icon, title, desc }, i) => (
              <div key={title} style={{ ...fade(i * 60, featVisible), background: t.surface, padding: '32px 28px', transition: 'background .2s', cursor: 'default' }}
                onMouseEnter={e => e.currentTarget.style.background = dark ? t.surface2 : t.canvas}
                onMouseLeave={e => e.currentTarget.style.background = t.surface}>
                <div style={{ width: 34, height: 34, borderRadius: 7, border: `1px solid ${t.border2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Icon width={16} height={16} style={{ color: t.text2 }} />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 8, letterSpacing: '-.02em' }}>{title}</h3>
                <p style={{ fontSize: 13.5, color: t.text3, lineHeight: 1.6, letterSpacing: '-.01em' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section ref={howRef} style={{ padding: '96px 5%', borderTop: `1px solid ${t.border}`, background: dark ? t.canvas : t.surface2 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ marginBottom: 56, ...fade(0, howVisible) }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>How it works</p>
            <h2 style={{ fontSize: 'clamp(26px,3.5vw,42px)', fontWeight: 600, color: t.text, letterSpacing: '-1.5px', lineHeight: 1.1 }}>
              From zero to live board in 30 seconds.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 32 }}>
            {[
              { step: '01', title: 'Create or join', desc: 'Name your board or paste a room code. No account, no email required. Just start.' },
              { step: '02', title: 'Invite your team', desc: 'Share an 8-character code or a URL. Teammates appear live the moment they join.' },
              { step: '03', title: 'Ship together', desc: 'Drag cards, comment, assign priorities. Everything propagates in under 50ms.' },
            ].map(({ step, title, desc }, i) => (
              <div key={step} style={{ ...fade(i * 80, howVisible) }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.text3, letterSpacing: '.06em', marginBottom: 14, fontFamily: "'DM Mono',monospace" }}>{step}</div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: t.text, marginBottom: 10, letterSpacing: '-.03em' }}>{title}</h3>
                <p style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, letterSpacing: '-.01em' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{ padding: '96px 5%', borderTop: `1px solid ${t.border}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: t.text3, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 40 }}>From teams using it</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
            {[
              { q: 'Replaced Jira in one afternoon. Standups went from 30 minutes to 10.', name: 'Sarah Chen', role: 'CTO, Fynity' },
              { q: 'The audit log is the feature. Finally know who changed what without asking anyone.', name: 'Marcus Webb', role: 'Eng Manager, Techmunity' },
              { q: 'Live presence sounds like a gimmick until you work with a remote team across 4 time zones.', name: 'Priya Nair', role: 'Product Lead, Stackfield' },
            ].map(({ q, name, role }, i) => (
              <div key={name} style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: '24px', background: t.surface }}>
                <p style={{ fontSize: 14.5, color: t.text, lineHeight: 1.65, marginBottom: 20, letterSpacing: '-.01em' }}>"{q}"</p>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: '-.01em' }}>{name}</div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{role}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '0 5% 96px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', border: `1px solid ${t.border}`, borderRadius: 12, padding: '72px 8%', textAlign: 'center', position: 'relative', overflow: 'hidden', background: dark ? t.canvas : t.surface }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(ellipse 60% 60% at 50% 100%,${dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'} 0%,transparent 70%)`, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h2 style={{ fontSize: 'clamp(26px,4vw,48px)', fontWeight: 600, color: t.text, letterSpacing: '-2px', lineHeight: 1.08, marginBottom: 16 }}>Build something worth<br />showing off.</h2>
            <p style={{ fontSize: 16, color: t.text3, marginBottom: 36, letterSpacing: '-.01em' }}>Create your first board in seconds. No account required.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={onGetStarted} style={{ padding: '12px 28px', borderRadius: 7, border: 'none', background: t.text, color: dark ? '#000' : '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: "'Inter',sans-serif", letterSpacing: '-.02em', transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                Create a board — free
              </button>
              <button onClick={onGetStarted} style={{ padding: '12px 22px', borderRadius: 7, border: `1px solid ${t.border2}`, background: 'transparent', color: t.text, fontWeight: 500, fontSize: 14, cursor: 'pointer', fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em', transition: 'border-color .15s' }} onMouseEnter={e => e.currentTarget.style.borderColor = t.text} onMouseLeave={e => e.currentTarget.style.borderColor = t.border2}>
                Join with a code
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: `1px solid ${t.border}`, padding: '28px 5%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic.Layers width={11} height={11} style={{ color: dark ? '#000' : '#fff' }} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: t.text, letterSpacing: '-.02em' }}>KanbanPro</span>
        </div>
        <p style={{ fontSize: 12, color: t.text3, letterSpacing: '-.01em' }}>Real-time collaboration · {new Date().getFullYear()}</p>
        <button onClick={onGetStarted} style={{ background: t.text, border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', color: dark ? '#000' : '#fff', fontWeight: 600, fontSize: 12.5, fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em', transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '.8'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>Get started</button>
      </footer>
    </div>
  )
}

// ─── JOIN / CREATE SCREEN ─────────────────────────────────────────────────────
function JoinScreen({ onJoin, onBack }) {
  const { dark, t } = useTheme()
  const [tab, setTab] = useState('create')
  const [name, setName] = useState('')
  const [boardName, setBoardName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { const c = new URLSearchParams(window.location.search).get('room'); if (c) { setCode(c.toUpperCase()); setTab('join') } }, [])

  const create = async e => {
    e?.preventDefault(); setErr('')
    if (!name.trim() || !boardName.trim()) return
    setLoading(true)
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: boardName.trim() }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      onJoin({ roomId: d.id, userName: name.trim() })
    } catch (e) { setErr(e.message); setLoading(false) }
  }
  const join = e => {
    e?.preventDefault()
    if (!name.trim() || !code.trim()) return
    onJoin({ roomId: code.trim().toUpperCase(), userName: name.trim() })
  }

  const inp = { width: '100%', padding: '10px 13px', borderRadius: 7, outline: 'none', border: `1px solid ${t.border2}`, background: t.input, color: t.text, fontSize: 13.5, fontFamily: "'Inter',sans-serif", boxSizing: 'border-box', transition: 'border-color .15s', letterSpacing: '-.01em' }
  const lbl = { display: 'block', fontSize: 11, fontWeight: 500, color: t.text3, marginBottom: 6, letterSpacing: '.02em', textTransform: 'uppercase' }

  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg, padding: 24 }}>
    <div style={{ width: '100%', maxWidth: 400, animation: 'fadeUp .3s ease' }}>
      {onBack && <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: t.text3, fontSize: 13, fontFamily: "'Inter',sans-serif", marginBottom: 24, padding: '4px 0', letterSpacing: '-.01em', transition: 'color .15s' }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.text3}>
        <Ic.ChevR width={13} height={13} style={{ transform: 'rotate(180deg)' }} />Back
      </button>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ic.Layers width={16} height={16} style={{ color: dark ? '#000' : '#fff' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: t.text, letterSpacing: '-.04em' }}>KanbanPro</h1>
          <p style={{ fontSize: 12, color: t.text3, letterSpacing: '-.01em' }}>Real-time collaborative boards</p>
        </div>
      </div>

      <div style={{ background: t.surface, borderRadius: 10, padding: 24, border: `1px solid ${t.border}`, boxShadow: `0 4px 32px ${t.shadow}` }}>
        <div style={{ display: 'flex', background: t.canvas, borderRadius: 8, padding: 3, marginBottom: 22, gap: 2 }}>
          {[['create', 'Create board'], ['join', 'Join board']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: "'Inter',sans-serif", background: tab === v ? t.surface : 'transparent', color: tab === v ? t.text : t.text2, fontWeight: tab === v ? 500 : 400, fontSize: 13, boxShadow: tab === v ? `0 1px 4px ${t.shadow}` : 'none', transition: 'all .15s', letterSpacing: '-.01em' }}>{l}</button>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Your name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && (tab === 'create' ? create(e) : join(e))} placeholder="e.g. Imran Khan" style={inp} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border2} />
        </div>

        {tab === 'create'
          ? <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Board name</label>
            <input value={boardName} onChange={e => setBoardName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create(e)} placeholder="e.g. Product Roadmap Q3" style={inp} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border2} />
          </div>
          : <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Room code</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && join(e)} placeholder="AB3KM7PQ" style={{ ...inp, fontFamily: "'DM Mono',monospace", letterSpacing: '.2em', fontSize: 17, textAlign: 'center' }} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border2} />
            <p style={{ fontSize: 11, color: t.text3, marginTop: 6, textAlign: 'center', letterSpacing: '-.01em' }}>Get this from your team's invite link</p>
          </div>
        }

        {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.danger}25`, borderRadius: 6, padding: '9px 12px', color: t.danger, fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Ic.Slash width={12} height={12} />{err}
        </div>}

        <button onClick={tab === 'create' ? create : join} disabled={loading} style={{ width: '100%', padding: '11px 0', borderRadius: 7, border: 'none', fontFamily: "'Inter',sans-serif", background: t.text, color: dark ? '#000' : '#fff', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .6 : 1, letterSpacing: '-.02em', transition: 'opacity .15s' }} onMouseEnter={e => !loading && (e.currentTarget.style.opacity = '.85')} onMouseLeave={e => e.currentTarget.style.opacity = loading ? '.6' : '1'}>
          {loading ? 'Creating…' : tab === 'create' ? 'Create board →' : 'Join board →'}
        </button>
      </div>
    </div>
  </div>
}

// ─── INVITE MODAL ─────────────────────────────────────────────────────────────
function InviteModal({ roomId, roomName, members, onClose }) {
  const { t, dark } = useTheme()
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const inviteUrl = `${window.location.origin}?room=${roomId}`
  const copyLink = () => { navigator.clipboard.writeText(inviteUrl); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2500) }
  const copyCode = () => { navigator.clipboard.writeText(roomId); setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2500) }

  return <Modal onClose={onClose} width={480}>
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: `0 24px 80px ${t.shadow2}` }}>
      <div style={{ padding: '20px 24px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: t.text, letterSpacing: '-.03em' }}>Invite to board</h2>
          <p style={{ fontSize: 12.5, color: t.text3, marginTop: 3, letterSpacing: '-.01em' }}>{roomName} · {members.length} {members.length === 1 ? 'member' : 'members'} online</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: 4 }}><Ic.X width={16} height={16} /></button>
      </div>
      <div style={{ padding: '20px 24px' }}>
        {members.length > 0 && <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10.5, fontWeight: 500, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 9 }}>Online now</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {members.map(m => <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 99, padding: '4px 10px 4px 5px' }}>
              <div style={{ position: 'relative' }}><Av name={m.name} color={m.color} size={20} /><div style={{ position: 'absolute', bottom: -1, right: -1, width: 6, height: 6, borderRadius: '50%', background: t.success, border: `1.5px solid ${t.surface}` }} /></div>
              <span style={{ fontSize: 12, fontWeight: 500, color: t.text, letterSpacing: '-.01em' }}>{m.name}</span>
            </div>)}
          </div>
        </div>}
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 10.5, fontWeight: 500, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 9 }}>Room code</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: t.canvas, border: `1px solid ${t.border2}`, borderRadius: 8, padding: '12px 16px' }}>
            <code style={{ flex: 1, fontSize: 26, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: t.text, letterSpacing: '.25em', textAlign: 'center' }}>{roomId}</code>
            <button onClick={copyCode} style={{ background: copiedCode ? t.success : t.text, border: 'none', borderRadius: 6, padding: '7px 13px', cursor: 'pointer', color: dark ? '#000' : '#fff', fontWeight: 500, fontSize: 12, fontFamily: "'Inter',sans-serif", display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, transition: 'background .2s' }}>
              {copiedCode ? <Ic.Check width={12} height={12} /> : <Ic.Copy width={12} height={12} />}{copiedCode ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div>
          <p style={{ fontSize: 10.5, fontWeight: 500, color: t.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 9 }}>Share link</p>
          <div style={{ display: 'flex', gap: 7 }}>
            <div style={{ flex: 1, background: t.canvas, border: `1px solid ${t.border}`, borderRadius: 7, padding: '8px 11px', overflow: 'hidden' }}>
              <code style={{ fontSize: 11, color: t.text3, fontFamily: "'DM Mono',monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{inviteUrl}</code>
            </div>
            <button onClick={copyLink} style={{ background: copiedLink ? t.success : t.surface, border: `1px solid ${copiedLink ? t.success : t.border2}`, borderRadius: 7, padding: '0 14px', cursor: 'pointer', color: copiedLink ? '#fff' : t.text2, fontWeight: 500, fontSize: 12, fontFamily: "'Inter',sans-serif", display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, transition: 'all .2s' }}>
              {copiedLink ? <Ic.Check width={12} height={12} /> : <Ic.Link width={12} height={12} />}{copiedLink ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Modal>
}

// ─── STATS BAR ────────────────────────────────────────────────────────────────
function StatsBar({ tasks, columns, members }) {
  const { t } = useTheme()
  const a = tasks.filter(x => !x.archived)
  const doneCol = columns.find(c => c.name === 'Done')
  const doneN = doneCol ? a.filter(x => x.columnId === doneCol.id).length : 0
  const overdue = a.filter(x => x.dueDate && new Date(x.dueDate) < new Date()).length
  const urgent = a.filter(x => x.priority === 'urgent').length
  const pct = a.length ? Math.round(doneN / a.length * 100) : 0
  const stats = [
    { label: 'Total', value: a.length, color: t.text2 },
    { label: 'Done', value: doneN, color: t.success },
    { label: 'Overdue', value: overdue, color: overdue > 0 ? t.danger : t.text3 },
    { label: 'Urgent', value: urgent, color: urgent > 0 ? '#c2410c' : t.text3 },
    { label: 'Online', value: members.length, color: t.success },
  ]
  return <div style={{ background: t.header, borderBottom: `1px solid ${t.border}`, padding: '0 20px', display: 'flex', alignItems: 'center', height: 34, flexShrink: 0, gap: 0, overflowX: 'auto' }}>
    {stats.map((s, i) => <React.Fragment key={s.label}>
      {i > 0 && <div style={{ width: 1, height: 12, background: t.divider, margin: '0 12px' }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: s.color, lineHeight: 1, fontFamily: "'Inter',sans-serif", letterSpacing: '-.02em' }}>{s.value}</span>
        <span style={{ fontSize: 10.5, color: t.text3, letterSpacing: '-.01em' }}>{s.label}</span>
      </div>
    </React.Fragment>)}
    <div style={{ flex: 1 }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{ fontSize: 10.5, color: t.text3 }}>Progress</span>
      <div style={{ width: 56, height: 2, background: t.border2, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: t.text, borderRadius: 99, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: t.text2, fontFamily: "'DM Mono',monospace", minWidth: 22 }}>{pct}%</span>
    </div>
  </div>
}

// ─── TASK CARD ────────────────────────────────────────────────────────────────
function TaskCard({ task, members, onClick, viewingUsers = [], isOverlay = false, dark }) {
  const { t } = useTheme()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { task } })
  const style = { transform: CSS.Transform.toString(transform), transition: isDragging ? undefined : `${transition},box-shadow .15s` }
  const p = PRI[task.priority] || PRI.none
  const overdue = task.dueDate && new Date(task.dueDate) < new Date()
  const doneCheck = (task.checklist || []).filter(i => i.done).length
  const totalCheck = (task.checklist || []).length
  const watchers = viewingUsers.filter(m => m.activeTaskId === task.id)
  const assigned = members.filter(m => (task.assignees || []).includes(m.name))
  return <div ref={setNodeRef} style={style}>
    <div onClick={() => !isDragging && onClick(task)} style={{
      background: t.card,
      borderTop: `1px solid ${isDragging ? t.border2 : task.pinned ? `${t.text}20` : t.border}`,
      borderRight: `1px solid ${isDragging ? t.border2 : task.pinned ? `${t.text}20` : t.border}`,
      borderBottom: `1px solid ${isDragging ? t.border2 : task.pinned ? `${t.text}20` : t.border}`,
      borderLeft: task.priority !== 'none' ? `2px solid ${p.hex}` : `1px solid ${isDragging ? t.border2 : t.border}`,
      borderRadius: 8, padding: '10px 11px', cursor: isDragging ? 'grabbing' : 'pointer',
      marginBottom: 5, position: 'relative',
      opacity: isDragging ? 0 : (task.archived ? .4 : 1),
      boxShadow: isOverlay ? `0 20px 60px ${dark ? 'rgba(0,0,0,.85)' : 'rgba(0,0,0,.2)'},0 4px 12px rgba(0,0,0,.1)` : `0 1px 2px ${t.shadow}`,
      transform: isOverlay ? 'rotate(2.5deg) scale(1.04)' : undefined,
      willChange: 'transform', userSelect: 'none',
      transition: 'border-color .12s, box-shadow .15s, transform .15s',
    }}
      onMouseEnter={e => {
        if (!isDragging && !isOverlay) {
          e.currentTarget.style.borderTopColor = t.border2
          e.currentTarget.style.borderRightColor = t.border2
          e.currentTarget.style.borderBottomColor = t.border2
          e.currentTarget.style.boxShadow = `0 4px 16px ${t.shadow}, 0 1px 4px ${t.shadow}`
          e.currentTarget.style.transform = 'translateY(-1px)'
        }
      }}
      onMouseLeave={e => {
        if (!isOverlay) {
          e.currentTarget.style.borderTopColor = t.border
          e.currentTarget.style.borderRightColor = t.border
          e.currentTarget.style.borderBottomColor = t.border
          e.currentTarget.style.boxShadow = `0 1px 2px ${t.shadow}`
          e.currentTarget.style.transform = 'translateY(0)'
        }
      }}>
      <div {...attributes} {...listeners} onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 9, right: 9, cursor: isDragging ? 'grabbing' : 'grab', color: t.text3, padding: 2, borderRadius: 3, transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text2} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.Grip width={11} height={11} /></div>
      {(task.labels || []).length > 0 && <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 5 }}>
        {task.labels.map(li => { const lc = LABELS[li % LABELS.length]; const [bg, fg] = dark ? lc.d : lc.l; return <span key={li} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: bg, color: fg, letterSpacing: '.01em' }}>{lc.name}</span> })}
      </div>}
      <p style={{ fontSize: 12.5, fontWeight: 500, color: t.text, lineHeight: 1.4, paddingRight: 18, marginBottom: 7, letterSpacing: '-.01em' }}>{task.title}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          {task.priority !== 'none' && <span style={{ fontSize: 9, fontWeight: 600, padding: '1.5px 6px', borderRadius: 99, background: dark ? p.dark : p.light, color: p.hex, display: 'flex', alignItems: 'center', gap: 2, letterSpacing: '.01em' }}><Ic.Flag width={7} height={7} />{p.label}</span>}
          {task.dueDate && <span style={{ fontSize: 9, padding: '1.5px 5px', borderRadius: 99, background: overdue ? t.dangerBg : dark ? t.surface2 : t.canvas, color: overdue ? t.danger : t.text3, display: 'flex', alignItems: 'center', gap: 2 }}><Ic.Cal width={7} height={7} />{new Date(task.dueDate).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>}
          {totalCheck > 0 && <span style={{ fontSize: 9, color: t.text3, display: 'flex', alignItems: 'center', gap: 1 }}><Ic.Check width={7} height={7} />{doneCheck}/{totalCheck}</span>}
          {(task.comments || []).length > 0 && <span style={{ fontSize: 9, color: t.text3, display: 'flex', alignItems: 'center', gap: 1 }}><Ic.Bar width={7} height={7} />{task.comments.length}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {watchers.slice(0, 2).map(w => <Av key={w.id} name={w.name} color={w.color} size={16} sx={{ marginLeft: -4, boxShadow: `0 0 0 2px ${t.surface}` }} />)}
          {assigned.slice(0, 3).map((m, i) => <Av key={m.id} name={m.name} color={m.color} size={18} sx={{ marginLeft: i === 0 && !watchers.length ? 0 : -5, boxShadow: `0 0 0 1.5px ${t.card}` }} />)}
        </div>
      </div>
    </div>
  </div>
}

// ─── COLUMN ──────────────────────────────────────────────────────────────────
function Column({ column, tasks, members, dark, onTaskClick, onAdd, onRename, onDelete, onSetWip, viewingUsers }) {
  const { t } = useTheme()
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [colName, setColName] = useState(column.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showWip, setShowWip] = useState(false)
  const [wipInput, setWipInput] = useState('')
  const menuRef = useRef()
  useEffect(() => { const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  const wipOver = column.wipLimit && tasks.length > column.wipLimit
  return <div style={{ width: 268, flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '0 2px' }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
      {renaming
        ? <input autoFocus value={colName} onChange={e => setColName(e.target.value)} onBlur={() => { if (colName.trim() && colName !== column.name) onRename(column.id, colName.trim()); else setColName(column.name); setRenaming(false) }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setColName(column.name); setRenaming(false) } }} style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: `1.5px solid ${t.text}`, outline: 'none', fontSize: 11.5, fontWeight: 600, color: t.text, fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em', paddingBottom: 1 }} />
        : <span onDoubleClick={() => setRenaming(true)} style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: t.text, textTransform: 'uppercase', letterSpacing: '.04em', cursor: 'default' }}>{column.name}</span>
      }
      <span style={{ fontSize: 9.5, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: wipOver ? t.dangerBg : dark ? t.surface2 : t.canvas, color: wipOver ? t.danger : t.text3, border: `1px solid ${wipOver ? t.danger + '25' : t.border}`, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
        {tasks.length}{column.wipLimit ? `/${column.wipLimit}` : ''}
      </span>
      <div style={{ position: 'relative' }} ref={menuRef}>
        <button onClick={() => setMenuOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: '2px 4px', borderRadius: 4, display: 'flex', transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text2} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.Chev width={12} height={12} /></button>
        {menuOpen && <div style={{ position: 'absolute', right: 0, top: '115%', background: t.surface, border: `1px solid ${t.border2}`, borderRadius: 8, padding: 4, zIndex: 60, boxShadow: `0 8px 32px ${t.shadow2}`, minWidth: 148, animation: 'fadeUp .1s ease' }}>
          <Mi t={t} Icon={Ic.Pen} label="Rename" onClick={() => { setRenaming(true); setMenuOpen(false) }} />
          <Mi t={t} Icon={Ic.Cog} label="Set WIP limit" onClick={() => { setShowWip(true); setMenuOpen(false) }} />
          <div style={{ height: 1, background: t.divider, margin: '3px 5px' }} />
          <Mi t={t} Icon={Ic.Trash} label="Delete" danger onClick={() => { onDelete(column.id); setMenuOpen(false) }} />
        </div>}
      </div>
      <button onClick={() => setAdding(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: '2px 4px', borderRadius: 4, display: 'flex', transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.Plus width={13} height={13} /></button>
    </div>
    {wipOver && <div style={{ background: t.dangerBg, border: `1px solid ${t.danger}20`, borderRadius: 6, padding: '4px 8px', marginBottom: 5, fontSize: 10, color: t.danger, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><Ic.Slash width={9} height={9} />WIP exceeded ({tasks.length}/{column.wipLimit})</div>}
    {showWip && <div style={{ background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 7, padding: 8, marginBottom: 5 }}>
      <p style={{ fontSize: 11, color: t.text2, marginBottom: 5, fontWeight: 500, letterSpacing: '-.01em' }}>WIP limit (0 = none)</p>
      <div style={{ display: 'flex', gap: 5 }}>
        <input type="number" min="0" value={wipInput} onChange={e => setWipInput(e.target.value)} placeholder={String(column.wipLimit ?? '')} style={{ flex: 1, border: `1px solid ${t.border2}`, borderRadius: 6, padding: '5px 8px', fontSize: 12.5, color: t.text, background: t.input, outline: 'none', fontFamily: "'DM Mono',monospace", boxSizing: 'border-box' }} />
        <button onClick={() => { onSetWip(column.id, parseInt(wipInput) || null); setShowWip(false); setWipInput('') }} style={{ padding: '0 11px', background: t.text, border: 'none', borderRadius: 6, color: dark ? '#000' : '#fff', fontWeight: 500, fontSize: 12, cursor: 'pointer', fontFamily: "'Inter',sans-serif" }}>Set</button>
      </div>
    </div>}
    <div ref={setNodeRef} style={{ minHeight: 56, borderRadius: 8, padding: '2px', background: isOver ? `${column.color}0a` : 'transparent', border: `1.5px solid ${isOver ? column.color + '40' : 'transparent'}`, transition: 'all .18s', animation: isOver ? 'dropGlow 1.1s ease infinite' : 'none' }}>
      <SortableContext items={tasks.map(x => x.id)} strategy={verticalListSortingStrategy}>
        {tasks.map(task => <TaskCard key={task.id} task={task} members={members} onClick={onTaskClick} viewingUsers={viewingUsers} dark={dark} />)}
      </SortableContext>
      {adding
        ? <div style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: 8, padding: 10, animation: 'fadeUp .12s ease', boxShadow: `0 4px 16px ${t.shadow}` }}>
          <textarea autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (newTitle.trim()) { onAdd(column.id, newTitle.trim()); setNewTitle(''); setAdding(false) } } if (e.key === 'Escape') { setAdding(false); setNewTitle('') } }} placeholder="Task title… Enter to add" style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, resize: 'none', color: t.text, background: 'transparent', fontFamily: "'Inter',sans-serif", boxSizing: 'border-box', lineHeight: 1.4, letterSpacing: '-.01em' }} />
          <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
            <Btn primary small onClick={() => { if (newTitle.trim()) { onAdd(column.id, newTitle.trim()); setNewTitle(''); setAdding(false) } }}>Add task</Btn>
            <Btn small onClick={() => { setAdding(false); setNewTitle('') }}>Cancel</Btn>
          </div>
        </div>
        : <button onClick={() => setAdding(true)} style={{ width: '100%', background: 'none', border: `1px dashed ${t.border2}`, borderRadius: 7, padding: '8px 11px', cursor: 'pointer', color: t.text3, fontSize: 12, fontFamily: "'Inter',sans-serif", display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s', letterSpacing: '-.01em' }} onMouseEnter={e => { e.currentTarget.style.borderColor = t.text; e.currentTarget.style.color = t.text }} onMouseLeave={e => { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.color = t.text3 }}><Ic.Plus width={11} height={11} />Add task</button>
      }
    </div>
  </div>
}

// ─── TASK MODAL ───────────────────────────────────────────────────────────────
function TaskModal({ task: init, columns, members, myName, dark, onClose, onUpdate, onDelete, onAddComment, onDeleteComment, onArchive, onDuplicate, socket }) {
  const { t } = useTheme()
  const [task, setTask] = useState(init)
  useEffect(() => setTask(init), [init])
  const [title, setTitle] = useState(init.title)
  const [desc, setDesc] = useState(init.description || '')
  const [priority, setPriority] = useState(init.priority || 'none')
  const [dueDate, setDueDate] = useState(init.dueDate || '')
  const [labels, setLabels] = useState(init.labels || [])
  const [assignees, setAssignees] = useState(init.assignees || [])
  const [checklist, setChecklist] = useState(init.checklist || [])
  const [timeEst, setTimeEst] = useState(init.timeEstimate || '')
  const [newCheck, setNewCheck] = useState('')
  const [comment, setComment] = useState('')
  const [tab, setTab] = useState('details')
  const [typing, setTyping] = useState([])
  const ttRef = useRef()
  useEffect(() => { const s = socket; const h = ({ userId, userName, taskId, isTyping }) => { if (taskId !== task.id) return; setTyping(p => isTyping ? [...p.filter(u => u.id !== userId), { id: userId, name: userName }] : p.filter(u => u.id !== userId)) }; s.on('typing:indicator', h); s.emit('presence:viewing', { taskId: task.id }); return () => { s.off('typing:indicator', h); s.emit('presence:viewing', { taskId: null }) } }, [task.id])
  const saveU = fields => { setTask(p => ({ ...p, ...fields, version: p.version + 1 })); onUpdate(task.id, fields, task.version) }
  const handleTitleBlur = () => { if (title.trim() !== task.title) saveU({ title: title.trim() }) }
  const handleDescBlur = () => { if (desc !== (task.description || '')) saveU({ description: desc }) }
  const handlePri = p => { setPriority(p); saveU({ priority: p }) }
  const handleDue = d => { setDueDate(d); saveU({ dueDate: d || null }) }
  const handleLabel = i => { const n = labels.includes(i) ? labels.filter(l => l !== i) : [...labels, i]; setLabels(n); saveU({ labels: n }) }
  const handleAssign = name => { const n = assignees.includes(name) ? assignees.filter(a => a !== name) : [...assignees, name]; setAssignees(n); saveU({ assignees: n }) }
  const addCheck = () => { if (!newCheck.trim()) return; const n = [...checklist, { id: Date.now(), text: newCheck.trim(), done: false }]; setChecklist(n); saveU({ checklist: n }); setNewCheck('') }
  const toggleCheck = id => { const n = checklist.map(i => i.id === id ? { ...i, done: !i.done } : i); setChecklist(n); saveU({ checklist: n }) }
  const delCheck = id => { const n = checklist.filter(i => i.id !== id); setChecklist(n); saveU({ checklist: n }) }
  const handleComment = () => { if (!comment.trim()) return; onAddComment(task.id, comment.trim()); setComment(''); clearTimeout(ttRef.current); socket.emit('typing:stop', { taskId: task.id }) }
  const handleCT = v => { setComment(v); socket.emit('typing:start', { taskId: task.id }); clearTimeout(ttRef.current); ttRef.current = setTimeout(() => socket.emit('typing:stop', { taskId: task.id }), 2000) }
  const col = columns.find(c => c.id === task.columnId)
  const overdue = task.dueDate && new Date(task.dueDate) < new Date()
  const doneC = checklist.filter(i => i.done).length
  const pct = checklist.length ? Math.round(doneC / checklist.length * 100) : 0
  const inp = { width: '100%', border: `1px solid ${t.border2}`, borderRadius: 7, padding: '8px 11px', fontSize: 13.5, outline: 'none', color: t.text, background: t.input, fontFamily: "'Inter',sans-serif", boxSizing: 'border-box', transition: 'border-color .15s', lineHeight: 1.5, letterSpacing: '-.01em' }
  const lbl = { display: 'block', fontSize: 10, fontWeight: 500, color: t.text3, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.06em' }
  return <Modal onClose={onClose} width={720}>
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: `0 32px 80px ${t.shadow2}` }}>
      <div style={{ padding: '18px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} onBlur={handleTitleBlur} style={{ width: '100%', border: 'none', outline: 'none', fontSize: 19, fontWeight: 600, color: t.text, background: 'transparent', fontFamily: "'Inter',sans-serif", letterSpacing: '-.04em', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, paddingBottom: 13, borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: t.text3, letterSpacing: '-.01em' }}>{task.createdBy} · {relTime(task.createdAt)}</span>
              {col && <span style={{ fontSize: 11, background: t.canvas, color: t.text2, borderRadius: 4, padding: '1px 7px', border: `1px solid ${t.border}`, letterSpacing: '-.01em' }}>{col.name}</span>}
              {task.archived && <span style={{ fontSize: 11, background: t.accentBg, color: t.text2, borderRadius: 4, padding: '1px 7px', letterSpacing: '-.01em' }}>Archived</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 1 }}>
            <Tip label={task.pinned ? 'Unpin' : 'Pin'} pos='bottom'><Btn small ghost onClick={() => saveU({ pinned: !task.pinned })} sx={{ color: task.pinned ? t.text : t.text3 }} Icon={Ic.Pin} /></Tip>
            <Tip label="Duplicate" pos='bottom'><Btn small ghost onClick={() => { onDuplicate(task.id); onClose() }} sx={{ color: t.text3 }} Icon={Ic.Dup} /></Tip>
            <Tip label="Archive" pos='bottom'><Btn small ghost onClick={() => { onArchive(task.id); onClose() }} sx={{ color: t.text3 }} Icon={Ic.Arc} /></Tip>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: '4px', borderRadius: 6, display: 'flex', transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.X width={16} height={16} /></button>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, padding: '0 22px' }}>
        {['details', 'comments', 'activity'].map(tb => <button key={tb} onClick={() => setTab(tb)} style={{ padding: '9px 0', marginRight: 20, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter',sans-serif", borderBottom: tab === tb ? `1.5px solid ${t.text}` : '1.5px solid transparent', color: tab === tb ? t.text : t.text3, fontSize: 12.5, fontWeight: tab === tb ? 500 : 400, textTransform: 'capitalize', transition: 'color .12s', letterSpacing: '-.01em' }}>{tb}</button>)}
      </div>
      <div style={{ display: 'flex', maxHeight: '62vh', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          {tab === 'details' && <>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Description</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={handleDescBlur} rows={3} placeholder="Add a description…" style={{ ...inp, resize: 'vertical' }} onFocus={e => e.target.style.borderColor = t.text} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={lbl}>Checklist {checklist.length > 0 && `(${doneC}/${checklist.length})`}</label>
                {checklist.length > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: t.text2, fontFamily: "'DM Mono',monospace" }}>{pct}%</span>}
              </div>
              {checklist.length > 0 && <div style={{ height: 2, background: t.border2, borderRadius: 99, marginBottom: 9, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: t.text, transition: 'width .4s cubic-bezier(.16,1,.3,1)', borderRadius: 99 }} /></div>}
              {checklist.map(item => <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <button onClick={() => toggleCheck(item.id)} style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0, cursor: 'pointer', border: item.done ? 'none' : `1.5px solid ${t.border2}`, background: item.done ? t.text : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .12s' }}>
                  {item.done && <Ic.Check width={9} height={9} style={{ color: dark ? '#000' : '#fff' }} />}
                </button>
                <span style={{ flex: 1, fontSize: 13, color: item.done ? t.text3 : t.text, textDecoration: item.done ? 'line-through' : 'none', letterSpacing: '-.01em' }}>{item.text}</span>
                <button onClick={() => delCheck(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: 2, display: 'flex', transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.danger} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.X width={10} height={10} /></button>
              </div>)}
              <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                <input value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCheck()} placeholder="Add item…" style={{ flex: 1, ...inp, padding: '6px 9px', fontSize: 13 }} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border2} />
                <Btn small onClick={addCheck}>Add</Btn>
              </div>
            </div>
            <div>
              <label style={lbl}>Time estimate (hours)</label>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <input type="number" min="0" step="0.5" value={timeEst} onChange={e => setTimeEst(e.target.value)} onBlur={() => { if (timeEst !== (init.timeEstimate || '')) saveU({ timeEstimate: parseFloat(timeEst) || null }) }} placeholder="0.0" style={{ ...inp, width: 100, padding: '6px 9px', fontFamily: "'DM Mono',monospace", fontSize: 13 }} onFocus={e => e.target.style.borderColor = t.text} />
                {task.timeEstimate && <span style={{ fontSize: 12, color: t.text3, display: 'flex', alignItems: 'center', gap: 3, letterSpacing: '-.01em' }}><Ic.Clock width={11} height={11} />{task.timeEstimate}h</span>}
              </div>
            </div>
          </>}
          {tab === 'comments' && <div>
            {(!task.comments || !task.comments.length) && <div style={{ textAlign: 'center', padding: '24px 0', color: t.text3, fontSize: 13, letterSpacing: '-.01em' }}><Ic.Bar width={22} height={22} style={{ display: 'block', margin: '0 auto 8px', opacity: .2 }} />No comments yet</div>}
            {(task.comments || []).map(c => <div key={c.id} style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
              <Av name={c.authorName} color={c.authorColor || t.text} size={28} sx={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: t.text, letterSpacing: '-.01em' }}>{c.authorName}<span style={{ fontWeight: 400, color: t.text3, marginLeft: 6, fontSize: 11 }}>{relTime(c.createdAt)}</span></span>
                  {c.authorName === myName && <button onClick={() => onDeleteComment(task.id, c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, padding: 2, display: 'flex', transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.danger} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.Trash width={10} height={10} /></button>}
                </div>
                <div style={{ fontSize: 13.5, color: t.text, background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 7, padding: '8px 12px', lineHeight: 1.55, letterSpacing: '-.01em' }}>{c.body}</div>
              </div>
            </div>)}
            {typing.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: t.text3, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 2 }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: t.text3, animation: `pulse 1.2s ease ${i * .2}s infinite` }} />)}</div>
              {typing.map(u => u.name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
            </div>}
            <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
              <textarea value={comment} onChange={e => handleCT(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment() } }} placeholder="Write a comment… Enter to send" style={{ flex: 1, ...inp, resize: 'none' }} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border2} />
              <button onClick={handleComment} style={{ background: t.text, border: 'none', borderRadius: 7, padding: '0 13px', cursor: 'pointer', color: dark ? '#000' : '#fff', display: 'flex', alignItems: 'center', boxShadow: `0 2px 8px ${t.shadow}`, flexShrink: 0, transition: 'opacity .1s' }} onMouseEnter={e => e.currentTarget.style.opacity = '.8'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}><Ic.Send width={14} height={14} /></button>
            </div>
          </div>}
          {tab === 'activity' && <div style={{ borderLeft: `1.5px solid ${t.border}`, marginLeft: 8, paddingLeft: 16 }}>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <div style={{ position: 'absolute', left: -21, top: 3, width: 8, height: 8, borderRadius: '50%', background: t.text2, border: `2px solid ${t.surface}` }} />
              <p style={{ fontSize: 12.5, color: t.text, letterSpacing: '-.01em' }}><strong>{task.createdBy}</strong> created this task</p>
              <p style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{fmtTs(task.createdAt)}</p>
            </div>
            {(task.comments || []).map(c => <div key={c.id} style={{ position: 'relative', marginBottom: 16 }}>
              <div style={{ position: 'absolute', left: -21, top: 3, width: 8, height: 8, borderRadius: '50%', background: t.border2, border: `2px solid ${t.surface}` }} />
              <p style={{ fontSize: 12.5, color: t.text, letterSpacing: '-.01em' }}><strong>{c.authorName}</strong> commented</p>
              <p style={{ fontSize: 12, color: t.text3, fontStyle: 'italic', marginTop: 2 }}>"{c.body.slice(0, 80)}{c.body.length > 80 ? '…' : ''}"</p>
              <p style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{fmtTs(c.createdAt)}</p>
            </div>)}
          </div>}
        </div>
        <div style={{ width: 184, borderLeft: `1px solid ${t.border}`, padding: '16px 13px', overflowY: 'auto', flexShrink: 0, background: dark ? t.surface2 : t.canvas }}>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Priority</label>
            {Object.entries(PRI).map(([key, p]) => <button key={key} onClick={() => handlePri(key)} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '5px 8px', borderRadius: 6, border: priority === key ? `1px solid ${p.hex}35` : '1px solid transparent', background: priority === key ? dark ? p.dark : p.light : 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: priority === key ? 500 : 400, color: priority === key ? p.hex : t.text2, marginBottom: 2, fontFamily: "'Inter',sans-serif", transition: 'all .1s', letterSpacing: '-.01em' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: p.hex, flexShrink: 0 }} />{p.label}
              {priority === key && <Ic.Check width={9} height={9} style={{ marginLeft: 'auto' }} />}
            </button>)}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Due date</label>
            <input type="date" value={dueDate ? dueDate.split('T')[0] : ''} onChange={e => handleDue(e.target.value || null)} style={{ width: '100%', border: `1px solid ${overdue ? t.danger : t.border2}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none', color: overdue ? t.danger : t.text, background: t.input, boxSizing: 'border-box', fontFamily: "'Inter',sans-serif" }} />
            {overdue && <p style={{ fontSize: 10, color: t.danger, marginTop: 3, display: 'flex', alignItems: 'center', gap: 2 }}><Ic.Slash width={8} height={8} />Overdue</p>}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Assignees</label>
            {members.map(m => <div key={m.id} onClick={() => handleAssign(m.name)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', marginBottom: 2, background: assignees.includes(m.name) ? t.accentBg : 'transparent', border: `1px solid ${assignees.includes(m.name) ? t.border2 : 'transparent'}`, transition: 'all .1s' }}>
              <Av name={m.name} color={m.color} size={18} />
              <span style={{ fontSize: 12, color: t.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>{m.name}</span>
              {assignees.includes(m.name) && <Ic.Check width={9} height={9} style={{ color: t.text2, flexShrink: 0 }} />}
            </div>)}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Labels</label>
            {LABELS.map((lc, i) => {
              const [bg, fg] = dark ? lc.d : lc.l; return <button key={i} onClick={() => handleLabel(i)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 6px', borderRadius: 6, border: labels.includes(i) ? `1px solid ${fg}30` : '1px solid transparent', background: labels.includes(i) ? bg : 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: labels.includes(i) ? fg : t.text2, marginBottom: 2, fontFamily: "'Inter',sans-serif", transition: 'all .1s', letterSpacing: '-.01em' }}>
                <div style={{ width: 6, height: 6, borderRadius: 2, background: fg, flexShrink: 0 }} />{lc.name}
                {labels.includes(i) && <Ic.Check width={8} height={8} style={{ marginLeft: 'auto', color: fg }} />}
              </button>
            })}
          </div>
          <button onClick={() => { if (window.confirm('Delete this task?')) { onDelete(task.id); onClose() } }} style={{ width: '100%', padding: '7px 0', borderRadius: 6, border: `1px solid ${t.danger}20`, background: t.dangerBg, color: t.danger, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: "'Inter',sans-serif", transition: 'background .1s', letterSpacing: '-.01em' }}><Ic.Trash width={11} height={11} />Delete task</button>
        </div>
      </div>
    </div>
  </Modal>
}

// ─── SEARCH MODAL ────────────────────────────────────────────────────────────
function SearchModal({ tasks, columns, members, dark, onTaskClick, onClose }) {
  const { t } = useTheme()
  const [q, setQ] = useState('')
  const ref = useRef()
  useEffect(() => ref.current?.focus(), [])
  const results = useMemo(() => { if (!q.trim()) return []; const lo = q.toLowerCase(); return tasks.filter(x => !x.archived && (x.title.toLowerCase().includes(lo) || x.description?.toLowerCase().includes(lo))).slice(0, 10) }, [q, tasks])
  return <Modal onClose={onClose} width={520}>
    <div style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: 10, overflow: 'hidden', boxShadow: `0 24px 64px ${t.shadow2}` }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${t.border}` }}>
        <Ic.Search width={15} height={15} style={{ color: t.text3, flexShrink: 0 }} />
        <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: t.text, background: 'transparent', fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em' }} />
        <kbd style={{ fontSize: 10, background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 4, padding: '2px 6px', color: t.text3, fontFamily: "'DM Mono',monospace" }}>ESC</kbd>
      </div>
      {results.length > 0 ? <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {results.map(task => {
          const col = columns.find(c => c.id === task.columnId); const p = PRI[task.priority] || PRI.none; return <div key={task.id} onClick={() => { onTaskClick(task); onClose() }} style={{ padding: '10px 16px', borderBottom: `1px solid ${t.divider}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s' }} onMouseEnter={e => e.currentTarget.style.background = dark ? t.surface2 : t.canvas} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ width: 2.5, height: 28, borderRadius: 99, background: p.hex, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>{task.title}</p>
              <p style={{ fontSize: 11, color: t.text3, marginTop: 1, letterSpacing: '-.01em' }}>{col?.name} · {task.createdBy}</p>
            </div>
            <div style={{ display: 'flex' }}>{members.filter(m => (task.assignees || []).includes(m.name)).slice(0, 3).map((m, i) => <Av key={m.id} name={m.name} color={m.color} size={19} sx={{ marginLeft: i ? -5 : 0, boxShadow: `0 0 0 1.5px ${t.surface}` }} />)}</div>
          </div>
        })}
      </div> : <div style={{ padding: '28px 0', textAlign: 'center', color: t.text3, fontSize: 13, letterSpacing: '-.01em' }}>{q ? `No results for "${q}"` : 'Start typing to search…'}</div>}
    </div>
  </Modal>
}

// ─── AUDIT PANEL ─────────────────────────────────────────────────────────────
function AuditPanel({ logs, members, onClose }) {
  const { t, dark } = useTheme()
  const [cat, setCat] = useState('ALL')
  const [q, setQ] = useState('')
  const CATS = ['ALL', 'TASK', 'COLUMN', 'MEMBER', 'COMMENT', 'BOARD']
  const filtered = useMemo(() => { let l = [...logs]; if (cat !== 'ALL') l = l.filter(e => e.category === cat); if (q) l = l.filter(e => JSON.stringify(e).toLowerCase().includes(q.toLowerCase())); return l }, [logs, cat, q])
  return <div style={{ width: 320, background: t.surface, borderLeft: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', animation: 'slideIn .2s cubic-bezier(.16,1,.3,1)', flexShrink: 0 }}>
    <div style={{ padding: '11px 13px', borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Ic.Term width={13} height={13} style={{ color: t.text2 }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: t.text, letterSpacing: '-.02em' }}>Audit Log</span>
          <span style={{ fontSize: 9.5, background: dark ? t.surface2 : t.canvas, color: t.text3, borderRadius: 4, padding: '1px 5px', fontWeight: 600, fontFamily: "'DM Mono',monospace", border: `1px solid ${t.border}` }}>{logs.length}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.X width={13} height={13} /></button>
      </div>
      <div style={{ position: 'relative', marginBottom: 7 }}>
        <Ic.Search width={10} height={10} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: t.text3 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" style={{ width: '100%', paddingLeft: 22, paddingRight: 8, paddingTop: 5, paddingBottom: 5, border: `1px solid ${t.border2}`, borderRadius: 6, fontSize: 11.5, color: t.text, background: t.input, outline: 'none', fontFamily: "'Inter',sans-serif", boxSizing: 'border-box', letterSpacing: '-.01em' }} />
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {CATS.map(c => <button key={c} onClick={() => setCat(c)} style={{ padding: '2px 7px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: "'Inter',sans-serif", fontSize: 9.5, fontWeight: 600, background: cat === c ? (LOG_C[c] || t.text) : dark ? t.surface2 : t.canvas, color: cat === c ? '#fff' : t.text3, transition: 'all .12s', letterSpacing: '.01em' }}>{c}</button>)}
      </div>
    </div>
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {filtered.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: t.text3, fontSize: 12, letterSpacing: '-.01em' }}><Ic.Term width={20} height={20} style={{ display: 'block', margin: '0 auto 8px', opacity: .15 }} />No entries</div>
        : filtered.map((e, i) => {
          const cc = LOG_C[e.category] || t.text2
          const meta = { ...e.meta, ...e.after, fromColumn: e.before?.columnName, toColumn: e.after?.columnName }
          return <div key={e.id || i} style={{ padding: '7px 12px', borderBottom: `1px solid ${t.divider}`, display: 'flex', gap: 7, animation: i === 0 ? 'slideUp .15s ease' : 'none' }}>
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: cc }} />
              <span style={{ fontSize: 8, color: t.text3, fontFamily: "'DM Mono',monospace" }}>#{e.seq}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: cc, textTransform: 'uppercase', letterSpacing: '.04em' }}>{e.category}</span>
                <span style={{ fontSize: 8.5, fontFamily: "'DM Mono',monospace", color: t.text3, background: dark ? t.surface2 : t.canvas, borderRadius: 3, padding: '0 4px', border: `1px solid ${t.border}` }}>{e.action}</span>
              </div>
              <p style={{ fontSize: 11.5, color: t.text, lineHeight: 1.4, letterSpacing: '-.01em' }}><strong>{e.actorName}</strong>{' '}{fmtAction(e.action, meta)}{e.entity && e.entity !== e.actorName && <span style={{ color: t.text2 }}> — <em>"{e.entity}"</em></span>}</p>
              <p style={{ fontSize: 9, color: t.text3, marginTop: 2, fontFamily: "'DM Mono',monospace" }}>{monoTs(e.timestamp)} · {relTime(e.timestamp)}</p>
              {(e.before && Object.keys(e.before).length > 0 || e.after && Object.keys(e.after).length > 0) && <div style={{ marginTop: 3, fontSize: 9, fontFamily: "'DM Mono',monospace", borderRadius: 4, overflow: 'hidden', border: `1px solid ${t.border}` }}>
                {e.before && Object.keys(e.before).length > 0 && <div style={{ background: 'rgba(220,38,38,0.06)', padding: '2px 6px', color: '#dc2626', lineHeight: 1.5 }}>{Object.entries(e.before).slice(0, 2).map(([k, v]) => <div key={k}>- {k}: {JSON.stringify(v)?.slice(0, 28)}</div>)}</div>}
                {e.after && Object.keys(e.after).length > 0 && <div style={{ background: 'rgba(22,163,74,0.06)', padding: '2px 6px', color: '#16a34a', lineHeight: 1.5 }}>{Object.entries(e.after).slice(0, 2).map(([k, v]) => <div key={k}>+ {k}: {JSON.stringify(v)?.slice(0, 28)}</div>)}</div>}
              </div>}
            </div>
          </div>
        })}
    </div>
    <div style={{ padding: '7px 12px', borderTop: `1px solid ${t.border}`, flexShrink: 0 }}>
      <p style={{ fontSize: 9, color: t.text3, fontFamily: "'DM Mono',monospace" }}>{filtered.length}/{logs.length} entries · rolling 1000</p>
    </div>
  </div>
}

function renderActivityTab(logs, members, t) {
  if (logs.length === 0) return <div style={{ padding: 24, textAlign: 'center', color: t.text3, fontSize: 12, letterSpacing: '-.01em' }}>No activity yet</div>
  return logs.slice(0, 50).map(function (e, i) {
    var m = members.find(function (x) { return x.name === e.actorName })
    var meta = Object.assign({}, e.meta, e.after, { fromColumn: e.before && e.before.columnName, toColumn: e.after && e.after.columnName })
    return React.createElement('div', { key: e.id || i, style: { padding: '8px 12px', borderBottom: '1px solid ' + t.divider, display: 'flex', gap: 8 } },
      React.createElement(Av, { name: e.actorName, color: m && m.color || t.text2, size: 22, sx: { flexShrink: 0, marginTop: 1 } }),
      React.createElement('div', null,
        React.createElement('p', { style: { fontSize: 12, color: t.text, lineHeight: 1.4, letterSpacing: '-.01em' } },
          React.createElement('strong', null, e.actorName), ' ', fmtAction(e.action, meta),
          e.entity && e.entity !== e.actorName && React.createElement('span', { style: { color: t.text2 } }, ' "' + e.entity + '"')
        ),
        React.createElement('p', { style: { fontSize: 10, color: t.text3, marginTop: 2 } }, relTime(e.timestamp))
      )
    )
  })
}

// ─── MEMBERS PANEL ───────────────────────────────────────────────────────────
function MembersPanel({ members, logs, myName, onClose }) {
  const { t, dark } = useTheme()
  const [tab, setTab] = useState('members')
  return <div style={{ width: 256, background: t.surface, borderLeft: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', animation: 'slideIn .2s cubic-bezier(.16,1,.3,1)', flexShrink: 0 }}>
    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {['members', 'activity'].map(tb => <button key={tb} onClick={() => setTab(tb)} style={{ padding: '3px 9px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: "'Inter',sans-serif", background: tab === tb ? dark ? t.surface2 : t.canvas : 'transparent', fontSize: 12, fontWeight: tab === tb ? 600 : 400, color: tab === tb ? t.text : t.text3, textTransform: 'capitalize', letterSpacing: '-.01em' }}>{tb === 'members' ? `Members (${members.length})` : 'Activity'}</button>)}
      </div>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text3, transition: 'color .1s' }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.text3}><Ic.X width={13} height={13} /></button>
    </div>
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {tab === 'members' && members.map(m => <div key={m.id} style={{ padding: '9px 12px', borderBottom: `1px solid ${t.divider}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <Av name={m.name} color={m.color} size={30} />
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%', background: t.success, border: `2px solid ${t.surface}` }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.02em' }}>{m.name}{m.name === myName && <span style={{ fontSize: 10, color: t.text3, fontWeight: 400 }}> (you)</span>}</p>
          <p style={{ fontSize: 10.5, color: t.text3, textTransform: 'capitalize', letterSpacing: '-.01em' }}>{m.role}</p>
        </div>
        {m.activeTaskId && <span style={{ fontSize: 9.5, background: t.accentBg, color: t.text2, borderRadius: 4, padding: '2px 6px', flexShrink: 0, letterSpacing: '-.01em' }}>viewing</span>}
      </div>)}
      {tab === 'activity' && renderActivityTab(logs, members, t)}
    </div>
  </div>
}

// ─── BOARD ───────────────────────────────────────────────────────────────────
function Board({ roomId, userName, onLeave }) {
  const { dark, toggle, t } = useTheme()
  const showToast = useToast()
  const [room, setRoom] = useState(null)
  const [columns, setColumns] = useState([])
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [logs, setLogs] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [activeDrag, setActiveDrag] = useState(null)
  const [addingCol, setAddingCol] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterPri, setFilterPri] = useState('all')
  const [filterMember, setFilterMember] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [renamingBoard, setRenamingBoard] = useState(false)
  const [boardName, setBoardName] = useState('')
  const sock = useMemo(() => getSock(), [])
  const rollbackRef = useRef(null)

  useEffect(() => { const h = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true) } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])

  useEffect(() => {
    sock.emit('join:room', { roomId, userName })
    const on = (ev, fn) => sock.on(ev, fn)
    on('room:state', ({ room }) => { setRoom(room); setBoardName(room.name); setColumns(room.columns.sort((a, b) => a.position - b.position)); setTasks(room.tasks); setMembers(room.members); setLogs(room.logs || []) })
    on('connect_error', () => setError('Cannot connect — is the server running on port 3001?'))
    on('error', ({ message }) => setError(message))
    on('member:joined', ({ member, log }) => { setMembers(p => p.find(m => m.id === member.id) ? p : [...p, member]); if (log) setLogs(p => [log, ...p]); showToast(`${member.name} joined`, 'info') })
    on('member:left', ({ members: u, log }) => { setMembers(u); if (log) setLogs(p => [log, ...p]) })
    on('presence:update', ({ members: u }) => setMembers(u))
    on('task:created', ({ task, log }) => { setTasks(p => [...p, task]); if (log) setLogs(p => [log, ...p]) })
    on('task:moved', ({ task, log }) => { setTasks(p => p.map(x => x.id === task.id ? task : x)); if (log) setLogs(p => [log, ...p]); rollbackRef.current = null })
    on('task:updated', ({ task, log }) => { setTasks(p => p.map(x => x.id === task.id ? task : x)); setSelectedTask(p => p?.id === task.id ? task : p); if (log) setLogs(p => [log, ...p]) })
    on('task:deleted', ({ taskId, log }) => { setTasks(p => p.filter(x => x.id !== taskId)); setSelectedTask(p => p?.id === taskId ? null : p); if (log) setLogs(p => [log, ...p]) })
    on('comment:added', ({ taskId, comment, log }) => { setTasks(p => p.map(x => x.id === taskId ? { ...x, comments: [...(x.comments || []), comment] } : x)); setSelectedTask(p => p?.id === taskId ? { ...p, comments: [...(p.comments || []), comment] } : p); if (log) setLogs(p => [log, ...p]) })
    on('comment:deleted', ({ taskId, commentId, log }) => { setTasks(p => p.map(x => x.id === taskId ? { ...x, comments: (x.comments || []).filter(c => c.id !== commentId) } : x)); setSelectedTask(p => p?.id === taskId ? { ...p, comments: (p.comments || []).filter(c => c.id !== commentId) } : p); if (log) setLogs(p => [log, ...p]) })
    on('column:created', ({ column, log }) => { setColumns(p => [...p, column].sort((a, b) => a.position - b.position)); if (log) setLogs(p => [log, ...p]) })
    on('column:renamed', ({ columnId, name, log }) => { setColumns(p => p.map(c => c.id === columnId ? { ...c, name } : c)); if (log) setLogs(p => [log, ...p]) })
    on('column:deleted', ({ columnId, log }) => { setColumns(p => p.filter(c => c.id !== columnId)); if (log) setLogs(p => [log, ...p]) })
    on('column:updated', ({ column, log }) => { setColumns(p => p.map(c => c.id === column.id ? column : c)); if (log) setLogs(p => [log, ...p]) })
    on('board:renamed', ({ name, log }) => { setRoom(p => ({ ...p, name })); setBoardName(name); if (log) setLogs(p => [log, ...p]) })
    on('log:new', e => { setLogs(p => { if (p.find(x => x.id === e.id)) return p; return [e, ...p].slice(0, 1000) }) })
    on('conflict:rejected', ({ serverTask }) => { setTasks(p => p.map(x => x.id === serverTask.id ? serverTask : x)); if (rollbackRef.current) { rollbackRef.current(); rollbackRef.current = null } showToast('Conflict resolved — reverted', 'warn') })
    return () => ['room:state', 'connect_error', 'error', 'member:joined', 'member:left', 'presence:update', 'task:created', 'task:moved', 'task:updated', 'task:deleted', 'comment:added', 'comment:deleted', 'column:created', 'column:renamed', 'column:deleted', 'column:updated', 'board:renamed', 'log:new', 'conflict:rejected'].forEach(e => sock.off(e))
  }, [roomId])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragStart = useCallback(e => { const task = tasks.find(x => x.id === e.active.id); if (task) setActiveDrag(task) }, [tasks])
  const handleDragEnd = useCallback(e => {
    setActiveDrag(null)
    const { active, over } = e
    if (!over || active.id === over.id) { rollbackRef.current = null; return }
    const dragged = tasks.find(x => x.id === active.id); if (!dragged) return
    const overTask = tasks.find(x => x.id === over.id)
    const targetColId = overTask?.columnId ?? over.id
    const colTasks = tasks.filter(x => x.columnId === targetColId && x.id !== dragged.id && !x.archived).sort((a, b) => a.position - b.position)
    const overIdx = overTask ? colTasks.findIndex(x => x.id === over.id) : colTasks.length
    const newPos = between(colTasks[overIdx - 1]?.position ?? null, colTasks[overIdx]?.position ?? null)
    const prev = { ...dragged }
    rollbackRef.current = () => setTasks(p => p.map(x => x.id === prev.id ? prev : x))
    setTasks(p => p.map(x => x.id === dragged.id ? { ...x, columnId: targetColId, position: newPos, version: x.version + 1 } : x))
    sock.emit('task:move', { taskId: dragged.id, columnId: targetColId, position: newPos, version: dragged.version })
  }, [tasks])

  const filteredTasks = useMemo(() => {
    let r = showArchived ? tasks : tasks.filter(x => !x.archived)
    if (search) r = r.filter(x => x.title.toLowerCase().includes(search.toLowerCase()))
    if (filterPri !== 'all') r = r.filter(x => x.priority === filterPri)
    if (filterMember !== 'all') r = r.filter(x => (x.assignees || []).includes(filterMember))
    return r
  }, [tasks, search, filterPri, filterMember, showArchived])

  const handleBoardRename = () => { if (boardName.trim() && boardName.trim() !== room?.name) sock.emit('board:rename', { name: boardName.trim() }); setRenamingBoard(false) }

  const selSt = { border: `1px solid ${t.border2}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, color: t.text, background: t.input, outline: 'none', cursor: 'pointer', fontFamily: "'Inter',sans-serif", minWidth: 100, letterSpacing: '-.01em' }

  if (error) return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: t.bg }}><Ic.Slash width={32} height={32} style={{ color: t.danger, opacity: .4 }} /><p style={{ color: t.danger, fontWeight: 500, maxWidth: 320, textAlign: 'center', fontSize: 14, letterSpacing: '-.01em' }}>{error}</p><Btn primary onClick={onLeave}>Back to home</Btn></div>
  if (!room) return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: t.bg }}><div style={{ width: 28, height: 28, border: `2px solid ${t.border2}`, borderTop: `2px solid ${t.text}`, borderRadius: '50%', animation: 'spin .7s linear infinite' }} /><p style={{ color: t.text3, fontSize: 13, fontFamily: "'Inter',sans-serif", letterSpacing: '-.01em' }}>Connecting…</p></div>

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg, overflow: 'hidden' }}>
    <header style={{ background: t.header, borderBottom: `1px solid ${t.border}`, padding: '0 16px', height: 48, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Ic.Layers width={11} height={11} style={{ color: dark ? '#000' : '#fff' }} />
        </div>
        {renamingBoard
          ? <input autoFocus value={boardName} onChange={e => setBoardName(e.target.value)} onBlur={handleBoardRename} onKeyDown={e => { if (e.key === 'Enter') handleBoardRename(); if (e.key === 'Escape') { setBoardName(room.name); setRenamingBoard(false) } }} style={{ background: 'transparent', border: 'none', borderBottom: `1.5px solid ${t.text}`, outline: 'none', fontSize: 13, fontWeight: 600, color: t.text, fontFamily: "'Inter',sans-serif", width: 150, letterSpacing: '-.03em' }} />
          : <span onDoubleClick={() => setRenamingBoard(true)} title="Double-click to rename" style={{ fontWeight: 600, fontSize: 13, color: t.text, cursor: 'default', letterSpacing: '-.03em' }}>{room.name}</span>
        }
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 99, padding: '2px 7px', flexShrink: 0 }}>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', letterSpacing: '.05em' }}>LIVE</span>
      </div>
      <code style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.text3, background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 4, padding: '2px 6px', flexShrink: 0, letterSpacing: '.06em' }}>{roomId}</code>
      <div style={{ flex: 1, maxWidth: 220, position: 'relative' }}>
        <Ic.Search width={11} height={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: t.text3 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search  ⌘K" style={{ width: '100%', paddingLeft: 25, paddingRight: 8, paddingTop: 5, paddingBottom: 5, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 12, outline: 'none', color: t.text, background: t.input, boxSizing: 'border-box', fontFamily: "'Inter',sans-serif", transition: 'border .12s', letterSpacing: '-.01em' }} onFocus={e => e.target.style.borderColor = t.text} onBlur={e => e.target.style.borderColor = t.border} />
      </div>
      <select value={filterPri} onChange={e => setFilterPri(e.target.value)} style={selSt}>
        <option value="all">All priority</option>
        {Object.entries(PRI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <select value={filterMember} onChange={e => setFilterMember(e.target.value)} style={selSt}>
        <option value="all">All members</option>
        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>
      <Tip label={showArchived ? 'Hide archived' : 'Show archived'} pos='bottom'>
        <button onClick={() => setShowArchived(v => !v)} style={{ background: showArchived ? t.accentBg : 'none', border: `1px solid ${showArchived ? t.border2 : t.border}`, borderRadius: 5, padding: '4px 6px', cursor: 'pointer', color: showArchived ? t.text : t.text2, display: 'flex', transition: 'all .12s' }}><Ic.Arc width={12} height={12} /></button>
      </Tip>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {members.slice(0, 5).map((m, i) => <Tip key={m.id} label={m.name + (m.name === userName ? ' (you)' : '')}><Av name={m.name} color={m.color} size={22} sx={{ marginLeft: i === 0 ? 0 : -6, boxShadow: `0 0 0 2px ${t.header}`, cursor: 'default' }} /></Tip>)}
        {members.length > 5 && <span style={{ fontSize: 10, color: t.text3, marginLeft: 3 }}>+{members.length - 5}</span>}
        <span style={{ fontSize: 10.5, color: t.text3, marginLeft: 4, flexShrink: 0, letterSpacing: '-.01em' }}>{members.length} online</span>
      </div>
      <Tip label="Search ⌘K" pos='bottom'><button onClick={() => setShowSearch(true)} style={{ background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 5, padding: '4px 7px', cursor: 'pointer', color: t.text2, display: 'flex', alignItems: 'center', gap: 3, transition: 'border-color .1s' }} onMouseEnter={e => e.currentTarget.style.borderColor = t.text} onMouseLeave={e => e.currentTarget.style.borderColor = t.border}><Ic.Cmd width={11} height={11} /><span style={{ fontSize: 10, fontWeight: 600 }}>K</span></button></Tip>
      <Tip label="Members & activity" pos='bottom'><button onClick={() => { setShowMembers(v => !v); if (showAudit) setShowAudit(false) }} style={{ background: showMembers ? t.accentBg : 'none', border: `1px solid ${showMembers ? t.border2 : t.border}`, borderRadius: 5, padding: '4px 6px', cursor: 'pointer', color: showMembers ? t.text : t.text2, display: 'flex', transition: 'all .12s' }}><Ic.Users width={13} height={13} /></button></Tip>
      <Tip label="Audit log" pos='bottom'><button onClick={() => { setShowAudit(v => !v); if (showMembers) setShowMembers(false) }} style={{ background: showAudit ? t.accentBg : 'none', border: `1px solid ${showAudit ? t.border2 : t.border}`, borderRadius: 5, padding: '4px 6px', cursor: 'pointer', color: showAudit ? t.text : t.text2, display: 'flex', alignItems: 'center', gap: 3, transition: 'all .12s' }}>
        <Ic.Term width={12} height={12} />
        {logs.length > 0 && <span style={{ fontSize: 8.5, background: t.text, color: dark ? '#000' : '#fff', borderRadius: 99, padding: '0 4px', fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{Math.min(logs.length, 999)}</span>}
      </button></Tip>
      <Tip label={dark ? 'Light mode' : 'Dark mode'} pos='bottom'><button onClick={toggle} style={{ background: dark ? t.surface2 : t.canvas, border: `1px solid ${t.border}`, borderRadius: 5, padding: '4px 6px', cursor: 'pointer', color: t.text2, display: 'flex', transition: 'border-color .1s' }} onMouseEnter={e => e.currentTarget.style.borderColor = t.text} onMouseLeave={e => e.currentTarget.style.borderColor = t.border}>{dark ? <Ic.Sun width={13} height={13} /> : <Ic.Moon width={13} height={13} />}</button></Tip>
      <button onClick={() => setShowInvite(true)} style={{ background: t.text, border: 'none', borderRadius: 6, padding: '5px 13px', cursor: 'pointer', color: dark ? '#000' : '#fff', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", flexShrink: 0, transition: 'opacity .1s', letterSpacing: '-.01em' }} onMouseEnter={e => e.currentTarget.style.opacity = '.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
        <Ic.Users width={11} height={11} />Invite
        <span style={{ background: dark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)', borderRadius: 3, padding: '0 5px', fontSize: 9.5, fontFamily: "'DM Mono',monospace", letterSpacing: '.06em' }}>{roomId}</span>
      </button>
    </header>

    <StatsBar tasks={tasks} columns={columns} members={members} />

    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '18px 18px' }}>
        <DndContext sensors={sensors} collisionDetection={closestCorners} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 12, height: '100%', alignItems: 'flex-start', minWidth: 'min-content' }}>
            {columns.map(col => <Column key={col.id} column={col} dark={dark} tasks={filteredTasks.filter(x => x.columnId === col.id).sort((a, b) => a.position - b.position)} members={members} onTaskClick={setSelectedTask} onAdd={(id, title) => sock.emit('task:create', { columnId: id, title })} onRename={(id, name) => sock.emit('column:rename', { columnId: id, name })} onDelete={id => sock.emit('column:delete', { columnId: id })} onSetWip={(id, limit) => sock.emit('column:set_wip', { columnId: id, limit })} viewingUsers={members} />)}
            <div style={{ flexShrink: 0, width: 252 }}>
              {addingCol
                ? <div style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: 8, padding: 12, animation: 'fadeUp .12s ease', boxShadow: `0 4px 20px ${t.shadow}` }}>
                  <input autoFocus value={newColName} onChange={e => setNewColName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newColName.trim()) { sock.emit('column:create', { name: newColName.trim() }); setNewColName(''); setAddingCol(false) } if (e.key === 'Escape') { setAddingCol(false); setNewColName('') } }} placeholder="Column name…" style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, fontWeight: 600, color: t.text, background: 'transparent', fontFamily: "'Inter',sans-serif", boxSizing: 'border-box', marginBottom: 9, letterSpacing: '-.02em' }} />
                  <div style={{ display: 'flex', gap: 5 }}>
                    <Btn primary small onClick={() => { if (newColName.trim()) { sock.emit('column:create', { name: newColName.trim() }); setNewColName(''); setAddingCol(false) } }}>Add column</Btn>
                    <Btn small onClick={() => { setAddingCol(false); setNewColName('') }}>Cancel</Btn>
                  </div>
                </div>
                : <button onClick={() => setAddingCol(true)} style={{ width: '100%', background: 'transparent', border: `1px dashed ${t.border2}`, borderRadius: 8, padding: '11px 13px', cursor: 'pointer', color: t.text3, fontSize: 12.5, fontWeight: 400, fontFamily: "'Inter',sans-serif", display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s', letterSpacing: '-.01em' }} onMouseEnter={e => { e.currentTarget.style.borderColor = t.text; e.currentTarget.style.color = t.text }} onMouseLeave={e => { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.color = t.text3 }}>
                  <Ic.Plus width={13} height={13} />Add column
                </button>
              }
            </div>
          </div>
          <DragOverlay dropAnimation={{ duration: 380, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)', dragSourceOpacity: 0 }} style={{ cursor: 'grabbing' }}>
            {activeDrag && <div style={{ width: 268, filter: `drop-shadow(0 20px 48px ${dark ? 'rgba(0,0,0,.85)' : 'rgba(0,0,0,.25)'})`, animation: 'lift .1s ease forwards' }}>
              <TaskCard task={activeDrag} members={members} onClick={() => { }} viewingUsers={[]} isOverlay dark={dark} />
            </div>}
          </DragOverlay>
        </DndContext>
      </div>
      {showAudit && <AuditPanel logs={logs} members={members} onClose={() => setShowAudit(false)} />}
      {showMembers && <MembersPanel members={members} logs={logs} myName={userName} onClose={() => setShowMembers(false)} />}
    </div>

    {selectedTask && <TaskModal task={selectedTask} columns={columns} members={members} myName={userName} dark={dark} socket={sock} onClose={() => setSelectedTask(null)} onUpdate={(id, fields, version) => sock.emit('task:update', { taskId: id, fields, version })} onDelete={id => sock.emit('task:delete', { taskId: id })} onAddComment={(id, body) => sock.emit('comment:add', { taskId: id, body })} onDeleteComment={(tid, cid) => sock.emit('comment:delete', { taskId: tid, commentId: cid })} onArchive={id => sock.emit('task:update', { taskId: id, fields: { archived: true }, version: tasks.find(x => x.id === id)?.version || 1 })} onDuplicate={id => sock.emit('task:duplicate', { taskId: id })} />}
    {showSearch && <SearchModal tasks={tasks} columns={columns} members={members} dark={dark} onTaskClick={setSelectedTask} onClose={() => setShowSearch(false)} />}
    {showInvite && <InviteModal roomId={roomId} roomName={room.name} members={members} onClose={() => setShowInvite(false)} />}
  </div>
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────
function AppInner() {
  const [view, setView] = useState('landing')
  const [session, setSession] = useState(null)
  useEffect(() => { const r = new URLSearchParams(window.location.search).get('room'); if (r) setView('join') }, [])
  const handleJoin = ({ roomId, userName }) => { setSession({ roomId, userName }); setView('board'); window.history.replaceState({}, '', `?room=${roomId}`) }
  if (view === 'board' && session) return <Board roomId={session.roomId} userName={session.userName} onLeave={() => { setSession(null); setView('landing'); window.history.replaceState({}, '', '/') }} />
  if (view === 'join') return <JoinScreen onJoin={handleJoin} onBack={() => setView('landing')} />
  return <LandingPage onGetStarted={() => setView('join')} />
}

export default function App() {
  return <ThemeProvider><ToastProvider><GlobalStyles /><AppInner /></ToastProvider></ThemeProvider>
}