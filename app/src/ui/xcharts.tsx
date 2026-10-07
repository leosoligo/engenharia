/** Gráficos amplos (seções dedicadas): diagrama de interação, capacidade em profundidade, estaca armada, colunas de esforços e bielas. */
import type { Candidate } from '../core/optimize'
import { momentCapacityFromCurve } from '../core/structural/section'
import type { PileArmor, PileVerification } from '../core/structural/verify'
import { KN, type Units } from './units'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

/** Marcas "redondas" para um eixo. */
function ticks(min: number, max: number, count = 6): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v)
  return out
}

// ------------------------------------------------------------------ diagrama de interação N–M

const envelopeOf = (v: PileVerification) => {
  const Ns = [...v.curve.a, ...v.curve.b].map((p) => p.N)
  const Nmin = Math.min(...Ns), Nmax = Math.max(...Ns)
  const grid = Array.from({ length: 90 }, (_, i) => Nmin + ((Nmax - Nmin) * i) / 89)
  return { Nmin, Nmax, env: grid.map((N) => ({ N, M: momentCapacityFromCurve(v.curve, N) })).filter((p) => Number.isFinite(p.M) && p.M >= 0) }
}

/** `reference`: envoltória da armadura sugerida (tracejada), para ver o efeito das alterações. Os eixos acompanham as duas curvas. */
export function InteractionDiagram({ v, set, reference, u = KN }: { v: PileVerification; set: number; reference?: PileVerification; u?: Units }) {
  const W = 640, H = 500, pad = { l: 64, r: 20, t: 34, b: 50 }
  const kk = u.k
  const sc2 = (e: { N: number; M: number }[]) => e.map((p) => ({ N: p.N * kk, M: p.M * kk }))
  const e0 = envelopeOf(v)
  const env = sc2(e0.env)
  const r0 = reference ? envelopeOf(reference) : undefined
  const ref = r0 ? { Nmin: r0.Nmin * kk, Nmax: r0.Nmax * kk, env: sc2(r0.env) } : undefined
  const Nmin = Math.min(e0.Nmin * kk, ref?.Nmin ?? Infinity), Nmax = Math.max(e0.Nmax * kk, ref?.Nmax ?? -Infinity)
  const pts = (set < 0 ? v.perSet.flat() : v.perSet[set] ?? []).filter((_, i, a) => a.length < 1500 || i % 2 === 0).map((p) => ({ ...p, N: p.N * kk, M: p.M * kk }))
  const Mx = Math.max(...env.map((p) => p.M), ...(ref?.env.map((p) => p.M) ?? []), ...pts.map((p) => Math.abs(p.M)), 1) * 1.08
  const Ny = Math.max(Nmax, ...pts.map((p) => p.N)) * 1.04
  const Nn = Math.min(Nmin, 0, ...pts.map((p) => p.N)) * 1.04
  const x = (m: number) => pad.l + ((m + Mx) / (2 * Mx)) * (W - pad.l - pad.r)
  const y = (n: number) => pad.t + ((Ny - n) / (Ny - Nn || 1)) * (H - pad.t - pad.b)
  const right = env.map((p) => `${x(p.M).toFixed(1)},${y(p.N).toFixed(1)}`)
  const left = [...env].reverse().map((p) => `${x(-p.M).toFixed(1)},${y(p.N).toFixed(1)}`)
  const refPoly = ref ? [...ref.env.map((p) => `${x(p.M).toFixed(1)},${y(p.N).toFixed(1)}`), ...[...ref.env].reverse().map((p) => `${x(-p.M).toFixed(1)},${y(p.N).toFixed(1)}`)].join(' ') : ''
  const c = v.critical
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Diagrama de interação N–M">
      <text x={pad.l} y={18} className="t-h">Diagrama de interação N–M (ELU, γc = {nf(v.gammaC, 1)}, fck {v.fck} MPa)</text>
      {ticks(-Mx, Mx, 8).map((t) => <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} className="grid" /><text x={x(t)} y={H - pad.b + 16} textAnchor="middle" className="t-s">{nf(t)}</text></g>)}
      {ticks(Nn, Ny, 7).map((t) => <g key={`y${t}`}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="t-s">{nf(t)}</text></g>)}
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} className="axis" />
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="axis" />
      {refPoly && <polygon points={refPoly} className="env-ref" />}
      <polygon points={[...right, ...left].join(' ')} className="env" />
      {pts.map((p, i) => <circle key={i} cx={x(p.M)} cy={y(p.N)} r={2.6} className={p.FS >= 1 ? 'pt-ok' : 'pt-bad'} />)}
      {Number.isFinite(c.FS) && <circle cx={x(c.M * kk)} cy={y(c.N * kk)} r={7} className="pt-crit" />}
      <text x={W / 2} y={H - 10} textAnchor="middle" className="t-s">Momento fletor M ({u.M})</text>
      <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="t-s">Esforço normal N ({u.F}) — compressão para cima</text>
      <g transform={`translate(${W - pad.r - 190} ${pad.t + 6})`} className="legend-svg">
        <rect width={190} height={ref ? 82 : 64} rx={6} className="legend-bg" />
        <rect x={10} y={10} width={14} height={9} className="env" /><text x={30} y={18} className="t-s">envoltória resistente MRd(N)</text>
        <circle cx={17} cy={32} r={3} className="pt-ok" /><text x={30} y={36} className="t-s">solicitação (FS ≥ 1)</text>
        <circle cx={17} cy={50} r={3} className="pt-bad" /><text x={30} y={54} className="t-s">solicitação fora (FS &lt; 1)</text>
        {ref && <><rect x={10} y={64} width={14} height={9} className="env-ref" /><text x={30} y={72} className="t-s">armadura sugerida</text></>}
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ momento solicitante × resistente em profundidade

