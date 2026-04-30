import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
import { createRoot } from 'react-dom/client';
const WS_URL =
  location.hostname === "localhost"
    ? "ws://localhost:3001"
    : "wss://canban-b3rx.onrender.com";

const uid = () => Math.random().toString(36).slice(2, 10);
const initials = n => (n||'?').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const fmtDate = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
};
const timeAgo = ts => {
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};

// ── Colors ────────────────────────────────────────────────────
const USER_COLORS = [
  '#2563EB','#7C3AED','#DB2777','#059669',
  '#D97706','#DC2626','#0891B2','#65A30D',
];
const COL_COLORS  = ['#F1F5F9','#FEF9EC','#F5F3FF','#F0FDF4','#FEF2F2','#E0F2FE','#FFF7ED'];

const PRIORITY = {
  urgent: { label:'Urgent', color:'#EF4444', bg:'#FEF2F2', dot:'#EF4444' },
  high:   { label:'High',   color:'#F97316', bg:'#FFF7ED', dot:'#F97316' },
  medium: { label:'Medium', color:'#F59E0B', bg:'#FFFBEB', dot:'#F59E0B' },
  low:    { label:'Low',    color:'#94A3B8', bg:'#F8FAFC', dot:'#94A3B8' },
};

const TAG_COLORS = {
  design:   '#7C3AED', backend:'#059669',  infra:'#DC2626',
  ux:       '#D97706', frontend:'#2563EB', devops:'#0891B2',
  bug:      '#EF4444', feature:'#8B5CF6',  research:'#D97706',
  auth:     '#7C3AED', docs:'#64748B',     test:'#0D9488',
};
const tagColor  = t => TAG_COLORS[t?.toLowerCase()] || '#64748B';
const tagBg     = t => tagColor(t) + '18';

// ── CSS ───────────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{font-family:'Instrument Sans',system-ui,sans-serif;font-size:14px;color:#0F172A;background:#F8FAFC;overflow:hidden;height:100dvh}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,textarea,select{font-family:inherit}
:root{
  --bg:#FFFFFF;--bg2:#F8FAFC;--bg3:#F1F5F9;--bg4:#E2E8F0;
  --t1:#0F172A;--t2:#475569;--t3:#94A3B8;--t4:#CBD5E1;
  --blue:#2563EB;--blue-l:#3B82F6;--blue-bg:#EFF6FF;--blue-bd:#BFDBFE;
  --bd:#E2E8F0;--bd2:#CBD5E1;
  --r:8px;--r2:10px;--r3:14px;--r4:20px;
  --sh:0 1px 3px rgba(15,23,42,.07),0 1px 2px rgba(15,23,42,.04);
  --sh2:0 4px 16px rgba(15,23,42,.08),0 2px 4px rgba(15,23,42,.04);
  --sh3:0 16px 48px rgba(15,23,42,.12),0 4px 12px rgba(15,23,42,.06);
  --sh4:0 24px 64px rgba(15,23,42,.16),0 8px 16px rgba(15,23,42,.08);
  --mono:'JetBrains Mono',monospace;
}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bd);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--bd2)}

