/**
 * Tabelas dos métodos semiempíricos de capacidade de carga por SPT.
 *
 * Cada valor traz a procedência:
 *  - 'livro'    : valor lido diretamente da tabela do livro (conferido visualmente na página);
 *  - 'adaptado' : valor da planilha "Capacidade Carga Estacas-SPT 12.xls" (Aoki & Cintra, 2010) que ela
 *                 própria marca como adaptado/interpolado, ou associação de tipo de estaca/solo feita por
 *                 analogia. Deve ser exibido ao usuário como aviso.
 *
 * Fonte principal: Cintra & Aoki, "Fundações por Estacas — Projeto Geotécnico" (2010), cap. 1,
 * Tabs. 1.3 a 1.10 (páginas 25 a 30 do livro, pasta Fontes).
 */
import type { SoilClass3, SoilType } from '../soil'
import type { PileType } from '../pile'

export type Provenance = 'livro' | 'adaptado'

// ---------------------------------------------------------------- Aoki-Velloso (1975)

export type AvSetId = 'cintra' | 'laprovitera' | 'monteiro'

export const AV_SET_LABEL: Record<AvSetId, string> = {
  cintra: 'Aoki-Velloso (1975) — Cintra & Aoki (2010)',
  laprovitera: 'Laprovitera (1988) / Benegas (1993)',
  monteiro: 'Monteiro (1997)',
}

type KA = { K: number; alpha: number }

/** Tab. 1.3 de Cintra & Aoki (2010) — K (kPa) e razão de atrito α (fração). */
const AV_CINTRA: Record<SoilType, KA> = {
  areia: { K: 1000, alpha: 0.014 },
  areia_siltosa: { K: 800, alpha: 0.02 },
  areia_siltoargilosa: { K: 700, alpha: 0.024 },
  areia_argilosa: { K: 600, alpha: 0.03 },
  areia_argilossiltosa: { K: 500, alpha: 0.028 },
  silte: { K: 400, alpha: 0.03 },
  silte_arenoso: { K: 550, alpha: 0.022 },
  silte_arenoargiloso: { K: 450, alpha: 0.028 },
  silte_argiloso: { K: 230, alpha: 0.034 },
  silte_argiloarenoso: { K: 250, alpha: 0.03 },
  argila: { K: 200, alpha: 0.06 },
  argila_arenosa: { K: 350, alpha: 0.024 },
  argila_arenossiltosa: { K: 300, alpha: 0.028 },
  argila_siltosa: { K: 220, alpha: 0.04 },
  argila_siltoarenosa: { K: 330, alpha: 0.03 },
}

/**
 * Convenção: 1 kgf/cm² = 100 kPa (assim 10 kgf/cm² = 1,0 MPa, como nas tabelas de Cintra & Aoki).
 * k em kgf/cm², α em %: [k, α].
 */
const kaFromKgf = (t: Record<SoilType, [number, number]>): Record<SoilType, KA> =>
  Object.fromEntries(Object.entries(t).map(([s, [k, a]]) => [s, { K: k * 100, alpha: a / 100 }])) as Record<SoilType, KA>

/** Tab. 12.8 de Velloso & Lopes (Laprovitera, 1988). */
const AV_LAPROVITERA = kaFromKgf({
  areia: [6, 1.4],
  areia_siltosa: [5.3, 1.9],
  areia_siltoargilosa: [5.3, 2.4],
  areia_argilossiltosa: [5.3, 2.8],
  areia_argilosa: [5.3, 3],
  silte_arenoso: [4.8, 3],
  silte_arenoargiloso: [3.8, 3],
  silte: [4.8, 3],
  silte_argiloarenoso: [3.8, 3],
  silte_argiloso: [3, 3.4],
  argila_arenosa: [4.8, 4],
  argila_arenossiltosa: [3, 4.5],
  argila_siltoarenosa: [3, 5],
  argila_siltosa: [2.5, 5.5],
  argila: [2.5, 6],
})

/** Tab. 12.10 de Velloso & Lopes (Monteiro, 1997). */
const AV_MONTEIRO = kaFromKgf({
  areia: [7.3, 2.1],
  areia_siltosa: [6.8, 2.3],
  areia_siltoargilosa: [6.3, 2.4],
  areia_argilossiltosa: [5.7, 2.9],
  areia_argilosa: [5.4, 2.8],
  silte_arenoso: [5, 3],
  silte_arenoargiloso: [4.5, 3.2],
  silte: [4.8, 3.2],
  silte_argiloarenoso: [4, 3.3],
  silte_argiloso: [3.2, 3.6],
  argila_arenosa: [4.4, 3.2],
  argila_arenossiltosa: [3, 3.8],
  argila_siltoarenosa: [3.3, 4.1],
  argila_siltosa: [2.6, 4.5],
  argila: [2.5, 5.5],
})

const AV_SOIL_SETS: Record<AvSetId, Record<SoilType, KA>> = {
  cintra: AV_CINTRA,
  laprovitera: AV_LAPROVITERA,
  monteiro: AV_MONTEIRO,
}