export function CapacityDepthChart({ v, set, cage, L, u = KN }: { v: PileVerification; set: number; cage: number; L: number; u?: Units }) {
  const W = 640, H = 500, pad = { l: 56, r: 20, t: 34, b: 46 }
  const n = v.perSet[0]?.length ?? 0
  const zs = v.perSet[0]?.map((r) => r.z) ?? []
  const demand = zs.map((_, i) => (set < 0 ? Math.max(...v.perSet.map((s) => Math.abs(s[i].M))) : Math.abs(v.perSet[set][i].M)) * u.k)
  const cap = zs.map((_, i) => (set < 0 ? Math.min(...v.perSet.map((s) => s[i].MRd)) : v.perSet[set][i].MRd) * u.k)
  const zmax = Math.max(zs[n - 1] ?? 1, cage, 1)
  const Mx = Math.max(...demand, ...cap.filter((_, i) => zs[i] <= cage + 1e-9), 1) * 1.1
  const x = (m: number) => pad.l + (m / Mx) * (W - pad.l - pad.r)
  const y = (z: number) => pad.t + (z / zmax) * (H - pad.t - pad.b)
  const inCage = zs.map((z) => z <= cage + 1e-9)
  const capPath = zs.map((z, i) => (inCage[i] ? `${x(cap[i]).toFixed(1)},${y(z).toFixed(1)}` : '')).filter(Boolean).join(' ')
  const demPath = zs.map((z, i) => `${x(demand[i]).toFixed(1)},${y(z).toFixed(1)}`).join(' ')
  const bad = zs.map((_, i) => (inCage[i] && demand[i] > cap[i] + 1e-9 ? i : -1)).filter((i) => i >= 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Momento solicitante e resistente ao longo da estaca">
      <text x={pad.l} y={18} className="t-h">Momento solicitante × resistente ao longo da estaca</text>
      {ticks(0, Mx, 6).map((t) => <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} className="grid" /><text x={x(t)} y={H - pad.b + 16} textAnchor="middle" className="t-s">{nf(t)}</text></g>)}
      {ticks(0, zmax, 8).map((t) => <g key={`y${t}`}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="t-s">{nf(t, t % 1 ? 1 : 0)} m</text></g>)}
      <rect x={pad.l} y={y(Math.min(cage, zmax))} width={W - pad.l - pad.r} height={Math.max(H - pad.b - y(Math.min(cage, zmax)), 0)} className="nocage" />
      <polyline points={capPath} className="line-cap" fill="none" />
      <polyline points={demPath} className="line-dem" fill="none" />
      {bad.map((i) => <circle key={i} cx={x(demand[i])} cy={y(zs[i])} r={4} className="pt-bad" />)}
      <line x1={pad.l} x2={W - pad.r} y1={y(cage)} y2={y(cage)} className="cage-l" />
      <text x={W - pad.r - 4} y={y(cage) - 5} textAnchor="end" className="t-s">fim da gaiola ({nf(cage, 1)} m){cage < L ? ' — abaixo: sem armadura longitudinal' : ''}</text>
      <text x={W / 2} y={H - 10} textAnchor="middle" className="t-s">Momento ({u.M}) — {set < 0 ? 'envoltória de todas as combinações e estacas' : 'estaca/combinação selecionada'}</text>
      <g transform={`translate(${pad.l + 10} ${pad.t + 8})`}>
        <line x1={0} x2={22} y1={6} y2={6} className="line-dem" /><text x={28} y={10} className="t-s">|Md| solicitante</text>
        <line x1={0} x2={22} y1={24} y2={24} className="line-cap" /><text x={28} y={28} className="t-s">MRd(N) resistente</text>
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ estaca armada (ampliada)

const cm = (x: number, d = 0) => nf(x * 100, d)

export function PileDrawingXL({ D, L, cover, armor, Rs, phiRes }: { D: number; L: number; cover: number; armor: PileArmor; Rs: number; phiRes?: number }) {
  const W = 900
  const cage = Math.min(armor.cageLength, L)
  const anch = armor.anchorage
  // trecho desenhado a escala: da ancoragem até o fim da gaiola + 0,6 m; se sobrar muito fuste, quebra e mostra a ponta
  const rest = L - cage
  const broken = rest > 2.5
  const tail = broken ? 0.9 : Math.max(rest, 0)
  const topShown = broken ? cage + 0.6 : L - tail
  const drawn = anch + topShown + (broken ? 0.5 : 0) + tail
  const topPad = 70, botPad = 70
  const sc = Math.min(66, 520 / Math.max(drawn, 1))
  const H = topPad + drawn * sc + botPad
  const px = 250
  const pw = Math.max(86, Math.min(120, D * 100 * 2.6))
  const y0 = topPad + anch * sc // topo da estaca
  const yCage = y0 + cage * sc
  const yShownEnd = y0 + topShown * sc
  const yBreak2 = yShownEnd + (broken ? 0.5 * sc : 0)
  const yEnd = yBreak2 + tail * sc
  const rr = (Rs / (D / 2)) * (pw / 2)
  const ycv = (cover / (D / 2)) * (pw / 2)
  // estribos: posições (m a partir do topo) conforme o passo; desenha só no trecho a escala
  const ys: number[] = []
  for (let z = 0; z <= Math.min(cage, topShown) + 1e-9; z += armor.spacing) ys.push(z)
  const stepPx = armor.spacing * sc
  const dense = stepPx < 3
  const secR = 112
  const k = secR / (D / 2)
  const sx = 740, sy = 150
  const Rlong = Math.max(3.2, ((phiRes ?? armor.phiMm / 1000) / 2) * k)
  const leader = (x1: number, y1: number, x2: number, y2: number, label: string, anchor: 'start' | 'end' = 'start') => (
    <g>
      <polyline points={`${x1},${y1} ${x2},${y2} ${anchor === 'start' ? x2 + 14 : x2 - 14},${y2}`} className="leader" fill="none" />
      <text x={anchor === 'start' ? x2 + 18 : x2 - 18} y={y2 + 4} textAnchor={anchor} className="t-m halo">{label}</text>
    </g>
  )
  const vdim = (x: number, ya: number, yb: number, label: string, side: 'l' | 'r') => (
    <g className="dimg">
      <line x1={x} x2={x} y1={ya} y2={yb} /><line x1={x - 5} x2={x + 5} y1={ya + 5} y2={ya - 5} /><line x1={x - 5} x2={x + 5} y1={yb + 5} y2={yb - 5} />
      <text x={side === 'l' ? x - 6 : x + 15} y={(ya + yb) / 2} textAnchor="middle" transform={`rotate(-90 ${side === 'l' ? x - 6 : x + 15} ${(ya + yb) / 2})`} className="t-m halo">{label}</text>
    </g>
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl pile-draw" role="img" aria-label="Armação da estaca">
      <text x={16} y={26} className="t-hh">Armação da estaca — elevação e seção</text>

      {/* bloco (ancoragem) */}
      {anch > 0 && (
        <g>
          <rect x={px - pw / 2 - 40} y={topPad} width={pw + 80} height={anch * sc} className="blk-dash" />
          <text x={px + pw / 2 + 48} y={topPad + (anch * sc) / 2 + 4} className="t-m">bloco</text>
        </g>
      )}
      {/* corpo da estaca */}
      <path d={`M${px - pw / 2},${y0} V${yShownEnd} ${broken ? `l${pw / 4},6 l${pw / 4},-12 l${pw / 4},12 l${pw / 4},-6` : `H${px + pw / 2}`} V${y0} Z`} className="pile-sec" />
      {broken && <path d={`M${px - pw / 2},${yBreak2} l${pw / 4},-6 l${pw / 4},12 l${pw / 4},-12 l${pw / 4},6 V${yEnd} H${px - pw / 2} Z`} className="pile-sec" />}
      <line x1={px - pw / 2 - 12} x2={px + pw / 2 + 12} y1={y0} y2={y0} className="axis" />
      {/* barras longitudinais */}
      {[-rr, rr].map((dx) => <line key={dx} x1={px + dx} x2={px + dx} y1={y0 - anch * sc} y2={yCage} className="rebar" />)}
      {[-rr, rr].flatMap((dx) => [yCage].map((yy) => <circle key={`${dx}${yy}`} cx={px + dx} cy={yy} r={2.8} className="bar-dot" />))}
      {/* estribos */}
      {ys.map((z, i) => <line key={i} x1={px - pw / 2 + ycv} x2={px + pw / 2 - ycv} y1={y0 + z * sc} y2={y0 + z * sc} className="stirrup-l" strokeWidth={dense ? 0.7 : 1.3} opacity={dense ? 0.55 : 1} />)}
      <text x={px} y={yEnd + 22} textAnchor="middle" className="t-m">Ø{cm(D)} cm · ponta</text>

      {/* cotas à esquerda: ancoragem, trechos de estribo, gaiola */}
      {anch > 0 && (
        <g className="dimg">
          <line x1={px - pw / 2 - 52} x2={px - pw / 2 - 52} y1={topPad} y2={y0} /><line x1={px - pw / 2 - 57} x2={px - pw / 2 - 47} y1={topPad + 5} y2={topPad - 5} /><line x1={px - pw / 2 - 57} x2={px - pw / 2 - 47} y1={y0 + 5} y2={y0 - 5} />
          <text x={px - pw / 2 - 62} y={(topPad + y0) / 2 + 4} textAnchor="end" className="t-m halo">ancoragem {cm(anch)}</text>
        </g>
      )}
      {vdim(px - pw / 2 - 52, y0, yCage, `gaiola ${cm(cage)}`, 'l')}
      {/* cota do comprimento total (com quebra) */}
      <g className="dimg">
        <line x1={px + pw / 2 + 60} x2={px + pw / 2 + 60} y1={y0} y2={yEnd} /><line x1={px + pw / 2 + 55} x2={px + pw / 2 + 65} y1={y0 + 5} y2={y0 - 5} /><line x1={px + pw / 2 + 55} x2={px + pw / 2 + 65} y1={yEnd + 5} y2={yEnd - 5} />
        <text x={px + pw / 2 + 75} y={(y0 + yEnd) / 2} textAnchor="middle" transform={`rotate(-90 ${px + pw / 2 + 75} ${(y0 + yEnd) / 2})`} className="t-m halo">L = {cm(L)} cm{broken ? ' (trecho central omitido)' : ''}</text>
      </g>
      {dense && <text x={px - pw / 2 - 52} y={H - 22} className="t-s">estribos desenhados em escala reduzida de passo</text>}

      {/* chamadas */}
      {leader(px + rr, y0 + Math.min(cage * sc * 0.18, 70), px + pw / 2 + 96, y0 + Math.min(cage * sc * 0.18, 70) - 22, `N1 · ${armor.n} Ø${nf(armor.phiMm, 1)} · C = ${cm(cage + anch)} cm`)}
      {leader(px + pw / 2 - ycv, y0 + Math.min(cage * sc * 0.5, 190), px + pw / 2 + 96, y0 + Math.min(cage * sc * 0.5, 190) + 14, `N2 · ${armor.transverse === 'estribo' ? 'estribos' : 'helicoidal'} Ø${nf(armor.phitMm, 1)} c/${nf(armor.spacing * 100, 1)} cm`)}

      {/* seção transversal */}
      <g transform={`translate(${sx} ${sy})`}>
        <text x={-secR} y={-secR - 20} className="t-hh">Seção transversal</text>
        <circle r={secR} className="pile-sec" />
        <circle r={secR - cover * k} className="stirrup-c" />
        {Array.from({ length: armor.n }, (_, i) => {
          const a = (2 * Math.PI * i) / armor.n
          const R = Rs * k
          return <circle key={i} cx={R * Math.sin(a)} cy={-R * Math.cos(a)} r={Rlong} className="bar-dot" />
        })}
        <g className="dimg"><line x1={-secR} x2={secR} y1={secR + 26} y2={secR + 26} /><line x1={-secR} x2={-secR} y1={secR + 18} y2={secR + 34} /><line x1={secR} x2={secR} y1={secR + 18} y2={secR + 34} /></g>
        <text y={secR + 20} textAnchor="middle" className="t-m halo">Ø{cm(D)} cm</text>
        <text y={secR + 52} textAnchor="middle" className="t-m">{armor.n} Ø{nf(armor.phiMm, 1)} · estribo Ø{nf(armor.phitMm, 1)}</text>
        <text y={secR + 71} textAnchor="middle" className="t-s">cobrimento {nf(cover * 1000)} mm · Rs = {cm(Rs, 1)} cm</text>
      </g>
    </svg>
  )
}

// ------------------------------------------------------------------ colunas de esforços

export interface Panel { title: string; unit: string; z: number[]; v: number[]; color: string; /** valor-limite (linha tracejada) com rótulo */ limit?: { v: number; label: string } }

export function DepthColumns({ panels, marks = [], height = 640, depthLabel = 'Profundidade a partir do topo da estaca (m)' }: { panels: Panel[]; marks?: { z: number; label: string }[]; height?: number; depthLabel?: string }) {
  const pw = 280, gap = 26, left = 66
  const W = left + panels.length * (pw + gap)
  const H = height
  const top = 78, bottom = 26
  const zmax = Math.max(...panels.flatMap((p) => p.z), 1)
  const plotH = H - top - bottom - 22 // folga no fim do eixo: rótulos do último ponto não são cortados
  const y = (z: number) => top + (z / zmax) * plotH
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Esforços e deslocamentos ao longo da estaca">
      <text x={14} y={top + (H - top - bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${top + (H - top - bottom) / 2})`} className="t-s">{depthLabel}</text>
      {ticks(0, zmax, 12).map((t) => <g key={t}><line x1={left - 4} x2={W - 6} y1={y(t)} y2={y(t)} className="grid" /><text x={left - 8} y={y(t) + 4} textAnchor="end" className="t-s">{nf(t, t % 1 ? 1 : 0)}</text></g>)}
      {panels.map((p, k) => {
        const x0 = left + k * (pw + gap)
        const fin = p.v.filter(Number.isFinite)
        const vmin = Math.min(0, ...fin), vmax = Math.max(0, ...fin, p.limit ? p.limit.v * 1.08 : 0)
        const span = vmax - vmin || 1
        const inner = 14
        const x = (v: number) => x0 + inner + ((v - vmin) / span) * (pw - 2 * inner)
        const d = p.z.map((z, i) => `${i ? 'L' : 'M'}${x(p.v[i]).toFixed(1)},${y(z).toFixed(1)}`).join(' ')
        const area = `${d} L${x(0).toFixed(1)},${y(p.z[p.z.length - 1]).toFixed(1)} L${x(0).toFixed(1)},${y(p.z[0]).toFixed(1)} Z`
        const kmax = p.v.reduce((a, v, i) => (Math.abs(v) > Math.abs(p.v[a]) ? i : a), 0)
        const constant = Math.abs(vmax - vmin) < 1e-9 * Math.max(1, Math.abs(vmax)) || (vmin === 0 && fin.every((v) => v === fin[0]))
        // rótulos: pontos separados ≥ 30 px na vertical, mais o valor máximo
        const labelled: number[] = [kmax]
        let lastY = y(p.z[kmax])
        if (!constant) {
          for (let i = 0; i < p.z.length; i++) {
            const yy = y(p.z[i])
            if (Math.abs(yy - lastY) >= 32 && labelled.every((j) => Math.abs(y(p.z[j]) - yy) >= 30)) { labelled.push(i); lastY = yy }
          }
        }
        const dec = (v: number) => (Math.abs(v) < 10 ? 2 : 1)
        const cid = `clip-${k}`
        return (
          <g key={p.title}>
            <clipPath id={cid}><rect x={x0} y={top} width={pw} height={H - top - bottom} /></clipPath>
            <rect x={x0} y={top} width={pw} height={H - top - bottom} className="panel-bg" />
            <text x={x0} y={28} className="t-hh">{p.title}</text>
            <text x={x0} y={48} className="t-s">{p.unit} · máx. {nf(p.v[kmax], dec(p.v[kmax]))} a {nf(p.z[kmax], 1)} m</text>
            <g clipPath={`url(#${cid})`}>
              <line x1={x(0)} x2={x(0)} y1={top} y2={H - bottom} className="axis" strokeDasharray="4 3" />
              {p.limit && <g><line x1={x(p.limit.v)} x2={x(p.limit.v)} y1={top} y2={H - bottom} stroke="#d1495b" strokeWidth={1.6} strokeDasharray="6 4" /><text x={x(p.limit.v) - 6} y={top + 14} textAnchor="end" className="t-s halo">{p.limit.label}</text></g>}
              <path d={area} fill={p.color} opacity={0.16} />
              <path d={d} fill="none" stroke={p.color} strokeWidth={2.4} />
              {labelled.map((i) => {
                const px = x(p.v[i]), right = px < x0 + pw * 0.62
                return (
                  <g key={i}>
                    <circle cx={px} cy={y(p.z[i])} r={i === kmax ? 4.5 : 3} fill={p.color} />
                    <text x={px + (right ? 8 : -8)} y={Math.max(y(p.z[i]) + 4, top + 15)} textAnchor={right ? 'start' : 'end'} className="t-m halo">{nf(p.v[i], dec(p.v[i]))}</text>
                  </g>
                )
              })}
            </g>
          </g>
        )
      })}
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={left} x2={W - 6} y1={y(m.z)} y2={y(m.z)} className="cage-l" />
          <text x={left + 8} y={y(m.z) - 6} className="t-s halo">{m.label}</text>
        </g>
      ))}
    </svg>
  )
}

