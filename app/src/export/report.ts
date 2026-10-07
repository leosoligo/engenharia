/**
 * Memorial de cálculo: HTML autocontido (imprimir → PDF) e DOCX (Word). O conteúdo é montado uma vez (`buildReportDoc`) e
 * renderizado nos dois formatos. Reúne dados de entrada, premissas, resultados, verificações, quantitativos, custos e fontes.
 */
import type { Candidate } from '../core/optimize'
import { PILE_LABEL } from '../core/pile'
import type { LoadCombination } from '../core/loads'
import type { SptBorehole } from '../core/soil'
import { BLOCK_METHOD_LABEL } from '../core/block'
import { NEG_BETA } from '../core/special/negfriction'
import { RAFT_DEPTH_LABEL } from '../core/special/settlement'
import type { Settings } from '../settings'
import { barSchedule } from './schedule'
import { renderDocx, renderHtml, type Doc, type DocBlock } from './doc'
import { KN, unitText, type Units } from '../ui/units'

const n = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')
const brl = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export interface ReportContext {
  pillarId: string
  pillar: { ax: number; ay: number }
  combos: LoadCombination[]
  boreholes: SptBorehole[]
  settings: Settings
  dateISO?: string
  /** Unidades de força e momento do memorial (padrão kN). */
  units?: Units
}

