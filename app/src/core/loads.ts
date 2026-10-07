/**
 * Combinações de carga por pilar (CSV).
 *
 * Colunas (cabeçalho obrigatório, ordem livre, sem diferenciar maiúsculas/acentos):
 *   pilar ; combinacao ; tipo ; fx ; fy ; fz ; mx ; my [; mz]
 * - tipo: ELU (valores de cálculo) ou ELS (valores característicos/de serviço);
 * - unidades: kN e kN·m; separador `;` ou `,`; decimal com vírgula ou ponto; linhas que começam com `#` são ignoradas.
 *
 * Convenção de sinais (esforços do PILAR atuando no TOPO do bloco, no eixo do pilar):
 *   X e Y no plano (planta), Z vertical para cima — sistema destro;
 *   fx, fy : forças horizontais, positivas no sentido +X, +Y;
 *   fz     : força vertical de COMPRESSÃO sobre a fundação, positiva para baixo (fz < 0 = tração/arrancamento);
 *   mx, my, mz : momentos pela regra da mão direita em torno de X, Y, Z.
 *     Consequência: mx > 0 aumenta a compressão nas estacas com y menor; my > 0 aumenta a compressão nas estacas com x maior.
 * A origem (0,0) das coordenadas das estacas é o eixo do pilar.
 */

export type LimitState = 'ELU' | 'ELS'

export interface LoadCombination {
  pillar: string
  name: string
  state: LimitState
  fx: number
  fy: number
  fz: number
  mx: number
  my: number
  mz: number
}

export interface LoadsParseResult {
  combinations: LoadCombination[]
  errors: string[]
  /** Seções dos pilares (cm), se o CSV trouxer as colunas opcionais ax e ay (dimensões em X e Y). */
  sections?: Record<string, { ax: number; ay: number }>
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')))

export function parseLoadsCsv(text: string): LoadsParseResult {
  const errors: string[] = []
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  if (lines.length < 2) return { combinations: [], errors: ['Arquivo vazio ou sem linhas de dados.'] }

  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const head = lines[0].split(sep).map(norm)
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const idx = {
    pillar: col('pilar', 'pilares', 'id'),
    name: col('combinacao', 'comb', 'caso'),
    state: col('tipo', 'estado', 'estado_limite'),
    fx: col('fx', 'hx'),
    fy: col('fy', 'hy'),
    fz: col('fz', 'n', 'nz', 'p'),
    mx: col('mx'),
    my: col('my'),
    mz: col('mz'),
    ax: col('ax', 'bx', 'ax_cm'),
    ay: col('ay', 'by', 'ay_cm'),
  }
  for (const k of ['pillar', 'name', 'state', 'fx', 'fy', 'fz', 'mx', 'my'] as const)
    if (idx[k] < 0) errors.push(`Coluna obrigatória ausente: "${k === 'pillar' ? 'pilar' : k === 'name' ? 'combinacao' : k === 'state' ? 'tipo' : k}".`)
  if (errors.length) return { combinations: [], errors }

  const out: LoadCombination[] = []
  const sections: Record<string, { ax: number; ay: number }> = {}
  const seen = new Set<string>()
  lines.slice(1).forEach((line, k) => {
    const ln = k + 2
    const c = line.split(sep)
    const pillar = c[idx.pillar]?.trim()
    const name = c[idx.name]?.trim()
    const st = norm(c[idx.state] ?? '').toUpperCase()
    if (!pillar || !name) return errors.push(`Linha ${ln}: pilar ou combinação em branco.`)
    if (st !== 'ELU' && st !== 'ELS') return errors.push(`Linha ${ln}: tipo deve ser ELU ou ELS (lido "${c[idx.state]}").`)
    const v = {
      fx: num(c[idx.fx]), fy: num(c[idx.fy]), fz: num(c[idx.fz]), mx: num(c[idx.mx]), my: num(c[idx.my]),
      mz: idx.mz >= 0 && c[idx.mz]?.trim() ? num(c[idx.mz]) : 0,
    }
    const bad = (Object.keys(v) as (keyof typeof v)[]).find((key) => !Number.isFinite(v[key]))
    if (bad) return errors.push(`Linha ${ln}: valor inválido em "${bad}".`)
    const key = `${pillar}|${name}|${st}`
    if (seen.has(key)) return errors.push(`Linha ${ln}: combinação "${name}" (${st}) repetida para o pilar ${pillar}.`)
    seen.add(key)
    if (idx.ax >= 0 && idx.ay >= 0 && c[idx.ax]?.trim() && c[idx.ay]?.trim()) {
      const s = { ax: num(c[idx.ax]), ay: num(c[idx.ay]) }
      if (!(s.ax > 0 && s.ay > 0)) return errors.push(`Linha ${ln}: seção do pilar inválida (ax, ay > 0, em cm).`)
      const prev = sections[pillar]
      if (prev && (prev.ax !== s.ax || prev.ay !== s.ay)) return errors.push(`Linha ${ln}: o pilar ${pillar} tem seções diferentes no arquivo.`)
      sections[pillar] = s
    }
    out.push({ pillar, name, state: st, ...v })
  })
  return { combinations: errors.length ? [] : out, errors, sections: errors.length || Object.keys(sections).length === 0 ? undefined : sections }
}

export const LOADS_CSV_TEMPLATE = [
  '# Esforços do pilar no topo do bloco. kN e kN·m. fz > 0 = compressão. X,Y em planta, Z para cima (mão direita).',
  '# mx > 0 aumenta a compressão nas estacas com y menor; my > 0 aumenta a compressão nas estacas com x maior.',
  '# Colunas opcionais ax e ay (cm): seção do pilar nas direções X e Y (se existirem, aplicam-se ao pilar).',
  'pilar;combinacao;tipo;fx;fy;fz;mx;my;mz',
  'P1;C1 (permanente+sobrecarga);ELS;5;2;820;12;-35;0',
  'P1;C2 (vento X);ELS;40;3;650;18;-120;0',
  'P1;C1 (ELU);ELU;7;3;1150;17;-49;0',
  'P2;C1 (permanente+sobrecarga);ELS;0;0;1400;0;0;0',
].join('\n')

export function groupByPillar(list: LoadCombination[]): Map<string, LoadCombination[]> {
  const m = new Map<string, LoadCombination[]>()
  for (const c of list) m.set(c.pillar, [...(m.get(c.pillar) ?? []), c])
  return m
}
