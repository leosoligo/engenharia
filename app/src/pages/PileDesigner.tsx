import { useMemo, useState } from 'react'
import type { Candidate } from '../core/optimize'
import { LONG_BARS_MM, TRANS_BARS_MM, type TransverseType } from '../core/structural/design'
import { verifyPile, type Check, type PileArmor, type VerifyInput } from '../core/structural/verify'
import { Field, num } from '../ui/fields'
import { CapacityDepthChart, InteractionDiagram, PileDrawingXL } from '../ui/xcharts'
import { KN, type Units } from '../ui/units'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')
const brl = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

interface Props {
  c: Candidate
  /** Dados de verificação (tipo, D, L, CAA e parâmetros estruturais do projeto), sem os esforços. */
  vin: Omit<VerifyInput, 'demands'>
  armor: PileArmor
  suggested: PileArmor
  onArmor: (a: PileArmor) => void
  steelPrice: number
  u?: Units
  /** Altura do bloco (m), para conferir a ancoragem. */
  blockH: number
  reanalysis: { done: boolean; stale: boolean; enabled: boolean; message: string; run: () => void; discard: () => void }
}

const GROUPS: [Check['group'], string][] = [['normal', 'Esforço normal'], ['flexao', 'Flexão composta'], ['cortante', 'Cortante e armadura transversal'], ['detalhamento', 'Detalhamento (NBR 6118 / 6122)']]