export function buildReportDoc(c: Candidate, ctx: ReportContext): Doc {
  const bd = c.blockDesign
  const l = c.design.longitudinal!
  const t = c.design.transverse!
  const g = bd.geometry
  const s = ctx.settings
  const sch = barSchedule(c)
  const u = ctx.units ?? KN
  const dm = u.k === 1 ? 1 : 2
  const fd = u.k === 1 ? 0 : 1
  const b: DocBlock[] = []
  const table = (rows: string[][], head?: string[], boldLast = false) => b.push({ k: 'table', head, rows, boldLast })

  b.push({ k: 'h1', t: 'Memorial de cálculo — fundação em estacas' })
  b.push({ k: 'note', t: `Pilar ${ctx.pillarId} · gerado pelo Estakalc em ${ctx.dateISO ?? new Date().toISOString().slice(0, 10)}. Documento de apoio: a responsabilidade técnica pelo projeto é do engenheiro responsável.` })

  b.push({ k: 'h2', t: '1. Solução adotada' })
  table([
    ['Estaca', `${PILE_LABEL[c.type]} Ø ${n(c.diameter * 100, 0)} cm`],
    ['Número de estacas / arranjo', `${c.layout.n} — ${c.layout.label} (espaçamento ${n(c.spacing)} m)`],
    ['Comprimento', `${n(c.length, 1)} m abaixo da base do bloco (base a ${n(s.topDepth, 2)} m do terreno)`],
    ['Armadura longitudinal', `${l.n} Ø ${n(l.phiMm, 1)} mm (As = ${n(l.As * 1e4)} cm², ρ = ${n(l.rho * 100)} %), gaiola de ${n(c.design.cageLength!, 1)} m`],
    ['Armadura transversal', `${t.type === 'estribo' ? 'Estribos fechados' : 'Helicoidal'} Ø ${n(t.phiMm, 1)} mm: ${t.zones.map((z) => `${n(z.from, 1)}–${n(z.to, 1)} m c/${n(z.spacing * 100, 1)} cm`).join('; ')}`],
    ['Concreto da estaca', `fck ${c.design.fck} MPa (γc = ${c.design.gammaC} — NBR 6122:2022, Tab. 4); cobrimento ${n(c.design.cover * 1000, 0)} mm`],
    ['Bloco', `${g.shape === 'tipico' ? 'contorno típico do arranjo, poligonal (estacas afastadas de a; caixa envolvente ' : g.shape === 'otimizado' ? 'contorno poligonal (casco das estacas afastado de a ≥ dE + 15 cm; caixa envolvente ' : 'retangular ('}${n(g.lx)} × ${n(g.ly)} m), área ${n(g.area)} m², h = ${n(g.h)} m, d = ${n(g.d)} m, fck ${g.fck} MPa`],
  ])

  b.push({ k: 'h2', t: '2. Dados de entrada' })
  table(
    ctx.combos.map((q) => [q.name, q.state, n(q.fx * u.k, dm), n(q.fy * u.k, dm), n(q.fz * u.k, dm), n(q.mx * u.k, dm), n(q.my * u.k, dm), n(q.mz * u.k, dm)]),
    ['Combinação', 'Tipo', `Fx (${u.F})`, `Fy (${u.F})`, `Fz (${u.F})`, `Mx (${u.M})`, `My (${u.M})`, `Mz (${u.M})`],
  )
  b.push({ k: 'note', t: `${u.F} e ${u.M}${u.k === 1 ? '' : ' (1 tf = 9,80665 kN)'}; Fz > 0 compressão; X, Y em planta, Z para cima (mão direita). Seção do pilar ${n(ctx.pillar.ax * 100, 0)} × ${n(ctx.pillar.ay * 100, 0)} cm.` })
  b.push({ k: 'p', t: `Sondagens: ${ctx.boreholes.map((h) => `${h.id} (${h.layers.length} m, NA ${h.waterLevel === Infinity ? 'não encontrado' : n(h.waterLevel ?? NaN, 1) + ' m'})`).join('; ')}.` })

  b.push({ k: 'h2', t: '3. Critérios e parâmetros' })
  const crit: string[][] = [
    ['Capacidade de carga', `Métodos semiempíricos por SPT: ${Object.entries(s.methods).filter(([, v]) => v).map(([k]) => k).join(', ')} — ${Object.values(s.methods).filter(Boolean).length > 1 ? (s.capacityCombine === 'media' ? 'média das cargas admissíveis' : 'vale o menor') : 'método único'}; resistência de ponta considerada a ${s.tipUsePct} % e lateral a ${s.shaftUsePct} %; critério de segurança: ${s.safetyMode === 'conservador' ? 'conservador (menor entre Rk/1,4 com ξ e R/FS global)' : s.safetyMode === 'global' ? `FS global ${s.fsGlobal}` : 'NBR 6122:2022 (Rk/1,4 com ξ)'}`],
    ['Deslocamento horizontal máximo no topo (ELS)', `${s.serviceLimitMm} mm (valor informado pelo usuário; depende da estrutura suportada)`],
    ['Interação solo-estrutura', `Winkler com curvas p-y (${s.loading === 'static' ? 'estático' : 'cíclico'}); efeito de grupo ${s.groupEffect === 'davisson' ? 'Davisson (1970)' : 'desprezado'}; cabeça ${s.headFixity}`],
    ['Rigidez à flexão', `EI = ${s.eiFactor}·Ecs·I (ELS) ${s.nonlinearEI ? '; EI(M) por momento-curvatura no ELU' : ''}`],
    ['Concreto/aço da estaca', `CAA ${s.caa}; CA-50; γs = 1,15; redução de 2 mm no diâmetro das barras longitudinais (NBR 6122, 8.6.2)`],
    ['Origem dos custos', s.costSource.kind === 'sinapi' ? `SINAPI (CAIXA/IBGE), referência 08/2026, ${s.costSource.uf}, ${s.costSource.regime === 'nao' ? 'sem desoneração' : 'com desoneração'}; valores editados pelo usuário prevalecem` : 'Valores informados manualmente pelo usuário'],
    ['Bloco', `${BLOCK_METHOD_LABEL[s.blockMethod]}; bielas entre ${s.blockThetaMin}° e ${s.blockThetaMax}°; fck inicial ${s.blockFck} MPa; K_R = ${s.blockKR}; ${s.blockEdgeRule === 'campos' ? `a = dE + ${s.blockMarginCm} cm (Campos)` : s.blockEdgeRule === 'grande' ? 'folga da face da estaca à borda ≥ 15 cm (Bastos, grande porte)' : 'folga da face da estaca à borda ≥ 5 cm (Bastos, pequeno porte)'}`],
  ]
  if (c.special && c.special.softClayM > 0) crit.push(['Argila mole', `N_SPT ≤ ${s.softClayNspt} (limite adotado pelo usuário; a NBR 6122:2022 não o fixa) — 8.6.1 e 8.6.5.1`])
  if (c.special?.negFriction) crit.push(['Atrito negativo', `β = ${s.negFriction.beta} (${s.negFriction.soil}; faixa ${NEG_BETA[s.negFriction.soil].min} a ${NEG_BETA[s.negFriction.soil].max}, Long e Healy 1974); γ = ${s.negFriction.gamma} kN/m³; sobrecarga ${s.negFriction.surcharge} kPa; ponto neutro a ${s.negFriction.zNeutral} m; coeficiente no ELU ${s.negFriction.factorELU}`])
  if (c.special?.settlement) crit.push(['Recalque do grupo', `Radier fictício (Terzaghi e Peck, 1948): ${RAFT_DEPTH_LABEL[s.settlement.raftDepth]}; espraiamento ${s.settlement.spread}; E = α·K·N (Teixeira e Godoy, 1996) × ${s.settlement.eFactor}`])
  table(crit)

  b.push({ k: 'h2', t: '4. Verificações em serviço (ELS)' })
  table([
    ['Deslocamento máximo no topo', `${n(c.service.maxHeadDisplacement * 1000, 1)} mm ≤ ${s.serviceLimitMm} mm`],
    ['Compressão máxima por estaca', `${n(c.service.maxCompression * u.k, fd)} ${u.F} ≤ Padm = ${n(c.service.padm * u.k, fd)} ${u.F}`],
    ['Esforço axial mínimo', `${n(c.service.minAxial * u.k, fd)} ${u.F} ${s.permitTension ? '(tração admitida)' : '(sem tração)'}`],
  ])

  b.push({ k: 'h2', t: '5. Dimensionamento estrutural da estaca (ELU)' })
  table([
    ['Maior momento de cálculo', `${n(c.maxMomentELU.value * u.k, dm)} ${u.M} a ${n(c.maxMomentELU.z, 2)} m do topo (${c.maxMomentELU.pile}, ${c.maxMomentELU.combo})`],
    ['Utilização à flexo-compressão', `${n(l.utilization * 100, 0)} %`],
    ['Cortante máximo / VRd2', `${n(c.design.shear!.VSdMax * u.k, dm)} ${u.F} / ${n(c.design.shear!.VRd2 * u.k, fd)} ${u.F}`],
    ['Ancoragem da armadura', `${n(c.design.lbNec! * 100, 0)} cm`],
    ['Massa de aço', `${n(c.design.weights!.totalKg, 1)} kg por estaca (${n(c.design.weights!.kgPerM3, 0)} kg/m³)`],
  ])

  b.push({ k: 'h2', t: '6. Bloco de coroamento' })
  b.push({ k: 'p', t: `Método das armaduras: ${bd.method ? BLOCK_METHOD_LABEL[bd.method] : BLOCK_METHOD_LABEL[s.blockMethod]}.${bd.methodKg ? ` Massa de tirantes por método (kg): Campos ${n(bd.methodKg.blevot ?? NaN, 1)}; Machado/Bastos ${n(bd.methodKg.machado ?? NaN, 1)}; CEB-70 ${n(bd.methodKg.flexao ?? NaN, 1)}.` : ''}` })
  table(
    bd.checks.map((k) => [k.name, k.unit === 'kN' ? `${n(k.value * u.k, fd)} ${u.F}` : `${n(k.value / 1000)} MPa`, k.unit === 'kN' ? `${n(k.limit * u.k, fd)} ${u.F}` : `${n(k.limit / 1000)} MPa`, k.ok ? 'OK' : 'NÃO ATENDE']),
    ['Verificação (biela e cortante)', 'Solicitante', 'Limite', 'Situação'],
  )
  b.push({ k: 'note', t: `Ângulos das bielas: ${bd.theta.map((x) => n(x, 1) + '°').join(', ')}. Tração nos tirantes radiais: ${bd.Rs.map((x) => n(x * u.k, fd) + ' ' + u.F).join(', ')}.` })
  table(
    bd.bars.map((x) => [x.label, n(x.AsReq) + ' cm²', `${x.n} Ø ${n(x.phiMm, 1)} (${n(x.AsEff)} cm²)`, n(x.length) + ' m']),
    ['Armadura', 'As necessária', 'Adotada', 'Comprimento'],
  )
  b.push({ k: 'ul', items: bd.secondary.map((x) => x.description) })
  if (bd.crack && bd.crack.length > 0) {
    b.push({ k: 'p', t: 'Fissuração dos tirantes no ELS (NBR 6118:2026, 17.3.3.2; limites da Tabela 13.4, combinação frequente):' })
    table(bd.crack.map((q) => [q.name, `${n(q.sigma, 0)} MPa`, `${n(q.wk, 2)} mm`, `${n(q.limit, 1)} mm`, q.ok ? 'OK' : 'NÃO ATENDE']), ['Tirante', 'σs (ELS)', 'wk', 'Limite', 'Situação'])
  }

  if (c.special && (c.special.softClayM > 0 || c.special.negFriction || c.special.settlement)) {
    b.push({ k: 'h2', t: '7. Verificações especiais' })
    const sp: string[][] = []
    if (c.special.softClayM > 0) sp.push(['Argila mole atravessada', `${c.special.softClayM} m; W = ${n((Math.PI * (c.diameter * 100) ** 3) / 32, 0)} cm³ (≥ 930) e i = ${n((c.diameter * 100) / 4, 1)} cm (NBR 6122:2022, 8.6.5.1); 2ª ordem no P-Δ da análise (8.6.1)`])
    if (c.special.negFriction) sp.push(['Atrito negativo', `Qn = ${n(c.special.negFriction.Qn * u.k, fd)} ${u.F} por estaca (característico); de cálculo ${n(c.special.negFriction.Qnd * u.k, fd)} ${u.F}; ponto neutro a ${n(c.special.negFriction.zNeutral, 1)} m (NBR 6122:2022, 5.8; Velloso & Lopes, §18.1)`])
    const st = c.special.settlement
    if (st) sp.push(['Recalque estimado do grupo', `${n(st.total * 1000, 1)} mm = radier fictício ${n(st.raft * 1000, 1)} mm (a ${n(st.raftZ, 1)} m) + encurtamento elástico ${n(st.elastic * 1000, 1)} mm${st.limit ? `; limite ${n(st.limit * 1000, 0)} mm` : ''}${st.truncated ? '; sondagem termina antes da profundidade de influência (valor subestimado)' : ''}`])
    table(sp)
  }

  b.push({ k: 'h2', t: '8. Tabela de ferros' })
  table(
    [
      ...sch.rows.map((r) => [r.pos, r.element, r.description, n(r.phiMm, 1), String(r.qty), n(r.unitLen), n(r.totalLen), n(r.kg, 1)]),
      ...sch.extras.map((e) => ['—', 'Bloco', e.description, '—', '—', '—', '—', n(e.kg, 1)]),
      ['', '', 'Total', '', '', '', '', n(sch.totalKg, 1)],
    ],
    ['Pos.', 'Elemento', 'Descrição', 'Ø (mm)', 'Qtd.', 'C. unit. (m)', 'C. total (m)', 'Peso (kg)'],
    true,
  )
  table(sch.summary.map((r) => [r.steel, n(r.phiMm, 1), n(r.lengthM), n(r.kg, 1)]), ['Aço', 'Ø (mm)', 'Comprimento (m)', 'Peso (kg)'])
  b.push({ k: 'note', t: `Quantidade total na fundação (todas as estacas). Estacas: comprimento da gaiola, sem espera de ancoragem no bloco. ${sch.rows.map((r) => (r.note ? `${r.pos}: ${r.note}.` : '')).join(' ')} Aço de 5 mm: CA-60.` })

  b.push({ k: 'h2', t: '9. Quantitativos e custo' })
  table(
    [
      ['Concreto das estacas', `${n(c.quantities.pileConcreteM3)} m³`],
      ['Aço das estacas', `${n(c.quantities.steelKg, 0)} kg`],
      ['Concreto / forma / aço do bloco', `${n(bd.quantities.concreteM3)} m³ / ${n(bd.quantities.formM2)} m² / ${n(bd.quantities.steelKg, 0)} kg`],
      ['Concreto', brl(c.cost.concrete)], ['Aço', brl(c.cost.steel)], ['Execução', brl(c.cost.execution)],
      ['Mobilização + arrasamento', brl(c.cost.mobilization + c.cost.cutOff)], ['Bloco (concreto + forma)', brl(c.cost.block)], ['Extras', brl(c.cost.extras)],
      ['Total', brl(c.cost.total)],
    ],
    undefined,
    true,
  )

  b.push({ k: 'h2', t: '10. Avisos e premissas a revisar' })
  const warn = [...new Set([...c.warnings])]
  if (warn.length === 0) b.push({ k: 'p', t: 'Nenhum.' })
  for (const w of warn) b.push({ k: 'warn', t: unitText(w, u) })

  b.push({ k: 'h2', t: '11. Referências' })
  b.push({
    k: 'ul', small: true, items: [
      'ABNT NBR 6122:2022 — Projeto e execução de fundações (Tab. 2 e 4; itens 5.8, 6.2.1.2, 8.4.2, 8.4.3, 8.5.5–8.5.7, 8.6).',
      'ABNT NBR 6118:2026 — Projeto de estruturas de concreto (7.4, 8.2.10, 9.4, 13.4, 17.2–17.4, 18.3–18.4, 22.7).',
      'Velloso, D. A.; Lopes, F. R. — Fundações (vol. completo), cap. 12 (capacidade de carga), 15 (estacas sob esforços transversais), 16 (grupos e recalques) e 18 (atrito negativo e flambagem).',
      'Cintra, J. C. A.; Aoki, N. — Fundações por estacas: projeto geotécnico (2010).',
      'Campos, J. C. — Elementos de fundações em concreto (2015), cap. 10–13.',
      'Bastos, P. S. — Blocos de fundação, notas de aula, UNESP (2023), baseado em Machado (1985) e Campos (2015); Blévot e Frémy (1967); CEB-70.',
      'Matlock (1970); Reese, Cox & Koop (1975); API RP 2A — curvas p-y.',
      'Long e Healy (1974), apud Velloso & Lopes — β do atrito negativo; Terzaghi e Peck (1948) — radier fictício; Teixeira e Godoy (1996) — módulo de deformabilidade pelo SPT.',
      'SINAPI — Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (CAIXA/IBGE), relatório de agosto/2026.',
      'Marangon, M. — Geotecnia de fundações (UFJF, 2018): correlações com o SPT.',
    ],
  })
  return { title: `Memorial — Pilar ${ctx.pillarId}`, blocks: b }
}

/** Memorial em HTML (use "Imprimir / Salvar como PDF"). */
export function buildReport(c: Candidate, ctx: ReportContext): string {
  return renderHtml(buildReportDoc(c, ctx))
}

/** Memorial em DOCX (Word): arquivo ZIP/OOXML gerado sem dependências. */
export function buildReportDocx(c: Candidate, ctx: ReportContext): Uint8Array<ArrayBuffer> {
  return renderDocx(buildReportDoc(c, ctx))
}
