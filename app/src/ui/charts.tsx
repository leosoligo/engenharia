/** Componentes gráficos em SVG (perfil do solo, croquis, estaca armada, gráficos e barras). */
import type { ReactNode } from 'react'
import type { SptBorehole, SoilType } from '../core/soil'
import { SOIL_LABEL } from '../core/soil'
import type { Candidate } from '../core/optimize'
import type { LoadCombination } from '../core/loads'
import { PILE_LABEL } from '../core/pile'
import { KN, type Units } from './units'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

const soilFamily = (s: SoilType) => (s.startsWith('areia') ? 'areia' : s.startsWith('argila') ? 'argila' : 'silte')
export const SOIL_FILL = { areia: '#e6c875', silte: '#b9a384', argila: '#a9745b' } as const

// ------------------------------------------------------------------ perfil de sondagem

export function SoilProfileChart({ bh }: { bh: SptBorehole }) {
  const depth = bh.layers.length
  const pm = Math.min(20, 600 / depth)
  const top = 30
  const H = top + depth * pm + 34
  const W = 520
  const x0 = 64
  const sw = 84
  const nMax = 40
  const na = bh.waterLevel
  const yAt = (z: number) => top + z * pm
  const bx = (n: number) => 180 + (Math.min(n, nMax) / nMax) * 300
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label={`Perfil da sondagem ${bh.id}`}>
      <text x={x0} y={16} className="t-h">Solo</text>
      <text x={180} y={16} className="t-h">N<tspan baselineShift="sub" fontSize="8">SPT</tspan> (golpes)</text>
      {bh.layers.map((l) => (
        <g key={l.depth}>
          <rect x={x0} y={yAt(l.depth - 1)} width={sw} height={pm + 0.5} fill={SOIL_FILL[soilFamily(l.soil)]}><title>{`${l.depth - 1}–${l.depth} m · ${SOIL_LABEL[l.soil]} · N = ${l.nspt}`}</title></rect>
          <rect x={180} y={yAt(l.depth - 1) + pm * 0.18} width={Math.max(bx(l.nspt) - 180, 1)} height={pm * 0.64} className="bar-spt" />
          {pm >= 11 && <text x={bx(l.nspt) + 4} y={yAt(l.depth - 1) + pm * 0.72} className="t-s">{l.nspt}</text>}
        </g>
      ))}
      {Array.from({ length: Math.floor(depth / 5) + 1 }, (_, k) => k * 5).filter((z) => z <= depth).map((z) => (
        <g key={z}>
          <line x1={x0 - 4} x2={x0} y1={yAt(z)} y2={yAt(z)} className="axis" />
          <text x={x0 - 8} y={yAt(z) + 3} textAnchor="end" className="t-s">{z} m</text>
          <line x1={180} x2={480} y1={yAt(z)} y2={yAt(z)} className="grid" />
        </g>
      ))}
      {na !== undefined && Number.isFinite(na) && na <= depth && (
        <g>
          <line x1={x0 - 6} x2={490} y1={yAt(na)} y2={yAt(na)} className="na" />
          <path d={`M${x0 - 16},${yAt(na) - 5} l10,0 l-5,9 z`} className="na-fill" />
          <text x={494 - 4} y={yAt(na) - 4} textAnchor="end" className="t-na">NA {nf(na, 1)} m</text>
        </g>
      )}
      {na === Infinity && <text x={x0} y={H - 6} className="t-s">NA não encontrado até {depth} m</text>}
    </svg>
  )
}

export function SoilLegend() {
  return (
    <div className="legend">
      {(['areia', 'silte', 'argila'] as const).map((f) => (
        <span key={f}><i style={{ background: SOIL_FILL[f] }} />{f[0].toUpperCase() + f.slice(1)}</span>
      ))}
      <span><i className="bar-spt-i" />N<sub>SPT</sub></span>
      <span><i className="na-i" />Nível d’água</span>
    </div>
  )
}

// ------------------------------------------------------------------ cargas do pilar

