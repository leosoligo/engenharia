import { PILE_LABEL, type PileType } from './core/pile'
import CostsCard from './CostsCard'
import { Field, num } from './ui/fields'
import type { SafetyMode } from './core/capacity'
import { DEFAULT_SETTINGS, OPTIMIZABLE_TYPES, type Settings } from './settings'

interface Props {
  s: Settings
  onChange: (s: Settings) => void
  view: 'basic' | 'advanced'
}

const SAFETY_LABEL: Record<SafetyMode, string> = {
  conservador: 'Conservador — o menor entre a NBR 6122 e o FS global',
  'nbr-admissivel': 'NBR 6122:2022 — Rk/1,4 com fatores ξ',
  global: 'FS global',
}

export default function SettingsPanel({ s, onChange, view }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch })
  const edited = (a: unknown, b: unknown) => (JSON.stringify(a) === JSON.stringify(b) ? '' : 'edited')

  if (view === 'basic')
    return (
      <>
        <section className="card">
          <h2><span className="ico">🏗️</span> O que pode ser usado</h2>
          <p className="hint">Marque os tipos de estaca que o software pode considerar e liste os diâmetros (cm) que sua empresa executa.</p>
          <div className="typegrid">
            {OPTIMIZABLE_TYPES.map((t: PileType) => (
              <div key={t} className={`typecard ${s.typesEnabled[t] ? 'on' : ''}`}>
                <label className="inline strong">
                  <input type="checkbox" checked={s.typesEnabled[t]} onChange={(e) => set({ typesEnabled: { ...s.typesEnabled, [t]: e.target.checked } })} />
                  {PILE_LABEL[t]}
                </label>
                <input
                  className={edited(s.diameters[t], DEFAULT_SETTINGS.diameters[t])}
                  defaultValue={s.diameters[t].join(', ')}
                  key={s.diameters[t].join(',')}
                  disabled={!s.typesEnabled[t]}
                  aria-label={`Diâmetros de ${PILE_LABEL[t]} (cm)`}
                  onBlur={(e) => set({ diameters: { ...s.diameters, [t]: e.target.value.split(/[;,\s]+/).map(Number).filter((v) => v > 0) } })}
                />
                <small>diâmetros em cm</small>
              </div>
            ))}
          </div>
          <p className="hint">Pré-moldada não aparece: o dimensionamento estrutural dela segue a NBR 16258 e os dados do fabricante.</p>
        </section>

        <section className="card">
          <h2><span className="ico">✅</span> Critérios principais</h2>
          <div className="fgrid">
            <Field label="Deslocamento horizontal máximo no topo (mm)" hint="Valor sugerido: 25 mm. É um critério de projeto, não de norma: depende da estrutura apoiada.">
              <input className={edited(s.serviceLimitMm, 25)} type="number" min={1} value={s.serviceLimitMm} onChange={(e) => set({ serviceLimitMm: num(e.target.value, 25) })} />
            </Field>
            <Field label="Agressividade do ambiente (CAA)" hint="Define cobrimento e concreto mínimo (NBR 6118 e 6122).">
              <select value={s.caa} onChange={(e) => set({ caa: +e.target.value as Settings['caa'] })}>
                <option value={1}>I — fraca</option><option value={2}>II — moderada</option><option value={3}>III — forte</option><option value={4}>IV — muito forte</option>
              </select>
            </Field>
            <Field label="Armadura transversal da estaca">
              <select value={s.transverse} onChange={(e) => set({ transverse: e.target.value as Settings['transverse'] })}>
                <option value="estribo">Estribos fechados (padrão)</option>
                <option value="helicoidal">Armadura helicoidal</option>
              </select>
            </Field>
            <Field label="Base do bloco abaixo do terreno (m)">
              <input className={edited(s.topDepth, 1)} type="number" step={0.1} min={0} value={s.topDepth} onChange={(e) => set({ topDepth: num(e.target.value, 1) })} />
            </Field>
            <Field label="Comprimento da estaca" hint="Automático: o programa procura a menor profundidade que atende a capacidade e o deslocamento (mais profundo só encareceria). Fixo: você define.">
              <select value={s.lengthMode} onChange={(e) => set({ lengthMode: e.target.value as Settings['lengthMode'] })}>
                <option value="auto">Automático (a menor que atende)</option><option value="fixo">Fixo (definido por mim)</option>
              </select>
            </Field>
            {s.lengthMode === 'fixo' ? (
              <Field label="Comprimento fixo da estaca (m) *" hint="Medido a partir da base do bloco; deve caber na sondagem (profundidade da sondagem − base do bloco)."><input className={s.lengthFixed === 9 ? '' : 'edited'} type="number" min={1} step={1} value={s.lengthFixed} onChange={(e) => set({ lengthFixed: Math.max(1, num(e.target.value, 9)) })} /></Field>
            ) : (
              <>
                <Field label="Comprimento mínimo da estaca (m)"><input type="number" min={1} value={s.Lmin} onChange={(e) => set({ Lmin: num(e.target.value, 3) })} /></Field>
                <Field label="Comprimento máximo da estaca (m)" hint="Limitado também pela profundidade da sondagem."><input type="number" min={2} value={s.Lmax} onChange={(e) => set({ Lmax: num(e.target.value, 40) })} /></Field>
              </>
            )}
          </div>
        </section>

        <CostsCard s={s} set={set} />
      </>
    )

  // ------------------------------------------------ avançado
  return (
    <>
      <section className="card">
        <h2><span className="ico">⚙️</span> Análise do solo e do grupo</h2>
        <div className="fgrid">
          <Field label="Critério de carga admissível">
            <select value={s.safetyMode} onChange={(e) => set({ safetyMode: e.target.value as SafetyMode })}>
              {(Object.keys(SAFETY_LABEL) as SafetyMode[]).map((m) => <option key={m} value={m}>{SAFETY_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="FS global"><input className={edited(s.fsGlobal, 2)} type="number" min={1} step={0.1} value={s.fsGlobal} onChange={(e) => set({ fsGlobal: num(e.target.value, 2) })} /></Field>
          <Field label="Carregamento p-y">
            <select value={s.loading} onChange={(e) => set({ loading: e.target.value as Settings['loading'] })}>
              <option value="static">Estático</option><option value="cyclic">Cíclico</option>
            </select>
          </Field>
          <Field label="Efeito de grupo lateral">
            <select value={s.groupEffect} onChange={(e) => set({ groupEffect: e.target.value as Settings['groupEffect'] })}>
              <option value="davisson">Davisson (1970): 25 % a 3B, 100 % a 8B</option><option value="none">Desprezar</option>
            </select>
          </Field>
          <Field label="Cabeça da estaca no bloco">
            <select value={s.headFixity} onChange={(e) => set({ headFixity: e.target.value as Settings['headFixity'] })}>
              <option value="engastada">Engastada</option><option value="articulada">Articulada</option>
            </select>
          </Field>
          <Field label="Estacas tracionadas">
            <select value={s.permitTension ? 'sim' : 'nao'} onChange={(e) => set({ permitTension: e.target.value === 'sim' })}>
              <option value="nao">Não permitir</option><option value="sim">Permitir (capacidade = atrito admissível)</option>
            </select>
          </Field>
          <Field label="Excentricidade executiva (cm)" hint="Somada ao momento de cálculo (NBR 6122:2022, 8.5.6.1).">
            <input className={edited(s.execEccentricityCm, 0)} type="number" min={0} value={s.execEccentricityCm} onChange={(e) => set({ execEccentricityCm: num(e.target.value, 0) })} />
          </Field>
        </div>
        <h3>Métodos de capacidade de carga</h3>
        <p className="hint">Forma de combinar (menor ou média) e percentuais de ponta e lateral: em “Parâmetros dos métodos → Capacidade de carga”.</p>
        <div className="checks">
          {(['aoki-velloso', 'decourt-quaresma', 'teixeira'] as const).map((m) => (
            <label key={m} className="inline">
              <input type="checkbox" checked={s.methods[m]} onChange={(e) => set({ methods: { ...s.methods, [m]: e.target.checked } })} />
              {m === 'aoki-velloso' ? 'Aoki-Velloso' : m === 'decourt-quaresma' ? 'Décourt-Quaresma' : 'Teixeira'}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2><span className="ico">🧱</span> Rigidez, concreto e bloco</h2>
        <div className="fgrid">
          <Field label="Fator de rigidez EI (ELS)" hint="EI = fator × Ecs × I. 0,8 por analogia ao item 15.7.3 da NBR 6118:2026.">
            <input className={edited(s.eiFactor, 0.8)} type="number" step={0.05} min={0.1} max={1} value={s.eiFactor} onChange={(e) => set({ eiFactor: num(e.target.value, 0.8) })} />
          </Field>
          <Field label="EI não linear no ELU (momento-curvatura)">
            <select value={s.nonlinearEI ? 'sim' : 'nao'} onChange={(e) => set({ nonlinearEI: e.target.value === 'sim' })}>
              <option value="sim">Sim</option><option value="nao">Não (EI constante)</option>
            </select>
          </Field>
          <Field label="fck da estaca (MPa)" hint="Vazio = mínimo da Tab. 4 da NBR 6122:2022.">
            <input type="number" min={20} max={50} value={s.fck ?? ''} placeholder="mínimo da norma" onChange={(e) => set({ fck: e.target.value === '' ? null : +e.target.value })} />
          </Field>
          <Field label="fck inicial do bloco (MPa)" hint="Sobe para 35 e 40 se a biela não passar."><input type="number" min={25} max={50} value={s.blockFck} onChange={(e) => set({ blockFck: num(e.target.value, 30) })} /></Field>
          <Field label="α (bloco de 4 estacas)" hint="3/4 ≤ α ≤ 6/7; Campos recomenda 0,8."><input className={edited(s.blockAlpha, 0.8)} type="number" step={0.01} min={0.75} max={0.857} value={s.blockAlpha} onChange={(e) => set({ blockAlpha: num(e.target.value, 0.8) })} /></Field>
          <Field label="Eixo da estaca à borda do bloco: a = dE + (cm)" hint="Campos, Fig. 12.21: dE + 15 cm."><input className={edited(s.blockMarginCm, 15)} type="number" value={s.blockMarginCm} onChange={(e) => set({ blockMarginCm: num(e.target.value, 15) })} /></Field>
          <Field label="Peso específico do bloco (kN/m³)"><input className={edited(s.blockUnitWeight, 25)} type="number" value={s.blockUnitWeight} onChange={(e) => set({ blockUnitWeight: num(e.target.value, 25) })} /></Field>
          <Field label="Majoração do peso do bloco no ELU"><input className={edited(s.blockWeightFactorELU, 1.4)} type="number" step={0.05} value={s.blockWeightFactorELU} onChange={(e) => set({ blockWeightFactorELU: num(e.target.value, 1.4) })} /></Field>
          <Field label="Nº de soluções no ranking"><input type="number" min={1} max={30} value={s.maxResults} onChange={(e) => set({ maxResults: num(e.target.value, 8) })} /></Field>
        </div>
      </section>
    </>
  )
}
