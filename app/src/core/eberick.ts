/**
 * Importação do "Relatório de Esforços nas Fundações por Elementos" exportado pelo AltoQi Eberick (planilha .xlsx).
 *
 * Estrutura reconhecida (verificada no arquivo de exemplo): para cada elemento, uma linha "Fundação <nome>", uma linha de
 * cabeçalho "Combinação | N (tf) | Mx (kgf.m) | My (kgf.m) | Vx (tf) | Vy (tf) | Mt (kgf/m)" e uma linha por caso de
 * carregamento simples (G1, G2, Q, V1…, D1…) e por combinação (ex.: "G1+G2+0.5Q+0.6V1+D1").
 *
 * PREMISSAS (sinalizadas ao usuário na tela de importação):
 *  - os valores do relatório são CARACTERÍSTICOS (os nomes das combinações têm só os ψ, sem γf): entram como ELS;
 *  - o ELU não vem no arquivo: é obtido multiplicando as mesmas combinações por um γf informado pelo usuário (padrão 1,4);
 *  - sinais: N positivo = compressão; Mx e My pela regra da mão direita em torno de X e Y globais, como no Estakalc
 *    (o relatório não traz o sistema de eixos: há opção de inverter os sinais de Mx e My);
 *  - "Mt" (unidade grafada kgf/m) é tratado como momento de torção Mz em kgf·m;
 *  - a seção do pilar e a sondagem de cada elemento NÃO vêm no relatório.
 */
import type { LoadCombination } from './loads'
import type { Cell } from './xlsx'

const G = 9.80665 // kN por tf (ou N por kgf × 1000)

export interface EberickRow {
  name: string
  /** Valores no sistema do Estakalc: kN e kN·m. */
  N: number
  Mx: number
  My: number
  Vx: number
  Vy: number
  Mt: number
}

export interface EberickFoundation {
  name: string
  /** Casos simples, ex.: "Peso próprio (G1)". */
  cases: EberickRow[]
  /** Combinações, ex.: "G1+G2+0.5Q+0.6V1+D1". */
  combos: EberickRow[]
}

export interface EberickParse {
  foundations: EberickFoundation[]
  warnings: string[]
}

/** Fator de conversão para kN (força) ou kN·m (momento) a partir do texto de unidade do cabeçalho. */
function unitFactor(head: string): number | undefined {
  const u = head.toLowerCase().replace(/\s+/g, '')
  const m = u.match(/\(([^)]+)\)/)?.[1]
  if (!m) return undefined
  if (/^tf[.·*]m$|^tfm$/.test(m)) return G
  if (/^kgf[.·*/]m$|^kgfm$/.test(m)) return G / 1000
  if (/^kn[.·*]m$|^knm$/.test(m)) return 1
  if (m === 'tf') return G
  if (m === 'kgf') return G / 1000
  if (m === 'kn') return 1
  return undefined
}

const isNum = (c: Cell): c is number => typeof c === 'number' && Number.isFinite(c)
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function parseEberick(rows: Cell[][]): EberickParse {
  const warnings: string[] = []
  const foundations: EberickFoundation[] = []
  let cur: EberickFoundation | undefined
  let fac: (number | undefined)[] | undefined
  for (const r of rows) {
    const c0 = typeof r[0] === 'string' ? r[0].trim() : ''
    const fm = c0.match(/^funda\S*o\s+(.+)$/i)
    if (fm && r.slice(1).every((c) => c === null || c === '')) {
      cur = { name: fm[1].trim(), cases: [], combos: [] }
      foundations.push(cur)
      fac = undefined
      continue
    }
    if (!cur) continue
    if (norm(c0).startsWith('combina') && typeof r[1] === 'string') {
      fac = [1, 2, 3, 4, 5, 6].map((k) => unitFactor(String(r[k] ?? '')))
      continue
    }
    if (!fac || !c0 || !r.slice(1, 7).every(isNum)) continue
    const v = r.slice(1, 7) as number[]
    const f = fac.map((x, k) => (x ?? (k === 0 || k >= 3 && k <= 4 ? G : G / 1000)))
    const row: EberickRow = { name: c0, N: v[0] * f[0], Mx: v[1] * f[1], My: v[2] * f[2], Vx: v[3] * f[3], Vy: v[4] * f[4], Mt: v[5] * f[5] }
    // caso simples termina com "(G1)", "(V2)" etc.; combinação contém "+"
    if (/\([A-Za-z]\d*\)\s*$/.test(c0)) cur.cases.push(row)
    else cur.combos.push(row)
  }
  if (foundations.length === 0) warnings.push('Nenhum elemento "Fundação …" foi reconhecido: o arquivo não parece ser o relatório de esforços do Eberick.')
  for (const f of foundations) if (f.combos.length === 0) warnings.push(`Fundação ${f.name}: nenhuma combinação reconhecida.`)
  return { foundations, warnings }
}

export interface EberickOptions {
  /** 'criticas': só as combinações extremas; 'todas': todas as combinações. */
  select: 'criticas' | 'todas'
  /** γf aplicado às combinações do relatório para gerar o ELU; 0 ou vazio = não gerar ELU. */
  gammaF: number
  invertMx: boolean
  invertMy: boolean
  /** Elementos a importar (nomes); vazio = todos. */
  only?: string[]
}

export const DEFAULT_EBERICK: EberickOptions = { select: 'criticas', gammaF: 1.4, invertMx: false, invertMy: false }