function Arrow({ x1, y1, x2, y2, label, lx, ly, anchor = 'middle' }: { x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number; anchor?: 'start' | 'middle' | 'end' }) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const hx = (d: number) => `${x2 - 8 * Math.cos(a + d)},${y2 - 8 * Math.sin(a + d)}`
  return (
    <g className="arrow">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polygon points={`${x2},${y2} ${hx(0.4)} ${hx(-0.4)}`} />
      <text x={lx} y={ly} textAnchor={anchor}>{label}</text>
    </g>
  )
}

export function LoadSketch({ c, ax, ay, uf = 1, uF = 'kN', uM = 'kN·m' }: { c?: LoadCombination; ax: number; ay: number; uf?: number; uF?: string; uM?: string }) {
  const view = (title: string, horiz: number, moment: number, hName: string, mName: string, w: number) => {
    const W = 300, H = 250
    const pw = Math.max(48, Math.min(120, w * 2.1))
    const x0 = W / 2 - pw / 2
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label={title}>
        <text x={8} y={14} className="t-h">{title}</text>
        <rect x={20} y={H - 30} width={W - 40} height={14} className="soil-blk" />
        <rect x={x0} y={70} width={pw} height={H - 100} className="pillar-fill" />
        {c && (
          <>
            <Arrow x1={W / 2} y1={22} x2={W / 2} y2={66} label={`Fz = ${nf(c.fz * uf, uf === 1 ? 0 : 2)} ${uF}`} lx={W / 2 + 6} ly={36} anchor="start" />
            {Math.abs(horiz) > 1e-9 && <Arrow x1={horiz > 0 ? x0 - 36 : x0 + pw + 36} y1={80} x2={horiz > 0 ? x0 : x0 + pw} y2={80} label={`${hName} = ${nf(horiz * uf, uf === 1 ? 1 : 2)} ${uF}`} lx={horiz > 0 ? x0 - 36 : x0 + pw + 36} ly={74} anchor={horiz > 0 ? 'start' : 'end'} />}
            {Math.abs(moment) > 1e-9 && (
              <g className="arrow">
                <path d={`M${W / 2 - 22},${H - 36} a22,22 0 1 ${moment > 0 ? 1 : 0} 44,0`} fill="none" />
                <text x={W / 2} y={H - 40} textAnchor="middle">{mName} = {nf(moment * uf, uf === 1 ? 1 : 2)} {uM}</text>
              </g>
            )}
          </>
        )}
      </svg>
    )
  }
  return (
    <div className="viz-row">
      {view('Vista X–Z', c?.fx ?? 0, c?.my ?? 0, 'Fx', 'My', ax)}
      {view('Vista Y–Z', c?.fy ?? 0, c?.mx ?? 0, 'Fy', 'Mx', ay)}
    </div>
  )
}

// ------------------------------------------------------------------ planta do bloco

const heat = (u: number) => {
  const t = Math.max(0, Math.min(1, u))
  const h = 140 - 140 * t // verde → vermelho
  return `hsl(${h} 65% 55%)`
}

function Dim({ x1, y1, x2, y2, label, off = 0 }: { x1: number; y1: number; x2: number; y2: number; label: string; off?: number }) {
  const horizontal = Math.abs(y2 - y1) < 1e-6
  const ox = horizontal ? 0 : off
  const oy = horizontal ? off : 0
  const mx = (x1 + x2) / 2 + ox
  const my = (y1 + y2) / 2 + oy
  return (
    <g className="dim">
      <line x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy} />
      <line x1={x1 + ox - (horizontal ? 0 : 3)} y1={y1 + oy - (horizontal ? 3 : 0)} x2={x1 + ox + (horizontal ? 0 : 3)} y2={y1 + oy + (horizontal ? 3 : 0)} />
      <line x1={x2 + ox - (horizontal ? 0 : 3)} y1={y2 + oy - (horizontal ? 3 : 0)} x2={x2 + ox + (horizontal ? 0 : 3)} y2={y2 + oy + (horizontal ? 3 : 0)} />
      <text x={mx} y={my - 3} textAnchor="middle" transform={horizontal ? undefined : `rotate(-90 ${mx} ${my})`}>{label}</text>
    </g>
  )
}

