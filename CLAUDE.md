# Estakalc — contexto do projeto

Programa de navegador (Vite + React 19 + TypeScript, Vitest, oxlint) para dimensionar fundações profundas verticais: estacas e blocos de coroamento. Saída única em `Estakalc.html` (arquivo único, abre sem servidor). Idioma de tudo: português do Brasil.

## Premissas combinadas com o usuário (valem sempre)
- **Não mentir nem inventar valores.** Qualquer dúvida de critério, norma ou parâmetro: consultar o usuário antes. Valores sem fonte são editáveis e assumidos como tal, ditos na resposta e no aviso do programa.
- **Padrões mais conservadores, mas editáveis** pelo usuário em Parâmetros dos métodos. Exceções decididas por ele (ex.: folga do bloco padrão = Bastos, grande porte, 15 cm da face; tensão N/A da Tab. 4 com coeficiente 1,0 = carga de cálculo).
- **Só estacas verticais.** Nível d'água informado pelo usuário (ou "não encontrado").
- **Não citar programas comerciais** em nenhum lugar do software (telas, memorial, DXF). Citar só autores de livros e normas (Campos, Velloso & Lopes, Cintra & Aoki, Bastos/Machado, Alonso, Marangon etc.; NBR 6118:2026, NBR 6122:2022, NBR 16258:2014, NBR 6484). Em testes e no PLANO.md a fonte acadêmica (TCC de Pacchioni) pode ser citada.
- Unidades de exibição kN ou tf à escolha; o cálculo é sempre em kN e kN·m. Convenção de esforços: Fz > 0 compressão; Mx > 0 comprime o lado de y menor; My > 0 comprime o lado de x maior (vetorial).
- Mensagens do cálculo usam vírgula decimal (`fx()` em `app/src/core/format.ts`) e `unitText()` converte kN → tf na exibição.
- Direitos autorais: os PDFs de livros/normas ficam em `Fontes/` e `Normas/` (ignorados pelo git; nunca versionar). Dados de projetos reais de clientes também não vão ao repositório.

## Estrutura (app/src)
- `core/capacity` Aoki-Velloso, Décourt-Quaresma, Teixeira + segurança NBR 6122 (ξ); `core/lateral` p-y (FE, P-Δ, Pcr); `core/group` bloco rígido + efeito de grupo (Davisson).
- `core/structural` estaca circular: Tab. 4 da NBR 6122, flexo-compressão, cortante, gaiola (tensão N/A, normal N(z) com atrito lateral), manuseio de pré-moldadas (NBR 16258).
- `core/block` blocos: Blévot (Campos), roteiro Machado/Bastos (`machado.ts`), CEB-70 (flexão), fissuração (`crack.ts`), contornos típicos por arranjo.
- `core/special` argila mole, atrito negativo, recalque do grupo. `core/optimize` busca econômica; `core/join.ts` bloco comum a dois pilares.
- `export` DXF, memorial (HTML/PDF e DOCX via `doc.ts`), tabela de ferros, comparativo CSV. `ui`/`pages` interface.

## Como trabalhar
- Comandos (em `app/`): `npx tsc -b`, `npx vitest run` (cerca de 2,5 min; muitos testes de validação), `npx oxlint`, `npx vite build` e depois `cp dist/index.html ../Estakalc.html`. Dev server: `npm run dev` (porta 5173).
- Ao fim de cada entrega: rodar tsc, vitest, oxlint, gerar `Estakalc.html` e registrar a mudança em `PLANO.md` (seções numeradas).
- Toda regra nova de norma ou fórmula de livro deve virar teste com valores publicados (exemplos resolvidos: Bastos 1–3, Campos, TCC de Pacchioni em `validacao-tcc.test.ts`). Divergências com o literal devem ser explicadas, nunca escondidas.
- Python/PyMuPDF e `pdftotext` servem para ler PDFs em `Fontes/` e `Normas/` (PDFs sem texto: renderizar a página e ler a imagem).
- Interface verificada no navegador embutido do app (`preview_start`/`navigate` em `http://localhost:5173`).