export default function PileDesigner({ c, vin, armor, suggested, onArmor, steelPrice, blockH, reanalysis, u = KN }: Props) {
  const [set, setSet] = useState(-1) // -1 = envoltória
  const v = useMemo(
    () => verifyPile({ ...vin, demands: c.demands.sets }, armor),
    [c, vin, armor],
  )
  const edited = JSON.stringify(armor) !== JSON.stringify(suggested)
  const patch = (p: Partial<PileArmor>) => onArmor({ ...armor, ...p })
  const failing = v.checks.filter((k) => !k.ok && k.severity === 'error')
  const warns = v.checks.filter((k) => !k.ok && k.severity === 'warn')
  const vSug = useMemo(() => verifyPile({ ...vin, demands: c.demands.sets }, suggested), [c, vin, suggested])
  const sugKg = vSug.weights.totalKg
  const [mult, setMult] = useState(0.5)
  const dKg = (v.weights.totalKg - sugKg) * c.layout.n
  const rows = useMemo(() => {
    if (set >= 0) return v.perSet[set]
    return (v.perSet[0] ?? []).map((_, i) => v.perSet.reduce((w, s) => (s[i].FS < w.FS ? s[i] : w), v.perSet[0][i]))
  }, [v, set])
  const mrdDeep = v.required.cageLength
  const kf = (unit: string) => (unit === 'kN' || unit === 'kN·m' ? u.k : 1)

  return (
    <div className="designer">
      <section className={`status ${v.ok ? 'ok' : 'bad'}`} role="status">
        <b>{v.ok ? '✔ A armadura ATENDE a todas as verificações' : `✖ A armadura NÃO ATENDE (${failing.length} verificação${failing.length > 1 ? 'ões' : ''})`}</b>
        <span>
          {v.ok
            ? `FS mínimo à flexão = ${nf(v.critical.FS, 2)} · ${nf(v.weights.totalKg, 1)} kg de aço por estaca`
            : failing.slice(0, 3).map((k) => k.name.split(':')[0]).join(' · ')}
        </span>
        {warns.length > 0 && <small>{warns.length} recomendação(ões) prática(s) fora do ideal.</small>}
      </section>

      <div className="designer-grid">
        <section className="card ctrl">
          <h3>Armadura da estaca</h3>
          <p className="hint">Altere qualquer valor: a verificação é refeita na hora com os esforços de cálculo da análise (todas as combinações e estacas).</p>
          <div className="ctrl-grp">
            <h4>Longitudinal</h4>
            <div className="row tight">
              <Field label="Nº de barras"><input type="number" min={6} max={40} step={1} value={armor.n} onChange={(e) => patch({ n: Math.max(1, Math.round(num(e.target.value, armor.n))) })} /></Field>
              <Field label="Bitola (mm)">
                <select value={armor.phiMm} onChange={(e) => patch({ phiMm: +e.target.value })}>
                  {LONG_BARS_MM.map((b) => <option key={b} value={b}>Ø{b}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className="ctrl-grp">
            <h4>Transversal</h4>
            <div className="seg" role="tablist">
              {(['estribo', 'helicoidal'] as TransverseType[]).map((t) => <button key={t} className={armor.transverse === t ? 'on' : ''} onClick={() => patch({ transverse: t })}>{t === 'estribo' ? 'Estribos' : 'Helicoidal'}</button>)}
            </div>
            <div className="row tight">
              <Field label="Bitola (mm)">
                <select value={armor.phitMm} onChange={(e) => patch({ phitMm: +e.target.value })}>
                  {TRANS_BARS_MM.map((b) => <option key={b} value={b}>Ø{b}</option>)}
                </select>
              </Field>
              <Field label={armor.transverse === 'estribo' ? 'Espaçamento (cm)' : 'Passo (cm)'} hint={`exigido ≤ ${nf(v.shear.sReqMin * 100, 1)} cm`}>
                <input type="number" min={2} step={0.5} value={+(armor.spacing * 100).toFixed(2)} onChange={(e) => patch({ spacing: Math.max(num(e.target.value, armor.spacing * 100), 1) / 100 })} />
              </Field>
            </div>
          </div>
          <div className="ctrl-grp">
            <h4>Gaiola</h4>
            <div className="row tight">
              <Field label="Comprimento (m)" hint={`necessário ≥ ${nf(v.required.cageLength, 2)} m`}>
                <input type="number" min={0.5} max={c.length} step={0.5} value={+armor.cageLength.toFixed(2)} onChange={(e) => patch({ cageLength: Math.max(0.1, num(e.target.value, armor.cageLength)) })} />
              </Field>
              <Field label="Múltiplo de"><select value={mult} onChange={(e) => setMult(+e.target.value)}><option value={0.5}>0,5 m</option><option value={1}>1,0 m</option><option value={0.1}>0,1 m</option></select></Field>
              <button onClick={() => patch({ cageLength: Math.min(c.length, Math.ceil(v.required.cageLength / mult - 1e-9) * mult) })} title="Arredonda o comprimento necessário para o múltiplo escolhido">Usar o necessário</button>
              <button onClick={() => patch({ cageLength: c.length })}>Estaca inteira</button>
            </div>
          </div>
          <div className="ctrl-grp">
            <h4>Ancoragem no bloco</h4>
            <label className="inline"><input type="checkbox" checked={armor.anchorage > 0} onChange={(e) => patch({ anchorage: e.target.checked ? Math.ceil(v.required.lbNec * 20 - 1e-9) / 20 : 0 })} /> Ancorar a armadura no topo do bloco (prolongar as barras)</label>
            {armor.anchorage > 0 && (
              <Field label="Comprimento acima do topo (cm)" hint={`necessário ≥ ${nf(v.required.lbNec * 100)} cm${armor.anchorage > blockH - v.cover ? ' · ATENÇÃO: maior que h − cobrimento do bloco; exige gancho/dobra' : ''}`}>
                <input type="number" min={5} step={5} value={+(armor.anchorage * 100).toFixed(1)} onChange={(e) => patch({ anchorage: Math.max(num(e.target.value, armor.anchorage * 100), 1) / 100 })} />
              </Field>
            )}
          </div>
          <div className="row">
            <button className={edited ? 'primary-ghost' : ''} onClick={() => onArmor(suggested)} disabled={!edited}>↺ Voltar à armadura sugerida</button>
          </div>
          <p className="hint">
            Sugerida pelo software: {suggested.n}Ø{nf(suggested.phiMm, 1)}, {suggested.transverse === 'estribo' ? 'estribos' : 'helicoidal'} Ø{nf(suggested.phitMm, 1)} c/{nf(suggested.spacing * 100, 1)} cm, gaiola {nf(suggested.cageLength, 2)} m (menor massa de aço que atende).
            {edited && <> Variação do aço: <b>{dKg >= 0 ? '+' : ''}{nf(dKg, 1)} kg</b> no conjunto ({c.layout.n} estacas){steelPrice > 0 && <> ≈ <b>{dKg >= 0 ? '+' : '−'}{brl(Math.abs(dKg) * steelPrice)}</b> só no aço da estaca</>}.</>}
          </p>
          <div className="reana">
            <b>Esforços da análise</b>
            <p className="hint">{reanalysis.done ? (reanalysis.stale ? '⚠ Reanálise feita com outra armadura: refaça para esta.' : '✔ Esforços recalculados com a rigidez EI(M) da sua armadura.') : 'Os esforços vêm da análise feita com a armadura sugerida (rigidez EI(M) dela).'}</p>
            <div className="row tight">
              <button className="primary-ghost" onClick={reanalysis.run} disabled={!reanalysis.enabled} title={reanalysis.enabled ? '' : 'Requer o EI não linear ativo e um cálculo feito nesta sessão'}>⟳ Reanalisar com esta armadura</button>
              {reanalysis.done && <button onClick={reanalysis.discard}>Voltar aos esforços originais</button>}
            </div>
            {reanalysis.message && <p className="bad-t">{reanalysis.message}</p>}
          </div>
        </section>

        <section className="card draw">
          <PileDrawingXL D={c.diameter} L={c.length} cover={v.cover} armor={armor} Rs={v.Rs} />
          <table className="mini-t">
            <thead><tr><th colSpan={3}>Longitudinal</th><th colSpan={4}>Transversal</th></tr><tr><th>Ø (mm)</th><th>Quant.</th><th>Comp. (m)</th><th>Ø (mm)</th><th>Tipo</th><th>Passo (cm)</th><th>Aço total</th></tr></thead>
            <tbody><tr><td>{nf(armor.phiMm, 1)}</td><td>{armor.n}</td><td>{nf(Math.min(armor.cageLength, c.length) + armor.anchorage, 2)}</td><td>{nf(armor.phitMm, 1)}</td><td>{armor.transverse === 'estribo' ? 'estribo' : 'helicoidal'}</td><td>{nf(armor.spacing * 100, 1)}</td><td>{nf(v.weights.totalKg, 1)} kg</td></tr></tbody>
          </table>
          <p className="hint">ρ = {nf(v.rho * 100, 2)} % · As = {nf(v.As * 1e4, 2)} cm² · fck {v.fck} MPa (γc {nf(v.gammaC, 1)}) · cobrimento {nf(v.cover * 1000)} mm · concreto da estaca {nf((Math.PI * c.diameter ** 2 / 4) * c.length, 2)} m³ · {nf(v.weights.kgPerM3)} kg/m³</p>
        </section>
      </div>

      <section className="card">
        <h3>Verificações</h3>
        <div className="chk-list">
          {GROUPS.map(([g, title]) => (
            <div key={g} className="chk-grp">
              <h4>{title}</h4>
              {v.checks.filter((k) => k.group === g).map((k) => {
                const ratio = k.kind === 'max' ? (k.limit > 0 ? k.value / k.limit : 0) : (k.value > 0 ? k.limit / k.value : Infinity)
                return (
                  <div key={k.id} className={`chk ${k.ok ? 'ok' : k.severity === 'warn' ? 'warn' : 'bad'}`} title={k.ref}>
                    <span className="mark">{k.ok ? '✔' : k.severity === 'warn' ? '!' : '✖'}</span>
                    <span className="nm">{k.name}</span>
                    <b>{nf(k.value * kf(k.unit), k.value * kf(k.unit) < 10 ? 2 : 1)} {k.kind === 'max' ? '≤' : '≥'} {nf(k.limit * kf(k.unit), k.limit * kf(k.unit) < 10 ? 2 : 1)} {k.unit === 'kN' ? u.F : k.unit === 'kN·m' ? u.M : k.unit}</b>
                    {Number.isFinite(ratio) && <i className="meter"><s style={{ width: `${Math.min(ratio, 1.2) * 83}%` }} /></i>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="hint">Passe o mouse numa verificação para ver a referência normativa. Verificação do cortante: Vd crítico = {nf(v.shear.Vd * u.k, 1)} {u.F}, VRd2 = {nf(v.shear.VRd2 * u.k)} {u.F}, Asw necessário {nf(v.shear.AswCalc, 2)} cm²/m × efetivo {nf(v.shear.AswEf, 2)} cm²/m.</p>
      </section>

      <section className="card">
        <div className="row between">
          <h3>Flexão composta ao longo da estaca</h3>
          <Field label="Estaca / combinação">
            <select value={set} onChange={(e) => setSet(+e.target.value)}>
              <option value={-1}>Envoltória (pior caso em cada profundidade)</option>
              {c.demands.labels.map((l, i) => <option key={i} value={i}>{l.pile} · {l.combo}</option>)}
            </select>
          </Field>
        </div>
        <div className="xl-grid">
          <div><InteractionDiagram v={v} set={set} reference={edited ? vSug : undefined} u={u} /></div>
          <div><CapacityDepthChart v={v} set={set} cage={Math.min(armor.cageLength, c.length)} L={c.length} u={u} /></div>
        </div>
        <div className="crit">
          <b>Situação crítica:</b> Nd = {nf(v.critical.N * u.k, 1)} {u.F} · Md = {nf(Math.abs(v.critical.M) * u.k, u.k === 1 ? 1 : 2)} {u.M} · MRd = {nf(v.critical.MRd * u.k, u.k === 1 ? 1 : 2)} {u.M} · FS = {nf(v.critical.FS, 2)}
          {' '}({c.demands.labels[v.critical.set]?.pile}, “{c.demands.labels[v.critical.set]?.combo}” a {nf(v.perSet[v.critical.set]?.[v.critical.node]?.z ?? 0, 2)} m do topo)
        </div>
        <div className="scroll-x tall">
          <table className="depth-t">
            <thead><tr><th>Prof. (m)</th><th>Nd ({u.F})</th><th>Md ({u.M})</th><th>MRd ({u.M})</th><th>FS</th><th>Vd ({u.F})</th><th>s máx. exigido (cm)</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const beyond = r.z > armor.cageLength + 1e-9
                const cls = beyond ? 'dim' : r.FS < 1 ? 'bad' : r.FS < 1.15 ? 'warn' : ''
                return (
                  <tr key={i} className={cls}>
                    <td>{nf(r.z, 2)}{beyond ? ' (sem gaiola)' : ''}</td><td>{nf(r.N * u.k, 1)}</td><td>{nf(r.M * u.k, u.k === 1 ? 1 : 2)}</td><td>{nf(r.MRd * u.k, u.k === 1 ? 1 : 2)}</td>
                    <td>{Number.isFinite(r.FS) ? nf(r.FS, 2) : '∞'}</td><td>{nf(r.V * u.k, u.k === 1 ? 1 : 2)}</td><td>{Number.isFinite(r.sReq) ? nf(r.sReq * 100, 1) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">FS = MRd/|Md| na mesma profundidade (≥ 1 atende). Linhas abaixo do fim da gaiola não têm armadura longitudinal; o comprimento mínimo exige que o momento ali seja pequeno ({nf(mrdDeep, 2)} m necessários).</p>
      </section>
    </div>
  )
}