export function PlanView({ c, ax, ay, big, u = KN }: { c: Candidate; ax: number; ay: number; big?: boolean; u?: Units }) {
  const g = c.blockDesign.geometry
  const W = 640, H = 470, pad = 56
  const sc = Math.min((W - 2 * pad) / g.lx, (H - 2 * pad) / g.ly)
  const X = (x: number) => W / 2 + (x - g.cx) * sc
  const Y = (y: number) => H / 2 - (y - g.cy) * sc
  const padm = c.service.padm
  const spacing = c.layout.n > 1 ? c.spacing : 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`viz ${big ? 'big' : ''}`} role="img" aria-label="Planta do bloco e das estacas">
      <defs>
        <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" className="hatch-l" /></pattern>
      </defs>
      <polygon points={g.outline.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')} className="blk" />
      <line x1={X(g.cx - g.lx / 2) - 10} x2={X(g.cx + g.lx / 2) + 10} y1={Y(0)} y2={Y(0)} className="axisline" />
      <line y1={Y(g.cy - g.ly / 2) + 10} y2={Y(g.cy + g.ly / 2) - 10} x1={X(0)} x2={X(0)} className="axisline" />
      <rect x={X(-ax / 2)} y={Y(ay / 2)} width={ax * sc} height={ay * sc} fill="url(#hatch)" className="pillar-st" />
      {c.layout.points.map((p, i) => {
        const P = c.pileAxialELS[i]
        return (
          <g key={i}>
            <circle cx={X(p.x)} cy={Y(p.y)} r={(c.diameter / 2) * sc} fill={heat(P / padm)} fillOpacity={0.55} className="pile-st"><title>{`Estaca ${i + 1}: compressão máx. em serviço ${nf(P * u.k, u.k === 1 ? 0 : 1)} ${u.F} (${nf((P / padm) * 100)} % de Padm)`}</title></circle>
            <text x={X(p.x)} y={Y(p.y) - 2} textAnchor="middle" className="t-pile">E{i + 1}</text>
            <text x={X(p.x)} y={Y(p.y) + 10} textAnchor="middle" className="t-s">{nf(P * u.k, u.k === 1 ? 0 : 1)} {u.F}</text>
          </g>
        )
      })}
      <Dim x1={X(g.cx - g.lx / 2)} y1={Y(g.cy - g.ly / 2)} x2={X(g.cx + g.lx / 2)} y2={Y(g.cy - g.ly / 2)} label={`${nf(g.lx * 100)} cm`} off={20} />
      <Dim x1={X(g.cx - g.lx / 2)} y1={Y(g.cy + g.ly / 2)} x2={X(g.cx - g.lx / 2)} y2={Y(g.cy - g.ly / 2)} label={`${nf(g.ly * 100)} cm`} off={-20} />
      {spacing > 0 && c.layout.n === 2 && <Dim x1={X(c.layout.points[0].x)} y1={Y(0) + 0} x2={X(c.layout.points[1].x)} y2={Y(0)} label={`${nf(spacing * 100)} cm`} off={-(c.diameter / 2) * sc - 12} />}
      <text x={10} y={16} className="t-h">Planta — {c.layout.n} estaca(s) Ø{nf(c.diameter * 100)} cm</text>
      <text x={10} y={H - 8} className="t-s">Cor das estacas: carga em serviço / Padm (verde = folga, vermelho = no limite); valores na tabela ao lado</text>
    </svg>
  )
}

export function MiniPlan({ c }: { c: Candidate }) {
  const g = c.blockDesign.geometry
  const S = 84
  const sc = (S - 10) / Math.max(g.lx, g.ly)
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mini" role="img" aria-label="Arranjo">
      <polygon points={g.outline.map((q) => `${(S / 2 + (q[0] - g.cx) * sc).toFixed(1)},${(S / 2 - (q[1] - g.cy) * sc).toFixed(1)}`).join(' ')} className="blk" />
      {c.layout.points.map((p, i) => <circle key={i} cx={S / 2 + (p.x - g.cx) * sc} cy={S / 2 - (p.y - g.cy) * sc} r={(c.diameter / 2) * sc} className="pile-mini" />)}
    </svg>
  )
}

