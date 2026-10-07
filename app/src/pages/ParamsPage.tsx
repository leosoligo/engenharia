import { useMemo, useState } from 'react'
import { PILE_LABEL, type PileType } from '../core/pile'
import { SOIL_LABEL, type SptBorehole } from '../core/soil'
import { MODEL_LABEL, MissingWaterLevelError, buildLateralProfile, type LateralModel, type LayerOverride } from '../core/lateral'
import { COVER_SOIL, table4 } from '../core/structural/design'
import { BLOCK_METHOD_LABEL, BLOCK_SHAPE_LABEL, type BlockMethod, type BlockShape } from '../core/block'
import ParamsEditor from '../ParamsEditor'
import { Field, num } from '../ui/fields'
import { NEG_BETA } from '../core/special/negfriction'
import { RAFT_DEPTH_LABEL, type RaftDepth } from '../core/special/settlement'
import { DEFAULT_SETTINGS, OPTIMIZABLE_TYPES, lateralOptions, type Settings } from '../settings'

type Tab = 'cap' | 'solo' | 'estr' | 'grupo' | 'esp'
const TABS: [Tab, string][] = [['cap', 'Capacidade de carga'], ['solo', 'Solo e carga lateral (p-y)'], ['estr', 'Estrutural da estaca'], ['grupo', 'Grupo, rigidez e bloco'], ['esp', 'Solo mole, atrito negativo e recalque']]

interface Props {
  s: Settings
  onChange: (s: Settings) => void
  holes: SptBorehole[]
}

const ed = (a: unknown, b: unknown) => (a === undefined || a === b ? '' : 'edited')

export default function ParamsPage({ s, onChange, holes }: Props) {
  const [tab, setTab] = useState<Tab>('cap')
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch })
  return (
    <>
      <header className="page-h">
        <h1>Parâmetros dos métodos</h1>
        <p>Todos os coeficientes e critérios usados nos cálculos, com os valores iniciais da norma e da literatura. Altere o que for decisão sua: o campo fica destacado e vale para a otimização, as análises e o memorial. Cada seção tem “restaurar padrões”.</p>
      </header>
      <div className="tabs2 sections" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'cap' && <CapTab s={s} set={set} />}
      {tab === 'solo' && <SoloTab s={s} set={set} holes={holes} />}
      {tab === 'estr' && <EstrTab s={s} set={set} />}
      {tab === 'grupo' && <GrupoTab s={s} set={set} />}
      {tab === 'esp' && <EspTab s={s} set={set} />}
    </>
  )
}

// ------------------------------------------------------------------ capacidade de carga

