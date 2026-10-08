/**
 * Desenho de detalhamento em DXF (ASCII R12/AC1009; abre em AutoCAD, BricsCAD, LibreCAD etc.).
 * Unidade do desenho: METRO, em tamanho real (1 unidade = 1 m; uma barra de 1 m mede 1,0). O código monta o desenho em
 * centímetros e `Dxf` converte (×0,01) ao gravar. Escala de plotagem 1:25: alturas de texto = mm de papel × 25 / 1000.
 * O formato DWG é proprietário: abra o DXF e salve como DWG, se necessário.
 *
 * Conteúdo (uma prancha em espaço-modelo): ficha da estaca, seção e estribo, elevação da estaca armada com ancoragem,
 * trechos de estribo e cotas (esc. 1:25), planta do bloco com estacas, cotas e armaduras, corte do bloco, detalhes das
 * barras do bloco, tabela de aço, resumo de aço e quantitativos, notas e carimbo.
 * Os desenhos são esquemáticos de projeto: conferir antes de emitir para obra.
 */
import type { Candidate } from '../core/optimize'
import { PILE_LABEL } from '../core/pile'
import { barSchedule } from './schedule'
import { chordOf } from '../core/block'

type Pt = [number, number]

const SYM: Record<string, string> = { '≥': '>=', '≤': '<=', '≈': '~', '×': 'x', '·': '.', '–': '-', '—': '-', '²': '2', '³': '3', 'γ': 'gama', 'α': 'alfa', 'θ': 'teta', 'φ': 'fi', 'ρ': 'ro', 'ξ': 'xi', 'Δ': 'D', 'º': 'o' }

class Dxf {
  private ents: string[] = []
  private layers = new Map<string, { color: number; ltype: string }>()
  layer(name: string, color: number, ltype = 'CONTINUOUS') {
    this.layers.set(name, { color, ltype })
  }
  /** Coordenadas no código em cm; gravadas em metros. */
  private m(v: number) {
    return +(v * 0.01).toFixed(5)
  }
  line(l: string, a: Pt, b: Pt) {
    this.ents.push(['0', 'LINE', '8', l, '10', this.m(a[0]), '20', this.m(a[1]), '30', 0, '11', this.m(b[0]), '21', this.m(b[1]), '31', 0].join('\n'))
  }
  poly(l: string, pts: Pt[], closed = false) {
    for (let i = 0; i < pts.length - 1; i++) this.line(l, pts[i], pts[i + 1])
    if (closed && pts.length > 2) this.line(l, pts[pts.length - 1], pts[0])
  }
  circle(l: string, c: Pt, r: number) {
    this.ents.push(['0', 'CIRCLE', '8', l, '10', this.m(c[0]), '20', this.m(c[1]), '30', 0, '40', this.m(r)].join('\n'))
  }
  rect(l: string, a: Pt, b: Pt) {
    this.poly(l, [a, [b[0], a[1]], b, [a[0], b[1]]], true)
  }
  /** Texto (esquerda). Ø, ° e ± viram códigos %%c, %%d, %%p; acentos são removidos para compatibilidade com leitores antigos. */
  text(l: string, p: Pt, h: number, s: string, rot = 0, just: 0 | 1 | 2 = 0) {
    const t = s.replace(/[≥≤≈×·–—²³γαθφρξΔº]/g, (m) => SYM[m] ?? '').replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?')
    // justificação feita pelo CAD (72 = esquerda/centro/direita; ponto de alinhamento em 11/21): independe da fonte
    const al = just ? ['72', just, '11', this.m(p[0]), '21', this.m(p[1]), '31', 0] : []
    this.ents.push(['0', 'TEXT', '8', l, '10', this.m(p[0]), '20', this.m(p[1]), '30', 0, '40', this.m(h), '1', t, ...(rot ? ['50', rot] : []), ...al].join('\n'))
  }
  /** Largura estimada do texto (fonte padrão de CAD ≈ 0,78·h por caractere). */
  width(s: string, h: number) {
    return s.replace(/Ø|°|±/g, 'x').length * h * 0.78
  }
  /** Corta o texto para caber em `w` (cm), com reticências. */
  fit(s: string, w: number, h: number) {
    let t = s
    while (t.length > 3 && this.width(t, h) > w - 4) t = t.slice(0, -1)
    return t === s ? s : t.slice(0, -2) + '..'
  }
  textC(l: string, p: Pt, h: number, s: string, rot = 0) {
    this.text(l, p, h, s, rot, 1)
  }
  textR(l: string, p: Pt, h: number, s: string) {
    this.text(l, p, h, s, 0, 2)
  }
  /** Cota linear (horizontal ou vertical): linhas de chamada, linha de cota, traços a 45° e texto. off > 0: para cima/direita. */
  dim(a: Pt, b: Pt, off: number, label: string, h = 5.5) {
    const horiz = Math.abs(b[1] - a[1]) <= Math.abs(b[0] - a[0])
    const A: Pt = horiz ? [a[0], a[1] + off] : [a[0] + off, a[1]]
    const B: Pt = horiz ? [b[0], b[1] + off] : [b[0] + off, b[1]]
    const g = 2 * Math.sign(off || 1)
    this.line('COTAS', horiz ? [a[0], a[1] + g] : [a[0] + g, a[1]], horiz ? [A[0], A[1] + g] : [A[0] + g, A[1]])
    this.line('COTAS', horiz ? [b[0], b[1] + g] : [b[0] + g, b[1]], horiz ? [B[0], B[1] + g] : [B[0] + g, B[1]])
    this.line('COTAS', A, B)
    const k = 2.5
    for (const P of [A, B]) this.line('COTAS', [P[0] - k, P[1] - k], [P[0] + k, P[1] + k])
    if (horiz) this.textC('COTAS', [(A[0] + B[0]) / 2, A[1] + (off >= 0 ? 1.5 : -h - 1.5)], h, label)
    else this.textC('COTAS', [A[0] + (off >= 0 ? h + 1.5 : -1.5), (A[1] + B[1]) / 2], h, label, 90)
  }
  /** Chamada: linha de A até B seguida de um trecho horizontal, com o texto ao lado. */
  leader(a: Pt, b: Pt, label: string, h = 5, layer = 'CHAMADAS') {
    this.line(layer, a, b)
    const e: Pt = [b[0] + 10, b[1]]
    this.line(layer, b, e)
    this.text('TEXTO', [e[0] + 2, e[1] - h / 2], h, label)
  }
  toString(): string {
    const lt = [
      ['CONTINUOUS', 'Solid line', []],
      ['DASHED', 'Dashed', [0.06, -0.03]],
      ['CENTER', 'Center', [0.2, -0.04, 0.04, -0.04]],
    ] as [string, string, number[]][]
    const ltypes = lt.map(([n, d, p]) => ['0', 'LTYPE', '2', n, '70', 0, '3', d, '72', 65, '73', p.length, '40', p.reduce((a, b) => a + Math.abs(b), 0), ...p.flatMap((v) => ['49', v])].join('\n'))
    const lay = [...this.layers.entries()].map(([n, v]) => ['0', 'LAYER', '2', n, '70', 0, '62', v.color, '6', v.ltype].join('\n'))
    return [
      '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', 6, '9', '$MEASUREMENT', '70', 1, '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LTYPE', '70', lt.length, ltypes.join('\n'), '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', this.layers.size, lay.join('\n'), '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES', this.ents.join('\n'), '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n')
  }
}

