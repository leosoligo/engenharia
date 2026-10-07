import { useMemo, useState } from 'react'
import { BLOCK_METHOD_LABEL, BLOCK_SHAPE_LABEL, blockGeometry, designBlock, type BlockMethod, type BlockResult, type BlockShape } from '../core/block'
import type { AsBuilt, Candidate } from '../core/optimize'
import { verifyPile, type PileArmor, type VerifyInput } from '../core/structural/verify'
import { Field, num } from '../ui/fields'
import { BlockSection, PlanView, UtilBar } from '../ui/charts'
import { StrutTieElevation, StrutTiePlan } from '../ui/xcharts'
import { KN, type Units } from '../ui/units'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

export interface BlockEdit { hCm?: number; fck?: number; lxCm?: number; lyCm?: number; method?: BlockMethod; shape?: BlockShape }

interface Props {
  /** Candidato efetivo (com a locação ajustada, se houver). */
  c: Candidate
  /** Candidato do otimizador (locação de projeto). */
  original: Candidate
  ax: number
  ay: number
  edit: BlockEdit
  onEdit: (e: BlockEdit) => void
  /** Método padrão das configurações. */
  defaultMethod: BlockMethod
  asBuilt?: AsBuilt
  onApplyLayout: (points: { x: number; y: number }[]) => string | undefined
  onClearLayout: () => void
  vin: Omit<VerifyInput, 'demands'>
  armor: PileArmor
  u?: Units
}

/** Redimensiona o bloco com altura, dimensões, fck e método do usuário (ou o automático). */
export function blockFromEdit(c: Candidate, e: BlockEdit): BlockResult {
  if (Object.values(e).every((v) => v === undefined)) return c.blockDesign
  return designBlock({
    ...c.blockInput, hFixed: e.hCm !== undefined ? e.hCm / 100 : undefined, lx: e.lxCm !== undefined ? e.lxCm / 100 : undefined, ly: e.lyCm !== undefined ? e.lyCm / 100 : undefined,
    fckBlock: e.fck ?? c.blockInput.fckBlock, method: e.method ?? c.blockInput.method, shape: e.shape ?? c.blockInput.shape,
  })
}

