import { useMemo, useState } from 'react'
import { MissingWaterLevelError } from '../core/lateral'
import { optimizeAsync, reanalyzeELU, reevaluateWithLayout, type AsBuilt, type Candidate, type OptimizeInput, type OptimizeResult } from '../core/optimize'
import { groupByPillar } from '../core/loads'
import { PILE_LABEL } from '../core/pile'
import { OPTIMIZABLE_TYPES, verifyBase, type Settings } from '../settings'
import { resolveCosts } from '../costs'
import { buildDxf } from '../export/dxf'
import { buildReport, buildReportDocx } from '../export/report'
import { compareCsv, compareTable } from '../export/compare'
import { CostBars, Kpi, MiniPlan, PileLoadTable, PlanView, UtilBar, pileName } from '../ui/charts'
import { DepthColumns } from '../ui/xcharts'
import { table4 } from '../core/structural/design'
import { armorFromDesign, designFromArmor, verifyPile, type PileArmor } from '../core/structural/verify'
import { pillarHoles, pillarNames, pillarSection, type Project } from '../ui/project'
import { unitText, unitsOf } from '../ui/units'
import { buildInput, inputKey, type CachedResult, type Fixed, type Job } from '../ui/buildInput'
import { download } from './SoilPage'
import PileDesigner from './PileDesigner'
import BlockView, { blockFromEdit, type BlockEdit } from './BlockView'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')
const brl = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

type Tab = 'resumo' | 'bloco' | 'estaca' | 'analise' | 'custos' | 'avisos'
const TABS: [Tab, string][] = [['resumo', 'Resumo'], ['bloco', 'Bloco'], ['estaca', 'Estaca e armadura'], ['analise', 'Esforços na estaca'], ['custos', 'Custos'], ['avisos', 'Avisos']]

const candId = (pillar: string, c: Candidate) => `${pillar}|${c.type}:${c.diameter}:${c.layout.id}:${c.length}`

interface Props {
  project: Project
  setProject: (p: Project) => void
  settings: Settings
  /** Resultados já calculados, por pilar (compartilhados com o cálculo em lote). */
  cache: Record<string, CachedResult>
  setCache: (f: (c: Record<string, CachedResult>) => Record<string, CachedResult>) => void
  job?: Job
  setJob: (j: Job | undefined | ((j: Job | undefined) => Job | undefined)) => void
  cancelRef: { current: { cancelled: boolean } }
  onBack: () => void
}