const f = (x: number, d = 1) => x.toFixed(d).replace('.', ',')
const phiTxt = (x: number) => f(x, x % 1 ? 1 : 0)

export interface DxfContext {
  pillar: { ax: number; ay: number }
  title?: string
  /** Data (AAAA-MM-DD) no carimbo. */
  dateISO?: string
}

/** Alturas de texto em cm reais, para plotagem 1:25: T = 2,4 mm; TS = 2,0 mm; TH = 3,2 mm de papel. */
const T = 6
const TS = 5
const TH = 8

export function buildDxf(c: Candidate, ctx: DxfContext): string {
  const d = new Dxf()
  d.layer('CONTORNO', 7); d.layer('ESTACAS', 3); d.layer('PILAR', 5); d.layer('ARM_LONG', 1); d.layer('ARM_ESTRIBO', 6)
  d.layer('ARM_BLOCO', 1); d.layer('ARM_MALHA', 2); d.layer('EIXOS', 8, 'CENTER'); d.layer('OCULTO', 8, 'DASHED')
  d.layer('COTAS', 4); d.layer('CHAMADAS', 8); d.layer('TEXTO', 7); d.layer('TABELA', 7); d.layer('QUADRO', 7); d.layer('LASTRO', 8)

  const bd = c.blockDesign
  const g = bd.geometry
  const des = c.design
  const l = des.longitudinal!
  const tr = des.transverse!
  const sch = barSchedule(c)
  const np = c.layout.n
  const D = c.diameter * 100
  const L = c.length * 100
  const cover = des.cover * 100
  const cage = Math.min(des.cageLength!, c.length) * 100
  const anch = (des.anchorage ?? 0) * 100
  const Rs = l.Rs * 100
  const lx = g.lx * 100, ly = g.ly * 100, h = g.h * 100, dEff = g.d * 100, cov = g.cover * 100
  // planta relativa ao centro do bloco; o pilar fica em (pcx, pcy)
  const pcx = -g.cx * 100, pcy = -g.cy * 100
  const pts = c.layout.points.map((p) => ({ x: (p.x - g.cx) * 100, y: (p.y - g.cy) * 100 }))
  const pax = ctx.pillar.ax * 100, pay = ctx.pillar.ay * 100
  const nBars = l.n

  // =================================================== COLUNA A — ESTACA (x ≥ 0; topo em y = 0)
  const AX = 0
  const head = [
    `ESTACA Ø${f(D, 0)} CM`,
    `${PILE_LABEL[c.type]} moldada in loco`,
    `Quantidade: ${np} estaca(s)`,
    `fck: ${des.fck} MPa  |  aco CA-50 (Ø5,0 em CA-60)`,
    `Diametro da estaca: ${f(D, 0)} cm`,
    `Cobrimento de concreto: ${f(cover, 1)} cm`,
    `Comprimento da estaca: ${f(L, 0)} cm (a partir da base do bloco)`,
  ]
  d.rect('QUADRO', [AX, 0], [AX + 440, -(head.length * 11 + 10)])
  head.forEach((s, i) => d.text('TEXTO', [AX + 8, -(i * 11) - (i === 0 ? 14 : 12)], i === 0 ? TH + 2 : T + 0.5, s))
  let yA = -(head.length * 11 + 10) - 20

  // seção e estribo (1:10 → fator 2,5; D maior usa 1:20 ou 1:25)
  const fs = 1 // tamanho real (a escala de plotagem é única: 1:25)
  const escSec = '1:25'
  const secR = (D / 2) * fs
  const secC: Pt = [AX + 90, yA - 20 - secR - 14]
  d.text('TEXTO', [AX + 8, yA - 8], TH, `SECAO - ESC. ${escSec}`)
  d.circle('ESTACAS', secC, secR)
  d.circle('ARM_ESTRIBO', secC, (D / 2 - cover) * fs)
  for (let k = 0; k < nBars; k++) {
    const a = (2 * Math.PI * k) / nBars
    d.circle('ARM_LONG', [secC[0] + Rs * fs * Math.sin(a), secC[1] - Rs * fs * Math.cos(a)], Math.max((l.phiMm / 20) * fs, 0.4))
  }
  d.dim([secC[0] - secR, secC[1] - secR], [secC[0] + secR, secC[1] - secR], -10, `${f(D, 1)} cm`)
  d.text('TEXTO', [secC[0] + secR + 14, secC[1] + 6], T, `${nBars} N1 Ø${phiTxt(l.phiMm)}`)
  d.text('TEXTO', [secC[0] + secR + 14, secC[1] - 4], T, `cobrimento ${f(cover, 1)} cm`)
  const Rst = D / 2 - cover - tr.phiMm / 20
  const stC: Pt = [AX + 330, secC[1]]
  d.text('TEXTO', [AX + 250, yA - 8], TH, tr.type === 'estribo' ? 'ESTRIBO N2' : 'HELICOIDAL N2')
  d.circle('ARM_ESTRIBO', stC, Rst * fs)
  d.dim([stC[0] - Rst * fs, stC[1] - Rst * fs], [stC[0] + Rst * fs, stC[1] - Rst * fs], -10, `${f(2 * Rst, 1)} cm`)
  const n2 = sch.rows.find((r) => r.pos === 'N2')
  if (n2) d.text('TEXTO', [AX + 250, stC[1] - secR - 28], T, `${n2.qty / np} N2 Ø${phiTxt(tr.phiMm)} C=${f(n2.unitLen * 100, 1)} cm (por estaca)`)
  yA = secC[1] - secR - 70

  // elevação da estaca armada (esc. 1:25, dimensões reais em cm)
  d.text('TEXTO', [AX + 8, yA], TH, 'ARMADURA LONGITUDINAL - ESC. 1:25')
  const cx = AX + 190
  const ytop = yA - 30 - anch - 12
  const rest = L - cage
  const broken = rest > 250
  const tail = broken ? 90 : Math.max(rest, 0)
  const topShown = broken ? cage + 60 : L - tail
  const yBot1 = ytop - topShown
  const yGap = broken ? 50 : 0
  const yEnd = yBot1 - yGap - tail
  const x0 = cx - D / 2, x1 = cx + D / 2
  if (anch > 0) {
    d.rect('OCULTO', [x0 - 40, ytop], [x1 + 40, ytop + anch + 12])
    d.text('TEXTO', [x1 + 44, ytop + anch / 2 + 2], TS, 'BLOCO')
  }
  d.line('ESTACAS', [x0, ytop], [x1, ytop])
  d.line('ESTACAS', [x0, ytop], [x0, yBot1]); d.line('ESTACAS', [x1, ytop], [x1, yBot1])
  const zig = (y: number) => d.poly('ESTACAS', [[x0, y], [x0 + D / 4, y + 4], [x0 + D / 2, y - 4], [x0 + (3 * D) / 4, y + 4], [x1, y]])
  if (broken) {
    zig(yBot1); zig(yBot1 - yGap)
    d.line('ESTACAS', [x0, yBot1 - yGap], [x0, yEnd]); d.line('ESTACAS', [x1, yBot1 - yGap], [x1, yEnd]); d.line('ESTACAS', [x0, yEnd], [x1, yEnd])
  } else d.line('ESTACAS', [x0, yEnd], [x1, yEnd])
  d.line('EIXOS', [cx, ytop + anch + 20], [cx, yEnd - 10])
  for (const dx of [-Rs, Rs]) d.line('ARM_LONG', [cx + dx, ytop + anch], [cx + dx, ytop - cage])
  let count = 0
  tr.zones.forEach((z, k) => {
    const a = z.from * 100, b = Math.min(z.to * 100, topShown)
    const s = z.spacing * 100
    for (let yy = a; yy <= b + 1e-6; yy += s) d.line('ARM_ESTRIBO', [x0 + cover, ytop - yy], [x1 - cover, ytop - yy])
    const nz = Math.ceil((z.to - z.from) / z.spacing) + (k === 0 ? 1 : 0)
    count += nz
    d.dim([x0, ytop - z.from * 100], [x0, ytop - z.to * 100], -22, `${nz} N2 c/${f(s, 1)}`, TS)
  })
  d.dim([x0, ytop], [x0, ytop - cage], -62, `gaiola ${f(cage, 0)}`)
  if (anch > 0) d.dim([x0, ytop + anch], [x0, ytop], -62, `ancor. ${f(anch, 0)}`)
  d.dim([x1, ytop], [x1, yEnd], 40, `L = ${f(L, 0)}${broken ? ' (trecho omitido)' : ''}`)
  d.textC('TEXTO', [cx, yEnd - 14], TS, `Ø${f(D, 0)} cm - ponta`)
  d.leader([cx + Rs, ytop - Math.min(cage * 0.25, 50)], [x1 + 60, ytop - Math.min(cage * 0.25, 50) + 18], `N1 ${nBars} Ø${phiTxt(l.phiMm)} C=${f(cage + anch, 0)} cm`)
  d.leader([x1 - cover, ytop - Math.min(cage * 0.55, 110)], [x1 + 60, ytop - Math.min(cage * 0.55, 110) - 14], `N2 Ø${phiTxt(tr.phiMm)} (${count} pecas)`)
  const pileBottom = yEnd - 30

  // =================================================== COLUNA B — BLOCO (esc. 1:25, dimensões reais)
  const BX = 640
  const secPos = new Map<string, string>()
  { let q = 3 + bd.bars.length; for (const x of bd.secondary) if (x.kind) secPos.set(x.kind, `N${q++}`) }
  let y = -30
  d.text('TEXTO', [BX, y], TH + 1, `PLANTA - BLOCO SOBRE ${np} ESTACA(S) ${PILE_LABEL[c.type].toUpperCase()} Ø${f(D, 0)} - ESC. 1:25`)
  y -= 24
  const px0 = BX + 70 + lx / 2
  const py0 = y - 45 - ly / 2
  const X = (v: number) => px0 + v
  const Y = (v: number) => py0 + v
  const outl = g.outline.map((q) => [q[0] * 100 - g.cx * 100, q[1] * 100 - g.cy * 100] as Pt) // relativo ao centro do bloco, cm
  d.poly('CONTORNO', outl.map((q) => [X(q[0]), Y(q[1])] as Pt), true)
  /** Extremos (cm, relativos ao centro) da reta de armadura dentro do contorno, descontado o cobrimento. */
  const chord = (dir: 'x' | 'y', coord: number): [number, number] => {
    const ch = chordOf(outl.map((q) => [q[0], q[1]] as [number, number]), dir, coord)
    return ch ? [ch[0] + cov, ch[1] - cov] : dir === 'x' ? [-lx / 2 + cov, lx / 2 - cov] : [-ly / 2 + cov, ly / 2 - cov]
  }
  d.rect('PILAR', [X(pcx - pax / 2), Y(pcy - pay / 2)], [X(pcx + pax / 2), Y(pcy + pay / 2)])
  d.line('EIXOS', [X(pcx) - 30 - pax / 2, Y(pcy)], [X(pcx) + 30 + pax / 2, Y(pcy)])
  d.line('EIXOS', [X(pcx), Y(pcy) - 30 - pay / 2], [X(pcx), Y(pcy) + 30 + pay / 2])
  pts.forEach((p, i) => {
    d.circle('ESTACAS', [X(p.x), Y(p.y)], D / 2)
    d.textC('TEXTO', [X(p.x), Y(p.y) - 2], T, `E${i + 1}`)
  })
  const uxs = [...new Set(pts.map((p) => +p.x.toFixed(2)))].sort((a, b) => a - b)
  const uys = [...new Set(pts.map((p) => +p.y.toFixed(2)))].sort((a, b) => a - b)
  bd.bars.forEach((b, i) => {
    const pos = `N${3 + i}`
    const dirY = /dire..o Y|\bY\b/i.test(b.label) && !/dire..o X|\bX\b/i.test(b.label)
    const mesh = /Malha/i.test(b.label)
    const side = b.label.match(/lado (\d)/i)
    const fx = b.label.match(/faixa x = (-?[\d.]+)/i)
    const fy = b.label.match(/faixa y = (-?[\d.]+)/i)
    const lines: [Pt, Pt][] = []
    if (side && np === 3) {
      const k = +side[1] - 1
      const p1 = pts[k], p2 = pts[(k + 1) % 3]
      lines.push([[X(p1.x), Y(p1.y)], [X(p2.x), Y(p2.y)]])
    } else if (mesh) {
      for (let k = 1; k <= 4; k++) {
        if (dirY) { const xx = -lx / 2 + cov + ((lx - 2 * cov) * k) / 5; const [a0, a1] = chord('y', xx); lines.push([[X(xx), Y(a0)], [X(xx), Y(a1)]]) }
        else { const yy = -ly / 2 + cov + ((ly - 2 * cov) * k) / 5; const [a0, a1] = chord('x', yy); lines.push([[X(a0), Y(yy)], [X(a1), Y(yy)]]) }
      }
    } else if (fy) { const yy = +fy[1] * 100 - g.cy * 100; const [a0, a1] = chord('x', yy); lines.push([[X(a0), Y(yy)], [X(a1), Y(yy)]]) }
    else if (fx) { const xx = +fx[1] * 100 - g.cx * 100; const [a0, a1] = chord('y', xx); lines.push([[X(xx), Y(a0)], [X(xx), Y(a1)]]) }
    else if (dirY) uxs.forEach((u) => { const [a0, a1] = chord('y', u); lines.push([[X(u), Y(a0)], [X(u), Y(a1)]]) })
    else uys.forEach((u) => { const [a0, a1] = chord('x', u); lines.push([[X(a0), Y(u)], [X(a1), Y(u)]]) })
    lines.forEach((ln) => d.line(mesh ? 'ARM_MALHA' : 'ARM_BLOCO', ln[0], ln[1]))
    if (lines.length) {
      // etiqueta curta da posição junto à barra (a descrição completa está nos detalhes e na tabela de aço)
      const [pa, pb] = lines[0]
      if (side && np === 3) d.text('TEXTO', [(pa[0] + pb[0]) / 2 + 4, (pa[1] + pb[1]) / 2 + 4], T, pos)
      else if (Math.abs(pa[0] - pb[0]) < 1e-6) { d.line('CHAMADAS', pb, [pb[0], Y(ly / 2) + 8]); d.text('TEXTO', [pb[0] - 5, Y(ly / 2) + 10], T, pos) }
      else { d.line('CHAMADAS', pb, [X(lx / 2) + 8, pb[1]]); d.text('TEXTO', [X(lx / 2) + 10, pb[1] - 2], T, pos) }
    }
  })
  const supP = bd.secondary.find((x) => x.kind === 'superior')
  if (supP?.qty) {
    const nT = supP.qty
    for (let k = 0; k < nT; k++) {
      if (lx >= ly) { const y0 = -ly / 2 + cov + ((ly - 2 * cov) * (k + 0.5)) / nT; const [a0, a1] = chord('x', y0); d.line('OCULTO', [X(a0), Y(y0)], [X(a1), Y(y0)]) }
      else { const x0s = -lx / 2 + cov + ((lx - 2 * cov) * (k + 0.5)) / nT; const [a0, a1] = chord('y', x0s); d.line('OCULTO', [X(x0s), Y(a0)], [X(x0s), Y(a1)]) }
    }
    d.text('TEXTO', [X(-lx / 2) + 4, Y(ly / 2) + 8], TS, `${secPos.get('superior') ?? ''} (superior, tracejada)`)
  }
  const chainX = [-lx / 2, ...uxs, lx / 2], chainY = [-ly / 2, ...uys, ly / 2]
  for (let i = 0; i < chainX.length - 1; i++) if (chainX[i + 1] - chainX[i] > 0.5) d.dim([X(chainX[i]), Y(-ly / 2)], [X(chainX[i + 1]), Y(-ly / 2)], -14, f(chainX[i + 1] - chainX[i], 0))
  for (let i = 0; i < chainY.length - 1; i++) if (chainY[i + 1] - chainY[i] > 0.5) d.dim([X(-lx / 2), Y(chainY[i])], [X(-lx / 2), Y(chainY[i + 1])], -14, f(chainY[i + 1] - chainY[i], 0))
  d.dim([X(-lx / 2), Y(-ly / 2)], [X(lx / 2), Y(-ly / 2)], -30, f(lx, 0))
  d.dim([X(-lx / 2), Y(-ly / 2)], [X(-lx / 2), Y(ly / 2)], -30, f(ly, 0))
  d.dim([X(pcx - pax / 2), Y(pcy + pay / 2)], [X(pcx + pax / 2), Y(pcy + pay / 2)], 12, `pilar ${f(pax, 0)}`)
  d.dim([X(pcx + pax / 2), Y(pcy - pay / 2)], [X(pcx + pax / 2), Y(pcy + pay / 2)], 12, `${f(pay, 0)}`)
  y = Y(-ly / 2) - 60

  // corte A-A
  d.text('TEXTO', [BX, y], TH + 1, 'CORTE A-A - ESC. 1:25')
  const cy0 = y - 60
  const sx = px0
  const yTopBlk = cy0 - 50
  const yBotBlk = yTopBlk - h
  d.rect('CONTORNO', [sx - lx / 2, yBotBlk], [sx + lx / 2, yTopBlk])
  d.rect('PILAR', [sx + pcx - pax / 2, yTopBlk], [sx + pcx + pax / 2, cy0])
  d.rect('LASTRO', [sx - lx / 2 - 5, yBotBlk - 5], [sx + lx / 2 + 5, yBotBlk])
  for (const u of uxs) {
    d.line('ESTACAS', [sx + u - D / 2, yBotBlk - 5], [sx + u - D / 2, yBotBlk - 60]); d.line('ESTACAS', [sx + u + D / 2, yBotBlk - 5], [sx + u + D / 2, yBotBlk - 60])
    d.poly('ESTACAS', [[sx + u - D / 2, yBotBlk - 60], [sx + u - D / 4, yBotBlk - 56], [sx + u, yBotBlk - 64], [sx + u + D / 4, yBotBlk - 56], [sx + u + D / 2, yBotBlk - 60]])
    d.line('EIXOS', [sx + u, yBotBlk - 66], [sx + u, yTopBlk + 8])
    if (anch > 0) for (const dx of [-Rs, Rs]) d.line('ARM_LONG', [sx + u + dx, yBotBlk], [sx + u + dx, yBotBlk + Math.min(anch, h - cov)])
  }
  const sec = bd.secondary
  const pele = sec.find((x) => x.kind === 'pele'), sup = sec.find((x) => x.kind === 'superior'), est = sec.find((x) => x.kind === 'estribos')
  const sl = sx - lx / 2 + cov, sr = sx + lx / 2 - cov, sb = yBotBlk + cov, st = yTopBlk - cov
  d.rect('ARM_ESTRIBO', [sl, sb], [sr, st])
  d.line('ARM_ESTRIBO', [sl, st], [sl + 9, st - 9]) // gancho
  const rb = (phi: number) => Math.max(phi / 20, 0.8)
  // armadura principal inferior (duas camadas, barras na direção do corte)
  for (const o of [1.5, 4.5]) d.line('ARM_BLOCO', [sl, sb + o + 1.5], [sr, sb + o + 1.5])
  // pele: uma linha de barras em cada face, entre as armaduras inferior e superior
  if (pele?.perFace && pele.phiMm) {
    const n = pele.perFace
    for (let k = 0; k < n; k++) {
      const yy = sb + 12 + ((st - sb - 24) * k) / Math.max(n - 1, 1)
      d.circle('ARM_BLOCO', [sl + 3, yy], rb(pele.phiMm)); d.circle('ARM_BLOCO', [sr - 3, yy], rb(pele.phiMm))
    }
  }
  // superior construtiva
  if (sup?.qty && sup.phiMm) {
    const n = sup.qty
    for (let k = 0; k < n; k++) d.circle('ARM_BLOCO', [sl + 3 + ((sr - sl - 6) * k) / Math.max(n - 1, 1), st - 3], rb(sup.phiMm))
  } else d.line('ARM_BLOCO', [sl, st - 1.5], [sr, st - 1.5])
  const tagL = (from: Pt, label: string, out: number) => { d.line('CHAMADAS', from, [out, from[1]]); d.textR('TEXTO', [out - 2, from[1] - 2], T, label) }
  const tagR = (from: Pt, label: string, out: number) => { d.line('CHAMADAS', from, [out, from[1]]); d.text('TEXTO', [out + 2, from[1] - 2], T, label) }
  if (pele) tagL([sl + 3, sb + 12 + (st - sb - 24) / 2], secPos.get('pele') ?? '', sx - lx / 2 - 30)
  if (sup) tagR([sr - 3, st - 3], secPos.get('superior') ?? '', sx + lx / 2 + 60)
  if (est) tagR([sr, sb + (st - sb) * 0.4], secPos.get('estribos') ?? '', sx + lx / 2 + 60)
  tagL([sl, sb + 3], 'N3', sx - lx / 2 - 30)
  d.dim([sx + lx / 2, yBotBlk], [sx + lx / 2, yTopBlk], 24, `h = ${f(h, 0)}`)
  d.dim([sx - lx / 2, yBotBlk + (h - dEff)], [sx - lx / 2, yTopBlk], -60, `d = ${f(dEff, 0)}`, TS)
  d.dim([sx - lx / 2, yBotBlk - 66], [sx + lx / 2, yBotBlk - 66], -14, f(lx, 0))
  d.text('TEXTO', [sx - lx / 2, yBotBlk - 96], TS, `Cobrimento ${f(cov, 1)} cm; lastro de concreto magro >= 5 cm; cabeca da estaca 5 cm acima do lastro (NBR 6122:2022, 8.5.5)`)
  d.text('TEXTO', [sx - lx / 2, yBotBlk - 106], TS, `Bloco: fck ${g.fck} MPa; bielas a ${f(Math.min(...bd.theta), 0)}-${f(Math.max(...bd.theta), 0)} graus; metodo: ${bd.method === 'flexao' ? 'flexao (CEB)' : 'bielas e tirantes (Blevot e Fremy)'}`)
  y = yBotBlk - 140

  // detalhes das barras do bloco
  d.text('TEXTO', [BX, y], TH + 1, 'DETALHE DAS BARRAS DO BLOCO (comprimentos em cm)')
  y -= 34
  bd.bars.forEach((b, i) => {
    const phi = b.phiMm
    const leg = Math.max((8 * phi) / 10, 7)
    const totalCm = b.length * 100
    const straight = Math.max(totalCm - 2 * leg, 10)
    const wShow = Math.min(straight, 300)
    const x0b = BX + 150
    d.text('TEXTO', [BX, y - 2], T, `N${3 + i}  ${b.n} Ø${phiTxt(phi)}  C = ${f(totalCm, 0)}`)
    d.poly('ARM_BLOCO', [[x0b, y + leg * 0.4], [x0b, y - 10], [x0b + wShow, y - 10], [x0b + wShow, y + leg * 0.4]])
    d.dim([x0b, y - 10], [x0b + wShow, y - 10], -8, f(straight, 0), TS)
    d.dim([x0b + wShow, y - 10], [x0b + wShow, y + leg * 0.4], 8, f(leg, 0), TS)
    y -= 42
  })
  for (const x of bd.secondary) {
    if (!x.kind || !x.phiMm || !x.qty || !x.unitLen) { d.text('TEXTO', [BX, y], T, x.description); y -= 10; continue }
    const pos = secPos.get(x.kind) ?? ''
    const lenCm = x.unitLen * 100
    const x0b = BX + 150
    if (x.kind === 'estribos') {
      const wS = Math.min(lx, ly) - 2 * cov, hS = h - 2 * cov
      d.text('TEXTO', [BX, y - 2], T, `${pos}  ${x.qty} Ø${phiTxt(x.phiMm)} c/${f((x.spacing ?? 0) * 100, 0)}`)
      d.text('TEXTO', [BX, y - 12], TS, `C = ${f(lenCm, 0)} cm (com ganchos)`)
      d.rect('ARM_ESTRIBO', [x0b, y - hS + 12], [x0b + wS, y + 12])
      d.line('ARM_ESTRIBO', [x0b, y + 12], [x0b + 9, y + 3]); d.line('ARM_ESTRIBO', [x0b + wS, y + 12], [x0b + wS - 9, y + 3])
      d.dim([x0b, y - hS + 12], [x0b + wS, y - hS + 12], -8, f(wS, 0), TS)
      d.dim([x0b + wS, y - hS + 12], [x0b + wS, y + 12], 8, f(hS, 0), TS)
      y -= hS + 40
    } else {
      const wShow = Math.min(lenCm, 300)
      d.text('TEXTO', [BX, y - 2], T, `${pos}  ${x.qty} Ø${phiTxt(x.phiMm)}  C = ${f(lenCm, 0)}`)
      d.text('TEXTO', [BX, y - 12], TS, x.kind === 'pele' ? `${x.perFace} por face, s <= ${f((x.spacing ?? 0) * 100, 0)} cm` : 'barras retas no topo')
      d.line('ARM_BLOCO', [x0b, y - 10], [x0b + wShow, y - 10])
      d.dim([x0b, y - 10], [x0b + wShow, y - 10], -8, f(lenCm, 0), TS)
      y -= 42
    }
  }
  const blockBottom = y - 20

  // =================================================== TABELAS, NOTAS E CARIMBO
  let yt = Math.min(pileBottom, blockBottom) - 50
  const tx = AX
  d.text('TEXTO', [tx, yt], TH + 1, 'TABELA DE ACO')
  yt -= 8
  const cols = [36, 215, 38, 46, 66, 70, 56]
  const xs = cols.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [tx])
  const rows = [
    ['POS', 'ELEMENTO', 'Ø (mm)', 'QUANT.', 'C.UNIT (cm)', 'C.TOTAL (m)', 'PESO (kg)'],
    ...sch.rows.map((r) => [r.pos, `${r.element} - ${r.description.split(' (')[0]}`, phiTxt(r.phiMm), String(r.qty), f(r.unitLen * 100, 1), f(r.totalLen, 2), f(r.kg, 1)]),
    ...sch.extras.map((e) => ['-', `Bloco - ${e.description}`, '-', '-', '-', '-', f(e.kg, 1)]),
    ['', 'TOTAL', '', '', '', '', f(sch.totalKg, 1)],
  ]
  const rh = 12
  rows.forEach((r, i) => {
    const yy = yt - i * rh
    d.line('TABELA', [tx, yy], [xs[xs.length - 1], yy])
    r.forEach((cell, k) => (k <= 1 || i === 0 ? d.text('TABELA', [xs[k] + 3, yy - rh + 3], TS + 0.5, d.fit(cell, cols[k], TS + 0.5)) : d.textR('TABELA', [xs[k + 1] - 3, yy - rh + 3], TS + 0.5, cell)))
  })
  const yEndT = yt - rows.length * rh
  d.line('TABELA', [tx, yEndT], [xs[xs.length - 1], yEndT])
  xs.forEach((xx) => d.line('TABELA', [xx, yt], [xx, yEndT]))

  const yr = yEndT - 40
  d.text('TEXTO', [tx, yr + 8], TH + 1, 'RESUMO DO ACO')
  const rc = [50, 46, 80, 70, 84]
  const rxs = rc.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [tx])
  const srows = [['ACO', 'Ø (mm)', 'COMPR. (m)', 'PESO (kg)', 'BARRAS 12 m'], ...sch.summary.map((s) => [s.steel, phiTxt(s.phiMm), f(s.lengthM, 2), f(s.kg, 1), String(Math.ceil(s.lengthM / 12))])]
  srows.forEach((r, i) => {
    const yy = yr - i * rh
    d.line('TABELA', [tx, yy], [rxs[rxs.length - 1], yy])
    r.forEach((cell, k) => d.text('TABELA', [rxs[k] + 3, yy - rh + 3], TS + 0.5, d.fit(cell, rc[k], TS + 0.5)))
  })
  const yrEnd = yr - srows.length * rh
  d.line('TABELA', [tx, yrEnd], [rxs[rxs.length - 1], yrEnd])
  rxs.forEach((xx) => d.line('TABELA', [xx, yr], [xx, yrEnd]))
  const volPile = c.quantities.pileConcreteM3
  const volBlock = bd.quantities.concreteM3
  d.text('TEXTO', [tx, yrEnd - 14], T, `Peso total do aco + 10 %: ${f(sch.totalKg * 1.1, 1)} kg`)
  d.text('TEXTO', [tx, yrEnd - 25], T, `Volume de concreto: estacas ${f(volPile, 2)} m3 (fck ${des.fck} MPa) + bloco ${f(volBlock, 2)} m3 (fck ${g.fck} MPa) = ${f(volPile + volBlock, 2)} m3`)
  d.text('TEXTO', [tx, yrEnd - 36], T, `Forma do bloco: ${f(bd.quantities.formM2, 1)} m2  |  lastro: ${f(bd.quantities.leanConcreteM2, 2)} m2`)

  const nx = xs[xs.length - 1] + 50
  d.text('TEXTO', [nx, yt + 8], TH + 1, 'NOTAS')
  const notes = [
    '1. Desenho em metros, tamanho real (1 unidade = 1 m); cotas escritas em centimetros. Plotar 1:25.',
    `2. Cobrimento: estaca ${f(cover, 1)} cm; bloco ${f(cov, 1)} cm (NBR 6118, Tab. 7.2, contato com o solo).`,
    '3. Aco CA-50, exceto Ø5,0 (CA-60). Ganchos das barras do bloco a 135 graus.',
    `4. Armadura da estaca: gaiola de ${f(cage, 0)} cm${anch > 0 ? ` + ${f(anch, 0)} cm de ancoragem no bloco` : ''}; comprimento minimo e ancoragem conforme NBR 6122 (Tab. 4) e NBR 6118 (9.4).`,
    '5. Armar os estribos nos trechos indicados; usar espacadores para garantir o cobrimento.',
    '6. Cabeca da estaca apicoada e embutida 5 cm no bloco acima do lastro.',
    '7. Desenho esquematico de projeto: conferir antes de emitir para obra.',
  ]
  notes.forEach((s, i) => d.text('TEXTO', [nx, yt - 6 - i * 10], TS + 0.5, s))

  const cyt = yrEnd - 10
  d.rect('QUADRO', [nx, cyt], [nx + 330, cyt - 70])
  d.line('QUADRO', [nx, cyt - 24], [nx + 330, cyt - 24])
  d.text('TEXTO', [nx + 6, cyt - 17], TH + 2, `FUNDACAO EM ESTACAS - ${ctx.title ?? 'PILAR'}`)
  d.text('TEXTO', [nx + 6, cyt - 36], T, `${np} estaca(s) ${PILE_LABEL[c.type]} Ø${f(D, 0)} cm, L = ${f(L, 0)} cm; bloco ${f(lx, 0)} x ${f(ly, 0)} x ${f(h, 0)} cm`)
  d.text('TEXTO', [nx + 6, cyt - 47], T, `Unidade: metro, tamanho real. Plotar na escala 1:25 (texto 2,4 mm)`)
  d.text('TEXTO', [nx + 6, cyt - 58], T, `Data: ${ctx.dateISO ?? new Date().toISOString().slice(0, 10)}`)

  const xmax = Math.max(nx + 440, px0 + lx / 2 + 260)
  d.rect('QUADRO', [-20, 20], [xmax, cyt - 90])
  return d.toString()
}