export default function BlockView({ c, original, ax, ay, edit, onEdit, defaultMethod, asBuilt, onApplyLayout, onClearLayout, vin, armor, u = KN }: Props) {
  const [pile, setPile] = useState(0)
  const [draft, setDraft] = useState(() => c.layout.points.map((p) => ({ x: +(p.x * 100).toFixed(1), y: +(p.y * 100).toFixed(1) })))
  const [layoutMsg, setLayoutMsg] = useState('')
  const bi = c.blockInput
  const g0 = useMemo(() => blockGeometry(bi.piles, bi.dE, bi.pillar, { pillarArea: bi.pillarArea, edgeMargin: bi.edgeMargin, edgeClear: bi.edgeClear, caa: bi.caa, hMin: bi.hMin, d1Factor: bi.d1Factor, shape: edit.shape ?? bi.shape }), [bi])
  const hMin = g0.dMin + g0.cTot
  const hMax = g0.dMax + g0.cTot
  const bd = useMemo(() => blockFromEdit(c, edit), [c, edit])
  const shown: Candidate = bd.feasible ? { ...c, blockDesign: bd } : c
  const g = shown.blockDesign.geometry
  const edited = Object.values(edit).some((v) => v !== undefined)
  const worst = Math.max(...shown.blockDesign.checks.map((k) => k.value / k.limit))
  const pIdx = Math.min(pile, Math.max(shown.blockDesign.Rs.length - 1, 0))
  const method = edit.method ?? defaultMethod
  const orig = original.layout.points
  const moved = draft.some((p, i) => Math.abs(p.x - orig[i].x * 100) > 0.05 || Math.abs(p.y - orig[i].y * 100) > 0.05)
  const draftDiffersFromApplied = draft.some((p, i) => Math.abs(p.x - c.layout.points[i].x * 100) > 0.05 || Math.abs(p.y - c.layout.points[i].y * 100) > 0.05)

  // comparação projeto × locação ajustada
  const cmp = useMemo(() => {
    if (!asBuilt) return undefined
    const vDes = verifyPile({ ...vin, demands: original.demands.sets }, armor)
    const vAsb = verifyPile({ ...vin, demands: asBuilt.demands.sets }, armor)
    const util = (b: BlockResult) => Math.max(...b.checks.map((k) => k.value / k.limit))
    return { vDes, vAsb, uDes: util(original.blockDesign), uAsb: util(asBuilt.blockDesign) }
  }, [asBuilt, original, vin, armor])

  const apply = () => {
    const pts = draft.map((p, i) => ({ ...orig[i], x: p.x / 100, y: p.y / 100 }))
    setLayoutMsg(onApplyLayout(pts) ?? '')
  }

  return (
    <div className="designer">
      <section className={`status ${!bd.feasible ? 'bad' : worst <= 1 ? 'ok' : 'bad'}`} role="status">
        <b>{!bd.feasible ? '✖ Bloco NÃO atende com estes dados' : '✔ Bloco atende às bielas, tirantes e cortante'}</b>
        <span>{!bd.feasible ? bd.reasons[0] : `h = ${nf(g.h * 100)} cm · d = ${nf(g.d * 100)} cm · ${nf(g.lx * 100)} × ${nf(g.ly * 100)} cm · fck ${g.fck} MPa · utilização máxima ${nf(worst * 100)} %`}</span>
        {asBuilt && <small>Locação ajustada em uso (estacas fora da posição de projeto).</small>}
      </section>

      <section className="card">
        <h3>Parâmetros do bloco</h3>
        <div className="row">
          <Field label="Método de dimensionamento das armaduras">
            <select value={method} onChange={(e) => onEdit({ ...edit, method: e.target.value as BlockMethod })}>
              {(Object.keys(BLOCK_METHOD_LABEL) as BlockMethod[]).map((m) => <option key={m} value={m}>{BLOCK_METHOD_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Formato em planta">
            <select value={edit.shape ?? c.blockInput.shape ?? 'retangular'} onChange={(e) => onEdit({ ...edit, shape: e.target.value as BlockShape, lxCm: undefined, lyCm: undefined })}>
              {(Object.keys(BLOCK_SHAPE_LABEL) as BlockShape[]).map((m) => <option key={m} value={m}>{BLOCK_SHAPE_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Altura hb (cm)" hint={`bielas 45°–55°: ${nf(hMin * 100)} a ${nf(hMax * 100)} cm`}>
            <input type="number" min={30} step={5} value={edit.hCm ?? Math.round(c.blockDesign.geometry.h * 100)} onChange={(e) => onEdit({ ...edit, hCm: num(e.target.value, c.blockDesign.geometry.h * 100) })} />
          </Field>
          <Field label="Largura em planta, direção X (cm)" hint={`mínimo ${nf(g0.minLx * 100)} · automático ${nf(g0.lxAuto * 100)}`}>
            <input type="number" min={20} step={5} value={edit.lxCm ?? Math.round(c.blockDesign.geometry.lx * 100)} onChange={(e) => onEdit({ ...edit, lxCm: num(e.target.value, c.blockDesign.geometry.lx * 100) })} />
          </Field>
          <Field label="Comprimento em planta, direção Y (cm)" hint={`mínimo ${nf(g0.minLy * 100)} · automático ${nf(g0.lyAuto * 100)}`}>
            <input type="number" min={20} step={5} value={edit.lyCm ?? Math.round(c.blockDesign.geometry.ly * 100)} onChange={(e) => onEdit({ ...edit, lyCm: num(e.target.value, c.blockDesign.geometry.ly * 100) })} />
          </Field>
          <Field label="fck do bloco (MPa)">
            <select value={edit.fck ?? c.blockInput.fckBlock} onChange={(e) => onEdit({ ...edit, fck: +e.target.value })}>
              {[20, 25, 30, 35, 40, 45, 50].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <button disabled={!edited} onClick={() => onEdit({})}>↺ Tudo automático</button>
        </div>
        <p className="hint">O bloco fica centrado nas estacas. A distância recomendada do eixo da estaca à borda é dE + 15 cm; o mínimo aceito é dE/2 + 5 cm. {edited && !bd.feasible && 'Os valores informados não atendem — os desenhos mostram o último bloco válido.'} O custo do ranking usa o bloco automático.</p>
        {shown.blockDesign.methodKg && (
          <p className="hint">Massa de tirantes por método (kg): Blévot e Frémy <b>{nf(shown.blockDesign.methodKg.blevot ?? NaN, 1)}</b> · Machado/Bastos <b>{nf(shown.blockDesign.methodKg.machado ?? NaN, 1)}</b> · CEB-70 (flexão) <b>{nf(shown.blockDesign.methodKg.flexao ?? NaN, 1)}</b> → armadura adotada pelo método <b>{shown.blockDesign.method === 'flexao' ? 'do CEB-70 (flexão)' : shown.blockDesign.method === 'machado' ? 'de Machado/Bastos' : 'de Blévot e Frémy'}</b>.</p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h3>Locação das estacas (verificação de erro de execução)</h3>
          <div className="row">
            <button className="primary-ghost" onClick={apply} disabled={!moved && !asBuilt}>⟳ Reverificar com esta locação</button>
            <button onClick={() => { setDraft(orig.map((p) => ({ x: +(p.x * 100).toFixed(1), y: +(p.y * 100).toFixed(1) }))); setLayoutMsg(''); onClearLayout() }} disabled={!asBuilt && !moved}>↺ Voltar à locação de projeto</button>
          </div>
        </div>
        <p className="hint">Coordenadas em cm em relação ao eixo do pilar (X para a direita, Y para cima). Informe as posições <b>executadas</b>: o programa refaz o grupo (reações, deslocamentos, esforços nas estacas), o bloco e a flexão das estacas com a mesma armadura e o mesmo comprimento, e compara com o projeto.</p>
        <div className="scroll-x">
          <table className="mini-t">
            <thead><tr><th>Estaca</th><th>X projeto</th><th>Y projeto</th><th>X executado</th><th>Y executado</th><th>Desvio ΔX</th><th>Desvio ΔY</th><th>|Δ|</th></tr></thead>
            <tbody>
              {draft.map((p, i) => {
                const dx = p.x - orig[i].x * 100, dy = p.y - orig[i].y * 100
                return (
                  <tr key={i}>
                    <td>E{i + 1}</td><td>{nf(orig[i].x * 100, 1)}</td><td>{nf(orig[i].y * 100, 1)}</td>
                    <td><input className={Math.abs(dx) > 0.05 ? 'edited' : ''} type="number" step={0.5} value={p.x} onChange={(e) => setDraft(draft.map((q, k) => (k === i ? { ...q, x: num(e.target.value, q.x) } : q)))} /></td>
                    <td><input className={Math.abs(dy) > 0.05 ? 'edited' : ''} type="number" step={0.5} value={p.y} onChange={(e) => setDraft(draft.map((q, k) => (k === i ? { ...q, y: num(e.target.value, q.y) } : q)))} /></td>
                    <td>{nf(dx, 1)}</td><td>{nf(dy, 1)}</td><td>{nf(Math.hypot(dx, dy), 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {layoutMsg && <p className="bad-t">{layoutMsg}</p>}
        {asBuilt && draftDiffersFromApplied && <p className="stale">● As coordenadas digitadas diferem das reverificadas: clique em “Reverificar”.</p>}
        {asBuilt && cmp && (
          <div className="cmp">
            <h4>Projeto × locação executada</h4>
            <table className="mini-t">
              <thead><tr><th>Verificação</th><th>Projeto</th><th>Executado</th><th>Limite</th><th>Situação</th></tr></thead>
              <tbody>
                {[
                  ['Deslocamento no topo (ELS), mm', original.service.maxHeadDisplacement * 1000, asBuilt.service.maxHeadDisplacement * 1000, asBuilt.limits.head * 1000, asBuilt.service.maxHeadDisplacement <= asBuilt.limits.head],
                  [`Compressão máxima por estaca (ELS), ${u.F}`, original.service.maxCompression * u.k, asBuilt.service.maxCompression * u.k, asBuilt.limits.padm * u.k, asBuilt.service.maxCompression <= asBuilt.limits.padm],
                  [`Esforço axial mínimo (tração), ${u.F}`, original.service.minAxial * u.k, asBuilt.service.minAxial * u.k, asBuilt.limits.tension ? -asBuilt.limits.tension * u.k : 0, asBuilt.service.minAxial >= -asBuilt.limits.tension - 1e-6],
                  ['Fator de segurança à flexão da estaca (mín.)', cmp.vDes.critical.FS, cmp.vAsb.critical.FS, 1, cmp.vAsb.ok],
                  ['Utilização máxima das bielas do bloco, %', cmp.uDes * 100, cmp.uAsb * 100, 100, asBuilt.blockDesign.feasible && cmp.uAsb <= 1],
                ].map(([name, a, b, lim, ok]) => (
                  <tr key={String(name)} className={ok ? '' : 'bad'}><td style={{ textAlign: 'left' }}>{name as string}</td><td>{nf(a as number, 1)}</td><td>{nf(b as number, 1)}</td><td>{nf(lim as number, 1)}</td><td>{ok ? '✔ atende' : '✖ NÃO atende'}</td></tr>
                ))}
              </tbody>
            </table>
            {!asBuilt.converged && <p className="bad-t">A análise não linear em ELU não convergiu com esta locação.</p>}
            {asBuilt.unstable && <p className="bad-t">Instabilidade: {asBuilt.unstable}.</p>}
            {!asBuilt.blockDesign.feasible && <p className="bad-t">Bloco: {asBuilt.blockDesign.reasons[0]}</p>}
            {cmp.vAsb.checks.filter((k) => !k.ok && k.severity === 'error').map((k) => <p key={k.id} className="bad-t">Estaca: {k.name}</p>)}
            <p className="hint">{asBuilt.notes.join(' ')} Os desenhos e o memorial passam a usar a locação executada.</p>
          </div>
        )}
      </section>

      <div className="xl-grid">
        <section className="card"><PlanView c={shown} ax={ax} ay={ay} big u={u} /></section>
        <section className="card"><BlockSection c={shown} ax={ax} /></section>
      </div>

      <div className="xl-grid">
        <section className="card"><StrutTiePlan c={shown} ax={ax} ay={ay} u={u} /></section>
        <section className="card">
          {shown.blockDesign.Rs.length > 0 && (
            <>
              <div className="row between"><h3>Modelo de bielas e tirantes</h3>
                <Field label="Estaca"><select value={pIdx} onChange={(e) => setPile(+e.target.value)}>{shown.layout.points.map((_, i) => <option key={i} value={i}>E{i + 1}</option>)}</select></Field>
              </div>
              <StrutTieElevation c={shown} pile={pIdx} u={u} />
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h3>Armaduras do bloco</h3>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Elemento</th><th>As necessária</th><th>Adotada</th><th>Comprimento de cada barra</th></tr></thead>
            <tbody>{shown.blockDesign.bars.map((b, i) => <tr key={i}><td>{b.label}</td><td>{nf(b.AsReq, 2)} cm²</td><td><b>{b.n}Ø{nf(b.phiMm, 1)}</b> ({nf(b.AsEff, 2)} cm²)</td><td>{nf(b.length, 2)} m</td></tr>)}</tbody>
          </table>
        </div>
        <ul>{shown.blockDesign.secondary.map((x, i) => <li key={i}>{x.description}</li>)}</ul>
        <p className="hint">Bielas a {nf(Math.min(...shown.blockDesign.theta), 0)}°–{nf(Math.max(...shown.blockDesign.theta), 0)}° · aço total do bloco {nf(shown.blockDesign.quantities.steelKg)} kg · concreto {nf(shown.blockDesign.quantities.concreteM3, 2)} m³ · forma {nf(shown.blockDesign.quantities.formM2, 1)} m².</p>
      </section>

      <section className="card">
        <h3>Tensões nas bielas e cortante</h3>
        <div className="util-grid">
          {shown.blockDesign.checks.map((k, i) => <UtilBar key={i} label={k.name} value={k.unit === 'kN' ? k.value : k.value / 1000} limit={k.unit === 'kN' ? k.limit : k.limit / 1000} unit={k.unit === 'kN' ? 'kN' : 'MPa'} />)}
        </div>
        {shown.blockDesign.crack && shown.blockDesign.crack.length > 0 && (
          <>
            <h3>Fissuração dos tirantes no ELS (NBR 6118:2026, 17.3.3.2)</h3>
            <div className="util-grid">
              {shown.blockDesign.crack.map((k, i) => <UtilBar key={i} label={`${k.name} (σs = ${nf(k.sigma, 0)} MPa)`} value={k.wk} limit={k.limit} unit="mm" digits={2} />)}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