/* ── Splash / Gate ── */
.gate{position:fixed;inset:0;background:#0F172A;display:flex;align-items:center;justify-content:center;z-index:9999}
.gate__bg{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 40%,#1E3A8A22 0%,transparent 60%),radial-gradient(ellipse at 70% 60%,#7C3AED18 0%,transparent 60%)}
.gate__card{position:relative;background:var(--bg);border-radius:20px;padding:44px;width:440px;max-width:calc(100vw - 32px);box-shadow:var(--sh4);animation:slideUp .3s cubic-bezier(.34,1.3,.64,1)}
@keyframes slideUp{from{transform:translateY(20px) scale(.96);opacity:0}to{transform:none;opacity:1}}
.gate__logo{display:flex;align-items:center;gap:10px;margin-bottom:28px}
.gate__logo-icon{width:40px;height:40px;background:var(--t1);border-radius:10px;display:flex;align-items:center;justify-content:center}
.gate__logo-name{font-size:18px;font-weight:700;letter-spacing:-.03em}
.gate__logo-badge{font-size:10px;font-weight:600;background:var(--blue);color:#fff;padding:2px 8px;border-radius:99px;margin-left:2px;letter-spacing:.02em}
.gate__h{font-size:26px;font-weight:700;letter-spacing:-.04em;margin-bottom:8px;line-height:1.15}
.gate__sub{font-size:14px;color:var(--t2);margin-bottom:32px;line-height:1.55}
.gate__field{margin-bottom:20px}
.gate__label{display:block;font-size:11.5px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}
.gate__input{width:100%;padding:11px 14px;font-size:15px;font-weight:500;background:var(--bg2);border:1.5px solid var(--bd);border-radius:var(--r2);outline:none;color:var(--t1);transition:all .15s}
.gate__input:focus{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}
.gate__colors{display:flex;gap:8px;flex-wrap:wrap}
.gate__color{width:32px;height:32px;border-radius:50%;cursor:pointer;border:2.5px solid transparent;transition:all .12s;flex-shrink:0}
.gate__color--on{border-color:var(--t1);box-shadow:0 0 0 2px #fff,0 0 0 4px var(--t1)}
.gate__submit{margin-top:28px;width:100%;padding:13px;background:var(--t1);color:#fff;border-radius:var(--r2);font-size:15px;font-weight:700;letter-spacing:-.02em;transition:all .15s}
.gate__submit:hover{background:#1E293B}
.gate__submit:disabled{opacity:.4;cursor:not-allowed}
.gate__or{text-align:center;font-size:12px;color:var(--t3);margin:16px 0}
.gate__join{width:100%;padding:11px;background:var(--bg2);border:1.5px solid var(--bd);color:var(--t2);border-radius:var(--r2);font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;justify-content:center;transition:all .15s}
.gate__join:hover{border-color:var(--blue);color:var(--blue);background:var(--blue-bg)}
.gate__join-row{display:flex;gap:8px}
.gate__join-input{flex:1;padding:11px 14px;background:var(--bg2);border:1.5px solid var(--bd);border-radius:var(--r2);font-size:14px;font-weight:600;outline:none;color:var(--t1);letter-spacing:.06em;font-family:var(--mono);text-transform:uppercase}
.gate__join-input:focus{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}
.gate__join-btn{padding:11px 18px;background:var(--blue);color:#fff;border-radius:var(--r2);font-size:14px;font-weight:700;white-space:nowrap;transition:opacity .12s}
.gate__join-btn:hover{opacity:.85}
.gate__err{color:#EF4444;font-size:12.5px;margin-top:8px;font-weight:500}

/* ── App shell ── */
.app{display:flex;flex-direction:column;height:100dvh;background:var(--bg2)}

/* ── Header ── */
.hdr{display:flex;align-items:center;height:52px;background:var(--bg);border-bottom:1px solid var(--bd);flex-shrink:0;position:relative;z-index:100}
.hdr__section{display:flex;align-items:center;height:100%;padding:0 14px;gap:10px}
.hdr__section--brand{min-width:220px;border-right:1px solid var(--bd);flex-shrink:0;gap:8px}
.hdr__section--center{flex:1;justify-content:center;gap:8px}
.hdr__section--right{border-left:1px solid var(--bd);gap:8px;flex-shrink:0}
.hdr__logo{width:26px;height:26px;background:var(--t1);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.board-name-input{font-size:14px;font-weight:700;letter-spacing:-.02em;color:var(--t1);border:none;outline:none;background:none;cursor:text;width:160px;min-width:80px}
.board-name-input:hover{color:var(--blue)}
.board-name-input:focus{border-bottom:1.5px solid var(--blue)}
.hdr__roomcode{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--t3);background:var(--bg2);border:1px solid var(--bd);padding:3px 8px;border-radius:4px;letter-spacing:.06em;cursor:pointer;transition:all .12s;white-space:nowrap}
.hdr__roomcode:hover{background:var(--blue-bg);border-color:var(--blue-bd);color:var(--blue)}

/* Search */
.search{display:flex;align-items:center;gap:7px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:6px 11px;width:220px;transition:all .15s}
.search:focus-within{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg);width:260px}
.search input{border:none;outline:none;background:none;font-size:13px;color:var(--t1);flex:1;min-width:0}
.search input::placeholder{color:var(--t3)}

/* Filter chips */
.filters{display:flex;gap:4px}
.filter-chip{padding:4px 10px;border-radius:99px;font-size:12px;font-weight:600;color:var(--t3);border:1px solid transparent;transition:all .12s;white-space:nowrap}
.filter-chip:hover{background:var(--bg3);color:var(--t2)}
.filter-chip--on{background:var(--bg3);border-color:var(--bd);color:var(--t1)}

/* Presence */
.presence{display:flex;align-items:center}
.pav{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;border:2.5px solid #fff;margin-left:-8px;cursor:default;position:relative;transition:transform .12s;flex-shrink:0}
.pav:first-child{margin-left:0}
.pav:hover{transform:translateY(-2px) scale(1.08);z-index:5}
.pav__pip{position:absolute;bottom:-1px;right:-1px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;font-size:6px;display:flex;align-items:center;justify-content:center;font-weight:800}
.pav__pip--drag{background:#F59E0B}
.pav__pip--type{background:var(--blue)}
.pav__pip--edit{background:#8B5CF6}
.pav__more{width:30px;height:30px;border-radius:50%;background:var(--bg3);border:2.5px solid #fff;margin-left:-8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--t2)}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:var(--r);font-size:13px;font-weight:600;line-height:1;transition:all .12s;white-space:nowrap}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover{background:#1D4ED8}
.btn-ghost{color:var(--t2);border:1px solid var(--bd)}
.btn-ghost:hover{background:var(--bg3);color:var(--t1)}
.btn-ghost--on{background:var(--blue-bg);color:var(--blue);border-color:var(--blue-bd)}
.btn-danger{color:#EF4444}
.btn-danger:hover{background:#FEF2F2}
.btn-sm{padding:4px 10px;font-size:12px}
.btn-icon{padding:5px;border-radius:var(--r);color:var(--t3);transition:all .12s}
.btn-icon:hover{background:var(--bg3);color:var(--t1)}

/* Invite button */
.invite-btn{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:var(--r);font-size:12.5px;font-weight:600;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);transition:all .12s}
.invite-btn:hover{background:var(--blue-bd)}

/* ── Board ── */
.board-outer{flex:1;display:flex;overflow:hidden}
.board{display:flex;gap:10px;padding:16px 20px 20px;overflow-x:auto;overflow-y:hidden;flex:1;align-items:flex-start;scrollbar-width:thin;scrollbar-color:var(--bd2) transparent}
.board::-webkit-scrollbar{height:6px}

/* ── Column ── */
.col{width:278px;flex-shrink:0;border-radius:var(--r3);display:flex;flex-direction:column;max-height:calc(100dvh - 106px);background:var(--bg2);border:1px solid var(--bd);transition:box-shadow .15s,border-color .15s}
.col--over{border-color:var(--blue);box-shadow:0 0 0 3px var(--blue-bg)}
.col__hd{display:flex;align-items:center;justify-content:space-between;padding:11px 12px 9px;flex-shrink:0}
.col__hd-l{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.col__chip{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.col__name-input{font-size:13px;font-weight:700;color:var(--t1);border:none;outline:none;background:none;width:100%;letter-spacing:-.01em;cursor:text}
.col__name-input:focus{border-bottom:1.5px solid var(--blue)}
.col__ct{font-size:11px;color:var(--t3);font-weight:700;background:var(--bg3);padding:1px 7px;border-radius:99px;flex-shrink:0}
.col__actions{display:flex;gap:2px;opacity:0;transition:opacity .12s;flex-shrink:0}
.col:hover .col__actions{opacity:1}
.col__body{flex:1;overflow-y:auto;padding:0 8px 8px;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin}
.col__end-drop{min-height:12px;border-radius:var(--r);transition:all .15s;flex-shrink:0;margin:0 8px 4px}
.col__end-drop--on{min-height:52px;background:var(--blue-bg);border:1.5px dashed var(--blue-bd)}
.col__empty{text-align:center;padding:28px 16px;color:var(--t3);font-size:13px}
.col__empty-icon{font-size:28px;opacity:.3;margin-bottom:8px}
.col__ft{padding:6px 8px 10px;flex-shrink:0;border-top:1px solid var(--bd)}

/* ── Add card form ── */
.add-form{background:var(--bg);border:1.5px solid var(--blue);border-radius:var(--r2);box-shadow:0 0 0 3px var(--blue-bg);overflow:hidden}
.add-form__ta{width:100%;border:none;outline:none;resize:none;background:none;font-size:13.5px;color:var(--t1);line-height:1.5;padding:10px 12px 4px;min-height:56px}
.add-form__ta::placeholder{color:var(--t4)}
.add-form__bottom{padding:8px 10px 10px;display:flex;flex-direction:column;gap:8px}
.add-form__pris{display:flex;gap:4px;flex-wrap:wrap}
.pri-mini{display:flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:all .1s;color:var(--t3);background:var(--bg2)}
.pri-mini--on{border-color:currentColor}
.add-form__actions{display:flex;gap:6px}
.add-trigger{display:flex;align-items:center;gap:6px;width:100%;padding:7px 8px;border-radius:var(--r);font-size:13px;font-weight:500;color:var(--t3);transition:all .12s;text-align:left}
.add-trigger:hover{background:var(--bg3);color:var(--t2)}

/* ── Drop slot ── */
.card-slot{position:relative}
.card-slot--over::before{content:'';display:block;height:2px;background:var(--blue);border-radius:2px;margin-bottom:4px}

/* ── Card ── */
.kcard{background:var(--bg);border:1px solid var(--bd);border-radius:var(--r2);overflow:hidden;cursor:grab;box-shadow:var(--sh);transition:box-shadow .12s,transform .12s,border-color .12s,opacity .12s;position:relative}
.kcard::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--card-accent,transparent)}
.kcard:hover{box-shadow:var(--sh2);border-color:var(--bd2);transform:translateY(-1px)}
.kcard:active{cursor:grabbing}
.kcard--ghost{opacity:.25;transform:scale(.96);box-shadow:none;pointer-events:none}
.kcard--locked{border-color:#FCD34D}
.kcard__lock{display:flex;align-items:center;gap:5px;padding:4px 10px;background:#FFFBEB;font-size:11px;color:#92400E;font-weight:600;border-bottom:1px solid #FDE68A}
.kcard__body{padding:10px 11px 9px 14px}
.kcard__top{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:0}
.kcard__title{font-size:13.5px;font-weight:500;line-height:1.4;letter-spacing:-.01em;flex:1;color:var(--t1)}
.kcard__edit-btn{color:var(--t3);padding:2px 3px;border-radius:4px;opacity:0;transition:all .1s;flex-shrink:0;display:flex}
.kcard:hover .kcard__edit-btn{opacity:1}
.kcard__edit-btn:hover{background:var(--bg2);color:var(--blue)}
.kcard__desc{font-size:12px;color:var(--t2);line-height:1.45;margin-top:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kcard__tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:7px}
.kcard__tag{padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.kcard__meta{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.kcard__pri{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}
.kcard__dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.kcard__due{font-size:11px;font-weight:500;padding:2px 7px;border-radius:4px}
.kcard__due--ok{background:#F0FDF4;color:#15803D}
.kcard__due--soon{background:#FFFBEB;color:#92400E}
.kcard__due--over{background:#FEF2F2;color:#DC2626}
.kcard__footer-r{display:flex;align-items:center;gap:5px;margin-left:auto}
.kcard__assign{display:flex}
.kcard__assign-av{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;border:1.5px solid #fff;margin-left:-5px}
.kcard__assign-av:first-child{margin-left:0}
.kcard__typing{display:flex;align-items:center;gap:4px}
.kcard__dots{display:flex;gap:2px;align-items:flex-end}
.kcard__dots span{display:block;width:3px;height:3px;border-radius:50%;background:var(--blue);animation:td 1.2s infinite}
.kcard__dots span:nth-child(2){animation-delay:.2s}
.kcard__dots span:nth-child(3){animation-delay:.4s}
@keyframes td{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}
.kcard__ver{font-size:10px;color:var(--t4);font-family:var(--mono)}
.kcard__check{font-size:11px;color:var(--t3)}

/* ── Add column ── */
.add-col{width:240px;flex-shrink:0;height:42px;border:1.5px dashed var(--bd);border-radius:var(--r3);display:flex;align-items:center;gap:7px;padding:0 14px;color:var(--t3);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;align-self:flex-start}
.add-col:hover{border-color:var(--blue-bd);color:var(--blue);background:var(--blue-bg)}

/* ── Modal ── */
.modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.4);backdrop-filter:blur(6px);z-index:600;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px 32px;overflow-y:auto}
.modal{background:var(--bg);border-radius:16px;width:680px;max-width:100%;box-shadow:var(--sh4);animation:mIn .2s cubic-bezier(.34,1.1,.64,1);position:relative}
@keyframes mIn{from{transform:translateY(12px) scale(.96);opacity:0}to{transform:none;opacity:1}}
.modal__banner{height:5px;border-radius:16px 16px 0 0}
.modal__body{padding:24px 28px}
.modal__topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal__breadcrumb{display:flex;align-items:center;gap:8px}
.modal__colbadge{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:6px}
.modal__id{font-size:11px;color:var(--t4);font-family:var(--mono)}
.modal__close{color:var(--t3);padding:5px;border-radius:var(--r);transition:all .12s;flex-shrink:0}
.modal__close:hover{background:var(--bg2);color:var(--t1)}
.modal__title{width:100%;font-size:22px;font-weight:700;letter-spacing:-.04em;border:none;outline:none;resize:none;line-height:1.3;color:var(--t1);overflow:hidden;background:none;margin-bottom:20px}
.modal__title::placeholder{color:var(--t4)}
.modal__grid{display:grid;grid-template-columns:1fr 220px;gap:24px}
.modal__left{display:flex;flex-direction:column;gap:20px}
.modal__right{display:flex;flex-direction:column;gap:16px;border-left:1px solid var(--bd);padding-left:20px}
.modal__section{display:flex;flex-direction:column;gap:8px}
.modal__label{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;gap:6px}
.modal__pris{display:flex;gap:5px;flex-wrap:wrap}
.modal__pri{display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--r);font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid var(--bd);color:var(--t2);transition:all .12s}
.modal__pri:hover{border-color:var(--bd2)}
.modal__pri--on{border-color:var(--pri-c) !important;color:var(--pri-c);background:var(--pri-bg)}
.modal__desc-wrap{border:1px solid var(--bd);border-radius:var(--r2);background:var(--bg2);transition:all .15s}
.modal__desc-wrap:focus-within{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}
.modal__desc{width:100%;border:none;outline:none;resize:none;font-size:13.5px;line-height:1.65;color:var(--t1);background:none;min-height:88px;padding:10px 14px}
.modal__desc::placeholder{color:var(--t4)}
.modal__tags-wrap{display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:8px 12px;border:1px solid var(--bd);border-radius:var(--r2);background:var(--bg2);transition:all .15s;min-height:42px}
.modal__tags-wrap:focus-within{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}
.modal__tag{display:flex;align-items:center;gap:3px;padding:2px 8px;border-radius:5px;font-size:12px;font-weight:600}
.modal__tag-x{font-size:13px;opacity:.5;color:currentColor;transition:opacity .1s;line-height:1}
.modal__tag-x:hover{opacity:1}
.modal__tag-in{border:none;outline:none;background:none;font-size:13px;color:var(--t1);min-width:80px}
.modal__tag-in::placeholder{color:var(--t4)}
.modal__date-input{width:100%;padding:8px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);font-size:13px;color:var(--t1);outline:none;font-family:inherit;transition:all .15s}
.modal__date-input:focus{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}

/* Checklist */
.checklist{display:flex;flex-direction:column;gap:4px}
.check-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--r);transition:background .1s}
.check-item:hover{background:var(--bg2)}
.check-item input[type=checkbox]{width:15px;height:15px;accent-color:var(--blue);cursor:pointer;flex-shrink:0}
.check-item__text{font-size:13px;flex:1;line-height:1.4}
.check-item--done .check-item__text{text-decoration:line-through;color:var(--t3)}
.check-item__del{color:var(--t4);font-size:12px;opacity:0;transition:opacity .1s}
.check-item:hover .check-item__del{opacity:1}
.check-item__del:hover{color:#EF4444}
.add-check{display:flex;gap:8px;margin-top:4px}
.add-check__in{flex:1;padding:6px 10px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);font-size:13px;color:var(--t1);outline:none;transition:all .15s}
.add-check__in:focus{border-color:var(--blue);background:var(--bg)}
.add-check__btn{padding:6px 12px;background:var(--blue);color:#fff;border-radius:var(--r);font-size:13px;font-weight:600;transition:opacity .12s}
.add-check__btn:hover{opacity:.85}
.check-progress{height:4px;background:var(--bg3);border-radius:99px;margin-bottom:8px;overflow:hidden}
.check-progress__fill{height:100%;background:var(--blue);border-radius:99px;transition:width .3s}

/* Comments */
.comments{display:flex;flex-direction:column;gap:12px}
.comment{display:flex;gap:10px}
.comment__av{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px}
.comment__body{flex:1}
.comment__meta{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.comment__name{font-size:13px;font-weight:700}
.comment__time{font-size:11px;color:var(--t3)}
.comment__text{font-size:13.5px;line-height:1.6;color:var(--t1)}
.comment__form{display:flex;gap:10px;align-items:flex-start;margin-top:4px}
.comment__ta{flex:1;padding:8px 12px;background:var(--bg2);border:1.5px solid var(--bd);border-radius:var(--r2);font-size:13.5px;color:var(--t1);outline:none;resize:none;transition:all .15s;line-height:1.5}
.comment__ta:focus{border-color:var(--blue);background:var(--bg);box-shadow:0 0 0 3px var(--blue-bg)}

/* Modal right side */
.modal__meta-item{display:flex;flex-direction:column;gap:6px}
.modal__footer{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-top:1px solid var(--bd);background:var(--bg2);border-radius:0 0 16px 16px}
.modal__hint{font-size:11.5px;color:var(--t4)}
.modal__footer-actions{display:flex;gap:8px}

/* ── Activity panel ── */
.activity{width:300px;flex-shrink:0;background:var(--bg);border-left:1px solid var(--bd);display:flex;flex-direction:column;overflow:hidden}
.activity__hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--bd);flex-shrink:0}
.activity__title{font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.07em}
.activity__body{flex:1;overflow-y:auto;padding:8px}
.activity__empty{text-align:center;padding:24px;color:var(--t3);font-size:13px}
.act-item{display:flex;gap:8px;padding:6px 8px;border-radius:var(--r);transition:background .1s}
.act-item:hover{background:var(--bg2)}
.act-item__av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px}
.act-item__text{font-size:12.5px;line-height:1.45;color:var(--t2);flex:1}
.act-item__text strong{color:var(--t1);font-weight:600}
.act-item__time{font-size:10.5px;color:var(--t4);white-space:nowrap;margin-top:2px}

/* ── Toasts ── */
.toasts{position:fixed;bottom:20px;right:20px;z-index:700;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{display:flex;align-items:flex-start;gap:10px;padding:13px 15px;background:var(--bg);border:1px solid var(--bd);border-radius:12px;box-shadow:var(--sh3);min-width:268px;max-width:360px;animation:tIn .22s cubic-bezier(.34,1.1,.64,1)}
@keyframes tIn{from{transform:translateX(12px);opacity:0}to{transform:none;opacity:1}}
.toast--success{border-left:3px solid #10B981}
.toast--error  {border-left:3px solid #EF4444}
.toast--info   {border-left:3px solid var(--blue)}
.toast--warn   {border-left:3px solid #F59E0B}
.toast--collab {border-left:3px solid #8B5CF6}
.toast__icon{font-size:16px;flex-shrink:0;line-height:1.3}
.toast__body strong{display:block;font-size:13px;font-weight:700;color:var(--t1);margin-bottom:2px}
.toast__body p{font-size:12px;color:var(--t2);line-height:1.4}

/* ── Invite modal ── */
.invite-modal{background:var(--bg);border-radius:16px;width:480px;max-width:calc(100vw-32px);box-shadow:var(--sh4);padding:28px;animation:mIn .2s cubic-bezier(.34,1.1,.64,1)}
.invite-modal__h{font-size:20px;font-weight:700;letter-spacing:-.03em;margin-bottom:8px}
.invite-modal__sub{font-size:14px;color:var(--t2);margin-bottom:24px;line-height:1.5}
.invite-code-box{display:flex;align-items:center;gap:8px;background:var(--bg2);border:1.5px solid var(--bd);border-radius:var(--r2);padding:12px 16px;margin-bottom:16px}
.invite-code{font-family:var(--mono);font-size:22px;font-weight:700;letter-spacing:.12em;color:var(--t1);flex:1}
.invite-url-box{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:10px 14px;font-size:12.5px;color:var(--t2);word-break:break-all;line-height:1.5;margin-bottom:16px}
.invite-steps{display:flex;flex-direction:column;gap:8px}
.invite-step{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:var(--t2)}
.invite-step__n{width:20px;height:20px;border-radius:50%;background:var(--blue);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}

/* ── Responsive ── */
@media(max-width:900px){
  .hdr__section--center{display:none}
  .activity{display:none}
  .hdr__section--brand{min-width:unset}
  .board{padding:12px}
  .col{width:256px}
}
@media(max-width:580px){
  .col{width:240px}
  .hdr__section--right .btn span{display:none}
  .modal__grid{grid-template-columns:1fr}
  .modal__right{border-left:none;padding-left:0;border-top:1px solid var(--bd);padding-top:16px}
  .modal__body{padding:18px}
}
`;

const styleEl = document.createElement('style');
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

// ── WebSocket Hook ────────────────────────────────────────────
function useWS() {
  const wsRef          = useRef(null);
  const listeners      = useRef(new Map());
  const pingTimer      = useRef(null);
  const reconnTimer    = useRef(null);
  const attempts       = useRef(0);
  const intentional    = useRef(false);
  const pingTs         = useRef(null);
  const [connected, setConnected] = useState(false);
  const [latency, setLatency]     = useState(null);

  const emit = useCallback(msg => {
    (listeners.current.get(msg.type) || new Set()).forEach(h => h(msg));
    (listeners.current.get('*')      || new Set()).forEach(h => h(msg));
  }, []);

  const connect = useCallback(() => {
    const s = wsRef.current?.readyState;
    if (s === WebSocket.CONNECTING || s === WebSocket.OPEN) return;

    let sock;
    try { sock = new WebSocket(WS_URL); }
    catch (e) { console.error('[WS] construct failed:', e.message); return; }
    wsRef.current = sock;
    console.log("Connecting to WS:", WS_URL);
    sock.onopen = () => {
      attempts.current = 0;
      setConnected(true);
      clearInterval(pingTimer.current);
      pingTimer.current = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) {
          pingTs.current = Date.now();
          sock.send(JSON.stringify({ type: 'PING' }));
        }
      }, 20_000);
      console.log("WS Connected");
    };

    sock.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'PONG') {
        if (pingTs.current) { setLatency(Date.now() - pingTs.current); pingTs.current = null; }
        return;
      }
      emit(msg);
    };

    sock.onclose = ({ code }) => {
      clearInterval(pingTimer.current);
      setConnected(false);
      if (intentional.current) return;
      const delay = Math.min(1000 * 2 ** attempts.current, 30000);
      attempts.current++;
      reconnTimer.current = setTimeout(connect, delay);
      console.log("WS Disconnected");
    };

    sock.onerror = () => console.warn('[WS] error — will retry via onclose');
  }, [emit]);

  useEffect(() => {
    intentional.current = false;
    connect();
    return () => {
      intentional.current = true;
      clearInterval(pingTimer.current);
      clearTimeout(reconnTimer.current);
      wsRef.current?.close(1000, 'unmount');
    };
  }, [connect]);

  const send = useCallback(msg => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const on = useCallback((type, handler) => {
    if (!listeners.current.has(type)) listeners.current.set(type, new Set());
    listeners.current.get(type).add(handler);
    return () => listeners.current.get(type)?.delete(handler);
  }, []);

  return { send, on, connected, latency };
}

// ── Name / Join Gate ──────────────────────────────────────────
function Gate({ onEnter, wsConnected }) {
  const [name,    setName]    = useState(() => localStorage.getItem('kp-name') || '');
  const [color,   setColor]   = useState(() => localStorage.getItem('kp-color') || USER_COLORS[0]);
  const [mode,    setMode]    = useState('create'); // create | join
  const [code,    setCode]    = useState('');
  const [err,     setErr]     = useState('');
  const [boardNm, setBoardNm] = useState('My Board');

  const submit = () => {
    if (!name.trim()) { setErr('Please enter your name'); return; }
    localStorage.setItem('kp-name', name.trim());
    localStorage.setItem('kp-color', color);
    onEnter({ name: name.trim(), color, mode, code: code.trim().toUpperCase(), boardName: boardNm });
  };

  return (
    <div className="gate">
      <div className="gate__bg"/>
      <div className="gate__card">
        <div className="gate__logo">
          <div className="gate__logo-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L2.5 6.5v7L10 18l7.5-4.5v-7L10 2z" stroke="#fff" strokeWidth="1.6"/>
              <path d="M10 2v10M2.5 6.5l7.5 4 7.5-4" stroke="#fff" strokeWidth="1.6"/>
            </svg>
          </div>
          <span className="gate__logo-name">Kanban Pro</span>
          <span className="gate__logo-badge">LIVE</span>
        </div>

        <h2 className="gate__h">{mode==='join' ? 'Join a board' : 'Create your workspace'}</h2>
        <p className="gate__sub">
          {mode==='join'
            ? 'Enter the invite code shared with you to join an existing board in real-time.'
            : 'Start a new collaborative board. Share the invite code with your team.'}
        </p>

        <div className="gate__field">
          <label className="gate__label">Your name</label>
          <input className="gate__input" placeholder="e.g. Alex Johnson" value={name}
            onChange={e => { setName(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()} autoFocus maxLength={40} />
        </div>

        <div className="gate__field">
          <label className="gate__label">Your colour</label>
          <div className="gate__colors">
            {USER_COLORS.map(c => (
              <div key={c} className={`gate__color${color===c?' gate__color--on':''}`}
                style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        {mode === 'create' && (
          <div className="gate__field">
            <label className="gate__label">Board name</label>
            <input className="gate__input" placeholder="e.g. Product Roadmap Q3" value={boardNm}
              onChange={e => setBoardNm(e.target.value)} maxLength={60} />
          </div>
        )}

        {mode === 'join' && (
          <div className="gate__field">
            <label className="gate__label">Invite code</label>
            <div className="gate__join-row">
              <input className="gate__join-input" placeholder="e.g. A3F92B1C" value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setErr(''); }}
                onKeyDown={e => e.key === 'Enter' && submit()} maxLength={8} />
            </div>
          </div>
        )}

        {err && <p className="gate__err">⚠ {err}</p>}

        {!wsConnected && (
          <p className="gate__err" style={{ color:'#F59E0B' }}>
            ⏳ Connecting to server… make sure <code style={{fontFamily:'monospace'}}>cd server && npm start</code> is running.
          </p>
        )}

        <button className="gate__submit" onClick={submit} disabled={!name.trim() || !wsConnected}>
          {mode==='join' ? '→ Join board' : '→ Create board'}
        </button>

        <div className="gate__or">— or —</div>

        {mode === 'create' ? (
          <button className="gate__join" onClick={() => { setMode('join'); setErr(''); }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            Join with an invite code
          </button>
        ) : (
          <button className="gate__join" onClick={() => { setMode('create'); setErr(''); }}>
            ← Create a new board instead
          </button>
        )}
      </div>
    </div>
  );
}

// ── Invite Modal ──────────────────────────────────────────────
function InviteModal({ roomId, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}?room=${roomId}`;

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(()=>setCopied(false),2000); });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="invite-modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <h3 className="invite-modal__h">Invite collaborators</h3>
            <p className="invite-modal__sub">Share this code or link to let others join your board in real-time. Anyone with the code can collaborate instantly.</p>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ flexShrink:0 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div style={{ marginBottom:8, fontSize:12, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em' }}>Room Code</div>
        <div className="invite-code-box">
          <span className="invite-code">{roomId}</span>
          <button className="btn btn-primary btn-sm" onClick={()=>copy(roomId)}>
            {copied ? '✓ Copied!' : 'Copy code'}
          </button>
        </div>

        <div style={{ marginBottom:8, fontSize:12, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em' }}>Direct Link</div>
        <div className="invite-url-box">{url}</div>
        <button className="btn btn-ghost" style={{ width:'100%', justifyContent:'center', marginBottom:20 }} onClick={()=>copy(url)}>
          Copy link
        </button>

        <div style={{ marginBottom:12, fontSize:12, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.07em' }}>How it works</div>
        <div className="invite-steps">
          {[
            'Share the room code or link with your team',
            'They open the app and click "Join with invite code"',
            'Enter the code above and choose a name',
            'Everyone edits the same board in real-time!'
          ].map((s,i) => (
            <div key={i} className="invite-step">
              <div className="invite-step__n">{i+1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Card Modal ────────────────────────────────────────────────
function CardModal({ card, col, me, users, onSave, onDelete, onClose, ws }) {
  const [title, setTitle]   = useState(card.title || '');
  const [desc,  setDesc]    = useState(card.description || '');
  const [pri,   setPri]     = useState(card.priority || 'medium');
  const [tags,  setTags]    = useState(card.tags || []);
  const [tagIn, setTagIn]   = useState('');
  const [due,   setDue]     = useState(card.dueDate || '');
  const [checklist, setChecklist] = useState(card.checklist || []);
  const [checkIn, setCheckIn]     = useState('');
  const [comments, setComments]   = useState(card.comments || []);
  const [commentIn, setCommentIn] = useState('');
  const [tab, setTab]       = useState('details'); // details | checklist | comments
  const titleRef = useRef(null);

  useEffect(() => {
    ws.send({ type: 'EDITING_START', cardId: card.id });
    titleRef.current?.focus();
    const el = titleRef.current;
    if (el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
    return () => ws.send({ type: 'EDITING_STOP' });
  }, []);

  const notifyTyping = () => {
    ws.send({ type: 'TYPING_START', cardId: card.id });
  };

  const addTag = e => {
    if (e.key==='Enter' && tagIn.trim()) {
      const t = tagIn.trim().toLowerCase().replace(/\s+/g,'-');
      if (!tags.includes(t)) setTags(p=>[...p,t]);
      setTagIn('');
    }
  };

  const addCheckItem = () => {
    if (!checkIn.trim()) return;
    setChecklist(p=>[...p,{ id:uid(), text:checkIn.trim(), done:false }]);
    setCheckIn('');
  };

  const toggleCheck = id => {
    setChecklist(p=>p.map(i=>i.id===id?{...i,done:!i.done}:i));
    ws.send({ type:'CHECKLIST_TOGGLE', cardId:card.id, itemId:id });
  };

  const postComment = () => {
    if (!commentIn.trim()) return;
    ws.send({ type:'COMMENT_ADD', cardId:card.id, text:commentIn.trim(), opId:uid() });
    setComments(p=>[...p,{ id:uid(), text:commentIn.trim(), userId:me.userId, userName:me.userName, color:me.color, ts:Date.now() }]);
    setCommentIn('');
  };

  const save = () => {
    onSave({ ...card, title:title.trim()||'Untitled', description:desc, priority:pri, tags, dueDate:due||null, checklist, comments });
    onClose();
  };

  const pm = PRIORITY[pri] || PRIORITY.medium;
  const doneCount = checklist.filter(i=>i.done).length;
  const checkPct  = checklist.length ? Math.round((doneCount/checklist.length)*100) : 0;

  const dueDateStatus = () => {
    if (!due) return null;
    const diff = new Date(due) - new Date();
    const days = diff / 86400000;
    if (days < 0) return 'over';
    if (days < 2) return 'soon';
    return 'ok';
  };
  const dueStatus = dueDateStatus();

  const editingUsers = users.filter(u=>u.editing===card.id && u.userId!==me.userId);

  return (
    <div className="modal-bg" onClick={onClose} onKeyDown={e=>e.key==='Escape'&&onClose()}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal__banner" style={{ background: col?.color || '#E5E7EB' }}/>
        <div className="modal__body">
          {/* Top bar */}
          <div className="modal__topbar">
            <div className="modal__breadcrumb">
              {col && <span className="modal__colbadge" style={{ background:col.color||'#F1F5F9', color:'var(--t2)' }}>{col.title}</span>}
              <span className="modal__id">#{card.id.slice(-6).toUpperCase()}</span>
              {editingUsers.length > 0 && (
                <span style={{ fontSize:11.5, color:'#8B5CF6', fontWeight:600 }}>
                  👁 {editingUsers.map(u=>u.userName).join(', ')} viewing
                </span>
              )}
            </div>
            <button className="modal__close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Title */}
          <textarea ref={titleRef} className="modal__title" value={title} rows={1}
            placeholder="Card title…"
            onChange={e=>{ setTitle(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; notifyTyping(); }}
            onKeyDown={e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter') save(); if(e.key==='Escape') onClose(); }}
          />

          {/* Tabs */}
          <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--bd)', paddingBottom:0 }}>
            {['details','checklist','comments'].map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{ padding:'6px 14px 10px', fontSize:13, fontWeight:600, color:tab===t?'var(--blue)':'var(--t3)', borderBottom:tab===t?'2px solid var(--blue)':'2px solid transparent', marginBottom:-1, transition:'all .12s', textTransform:'capitalize' }}>
                {t}
                {t==='checklist' && checklist.length>0 && <span style={{ marginLeft:5, fontSize:11, background:'var(--bg3)', padding:'1px 5px', borderRadius:99 }}>{doneCount}/{checklist.length}</span>}
                {t==='comments' && comments.length>0 && <span style={{ marginLeft:5, fontSize:11, background:'var(--bg3)', padding:'1px 5px', borderRadius:99 }}>{comments.length}</span>}
              </button>
            ))}
          </div>

          <div className="modal__grid">
            <div className="modal__left">
              {tab === 'details' && (<>
                {/* Priority */}
                <div className="modal__section">
                  <div className="modal__label">Priority</div>
                  <div className="modal__pris">
                    {Object.entries(PRIORITY).map(([k,p])=>(
                      <button key={k} className={`modal__pri${pri===k?' modal__pri--on':''}`}
                        style={pri===k?{ '--pri-c':p.color,'--pri-bg':p.bg }:{}}
                        onClick={()=>setPri(k)}>
                        <span style={{ width:7,height:7,borderRadius:'50%',background:p.dot,flexShrink:0 }}/>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div className="modal__section">
                  <div className="modal__label">Description</div>
                  <div className="modal__desc-wrap">
                    <textarea className="modal__desc" value={desc} rows={4} placeholder="Add a description…"
                      onChange={e=>{ setDesc(e.target.value); notifyTyping(); }}/>
                  </div>
                </div>

                {/* Tags */}
                <div className="modal__section">
                  <div className="modal__label">Labels</div>
                  <div className="modal__tags-wrap">
                    {tags.map(t=>(
                      <span key={t} className="modal__tag" style={{ background:tagBg(t), color:tagColor(t) }}>
                        {t}
                        <button className="modal__tag-x" onClick={()=>setTags(p=>p.filter(x=>x!==t))}>×</button>
                      </span>
                    ))}
                    <input className="modal__tag-in" value={tagIn} placeholder="Add label…"
                      onChange={e=>setTagIn(e.target.value)} onKeyDown={addTag}/>
                  </div>
                </div>
              </>)}

              {tab === 'checklist' && (
                <div className="modal__section">
                  <div className="modal__label">Checklist</div>
                  {checklist.length > 0 && (
                    <div className="check-progress">
                      <div className="check-progress__fill" style={{ width:`${checkPct}%` }}/>
                    </div>
                  )}
                  <div className="checklist">
                    {checklist.map(item=>(
                      <label key={item.id} className={`check-item${item.done?' check-item--done':''}`}>
                        <input type="checkbox" checked={item.done} onChange={()=>toggleCheck(item.id)}/>
                        <span className="check-item__text">{item.text}</span>
                        <button className="check-item__del" onClick={()=>setChecklist(p=>p.filter(i=>i.id!==item.id))}>✕</button>
                      </label>
                    ))}
                  </div>
                  <div className="add-check">
                    <input className="add-check__in" value={checkIn} placeholder="Add item…"
                      onChange={e=>setCheckIn(e.target.value)}
                      onKeyDown={e=>e.key==='Enter'&&addCheckItem()}/>
                    <button className="add-check__btn" onClick={addCheckItem}>Add</button>
                  </div>
                </div>
              )}

              {tab === 'comments' && (
                <div className="modal__section">
                  <div className="modal__label">Comments</div>
                  <div className="comments">
                    {comments.length===0 && <p style={{ fontSize:13, color:'var(--t3)' }}>No comments yet.</p>}
                    {comments.map(c=>(
                      <div key={c.id} className="comment">
                        <div className="comment__av" style={{ background:c.color||'#3B82F6' }}>{initials(c.userName)}</div>
                        <div className="comment__body">
                          <div className="comment__meta">
                            <span className="comment__name">{c.userName}</span>
                            <span className="comment__time">{timeAgo(c.ts)}</span>
                          </div>
                          <p className="comment__text">{c.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="comment__form" style={{ marginTop:12 }}>
                    <div className="pav" style={{ background:me.color, width:30, height:30, fontSize:11, flexShrink:0, border:'2px solid var(--bd)' }}>{initials(me.userName)}</div>
                    <div style={{ flex:1 }}>
                      <textarea className="comment__ta" value={commentIn} rows={2} placeholder="Write a comment…"
                        onChange={e=>setCommentIn(e.target.value)}
                        onKeyDown={e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter') postComment(); }}/>
                      {commentIn.trim() && <button className="btn btn-primary btn-sm" style={{ marginTop:6 }} onClick={postComment}>Post comment</button>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="modal__right">
              <div className="modal__meta-item">
                <div className="modal__label">Due date</div>
                <input type="date" className="modal__date-input" value={due} onChange={e=>setDue(e.target.value)}/>
                {due && <span className={`kcard__due kcard__due--${dueStatus}`} style={{ fontSize:12, marginTop:2 }}>
                  {dueStatus==='over'?'⚠ Overdue':dueStatus==='soon'?'⏰ Due soon':'✓ On track'} · {fmtDate(new Date(due))}
                </span>}
              </div>

              <div className="modal__meta-item">
                <div className="modal__label">Version</div>
                <span style={{ fontSize:13, color:'var(--t2)', fontFamily:'var(--mono)' }}>v{card.version||1}</span>
              </div>

              <div className="modal__meta-item">
                <div className="modal__label">Created by</div>
                <span style={{ fontSize:13, color:'var(--t2)' }}>{card.createdBy || 'Unknown'}</span>
              </div>

              <div className="modal__meta-item">
                <div className="modal__label">Created</div>
                <span style={{ fontSize:13, color:'var(--t2)' }}>{fmtDate(card.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <span className="modal__hint">⌘↵ to save · Esc to close</span>
          <div className="modal__footer-actions">
            <button className="btn btn-danger btn-sm" onClick={()=>{ onDelete(card.id); onClose(); }}>Delete</button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────
function ActivityFeed({ activity, onClose }) {
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [activity]);

  return (
    <div className="activity">
      <div className="activity__hd">
        <span className="activity__title">Activity</span>
        <button className="btn-icon btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="activity__body" ref={bodyRef}>
        {activity.length===0 && <p className="activity__empty">Board activity will appear here.</p>}
        {activity.map(a=>(
          <div key={a.id} className="act-item">
            <div className="act-item__av" style={{ background: a.color||'#3B82F6' }}>{initials(a.userName)}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <p className="act-item__text" dangerouslySetInnerHTML={{ __html: a.html }}/>
              <span className="act-item__time">{timeAgo(a.ts)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────
const KCard = memo(({ card, colId, idx, me, users, onEdit, onDelete, dragging, setDragging, onDrop, ws }) => {
  const p        = PRIORITY[card.priority] || PRIORITY.medium;
  const lockedBy = users.find(u=>u.dragging===card.id && u.userId!==me?.userId);
  const typingBy = users.find(u=>u.typing===card.id && u.userId!==me?.userId);
  const isGhost  = dragging?.cardId === card.id;

  const dueDiff  = card.dueDate ? (new Date(card.dueDate) - new Date()) / 86400000 : null;
  const dueClass = dueDiff===null?null : dueDiff<0?'over' : dueDiff<2?'soon' : 'ok';
  const doneCheck= card.checklist?.filter(i=>i.done).length || 0;
  const totalCheck= card.checklist?.length || 0;

  return (
    <article
      className={['kcard', isGhost?'kcard--ghost':'', lockedBy?'kcard--locked':''].join(' ')}
      style={{ '--card-accent': p.color }}
      draggable={!lockedBy}
      onDragStart={e=>{
        if(lockedBy){e.preventDefault();return;}
        e.dataTransfer.setData('cardId', card.id);
        e.dataTransfer.setData('fromColId', colId);
        e.dataTransfer.setData('fromIdx', String(idx));
        e.dataTransfer.effectAllowed='move';
        setDragging({ cardId:card.id, fromColId:colId });
        ws.send({ type:'DRAG_START', cardId:card.id });
      }}
      onDragEnd={()=>{ setDragging(null); ws.send({ type:'DRAG_END' }); }}
    >
      {lockedBy && (
        <div className="kcard__lock">
          <div className="pav" style={{ background:lockedBy.color, width:14, height:14, fontSize:7, border:'none' }}>{initials(lockedBy.userName)}</div>
          {lockedBy.userName} is moving…
        </div>
      )}
      <div className="kcard__body">
        <div className="kcard__top">
          <p className="kcard__title">{card.title}</p>
          <button className="kcard__edit-btn" onClick={e=>{e.stopPropagation();onEdit(card);}}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5l2 2-6 6H2.5v-2l6-6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        {card.description && <p className="kcard__desc">{card.description}</p>}
        {card.tags?.length>0 && (
          <div className="kcard__tags">
            {card.tags.slice(0,3).map(t=>(
              <span key={t} className="kcard__tag" style={{ background:tagBg(t), color:tagColor(t) }}>{t}</span>
            ))}
          </div>
        )}
        <div className="kcard__meta">
          <span className="kcard__pri" style={{ background:p.bg, color:p.color }}>
            <span className="kcard__dot" style={{ background:p.dot }}/>
            {p.label}
          </span>
          {dueClass && (
            <span className={`kcard__due kcard__due--${dueClass}`}>
              {dueClass==='over'?'⚠':dueClass==='soon'?'⏰':'✓'} {fmtDate(new Date(card.dueDate))}
            </span>
          )}
          {totalCheck>0 && (
            <span className="kcard__check">{doneCheck}/{totalCheck}</span>
          )}
          <div className="kcard__footer-r">
            {typingBy && (
              <div className="kcard__typing">
                <div className="pav" style={{ background:typingBy.color, width:16, height:16, fontSize:8, border:'none', flexShrink:0 }}>{initials(typingBy.userName)}</div>
                <div className="kcard__dots"><span/><span/><span/></div>
              </div>
            )}
            <span className="kcard__ver">v{card.version||1}</span>
          </div>
        </div>
      </div>
    </article>
  );
});

// ── Column ────────────────────────────────────────────────────
function KCol({ col, cards, users, me, ws, onEditCard, onDeleteCard, onAddCard, dragging, setDragging, onDrop, onUpdateCol, onDeleteCol }) {
  const [isOver,   setIsOver]   = useState(false);
  const [dropIdx,  setDropIdx]  = useState(null);
  const [adding,   setAdding]   = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPri,   setNewPri]   = useState('medium');
  const addRef = useRef(null);

  useEffect(()=>{ if(adding) addRef.current?.focus(); },[adding]);

  const colCards = useMemo(
    ()=>[...new Set(col.cardIds||[])].map(id=>cards[id]).filter(Boolean),
    [col.cardIds, cards]
  );

  const submit = () => {
    const t = newTitle.trim();
    if (!t){ setAdding(false); return; }
    onAddCard(col.id, { title:t, priority:newPri, description:'', tags:[], version:1 });
    setNewTitle(''); setNewPri('medium'); setAdding(false);
  };

  return (
    <div className={`col${isOver?' col--over':''}`}
      onDragOver={e=>{e.preventDefault();setIsOver(true);}}
      onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setIsOver(false);setDropIdx(null);}}}
      onDrop={e=>{
        e.preventDefault();setIsOver(false);setDropIdx(null);
        const cardId=e.dataTransfer.getData('cardId');
        const fromColId=e.dataTransfer.getData('fromColId');
        if(cardId) onDrop(cardId,fromColId,col.id,colCards.length);
      }}
    >
      <div className="col__hd">
        <div className="col__hd-l">
          <div className="col__chip" style={{ background:col.color||'#E5E7EB' }}/>
          <input className="col__name-input" value={col.title} maxLength={60}
            onChange={e=>onUpdateCol(col.id,{title:e.target.value})}
            onBlur={e=>{ if(!e.target.value.trim()) onUpdateCol(col.id,{title:'Untitled'}); }}/>
          <span className="col__ct">{colCards.length}</span>
        </div>
        <div className="col__actions">
          <button className="btn-icon btn-sm" onClick={()=>setAdding(true)} title="Add card">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="btn-icon btn-sm" onClick={()=>onDeleteCol(col.id)} title="Delete column"
            style={{ color:'var(--t4)' }} onMouseEnter={e=>e.target.style.color='#EF4444'}
            onMouseLeave={e=>e.target.style.color='var(--t4)'}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3M5 5.5v3M7 5.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="col__body">
        {colCards.length===0 && !adding && (
          <div className="col__empty">
            <div className="col__empty-icon">⬜</div>
            <p>No cards here</p>
          </div>
        )}
        {colCards.map((card,i)=>(
          <div key={card.id}
            className={`card-slot${dropIdx===i?' card-slot--over':''}`}
            onDragOver={e=>{e.preventDefault();setDropIdx(i);}}
            onDrop={e=>{
              e.preventDefault();setIsOver(false);setDropIdx(null);
              const cardId=e.dataTransfer.getData('cardId');
              const fromColId=e.dataTransfer.getData('fromColId');
              if(cardId) onDrop(cardId,fromColId,col.id,i);
            }}
          >
            <KCard card={card} colId={col.id} idx={i} me={me} users={users} ws={ws}
              onEdit={onEditCard} onDelete={onDeleteCard}
              dragging={dragging} setDragging={setDragging} onDrop={onDrop}/>
          </div>
        ))}
        <div className={`col__end-drop${isOver&&dropIdx===null?' col__end-drop--on':''}`}
          onDragOver={e=>{e.preventDefault();setDropIdx(null);}}
          onDrop={e=>{
            e.preventDefault();setIsOver(false);setDropIdx(null);
            const cardId=e.dataTransfer.getData('cardId');
            const fromColId=e.dataTransfer.getData('fromColId');
            if(cardId) onDrop(cardId,fromColId,col.id,colCards.length);
          }}/>
      </div>

      <div className="col__ft">
        {adding ? (
          <div className="add-form">
            <textarea ref={addRef} className="add-form__ta" value={newTitle} rows={2}
              placeholder="Card title… (Enter to add)"
              onChange={e=>setNewTitle(e.target.value)}
              onKeyDown={e=>{
                if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}
                if(e.key==='Escape'){setAdding(false);setNewTitle('');}
              }}/>
            <div className="add-form__bottom">
              <div className="add-form__pris">
                {Object.entries(PRIORITY).map(([k,p])=>(
                  <button key={k} className={`pri-mini${newPri===k?' pri-mini--on':''}`}
                    style={{ color:newPri===k?p.color:undefined }}
                    onClick={()=>setNewPri(k)}>
                    <span style={{ width:5,height:5,borderRadius:'50%',background:p.dot,flexShrink:0 }}/>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="add-form__actions">
                <button className="btn btn-primary btn-sm" onClick={submit}>Add card</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>{setAdding(false);setNewTitle('');setNewPri('medium');}}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <button className="add-trigger" onClick={()=>setAdding(true)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add card
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
function App() {
  const ws = useWS();

  const [me,      setMe]      = useState(null);
  const [room,    setRoom]    = useState(null);
  const [columns, setColumns] = useState([]);
  const [cards,   setCards]   = useState({});
  const [users,   setUsers]   = useState([]);

  const [editCard,    setEditCard]    = useState(null);
  const [dragging,    setDragging]    = useState(null);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('all');
  const [showInvite,  setShowInvite]  = useState(false);
  const [showActivity,setShowActivity]= useState(false);
  const [activity,    setActivity]    = useState([]);
  const [toasts,      setToasts]      = useState([]);
  const [gateErr,     setGateErr]     = useState('');

  // Check URL for room code
  const urlRoom = useMemo(()=>{
    const p = new URLSearchParams(location.search);
    return p.get('room')?.toUpperCase() || null;
  },[]);

  // ── Toast ────────────────────────────────────────────────
  const toast = useCallback((variant, title, message='', duration=4000) => {
    const id = uid();
    setToasts(p=>[...p.slice(-4),{ id, variant, title, message }]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), duration);
  }, []);

  const addActivity = useCallback((userName, color, html) => {
    setActivity(p=>[...p.slice(-99),{ id:uid(), userName, color, html, ts:Date.now() }]);
  }, []);

  // ── WS event handlers ────────────────────────────────────
  useEffect(()=>{
    const off = [
      ws.on('ROOM_JOINED', msg=>{
        setRoom(msg.room);
        setColumns(msg.columns);
        setCards(msg.cards);
        setMe(msg.me);
        setUsers(msg.users||[]);
        addActivity('System','#64748B',`<strong>Board loaded</strong> — ${msg.room.name}`);
      }),

      ws.on('ERROR', msg=>{
        if(msg.code==='ROOM_NOT_FOUND') setGateErr(msg.message);
        else toast('error','Error', msg.message);
      }),

      ws.on('USER_JOINED', msg=>{
        setUsers(msg.users||[]);
        if(msg.userId !== me?.userId){
          toast('collab',`${msg.userName} joined`,'Now collaborating in real-time ✨');
          addActivity(msg.userName, msg.color, `<strong>${msg.userName}</strong> joined the board`);
        }
      }),
      ws.on('USER_LEFT',  msg=>{ setUsers(msg.users||[]); }),

      ws.on('CARD_CREATED', msg=>{
        setCards(p=>({ ...p, [msg.card.id]:msg.card }));
        setColumns(p=>p.map(c=>c.id===msg.columnId?{ ...c, cardIds:[...(c.cardIds||[]),msg.card.id] }:c));
        if(msg.userId!==me?.userId){
          toast('info',`${msg.userName} added a card`, msg.card.title);
          addActivity(msg.userName,'#3B82F6',`<strong>${msg.userName}</strong> created <em>${msg.card.title}</em>`);
        }
      }),

      ws.on('CARD_UPDATED', msg=>{
        setCards(p=>p[msg.cardId]?{ ...p,[msg.cardId]:{ ...p[msg.cardId],...msg.changes,version:msg.newVersion } }:p);
        if(msg.userId!==me?.userId) addActivity(msg.userName,'#8B5CF6',`<strong>${msg.userName}</strong> updated a card`);
      }),

      ws.on('CARD_DELETED', msg=>{
        setCards(p=>{ const n={...p}; delete n[msg.cardId]; return n; });
        setColumns(p=>p.map(c=>c.id===msg.columnId?{ ...c,cardIds:(c.cardIds||[]).filter(id=>id!==msg.cardId) }:c));
        if(msg.userId!==me?.userId) addActivity(msg.userName,'#EF4444',`<strong>${msg.userName}</strong> deleted a card`);
      }),

      ws.on('CARD_MOVED', msg=>{
        setColumns(p=>{
          const n = p.map(c=>{ if(c.id===msg.fromColumnId) return {...c,cardIds:(c.cardIds||[]).filter(id=>id!==msg.cardId)}; return c; });
          return n.map(c=>{ if(c.id===msg.toColumnId){ const ids=[...(c.cardIds||[]).filter(id=>id!==msg.cardId)]; ids.splice(Math.min(msg.toIndex,ids.length),0,msg.cardId); return {...c,cardIds:ids}; } return c; });
        });
        setCards(p=>p[msg.cardId]?{...p,[msg.cardId]:{...p[msg.cardId],version:msg.newVersion}}:p);
        if(msg.userId!==me?.userId) addActivity(msg.userName,'#F59E0B',`<strong>${msg.userName}</strong> moved a card`);
      }),

      ws.on('COLUMN_CREATED', msg=>{
        setColumns(p=>[...p, msg.column]);
        addActivity(msg.userName,'#6B7280',`<strong>${msg.userName}</strong> added column <em>${msg.column.title}</em>`);
      }),
      ws.on('COLUMN_UPDATED', msg=>{
        setColumns(p=>p.map(c=>c.id===msg.columnId?{...c,...(msg.title&&{title:msg.title}),...(msg.color&&{color:msg.color})}:c));
      }),
      ws.on('COLUMN_DELETED', msg=>{
        setColumns(p=>p.filter(c=>c.id!==msg.columnId));
        setCards(p=>{ const n={...p}; Object.keys(n).forEach(k=>{ if(!columns.find(c=>c.id!==msg.columnId&&(c.cardIds||[]).includes(k))) delete n[k]; }); return n; });
      }),

      ws.on('COMMENT_ADDED', msg=>{
        setCards(p=>p[msg.cardId]?{ ...p,[msg.cardId]:{ ...p[msg.cardId], comments:[...(p[msg.cardId].comments||[]),msg.comment] } }:p);
        if(msg.comment.userId!==me?.userId) addActivity(msg.comment.userName, msg.comment.color, `<strong>${msg.comment.userName}</strong> commented on a card`);
      }),

      ws.on('CHECKLIST_TOGGLED', msg=>{
        setCards(p=>{ if(!p[msg.cardId]) return p; const cl=(p[msg.cardId].checklist||[]).map(i=>i.id===msg.itemId?{...i,done:msg.done}:i); return {...p,[msg.cardId]:{...p[msg.cardId],checklist:cl}}; });
      }),

      ws.on('BOARD_RENAMED', msg=>{ setRoom(p=>({...p, name:msg.name})); }),

      ws.on('CONFLICT_NOTICE', msg=>toast('warn','Conflict resolved',msg.message)),
      ws.on('CONFLICT_REJECT', msg=>{ toast('error','Edit rejected',msg.message); if(msg.currentColumns) setColumns(msg.currentColumns); }),

      ws.on('OP_OK', ()=>{}),

      ws.on('PRESENCE_UPDATE', msg=>setUsers(msg.users||[])),
      ws.on('TYPING_START',    msg=>setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,typing:msg.cardId}:u))),
      ws.on('TYPING_STOP',     msg=>setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,typing:null}:u))),
      ws.on('DRAG_START',      msg=>{ if(msg.users) setUsers(msg.users); else setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,dragging:msg.cardId}:u)); }),
      ws.on('DRAG_END',        msg=>{ if(msg.users) setUsers(msg.users); else setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,dragging:null}:u)); }),
      ws.on('EDITING_START',   msg=>setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,editing:msg.cardId}:u))),
      ws.on('EDITING_STOP',    msg=>setUsers(p=>p.map(u=>u.userId===msg.userId?{...u,editing:null}:u))),
    ];
    return ()=>off.forEach(u=>u());
  },[ws, me, addActivity, toast]);

  // ── Gate: join/create ────────────────────────────────────
  const handleEnter = useCallback(({ name, color, mode, code, boardName })=>{
    const userId = localStorage.getItem('kp-uid') || uid();
    localStorage.setItem('kp-uid', userId);
    const roomId = mode==='join' ? code : null;
    setGateErr('');
    ws.send({ type:'JOIN_ROOM', roomId, userId, userName:name, color, boardName });
  },[ws]);

  // ── Board ops ────────────────────────────────────────────
  const addCard = useCallback((colId, data)=>{
    const opId = uid();
    ws.send({ type:'CARD_CREATE', columnId:colId, opId, ...data });
    // Optimistic
    const id = `card-${uid()}`;
    const card = { id, ...data, createdAt:Date.now(), updatedAt:Date.now(), version:1, createdBy:me?.userName };
    setCards(p=>({...p,[id]:card}));
    setColumns(p=>p.map(c=>c.id===colId?{...c,cardIds:[...(c.cardIds||[]),id]}:c));
    addActivity(me?.userName, me?.color, `<strong>${me?.userName}</strong> created <em>${data.title}</em>`);
  },[ws, me, addActivity]);

  const updateCard = useCallback((updated)=>{
    const changes = { title:updated.title, description:updated.description, priority:updated.priority, tags:updated.tags, dueDate:updated.dueDate, checklist:updated.checklist, comments:updated.comments };
    ws.send({ type:'CARD_UPDATE', cardId:updated.id, changes, version:updated.version, opId:uid() });
    setCards(p=>({...p,[updated.id]:{...updated,version:(updated.version||1)+1}}));
    toast('success','Saved','');
  },[ws, toast]);

  const deleteCard = useCallback((cardId)=>{
    const colId = columns.find(c=>(c.cardIds||[]).includes(cardId))?.id;
    ws.send({ type:'CARD_DELETE', cardId, columnId:colId, opId:uid() });
    setCards(p=>{ const n={...p}; delete n[cardId]; return n; });
    if(colId) setColumns(p=>p.map(c=>c.id===colId?{...c,cardIds:(c.cardIds||[]).filter(id=>id!==cardId)}:c));
    toast('info','Card deleted','');
  },[ws, columns, toast]);

  const moveCard = useCallback((cardId, fromColId, toColId, toIdx)=>{
    const card = cards[cardId];
    ws.send({ type:'CARD_MOVE', cardId, fromColumnId:fromColId, toColumnId:toColId, toIndex:toIdx, version:card?.version, opId:uid() });
    setColumns(p=>{
      const n=p.map(c=>c.id===fromColId?{...c,cardIds:(c.cardIds||[]).filter(id=>id!==cardId)}:c);
      return n.map(c=>{ if(c.id===toColId){ const ids=[...(c.cardIds||[]).filter(id=>id!==cardId)]; ids.splice(Math.min(toIdx,ids.length),0,cardId); return {...c,cardIds:ids}; } return c; });
    });
  },[ws, cards]);

  const addColumn = useCallback(()=>{
    const opId=uid();
    const color = COL_COLORS[columns.length % COL_COLORS.length];
    ws.send({ type:'COLUMN_CREATE', title:'New Section', color, opId });
    const col = { id:`col-${uid()}`, title:'New Section', color, cardIds:[] };
    setColumns(p=>[...p,col]);
  },[ws, columns]);

  const updateCol = useCallback((colId, changes)=>{
    setColumns(p=>p.map(c=>c.id===colId?{...c,...changes}:c));
    ws.send({ type:'COLUMN_UPDATE', columnId:colId, ...changes, opId:uid() });
  },[ws]);

  const deleteCol = useCallback((colId)=>{
    if(!confirm('Delete this column and all its cards?')) return;
    ws.send({ type:'COLUMN_DELETE', columnId:colId, opId:uid() });
    setColumns(p=>p.filter(c=>c.id!==colId));
    const col = columns.find(c=>c.id===colId);
    if(col) setCards(p=>{ const n={...p}; (col.cardIds||[]).forEach(id=>delete n[id]); return n; });
  },[ws, columns]);

  const renameBoard = useCallback((name)=>{
    ws.send({ type:'BOARD_RENAME', name, opId:uid() });
    setRoom(p=>({...p,name}));
  },[ws]);

  // ── Filtered view ────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const visibleCards = useMemo(()=>{
    let c = cards;
    if(q) c=Object.fromEntries(Object.entries(c).filter(([,v])=>v.title?.toLowerCase().includes(q)||v.description?.toLowerCase().includes(q)||v.tags?.some(t=>t.includes(q))));
    if(filter!=='all') c=Object.fromEntries(Object.entries(c).filter(([,v])=>v.priority===filter));
    return c;
  },[cards,q,filter]);

  const visibleColumns = useMemo(()=>{
    if(!q && filter==='all') return columns;
    return columns.map(c=>({...c,cardIds:(c.cardIds||[]).filter(id=>visibleCards[id])}));
  },[columns,visibleCards,q,filter]);

  // ── Gate ────────────────────────────────────────────────
  if(!room) {
    return (
      <>
        <Gate onEnter={handleEnter} wsConnected={ws.connected} initialCode={urlRoom}/>
        {gateErr && (
          <div style={{ position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',background:'#FEF2F2',border:'1px solid #FECACA',color:'#DC2626',padding:'10px 20px',borderRadius:8,fontSize:13,fontWeight:600,zIndex:9999 }}>
            ⚠ {gateErr}
          </div>
        )}
      </>
    );
  }

  const otherUsers = users.filter(u=>u.userId!==me?.userId);

  return (
    <div className="app">
      {/* Header */}
      <header className="hdr">
        <div className="hdr__section hdr__section--brand">
          <div className="hdr__logo">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1L1 4v5l5.5 3L12 9V4L6.5 1z" stroke="#fff" strokeWidth="1.4"/>
              <path d="M6.5 1v7M1 4l5.5 3 5.5-3" stroke="#fff" strokeWidth="1.4"/>
            </svg>
          </div>
          <input className="board-name-input" value={room.name}
            onChange={e=>setRoom(p=>({...p,name:e.target.value}))}
            onBlur={e=>renameBoard(e.target.value||'My Board')}
            onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
          <button className="hdr__roomcode" onClick={()=>setShowInvite(true)} title="Click to invite collaborators">
            {room.id}
          </button>
        </div>

        <div className="hdr__section hdr__section--center">
          <div className="search">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke="#94A3B8" strokeWidth="1.2"/>
              <path d="M8 8l2.5 2.5" stroke="#94A3B8" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input placeholder="Search cards…" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search && <button style={{ color:'var(--t3)',fontSize:11 }} onClick={()=>setSearch('')}>✕</button>}
          </div>
          <div className="filters">
            {['all','urgent','high','medium','low'].map(f=>(
              <button key={f} className={`filter-chip${filter===f?' filter-chip--on':''}`}
                style={filter===f&&f!=='all'?{ background:PRIORITY[f]?.bg, color:PRIORITY[f]?.color }:{}}
                onClick={()=>setFilter(f)}>
                {f==='all'?'All':PRIORITY[f].label}
              </button>
            ))}
          </div>
        </div>

        <div className="hdr__section hdr__section--right">
          {/* Presence */}
          <div className="presence">
            {otherUsers.slice(0,4).map(u=>(
              <div key={u.userId} className="pav" style={{ background:u.color }} title={`${u.userName}${u.dragging?' (moving a card)':u.typing?' (typing)':u.editing?' (editing)':''}`}>
                {initials(u.userName)}
                {(u.dragging||u.typing||u.editing) && (
                  <span className={`pav__pip pav__pip--${u.dragging?'drag':u.editing?'edit':'type'}`}>
                    {u.dragging?'↕':u.editing?'✎':'…'}
                  </span>
                )}
              </div>
            ))}
            {otherUsers.length>4 && <div className="pav__more">+{otherUsers.length-4}</div>}
            <div className="pav" style={{ background:me?.color, border:'2.5px solid var(--blue)' }} title={`${me?.userName} (you)`}>
              {initials(me?.userName)}
            </div>
          </div>

          {/* Connection */}
          <div style={{ display:'flex',alignItems:'center',gap:5,fontSize:12,fontWeight:600,color:ws.connected?'#10B981':'#F59E0B' }}>
            <span style={{ width:7,height:7,borderRadius:'50%',background:'currentColor',display:'block',animation:ws.connected?'blink 2s infinite':undefined }}/>
            {ws.connected?`Live${ws.latency?` · ${ws.latency}ms`:''}` : 'Reconnecting…'}
          </div>

          <button className="invite-btn" onClick={()=>setShowInvite(true)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M9 4a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM1.5 11.5c0-2.485 2.015-4.5 4.5-4.5s4.5 2.015 4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M10.5 7v4M8.5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span>Invite</span>
          </button>

          <button className={`btn btn-ghost btn-sm${showActivity?' btn-ghost--on':''}`} onClick={()=>setShowActivity(s=>!s)}>
            Activity {activity.length>0&&<span style={{ background:'var(--blue)',color:'#fff',fontSize:10,padding:'1px 5px',borderRadius:99,marginLeft:2 }}>{Math.min(activity.length,99)}</span>}
          </button>
        </div>
      </header>

      {/* Board */}
      <div className="board-outer">
        <div className="board">
          {visibleColumns.map(col=>(
            <KCol key={col.id} col={col} cards={visibleCards} users={users} me={me} ws={ws}
              onEditCard={setEditCard} onDeleteCard={deleteCard} onAddCard={addCard}
              dragging={dragging} setDragging={setDragging} onDrop={moveCard}
              onUpdateCol={updateCol} onDeleteCol={deleteCol}/>
          ))}

          <button className="add-col" onClick={addColumn}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
            Add section
          </button>
        </div>

        {showActivity && <ActivityFeed activity={activity} onClose={()=>setShowActivity(false)}/>}
      </div>

      {/* Modals */}
      {editCard && (
        <CardModal
          card={editCard}
          col={columns.find(c=>(c.cardIds||[]).includes(editCard.id))}
          me={me} users={users} ws={ws}
          onSave={updateCard}
          onDelete={deleteCard}
          onClose={()=>setEditCard(null)}
        />
      )}

      {showInvite && <div className="modal-bg" onClick={()=>setShowInvite(false)}><InviteModal roomId={room.id} onClose={()=>setShowInvite(false)}/></div>}

      {/* Toasts */}
      <div className="toasts">
        {toasts.map(t=>(
          <div key={t.id} className={`toast toast--${t.variant}`}>
            <span className="toast__icon">{t.variant==='success'?'✓':t.variant==='error'?'✕':t.variant==='collab'?'✨':t.variant==='warn'?'⚡':'ℹ'}</span>
            <div className="toast__body">
              {t.title&&<strong>{t.title}</strong>}
              {t.message&&<p>{t.message}</p>}
            </div>
          </div>
        ))}
      </div>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// ── Boot ──────────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(<App/>);
