import { AV_SET_LABEL, avEffective, dqEffective, hasOverrides, txEffective, type AvSetId, type CapacityParams } from './core/capacity'
import { PILE_LABEL, type PileType } from './core/pile'
import { SOIL_LABEL, SOIL_TYPES, type SoilClass3 } from './core/soil'

interface Props {
  params: CapacityParams
  onChange: (p: CapacityParams) => void
  type: PileType
  diameter: number
  defaultOpen?: boolean
}

const CLASSES: { id: SoilClass3; label: string }[] = [
  { id: 'argila', label: 'Argilas' },
  { id: 'intermediario', label: 'Solos intermediários' },
  { id: 'areia', label: 'Areias' },
]

/** Campo numérico: mostra o valor efetivo; destaca se difere do padrão; vazio/inválido remove a sobrescrita. */
function Num(props: { value: number; edited: boolean; step?: number; onSet: (v: number | undefined) => void }) {
  return (
    <input
      type="number"
      step={props.step ?? 'any'}
      className={props.edited ? 'edited' : ''}
      value={Number.isFinite(props.value) ? +props.value.toPrecision(6) : ''}
      onChange={(e) => props.onSet(e.target.value === '' ? undefined : +e.target.value)}
    />
  )
}

/** Sobrescrita só é gravada se diferir do padrão. */
const differs = (v: number | undefined, def: number) => v !== undefined && Math.abs(v - def) > 1e-12

export default function ParamsEditor({ params, onChange, type, diameter, defaultOpen }: Props) {
  const av = avEffective(params, type, diameter)
  const avDef = avEffective({ avSet: params.avSet }, type, diameter)
  const dq = dqEffective(params, type)
  const dqDef = dqEffective(undefined, type)

  const set = (patch: Partial<CapacityParams>) => onChange({ ...params, ...patch })

  return (
    <details className="card" open={defaultOpen || undefined}>
      <summary>
        Parâmetros de cálculo {hasOverrides(params) && <span className="badge">editados</span>}
      </summary>
      <p className="hint">
        Os valores padrão vêm da NBR 6122 e de Cintra & Aoki (2010), Décourt & Quaresma e Teixeira (1996). Edite para adotar outro valor por decisão
        técnica; campos alterados ficam destacados. Os parâmetros valem para o tipo de estaca selecionado: <b>{PILE_LABEL[type]}</b>.
      </p>
      <button onClick={() => onChange({})} disabled={!hasOverrides(params) && !params.avSet}>Restaurar todos os padrões</button>

      <h3>Aoki-Velloso</h3>
      <label>Conjunto de coeficientes (k, α, F1, F2)
        <select value={params.avSet ?? 'cintra'} onChange={(e) => set({ avSet: e.target.value as AvSetId, avSoil: undefined, avF: undefined })}>
          {(Object.keys(AV_SET_LABEL) as AvSetId[]).map((s) => <option key={s} value={s}>{AV_SET_LABEL[s]}</option>)}
        </select>
      </label>
      <p className="hint">Conjunto efetivamente usado para {PILE_LABEL[type]}: <b>{AV_SET_LABEL[av.setUsed]}</b>. Trocar de conjunto descarta as edições de k/α/F.</p>
      <div className="row">
        <label>F1
          <Num value={av.F1} edited={differs(params.avF?.[type]?.F1, avDef.F1)}
            onSet={(v) => set({ avF: { ...params.avF, [type]: { ...params.avF?.[type], F1: differs(v, avDef.F1) ? v : undefined } } })} />
        </label>
        <label>F2
          <Num value={av.F2} edited={differs(params.avF?.[type]?.F2, avDef.F2)}
            onSet={(v) => set({ avF: { ...params.avF, [type]: { ...params.avF?.[type], F2: differs(v, avDef.F2) ? v : undefined } } })} />
        </label>
      </div>
      <table>
        <thead><tr><th>Solo</th><th>K (kPa)</th><th>α (%)</th><th>C Décourt (kPa)</th><th>α Teixeira (kPa)</th></tr></thead>
        <tbody>
          {SOIL_TYPES.map((s) => {
            const v = av.soilValue(s), d = avDef.soilValue(s)
            const c = dq.C(s), cd = dqDef.C(s)
            const t = txEffective(params, type, s), td = txEffective(undefined, type, s)
            return (
              <tr key={s}>
                <td>{SOIL_LABEL[s]}</td>
                <td><Num value={v.K} edited={differs(params.avSoil?.[s]?.K, d.K)}
                  onSet={(x) => set({ avSoil: { ...params.avSoil, [s]: { ...params.avSoil?.[s], K: differs(x, d.K) ? x : undefined } } })} /></td>
                <td><Num value={v.alpha * 100} edited={differs(params.avSoil?.[s]?.alpha, d.alpha)}
                  onSet={(x) => set({ avSoil: { ...params.avSoil, [s]: { ...params.avSoil?.[s], alpha: x === undefined || !differs(x / 100, d.alpha) ? undefined : x / 100 } } })} /></td>
                <td><Num value={c.C} edited={differs(params.dqC?.[s], cd.C)}
                  onSet={(x) => set({ dqC: { ...params.dqC, [s]: differs(x, cd.C) ? x : undefined } })} /></td>
                <td><Num value={t.alpha} edited={differs(params.txAlpha?.[type]?.[s], td.alpha)}
                  onSet={(x) => set({ txAlpha: { ...params.txAlpha, [type]: { ...params.txAlpha?.[type], [s]: differs(x, td.alpha) ? x : undefined } } })} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3>Décourt-Quaresma — α e β para {PILE_LABEL[type]}</h3>
      <table>
        <thead><tr><th>Solo</th><th>α (ponta)</th><th>β (lateral)</th></tr></thead>
        <tbody>
          {CLASSES.map(({ id, label }) => (
            <tr key={id}>
              <td>{label}</td>
              <td><Num value={dq.alpha(id)} edited={differs(params.dqAlpha?.[type]?.[id], dqDef.alpha(id))}
                onSet={(x) => set({ dqAlpha: { ...params.dqAlpha, [type]: { ...params.dqAlpha?.[type], [id]: differs(x, dqDef.alpha(id)) ? x : undefined } } })} /></td>
              <td><Num value={dq.beta(id)} edited={differs(params.dqBeta?.[type]?.[id], dqDef.beta(id))}
                onSet={(x) => set({ dqBeta: { ...params.dqBeta, [type]: { ...params.dqBeta?.[type], [id]: differs(x, dqDef.beta(id)) ? x : undefined } } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <label>Limite superior de N<sub>L</sub>
          <Num value={dq.nlMax} edited={differs(params.dqNlMax?.[type], dqDef.nlMax)}
            onSet={(x) => set({ dqNlMax: { ...params.dqNlMax, [type]: differs(x, dqDef.nlMax) ? x : undefined } })} />
        </label>
        <label>β Teixeira (kPa)
          <Num value={txEffective(params, type, 'areia').beta} edited={differs(params.txBeta?.[type], txEffective(undefined, type, 'areia').beta)}
            onSet={(x) => set({ txBeta: { ...params.txBeta, [type]: differs(x, txEffective(undefined, type, 'areia').beta) ? x : undefined } })} />
        </label>
      </div>
    </details>
  )
}
