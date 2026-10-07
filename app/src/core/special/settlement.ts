/**
 * Recalque de grupo de estacas pelo artifício do radier fictício (Terzaghi e Peck, 1948; aceito pela NBR 6122; Velloso & Lopes §16.2.1,
 * Fig. 16.3) mais o encurtamento elástico das estacas. Módulo de deformabilidade do solo por E = α·K·N_SPT (Teixeira e Godoy, 1996).
 * É uma estimativa; confirme com o método adotado no projeto (p.ex. Aoki e Lopes).
 */
import { soilClass3, type SoilType, type SptBorehole } from '../soil'

/** K (MPa) de Teixeira e Godoy (1996). Onde a tabela não traz o tipo exato, adotou-se o menor K dos tipos vizinhos (a favor da segurança). */
export const K_TEIXEIRA_GODOY: Record<SoilType, number> = {
  areia: 0.9,
  areia_siltosa: 0.7,
  areia_siltoargilosa: 0.55,
  areia_argilosa: 0.55,
  areia_argilossiltosa: 0.55,
  silte: 0.35,
  silte_arenoso: 0.45,
  silte_arenoargiloso: 0.25,
  silte_argiloso: 0.25,
  silte_argiloarenoso: 0.25,
  argila: 0.2,
  argila_arenosa: 0.3,
  argila_arenossiltosa: 0.2,
  argila_siltosa: 0.2,
  argila_siltoarenosa: 0.2,
}
const ALPHA = { areia: 3, intermediario: 5, argila: 7 } as const

/** E (kPa) = α·K·N, com N limitado inferiormente a 1. */
export function soilModulus(soil: SoilType, nspt: number, factor = 1): number {
  return ALPHA[soilClass3(soil)] * K_TEIXEIRA_GODOY[soil] * 1000 * Math.max(nspt, 1) * factor
}

export type RaftDepth = 'ponta' | 'dois-tercos' | 'um-terco'
export const RAFT_DEPTH_LABEL: Record<RaftDepth, string> = {
  ponta: 'Na ponta (escavadas em geral; estacas através de solo mole com ponta em solo resistente)',
  'dois-tercos': 'A 2/3 do comprimento (cravadas em meio homogêneo)',
  'um-terco': 'A 1/3 do comprimento (cravadas através de solo resistente com ponta em solo mole)',
}
const RAFT_FRAC: Record<RaftDepth, number> = { ponta: 1, 'dois-tercos': 2 / 3, 'um-terco': 1 / 3 }

export interface SettlementInput {
  boreholes: SptBorehole[]
  /** Profundidade da base do bloco (m) e comprimento das estacas (m). */
  topDepth: number
  L: number
  /** Dimensões do grupo em planta, de face a face das estacas externas (m). */
  Bx: number
  By: number
  /** Carga vertical total de serviço sobre o grupo (kN), incluindo o peso do bloco. */
  Q: number
  /** Carga máxima de serviço por estaca (kN), diâmetro (m) e módulo do concreto (kPa) para o encurtamento elástico. */
  Pmax: number
  D: number
  Ec: number
  raftDepth?: RaftDepth
  /** Tangente do ângulo de espraiamento (H/V); padrão 0,5 (2:1). */
  spread?: number
  /** Multiplicador do módulo E (padrão 1). */
  eFactor?: number
}

export interface SettlementResult {
  /** Recalques (m): do radier fictício, encurtamento elástico das estacas e total. */
  raft: number
  elastic: number
  total: number
  /** Profundidade do radier fictício (m do terreno). */
  raftZ: number
  /** Profundidade até onde se somou a camada compressível (2·B abaixo do radier ou fim da sondagem) e se a sondagem terminou antes. */
  zEnd: number
  truncated: boolean
}

/**
 * Soma ε·h por camadas de 1 m abaixo do radier fictício, com Δσ = Q/[(Bx + 2 z t)(By + 2 z t)] no meio da camada, até 2·max(Bx, By)
 * abaixo do radier. Considera o furo mais desfavorável. O encurtamento elástico supõe a carga máxima constante ao longo da estaca.
 */
export function settlementOfGroup(inp: SettlementInput): SettlementResult {
  const frac = RAFT_FRAC[inp.raftDepth ?? 'dois-tercos']
  const raftZ = inp.topDepth + frac * inp.L
  const t = inp.spread ?? 0.5
  const zLimit = raftZ + 2 * Math.max(inp.Bx, inp.By)
  let worst = 0
  let zEndW = raftZ
  let truncW = false
  for (const b of inp.boreholes) {
    let s = 0
    let zEnd = raftZ
    let trunc = false
    for (let z = Math.floor(raftZ) + 1; z - 1 < zLimit; z++) {
      const layer = b.layers.find((l) => l.depth === z)
      if (!layer) { trunc = true; break }
      const top = Math.max(z - 1, raftZ)
      const bot = Math.min(z, zLimit)
      if (bot <= top) continue
      const zm = (top + bot) / 2 - raftZ
      const dsig = inp.Q / ((inp.Bx + 2 * zm * t) * (inp.By + 2 * zm * t))
      s += (dsig / soilModulus(layer.soil, layer.nspt, inp.eFactor)) * (bot - top)
      zEnd = bot
    }
    if (s >= worst) { worst = s; zEndW = zEnd; truncW = trunc }
  }
  const elastic = (inp.Pmax * inp.L) / (((Math.PI * inp.D ** 2) / 4) * inp.Ec)
  return { raft: worst, elastic, total: worst + elastic, raftZ, zEnd: zEndW, truncated: truncW }
}
