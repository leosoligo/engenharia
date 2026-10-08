/** Monta os dados da otimização de um pilar a partir do projeto e dos parâmetros (usado pela tela de resultados e pelo lote). */
import { resolveCosts } from '../costs'
import { groupByPillar } from '../core/loads'
import type { OptimizeInput, OptimizeResult, Progress } from '../core/optimize'
import type { PileType } from '../core/pile'
import { pillarAnchorage } from '../core/block'
import { OPTIMIZABLE_TYPES, lateralOptions, type Settings } from '../settings'
import { pillarHoles, pillarSection, type Project } from './project'

export interface CachedResult {
  result: OptimizeResult
  input: OptimizeInput
  /** Assinatura dos dados usados (para avisar quando ficam desatualizados). */
  key: string
}

/** Cálculo em andamento (compartilhado pela aplicação inteira: a barra de progresso aparece em qualquer tela). */
export interface Job {
  kind: 'lote' | 'pilar'
  /** Pilar atual (lote) ou pilar calculado. */
  label: string
  done: number
  total: number
  detail?: Progress
}

export type Fixed = { type?: PileType; diameter?: number; layoutId?: string; length?: number }

/** Assinatura dos dados que influenciam o cálculo de um pilar. */
export function inputKey(project: Project, settings: Settings, pillar: string): string {
  const holes = pillarHoles(project, pillar)
  return JSON.stringify([
    project.library.filter((h) => holes.includes(h.id)), project.combos.filter((c) => c.pillar === pillar), pillarSection(project, pillar), project.pillars?.[pillar]?.areaCm2, settings,
  ], (_, v) => (v === Infinity ? '__inf__' : v))
}

export function buildInput(project: Project, settings: Settings, pillar: string, fix: Fixed = {}): { input?: OptimizeInput; error?: string } {
  const holes = project.library.filter((h) => pillarHoles(project, pillar).includes(h.id))
  const combos = groupByPillar(project.combos).get(pillar) ?? []
  if (holes.length === 0) return { error: `Pilar ${pillar}: selecione ao menos uma sondagem.` }
  if (!combos.some((c) => c.state === 'ELS') || !combos.some((c) => c.state === 'ELU')) return { error: `Pilar ${pillar}: faltam combinações ELS e/ou ELU.` }
  if (!combos.some((c) => c.fz > 0)) return { error: `Pilar ${pillar}: nenhuma combinação com compressão (Fz > 0).` }
  const sec = pillarSection(project, pillar)
  const spt = Math.min(...holes.map((h) => h.layers.length))
  if (settings.lengthMode === 'fixo' && settings.lengthFixed + settings.topDepth > spt + 1e-9)
    return { error: `Pilar ${pillar}: comprimento fixo de ${settings.lengthFixed} m + base do bloco a ${settings.topDepth} m = ${settings.lengthFixed + settings.topDepth} m excede a sondagem (${spt} m). Aprofunde a sondagem ou reduza o comprimento.` }
  if (settings.lengthMode === 'fixo') fix = { ...fix, length: settings.lengthFixed }
  const types = OPTIMIZABLE_TYPES.filter((t) => settings.typesEnabled[t])
  const methods = (Object.keys(settings.methods) as (keyof Settings['methods'])[]).filter((m) => settings.methods[m])
  const arr = project.pillars?.[pillar]?.arranque
  const input: OptimizeInput = {
    boreholes: holes, capacityMethods: methods, capacityCombine: settings.capacityCombine, tipUsePct: settings.tipUsePct, shaftUsePct: settings.shaftUsePct, capacityParams: settings.capParams, safety: { mode: settings.safetyMode, fsGlobal: settings.fsGlobal },
    pillar: { ax: sec.ax / 100, ay: sec.ay / 100 }, pillarArea: project.pillars?.[pillar]?.areaCm2 ? project.pillars[pillar].areaCm2! / 1e4 : undefined, combos, types,
    diameters: Object.fromEntries(types.map((t) => [t, settings.diameters[t].map((d) => d / 100)])),
    caa: settings.caa, transverse: settings.transverse, topDepth: settings.topDepth, Lmin: settings.lengthMode === 'fixo' ? settings.lengthFixed : settings.Lmin, Lmax: settings.lengthMode === 'fixo' ? settings.lengthFixed : settings.Lmax,
    serviceLimit: settings.serviceLimitMm / 1000, costs: resolveCosts(settings.costSource, types, settings.diameters, settings.costs), groupEffect: settings.groupEffect, fck: settings.fck ?? undefined,
    eiFactor: settings.eiFactor, nonlinearEI: settings.nonlinearEI, loading: settings.loading, permitTension: settings.permitTension, tensionShaftFactor: settings.tensionShaftFactor,
    headFixity: settings.headFixity, execEccentricity: settings.execEccentricityCm / 100, blockUnitWeight: settings.blockUnitWeight,
    blockWeightFactorELU: settings.blockWeightFactorELU, blockMargin: settings.blockMarginCm / 100, blockKR: settings.blockKR, pileSpacingFactor: settings.pileSpacingFactor ?? undefined, blockEdgeClear: settings.blockEdgeRule === 'grande' ? 0.15 : settings.blockEdgeRule === 'pequeno' ? 0.05 : undefined, blockFck: settings.blockFck,
    blockAlpha: settings.blockAlpha, maxResults: settings.maxResults, fixed: fix,
    lateralOptions: lateralOptions(settings, holes[0]?.id), lateralHoles: settings.lateralHoles, structural: settings.structural,
    blockThetaMin: settings.blockThetaMin, blockThetaMax: settings.blockThetaMax, blockMethod: settings.blockMethod, blockShape: settings.blockShape,
    blockHMin: Math.max(settings.blockHMinCm / 100, arr ? pillarAnchorage(arr, settings.blockFck, settings.caa).hMin : 0), blockD1Factor: settings.blockD1Factor,
    softClayNspt: settings.softClayNspt,
    axialTransfer: settings.axialTransfer,
    negFriction: settings.negFriction.on
      ? { zNeutral: settings.negFriction.zNeutral, beta: settings.negFriction.beta, gamma: settings.negFriction.gamma, surcharge: settings.negFriction.surcharge, waterLevel: holes[0]?.waterLevel }
      : undefined,
    negFrictionFactor: settings.negFriction.factorELU,
    settlement: settings.settlement.on
      ? { raftDepth: settings.settlement.raftDepth, spread: settings.settlement.spread, eFactor: settings.settlement.eFactor, limit: settings.settlement.limitMm > 0 ? settings.settlement.limitMm / 1000 : undefined }
      : undefined,
  }
  return { input }
}