/** F1 e F2 por tipo de estaca em cada conjunto; ausente = o conjunto não cobre aquele tipo. */
function avSetF(set: AvSetId, type: PileType, D: number): { F1: number; F2: number } | undefined {
  switch (set) {
    case 'cintra': // Tab. 1.5 (atualizada)
      switch (type) {
        case 'premoldada': return { F1: 1 + D / 0.8, F2: 2 * (1 + D / 0.8) }
        case 'franki': return { F1: 2.5, F2: 5.0 }
        case 'escavada':
        case 'escavada_fluido': return { F1: 3.0, F2: 6.0 }
        case 'raiz':
        case 'helice': return { F1: 2.0, F2: 4.0 }
        default: return undefined
      }
    case 'laprovitera': // Tab. 12.9
      switch (type) {
        case 'premoldada': return { F1: 2.0, F2: 3.5 }
        case 'franki': return { F1: 2.5, F2: 3.0 }
        case 'escavada':
        case 'escavada_fluido': return { F1: 4.5, F2: 4.5 }
        default: return undefined
      }
    case 'monteiro': // Tab. 12.11 (Franki tem 2 variantes no livro: não incluída)
      switch (type) {
        case 'premoldada': return { F1: 2.5, F2: 3.5 } // cravada a percussão
        case 'escavada_fluido': return { F1: 3.5, F2: 4.5 }
        case 'raiz': return { F1: 2.2, F2: 2.4 }
        case 'strauss': return { F1: 4.2, F2: 3.9 }
        case 'helice': return { F1: 3.0, F2: 3.8 }
        default: return undefined
      }
  }
}

export interface AvResolved {
  /** Conjunto efetivamente usado (pode diferir do pedido, se o pedido não cobre o tipo de estaca). */
  setUsed: AvSetId
  soil: Record<SoilType, KA>
  F1: number
  F2: number
  /** Mensagem quando houve troca de conjunto ou uso de regra restrita. */
  note?: string
}

/**
 * Resolve o conjunto de coeficientes. O conjunto pedido é usado inteiro (k, α, F1, F2 do mesmo autor).
 * Se ele não cobre o tipo de estaca: Strauss → Monteiro (único com valores publicados);
 * demais → Cintra & Aoki (2010); se nem este cobre, lança erro.
 */
export function resolveAv(requested: AvSetId, type: PileType, D: number): AvResolved {
  const direct = avSetF(requested, type, D)
  if (direct) return { setUsed: requested, soil: AV_SOIL_SETS[requested], ...direct, note: requested === 'monteiro' ? NOTE_MONTEIRO : undefined }
  const fallback: AvSetId = type === 'strauss' ? 'monteiro' : 'cintra'
  const f = avSetF(fallback, type, D)
  if (!f) throw new Error('Sem coeficientes de Aoki-Velloso para este tipo de estaca')
  return {
    setUsed: fallback,
    soil: AV_SOIL_SETS[fallback],
    ...f,
    note: `Aoki-Velloso: o conjunto "${AV_SET_LABEL[requested]}" não cobre este tipo de estaca; usado "${AV_SET_LABEL[fallback]}".` + (fallback === 'monteiro' ? ' ' + NOTE_MONTEIRO : ''),
  }
}

const NOTE_MONTEIRO =
  'Conjunto Monteiro (1997): só k, α, F1 e F2 são aplicados; a regra de Monteiro para a média de N na ponta (7B acima, 3,5B abaixo) e o limite N ≤ 40 não são aplicados. Para hélice contínua, Monteiro (1997) recomenda reserva (poucas provas de carga).'

// ---------------------------------------------------------------- Décourt-Quaresma (1978/1996)

/** Tab. 1.6 — coeficiente característico do solo C (kPa). Só 4 classes constam do livro. */
export const DQ_C: Record<SoilType, { C: number; source: Provenance }> = {
  areia: { C: 400, source: 'livro' },
  areia_siltosa: { C: 400, source: 'adaptado' },
  areia_siltoargilosa: { C: 400, source: 'adaptado' },
  areia_argilosa: { C: 400, source: 'adaptado' },
  areia_argilossiltosa: { C: 400, source: 'adaptado' },
  silte: { C: 250, source: 'adaptado' },
  silte_arenoso: { C: 250, source: 'livro' },
  silte_arenoargiloso: { C: 200, source: 'adaptado' },
  silte_argiloso: { C: 200, source: 'livro' },
  silte_argiloarenoso: { C: 200, source: 'adaptado' },
  argila: { C: 120, source: 'livro' },
  argila_arenosa: { C: 120, source: 'adaptado' },
  argila_arenossiltosa: { C: 120, source: 'adaptado' },
  argila_siltosa: { C: 120, source: 'adaptado' },
  argila_siltoarenosa: { C: 120, source: 'adaptado' },
}

export interface AlphaBeta {
  alpha: Record<SoilClass3, number>
  beta: Record<SoilClass3, number>
  /** Limite superior de N_L (Décourt, 1982). */
  nlMax: number
  /** 'orientativo' = o livro marca com * ("valores apenas orientativos diante do reduzido número de dados"). */
  source: Provenance | 'orientativo'
}