function CapTab({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [type, setType] = useState<PileType>('helice')
  const [dcm, setDcm] = useState(40)
  const p = s.capParams
  const setP = (patch: Partial<typeof p>) => set({ capParams: { ...p, ...patch } })
  const lim = (t: PileType) => p.sptShaftLimits?.[t] ?? {}
  const setLim = (t: PileType, v: { min?: number; max?: number }) => {
    const next = { ...p.sptShaftLimits, [t]: v }
    if (v.min === undefined && v.max === undefined) delete next[t]
    setP({ sptShaftLimits: Object.keys(next).length ? next : undefined })
  }
  return (
    <>
      <section className="card">
        <h2>Métodos de cálculo e utilização das resistências</h2>
        <div className="checks">
          {([['aoki-velloso', 'Aoki-Velloso'], ['decourt-quaresma', 'Décourt-Quaresma'], ['teixeira', 'Teixeira']] as const).map(([m, label]) => (
            <label key={m} className="inline">
              <input type="checkbox" checked={s.methods[m]} onChange={(e) => { const next = { ...s.methods, [m]: e.target.checked }; if (Object.values(next).some(Boolean)) set({ methods: next }) }} /> {label}
            </label>
          ))}
        </div>
        <div className="fgrid">
          <Field label="Combinação dos métodos selecionados" hint="Menor = conservador (padrão). Média = média das cargas admissíveis dos métodos. Com um só método marcado, vale ele.">
            <select className={s.capacityCombine === 'menor' ? '' : 'edited'} value={s.capacityCombine} onChange={(e) => set({ capacityCombine: e.target.value as Settings['capacityCombine'] })} disabled={Object.values(s.methods).filter(Boolean).length < 2}>
              <option value="menor">O menor valor (conservador)</option><option value="media">A média dos métodos</option>
            </select>
          </Field>
          <Field label="Utilização da resistência de ponta (%)" hint="100 = integral. Multiplica a parcela de ponta de todos os métodos."><input className={s.tipUsePct === 100 ? '' : 'edited'} type="number" min={0} max={150} value={s.tipUsePct} onChange={(e) => set({ tipUsePct: num(e.target.value, 100) })} /></Field>
          <Field label="Utilização da resistência lateral (%)" hint="100 = integral. Multiplica a parcela de atrito lateral de todos os métodos."><input className={s.shaftUsePct === 100 ? '' : 'edited'} type="number" min={0} max={150} value={s.shaftUsePct} onChange={(e) => set({ shaftUsePct: num(e.target.value, 100) })} /></Field>
        </div>
        {(s.tipUsePct > 100 || s.shaftUsePct > 100) && <p className="warn">Percentual acima de 100 % aumenta a capacidade além do previsto pelos métodos: decisão do projetista.</p>}
        <p className="hint">Os percentuais são aplicados antes do limite da ponta em % da lateral e antes dos coeficientes de segurança. Vale para a otimização e para as análises avançadas.</p>
      </section>

      <section className="card">
        <h2>Critérios gerais da capacidade de carga</h2>
        <div className="fgrid">
          <Field label="Limitar a resistência de ponta a (% da lateral)" hint="Vazio = sem limite. Valor usual: 25 %.">
            <input className={ed(p.tipLimitPct, undefined)} type="number" min={0} value={p.tipLimitPct ?? ''} placeholder="sem limite" onChange={(e) => setP({ tipLimitPct: e.target.value === '' || +e.target.value <= 0 ? undefined : +e.target.value })} />
          </Field>
          <Field label="Atrito lateral no último metro">
            <select className={p.ignoreLastMeter ? 'edited' : ''} value={p.ignoreLastMeter ? 'nao' : 'sim'} onChange={(e) => setP({ ignoreLastMeter: e.target.value === 'nao' ? true : undefined })}>
              <option value="sim">Considerar (padrão)</option><option value="nao">Desprezar</option>
            </select>
          </Field>
          <Field label="Critério de carga admissível">
            <select value={s.safetyMode} onChange={(e) => set({ safetyMode: e.target.value as Settings['safetyMode'] })}>
              <option value="conservador">Conservador: menor entre NBR 6122 e FS global</option>
              <option value="nbr-admissivel">NBR 6122:2022: Rk/1,4 com fatores ξ</option>
              <option value="global">FS global</option>
            </select>
          </Field>
          <Field label="FS global"><input className={s.fsGlobal === 2 ? '' : 'edited'} type="number" min={1} step={0.1} value={s.fsGlobal} onChange={(e) => set({ fsGlobal: num(e.target.value, 2) })} /></Field>
        </div>
        <h3>Limites de N<sub>SPT</sub> no atrito lateral (Aoki-Velloso e Teixeira)</h3>
        <p className="hint">Em branco = sem limite. Décourt-Quaresma usa o limite superior de N<sub>L</sub> do próprio método (editável abaixo, por tipo de estaca).</p>
        <div className="scroll-x">
          <table className="mini-t compact">
            <thead><tr><th>Estaca</th><th>N mín.</th><th>N máx.</th></tr></thead>
            <tbody>
              {OPTIMIZABLE_TYPES.map((t) => (
                <tr key={t}>
                  <td style={{ textAlign: 'left' }}>{PILE_LABEL[t]}</td>
                  <td><input className={ed(lim(t).min, undefined)} type="number" value={lim(t).min ?? ''} onChange={(e) => setLim(t, { ...lim(t), min: e.target.value === '' ? undefined : +e.target.value })} /></td>
                  <td><input className={ed(lim(t).max, undefined)} type="number" value={lim(t).max ?? ''} onChange={(e) => setLim(t, { ...lim(t), max: e.target.value === '' ? undefined : +e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row"><button onClick={() => set({ capParams: {}, safetyMode: DEFAULT_SETTINGS.safetyMode, fsGlobal: DEFAULT_SETTINGS.fsGlobal, capacityCombine: 'menor', tipUsePct: 100, shaftUsePct: 100, methods: DEFAULT_SETTINGS.methods })}>↺ Restaurar todos os padrões da capacidade de carga</button></div>
      </section>

      <section className="card">
        <div className="row">
          <Field label="Tipo de estaca"><select value={type} onChange={(e) => setType(e.target.value as PileType)}>{OPTIMIZABLE_TYPES.map((t) => <option key={t} value={t}>{PILE_LABEL[t]}</option>)}</select></Field>
          <Field label="Diâmetro de referência (cm)" hint="Alguns conjuntos de Aoki-Velloso dependem do diâmetro."><input type="number" min={10} value={dcm} onChange={(e) => setDcm(num(e.target.value, 40))} /></Field>
        </div>
        <p className="hint">Os coeficientes abaixo são por tipo de estaca (Aoki-Velloso F1/F2, Décourt-Quaresma α/β, Teixeira α/β) e por tipo de solo (K, α, C). Selecione o tipo para ver e editar os valores dele.</p>
      </section>
      <ParamsEditor params={p} onChange={(x) => set({ capParams: x })} type={type} diameter={dcm / 100} defaultOpen />
    </>
  )
}

// ------------------------------------------------------------------ solo e p-y

function SoloTab({ s, set, holes }: { s: Settings; set: (p: Partial<Settings>) => void; holes: SptBorehole[] }) {
  const [holeId, setHoleId] = useState(holes[0]?.id ?? '')
  const [detail, setDetail] = useState(false)
  const hole = holes.find((h) => h.id === holeId) ?? holes[0]
  const opts = useMemo(() => lateralOptions(s, hole?.id), [s, hole?.id])
  const L = s.lateral
  const setL = (patch: Partial<typeof L>) => set({ lateral: { ...L, ...patch } })
  const ov = hole ? (L.overrides[hole.id] ?? {}) : {}
  const setOv = (depth: number, patch: LayerOverride) => {
    if (!hole) return
    const cur = { ...ov, [depth]: { ...ov[depth], ...patch } }
    setL({ overrides: { ...L.overrides, [hole.id]: cur } })
  }
  const clearOv = () => { if (hole) { const o = { ...L.overrides }; delete o[hole.id]; setL({ overrides: o }) } }
  const built = useMemo(() => {
    if (!hole) return { error: 'Cadastre uma sondagem (passo 1).' as string | undefined, profile: undefined }
    try { return { error: undefined, profile: buildLateralProfile(hole, opts) } } catch (e) {
      if (e instanceof MissingWaterLevelError) return { error: e.message, profile: undefined }
      throw e
    }
  }, [hole, opts])
  const cls = (d: number, k: keyof LayerOverride) => (ov[d]?.[k] !== undefined ? 'edited' : '')
  return (
    <>
      <section className="card">
        <h2>Correlações do SPT e modelo p-y</h2>
        <div className="fgrid">
          <Field label="Regra do ângulo de atrito φ' das areias" hint="Conservador = menor entre Godoy (28 + 0,4N) e Teixeira (√(20N) + 15).">
            <select className={L.phiRule === 'conservador' ? '' : 'edited'} value={L.phiRule} onChange={(e) => setL({ phiRule: e.target.value as typeof L.phiRule })}>
              <option value="conservador">Conservador (menor das duas)</option><option value="godoy">Godoy: 28 + 0,4·N</option><option value="teixeira">Teixeira: √(20·N) + 15</option>
            </select>
          </Field>
          <Field label="Su = fator × N_SPT (kPa)" hint="10 = Teixeira & Godoy. Define também argila mole (Su < 49 kPa) ou rija."><input className={L.suFactor === 10 ? '' : 'edited'} type="number" min={1} step={0.5} value={L.suFactor} onChange={(e) => setL({ suFactor: num(e.target.value, 10) })} /></Field>
          <Field label="Carregamento p-y"><select value={s.loading} onChange={(e) => set({ loading: e.target.value as Settings['loading'] })}><option value="static">Estático</option><option value="cyclic">Cíclico</option></select></Field>
        </div>
        <p className="hint">Estes parâmetros valem para o <b>primeiro furo selecionado</b> (usado na análise lateral) e para as análises avançadas. Edite abaixo, camada a camada, qualquer valor que queira substituir (por ensaio ou julgamento).</p>
      </section>

      <section className="card">
        <div className="row between">
          <h3>Parâmetros por camada</h3>
          <div className="row">
            {holes.length > 1 && <Field label="Furo"><select value={hole?.id} onChange={(e) => setHoleId(e.target.value)}>{holes.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}</select></Field>}
            <label className="inline"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} /> parâmetros p-y detalhados</label>
            <button onClick={clearOv} disabled={!hole || !L.overrides[hole.id]}>↺ Restaurar camadas deste furo</button>
          </div>
        </div>
        {built.error && <p className="warn">{built.error}</p>}
        {built.profile && (
          <div className="scroll-x tall">
            <table className="layers">
              <thead><tr><th>Prof. (m)</th><th>Solo</th><th>N</th><th>Modelo p-y</th><th>γ' (kN/m³)</th><th>φ' (°)</th><th>Su (kPa)</th><th>n<sub>h</sub> (kN/m³)</th>{detail && <><th>k areia</th><th>ε50</th><th>J</th><th>ks</th><th>kc</th></>}</tr></thead>
              <tbody>
                {built.profile.layers.map((l) => {
                  const d = l.bottom
                  const inp = (k: 'gammaEff' | 'phi' | 'su' | 'nh' | 'kSand' | 'epsC' | 'J' | 'ks' | 'kc', step: number) => (
                    <td><input className={cls(d, k)} type="number" step={step} value={+Number(l[k]).toPrecision(5)} onChange={(e) => setOv(d, { [k]: +e.target.value })} /></td>
                  )
                  return (
                    <tr key={d}>
                      <td>{l.top}–{l.bottom}</td><td>{SOIL_LABEL[l.soil]}</td><td>{l.nspt}</td>
                      <td><select className={cls(d, 'model')} value={l.model} onChange={(e) => setOv(d, { model: e.target.value as LateralModel })}>{(Object.keys(MODEL_LABEL) as LateralModel[]).map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}</select></td>
                      {inp('gammaEff', 0.5)}{inp('phi', 1)}{inp('su', 5)}{inp('nh', 500)}
                      {detail && <>{inp('kSand', 1000)}{inp('epsC', 0.001)}{inp('J', 0.05)}{inp('ks', 1000)}{inp('kc', 1000)}</>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Modelos: areia (API), argila mole (Matlock, 1970), argila rija (Reese et al., 1975) e linear com n<sub>h</sub> (Terzaghi). “Linear” só tem efeito se n<sub>h</sub> for informado. Valores derivados do SPT por correlações empíricas de uso preliminar.</p>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ estrutural

function EstrTab({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const o = s.structural
  const setO = (patch: Partial<typeof o>) => set({ structural: { ...o, ...patch } })
  const types = OPTIMIZABLE_TYPES
  const setT4 = (t: PileType, patch: { fck?: number; gammaC?: number; minArmedLength?: number | 'integral'; noRebarStress?: number }) => {
    const cur = { ...o.t4?.[t], ...patch }
    for (const k of Object.keys(cur) as (keyof typeof cur)[]) if (cur[k] === undefined) delete cur[k]
    const t4 = { ...o.t4, [t]: cur }
    if (Object.keys(cur).length === 0) delete t4[t]
    setO({ t4: Object.keys(t4).length ? t4 : undefined })
  }
  return (
    <>
      <section className="card">
        <h2>Concreto e armadura mínima por tipo de estaca (NBR 6122:2022, Tab. 4)</h2>
        <p className="hint">Os valores iniciais são os da tabela para a classe de agressividade (CAA) escolhida no passo 3. Você pode adotar fck maior, outro γc ou outro comprimento mínimo armado, por decisão técnica. Em branco = valor da norma.</p>
        <div className="fgrid">
          <Field label="CAA"><select value={s.caa} onChange={(e) => set({ caa: +e.target.value as Settings['caa'] })}>{[1, 2, 3, 4].map((c) => <option key={c} value={c}>{['I', 'II', 'III', 'IV'][c - 1]}</option>)}</select></Field>
          <Field label="Armadura transversal padrão"><select value={s.transverse} onChange={(e) => set({ transverse: e.target.value as Settings['transverse'] })}><option value="estribo">Estribos</option><option value="helicoidal">Helicoidal</option></select></Field>
        </div>
        <div className="scroll-x">
          <table className="mini-t">
            <thead><tr><th>Estaca</th><th>fck (MPa)</th><th>γc</th><th>Comprimento mín. armado (m)</th><th>Tensão sem armar (MPa)</th><th>Tab. 4 (norma)</th></tr></thead>
            <tbody>
              {types.map((t) => {
                const base = table4(t, s.caa)
                const cur = o.t4?.[t] ?? {}
                return (
                  <tr key={t}>
                    <td style={{ textAlign: 'left' }}>{PILE_LABEL[t]}</td>
                    <td><input className={ed(cur.fck, undefined)} type="number" value={cur.fck ?? ''} placeholder={String(base?.fck ?? '—')} onChange={(e) => setT4(t, { fck: e.target.value === '' ? undefined : +e.target.value })} /></td>
                    <td><input className={ed(cur.gammaC, undefined)} type="number" step={0.1} value={cur.gammaC ?? ''} placeholder={String(base?.gammaC ?? '—')} onChange={(e) => setT4(t, { gammaC: e.target.value === '' ? undefined : +e.target.value })} /></td>
                    <td><input className={ed(cur.minArmedLength, undefined)} type="number" step={0.5} disabled={base?.minArmedLength === 'integral'} value={typeof cur.minArmedLength === 'number' ? cur.minArmedLength : ''} placeholder={base?.minArmedLength === 'integral' ? 'integral' : String(base?.minArmedLength ?? '—')} onChange={(e) => setT4(t, { minArmedLength: e.target.value === '' ? undefined : +e.target.value })} /></td>
                    <td><input className={ed(cur.noRebarStress, undefined)} type="number" step={0.5} value={cur.noRebarStress ?? ''} placeholder={base?.noRebarStress !== undefined ? String(base.noRebarStress) : '—'} onChange={(e) => setT4(t, { noRebarStress: e.target.value === '' ? undefined : +e.target.value })} /></td>
                    <td className="hint">{base ? `fck ${base.fck} · γc ${base.gammaC} · ${base.minArmedLength === 'integral' ? 'integral' : base.minArmedLength + ' m'}` : 'sem linha na tabela (informe fck e γc)'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="fgrid">
          <Field label="Esforço normal ao longo da estaca" hint="Com atrito: N(z) = N·(1 − Rl(z)/R_total), o atrito lateral mobilizado (mesma segurança no atrito e na ponta; vale o maior N entre métodos e furos) reduz o normal com a profundidade. Constante: N do topo em todo o fuste (a favor da segurança).">
            <select className={s.axialTransfer === 'atrito' ? '' : 'edited'} value={s.axialTransfer} onChange={(e) => set({ axialTransfer: e.target.value as Settings['axialTransfer'] })}><option value="atrito">Desconta o atrito lateral</option><option value="constante">Constante (carga do topo)</option></select>
          </Field>
          <Field label="Coeficiente de segurança na tensão N/A (Tab. 4)" hint="NBR 6122:2022, 8.6.3: acima do limite da tabela a estaca precisa de armadura. A tensão é Nd/(coeficiente)/A: 1,0 = carga de cálculo (padrão, conservador); 1,4 = carga de serviço."><input className={ed(o.noRebarDivisor, undefined)} type="number" step={0.1} min={1} value={o.noRebarDivisor ?? ''} placeholder="1,0" onChange={(e) => setO({ noRebarDivisor: e.target.value === '' ? undefined : +e.target.value })} /></Field>
          <Field label="fck para todas as estacas (MPa)" hint="Vazio = por tipo (tabela acima). Se preenchido, vale para todos."><input className={s.fck === null ? '' : 'edited'} type="number" min={20} max={50} value={s.fck ?? ''} placeholder="por tipo" onChange={(e) => set({ fck: e.target.value === '' ? null : +e.target.value })} /></Field>
          <Field label="Taxa mínima de armadura longitudinal (%)" hint="NBR 6122, Tab. 4: 0,4 %."><input className={ed(o.minRho, undefined)} type="number" step={0.05} value={o.minRho !== undefined ? +(o.minRho * 100).toFixed(3) : ''} placeholder="0,4" onChange={(e) => setO({ minRho: e.target.value === '' ? undefined : +e.target.value / 100 })} /></Field>
        </div>
      </section>

      <section className="card">
        <h2>Materiais, cobrimento e detalhamento</h2>
        <div className="fgrid">
          <Field label="Cobrimento (mm)" hint={`Vazio = NBR 6118 Tab. 7.2 (CAA ${['I', 'II', 'III', 'IV'][s.caa - 1]}: ${COVER_SOIL[s.caa] * 1000} mm, contato com o solo).`}><input className={ed(o.cover, undefined)} type="number" min={20} value={o.cover !== undefined ? o.cover * 1000 : ''} placeholder={String(COVER_SOIL[s.caa] * 1000)} onChange={(e) => setO({ cover: e.target.value === '' ? undefined : +e.target.value / 1000 })} /></Field>
          <Field label="fyk do aço (MPa)"><input className={ed(o.fyk, 500)} type="number" value={o.fyk ?? 500} onChange={(e) => setO({ fyk: e.target.value === '' || +e.target.value === 500 ? undefined : +e.target.value })} /></Field>
          <Field label="γs"><input className={ed(o.gammaS, 1.15)} type="number" step={0.05} value={o.gammaS ?? 1.15} onChange={(e) => setO({ gammaS: +e.target.value === 1.15 ? undefined : num(e.target.value, 1.15) })} /></Field>
          <Field label="Dimensão máx. do agregado (mm)" hint="Define o espaçamento livre mínimo entre barras (1,2·dmáx)."><input className={ed(o.dmax, 0.019)} type="number" value={(o.dmax ?? 0.019) * 1000} onChange={(e) => setO({ dmax: +e.target.value === 19 ? undefined : num(e.target.value, 19) / 1000 })} /></Field>
          <Field label="Reduzir 2 mm o diâmetro das barras (NBR 6122, 8.6.2)"><select className={o.sacrificial === false ? 'edited' : ''} value={o.sacrificial === false ? 'nao' : 'sim'} onChange={(e) => setO({ sacrificial: e.target.value === 'nao' ? false : undefined })}><option value="sim">Sim (padrão)</option><option value="nao">Não</option></select></Field>
        </div>
        <div className="row"><button onClick={() => set({ structural: {}, fck: null })}>↺ Restaurar padrões estruturais</button></div>
        <p className="hint">Não alterável: parábola-retângulo e domínios de deformação da NBR 6118 (fixos pela norma). Os campos aplicam-se ao dimensionamento automático e à verificação da armadura editada.</p>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ grupo, rigidez e bloco

function GrupoTab({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const e = (a: unknown, b: unknown) => (a === b ? '' : 'edited')
  const reset = () => {
    const d = DEFAULT_SETTINGS
    set({ groupEffect: d.groupEffect, headFixity: d.headFixity, permitTension: d.permitTension, tensionShaftFactor: d.tensionShaftFactor, execEccentricityCm: d.execEccentricityCm, eiFactor: d.eiFactor, nonlinearEI: d.nonlinearEI, serviceLimitMm: d.serviceLimitMm, blockFck: d.blockFck, blockAlpha: d.blockAlpha, blockMarginCm: d.blockMarginCm, blockKR: d.blockKR, pileSpacingFactor: d.pileSpacingFactor, blockEdgeRule: d.blockEdgeRule, blockUnitWeight: d.blockUnitWeight, blockWeightFactorELU: d.blockWeightFactorELU, blockThetaMin: d.blockThetaMin, blockThetaMax: d.blockThetaMax, blockMethod: d.blockMethod, blockShape: d.blockShape, blockHMinCm: d.blockHMinCm, blockD1Factor: d.blockD1Factor })
  }
  return (
    <>
      <section className="card">
        <h2>Análise do grupo e rigidez da estaca</h2>
        <div className="fgrid">
          <Field label="Deslocamento horizontal máximo no topo (mm)" hint="Padrão 25 mm (valor convencional da literatura); depende da estrutura."><input className={e(s.serviceLimitMm, DEFAULT_SETTINGS.serviceLimitMm)} type="number" min={1} value={s.serviceLimitMm} onChange={(ev) => set({ serviceLimitMm: num(ev.target.value, 25) })} /></Field>
          <Field label="Efeito de grupo lateral"><select value={s.groupEffect} onChange={(ev) => set({ groupEffect: ev.target.value as Settings['groupEffect'] })}><option value="davisson">Davisson (1970): 25 % a 3B, 100 % a 8B</option><option value="none">Desprezar</option></select></Field>
          <Field label="Cabeça da estaca no bloco"><select value={s.headFixity} onChange={(ev) => set({ headFixity: ev.target.value as Settings['headFixity'] })}><option value="engastada">Engastada</option><option value="articulada">Articulada</option></select></Field>
          <Field label="Estacas tracionadas"><select value={s.permitTension ? 'sim' : 'nao'} onChange={(ev) => set({ permitTension: ev.target.value === 'sim' })}><option value="nao">Não permitir</option><option value="sim">Permitir (capacidade = fator × atrito admissível)</option></select></Field>
          <Field label="Capacidade à tração: fator sobre o atrito à compressão" hint="Campos e Velloso & Lopes: a tração pode ser tomada como o atrito à compressão reduzido da ordem de 30 % (fator 0,7); peso próprio desprezado, a favor da segurança. Só vale com 'Permitir'."><input className={e(s.tensionShaftFactor, 0.7)} type="number" step={0.05} min={0.1} max={1} value={s.tensionShaftFactor} onChange={(ev) => set({ tensionShaftFactor: num(ev.target.value, 0.7) })} /></Field>
          <Field label="Excentricidade executiva (cm)" hint="Somada ao momento de cálculo (NBR 6122:2022, 8.5.6.1)."><input className={e(s.execEccentricityCm, 0)} type="number" min={0} value={s.execEccentricityCm} onChange={(ev) => set({ execEccentricityCm: num(ev.target.value, 0) })} /></Field>
          <Field label="Fator de rigidez EI (ELS)" hint="EI = fator × Ecs × I."><input className={e(s.eiFactor, 0.8)} type="number" step={0.05} min={0.1} max={1} value={s.eiFactor} onChange={(ev) => set({ eiFactor: num(ev.target.value, 0.8) })} /></Field>
          <Field label="EI não linear no ELU (momento-curvatura)"><select value={s.nonlinearEI ? 'sim' : 'nao'} onChange={(ev) => set({ nonlinearEI: ev.target.value === 'sim' })}><option value="sim">Sim</option><option value="nao">Não (EI constante)</option></select></Field>
        </div>
      </section>
      <section className="card">
        <h2>Bloco de coroamento (bielas e tirantes)</h2>
        <div className="fgrid">
          <Field label="Método de dimensionamento das armaduras" hint="Conservador = calcula pelos dois métodos e adota o de maior armadura. NBR 6118:2026, 22.7.3, aceita modelos de bielas e tirantes e modelos 3D.">
            <select className={s.blockMethod === 'conservador' ? '' : 'edited'} value={s.blockMethod} onChange={(ev) => set({ blockMethod: ev.target.value as BlockMethod })}>
              {(Object.keys(BLOCK_METHOD_LABEL) as BlockMethod[]).map((m) => <option key={m} value={m}>{BLOCK_METHOD_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Formato do bloco em planta" hint="Típico: formas do roteiro de Bastos/Campos por arranjo (triângulo truncado, pentágono, hexágono; retângulo nos demais). Otimizado: o contorno acompanha as estacas à distância a da borda (menos concreto e forma). Retangular: caixa envolvente.">
            <select className={s.blockShape === 'tipico' ? '' : 'edited'} value={s.blockShape} onChange={(ev) => set({ blockShape: ev.target.value as BlockShape })}>
              {(Object.keys(BLOCK_SHAPE_LABEL) as BlockShape[]).map((m) => <option key={m} value={m}>{BLOCK_SHAPE_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="fck inicial do bloco (MPa)" hint="Sobe a 35 e 40 se a biela não passar."><input type="number" min={20} max={50} value={s.blockFck} onChange={(ev) => set({ blockFck: num(ev.target.value, 30) })} /></Field>
          <Field label="Altura mínima do bloco (cm)" hint="Valor usual: 50 cm. A altura também deve permitir ancorar a armadura de arranque do pilar (NBR 6118:2026, 22.7.4.1.4): confira."><input className={e(s.blockHMinCm, 50)} type="number" min={20} step={5} value={s.blockHMinCm} onChange={(ev) => set({ blockHMinCm: num(ev.target.value, 50) })} /></Field>
          <Field label="Bloco de 1 estaca: d mínimo (× diâmetro)" hint="Valor usual: 1,2."><input className={e(s.blockD1Factor, 1.2)} type="number" step={0.1} min={0.5} value={s.blockD1Factor} onChange={(ev) => set({ blockD1Factor: num(ev.target.value, 1.2) })} /></Field>
          <Field label="Ângulo mínimo das bielas (°)"><input className={e(s.blockThetaMin, 45)} type="number" min={25} max={60} value={s.blockThetaMin} onChange={(ev) => set({ blockThetaMin: num(ev.target.value, 45) })} /></Field>
          <Field label="Ângulo máximo das bielas (°)"><input className={e(s.blockThetaMax, 55)} type="number" min={40} max={75} value={s.blockThetaMax} onChange={(ev) => set({ blockThetaMax: num(ev.target.value, 55) })} /></Field>
          <Field label="α (bloco de 4 estacas)" hint="3/4 ≤ α ≤ 6/7; Campos recomenda 0,8."><input className={e(s.blockAlpha, 0.8)} type="number" step={0.01} min={0.75} max={0.857} value={s.blockAlpha} onChange={(ev) => set({ blockAlpha: num(ev.target.value, 0.8) })} /></Field>
          <Field label="Afastamento entre eixos das estacas (× diâmetro)" hint="Vazio = mínimo da literatura (Campos, Tab. 10.21): 3·dE nas escavadas, hélice e raiz; 2,5·dE (argila) ou 2·dE (areia) em Strauss e Franki; no mínimo 60 cm. Valores maiores aumentam o bloco; menores que o mínimo são por sua conta.">
            <input className={s.pileSpacingFactor === null ? '' : 'edited'} type="number" step={0.1} min={1.5} max={8} value={s.pileSpacingFactor ?? ''} placeholder="mínimo da tabela" onChange={(ev) => set({ pileSpacingFactor: ev.target.value === '' ? null : num(ev.target.value, 3) })} />
          </Field>
          <Field label="Folga da estaca à borda do bloco" hint="Padrão: Bastos, grande porte — folga de 15 cm da face da estaca à borda do bloco (ex.: Ø70 em 3·dE → 310 cm); se a ancoragem da armadura exigir mais, o app aumenta a folga. Campos: eixo da estaca à borda = dE + margem (mais folgado, bloco maior). Pequeno porte: 5 cm.">
            <select className={s.blockEdgeRule === 'grande' ? '' : 'edited'} value={s.blockEdgeRule} onChange={(ev) => set({ blockEdgeRule: ev.target.value as 'campos' | 'grande' | 'pequeno' })}>
              <option value="campos">Campos: a = dE + margem</option><option value="grande">Bastos — grande porte (15 cm da face)</option><option value="pequeno">Bastos — pequeno porte (5 cm da face)</option>
            </select>
          </Field>
          <Field label="Eixo da estaca à borda: a = dE + (cm)"><input className={e(s.blockMarginCm, 15)} type="number" value={s.blockMarginCm} onChange={(ev) => set({ blockMarginCm: num(ev.target.value, 15) })} /></Field>
          <Field label="K_R (efeito Rüsch) nas bielas — roteiro de Machado/Bastos" hint="0,90 a 0,95; limites de tensão de Blévot = κ·K_R·fcd. Padrão conservador: 0,90."><input className={e(s.blockKR, 0.9)} type="number" step={0.01} min={0.85} max={0.95} value={s.blockKR} onChange={(ev) => set({ blockKR: num(ev.target.value, 0.9) })} /></Field>
          <Field label="Peso específico do bloco (kN/m³)"><input className={e(s.blockUnitWeight, 25)} type="number" value={s.blockUnitWeight} onChange={(ev) => set({ blockUnitWeight: num(ev.target.value, 25) })} /></Field>
          <Field label="Majoração do peso do bloco no ELU"><input className={e(s.blockWeightFactorELU, 1.4)} type="number" step={0.05} value={s.blockWeightFactorELU} onChange={(ev) => set({ blockWeightFactorELU: num(ev.target.value, 1.4) })} /></Field>
        </div>
        <div className="row"><button onClick={reset}>↺ Restaurar padrões desta seção</button></div>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ solo mole, atrito negativo e recalque

function EspTab({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const e = (a: unknown, b: unknown) => (a === b ? '' : 'edited')
  const nf = s.negFriction
  const st = s.settlement
  const setNf = (patch: Partial<typeof nf>) => set({ negFriction: { ...nf, ...patch } })
  const setSt = (patch: Partial<typeof st>) => set({ settlement: { ...st, ...patch } })
  return (
    <>
      <section className="card">
        <h2>Argila mole (NBR 6122:2022, 8.6.1 e 8.6.5.1)</h2>
        <p className="hint">Quando a estaca atravessa argila mole, a norma exige W ≥ 930 cm³ e raio de giração ≥ 5,4 cm (20 a 30 m) ou ≥ 6,4 cm (&gt; 30 m), e verificação de 2ª ordem. A norma não define numericamente "argila mole": informe o limite de N<sub>SPT</sub>.</p>
        <div className="fgrid">
          <Field label="N_SPT máximo da argila considerada mole" hint="NBR 6484: muito mole ≤ 2; mole 3 a 5. Padrão: 5 (mais conservador)."><input className={e(s.softClayNspt, 5)} type="number" min={1} max={10} value={s.softClayNspt} onChange={(ev) => set({ softClayNspt: num(ev.target.value, 5) })} /></Field>
        </div>
      </section>
      <section className="card">
        <h2>Atrito negativo (NBR 6122:2022, 5.8; Velloso &amp; Lopes, cap. 18.1)</h2>
        <p className="hint">Método simples: ponto neutro na base da camada que recalca e τ<sub>n</sub> = β·σ'<sub>v</sub> (Long e Healy, 1974). No ELS desconta-se da capacidade o atrito positivo até o ponto neutro e soma-se Q<sub>n</sub> à carga; no ELU Q<sub>n</sub> entra como compressão ao longo da estaca. Ignora o alívio de tensões e o efeito de grupo (a favor da segurança). Em obra com aterro sobre solo mole, informe os dados do aterro.</p>
        <div className="fgrid">
          <Field label="Considerar atrito negativo"><select value={nf.on ? 'sim' : 'nao'} onChange={(ev) => setNf({ on: ev.target.value === 'sim' })}><option value="nao">Não</option><option value="sim">Sim</option></select></Field>
          <Field label="Profundidade do ponto neutro (m do terreno)" hint="Base da camada que recalca (aterro sobre argila mole)."><input className={e(nf.zNeutral, 6)} type="number" min={0} step={0.5} value={nf.zNeutral} onChange={(ev) => setNf({ zNeutral: num(ev.target.value, 6) })} /></Field>
          <Field label="Solo que recalca" hint="β sugerido: argilas 0,20 a 0,25; siltes 0,25 a 0,35; areias 0,35 a 0,50 (Long e Healy, 1974). Ao trocar o solo, β assume o limite superior da faixa.">
            <select value={nf.soil} onChange={(ev) => { const k = ev.target.value as 'argila' | 'silte' | 'areia'; setNf({ soil: k, beta: NEG_BETA[k].max }) }}>
              <option value="argila">Argila</option><option value="silte">Silte</option><option value="areia">Areia</option>
            </select>
          </Field>
          <Field label="β" hint={`Faixa do solo escolhido: ${NEG_BETA[nf.soil].min} a ${NEG_BETA[nf.soil].max}.`}><input className={e(nf.beta, NEG_BETA[nf.soil].max)} type="number" step={0.01} min={0.05} max={0.6} value={nf.beta} onChange={(ev) => setNf({ beta: num(ev.target.value, NEG_BETA[nf.soil].max) })} /></Field>
          <Field label="Peso específico do solo γ (kN/m³)" hint="Uniforme até o ponto neutro. Abaixo do nível d'água do 1º furo usa-se γ − 9,81."><input className={e(nf.gamma, 18)} type="number" step={0.5} min={5} value={nf.gamma} onChange={(ev) => setNf({ gamma: num(ev.target.value, 18) })} /></Field>
          <Field label="Sobrecarga na superfície, aterro (kPa)"><input className={e(nf.surcharge, 0)} type="number" min={0} value={nf.surcharge} onChange={(ev) => setNf({ surcharge: num(ev.target.value, 0) })} /></Field>
          <Field label="Coeficiente do atrito negativo no ELU" hint="Compressão adicional: a NBR 6122 não fixa o valor. Padrão 1,4 (conservador)."><input className={e(nf.factorELU, 1.4)} type="number" step={0.05} min={1} value={nf.factorELU} onChange={(ev) => setNf({ factorELU: num(ev.target.value, 1.4) })} /></Field>
        </div>
      </section>
      <section className="card">
        <h2>Recalque do grupo (radier fictício)</h2>
        <p className="hint">Artifício de Terzaghi e Peck (1948), aceito pela NBR 6122 (Velloso &amp; Lopes, §16.2.1, Fig. 16.3), com módulo E = α·K·N<sub>SPT</sub> de Teixeira e Godoy (1996) e encurtamento elástico das estacas. É uma estimativa: confirme com o método do projeto. Com limite zero, o recalque só é informado.</p>
        <div className="fgrid">
          <Field label="Calcular recalque do grupo"><select value={st.on ? 'sim' : 'nao'} onChange={(ev) => setSt({ on: ev.target.value === 'sim' })}><option value="nao">Não</option><option value="sim">Sim</option></select></Field>
          <Field label="Profundidade do radier fictício">
            <select className={st.raftDepth === 'dois-tercos' ? '' : 'edited'} value={st.raftDepth} onChange={(ev) => setSt({ raftDepth: ev.target.value as RaftDepth })}>
              {(Object.keys(RAFT_DEPTH_LABEL) as RaftDepth[]).map((k) => <option key={k} value={k}>{RAFT_DEPTH_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Espraiamento da carga (H:V)" hint="Tangente do ângulo; 0,5 = 2 na vertical : 1 na horizontal (prática usual). Editável."><input className={e(st.spread, 0.5)} type="number" step={0.05} min={0} max={1} value={st.spread} onChange={(ev) => setSt({ spread: num(ev.target.value, 0.5) })} /></Field>
          <Field label="Fator multiplicador do módulo E" hint="1 = valores de Teixeira e Godoy."><input className={e(st.eFactor, 1)} type="number" step={0.1} min={0.1} value={st.eFactor} onChange={(ev) => setSt({ eFactor: num(ev.target.value, 1) })} /></Field>
          <Field label="Recalque máximo do grupo (mm)" hint="0 = não limitar (só informar). Acima do limite, a estaca é alongada ou a solução descartada."><input className={e(st.limitMm, 0)} type="number" min={0} value={st.limitMm} onChange={(ev) => setSt({ limitMm: num(ev.target.value, 0) })} /></Field>
        </div>
      </section>
    </>
  )
}
