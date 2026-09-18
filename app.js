/* ============================================================
   Estoque Fácil — controle de estoque + calculadora de preço justo
   Todos os dados ficam no localStorage do navegador.
   ============================================================ */

'use strict';

/* ----------------------------- Chaves e estado ----------------------------- */

const CHAVE_PRODUTOS = 'estoqueFacil.produtos';
const CHAVE_CONFIG   = 'estoqueFacil.config';

const CONFIG_PADRAO = {
    imposto:  6,     // % sobre o preço de venda
    cartao:   3,     // % sobre o preço de venda
    comissao: 0,     // % sobre o preço de venda (marketplace)
    margem:   30,    // % de lucro desejado
    minimo:   5      // estoque mínimo padrão
};

let produtos = [];
let config   = { ...CONFIG_PADRAO };
let ordenacao = { campo: 'nome', asc: true };

/* ----------------------------- Utilidades ----------------------------- */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Formata número como moeda brasileira. */
function moeda(valor) {
    return (Number(valor) || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
    });
}

/** Formata percentual. */
function pct(valor) {
    return (Number(valor) || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 1, maximumFractionDigits: 1
    }) + '%';
}

/** Converte string de input em número seguro (aceita vírgula). */
function num(valor, padrao = 0) {
    if (typeof valor === 'number') return isFinite(valor) ? valor : padrao;
    if (valor === null || valor === undefined || valor === '') return padrao;
    const n = parseFloat(String(valor).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : padrao;
}

/** Evita injeção de HTML ao exibir texto digitado pelo usuário. */
function escapar(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Arredonda para cima no centavo (evita prejuízo por arredondamento). */
function tetoCentavo(v) {
    return Math.ceil(v * 100 - 1e-9) / 100;
}

/** Mostra mensagem flutuante. */
let toastTimer = null;
function toast(mensagem, tipo = '') {
    const el = $('#toast');
    el.textContent = mensagem;
    el.className = 'toast ' + tipo;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ----------------------------- Persistência ----------------------------- */

function carregar() {
    try {
        const p = JSON.parse(localStorage.getItem(CHAVE_PRODUTOS) || '[]');
        produtos = Array.isArray(p) ? p : [];
    } catch { produtos = []; }

    try {
        const c = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || '{}');
        config = { ...CONFIG_PADRAO, ...(c && typeof c === 'object' ? c : {}) };
    } catch { config = { ...CONFIG_PADRAO }; }
}

function salvarProdutos() {
    localStorage.setItem(CHAVE_PRODUTOS, JSON.stringify(produtos));
}

function salvarConfig() {
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
}

/* ============================================================
   CALCULADORA DE PREÇO JUSTO
   ------------------------------------------------------------
   Lógica: o preço de venda (P) precisa cobrir o custo total (C),
   os encargos percentuais (i) e as taxas fixas (F), e ainda
   sobrar a margem de lucro desejada (m).

   • Margem sobre o CUSTO  → P = (C·(1+m) + F) / (1 - i)
   • Margem sobre a VENDA  → P = (C + F) / (1 - i - m)

   onde C = custo unitário + (frete do lote ÷ quantidade) + outros custos.
   ============================================================ */

function calcularPreco(dados) {
    const qtd      = Math.max(1, num(dados.qtd, 1));
    const custo    = num(dados.custo);
    const frete    = num(dados.frete);
    const outros   = num(dados.outros);
    const imposto  = num(dados.imposto);
    const cartao   = num(dados.cartao);
    const comissao = num(dados.comissao);
    const taxaFixa = num(dados.taxaFixa);
    const margem   = num(dados.margem);
    const sobreCusto = dados.sobreCusto !== false;

    const freteUnitario  = frete / qtd;
    const custoUnitario  = custo + freteUnitario + outros;
    const custoTotalLote = custoUnitario * qtd;

    // Encargos percentuais somados (fração, ex.: 9% -> 0.09)
    const encargosPct = (imposto + cartao + comissao) / 100;

    let preco, motivoErro = null;

    if (sobreCusto) {
        const m = margem / 100;
        const den = 1 - encargosPct;
        if (den <= 0) {
            motivoErro = 'Os encargos percentuais somam 100% ou mais — impossível definir um preço.';
            preco = 0;
        } else {
            preco = (custoUnitario * (1 + m) + taxaFixa) / den;
        }
    } else {
        const m = margem / 100;
        const den = 1 - encargosPct - m;
        if (den <= 0) {
            motivoErro = 'Margem + encargos somam 100% ou mais. Reduza a margem desejada.';
            preco = 0;
        } else {
            preco = (custoUnitario + taxaFixa) / den;
        }
    }

    if (!motivoErro) preco = tetoCentavo(preco);

    // Composição do preço
    const valorImposto  = preco * imposto  / 100;
    const valorCartao   = preco * cartao   / 100;
    const valorComissao = preco * comissao / 100;
    const lucroUnitario = preco - custoUnitario - taxaFixa
                          - valorImposto - valorCartao - valorComissao;

    const margemRealCusto = custoUnitario > 0 ? (lucroUnitario / custoUnitario) * 100 : 0;
    const margemRealVenda = preco > 0 ? (lucroUnitario / preco) * 100 : 0;

    return {
        preco,
        motivoErro,
        qtd,
        custoUnitario,
        custoTotalLote,
        freteUnitario,
        encargosPct: encargosPct * 100,
        valorImposto,
        valorCartao,
        valorComissao,
        taxaFixa,
        lucroUnitario,
        lucroTotal: lucroUnitario * qtd,
        margemRealCusto,
        margemRealVenda,
        precoPsicologico: arredondarPsicologico(preco)
    };
}

/** Sugere um preço "de vitrine" (ex.: 129,90) mais próximo. */
function arredondarPsicologico(preco) {
    if (!preco || preco <= 0) return 0;
    if (preco < 20) return Math.ceil(preco * 4) / 4;     // múltiplos de 0,25
    if (preco < 100) return Math.ceil(preco) - 0.10;      // X,90
    const dez = Math.ceil(preco / 10) * 10;
    return dez - 0.10;                                    // X0,90
}

/** Marcador de preço (markup): quantas vezes o preço cobre o custo. */
function markup(preco, custo) {
    return custo > 0 ? preco / custo : 0;
}

/* ============================================================
   ESTOQUE — cálculo de status e totais
   ============================================================ */

function statusProduto(p) {
    const q = num(p.qtd);
    const min = num(p.minimo, config.minimo);
    if (q <= 0) return 'zerado';
    if (q <= min) return 'baixo';
    return 'ok';
}

function rotuloStatus(s) {
    return { ok: 'Estoque OK', baixo: 'Estoque baixo', zerado: 'Zerado' }[s] || s;
}

/** Preço de venda usado no valor do estoque (0 se o produto estiver zerado). */
function valorEstoqueProduto(p) {
    return num(p.qtd) * num(p.preco);
}

function custoEstoqueProduto(p) {
    return num(p.qtd) * num(p.custo);
}

function margemProduto(p) {
    const preco = num(p.preco), custo = num(p.custo);
    if (custo <= 0) return preco > 0 ? 100 : 0;
    return ((preco - custo) / custo) * 100;
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard() {
    const totalItens   = produtos.reduce((s, p) => s + num(p.qtd), 0);
    const totalProd    = produtos.length;
    const valorVenda   = produtos.reduce((s, p) => s + valorEstoqueProduto(p), 0);
    const valorCusto   = produtos.reduce((s, p) => s + custoEstoqueProduto(p), 0);
    const lucroPrev    = valorVenda - valorCusto;
    const margemMedia  = valorCusto > 0 ? (lucroPrev / valorCusto) * 100 : 0;

    const alertas = produtos.filter(p => statusProduto(p) !== 'ok');
    const zerados = produtos.filter(p => statusProduto(p) === 'zerado').length;
    const baixos  = produtos.filter(p => statusProduto(p) === 'baixo').length;

    $('#cards').innerHTML = `
        <div class="card">
            <div class="rotulo">Produtos cadastrados</div>
            <div class="valor">${totalProd}</div>
            <div class="extra">${totalItens} unidades em estoque</div>
        </div>
        <div class="card ok">
            <div class="rotulo">Valor de venda do estoque</div>
            <div class="valor">${moeda(valorVenda)}</div>
            <div class="extra">Custo: ${moeda(valorCusto)}</div>
        </div>
        <div class="card ${lucroPrev >= 0 ? 'ok' : 'perigo'}">
            <div class="rotulo">Lucro previsto</div>
            <div class="valor">${moeda(lucroPrev)}</div>
            <div class="extra">Margem média: ${pct(margemMedia)}</div>
        </div>
        <div class="card ${alertas.length ? 'alerta' : 'ok'}">
            <div class="rotulo">Alertas de estoque</div>
            <div class="valor">${alertas.length}</div>
            <div class="extra">${baixos} baixo · ${zerados} zerado</div>
        </div>
    `;

    // Alertas detalhados
    const listaAlertas = $('#lista-alertas');
    if (!alertas.length) {
        listaAlertas.innerHTML = '<li class="vazio-msg">Nenhum produto precisa de reposição. 🎉</li>';
    } else {
        listaAlertas.innerHTML = alertas
            .sort((a, b) => num(a.qtd) - num(b.qtd))
            .map(p => {
                const s = statusProduto(p);
                const txt = s === 'zerado' ? 'Zerado' : `Baixo (mín. ${num(p.minimo, config.minimo)})`;
                return `<li>
                    <span>${escapar(p.nome)}<br><span class="sku">${escapar(p.sku || '—')} · ${escapar(p.categoria || 'Sem categoria')}</span></span>
                    <span class="tag"><span class="badge ${s}">${txt}</span><br>${num(p.qtd)} un.</span>
                </li>`;
            }).join('');
    }

    // Valor por categoria
    const porCategoria = {};
    produtos.forEach(p => {
        const cat = (p.categoria || 'Sem categoria').trim() || 'Sem categoria';
        if (!porCategoria[cat]) porCategoria[cat] = { venda: 0, itens: 0, qtd: 0 };
        porCategoria[cat].venda += valorEstoqueProduto(p);
        porCategoria[cat].itens += 1;
        porCategoria[cat].qtd   += num(p.qtd);
    });

    const listaCategorias = $('#lista-categorias');
    const entradas = Object.entries(porCategoria).sort((a, b) => b[1].venda - a[1].venda);
    if (!entradas.length) {
        listaCategorias.innerHTML = '<li class="vazio-msg">Cadastre produtos para ver o resumo por categoria.</li>';
    } else {
        listaCategorias.innerHTML = entradas.map(([cat, d]) => `<li>
            <span>${escapar(cat)}<br><span class="sku">${d.itens} produto(s) · ${d.qtd} un.</span></span>
            <span class="tag">${moeda(d.venda)}</span>
        </li>`).join('');
    }
}

/* ============================================================
   LISTA DE PRODUTOS (tabela, busca, filtros, ordenação)
   ============================================================ */

function preencherFiltroCategorias() {
    const cats = [...new Set(produtos.map(p => (p.categoria || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const atual = $('#filtro-categoria').value;
    $('#filtro-categoria').innerHTML =
        '<option value="">Todas as categorias</option>' +
        cats.map(c => `<option value="${escapar(c)}">${escapar(c)}</option>`).join('');
    $('#filtro-categoria').value = cats.includes(atual) ? atual : '';

    $('#lista-categorias-dl').innerHTML = cats.map(c => `<option value="${escapar(c)}">`).join('');
}

function produtosFiltrados() {
    const busca = $('#busca').value.trim().toLowerCase();
    const cat   = $('#filtro-categoria').value;
    const st    = $('#filtro-status').value;

    let lista = produtos.filter(p => {
        const alvo = `${p.nome || ''} ${p.sku || ''} ${p.categoria || ''} ${p.fornecedor || ''}`.toLowerCase();
        if (busca && !alvo.includes(busca)) return false;
        if (cat && (p.categoria || '').trim() !== cat) return false;
        if (st && statusProduto(p) !== st) return false;
        return true;
    });

    const { campo, asc } = ordenacao;
    const fator = asc ? 1 : -1;
    const peso = { ok: 0, baixo: 1, zerado: 2 };

    lista.sort((a, b) => {
        let va, vb;
        switch (campo) {
            case 'qtd':       va = num(a.qtd);           vb = num(b.qtd);           break;
            case 'custo':     va = num(a.custo);         vb = num(b.custo);         break;
            case 'preco':     va = num(a.preco);         vb = num(b.preco);         break;
            case 'margem':    va = margemProduto(a);     vb = margemProduto(b);     break;
            case 'total':     va = valorEstoqueProduto(a); vb = valorEstoqueProduto(b); break;
            case 'status':    va = peso[statusProduto(a)]; vb = peso[statusProduto(b)]; break;
            case 'categoria': va = (a.categoria || '').toLowerCase(); vb = (b.categoria || '').toLowerCase(); break;
            default:          va = (a.nome || '').toLowerCase(); vb = (b.nome || '').toLowerCase();
        }
        if (typeof va === 'string') return va.localeCompare(vb, 'pt-BR') * fator;
        return (va - vb) * fator;
    });

    return lista;
}

function renderProdutos() {
    const lista = produtosFiltrados();
    const tbody = $('#tbody-produtos');

    $('#vazio-tabela').hidden = lista.length > 0;

    tbody.innerHTML = lista.map(p => {
        const s = statusProduto(p);
        const marg = margemProduto(p);
        const classeMarg = marg >= 0 ? 'margem-pos' : 'margem-neg';
        return `<tr>
            <td><span class="sku">${escapar(p.sku || '—')}</span></td>
            <td>
                <span class="nome">${escapar(p.nome)}</span>
                ${p.fornecedor ? `<br><span class="sku">Fornecedor: ${escapar(p.fornecedor)}</span>` : ''}
                ${p.obs ? `<br><span class="sku">${escapar(p.obs)}</span>` : ''}
            </td>
            <td><span class="sku">${escapar(p.categoria || '—')}</span></td>
            <td class="num">${num(p.qtd)}</td>
            <td class="num">${moeda(p.custo)}</td>
            <td class="num">${moeda(p.preco)}</td>
            <td class="num"><span class="${classeMarg}">${pct(marg)}</span></td>
            <td class="num">${moeda(valorEstoqueProduto(p))}</td>
            <td><span class="badge ${s}">${rotuloStatus(s)}</span></td>
            <td class="acoes">
                <button class="btn sm" data-acao="mais" data-id="${p.id}" title="Entrada de estoque">+1</button>
                <button class="btn sm" data-acao="menos" data-id="${p.id}" title="Saída de estoque">−1</button>
                <button class="btn sm" data-acao="editar" data-id="${p.id}">Editar</button>
                <button class="btn sm" data-acao="excluir" data-id="${p.id}">Excluir</button>
            </td>
        </tr>`;
    }).join('');

    // Indicador de ordenação no cabeçalho
    $$('.tabela thead th').forEach(th => {
        th.classList.remove('ordenado-asc', 'ordenado-desc');
        th.removeAttribute('data-ordenado');
    });
}

function renderTudo() {
    preencherFiltroCategorias();
    renderProdutos();
    renderDashboard();
}

/* ============================================================
   CRUD DE PRODUTOS
   ============================================================ */

function abrirModal(id = null) {
    const form = $('#form-produto');
    form.reset();
    $('#f-id').value = '';

    if (id) {
        const p = produtos.find(x => String(x.id) === String(id));
        if (!p) return;
        $('#modal-titulo').textContent = 'Editar produto';
        $('#f-id').value       = p.id;
        $('#f-nome').value     = p.nome || '';
        $('#f-sku').value      = p.sku || '';
        $('#f-categoria').value = p.categoria || '';
        $('#f-fornecedor').value = p.fornecedor || '';
        $('#f-qtd').value      = num(p.qtd);
        $('#f-minimo').value   = num(p.minimo, config.minimo);
        $('#f-custo').value    = num(p.custo);
        $('#f-preco').value    = num(p.preco);
        $('#f-obs').value      = p.obs || '';
    } else {
        $('#modal-titulo').textContent = 'Novo produto';
        $('#f-minimo').value = config.minimo;
    }

    $('#modal').hidden = false;
    setTimeout(() => $('#f-nome').focus(), 50);
}

function fecharModal() {
    $('#modal').hidden = true;
}

function salvarProduto(evento) {
    evento.preventDefault();

    const id = $('#f-id').value;
    const dados = {
        nome:       $('#f-nome').value.trim(),
        sku:        $('#f-sku').value.trim(),
        categoria:  $('#f-categoria').value.trim(),
        fornecedor: $('#f-fornecedor').value.trim(),
        qtd:        Math.max(0, Math.round(num($('#f-qtd').value))),
        minimo:     Math.max(0, Math.round(num($('#f-minimo').value, config.minimo))),
        custo:      Math.max(0, num($('#f-custo').value)),
        preco:      Math.max(0, num($('#f-preco').value)),
        obs:        $('#f-obs').value.trim()
    };

    if (!dados.nome) { toast('Informe o nome do produto.', 'erro'); return; }

    if (id) {
        const i = produtos.findIndex(p => String(p.id) === String(id));
        if (i === -1) return;
        produtos[i] = { ...produtos[i], ...dados };
        toast('Produto atualizado com sucesso.', 'ok');
    } else {
        produtos.push({
            id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
            ...dados,
            criadoEm: new Date().toISOString()
        });
        toast('Produto cadastrado com sucesso.', 'ok');
    }

    salvarProdutos();
    fecharModal();
    renderTudo();
}

function excluirProduto(id) {
    const p = produtos.find(x => String(x.id) === String(id));
    if (!p) return;
    if (!confirm(`Excluir "${p.nome}" do estoque?`)) return;
    produtos = produtos.filter(x => String(x.id) !== String(id));
    salvarProdutos();
    renderTudo();
    toast('Produto excluído.', 'ok');
}

function ajustarQuantidade(id, delta) {
    const p = produtos.find(x => String(x.id) === String(id));
    if (!p) return;
    const nova = Math.max(0, num(p.qtd) + delta);
    if (nova === num(p.qtd)) { toast(delta > 0 ? 'Aumente na tela de edição para mais de +1.' : 'O estoque já está zerado.', 'erro'); return; }
    p.qtd = nova;
    salvarProdutos();
    renderProdutos();
    renderDashboard();
    toast(`${p.nome}: ${nova} un. em estoque.`, 'ok');
}

/* ============================================================
   CALCULADORA — leitura do formulário e exibição
   ============================================================ */

function lerFormCalculadora() {
    return {
        nome:       $('#c-nome').value.trim(),
        custo:      num($('#c-custo').value),
        qtd:        Math.max(1, Math.round(num($('#c-qtd').value, 1))),
        frete:      num($('#c-frete').value),
        outros:     num($('#c-outros').value),
        imposto:    num($('#c-imposto').value),
        cartao:     num($('#c-cartao').value),
        comissao:   num($('#c-comissao').value),
        taxaFixa:   num($('#c-fixataxa').value),
        margem:     num($('#c-margem').value),
        sobreCusto: $('#c-margem-custo').checked
    };
}

function atualizarCalculadora() {
    const dados = lerFormCalculadora();
    const r = calcularPreco(dados);

    const destaque = $('#r-preco');
    const psicologico = $('#r-preco-psicologico');

    if (r.motivoErro) {
        destaque.textContent = '—';
        psicologico.textContent = r.motivoErro;
        psicologico.style.color = '#fecaca';
        $('#r-detalhe').innerHTML = '<li><span>Não foi possível calcular</span><span class="val neg">verifique os percentuais</span></li>';
        $('#tbody-faixa').innerHTML = '';
        return;
    }

    destaque.textContent = moeda(r.preco);
    psicologico.style.color = '';
    psicologico.textContent = r.precoPsicologico !== r.preco
        ? `Preço de vitrine sugerido: ${moeda(r.precoPsicologico)}`
        : '';

    const detalhe = [
        ['Custo total do produto', moeda(r.custoUnitario), ''],
        ...(r.taxaFixa > 0 ? [['Taxa fixa por venda', '− ' + moeda(r.taxaFixa), 'neg']] : []),
        ['Imposto', '− ' + moeda(r.valorImposto), 'neg'],
        ['Taxa de cartão', '− ' + moeda(r.valorCartao), 'neg'],
        ...(r.valorComissao > 0 ? [['Comissão marketplace', '− ' + moeda(r.valorComissao), 'neg']] : []),
        ['Lucro por unidade', moeda(r.lucroUnitario), r.lucroUnitario >= 0 ? 'pos' : 'neg'],
        ['Lucro no lote (' + r.qtd + ' un.)', moeda(r.lucroTotal), r.lucroTotal >= 0 ? 'pos' : 'neg'],
        ['Margem real sobre custo', pct(r.margemRealCusto), r.margemRealCusto >= 0 ? 'pos' : 'neg'],
        ['Margem real sobre venda', pct(r.margemRealVenda), r.margemRealVenda >= 0 ? 'pos' : 'neg']
    ];

    $('#r-detalhe').innerHTML = detalhe.map(([rotulo, valor, cls]) =>
        `<li><span>${escapar(rotulo)}</span><span class="val ${cls}">${escapar(valor)}</span></li>`
    ).join('');

    // Faixa de preços para margens diferentes
    const margens = [10, 20, 30, 40, 50, 60, 80];
    $('#tbody-faixa').innerHTML = margens.map(m => {
        const sim = calcularPreco({ ...dados, margem: m });
        const atual = Math.abs(m - dados.margem) < 0.01;
        return `<tr${atual ? ' style="background:#eff6ff;font-weight:700"' : ''}>
            <td>${m}%${atual ? ' (atual)' : ''}</td>
            <td class="num">${sim.motivoErro ? '—' : moeda(sim.preco)}</td>
            <td class="num">${sim.motivoErro ? '—' : moeda(sim.lucroUnitario)}</td>
        </tr>`;
    }).join('');
}

function limparCalculadora() {
    $('#c-nome').value = '';
    $('#c-custo').value = 0;
    $('#c-qtd').value = 1;
    $('#c-frete').value = 0;
    $('#c-outros').value = 0;
    $('#c-fixataxa').value = 0;
    $('#c-margem-custo').checked = true;
    aplicarConfigNaCalculadora();
    atualizarCalculadora();
}

/** Leva os valores de configuração para os campos padrão da calculadora. */
function aplicarConfigNaCalculadora() {
    $('#c-imposto').value  = config.imposto;
    $('#c-cartao').value   = config.cartao;
    $('#c-comissao').value = config.comissao;
    $('#c-margem').value   = config.margem;
}

/** Salva o resultado da calculadora como um novo produto no estoque. */
function salvarResultadoComoProduto() {
    const dados = lerFormCalculadora();
    const r = calcularPreco(dados);

    if (r.motivoErro) { toast('Corrija os percentuais antes de salvar.', 'erro'); return; }

    const nome = dados.nome || 'Produto sem nome';
    produtos.push({
        id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
        nome,
        sku: '',
        categoria: '',
        fornecedor: '',
        qtd: dados.qtd,
        minimo: config.minimo,
        custo: r.custoUnitario,
        preco: r.preco,
        obs: `Preço calculado com margem de ${dados.margem}% e encargos de ${pct(r.encargosPct)}`,
        criadoEm: new Date().toISOString()
    });

    salvarProdutos();
    renderTudo();
    toast(`"${nome}" adicionado ao estoque a ${moeda(r.preco)}.`, 'ok');
}

/** Envia o produto do modal para a calculadora. */
function usarCalculadoraNoProduto() {
    const nome   = $('#f-nome').value.trim();
    const custo  = num($('#f-custo').value);
    const preco  = num($('#f-preco').value);
    const qtd    = Math.max(1, Math.round(num($('#f-qtd').value, 1)));

    $('#c-nome').value  = nome;
    $('#c-custo').value = custo;
    $('#c-qtd').value   = qtd;
    $('#c-outros').value = 0;
    $('#c-frete').value = 0;

    // Se já houver preço, calcula a margem que ele representa
    if (custo > 0 && preco > 0) {
        const despesasPct = (num($('#c-imposto').value) + num($('#c-cartao').value) + num($('#c-comissao').value)) / 100;
        const custoComTaxas = preco * (1 - despesasPct);
        const margem = ((custoComTaxas - custo) / custo) * 100;
        if (margem > 0 && margem < 90) $('#c-margem').value = Math.round(margem * 10) / 10;
    }

    fecharModal();
    trocarAba('calculadora');
    atualizarCalculadora();
    toast('Dados do produto enviados para a calculadora.', 'ok');
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */

function aplicarConfigNaTela() {
    $('#cfg-imposto').value  = config.imposto;
    $('#cfg-cartao').value   = config.cartao;
    $('#cfg-comissao').value = config.comissao;
    $('#cfg-margem').value   = config.margem;
    $('#cfg-minimo').value   = config.minimo;
}

function salvarConfiguracoes() {
    config = {
        imposto:  Math.max(0, num($('#cfg-imposto').value, CONFIG_PADRAO.imposto)),
        cartao:   Math.max(0, num($('#cfg-cartao').value, CONFIG_PADRAO.cartao)),
        comissao: Math.max(0, num($('#cfg-comissao').value, CONFIG_PADRAO.comissao)),
        margem:   Math.min(90, Math.max(0, num($('#cfg-margem').value, CONFIG_PADRAO.margem))),
        minimo:   Math.max(0, Math.round(num($('#cfg-minimo').value, CONFIG_PADRAO.minimo)))
    };
    salvarConfig();
    aplicarConfigNaCalculadora();
    atualizarCalculadora();
    renderTudo();
    toast('Configurações salvas.', 'ok');
}

function exportarJSON() {
    const conteudo = JSON.stringify({ produtos, config }, null, 2);
    const blob = new Blob([conteudo], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estoque-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup exportado.', 'ok');
}

function importarJSON(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
        try {
            const dados = JSON.parse(leitor.result);
            const lista = Array.isArray(dados) ? dados : dados.produtos;
            if (!Array.isArray(lista)) throw new Error('formato');

            produtos = lista.map(p => ({
                id: p.id || 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
                nome: p.nome || 'Sem nome',
                sku: p.sku || '',
                categoria: p.categoria || '',
                fornecedor: p.fornecedor || '',
                qtd: Math.max(0, Math.round(num(p.qtd))),
                minimo: Math.max(0, Math.round(num(p.minimo, config.minimo))),
                custo: Math.max(0, num(p.custo)),
                preco: Math.max(0, num(p.preco)),
                obs: p.obs || ''
            }));

            if (dados.config && typeof dados.config === 'object') {
                config = { ...CONFIG_PADRAO, ...dados.config };
                salvarConfig();
                aplicarConfigNaTela();
                aplicarConfigNaCalculadora();
            }

            salvarProdutos();
            renderTudo();
            atualizarCalculadora();
            toast(`${produtos.length} produto(s) importado(s).`, 'ok');
        } catch {
            toast('Arquivo inválido. Use um JSON exportado por este site.', 'erro');
        }
    };
    leitor.readAsText(arquivo);
}

function apagarTudo() {
    if (!confirm('Isso apagará TODOS os produtos e configurações. Continuar?')) return;
    localStorage.removeItem(CHAVE_PRODUTOS);
    localStorage.removeItem(CHAVE_CONFIG);
    produtos = [];
    config = { ...CONFIG_PADRAO };
    aplicarConfigNaTela();
    aplicarConfigNaCalculadora();
    renderTudo();
    atualizarCalculadora();
    toast('Todos os dados foram apagados.', 'ok');
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */

function trocarAba(nome) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === nome));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + nome));
    if (nome === 'calculadora') atualizarCalculadora();
    if (nome === 'dashboard')   renderDashboard();
    if (nome === 'estoque')     renderProdutos();
}

/* ============================================================
   EVENTOS
   ============================================================ */

function ligarEventos() {
    // Abas
    $('#tabs').addEventListener('click', e => {
        const botao = e.target.closest('.tab');
        if (botao) trocarAba(botao.dataset.tab);
    });

    // Busca e filtros
    $('#busca').addEventListener('input', renderProdutos);
    $('#filtro-categoria').addEventListener('change', renderProdutos);
    $('#filtro-status').addEventListener('change', renderProdutos);

    // Ordenação por clique no cabeçalho
    $$('.tabela thead th').forEach((th, indice) => {
        const campos = ['sku', 'nome', 'categoria', 'qtd', 'custo', 'preco', 'margem', 'total', 'status', null];
        const campo = campos[indice];
        if (!campo) return;
        th.style.cursor = 'pointer';
        th.title = 'Clique para ordenar';
        th.addEventListener('click', () => {
            if (ordenacao.campo === campo) ordenacao.asc = !ordenacao.asc;
            else { ordenacao.campo = campo; ordenacao.asc = true; }
            renderProdutos();
        });
    });

    // Ações na tabela
    $('#tbody-produtos').addEventListener('click', e => {
        const botao = e.target.closest('button[data-acao]');
        if (!botao) return;
        const { acao, id } = botao.dataset;
        if (acao === 'editar')  abrirModal(id);
        if (acao === 'excluir') excluirProduto(id);
        if (acao === 'mais')    ajustarQuantidade(id, 1);
        if (acao === 'menos')   ajustarQuantidade(id, -1);
    });

    // Modal
    $('#btn-novo').addEventListener('click', () => abrirModal());
    $('#modal-fechar').addEventListener('click', fecharModal);
    $('#modal-cancelar').addEventListener('click', fecharModal);
    $('#form-produto').addEventListener('submit', salvarProduto);
    $('#btn-usar-calc').addEventListener('click', usarCalculadoraNoProduto);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !$('#modal').hidden) fecharModal();
    });

    // Calculadora — recalcula a cada alteração
    ['#c-custo', '#c-qtd', '#c-frete', '#c-outros', '#c-imposto', '#c-cartao',
     '#c-comissao', '#c-fixataxa', '#c-margem'].forEach(sel => {
        $(sel).addEventListener('input', atualizarCalculadora);
    });
    $('#c-margem-custo').addEventListener('change', atualizarCalculadora);
    $('#btn-salvar-calc').addEventListener('click', salvarResultadoComoProduto);
    $('#btn-limpar-calc').addEventListener('click', limparCalculadora);

    // Configurações
    $('#btn-salvar-cfg').addEventListener('click', salvarConfiguracoes);
    $('#btn-exportar').addEventListener('click', exportarJSON);
    $('#btn-importar').addEventListener('click', () => $('#input-importar').click());
    $('#input-importar').addEventListener('change', e => {
        if (e.target.files[0]) importarJSON(e.target.files[0]);
        e.target.value = '';
    });
    $('#btn-limpar-tudo').addEventListener('click', apagarTudo);
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

function iniciar() {
    carregar();
    ligarEventos();
    aplicarConfigNaTela();
    aplicarConfigNaCalculadora();
    renderTudo();
    atualizarCalculadora();
}

document.addEventListener('DOMContentLoaded', iniciar);
