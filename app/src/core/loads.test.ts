import { describe, expect, it } from 'vitest'
import { groupByPillar, LOADS_CSV_TEMPLATE, parseLoadsCsv } from './loads'

describe('parseLoadsCsv', () => {
  it('lê o modelo, ignora comentários, agrupa por pilar', () => {
    const r = parseLoadsCsv(LOADS_CSV_TEMPLATE)
    expect(r.errors).toEqual([])
    expect(r.combinations).toHaveLength(4)
    expect(r.combinations[0]).toMatchObject({ pillar: 'P1', state: 'ELS', fx: 5, fz: 820, my: -35, mz: 0 })
    expect([...groupByPillar(r.combinations).keys()]).toEqual(['P1', 'P2'])
  })
  it('mz é opcional (vale 0); decimal com vírgula e cabeçalho com acento/maiúsculas', () => {
    const r = parseLoadsCsv(['Pilar;Combinação;Tipo;Fx;Fy;Fz;Mx;My', 'A;c1;elu;1,5;2;300,5;0;-3,25'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.combinations[0]).toMatchObject({ state: 'ELU', fx: 1.5, fz: 300.5, my: -3.25, mz: 0 })
  })
  it('separador vírgula com ponto decimal', () => {
    const r = parseLoadsCsv(['pilar,combinacao,tipo,fx,fy,fz,mx,my', 'A,c1,ELS,1.5,2,300.5,0,0'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.combinations[0].fz).toBe(300.5)
  })
  it('erros por linha: tipo inválido, número inválido, duplicata', () => {
    const r = parseLoadsCsv(
      ['pilar;combinacao;tipo;fx;fy;fz;mx;my', 'A;c1;XYZ;0;0;1;0;0', 'A;c2;ELU;0;0;abc;0;0', 'A;c3;ELU;0;0;1;0;0', 'A;c3;ELU;0;0;1;0;0'].join('\n'),
    )
    expect(r.combinations).toEqual([])
    expect(r.errors.some((e) => e.startsWith('Linha 2') && e.includes('ELU ou ELS'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('Linha 3') && e.includes('fz'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('Linha 5') && e.includes('repetida'))).toBe(true)
  })
  it('exige colunas obrigatórias', () => {
    expect(parseLoadsCsv('pilar;combinacao;tipo;fx\nA;c;ELU;1').errors.length).toBeGreaterThan(0)
  })
})

describe('CSV com seção do pilar (colunas opcionais ax e ay, cm)', () => {
  it('lê as seções por pilar e recusa seções conflitantes', async () => {
    const { parseLoadsCsv } = await import('./loads')
    const ok = parseLoadsCsv('pilar;combinacao;tipo;fx;fy;fz;mx;my;mz;ax;ay\nP1;a;ELS;0;0;100;0;0;0;25;120\nP1;b;ELS;0;0;110;0;0;0;25;120\nP2;a;ELS;0;0;90;0;0;0;40;40')
    expect(ok.errors).toEqual([])
    expect(ok.sections).toEqual({ P1: { ax: 25, ay: 120 }, P2: { ax: 40, ay: 40 } })
    const bad = parseLoadsCsv('pilar;combinacao;tipo;fx;fy;fz;mx;my;mz;ax;ay\nP1;a;ELS;0;0;100;0;0;0;25;120\nP1;b;ELS;0;0;110;0;0;0;30;120')
    expect(bad.errors.join(' ')).toContain('seções diferentes')
    expect(parseLoadsCsv('pilar;combinacao;tipo;fx;fy;fz;mx;my\nP1;a;ELS;0;0;100;0;0').sections).toBeUndefined()
  })
})