// ------------------------------------------------------------------ corte do bloco

export function BlockSection({ c, ax }: { c: Candidate; ax: number }) {
  const g = c.blockDesign.geometry
  const W = 640, H = 480, padX = 60
  const total = g.h + 0.9 + 0.5 // bloco + estaca visível + pilar
  const sc = Math.min((W - 2 * padX) / g.lx, (H - 70) / total)
  const cx = W / 2
  const yTop = 40
  const yBlock = yTop + 0.5 * sc
  const xs = [...new Set(c.layout.points.map((p) => (p.x - g.cx).toFixed(4)))].map(Number)
  const cover = g.cover * sc
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label="Corte do bloco">
      <text x={10} y={16} className="t-h">Corte — bloco e armadura</text>
      <rect x={cx - (ax * sc) / 2} y={yTop - 6} width={ax * sc} height={0.5 * sc + 6} className="pillar-fill" />
      <rect x={cx - (g.lx * sc) / 2} y={yBlock} width={g.lx * sc} height={g.h * sc} className="blk" />
      {xs.map((x) => (
        <rect key={x} x={cx + x * sc - (c.diameter * sc) / 2} y={yBlock + g.h * sc} width={c.diameter * sc} height={0.9 * sc} className="pile-sec" />
      ))}
      <rect x={cx - (g.lx * sc) / 2 + cover} y={yBlock + cover} width={g.lx * sc - 2 * cover} height={g.h * sc - 2 * cover} className="stirrup" />
      <line x1={cx - (g.lx * sc) / 2 + cover} x2={cx + (g.lx * sc) / 2 - cover} y1={yBlock + g.h * sc - cover - 4} y2={yBlock + g.h * sc - cover - 4} className="rebar" />
      <line x1={cx - (g.lx * sc) / 2 + cover} x2={cx + (g.lx * sc) / 2 - cover} y1={yBlock + g.h * sc - cover - 9} y2={yBlock + g.h * sc - cover - 9} className="rebar" />
      <rect x={cx - (g.lx * sc) / 2} y={yBlock + g.h * sc} width={g.lx * sc} height={4} className="lean" />
      <Dim x1={cx + (g.lx * sc) / 2 + 14} y1={yBlock} x2={cx + (g.lx * sc) / 2 + 14} y2={yBlock + g.h * sc} label={`h = ${nf(g.h * 100)} cm`} off={10} />
      <Dim x1={cx - (g.lx * sc) / 2} y1={yBlock + g.h * sc + 0.9 * sc + 18} x2={cx + (g.lx * sc) / 2} y2={yBlock + g.h * sc + 0.9 * sc + 18} label={`${nf(g.lx * 100)} cm`} />
      <text x={cx} y={yBlock + g.h * sc / 2} textAnchor="middle" className="t-s">d = {nf(g.d * 100)} cm · cobrimento {nf(g.cover * 100)} cm</text>
      <text x={10} y={H - 8} className="t-s">Lastro de concreto magro ≥ 5 cm; cabeça da estaca 5 cm acima do lastro (NBR 6122:2022, 8.5.5)</text>
    </svg>
  )
}

// ------------------------------------------------------------------ estaca armada

