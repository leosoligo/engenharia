import { useMemo, useState } from 'react'
import { DEFAULT_EBERICK, matchSections, parseEberick, parseEberickSections, toCombinations, type EberickOptions, type EberickParse, type EberickSection } from '../core/eberick'
import type { LoadCombination } from '../core/loads'
import { readXlsx } from '../core/xlsx'
import { Field, num } from '../ui/fields'

const nf = (x: number, d = 0) => x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })

const G = 9.80665

interface Props {
  /** `sections`: seção (cm) por pilar importado, quando o relatório de cargas foi informado. */
  onImport: (combos: LoadCombination[], sections: Record<string, { ax: number; ay: number }>) => void
}

/** Importação do relatório de esforços nas fundações do Eberick (.xlsx), com opções de conversão e seleção de elementos. */
export default function EberickImport({ onImport }: Props) {
  const [parsed, setParsed] = useState<EberickParse | undefined>()
  const [error, setError] = useState('')
  const [opt, setOpt] = useState<EberickOptions>(DEFAULT_EBERICK)
  const [chosen, setChosen] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [secs, setSecs] = useState<EberickSection[] | undefined>()
  const [secName, setSecName] = useState('')
  const [map, setMap] = useState<Record<string, string | undefined>>({})
  const [swap, setSwap] = useState(false)

  const onFile = async (file: File) => {
    setError('')
    try {
      const rows = readXlsx(new Uint8Array(await file.arrayBuffer()))
      const p = parseEberick(rows)
      setParsed(p)
      setChosen(p.foundations.map((f) => f.name))
      setFileName(file.name)
      if (secs) setMap(matchSections(p, secs))
      if (p.foundations.length === 0) setError(p.warnings[0] ?? 'Arquivo não reconhecido.')
    } catch (e) {
      setParsed(undefined)
      setError(`Não foi possível ler o arquivo: ${(e as Error).message}. Use o .xlsx exportado pelo Eberick (Relatório de esforços nas fundações).`)
    }
  }

  const onSecFile = async (file: File) => {
    setError('')
    try {
      const r = parseEberickSections(readXlsx(new Uint8Array(await file.arrayBuffer())))
      if (r.sections.length === 0) throw new Error(r.warnings[0] ?? 'nenhum pilar reconhecido')
      setSecs(r.sections)
      setSecName(file.name)
      if (parsed) setMap(matchSections(parsed, r.sections))
    } catch (e) {
      setSecs(undefined)
      setError(`Não foi possível ler o relatório de cargas: ${(e as Error).message}.`)
    }
  }

  const sectionsOut = useMemo(() => {
    const out: Record<string, { ax: number; ay: number }> = {}
    if (!parsed || !secs) return out
    for (const f of parsed.foundations) {
      const s = secs.find((x) => x.name === map[f.name])
      if (s?.a && s?.b) out[f.name] = swap ? { ax: s.b, ay: s.a } : { ax: s.a, ay: s.b }
    }
    return out
  }, [parsed, secs, map, swap])

  const preview = useMemo(() => (parsed ? toCombinations(parsed, { ...opt, only: chosen }) : []), [parsed, opt, chosen])
  const perFound = parsed?.foundations.filter((f) => chosen.includes(f.name)).map((f) => ({ name: f.name, total: f.combos.length, used: preview.filter((c) => c.pillar === f.name && c.state === 'ELS').length, nmax: Math.max(...f.combos.map((r) => r.N)) })) ?? []

  return (
    <section className="card eb">
      <h2>Importar do Eberick (AltoQi)</h2>
      <p className="hint">Arquivo <b>.xlsx</b> do “Relatório de esforços nas fundações por elementos”. Cada elemento (B1, B2…) vira um pilar com as suas combinações.</p>
      <div className="row">
        <label className="btn primary-ghost">1. Relatório de esforços (combinações) .xlsx<input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f) }} /></label>
        {fileName && <span className="hint">{fileName}</span>}
        <label className="btn">2. Relatório de cargas (seções) .xlsx — opcional<input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onSecFile(f) }} /></label>
        {secName && <span className="hint">{secName} ({secs?.length} pilares)</span>}
      </div>
      <p className="hint">Os dois arquivos se complementam: o de esforços traz as combinações; o de cargas (só os máximos) traz a seção de cada pilar. Eles são associados pelo número e conferidos pela carga máxima.</p>
      {error && <p className="warn">{error}</p>}

      {parsed && parsed.foundations.length > 0 && (
        <>
          <div className="note">
            <b>Como os valores são interpretados (confira):</b>
            <ul>
              <li>Os esforços do relatório são tratados como <b>característicos</b> (as combinações trazem só os coeficientes ψ, sem γf) e entram como <b>ELS</b>: verificação de deslocamento e carga admissível.</li>
              <li>O relatório <b>não traz ELU</b>. Para dimensionar estaca e bloco, o ELU é obtido multiplicando as mesmas combinações por γf (padrão 1,4, editável abaixo).</li>
              <li>Unidades convertidas: tf → kN (×9,80665) e kgf·m → kN·m. <b>Mt</b> vira Mz (torção).</li>
              <li>Sinais: N positivo é compressão; Mx e My são mantidos como no relatório (regra da mão direita em torno de X e Y). O relatório não informa os eixos: se o seu modelo usa outra convenção, marque “inverter”.</li>
              <li>O relatório <b>não traz a seção do pilar nem a sondagem</b> de cada elemento: serão usadas a seção padrão e as sondagens do passo 1 (ajuste por pilar abaixo).</li>
            </ul>
          </div>
          <div className="row">
            <Field label="Combinações a importar">
              <select value={opt.select} onChange={(e) => setOpt({ ...opt, select: e.target.value as EberickOptions['select'] })}>
                <option value="criticas">Somente as críticas (recomendado)</option>
                <option value="todas">Todas ({parsed.foundations[0]?.combos.length} por elemento)</option>
              </select>
            </Field>
            <Field label="γf para gerar o ELU" hint="0 = não gerar ELU"><input type="number" step={0.05} min={0} value={opt.gammaF} onChange={(e) => setOpt({ ...opt, gammaF: num(e.target.value, 1.4) })} /></Field>
            <label className="inline"><input type="checkbox" checked={opt.invertMx} onChange={(e) => setOpt({ ...opt, invertMx: e.target.checked })} /> inverter sinal de Mx</label>
            <label className="inline"><input type="checkbox" checked={opt.invertMy} onChange={(e) => setOpt({ ...opt, invertMy: e.target.checked })} /> inverter sinal de My</label>
          </div>
          {parsed.foundations[0]?.combos[0] && (
            <p className="hint">Conferência de unidades (1ª combinação de {parsed.foundations[0].name}): N = <b>{nf(parsed.foundations[0].combos[0].N / G, 2)} tf</b> → <b>{nf(parsed.foundations[0].combos[0].N, 1)} kN</b> · Mx = {nf(parsed.foundations[0].combos[0].Mx / G * 1000, 1)} kgf·m → <b>{nf(parsed.foundations[0].combos[0].Mx, 2)} kN·m</b> · Vx = {nf(parsed.foundations[0].combos[0].Vx / G, 2)} tf → <b>{nf(parsed.foundations[0].combos[0].Vx, 2)} kN</b> (1 tf = 9,80665 kN; 1 kgf·m = 0,00980665 kN·m). O programa trabalha internamente em kN e kN·m; na tela Cargas você pode exibir e editar em tf.</p>
          )}
          {secs && (
            <label className="inline"><input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} /> trocar a ordem da seção (o relatório escreve “14x30”; por padrão o 1º valor é a dimensão em X e o 2º em Y — confira no Eberick)</label>
          )}
          <p className="hint">“Críticas” escolhe, por elemento, as combinações com N máximo e mínimo, Mx, My, Vx, Vy, momento resultante, cortante resultante e maior excentricidade (M/N) máximos — cobre os extremos, mas não garante conter a combinação governante de cada verificação; use “todas” para conferência final (o cálculo fica mais lento).</p>

          <div className="row between"><h4>Elementos ({chosen.length} de {parsed.foundations.length})</h4>
            <div className="row"><button onClick={() => setChosen(parsed.foundations.map((f) => f.name))}>Todos</button><button onClick={() => setChosen([])}>Nenhum</button></div>
          </div>
          <div className="scroll-x tall">
            <table className="mini-t">
              <thead><tr><th /><th>Elemento</th><th>Combinações no arquivo</th><th>Importadas (ELS)</th><th>N máx. (kN)</th>{secs && <><th>Pilar no relatório de cargas</th><th>Seção (cm)</th></>}</tr></thead>
              <tbody>
                {parsed.foundations.map((f) => {
                  const on = chosen.includes(f.name)
                  const row = perFound.find((r) => r.name === f.name)
                  return (
                    <tr key={f.name} className={on ? '' : 'dim'}>
                      <td><input type="checkbox" checked={on} onChange={(e) => setChosen(e.target.checked ? [...chosen, f.name] : chosen.filter((x) => x !== f.name))} /></td>
                      <td>{f.name}</td><td>{f.combos.length}</td><td>{row?.used ?? '—'}</td><td>{nf(Math.max(...f.combos.map((r) => r.N)), 1)}</td>
                      {secs && (
                        <>
                          <td><select value={map[f.name] ?? ''} onChange={(e) => setMap({ ...map, [f.name]: e.target.value || undefined })}><option value="">—</option>{secs.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></td>
                          <td>{sectionsOut[f.name] ? `${sectionsOut[f.name].ax} × ${sectionsOut[f.name].ay}` : <span className="hint">não informada (usa o padrão)</span>}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" disabled={preview.length === 0} onClick={() => { onImport(preview, sectionsOut); setParsed(undefined); setFileName(''); setSecs(undefined); setSecName('') }}>Importar {chosen.length} elemento(s) · {preview.length} combinações</button>
            <button onClick={() => { setParsed(undefined); setFileName('') }}>Cancelar</button>
          </div>
        </>
      )}
    </section>
  )
}