const ONE = { argila: 1, intermediario: 1, areia: 1 }

/** Tabs. 1.7 e 1.8 — fatores α (ponta) e β (lateral) de Décourt (1996). */
export function dqAlphaBeta(type: PileType): AlphaBeta {
  switch (type) {
    case 'premoldada':
    case 'franki': // método original (α = β = 1); N_L até 50 para estacas de deslocamento
      return { alpha: ONE, beta: ONE, nlMax: 50, source: 'livro' }
    case 'escavada':
      return {
        alpha: { argila: 0.85, intermediario: 0.6, areia: 0.5 },
        beta: { argila: 0.8, intermediario: 0.65, areia: 0.5 },
        nlMax: 15,
        source: 'orientativo',
      }
    case 'strauss': // tratada como "escavada em geral" (N_L ≤ 15 para Strauss)
      return {
        alpha: { argila: 0.85, intermediario: 0.6, areia: 0.5 },
        beta: { argila: 0.8, intermediario: 0.65, areia: 0.5 },
        nlMax: 15,
        source: 'adaptado',
      }
    case 'escavada_fluido':
      return {
        alpha: { argila: 0.85, intermediario: 0.6, areia: 0.5 },
        beta: { argila: 0.9, intermediario: 0.75, areia: 0.6 },
        nlMax: 50,
        source: 'orientativo',
      }
    case 'helice':
      return {
        alpha: { argila: 0.3, intermediario: 0.3, areia: 0.3 },
        beta: { argila: 1.0, intermediario: 1.0, areia: 1.0 },
        nlMax: 15,
        source: 'orientativo',
      }
    case 'raiz':
      return {
        alpha: { argila: 0.85, intermediario: 0.6, areia: 0.5 },
        beta: { argila: 1.5, intermediario: 1.5, areia: 1.5 },
        nlMax: 15,
        source: 'orientativo',
      }
  }
}

// ---------------------------------------------------------------- Teixeira (1996)

type TeixeiraCol = 'premoldada' | 'franki' | 'escavada' | 'raiz'

/** Tab. 1.9 — α (kPa), válido para 4 < N_SPT < 40. Colunas: [pré-moldada/metálica, Franki, escavada a céu aberto, raiz]. */
const TEIXEIRA_ALPHA: Record<SoilType, { v: [number, number, number, number]; source: Provenance }> = {
  areia: { v: [400, 340, 270, 260], source: 'livro' },
  areia_siltosa: { v: [360, 300, 240, 220], source: 'livro' },
  areia_siltoargilosa: { v: [330, 270, 220, 205], source: 'adaptado' },
  areia_argilosa: { v: [300, 240, 200, 190], source: 'livro' },
  areia_argilossiltosa: { v: [330, 270, 220, 205], source: 'adaptado' },
  silte: { v: [160, 120, 110, 110], source: 'adaptado' },
  silte_arenoso: { v: [260, 210, 160, 160], source: 'livro' },
  silte_arenoargiloso: { v: [210, 165, 135, 135], source: 'adaptado' },
  silte_argiloso: { v: [160, 120, 110, 110], source: 'livro' },
  silte_argiloarenoso: { v: [210, 165, 135, 135], source: 'adaptado' },
  argila: { v: [110, 100, 100, 100], source: 'adaptado' },
  argila_arenosa: { v: [210, 160, 130, 140], source: 'livro' },
  argila_arenossiltosa: { v: [160, 130, 115, 120], source: 'adaptado' },
  argila_siltosa: { v: [110, 100, 100, 100], source: 'livro' },
  argila_siltoarenosa: { v: [160, 130, 115, 120], source: 'adaptado' },
}

const TEIXEIRA_COL: Record<PileType, { col: TeixeiraCol; beta: number; source: Provenance }> = {
  premoldada: { col: 'premoldada', beta: 4, source: 'livro' }, // Tab. 1.10
  franki: { col: 'franki', beta: 5, source: 'livro' },
  escavada: { col: 'escavada', beta: 4, source: 'livro' },
  raiz: { col: 'raiz', beta: 6, source: 'livro' },
  // Não constam do livro; a planilha usa a coluna "escavada" e β = 4.
  escavada_fluido: { col: 'escavada', beta: 4, source: 'adaptado' },
  strauss: { col: 'escavada', beta: 4, source: 'adaptado' },
  helice: { col: 'escavada', beta: 4, source: 'adaptado' },
}

const COL_INDEX: Record<TeixeiraCol, number> = { premoldada: 0, franki: 1, escavada: 2, raiz: 3 }

export function teixeiraAlphaBeta(type: PileType, soil: SoilType) {
  const t = TEIXEIRA_COL[type]
  const a = TEIXEIRA_ALPHA[soil]
  return {
    alpha: a.v[COL_INDEX[t.col]],
    beta: t.beta,
    source: (a.source === 'livro' && t.source === 'livro' ? 'livro' : 'adaptado') as Provenance,
  }
}
