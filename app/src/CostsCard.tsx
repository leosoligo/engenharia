import { PILE_LABEL } from './core/pile'
import type { ExtraCost } from './core/optimize'
import { SINAPI_INFO, UF_LIST, baseline, execKey, resolveCosts, type CostOverrides, type Regime } from './costs'
import { OPTIMIZABLE_TYPES, type Settings } from './settings'
import { Field, num } from './ui/fields'

type ScalarKey = 'concretePerM3' | 'concreteOverrun' | 'steelPerKg' | 'blockSteelPerKg' | 'mobilizationPerPile' | 'blockConcretePerM3' | 'blockFormPerM2' | 'leanPerM2'

export default function CostsCard({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const types = OPTIMIZABLE_TYPES.filter((t) => s.typesEnabled[t])
  const base = baseline(s.costSource, types, s.diameters)
  const eff = resolveCosts(s.costSource, types, s.diameters, s.costs)
  const ov = s.costs
  const hasEdits = Object.values(ov).some((v) => v !== undefined && (typeof v !== 'object' || (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)))
  const setOv = (patch: Partial<CostOverrides>) => set({ costs: { ...ov, ...patch } })
  const fmt = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

  const scalar = (key: ScalarKey, label: string, hint?: string, scale = 1) => {
    const bv = (base.costs[key] ?? 0) as number
    const ev = (eff[key] ?? 0) as number
    const edited = ov[key] !== undefined
    return (
      <Field label={label} hint={edited ? `valor-base: ${fmt(bv * scale)}` : hint}>
        <input
          className={edited ? 'edited' : ''}
          type="number" min={0} step="any"
          value={Math.round(ev * scale * 100) / 100}
          onChange={(e) => {
            const v = num(e.target.value, 0) / scale
            const next = { ...ov }
            if (Math.abs(v - bv) < 1e-9) delete next[key]
            else next[key] = v
            set({ costs: next })
          }}
        />
      </Field>
    )
  }

  const changeSource = (patch: Partial<Settings['costSource']>) => {
    if (hasEdits && !confirm('Trocar a origem dos custos descarta as edições feitas nos valores. Continuar?')) return
    set({ costSource: { ...s.costSource, ...patch }, costs: {} })
  }
  const sinapi = s.costSource.kind === 'sinapi'
  const cutDs = [...new Set(types.flatMap((t) => s.diameters[t]))].sort((a, b) => a - b)

  return (
    <section className="card">
      <h2><span className="ico">💰</span> Custos</h2>
      <div className="src">
        <div className="seg" role="tablist" aria-label="Origem dos custos">
          <button className={sinapi ? 'on' : ''} onClick={() => sinapi || changeSource({ kind: 'sinapi' })}>Tabela SINAPI</button>
          <button className={!sinapi ? 'on' : ''} onClick={() => !sinapi || changeSource({ kind: 'manual' })}>Informar manualmente</button>
        </div>
        {sinapi && (
          <div className="row">
            <label className="fld"><span>Estado</span>
              <select value={s.costSource.uf} onChange={(e) => changeSource({ uf: e.target.value })}>
                {UF_LIST.map((u) => <option key={u.uf} value={u.uf}>{u.uf} — {u.name}</option>)}
              </select>
            </label>
            <label className="fld"><span>Encargos sociais</span>
              <select value={s.costSource.regime} onChange={(e) => changeSource({ regime: e.target.value as Regime })}>
                <option value="nao">Sem desoneração</option>
                <option value="des">Com desoneração</option>
              </select>
            </label>
            <button disabled={!hasEdits} onClick={() => set({ costs: {} })}>Restaurar valores SINAPI</button>
          </div>
        )}
      </div>
      {sinapi ? (
        <p className="hint">
          Valores iniciais do SINAPI (CAIXA/IBGE), referência <b>{SINAPI_INFO.reference}</b>, estado <b>{s.costSource.uf}</b>. Campos editados ficam
          destacados e podem ser alterados livremente. O custo da estaca vem da composição SINAPI (com concreto e bombeamento); “execução” = composição − concreto teórico.
        </p>
      ) : (
        <p className="hint">Informe os valores. Com todos em zero, o ranking sai por volume de concreto e massa de aço.</p>
      )}
      {sinapi && base.missingTypes.length > 0 && (
        <p className="note">Sem referência no SINAPI para: {base.missingTypes.map((t) => PILE_LABEL[t]).join(', ')}. Informe a execução (R$/m) desses tipos.</p>
      )}

      <div className="fgrid">
        {scalar('concretePerM3', 'Concreto da estaca (R$/m³)', sinapi ? 'SINAPI: concreto usinado bombeável C30' : undefined)}
        {scalar('concreteOverrun', 'Sobreconsumo de concreto (%)', undefined, 100)}
        {scalar('steelPerKg', 'Aço da estaca, montado (R$/kg)', sinapi ? 'SINAPI: montagem de armadura de estaca Ø16' : undefined)}
        {scalar('blockSteelPerKg', 'Aço do bloco, montado (R$/kg)', sinapi ? 'SINAPI: armação de bloco Ø12,5' : 'vazio = igual ao aço da estaca')}
        {scalar('blockConcretePerM3', 'Concreto do bloco, lançado (R$/m³)', sinapi ? 'SINAPI: concretagem de bloco fck 30, bomba' : undefined)}
        {scalar('blockFormPerM2', 'Forma do bloco (R$/m²)', sinapi ? 'SINAPI: compensado resinado, 4 usos' : undefined)}
        {scalar('leanPerM2', 'Lastro de concreto magro (R$/m²)', sinapi ? 'SINAPI: lastro de 5 cm' : undefined)}
        {scalar('mobilizationPerPile', 'Mobilização (R$/estaca)', 'não existe no SINAPI')}
      </div>

      <h3>Execução da estaca (R$ por metro)</h3>
      <table className="costtable">
        <thead><tr><th>Tipo</th><th>Diâmetro (cm) → R$/m</th></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t}>
              <td>{PILE_LABEL[t]}</td>
              <td className="wrap">
                <div className="chips">
                  {s.diameters[t].map((d) => {
                    const k = execKey(t, d)
                    const bv = base.costs.executionPerM[k] ?? 0
                    const ev = eff.executionPerM[k] ?? 0
                    const edited = ov.executionPerM?.[k] !== undefined
                    return (
                      <label key={k} className="chip-in" title={base.estimated.has(k) ? 'Estimado por interpolação/escala (diâmetro sem composição no SINAPI)' : undefined}>
                        <span>Ø{d}{base.estimated.has(k) ? '*' : ''}</span>
                        <input
                          className={edited ? 'edited' : ''} type="number" min={0} value={Math.round(ev * 100) / 100}
                          onChange={(e) => {
                            const v = num(e.target.value, 0)
                            const m = { ...(ov.executionPerM ?? {}) }
                            if (Math.abs(v - bv) < 1e-9) delete m[k]
                            else m[k] = v
                            setOv({ executionPerM: m })
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
              </td>
            </tr>
          ))}
          {types.length === 0 && <tr><td colSpan={2} className="wrap">Marque ao menos um tipo de estaca.</td></tr>}
        </tbody>
      </table>
      {sinapi && <p className="hint">* diâmetro sem composição própria no SINAPI: valor estimado (interpolado entre diâmetros vizinhos ou escalado pela área).</p>}

      <h3>Arrasamento da estaca (R$ por estaca)</h3>
      <div className="fgrid fgrid-sm">
        {cutDs.map((d) => {
          const k = String(d)
          const bv = base.costs.cutOffByDiameter[k] ?? 0
          const ev = eff.cutOffByDiameter[k] ?? eff.cutOffPerPile
          const edited = ov.cutOffByDiameter?.[k] !== undefined
          return (
            <Field key={d} label={`Ø${d} cm`}>
              <input
                className={edited ? 'edited' : ''} type="number" min={0} value={Math.round(ev * 100) / 100}
                onChange={(e) => {
                  const v = num(e.target.value, 0)
                  const m = { ...(ov.cutOffByDiameter ?? {}) }
                  if (Math.abs(v - bv) < 1e-9) delete m[k]
                  else m[k] = v
                  setOv({ cutOffByDiameter: m })
                }}
              />
            </Field>
          )
        })}
      </div>

      <h3>Outros custos</h3>
      {(ov.extras ?? []).length > 0 && (
        <table>
          <thead><tr><th>Descrição</th><th>Cobrado</th><th>Valor (R$)</th><th /></tr></thead>
          <tbody>
            {(ov.extras ?? []).map((x, i) => {
              const upd = (patch: Partial<ExtraCost>) => setOv({ extras: (ov.extras ?? []).map((y, j) => (j === i ? { ...y, ...patch } : y)) })
              return (
                <tr key={i}>
                  <td><input value={x.name} onChange={(e) => upd({ name: e.target.value })} /></td>
                  <td>
                    <select value={x.basis} onChange={(e) => upd({ basis: e.target.value as ExtraCost['basis'] })}>
                      <option value="porEstaca">por estaca</option>
                      <option value="porBloco">por bloco</option>
                      <option value="porMetroDeEstaca">por metro de estaca</option>
                      <option value="porM3DeEstaca">por m³ de estaca</option>
                    </select>
                  </td>
                  <td><input type="number" min={0} value={x.value} onChange={(e) => upd({ value: num(e.target.value, 0) })} /></td>
                  <td><button className="small" onClick={() => setOv({ extras: (ov.extras ?? []).filter((_, j) => j !== i) })} aria-label="Remover">×</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <button onClick={() => setOv({ extras: [...(ov.extras ?? []), { name: 'Novo item', basis: 'porEstaca', value: 0 }] })}>+ adicionar item de custo</button>
    </section>
  )
}
