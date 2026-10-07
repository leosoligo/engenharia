import { useMemo, useState } from 'react'
import { handlingCheck } from '../core/structural/handling'
import { Field, num } from '../ui/fields'
import { UtilBar } from '../ui/charts'
import type { Units } from '../ui/units'

const f = (x: number, d = 1) => x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })

/** Manuseio de estacas pré-moldadas (NBR 16258:2014): içamento por 1 e 2 pontos, flexão e armadura transversal. */
export default function HandlingPanel({ u }: { u: Units }) {
  const [v, setV] = useState({
    Dcm: 40, L: 12, n: 8, phi: 12.5, RsCm: 15, fckD: 20, fckF: 35, alpha: 1.3, gammaF: 1, gammaC: 1.4,
    stirPhi: 5, stirS: 10, stirSEnd: 5,
  })
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch })
  const r = useMemo(() => handlingCheck({
    D: v.Dcm / 100, L: v.L, n: v.n, phiMm: v.phi, Rs: v.RsCm / 100, fckDemold: v.fckD, fckFinal: v.fckF, alpha: v.alpha, gammaF: v.gammaF, gammaC: v.gammaC,
    stirrup: { phiMm: v.stirPhi, spacingCm: v.stirS, endSpacingCm: v.stirSEnd },
  }), [v])
  return (
    <>
      <section className="card">
        <h2>Manuseio de estacas pré-moldadas (NBR 16258:2014)</h2>
        <p className="hint">Verifica a flexão durante o içamento por 1 ponto (0,29·L) e por 2 pontos (0,21·L), com normal nula e ampliação dinâmica α ≥ 1,3, e a armadura transversal mínima (CA-60). A estaca é modelada como seção circular cheia armada; para seção vazada ou protendida use os dados do fabricante.</p>
        <div className="fgrid">
          <Field label="Diâmetro (cm)"><input type="number" min={15} value={v.Dcm} onChange={(e) => set({ Dcm: num(e.target.value, 40) })} /></Field>
          <Field label="Comprimento do segmento (m)"><input type="number" min={2} step={0.5} value={v.L} onChange={(e) => set({ L: num(e.target.value, 12) })} /></Field>
          <Field label="Barras longitudinais (nº)"><input type="number" min={4} value={v.n} onChange={(e) => set({ n: num(e.target.value, 8) })} /></Field>
          <Field label="Ø das barras (mm)"><input type="number" step={0.5} min={5} value={v.phi} onChange={(e) => set({ phi: num(e.target.value, 12.5) })} /></Field>
          <Field label="Raio do círculo das barras (cm)" hint="Do centro da seção ao eixo das barras."><input type="number" step={0.5} min={5} value={v.RsCm} onChange={(e) => set({ RsCm: num(e.target.value, 15) })} /></Field>
          <Field label="fck na desmoldagem (MPa)" hint="Vale para o içamento por 2 pontos."><input type="number" min={10} max={50} value={v.fckD} onChange={(e) => set({ fckD: num(e.target.value, 20) })} /></Field>
          <Field label="fck final (MPa)" hint="Vale para o içamento por 1 ponto."><input type="number" min={20} max={50} value={v.fckF} onChange={(e) => set({ fckF: num(e.target.value, 35) })} /></Field>
          <Field label="γc do concreto" hint="NBR 6122 / Campos: 1,3 com controle sistemático; senão 1,4."><input type="number" step={0.1} min={1.2} value={v.gammaC} onChange={(e) => set({ gammaC: num(e.target.value, 1.4) })} /></Field>
          <Field label="α (ampliação dinâmica)" hint="Mínimo 1,3 (NBR 16258, 6.2.1.1)."><input type="number" step={0.1} min={1.3} value={v.alpha} onChange={(e) => set({ alpha: num(e.target.value, 1.3) })} /></Field>
          <Field label="γf adicional sobre Mk,mín" hint="A norma chama o valor de 'momento mínimo de cálculo': padrão 1,0. Use 1,4 para majorar também."><input type="number" step={0.1} min={1} value={v.gammaF} onChange={(e) => set({ gammaF: num(e.target.value, 1) })} /></Field>
          <Field label="Estribo CA-60: Ø (mm)"><input type="number" step={0.1} min={3} value={v.stirPhi} onChange={(e) => set({ stirPhi: num(e.target.value, 5) })} /></Field>
          <Field label="Passo corrente (cm)"><input type="number" min={2} value={v.stirS} onChange={(e) => set({ stirS: num(e.target.value, 10) })} /></Field>
          <Field label="Passo nos 50 cm das pontas (cm)"><input type="number" min={2} value={v.stirSEnd} onChange={(e) => set({ stirSEnd: num(e.target.value, 5) })} /></Field>
        </div>
        <p className="hint">Peso próprio q = {f(r.q * u.k, 2)} {u.F}/m (γ = 25 kN/m³).</p>
      </section>
      <section className="card">
        <h3>Flexão no manuseio</h3>
        <div className="util-grid">
          {r.cases.map((c) => <UtilBar key={c.name} label={`${c.name} — fck ${c.fck} MPa`} value={c.Md * u.k} limit={c.MRd * u.k} unit={u.M} hint={`M norma ${f(c.Mnorm * u.k, 2)}; estática exata ${f(c.Mexact * u.k, 2)} ${u.M}`} />)}
        </div>
        <div className="scroll-x"><table className="mini-t">
          <thead><tr><th>Caso</th><th>Pontos (m do topo)</th><th>M norma ({u.M})</th><th>M exato ({u.M})</th><th>M adotado ({u.M})</th><th>MRd ({u.M})</th><th>Situação</th></tr></thead>
          <tbody>{r.cases.map((c) => <tr key={c.name}><td style={{ textAlign: 'left' }}>{c.name}</td><td>{c.points.map((p) => f(p, 2)).join(' · ')}</td><td>{f(c.Mnorm * u.k, 2)}</td><td>{f(c.Mexact * u.k, 2)}</td><td>{f(c.Md * u.k, 2)}</td><td>{f(c.MRd * u.k, 2)}</td><td>{c.ok ? 'OK' : 'NÃO ATENDE'}</td></tr>)}</tbody>
        </table></div>
        {r.transverse && (
          <>
            <h3>Armadura transversal (NBR 16258, 6.2.1.4)</h3>
            <div className="util-grid">
              <UtilBar label={`Trecho corrente: Asw/s ≥ ${r.transverse.minCorrente} cm²/m`} value={r.transverse.minCorrente} limit={r.transverse.AswCorrente} unit="cm²/m" digits={2} hint={`Adotado ${f(r.transverse.AswCorrente, 2)} cm²/m`} />
              <UtilBar label={`Extremidades (50 cm): Asw/s ≥ ${r.transverse.minExtremidade} cm²/m`} value={r.transverse.minExtremidade} limit={r.transverse.AswExtremidade} unit="cm²/m" digits={2} hint={`Adotado ${f(r.transverse.AswExtremidade, 2)} cm²/m`} />
            </div>
          </>
        )}
        <ul className="hint">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
    </>
  )
}