/** Índices das combinações extremas (N máx./mín., Mx, My, Vx, Vy, momento e cortante resultantes, excentricidade). */
export function criticalIndexes(rows: EberickRow[]): number[] {
  if (rows.length === 0) return []
  const arg = (f: (r: EberickRow) => number, max = true) => rows.reduce((b, r, i) => ((max ? f(r) > f(rows[b]) : f(r) < f(rows[b])) ? i : b), 0)
  const set = new Set<number>([
    arg((r) => r.N), arg((r) => r.N, false),
    arg((r) => Math.abs(r.Mx)), arg((r) => Math.abs(r.My)),
    arg((r) => Math.abs(r.Vx)), arg((r) => Math.abs(r.Vy)),
    arg((r) => Math.hypot(r.Mx, r.My)), arg((r) => Math.hypot(r.Vx, r.Vy)),
    arg((r) => Math.hypot(r.Mx, r.My) / Math.max(r.N, 1)),
  ])
  return [...set].sort((a, b) => a - b)
}

/** Converte os elementos importados em combinações do Estakalc (ELS = característico; ELU = γf × característico). */
export function toCombinations(p: EberickParse, o: EberickOptions): LoadCombination[] {
  const out: LoadCombination[] = []
  const sx = o.invertMx ? -1 : 1
  const sy = o.invertMy ? -1 : 1
  for (const f of p.foundations) {
    if (o.only && o.only.length > 0 && !o.only.includes(f.name)) continue
    const idx = o.select === 'todas' ? f.combos.map((_, i) => i) : criticalIndexes(f.combos)
    const base = idx.map((i) => f.combos[i])
    const mk = (r: EberickRow, state: 'ELS' | 'ELU', k: number): LoadCombination => ({
      pillar: f.name, name: r.name + (state === 'ELU' ? ' (ELU)' : ''), state,
      fx: r.Vx * k, fy: r.Vy * k, fz: r.N * k, mx: r.Mx * sx * k, my: r.My * sy * k, mz: r.Mt * k,
    })
    for (const r of base) out.push(mk(r, 'ELS', 1))
    if (o.gammaF > 0) for (const r of base) out.push(mk(r, 'ELU', o.gammaF))
  }
  return out
}

// ------------------------------------------------------------------ relatório de cargas nas fundações (seções)

export interface EberickSection {
  /** Nome do pilar no relatório (ex.: "P1"). */
  name: string
  /** Seção em cm, na ordem do relatório ("14x30" → a = 14, b = 30); undefined se vazia. */
  a?: number
  b?: number
  /** Carga máxima positiva (compressão) em kN. */
  Nmax: number
}

/**
 * "Relatório de Cargas nas Fundações": uma linha por pilar com Nome, Seção (cm), cargas por caso (tf) e
 * "Carga máxima" positiva/negativa (tf). Só traz os esforços máximos; serve para obter a seção do pilar.
 */
export function parseEberickSections(rows: Cell[][]): { sections: EberickSection[]; warnings: string[] } {
  const warnings: string[] = []
  const sections: EberickSection[] = []
  let iName = -1, iSec = -1, iPos = -1
  let fPos = G
  for (const r of rows) {
    const cells = r.map((c) => (typeof c === 'string' ? norm(c).replace(/\s+/g, ' ').trim() : ''))
    if (iName < 0) {
      const n = cells.findIndex((c) => c === 'nome')
      const s = cells.findIndex((c) => c.startsWith('secao'))
      if (n >= 0 && s >= 0) { iName = n; iSec = s; iPos = cells.findIndex((c) => c === 'positiva') }
      continue
    }
    if (iPos < 0) iPos = cells.findIndex((c) => c === 'positiva')
    const name = typeof r[iName] === 'string' ? (r[iName] as string).trim() : ''
    if (!name || /^total/i.test(name)) { if (/^total/i.test(name)) break; continue }
    const secTxt = typeof r[iSec] === 'string' ? (r[iSec] as string).trim() : ''
    const m = secTxt.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)$/i)
    const pos = iPos >= 0 && isNum(r[iPos]) ? (r[iPos] as number) * fPos : NaN
    sections.push({ name, a: m ? +m[1].replace(',', '.') : undefined, b: m ? +m[2].replace(',', '.') : undefined, Nmax: pos })
  }
  if (iName < 0) warnings.push('Cabeçalho "Nome | Seção" não encontrado: o arquivo não parece ser o relatório de cargas nas fundações do Eberick.')
  return { sections, warnings }
}

/** Associa elementos do relatório de esforços (B1…) aos pilares do relatório de cargas (P1…): pela carga máxima e, na falta, pelo número. */
export function matchSections(f: EberickParse, s: EberickSection[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  const used = new Set<string>()
  for (const fo of f.foundations) {
    const nmax = Math.max(...fo.combos.map((r) => r.N))
    const num = fo.name.match(/\d+/)?.[0]
    const byNum = s.find((x) => !used.has(x.name) && x.name.match(/\d+/)?.[0] === num)
    const byN = s.find((x) => !used.has(x.name) && Number.isFinite(x.Nmax) && Math.abs(x.Nmax - nmax) <= 0.01 * Math.max(nmax, 1))
    const pick = byNum && byN && byNum !== byN ? byN : (byNum ?? byN)
    out[fo.name] = pick?.name
    if (pick) used.add(pick.name)
  }
  return out
}