// ------------------------------------------------------------------ bielas e tirantes (Blévot–Frémy)

export function StrutTiePlan({ c, ax, ay, u = KN }: { c: Candidate; ax: number; ay: number; u?: Units }) {
  const g = c.blockDesign.geometry
  const P = c.layout.points.map((_, i) => Math.max(0, ...c.blockInput.combos.map((k) => k.P[i])))
  const W = 560, H = 440, pad = 50
  const sc = Math.min((W - 2 * pad) / g.lx, (H - 2 * pad) / g.ly)
  const X = (x: number) => W / 2 + (x - g.cx) * sc
  const Y = (y: number) => H / 2 - (y - g.cy) * sc
  const Pmax = Math.max(...P, 1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Bielas em planta">
      <text x={14} y={20} className="t-h">Bielas em planta — reações de cálculo (ELU)</text>
      <polygon points={g.outline.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')} className="blk" />
      <rect x={X(-ax / 2)} y={Y(ay / 2)} width={ax * sc} height={ay * sc} className="pillar-fill" />
      {c.layout.points.map((p, i) => (
        <g key={i}>
          <line x1={X(0)} y1={Y(0)} x2={X(p.x)} y2={Y(p.y)} className="strut" strokeWidth={1.5 + (P[i] / Pmax) * 4} />
          <circle cx={X(p.x)} cy={Y(p.y)} r={(c.diameter / 2) * sc} className="pile-st" fill="var(--pile)" />
          <text x={X(p.x)} y={Y(p.y) - 2} textAnchor="middle" className="t-pile">E{i + 1}</text>
          <text x={X(p.x)} y={Y(p.y) + 12} textAnchor="middle" className="t-s">{nf(P[i] * u.k, u.k === 1 ? 0 : 1)} {u.F}</text>
        </g>
      ))}
    </svg>
  )
}

export function StrutTieElevation({ c, pile, u = KN }: { c: Candidate; pile: number; u?: Units }) {
  const g = c.blockDesign.geometry
  const p = c.layout.points[pile]
  const r = Math.hypot(p.x, p.y)
  const theta = (c.blockDesign.theta[pile] * Math.PI) / 180
  const d = g.d
  const arm = d / Math.tan(theta) // r − a
  const a = r - arm
  const Rs = c.blockDesign.Rs[pile]
  const Pu = Math.max(0, ...c.blockInput.combos.map((k) => k.P[pile]))
  const W = 560, H = 440, padX = 70
  const span = Math.max(r + c.diameter / 2, 0.3)
  const sc = Math.min((W - 2 * padX) / span, (H - 150) / (g.h + 0.4))
  const x0 = padX
  const X = (m: number) => x0 + m * sc
  const yTop = 70
  const Y = (m: number) => yTop + m * sc
  const yBar = Y(d) // eixo do tirante
  const yBot = Y(g.h)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Biela e tirante da estaca">
      <text x={14} y={20} className="t-h">Biela e tirante — estaca E{pile + 1} (plano radial)</text>
      <rect x={X(0)} y={Y(0)} width={span * sc} height={g.h * sc} className="blk" />
      <rect x={X(r - c.diameter / 2)} y={yBot} width={c.diameter * sc} height={0.35 * sc} className="pile-sec" />
      <line x1={X(a)} y1={Y(0)} x2={X(r)} y2={yBar} className="strut" strokeWidth={4} />
      <line x1={X(0)} y1={yBar} x2={X(r)} y2={yBar} className="tie" strokeWidth={4} />
      <circle cx={X(a)} cy={Y(0)} r={5} className="node" /><circle cx={X(r)} cy={yBar} r={5} className="node" />
      <line x1={X(a)} y1={Y(0) - 28} x2={X(a)} y2={Y(0)} className="arrow-l" />
      <text x={X(a)} y={Y(0) - 34} textAnchor="middle" className="t-s">carga do pilar (parcela)</text>
      <line x1={X(r)} y1={yBot + 0.35 * sc + 28} x2={X(r)} y2={yBot + 0.35 * sc + 2} className="arrow-l" />
      <text x={X(r)} y={yBot + 0.35 * sc + 44} textAnchor="middle" className="t-s">reação P = {nf(Pu * u.k, u.k === 1 ? 0 : 1)} {u.F}</text>
      <text x={(X(a) + X(r)) / 2 + 10} y={(Y(0) + yBar) / 2} className="t-h">θ = {nf(c.blockDesign.theta[pile], 1)}°</text>
      <text x={X(r / 2)} y={yBar - 8} textAnchor="middle" className="t-h">Rs = {nf(Rs * u.k, u.k === 1 ? 0 : 1)} {u.F} (tirante)</text>
      <g className="dim">
        <line x1={X(0) - 14} x2={X(0) - 14} y1={Y(0)} y2={yBar} /><text x={X(0) - 20} y={(Y(0) + yBar) / 2} textAnchor="middle" transform={`rotate(-90 ${X(0) - 20} ${(Y(0) + yBar) / 2})`}>d = {nf(d * 100)} cm</text>
        <line x1={X(a)} x2={X(r)} y1={yBar + 20} y2={yBar + 20} /><text x={(X(a) + X(r)) / 2} y={yBar + 16} textAnchor="middle">r − a = {nf(arm * 100)} cm</text>
        <line x1={X(0)} x2={X(r)} y1={yBot + 0.35 * sc + 64} y2={yBot + 0.35 * sc + 64} /><text x={X(r / 2)} y={yBot + 0.35 * sc + 60} textAnchor="middle">r = {nf(r * 100)} cm (centro do pilar à estaca)</text>
      </g>
    </svg>
  )
}