export default function ResultsPage({ project, setProject, settings, cache, setCache, job, setJob, cancelRef, onBack }: Props) {
  const [error, setError] = useState('')
  const [selBy, setSelBy] = useState<Record<string, number>>({})
  const [tab, setTab] = useState<Tab>('resumo')
  const [fixed, setFixed] = useState<Fixed>({})
  const [armors, setArmors] = useState<Record<string, PileArmor>>({})
  const [blockEdits, setBlockEdits] = useState<Record<string, BlockEdit>>({})
  const [reana, setReana] = useState<Record<string, { demands: Candidate['demands']; elu: Candidate['profiles']['elu']; max: Candidate['maxMomentELU']; armorKey: string }>>({})
  const [reanaMsg, setReanaMsg] = useState('')
  const [asBuilt, setAsBuilt] = useState<Record<string, AsBuilt>>({})

  const pillar = project.pillar
  const u = unitsOf(project.units)
  const busy = job?.kind === 'pilar' && job.label === project.pillar
  const otherJob = !!job && !busy
  const progress = busy ? job.detail : undefined
  const pillars = pillarNames(project)
  const holeIds = pillarHoles(project, pillar)
  const holes = project.library.filter((h) => holeIds.includes(h.id))
  const current = groupByPillar(project.combos).get(pillar) ?? []
  const sec = pillarSection(project, pillar)
  const ax = sec.ax / 100
  const ay = sec.ay / 100
  const ready = holes.length > 0 && current.some((c) => c.state === 'ELS') && current.some((c) => c.state === 'ELU')
  const cached = cache[pillar]
  const result: OptimizeResult | undefined = cached?.result
  const lastInput: OptimizeInput | undefined = cached?.input
  const inputK = useMemo(() => inputKey(project, settings, pillar), [project, settings, pillar])
  const stale = !!cached && cached.key !== inputK
  const sel = Math.min(selBy[pillar] ?? 0, Math.max((result?.best.length ?? 1) - 1, 0))
  const setSel = (i: number) => setSelBy((m) => ({ ...m, [pillar]: i }))
  const types = OPTIMIZABLE_TYPES.filter((t) => settings.typesEnabled[t])
  const steelPrice = useMemo(() => resolveCosts(settings.costSource, types, settings.diameters, settings.costs).steelPerKg, [settings, types])
  const dropPillar = <T,>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${pillar}|`))) as Record<string, T>

  const run = async (fix: Fixed) => {
    setError('')
    if (job) return
    cancelRef.current = { cancelled: false }
    setJob({ kind: 'pilar', label: pillar, done: 0, total: 1 })
    const key = inputK
    try {
      const { input, error: err } = buildInput(project, settings, pillar, fix)
      if (!input) throw new Error(err)
      const r = await optimizeAsync(input, (p) => setJob((j) => (j ? { ...j, detail: p } : j)), cancelRef.current)
      setCache((c) => ({ ...c, [pillar]: { result: r, input, key } }))
      setReana(dropPillar)
      setReanaMsg('')
      setArmors(dropPillar)
      setBlockEdits(dropPillar)
      setAsBuilt(dropPillar)
      setSelBy((m) => ({ ...m, [pillar]: 0 }))
      setTab('resumo')
    } catch (e) {
      setCache((c) => { const n = { ...c }; delete n[pillar]; return n })
      setError(e instanceof MissingWaterLevelError ? `${e.message} Volte ao passo 1 e informe o nível d’água.` : (e as Error).message)
    } finally {
      setJob(undefined)
    }
  }

  const baseRaw: Candidate | undefined = result?.best[sel]
  const id = baseRaw ? candId(pillar, baseRaw) : ''
  const ra = reana[id]
  const asb = asBuilt[id]
  // locação ajustada (estacas fora da posição de projeto): substitui layout, reações, esforços e bloco
  const baseA: Candidate | undefined = useMemo(
    () => (baseRaw && asb ? { ...baseRaw, layout: asb.layout, service: asb.service, profiles: { els: asb.elsProfile, elu: asb.eluProfile }, pileAxialELS: asb.pileAxialELS, demands: asb.demands, maxMomentELU: asb.maxMomentELU, blockInput: asb.blockInput, blockDesign: asb.blockDesign } : baseRaw),
    [baseRaw, asb],
  )
  // com reanálise, os esforços (e perfis) passam a ser os calculados com a armadura do usuário
  const base: Candidate | undefined = useMemo(() => (baseA && ra ? { ...baseA, demands: ra.demands, maxMomentELU: ra.max, profiles: { ...baseA.profiles, elu: ra.elu } } : baseA), [baseA, ra])
  const suggested = useMemo(() => (baseRaw ? armorFromDesign(baseRaw.design) : undefined), [baseRaw])
  const armor = armors[id] ?? suggested
  const armorEdited = !!armors[id]
  const blockEdit = blockEdits[id] ?? {}
  const best: Candidate | undefined = useMemo(() => {
    if (!base || !armor) return base
    let cand = base
    if (armors[id]) {
      const v = verifyPile({ ...verifyBase(settings, base), demands: base.demands.sets }, armor)
      cand = { ...cand, design: designFromArmor(base.design, v, armor) }
    }
    if (blockEdits[id]) {
      const bd = blockFromEdit(base, blockEdits[id])
      if (bd.feasible) cand = { ...cand, blockDesign: bd }
    }
    return cand
  }, [base, armor, armors, blockEdits, id, settings])
  const reanalyze = () => {
    if (!lastInput || !baseRaw || !baseA || !base || !armor) return
    setReanaMsg('')
    try {
      const v = verifyPile({ ...verifyBase(settings, baseRaw), demands: baseA.demands.sets }, armor)
      const r = reanalyzeELU(lastInput, baseA, designFromArmor(baseRaw.design, v, armor))
      if (r.unstable) return setReanaMsg('A reanálise indicou instabilidade (flambagem) com esta armadura.')
      if (!r.converged) return setReanaMsg('A análise não linear não convergiu: o momento excede a capacidade desta armadura. Aumente a armadura.')
      setReana((m) => ({ ...m, [id]: { demands: { sets: r.sets, labels: r.labels }, elu: r.profile, max: r.max, armorKey: JSON.stringify(armor) } }))
    } catch (e) {
      setReanaMsg((e as Error).message)
    }
  }
  const applyLayout = (points: { x: number; y: number }[]): string | undefined => {
    if (!lastInput || !baseRaw || !armor) return 'Calcule a solução antes de ajustar a locação.'
    try {
      const v = verifyPile({ ...verifyBase(settings, baseRaw), demands: baseRaw.demands.sets }, armor)
      const be = blockEdit
      const opts: Record<string, unknown> = {}
      if (be.hCm !== undefined) opts.hFixed = be.hCm / 100
      if (be.lxCm !== undefined) opts.lx = be.lxCm / 100
      if (be.lyCm !== undefined) opts.ly = be.lyCm / 100
      if (be.fck !== undefined) opts.fckBlock = be.fck
      opts.method = be.method ?? settings.blockMethod
      const r = reevaluateWithLayout(lastInput, baseRaw, baseRaw.layout.points.map((p, i) => ({ ...p, x: points[i].x, y: points[i].y })), designFromArmor(baseRaw.design, v, armor), opts)
      setAsBuilt((m) => ({ ...m, [id]: r }))
      setReana((m) => { const n = { ...m }; delete n[id]; return n })
    } catch (e) {
      return (e as Error).message
    }
  }
  const vinBase = useMemo(() => (base ? verifyBase(settings, base) : undefined), [base, settings])
  const lockCount = Object.keys(fixed).length
  const designBad = !!best && !best.design.feasible

  return (
    <>
      <header className="page-h">
        <h1>4 · Resultados</h1>
        <p>O software compara tipos de estaca, diâmetros e arranjos, verifica solo, deslocamento, estaca e bloco, e ordena por custo. O resultado fica guardado enquanto você navega entre as etapas.</p>
      </header>

      <section className="card run">
        {pillars.length > 1 && (
          <div className="pills" role="tablist" aria-label="Pilares">
            {pillars.map((p) => <button key={p} role="tab" aria-selected={p === pillar} className={`pill ${p === pillar ? 'on' : ''}`} onClick={() => setProject({ ...project, pillar: p })}>{p}{cache[p] ? ' ✓' : ''}</button>)}
          </div>
        )}
        <div className="run-info">
          <div><span>Pilar</span><b>{pillar || '—'}</b><small>{sec.ax} × {sec.ay} cm</small></div>
          <div><span>Sondagem</span><b>{holes.map((h) => h.id).join(', ') || '—'}</b></div>
          <div><span>Combinações</span><b>{current.length}</b><small>{current.filter((c) => c.state === 'ELS').length} ELS · {current.filter((c) => c.state === 'ELU').length} ELU</small></div>
          <div><span>Tipos considerados</span><b>{types.length}</b></div>
        </div>
        <div className="row">
          <button className={stale ? 'primary big pulse' : 'primary big'} disabled={!ready || !!job} onClick={() => { setFixed({}); void run({}) }}>{busy ? 'Calculando…' : result ? (stale ? '▶ Recalcular (dados alterados)' : '▶ Recalcular') : '▶ Calcular solução mais econômica'}</button>
          {busy && <button onClick={() => { cancelRef.current.cancelled = true }}>Cancelar</button>}
          {otherJob && <span className="hint">Outro cálculo em andamento (veja a barra de progresso).</span>}
          {lockCount > 0 && !busy && <button onClick={() => { setFixed({}); void run({}) }}>Liberar tudo e recalcular</button>}
        </div>
        {busy && progress && (
          <div className="progress"><progress max={progress.total} value={progress.done} /><span>{progress.done}/{progress.total} candidatos · {progress.found} solução(ões)</span></div>
        )}
        {stale && !busy && <p className="stale">● Dados alterados desde o último cálculo — os resultados abaixo podem estar desatualizados.</p>}
        {!ready && <p className="hint">Falta completar os passos anteriores (sondagem com NA e cargas ELS/ELU). <button className="link" onClick={onBack}>Voltar</button></p>}
        {lockCount > 0 && <p className="hint">🔒 Travado: {fixed.type && PILE_LABEL[fixed.type]} {fixed.diameter && `Ø${fixed.diameter * 100} cm`} {fixed.layoutId && `arranjo ${fixed.layoutId}`} {fixed.length && `L = ${fixed.length} m`}</p>}
        {error && <p className="warn">{error}</p>}
        {result && result.warnings.length > 0 && <ul className="warn">{result.warnings.map((w) => <li key={w}>{unitText(w, u)}</li>)}</ul>}
      </section>

      {result && result.best.length === 0 && !busy && (
        <section className="card empty">
          <h2>Nenhuma solução atende a todas as verificações</h2>
          <p>Confira os motivos e, em geral, tente: aumentar a seção do pilar, permitir diâmetros maiores, aumentar o comprimento máximo ou revisar o limite de deslocamento.</p>
          <details open><summary>Motivos mais frequentes</summary>
            <ul>{[...new Set(result.rejected.map((r) => unitText(r.reason, u).slice(0, 140)))].slice(0, 8).map((m) => <li key={m}>{m}</li>)}</ul>
          </details>
        </section>
      )}

      {result && best && base && armor && suggested && (
        <>
          <section className="solbar card">
            <label className="fld grow"><span>Solução em análise</span>
              <select value={sel} onChange={(e) => setSel(+e.target.value)}>
                {result.best.map((c, i) => <option key={i} value={i}>{i + 1}º · {pileName(c)} · {c.layout.n} estaca(s) · L {nf(c.length)} m · {brl(c.cost.total)}</option>)}
              </select>
            </label>
            <div className="row">
              <button className="primary" onClick={() => download(`pilar-${project.pillar}-fundacao.dxf`, buildDxf(best, { pillar: { ax, ay }, title: `PILAR ${project.pillar}` }), 'application/dxf')}>⬇ Desenho (DXF)</button>
              <button className="primary" title="Abre o memorial e a janela de impressão: escolha 'Salvar como PDF'" onClick={() => {
                const html = buildReport(best, { units: u, pillarId: project.pillar, pillar: { ax, ay }, combos: current, boreholes: holes, settings })
                const w = window.open('', '_blank')
                if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400) }
                else download(`memorial-pilar-${project.pillar}.html`, html, 'text/html;charset=utf-8')
              }}>⬇ Memorial (PDF)</button>
              <button className="primary" onClick={() => download(`memorial-pilar-${project.pillar}.docx`, buildReportDocx(best, { units: u, pillarId: project.pillar, pillar: { ax, ay }, combos: current, boreholes: holes, settings }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}>⬇ Memorial (Word)</button>
            </div>
          </section>

          <div className="tabs2 sections" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
                {k === 'estaca' && armorEdited && <i className={`dot ${designBad ? 'bad' : 'ok'}`} title={designBad ? 'Armadura editada NÃO atende' : 'Armadura editada atende'} />}
                {k === 'bloco' && (blockEdits[id] || asb) && <i className="dot ok" title={asb ? 'Locação ajustada' : 'Bloco editado'} />}
              </button>
            ))}
          </div>

          {tab === 'resumo' && (
            <>
              <h2>Ranking</h2>
              {result.proxyRanking && <p className="hint">Custos zerados: ordenado por volume e massa de aço.</p>}
              <div className="rank-grid">
                {result.best.map((c, i) => (
                  <button key={i} className={`rcard ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)}>
                    <span className="rk">{i + 1}</span>
                    <MiniPlan c={c} />
                    <span className="rinfo">
                      <b>{pileName(c)}</b>
                      <span>{c.layout.n} estaca(s) · L = {nf(c.length, 0)} m</span>
                      <span>{c.design.longitudinal!.n}Ø{nf(c.design.longitudinal!.phiMm, 1)} · bloco {nf(c.blockDesign.geometry.lx * 100)}×{nf(c.blockDesign.geometry.ly * 100)}×{nf(c.blockDesign.geometry.h * 100)}</span>
                    </span>
                    <span className="rcost">{brl(c.cost.total)}</span>
                  </button>
                ))}
              </div>
              {result.best.length > 1 && (() => {
                const ct = compareTable(result.best, u)
                return (
                  <details className="card compare">
                    <summary><b>Comparativo lado a lado</b> ({result.best.length} soluções; menor valor destacado)</summary>
                    <div className="row"><button onClick={() => download(`comparativo-pilar-${project.pillar}.csv`, compareCsv(ct, `Pilar ${project.pillar}`), 'text/csv;charset=utf-8')}>⬇ Exportar CSV (Excel)</button></div>
                    <div className="scroll-x">
                      <table className="cmp">
                        <thead><tr><th />{ct.columns.map((c, i) => <th key={i} className={i === sel ? 'cur' : ''}>{c}</th>)}</tr></thead>
                        <tbody>
                          {ct.rows.map((r, ri) => (
                            <tr key={ri} className={ri > 0 && ct.rows[ri - 1].group !== r.group ? 'grp' : ''}>
                              <td>{r.label}</td>
                              {r.values.map((v, i) => <td key={i} className={r.best === i ? 'best' : ''}>{v}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )
              })()}
              <div className="detail-h">
                <div>
                  <h2>{pileName(best)} · {best.layout.n} estaca(s) · L = {nf(best.length)} m</h2>
                  <p className="hint">{best.layout.label} · espaçamento {nf(best.spacing, 2)} m</p>
                </div>
              </div>
              <div className="kpis2">
                <Kpi label="Custo total" value={brl(best.cost.total)} sub={result.proxyRanking ? 'custos não informados' : armorEdited || blockEdits[id] ? 'do ranking (armadura/bloco editados não recalculam o custo)' : undefined} />
                <Kpi label="Estacas" value={`${best.layout.n} × Ø${nf(best.diameter * 100)}`} sub={`${PILE_LABEL[best.type]} · L ${nf(best.length)} m`} />
                <Kpi label="Armadura da estaca" value={`${best.design.longitudinal!.n}Ø${nf(best.design.longitudinal!.phiMm, 1)}`} sub={`${best.design.transverse!.type === 'estribo' ? 'estribos' : 'helicoidal'} Ø${nf(best.design.transverse!.phiMm, 1)} c/${nf(Math.min(...best.design.transverse!.zones.map((z) => z.spacing)) * 100, 1)}${armorEdited ? (designBad ? ' · EDITADA, não atende' : ' · editada') : ''}`} />
                <Kpi label="Bloco" value={`${nf(best.blockDesign.geometry.lx * 100)}×${nf(best.blockDesign.geometry.ly * 100)} cm`} sub={`h = ${nf(best.blockDesign.geometry.h * 100)} cm`} />
              </div>
              <div className="split">
                <section className="card"><PlanView c={best} ax={ax} ay={ay} big u={u} /></section>
                <div className="stack">
                <section className="card">
                  <h3>Verificações</h3>
                  <UtilBar label="Deslocamento no topo (ELS)" value={best.service.maxHeadDisplacement * 1000} limit={settings.serviceLimitMm} unit="mm" hint="Limite informado pelo usuário" />
                  <UtilBar label="Compressão na estaca (ELS)" value={best.service.maxCompression * u.k} limit={best.service.padm * u.k} unit={u.F} hint="Carga admissível geotécnica" />
                  <UtilBar label="Flexo-compressão da estaca (ELU)" value={best.design.longitudinal!.utilization * 100} limit={100} unit="%" />
                  <UtilBar label="Biela do bloco (pior caso)" value={Math.max(...best.blockDesign.checks.map((k) => k.value / k.limit)) * 100} limit={100} unit="%" />
                  <p className="hint">Verde: folga · amarelo: acima de 85 % · vermelho: acima do limite.</p>
                  <div className="row">
                    <button className="primary-ghost" onClick={() => setTab('estaca')}>Editar armadura da estaca →</button>
                    <button className="primary-ghost" onClick={() => setTab('bloco')}>Ver e ajustar o bloco →</button>
                  </div>
                  <div className="row">
                    <button onClick={() => { const f = { ...fixed, type: base.type, diameter: base.diameter }; setFixed(f); void run(f) }}>🔒 Travar tipo e diâmetro</button>
                    <button onClick={() => { const f = { ...fixed, layoutId: base.layout.id }; setFixed(f); void run(f) }}>🔒 Travar arranjo</button>
                    <button onClick={() => { const f = { ...fixed, length: base.length }; setFixed(f); void run(f) }}>🔒 Travar comprimento</button>
                  </div>
                </section>
                <section className="card">
                  <h3>Utilização geotécnica por estaca</h3>
                  <PileLoadTable c={best} u={u} />
                  <p className="hint">Carga máxima em serviço (ELS) sobre a carga admissível geotécnica P<sub>adm</sub> = {nf(best.service.padm * u.k, u.k === 1 ? 0 : 1)} {u.F} (critério e métodos de capacidade escolhidos em Parâmetros; já desconta o atrito negativo, se considerado). A tabela completa de R<sub>l</sub>, R<sub>p</sub> e R por método está em Análises avançadas.</p>
                </section>
                </div>
              </div>
            </>
          )}

          {tab === 'bloco' && baseRaw && vinBase && (
            <BlockView
              key={id} c={base} original={baseRaw} ax={ax} ay={ay} edit={blockEdit} onEdit={(e) => setBlockEdits({ ...blockEdits, [id]: e })}
              defaultMethod={settings.blockMethod} asBuilt={asb} onApplyLayout={applyLayout}
              onClearLayout={() => { setAsBuilt((m) => { const n = { ...m }; delete n[id]; return n }); setReana((m) => { const n = { ...m }; delete n[id]; return n }) }}
              vin={vinBase} armor={armor} u={u}
            />
          )}

          {tab === 'estaca' && vinBase && (
            <PileDesigner
              c={base} vin={vinBase} armor={armor} suggested={suggested} steelPrice={steelPrice} u={u} blockH={best.blockDesign.geometry.h}
              reanalysis={{ done: !!ra, stale: !!ra && ra.armorKey !== JSON.stringify(armor), enabled: !!lastInput && settings.nonlinearEI, message: reanaMsg, run: reanalyze, discard: () => setReana((m) => { const n = { ...m }; delete n[id]; return n }) }}
              onArmor={(a) => setArmors((m) => ({ ...m, [id]: a }))}
            />
          )}

          {tab === 'analise' && (
            <section className="card">
              <h3>Esforços e deslocamentos ao longo da estaca mais solicitada</h3>
              {(() => {
                const el = base.profiles.elu
                const Nz = el.Nz ?? el.z.map(() => el.N)
                const A = (Math.PI * best.diameter ** 2) / 4
                const W = (Math.PI * best.diameter ** 3) / 32
                const div = settings.structural.noRebarDivisor && settings.structural.noRebarDivisor > 0 ? settings.structural.noRebarDivisor : 1
                const lim = settings.structural.t4?.[best.type]?.noRebarStress ?? table4(best.type, settings.caa)?.noRebarStress
                const sig = Nz.map((n) => n / div / A / 1000) // MPa
                const sigFib = Nz.map((n, i) => (n / A + Math.abs(el.M[i]) / W) / 1000)
                const noLateral = Math.max(0, ...el.M.map(Math.abs), ...el.V.map(Math.abs), ...base.profiles.els.y.map(Math.abs)) < 1e-9
                const marks = [{ z: Math.min(armor.cageLength, base.length), label: `fim da gaiola ${nf(armor.cageLength, 1)} m` }]
                return (
                  <>
                    <DepthColumns
                      height={Math.max(480, Math.min(640, 40 * base.length))}
                      marks={marks}
                      panels={[
                        { title: 'Normal Nd (ELU)', unit: u.F, z: el.z, v: Nz.map((q) => q * u.k), color: '#e9a23b' },
                        { title: `Tensão N/A (${div === 1 ? 'Nd' : 'Nd/' + String(div).replace('.', ',')})`, unit: 'MPa', z: el.z, v: sig, color: '#8a6bd0', limit: lim !== undefined ? { v: lim, label: `limite Tab. 4: ${nf(lim, 1)} MPa` } : undefined },
                        { title: 'Tensão máx. na fibra N/A + M/W (ELU)', unit: 'MPa', z: el.z, v: sigFib, color: '#c2693a' },
                      ]}
                    />
                    {noLateral ? (
                      <p className="hint">Sem forças horizontais nem momentos nas combinações: cortante, momento fletor e deslocamento são nulos ao longo da estaca. Informe Fx, Fy, Mx e My para ver os gráficos laterais.</p>
                    ) : (
                    <DepthColumns
                      height={Math.max(480, Math.min(640, 40 * base.length))}
                      marks={marks}
                      panels={[
                        { title: 'Cortante Vd (ELU)', unit: u.F, z: el.z, v: el.V.map((q) => q * u.k), color: '#2a9d8f' },
                        { title: 'Momento Md (ELU)', unit: u.M, z: el.z, v: el.M.map((q) => q * u.k), color: '#d1495b' },
                        { title: 'Deslocamento (ELS)', unit: 'mm', z: base.profiles.els.z, v: base.profiles.els.y.map((q) => q * 1000), color: '#1f6feb' },
                      ]}
                    />
                    )}
                  </>
                )
              })()}
              <p className="hint">Estaca {base.profiles.elu.pile}, combinação ELU “{base.profiles.elu.combo}”; deslocamento em “{base.profiles.els.combo}”. {settings.negFriction.on ? 'O esforço normal cresce com o atrito negativo até o ponto neutro (P + γf·Qn) e depois diminui pelo atrito positivo' + (settings.axialTransfer === 'constante' ? ' (opção "constante": mantido no valor máximo abaixo do ponto neutro)' : '') + '.' : settings.axialTransfer === 'atrito' ? 'O esforço normal diminui com a profundidade pelo atrito lateral mobilizado (mobilização proporcional do atrito e da ponta; vale o maior normal entre métodos e furos).' : 'O esforço normal é tomado constante ao longo do fuste (carga do topo), a favor da segurança.'} O mesmo perfil N(z) entra no P-Δ da análise lateral e na carga crítica de flambagem. A NBR 6122:2022 (8.6.3, Tab. 4) exige armadura onde a tensão N/A supera o limite da tabela{base.profiles.elu.Nz ? '; a gaiola foi estendida até onde isso ocorre.' : '.'}</p>
              <ul className="facts">
                <li><b>Maior momento:</b> {nf(base.maxMomentELU.value * u.k, u.k === 1 ? 1 : 2)} {u.M} a {nf(base.maxMomentELU.z, 2)} m do topo · <b>cortante máx.:</b> {nf(best.design.shear!.VSdMax * u.k, u.k === 1 ? 1 : 2)} {u.F} · <b>deslocamento no topo (ELS):</b> {nf(base.service.maxHeadDisplacement * 1000, 1)} mm (limite {nf(settings.serviceLimitMm)} mm).</li>
              </ul>
            </section>
          )}

          {tab === 'custos' && (
            <div className="split">
              <section className="card"><h3>Custo por item</h3><CostBars cost={base.cost} />
                {(armorEdited || blockEdits[id]) && <p className="hint">Custos referentes à armadura e ao bloco automáticos. Para a armadura editada, veja a variação de aço na seção “Estaca e armadura”.</p>}
              </section>
              <section className="card">
                <h3>Quantitativos</h3>
                <div className="kpis2 two">
                  <Kpi label="Concreto das estacas" value={`${nf(best.quantities.pileConcreteM3, 2)} m³`} />
                  <Kpi label="Aço das estacas" value={`${nf(best.design.weights!.totalKg * best.layout.n)} kg`} />
                  <Kpi label="Metros de estaca" value={`${nf(best.quantities.totalPileLength)} m`} />
                  <Kpi label="Concreto do bloco" value={`${nf(best.blockDesign.quantities.concreteM3, 2)} m³`} />
                  <Kpi label="Forma do bloco" value={`${nf(best.blockDesign.quantities.formM2, 1)} m²`} />
                  <Kpi label="Aço do bloco" value={`${nf(best.blockDesign.quantities.steelKg)} kg`} />
                </div>
              </section>
            </div>
          )}

          {tab === 'avisos' && (
            <>
              <section className="card">
                <h3>Avisos e premissas desta solução</h3>
                {best.warnings.map((w) => <div key={w} className="note">{unitText(w, u)}</div>)}
              </section>
              <section className="card">
                <h3>Candidatos descartados ({result.rejected.length})</h3>
                <table>
                  <thead><tr><th>Estaca</th><th>Arranjo</th><th>Motivo</th></tr></thead>
                  <tbody>{result.rejected.slice(0, 60).map((r, i) => <tr key={i}><td>{PILE_LABEL[r.type]} Ø{nf(r.diameter * 100)}</td><td>{r.layoutId}</td><td className="wrap">{unitText(r.reason, u)}</td></tr>)}</tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </>
  )
}