export function PileElevation({ c }: { c: Candidate }) {
  const l = c.design.longitudinal!
  const t = c.design.transverse!
  const D = c.diameter
  const L = c.length
  const W = 440, H = 400
  const top = 34, bottom = 40
  const sc = (H - top - bottom) / L
  const px = 130
  const pw = Math.min(70, Math.max(44, D * 100 * 0.9))
  const cage = c.design.cageLength!
  const rr = (l.Rs / (D / 2)) * (pw / 2)
  const nShow = Math.min(l.n, 7)
  const bars = Array.from({ length: nShow }, (_, k) => px - rr + (2 * rr * k) / Math.max(nShow - 1, 1))
  const secR = 44
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label="Estaca armada">
      <text x={10} y={16} className="t-h">Estaca — armadura</text>
      <rect x={px - pw / 2} y={top} width={pw} height={L * sc} className="pile-sec" />
      {bars.map((x, i) => <line key={i} x1={x} x2={x} y1={top + 2} y2={top + cage * sc} className="rebar" />)}
      {t.zones.map((z, i) => {
        const step = Math.max(z.spacing * sc, 3)
        const ys: number[] = []
        for (let y = top + z.from * sc; y <= top + z.to * sc + 0.1; y += step) ys.push(y)
        return (
          <g key={i}>
            {ys.map((y, k) => <line key={k} x1={px - pw / 2 + 3} x2={px + pw / 2 - 3} y1={y} y2={y} className="stirrup-l" />)}
            <line x1={px + pw / 2 + 12} x2={px + pw / 2 + 12} y1={top + z.from * sc} y2={top + z.to * sc} className="dim-l" />
            <text x={px + pw / 2 + 18} y={top + ((z.from + z.to) / 2) * sc + 3} className="t-s">{t.type === 'estribo' ? 'Estribos' : 'Helicoidal'} Ø{nf(t.phiMm, 1)} c/{nf(z.spacing * 100, 1)} cm</text>
          </g>
        )
      })}
      <line x1={px - pw / 2 - 14} x2={px - pw / 2 - 14} y1={top} y2={top + cage * sc} className="dim-l" />
      <text x={px - pw / 2 - 18} y={top + (cage * sc) / 2} textAnchor="middle" transform={`rotate(-90 ${px - pw / 2 - 18} ${top + (cage * sc) / 2})`} className="t-s">gaiola {nf(cage, 1)} m</text>
      <text x={px} y={top + L * sc + 14} textAnchor="middle" className="t-s">L = {nf(L, 1)} m · Ø{nf(D * 100)} cm</text>
      {/* seção */}
      <g transform={`translate(${W - 90} 100)`}>
        <text x={-secR} y={-secR - 12} className="t-h">Seção</text>
        <circle r={secR} className="pile-sec" />
        <circle r={secR - (c.design.cover / (D / 2)) * secR} className="stirrup-c" />
        {Array.from({ length: l.n }, (_, k) => {
          const a = (2 * Math.PI * k) / l.n
          const R = (l.Rs / (D / 2)) * secR
          return <circle key={k} cx={R * Math.sin(a)} cy={-R * Math.cos(a)} r={Math.max(2.2, (l.phiMm / 1000 / D) * secR)} className="bar-dot" />
        })}
        <text y={secR + 18} textAnchor="middle" className="t-s">{l.n}Ø{nf(l.phiMm, 1)}</text>
        <text y={secR + 31} textAnchor="middle" className="t-s">cob. {nf(c.design.cover * 1000)} mm</text>
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ gráfico em profundidade

export function DepthChart({ zs, vs, title, unit, color, fill }: { zs: number[]; vs: number[]; title: string; unit: string; color: string; fill?: boolean }) {
  const W = 220, H = 280, pad = { l: 38, r: 10, t: 24, b: 24 }
  const finite = vs.filter(Number.isFinite)
  const vmin = Math.min(0, ...finite), vmax = Math.max(0, ...finite)
  const span = vmax - vmin || 1
  const zmin = Math.min(0, zs[0] ?? 0), zmax = zs[zs.length - 1] ?? 1
  const x = (v: number) => pad.l + ((v - vmin) / span) * (W - pad.l - pad.r)
  const y = (z: number) => pad.t + ((z - zmin) / (zmax - zmin || 1)) * (H - pad.t - pad.b)
  const d = zs.map((z, i) => `${i ? 'L' : 'M'}${x(vs[i]).toFixed(1)},${y(z).toFixed(1)}`).join(' ')
  const area = `${d} L${x(0).toFixed(1)},${y(zmax).toFixed(1)} L${x(0).toFixed(1)},${y(zmin).toFixed(1)} Z`
  const kmax = vs.reduce((k, v, i) => (Math.abs(v) > Math.abs(vs[k]) ? i : k), 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label={title}>
      <text x={pad.l} y={14} className="t-h">{title} ({unit})</text>
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} className="axis" />
      {fill && <path d={area} fill={color} opacity={0.14} />}
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
      <circle cx={x(vs[kmax])} cy={y(zs[kmax])} r={3.5} fill={color} />
      <text x={Math.min(x(vs[kmax]) + 6, W - 60)} y={y(zs[kmax]) - 6} className="t-s">{nf(vs[kmax], Math.abs(vs[kmax]) < 10 ? 1 : 0)}</text>
      <text x={pad.l - 4} y={pad.t + 4} textAnchor="end" className="t-s">0</text>
      <text x={pad.l - 4} y={H - pad.b + 4} textAnchor="end" className="t-s">{nf(zmax, 1)} m</text>
      <text x={pad.l} y={H - 8} className="t-s">{nf(vmin, 1)}</text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="t-s">{nf(vmax, 1)}</text>
    </svg>
  )
}

// ------------------------------------------------------------------ custos e utilização

export const COST_COLORS: Record<string, string> = { Concreto: '#5b8def', Aço: '#e4572e', Execução: '#2a9d8f', 'Mobilização e arrasamento': '#9b8bd0', Bloco: '#e9a23b', Extras: '#8a9099' }

export function CostBars({ cost }: { cost: Candidate['cost'] }) {
  const items = [
    ['Concreto', cost.concrete], ['Aço', cost.steel], ['Execução', cost.execution],
    ['Mobilização e arrasamento', cost.mobilization + cost.cutOff], ['Bloco', cost.block], ['Extras', cost.extras],
  ] as [string, number][]
  const total = cost.total || 1
  return (
    <div className="costs">
      <div className="stack">
        {cost.total === 0 ? <span style={{ width: '100%' }} className="empty-stack">Custos não informados (R$ 0)</span> : items.filter(([, v]) => v > 0).map(([k, v]) => (
          <span key={k} style={{ width: `${(v / total) * 100}%`, background: COST_COLORS[k] }} title={`${k}: ${nf(v)}`} />
        ))}
      </div>
      <ul className="cost-list">
        {items.map(([k, v]) => (
          <li key={k}><i style={{ background: COST_COLORS[k] }} />{k}<b>{v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</b><small>{cost.total ? nf((v / total) * 100) : 0}%</small></li>
        ))}
      </ul>
    </div>
  )
}

export function UtilBar({ label, value, limit, unit, hint, digits }: { label: string; value: number; limit: number; unit: string; hint?: string; digits?: number }) {
  const u = limit > 0 ? value / limit : 0
  const cls = u > 1 ? 'bad' : u > 0.85 ? 'warn' : 'ok'
  return (
    <div className="util" title={hint}>
      <div className="util-h"><span>{label}</span><b>{nf(value, digits ?? (value < 10 ? 1 : 0))} / {nf(limit, digits ?? (limit < 10 ? 1 : 0))} {unit}</b></div>
      <div className="util-t"><div className={`util-f ${cls}`} style={{ width: `${Math.min(u, 1.15) * 87}%` }} /><i style={{ left: '87%' }} /></div>
    </div>
  )
}

export function Kpi({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
      {children}
    </div>
  )
}

export const pileName = (c: Candidate) => `${PILE_LABEL[c.type]} Ø${nf(c.diameter * 100)}`

/** Tabela de utilização geotécnica por estaca: carga máxima em serviço, carga admissível (Padm) e utilização. */
export function PileLoadTable({ c, u = KN }: { c: Candidate; u?: Units }) {
  const padm = c.service.padm
  const d = u.k === 1 ? 0 : 1
  return (
    <table className="pile-t">
      <thead><tr><th>Estaca</th><th>Carga em serviço ({u.F})</th><th>P<sub>adm</sub> ({u.F})</th><th>Utilização</th></tr></thead>
      <tbody>
        {c.pileAxialELS.map((P, i) => {
          const r = P / padm
          return (
            <tr key={i}>
              <td>E{i + 1}</td><td>{nf(P * u.k, d)}</td><td>{nf(padm * u.k, d)}</td>
              <td className="ut"><span className={`bar ${r > 1 ? 'bad' : r > 0.85 ? 'warn' : 'ok'}`} style={{ width: `${Math.min(r, 1.15) * 85}%` }} /><b>{nf(r * 100, 0)} %</b></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
