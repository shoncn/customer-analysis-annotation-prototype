(function () {
  const demo = window.AnnotationDemo;
  const engine = window.AnnotationEngine;
  const storageKey = 'salesagent-annotation-prototype-v1';
  const reviewer = '评测 · 周宁';
  const get = selector => document.querySelector(selector);
  const icon = (name, className = '') => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const options = (values, selected, placeholder = '') => `${placeholder ? `<option value="">${escape(placeholder)}</option>` : ''}${values.map(value => `<option value="${escape(typeof value === 'string' ? value : value.value)}" ${(typeof value === 'string' ? value : value.value) === selected ? 'selected' : ''}>${escape(typeof value === 'string' ? value : value.label)}</option>`).join('')}`;
  const percentage = value => value === null ? '—' : `${value.toFixed(1)}%`;
  let state;
  try { state = JSON.parse(localStorage.getItem(storageKey)); } catch { state = null; }
  let legacyState;
  let legacyArchiveFailed = false;
  try { legacyState = JSON.parse(localStorage.getItem(`${storageKey}-legacy`)); } catch { legacyState = null; }
  if (state?.schema === 1) {
    legacyState = structuredClone(state);
    try { localStorage.setItem(`${storageKey}-legacy`, JSON.stringify(legacyState)); } catch { legacyArchiveFailed = true; }
    const updated = demo.initialState();
    Object.entries(state.reviews || {}).forEach(([caseId, reviews]) => {
      if (!demo.cases.some(record => record.id === caseId)) return;
      updated.reviews[caseId] = Object.fromEntries(Object.entries(reviews).filter(([node]) => !['M3', 'M4'].includes(node)));
      delete updated.submissions[caseId];
    });
    if (demo.cases.some(record => record.id === state.caseId)) { updated.caseId = state.caseId; updated.pack = state.pack; updated.node = state.node; }
    updated.owners = state.owners || {};
    updated.recovered = state.recovered || [];
    updated.demoSamples = 0;
    state = updated;
  }
  if (!state || state.schema !== 2 || !demo.cases.some(customer => customer.id === state.caseId)) state = demo.initialState();
  state.editing ||= [];
  state.owners ||= {};
  state.activeItems ||= {};
  if (!state.demoSamples) {
    const samples = demo.initialState();
    Object.entries(samples.submissions).forEach(([caseId, submission]) => {
      if (state.submissions[caseId]) return;
      state.submissions[caseId] = structuredClone(submission);
      state.reviews[caseId] ||= structuredClone(samples.reviews[caseId]);
    });
    state.demoSamples = samples.demoSamples;
  }
  state.regression ||= { packId: state.pack, version: demo.packs.find(record => record.id === state.pack).version, report: null };
  Object.entries(state.submissions).forEach(([caseId, submission]) => { submission.snapshot ||= structuredClone(state.reviews[caseId]); submission.version ||= 1; });
  let caseFilter = 'all';
  let resultMode = 'all';
  let resultModule = 'all';
  let resultPage = 1;
  let visibleRows = [];
  let dialogAction = null;
  let toastTimer;
  let storageFailed = false;
  let regressionRunning = false;

  function customer() { return demo.cases.find(record => record.id === state.caseId); }
  function pack() { return demo.packs.find(record => record.id === state.pack); }
  function recovered(record) { return record.evalStatus === 'completed' || state.recovered.includes(record.id); }
  function locked(record = customer()) { return Boolean(state.submissions[record.id] && !state.editing.includes(record.id)); }
  function reviewFor(record, node, item) { const reviews = locked(record) ? state.submissions[record.id].snapshot : state.reviews[record.id]; return reviews?.[node]?.[item.id] || {}; }
  function validCount(record, node) { return record.nodes[node].items.filter(item => !engine.validateReview(item, reviewFor(record, node, item)).length).length; }
  function requiredNodes(record = customer()) { return demo.modules.filter(node => record.nodes[node.id].items.length).map(node => node.id); }
  function canSubmit(record = customer()) { return recovered(record) && requiredNodes(record).every(node => validCount(record, node) === record.nodes[node].items.length); }
  function reviewItems(record = customer(), node = state.node) { return node === 'M4' ? [...record.nodes[node].items].sort((first, second) => Number(second.key === 'grade') - Number(first.key === 'grade')) : record.nodes[node].items; }
  function activeItem() { const items = reviewItems(); return items.find(item => item.id === state.activeItems[`${state.caseId}:${state.node}`]) || items[0]; }
  function packProgress(record) {
    const cases = demo.cases.filter(customer => customer.packId === record.id);
    const completed = cases.filter(customer => locked(customer)).length;
    const started = cases.some(customer => Object.values(state.reviews[customer.id] || {}).some(reviews => Object.keys(reviews).length));
    return { total: cases.length, completed, label: completed === cases.length ? '已完成' : !completed && !started ? '未开始' : `${completed}/${cases.length}` };
  }
  function aiCaseResult(record) {
    if (!recovered(record)) return { label: '初评失败', tone: 'red' };
    const items = demo.modules.flatMap(node => record.nodes[node.id].items);
    const bad = items.filter(item => engine.isBad({ key: item.key, human: item.ai })).length;
    if (bad) return { label: `${bad} 项需优化`, tone: 'orange' };
    if (items.some(item => engine.insufficientValues.has(item.ai))) return { label: '资料不足', tone: 'orange' };
    return { label: '未发现问题', tone: 'green' };
  }

  function persist() {
    try { if (legacyArchiveFailed) throw new Error('旧版标注尚未备份，不覆盖原记录'); localStorage.setItem(storageKey, JSON.stringify(state)); storageFailed = false; }
    catch { storageFailed = true; }
    renderFooter();
  }

  function toast(message) {
    get('#toast').textContent = message;
    get('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { get('#toast').hidden = true; }, 3300);
  }

  function showDialog(title, description, action, content = '') {
    get('#dialog-title').textContent = title;
    get('#dialog-description').textContent = description;
    get('#dialog-content').innerHTML = content;
    get('#dialog-confirm').textContent = action ? '确认' : '知道了';
    dialogAction = action;
    get('#action-dialog').showModal();
  }

  function statusBadge(value) {
    const tone = engine.insufficientValues.has(value) ? 'orange' : engine.isBad({ human: value }) ? 'red' : value?.startsWith('Grade ') ? 'blue' : value === '不适用' ? '' : 'green';
    return `<span class="badge ${tone}">${escape(value)}</span>`;
  }

  function renderSidebar() {
    const currentPack = pack();
    const records = demo.cases.filter(record => record.packId === currentPack.id);
    get('#pack-info').innerHTML = `<strong class="pack-code">${escape(currentPack.id)}</strong>`;
    get('#pack-meta').innerHTML = `<span>版本 ${currentPack.datasetVersion}</span><span>${records.length} 个客户</span>`;
    get('#pack-menu').innerHTML = `<div class="menu-heading"><span>选择待标注 Case 包</span><span>模拟数据</span></div>${demo.packs.map(record => { const progress = packProgress(record); return `<button class="pack-option ${record.id === state.pack ? 'selected' : ''}" data-select-pack="${record.id}">${icon('box')}<span><strong>${escape(record.id)} · 版本 ${record.datasetVersion}</strong><small>${progress.total} 个客户 · 标注 ${progress.label}${['已完成', '未开始'].includes(progress.label) ? ` · ${progress.completed}/${progress.total}` : ''}</small></span>${record.id === state.pack ? icon('check', 'checked') : ''}</button>`; }).join('')}<div class="pack-menu-footer"><button id="pack-details" class="text-button">${icon('info')}当前包抽样覆盖与版本</button><button id="legacy-records" class="text-button" ${legacyState ? '' : 'hidden'}>旧版标注备份 ${icon('download')}</button></div>`;
    const search = get('#case-search').value.toLowerCase();
    const matching = records.filter(record => (!search || `${record.name} ${record.id}`.toLowerCase().includes(search)) && ['sampling', 'stage', 'information'].every(key => get(`#case-${key}`).value === 'all' || get(`#case-${key}`).value === record[key]) && (caseFilter === 'all' || (caseFilter === 'submitted' ? state.submissions[record.id] : !state.submissions[record.id])));
    get('#case-count').textContent = `${matching.length} / ${records.length}`;
    get('#case-list').innerHTML = matching.length ? matching.map(record => {
      const submitted = state.submissions[record.id];
      const required = requiredNodes(record);
      const progress = recovered(record) ? required.filter(node => validCount(record, node) === record.nodes[node].items.length).length : 0;
      const started = Object.values(state.reviews[record.id] || {}).some(reviews => Object.keys(reviews).length);
      const status = locked(record) ? '已完成' : state.editing.includes(record.id) ? '更正中' : started ? `${progress}/${required.length} 节点` : '未开始';
      const ai = aiCaseResult(record);
      return `<button class="case-row ${record.id === state.caseId ? 'selected' : ''}" data-case="${record.id}" title="${submitted ? '查看已提交结果' : started ? '继续复核' : '领取并打开该 Case（模拟）'}"><span class="row-title"><strong>${record.name}</strong><span class="badge ${locked(record) ? 'green' : started ? 'blue' : ''}">${status}</span></span><span class="row-id">${record.id}</span><span class="row-meta">状态：${record.stage}</span><span class="row-evaluation">AI 初评 <span class="${ai.tone}">${ai.label}</span></span></button>`;
    }).join('') : '<div class="empty-state"><p>没有匹配的客户 Case</p></div>';
    const progress = packProgress(currentPack);
    get('#workspace-progress').innerHTML = `<div class="progress-caption"><span>标注进度</span><strong>${progress.label}</strong>${['已完成', '未开始'].includes(progress.label) ? `<span>${progress.completed}/${progress.total}</span>` : ''}</div><div class="progress-small" role="progressbar" aria-label="Case 包提交进度" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.completed}"><span style="width:${progress.completed / Math.max(1, progress.total) * 100}%"></span></div>`;
  }

  function renderHeader() {
    const record = customer();
    const submission = state.submissions[record.id];
    get('#case-heading').innerHTML = `<div class="case-identity"><span class="avatar">${record.name[0]}</span><div><div class="case-name-line"><h2>${record.name}</h2><span class="case-code">${record.id}</span><span class="badge ${submission ? 'green' : 'blue'}">${submission ? state.editing.includes(record.id) ? '更正中' : '已提交' : '人工复核中'}</span><span class="badge">${record.model}</span></div><div class="case-subtitle"><span>${record.analysisTime}</span><span>${record.sampling}</span><span>${record.information}</span><span>复核人：${escape(submission?.reviewer || state.owners[record.id] || record.assignedTo || reviewer)}</span></div></div></div><div class="case-tools"><button class="icon-button" data-navigate-case="-1" aria-label="上一个客户">${icon('arrow', 'rotate')}</button><button class="icon-button" data-navigate-case="1" aria-label="下一个客户">${icon('arrow')}</button><button class="button" id="show-trace">${icon('link')}原始 Trace</button>${locked() ? '<button id="edit-submission" class="button">更正结论</button>' : `<button id="submit-case" class="button primary" ${canSubmit(record) ? '' : 'disabled title="完成当前 Case 所有评估问题后提交"'}>提交整条 Case</button>`}</div>`;
    if (state.history.some(entry => entry.caseId === record.id)) get('.case-tools').insertAdjacentHTML('afterbegin', `<button id="show-history" class="button">${icon('clock')}修改记录</button>`);
  }

  function renderTabs() {
    const record = customer();
    get('#node-tabs').innerHTML = demo.modules.map(node => {
      const hasItems = record.nodes[node.id].items.length > 0;
      const finished = hasItems && recovered(record) && validCount(record, node.id) === record.nodes[node.id].items.length;
      return `<button class="node-tab ${node.id === state.node ? 'active' : ''}" id="tab-${node.id}" data-node="${node.id}" role="tab" aria-controls="evidence-panel" aria-selected="${node.id === state.node}"><span class="node-label">${node.id}${!hasItems ? `<span>${record.nodes[node.id].output.execution === '未执行' ? '未执行' : '无评估项'}</span>` : finished ? icon('check') : '<i class="node-dot"></i>'}</span><strong>${node.short}</strong></button>`;
    }).join('');
  }

  function rawDetails(title, object) { return `<details class="raw-details"><summary>${escape(title)}</summary><pre>${escape(JSON.stringify(object, null, 2))}</pre></details>`; }
  function dataCard(index, title, origin, content) { return `<article class="data-card"><div class="data-card-heading"><h3><span class="index">${index}</span>${title}</h3><span class="data-origin">${origin}</span></div>${content}</article>`; }
  function factBlock(text) { return `<div class="fact-block">${escape(text)}</div>`; }

  function renderEvidence() {
    const record = customer();
    const node = record.nodes[state.node];
    const definition = demo.modules.find(item => item.id === state.node);
    let input = '';
    let output = '';
    if (state.node === 'M4') {
      input = `<div class="data-label">客户状态与主问题</div>${factBlock(node.input.customer_state)}<div class="data-label">M2 实际识别的主要问题</div>${factBlock(record.nodes.M2.output.decision.main_issue)}<div class="query-row"><span>scene<b>${node.input.scene}</b></span><span>node<b>${node.input.node}</b></span></div><div class="data-tags"><span>客户粒度 · 策略可组合使用</span><span>完整候选与采用动作分别保留</span></div>`;
      output = `<div class="query-row"><span>候选策略<b>${node.output.candidates.length} 条</b></span><span>实际采用<b>${node.output.strategy_ids.length} 条 · 组合判分</b></span></div><div class="data-label">组合实际执行动作</div>${factBlock(node.output.decision.concrete_help)}${node.output.candidates.map(strategy => `<div class="strategy-card ${strategy.selected ? 'selected' : ''}"><div class="strategy-top"><div><span class="strategy-code">${strategy.id} · 演示 ID</span><strong>${strategy.title}</strong></div>${strategy.selected ? '<span class="badge blue">实际采用</span>' : '<span class="badge">未采用候选</span>'}</div><div class="strategy-subtitle">${strategy.subtitle}</div>${strategy.selected ? `<div class="branch-box"><span class="branch-label">实际采用分支</span><span>${strategy.branch}</span></div><p>${strategy.action}</p>` : ''}<details class="candidate-details"><summary>查看适用条件、排除条件与动作</summary><p>适用：${strategy.applicable}<br>排除：${strategy.exclude}<br>分支：${strategy.branch}${strategy.selected ? '' : `<br>动作：${strategy.action}`}</p></details></div>`).join('')}`;
    } else if (state.node === 'M3') {
      input = `<div class="data-label">素材需求</div>${factBlock(node.input.material_need)}<div class="data-label">上游客户问题</div>${factBlock(record.nodes.M2.output.decision.main_issue)}<div class="data-tags"><span>${node.output.execution}</span><span>${demo.materialModes.find(mode => mode.value === node.output.materialMode).label}</span><span>${node.output.requests.length} 次请求</span></div>`;
      output = `${node.output.reason ? `<div class="process-note">${icon('info')}<span>${node.output.reason}</span></div>` : ''}${node.output.requests.length ? node.output.requests.map((request, requestIndex) => `<details class="search-attempt" data-request="${request.id}" ${requestIndex === 0 || request.fallback ? 'open' : ''}><summary><strong>${request.id} · ${request.fallback ? '兜底搜索' : '按需搜索'}</strong><span>${request.materials.length} 条 · ${request.result === 'success' ? '请求成功' : '请求失败'}</span></summary><div class="attempt-body"><div class="data-label">实际 Query</div>${factBlock(request.query)}${request.materials.length ? request.materials.map(material => `<div class="strategy-card"><div class="strategy-top"><div><span class="strategy-code">#${material.position} · ${material.materialId}</span><strong>${material.title}</strong></div>${material.selected ? '<span class="badge blue">已采用</span>' : '<span class="badge">未采用</span>'}</div><p>${material.content}</p><span class="badge">${material.type} · 模拟预览</span></div>`).join('') : '<div class="search-empty">本次未召回素材 · 保留空结果，不当作请求失败</div>'}</div></details>`).join('') : factBlock(node.output.reason)}<div class="data-label">最终采用素材</div>${node.output.final_materials.length ? factBlock(node.output.final_materials.map(material => material.title).join('；')) : factBlock('未采用素材 · 后续可使用纯文字文案')}<p class="data-help">素材仍按 1–5 档相关性评分；兜底不提高相关性等级。结合所有请求归因，不将供给缺口直接记为生成侧错误。</p>`;
    } else if (state.node === 'M6') {
      input = `<div class="data-label">本轮实际使用的资料</div>${factBlock(`客户状态：${node.input.customer_state}。${record.request}。`)}<div class="data-tags"><span>目标与方案</span><span>所选策略及打法</span><span>实际素材内容</span><span>客户原话与来源</span></div>`;
      output = `<div class="data-label">电话话术</div>${factBlock(node.output.follow_playbook)}<div class="data-label">企微 · 素材版</div>${factBlock(node.output.wecom_suggestion.message)}<div class="data-label">企微 · 无素材版</div>${factBlock(node.output.wecom_suggestion.messageWithoutMaterial)}<div class="data-tags"><span>阶段原文与最终保存值一致</span><span>生成 ≠ 实际发送</span></div>`;
    } else if (state.node === 'M5') {
      input = `${factBlock(`客户状态：${node.input.customer_state}`)}<div class="data-label">选定分支与共同决策</div>${factBlock(`${node.input.selected_branch}。${node.input.decision.concrete_help}`)}`;
      output = `<div class="data-label">跟进目标</div>${factBlock(node.output.follow_target.content)}<div class="data-label">跟进方案</div>${factBlock(node.output.follow_strategy.content)}<div class="data-tags"><span>阶段原文 / 最终值分别保留</span><span>本 Case 未发生后处理改写</span></div>`;
    } else if (state.node === 'M2') {
      input = `<div class="data-label">有效客户状态</div>${factBlock(node.input.customer_state)}<div class="data-label">最近客户诉求</div>${factBlock(record.request)}<div class="data-tags"><span>近期记录 · 3 条来源</span><span>已有安排需承接</span><span>时间待确认</span></div>`;
      output = `<div class="data-label">主问题与优先处理事项</div>${factBlock(node.output.decision.main_issue)}<div class="data-label">未确认事项</div>${factBlock(node.output.unresolved_gaps.join('；'))}`;
    } else {
      const profile = node.input.customer_information;
      input = `<div class="query-row"><span>意向车型<b>${record.model}</b></span><span>用车意图<b>${record.purpose}</b></span></div><div class="data-tags"><span>画像 revision：${profile.revision}</span><span>客户自述 / 业务记录分别保留</span></div><div class="data-label" style="margin-top:13px">决策时实际可见的客户情况</div>${factBlock(record.request)}`;
      output = `<div class="data-label">decision.customer_state</div>${factBlock(node.output.decision.customer_state)}<div class="data-label">available_facts</div>${factBlock(node.output.available_facts.join('；'))}<div class="data-tags"><span>事实 / 推断 / 未知分开判断</span><span>不重置已完成事项</span></div>`;
    }
    get('#evidence-panel').innerHTML = `<div class="node-intro"><h2><span class="node-number">${state.node}</span>${definition.title}</h2><p>${definition.description}</p></div>${dataCard('01', '节点输入', '实际消费数据 · 模拟快照', `${input}${rawDetails('展开输入原始数据', node.input)}`)}${dataCard('02', '节点输出', state.node === 'M4' ? '候选 / 所选策略 / 最终动作' : '阶段产物 + 最终保存值', `${output}${rawDetails('展开输出原始数据', node.output)}`)}<article class="data-card"><div class="source-title"><h3>${icon('link')} 原始依据</h3><span>独立来源 · 决策前记录</span></div>${record.evidence.map(source => `<button class="source-item" id="source-${source.id}" data-source="${source.id}"><span class="source-meta"><b>${source.id} · ${source.title}</b><span>${source.date}</span></span><span class="badge ${source.type === '客户自述' ? 'green' : ''}">${source.type}</span><p>${source.available === false ? '原始资料缺失，当前仅保留业务摘要，无法核验原文。' : source.text}</p></button>`).join('')}</article>`;
  }

  function renderReview() {
    const record = customer();
    const node = record.nodes[state.node];
    const readOnly = locked();
    const items = reviewItems(record);
    const item = activeItem();
    get('#review-count').textContent = `${validCount(record, state.node)} / ${items.length} 项`;
    get('#question-tabs').hidden = !recovered(record) || !items.length;
    get('#question-tabs').innerHTML = items.map((question, index) => {
      const selected = item.id === question.id;
      const reviewed = !engine.validateReview(question, reviewFor(record, state.node, question)).length;
      return `<button id="question-${question.id}" class="question-tab ${selected ? 'active' : ''}" data-question="${question.id}" role="tab" aria-selected="${selected}" aria-controls="review-panel" aria-label="问题${index + 1}：${escape(question.title + ' · ' + question.unit)} · ${reviewed ? '已复核' : '待复核'}" tabindex="${selected ? 0 : -1}" title="${escape(question.title + ' · ' + question.unit)}"><span>问题${index + 1}</span>${reviewed ? icon('check') : '<i class="node-dot"></i>'}</button>`;
    }).join('');
    revealQuestion();
    get('#review-panel').setAttribute('aria-labelledby', item ? `question-${item.id}` : '');
    if (!recovered(record)) {
      get('#review-panel').innerHTML = `<div class="empty-state">${icon('warning')}<h3>AI 初评未完成</h3><p>模拟调用超时，尚未形成有效评估结论。<br>与客户分析 Agent 的业务错误分开记录。</p><button class="button" id="retry-evaluation">模拟重试初评</button></div>`;
      return;
    }
    if (!item) {
      get('#review-panel').innerHTML = `<div class="empty-state">${icon('info')}<h3>本轮未执行素材检索</h3><p>${escape(node.output.reason)}<br>未执行不计入搜索指标，原因单独保留。<br>缺少专家 ID 不等同于客户无需素材。</p></div>`;
      return;
    }
    const index = items.indexOf(item);
    const review = reviewFor(record, state.node, item);
    const different = review.accuracy === 'disagree';
    const unknown = review.accuracy === 'unknown';
    const agreedScore = review.accuracy === 'agree' && item.key === 'grade' && ['1 分', '2 分'].includes(review.human);
    const alternatives = item.key === 'grade' && review.accuracy && !unknown && review.human !== '3 分' ? `<fieldset class="alternative-picker"><legend>更优或适用策略（可多选）</legend>${node.output.candidates.map(strategy => `<label><input type="checkbox" data-alternative="${strategy.id}" ${(review.alternativeIds || []).includes(strategy.id) ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span>${strategy.title}<small>${strategy.id}</small></span></label>`).join('')}</fieldset>` : '';
    const rubric = item.key === 'grade' ? '<div id="strategy-rubric" class="strategy-rubric"><strong>一个客户的实际策略组合，只打一次分</strong><div><span><b>1 分</b>需优化</span><span><b>2 分</b>适配但有更优</span><span><b>3 分</b>适配且最优</span></div><p>2 分单列优选提升，不自动判错；最优以已审查候选范围为准。</p></div>' : '';
    get('#review-panel').innerHTML = `<div class="review-notice">${icon('info')}<span>${readOnly ? '已提交结果，只读查看。更正会保留上一版。' : `${pack().judge} · 先确认 AI 判断，再保留或修正结论。`}</span></div>${rubric}<article class="review-item ${different ? 'is-correction' : ''}" data-item="${item.id}">
      <div class="review-item-title"><span class="item-index">${String(index + 1).padStart(2, '0')}</span><strong>${escape(item.title)}</strong></div><div class="review-unit">${escape(item.unit)}</div>
      <div class="ai-conclusion"><span class="ai-label">AI 初评</span>${statusBadge(item.ai)}${different ? `<span class="badge orange">已改判 → ${escape(review.human)}</span>` : ''}</div>
      <p class="ai-reason">${escape(item.reason)}</p><button class="ai-evidence-link" data-view-basis="${item.id}">${icon('link')} 查看依据 · 评测模型的判断依据</button>
      <div class="review-accuracy-label"><span>评估模型的判断准确吗？</span><span class="muted">${review.accuracy ? '已复核' : '待确认'}</span></div>
      <div class="review-choices">${[['agree', '准确'], ['disagree', '不准确'], ['unknown', '资料不足']].map(([value, label]) => `<button data-accuracy="${value}" class="${review.accuracy === value ? 'selected' : ''}" ${readOnly ? 'disabled' : ''}>${review.accuracy === value ? icon(value === 'agree' ? 'check' : value === 'disagree' ? 'edit' : 'info') : ''}${label}</button>`).join('')}</div>
      ${different || unknown || agreedScore ? `<div class="correction-form">${different ? `<label><span>人工结论 <b>*</b></span><select data-field="human" ${readOnly ? 'disabled' : ''}>${options(item.options, review.human)}</select></label>` : unknown ? '<div class="failure-banner">资料不足单列，不自动记为通过或业务错误。</div>' : '<p>人工与 AI 一致 · 保留策略评分理由</p>'}<label><span>${unknown ? '资料缺失说明' : agreedScore ? '策略评分理由' : '改判理由'} <b>*</b></span><textarea data-field="reason" ${readOnly ? 'disabled' : ''} placeholder="说明判断依据与原判的问题">${escape(review.reason)}</textarea></label></div>` : review.accuracy === 'agree' ? '<div class="confirmed-note"><span>人工结论与 AI 原判一致</span><span>原判已保留</span></div>' : ''}${alternatives}</article>
      <div class="question-navigation"><button class="button compact" data-question-step="-1" ${index === 0 ? 'disabled' : ''}>上一问题</button><span>${index + 1} / ${items.length}</span><button class="button compact" data-question-step="1" ${index === items.length - 1 ? 'disabled' : ''}>下一问题</button></div>`;
  }

  function renderFooter() {
    if (!customer()) return;
    const record = customer();
    const required = requiredNodes(record);
    const requiredDone = required.filter(node => validCount(record, node) === record.nodes[node].items.length).length;
    get('#save-status').innerHTML = `${icon(storageFailed ? 'warning' : 'check')}${storageFailed ? '浏览器存储不可用，仅保留本次打开的进度' : locked() ? '已提交确认结果 · 历史原判保留' : '草稿已保存在本机'}<small>已复核 ${requiredDone}/${required.length} 个有评估项的节点${state.editing.includes(record.id) ? ' · 重提后更新统计' : ''}</small>`;
    get('#save-draft').disabled = locked();
    get('#confirm-node').disabled = locked() || !recovered(record);
    const submit = get('#submit-case');
    if (submit) submit.disabled = !canSubmit(record);
    get('#review-count').textContent = `${validCount(record, state.node)} / ${record.nodes[state.node].items.length} 项`;
  }

  function renderWorkbench() { renderSidebar(); renderHeader(); renderTabs(); renderEvidence(); renderReview(); renderFooter(); }

  function updateReview(itemId, field, value) {
    if (locked()) return;
    const record = customer();
    const item = record.nodes[state.node].items.find(assessment => assessment.id === itemId);
    state.reviews[record.id] ||= {};
    state.reviews[record.id][state.node] ||= {};
    const review = state.reviews[record.id][state.node][itemId] ||= {};
    if (field === 'accuracy') {
      review.accuracy = value;
      if (value === 'agree') {
        review.human = item.ai;
        review.judgeIssue = '';
        review.reason = item.key === 'grade' && ['1 分', '2 分'].includes(item.ai) ? item.reason : '';
        review.evidence = item.evidence;
        review.agentIssue = '';
      } else if (value === 'unknown') {
        review.human = item.options.find(option => engine.insufficientValues.has(option));
        review.judgeIssue = '';
        review.agentIssue = '';
        review.reason = '';
        review.evidence = '';
      } else {
        review.human = item.ai;
        review.reason = '';
        review.evidence = item.evidence;
        review.agentIssue = '';
        review.judgeIssue = '';
      }
    } else {
      review[field] = value;
      if (field === 'human') { review.agentIssue = ''; review.judgeIssue = ''; }
    }
    persist();
    if (field !== 'reason') {
      const scroll = get('#review-panel').scrollTop;
      renderReview();
      get('#review-panel').scrollTop = scroll;
    }
    renderTabs(); renderSidebar(); renderFooter();
  }

  function selectCase(caseId) {
    const record = demo.cases.find(item => item.id === caseId);
    if (!record) return;
    state.caseId = record.id;
    state.pack = record.packId;
    if (!state.submissions[record.id] && !state.owners[record.id] && !record.assignedTo && recovered(record)) {
      state.owners[record.id] = reviewer;
      toast('已模拟领取整条 Case · 复核人：周宁');
    }
    persist(); renderWorkbench();
  }

  function selectNode(node) { state.node = node; persist(); renderHeader(); renderTabs(); renderEvidence(); renderReview(); renderFooter(); }
  function revealQuestion() {
    const tab = get('#question-tabs [aria-selected="true"]');
    if (!tab) return;
    const tabs = get('#question-tabs');
    const container = tabs.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (bounds.left < container.left) tabs.scrollLeft += bounds.left - container.left;
    else if (bounds.right > container.right) tabs.scrollLeft += bounds.right - container.right;
  }
  function selectQuestion(itemId, focus = false) {
    if (!reviewItems().some(item => item.id === itemId)) return;
    state.activeItems[`${state.caseId}:${state.node}`] = itemId;
    persist(); renderReview();
    get('#review-panel').scrollTop = 0;
    const tab = get(`#question-${itemId}`);
    revealQuestion();
    if (focus) tab?.focus({ preventScroll: true });
  }
  function showEvaluationBasis(itemId) {
    const record = customer();
    const item = record.nodes[state.node].items.find(question => question.id === itemId);
    if (!item) return;
    const source = record.evidence.find(source => source.id === item.evidence);
    showDialog('评测模型的判断依据', `${pack().judge} · ${state.node} · ${item.title}`, null, `<div class="basis-result"><span>AI 初评</span>${statusBadge(item.ai)}</div><h3>评测模型判断理由</h3><p class="basis-reason">${escape(item.reason || '评测记录未提供判断理由。')}</p><h3>评测模型引用内容</h3>${source ? `<div class="basis-source"><strong>${escape(source.id)} · ${escape(source.title)}</strong><small>${escape(source.date)} · ${escape(source.type)}</small><p>${escape(source.available === false ? '原始引用内容缺失，无法查看原文。' : source.text)}</p></div>` : '<p>评测记录未提供可查看的引用内容。</p>'}<p class="basis-note">这里展示 AI 得出当前结论时的判断理由与引用记录，不是人工改判依据。</p>`);
  }
  function setView(view) {
    if (!['workbench', 'results', 'regression'].includes(view)) view = 'workbench';
    get('#workbench').hidden = view !== 'workbench';
    get('#results').hidden = view !== 'results';
    get('#regression').hidden = view !== 'regression';
    get('#export-results').hidden = view !== 'results';
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    history.replaceState(null, '', `#${view}`);
    get('#pack-menu').hidden = true;
    get('#export-menu').hidden = true;
    get('#export-results').setAttribute('aria-expanded', 'false');
    get('#pack-picker').setAttribute('aria-expanded', 'false');
    if (view === 'results') renderResults();
    else if (view === 'regression') renderRegression();
    else renderWorkbench();
  }

  function allRows() {
    return demo.cases.flatMap(record => {
      const submission = state.submissions[record.id];
      const reviews = submission?.snapshot || state.reviews[record.id] || {};
      const sourcePack = demo.packs.find(item => item.id === record.packId);
      const caseBad = demo.modules.filter(node => submission?.reviewedModules.includes(node.id)).some(node => record.nodes[node.id].items.some(item => engine.isBad({ ...item, ...reviews[node.id]?.[item.id] })));
      return demo.modules.flatMap(node => {
        if (submission && !submission.reviewedModules.includes(node.id)) return [];
        const items = record.nodes[node.id].items.length ? record.nodes[node.id].items : [{ id: 'not-executed', key: 'executionState', title: '素材检索未执行', unit: record.nodes[node.id].output.reason, ai: '不适用', human: '不适用', accuracy: 'notApplicable' }];
        return items.map(item => ({ ...item, ...(reviews[node.id]?.[item.id] || {}), itemId: item.id, caseId: record.id, packId: record.packId, name: record.name, module: node.id, version: sourcePack.version, datasetVersion: sourcePack.datasetVersion, judgeVersion: sourcePack.judge, standard: sourcePack.standard, sampling: record.sampling, stage: record.stage, information: record.information, materialMode: record.nodes.M3.output.materialMode, selectedStrategies: record.nodes.M4.output.candidates.filter(strategy => strategy.selected), caseBad, reviewer: submission?.reviewer || '', reviewedAt: submission?.reviewedAt || '', submitted: Boolean(submission) }));
      });
    });
  }

  function resultFilters() { return { module: resultModule, mode: resultMode }; }

  function summaryCard(title, id, number, footer, emblem, tone = '') {
    return `<article class="summary-card panel"><div class="summary-top"><span>${title}</span><span class="summary-icon ${tone}">${icon(emblem)}</span></div><div class="summary-number" id="${id}">${number}</div><p>${footer}</p></article>`;
  }

  function renderMetricCard(node, rows, selected) {
    const metrics = engine.moduleMetrics(rows, node.id);
    const metric = node.id === 'M6' ? metrics.find(item => item.key === 'compliance') : metrics[0];
    const human = metric.human;
    const ai = metric.ai;
    return `<button class="module-card ${selected === node.id ? 'active' : ''}" data-metric-module="${node.id}"><div class="module-card-top"><span>${node.id}</span>${node.short}</div><div class="metric-name">${metric.distribution ? '客户策略组合三档分布' : metric.title}</div>${metric.distribution ? `<div class="distribution">${human.grades.map((count, index) => `<span><i style="height:${Math.max(1, count / Math.max(1, ...human.grades) * 22)}px" title="${index + 1} 分：${count} 个"></i>${index + 1}分 · ${count}</span>`).join('')}</div><div class="threshold-note">2 分优选提升 · 入集口径待确认</div>` : `<div class="metric-rate">${percentage(human.value)}</div><div class="metric-progress"><span class="${human.value >= 85 ? 'good' : ''}" style="width:${human.value ?? 0}%"></span></div>`}<div class="metric-base"><span>${metric.distribution ? `${human.denominator} 个已判客户` : `人工 ${human.numerator}/${human.denominator}${human.samples !== undefined ? ` · ${human.samples}次` : ''}`}</span><span>AI ${metric.distribution ? `${ai.denominator} 个` : percentage(ai.value)}</span></div></button>`;
  }

  function renderResults() {
    const filters = resultFilters();
    const rows = engine.filterRows(allRows(), filters);
    visibleRows = rows.sort((first, second) => Number(second.accuracy === 'disagree') - Number(first.accuracy === 'disagree') || second.reviewedAt.localeCompare(first.reviewedAt) || first.caseId.localeCompare(second.caseId));
    const summary = engine.summarize(rows);
    const candidateCount = demo.cases.length;
    get('#result-scope').textContent = `${filters.module === 'all' ? '全部 Case 包' : filters.module + ' 节点'}：${summary.cases} 个已复核 Case · ${summary.rows} 条标注项`;
    get('#summary-grid').innerHTML = summaryCard('已复核 Case', 'summary-cases', summary.cases, `来自 ${candidateCount} 个候选 Case · 按 Case 去重`, 'file') + summaryCard('人工确认 badcase', 'summary-badcases', summary.badcases, '多个模块出错仍按 1 个 Case 统计', 'warning', 'red') + summaryCard('评估模型判断一致率', 'summary-agreement', percentage(summary.agreement), `${summary.agreed} / ${summary.judged} 个明确判定项 · ${summary.corrections} 项改判`, 'check', 'green') + summaryCard('证据不足 / 无法核验', 'summary-insufficient', summary.insufficient, '按标注项单列 · 不默认计为通过或错误', 'info', 'orange');
    get('#module-metrics').innerHTML = demo.modules.map(node => renderMetricCard(node, rows, filters.module)).join('');
    const metricModules = filters.module === 'all' ? demo.modules : demo.modules.filter(node => node.id === filters.module);
    get('#all-metrics').innerHTML = `<div class="metric-detail-grid">${metricModules.flatMap(node => engine.moduleMetrics(rows, node.id).map(metric => {
      const versionDetails = node.id === 'M6' ? ['电话话术', '企微素材版', '企微无素材版'].map(version => {
        const groupedMetric = engine.moduleMetrics(rows.filter(row => row.unit === `文案版本 · ${version}`), 'M6').find(item => item.key === metric.key);
        return `<p>${version}：人工 ${percentage(groupedMetric.human.value)} (${groupedMetric.human.numerator}/${groupedMetric.human.denominator}) · AI ${percentage(groupedMetric.ai.value)}</p>`;
      }).join('') : '';
      return `<div class="metric-detail-item"><h3>${node.id} · ${metric.title}</h3><div class="detail-rates">${metric.distribution ? `人工等级分布：${metric.human.grades.map((count, index) => `G${index + 1}=${count}`).join(' / ')}` : `人工 ${percentage(metric.human.value)} <span class="muted">(${metric.human.numerator ?? '—'}/${metric.human.denominator})</span>　AI ${percentage(metric.ai.value)}`}</div><p>${metric.note}</p>${versionDetails}</div>`;
    })).join('')}</div>`;
    const allCount = engine.filterRows(allRows(), { ...filters, mode: 'all' }).length;
    get('#all-row-count').textContent = allCount;
    const pageCount = Math.max(1, Math.ceil(rows.length / 10));
    resultPage = Math.min(resultPage, pageCount);
    const pageRows = rows.slice((resultPage - 1) * 10, resultPage * 10);
    get('#results-table tbody').innerHTML = pageRows.length ? pageRows.map((row, index) => `<tr data-result="${index}"><td><div class="customer-cell"><strong>${row.name}</strong><small>${row.caseId}</small><small>${row.sampling}</small></div></td><td><span class="badge">模型 v${row.version}</span><small>数据集 ${row.datasetVersion}</small></td><td><span>${row.module} · ${escape(row.title)}</span><div class="cell-sub">${row.unit}</div></td><td><div class="comparison"><span class="original">${escape(row.ai)}</span>${icon('arrow')}<span class="human ${row.accuracy === 'disagree' ? 'changed' : ''}">${escape(row.human)}</span></div></td><td><span class="badge ${row.accuracy === 'agree' ? 'green' : row.accuracy === 'disagree' ? 'orange' : ''}">${row.accuracy === 'notApplicable' ? '未执行' : row.accuracy === 'agree' ? '准确' : row.accuracy === 'disagree' ? '不准确' : '资料不足'}</span>${row.judgeIssue ? `<div class="cell-sub">${escape(row.judgeIssue)}</div>` : ''}</td><td>${engine.isBad(row) ? `<span class="badge red">${escape(row.human)}</span><div class="cell-sub">${escape(row.title)}</div>` : `<span class="muted">${row.human === '2 分' ? '优选提升' : '—'}</span>`}</td><td>${row.reviewer}<small>${row.reviewedAt}</small></td><td><button data-open-result="${row.caseId}" data-result-node="${row.module}" data-result-item="${row.itemId}">查看${icon('arrow')}</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><h3>没有匹配的标注结果</h3><p>当前范围暂无已提交结果。未提交的草稿不会进入结果列表。</p></div></td></tr>';
    get('#pagination-summary').textContent = rows.length ? `共 ${rows.length} 条标注项，显示 ${(resultPage - 1) * 10 + 1}–${Math.min(resultPage * 10, rows.length)} 条` : '共 0 条标注项';
    get('#pagination-page').textContent = `${resultPage} / ${pageCount}`;
    get('#previous-page').disabled = resultPage <= 1;
    get('#next-page').disabled = resultPage >= pageCount;
  }


  function confirmNode() {
    const record = customer();
    const invalid = record.nodes[state.node].items.find(item => reviewFor(record, state.node, item).accuracy && engine.validateReview(item, reviewFor(record, state.node, item)).length);
    if (invalid) {
      selectQuestion(invalid.id);
      get(`[data-item="${invalid.id}"]`)?.classList.add('invalid');
      toast(`${invalid.title}：${engine.validateReview(invalid, reviewFor(record, state.node, invalid))[0]}`);
      return;
    }
    const wasReady = canSubmit(record);
    const node = state.node;
    record.nodes[node].items.filter(item => !reviewFor(record, node, item).accuracy).forEach(item => updateReview(item.id, 'accuracy', 'agree'));
    const next = requiredNodes(record).find(module => module !== node && validCount(record, module) !== record.nodes[module].items.length);
    if (next) selectNode(next);
    else renderWorkbench();
    persist();
    if (!wasReady && canSubmit(record)) toast('全部评估问题已复核完成，可以提交整条 Case。');
  }

  function submitCase() {
    const record = customer();
    if (!canSubmit(record)) { toast('请完成当前 Case 所有评估问题的人工标注'); return; }
    const required = requiredNodes(record);
    const reviewed = demo.modules.filter(node => validCount(record, node.id) === record.nodes[node.id].items.length).map(node => node.id);
    showDialog(state.submissions[record.id] ? '提交更正后的整条 Case' : '提交整条 Case 的确认结果', `${record.name} · ${record.id}，${required.length} 个有评估项的节点已完成复核。提交后根据人工结论汇总问题位置；未执行节点不计入评估指标。`, () => {
      const previous = state.submissions[record.id];
      if (previous) state.history.push({ caseId: record.id, ...structuredClone(previous) });
      const reviewedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      state.submissions[record.id] = { reviewer, reviewedAt, snapshot: structuredClone(state.reviews[record.id]), reviewedModules: reviewed, dataSnapshot: structuredClone(record), packSnapshot: structuredClone(pack()), version: (previous?.version || 0) + 1 };
      state.editing = state.editing.filter(caseId => caseId !== record.id);
      persist(); renderWorkbench(); toast('整条 Case 已提交 · 标注结果与聚合指标已更新');
    });
  }

  function exportResults() {
    const fields = [['caseId', 'Case 编号'], ['name', '客户'], ['datasetVersion', '冻结数据集版本'], ['version', '客户分析模型版本'], ['sampling', '抽样来源'], ['stage', '客户阶段'], ['information', '信息情况'], ['materialMode', '素材模式'], ['module', '节点'], ['title', '标注项'], ['unit', '评价粒度'], ['ai', 'AI 原判'], ['human', '人工结论'], ['accuracy', '评估准确性'], ['judgeIssue', '评估模型问题'], ['agentIssue', 'Agent 问题'], ['reason', '理由'], ['evidence', '依据'], ['reviewer', '复核人'], ['reviewedAt', '复核时间'], ['judgeVersion', '评估模型版本'], ['standard', '评分标准版本']];
    const csvValue = value => `"${String(value ?? '').replace(/^[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
    const content = '\ufeff' + [fields.map(field => csvValue(field[1])).join(','), ...visibleRows.map(row => fields.map(field => csvValue(row[field[0]])).join(','))].join('\r\n');
    downloadFile('客户分析标注结果-模拟数据.csv', content, 'text/csv;charset=utf-8');
    toast(`已导出当前筛选的 ${visibleRows.length} 条模拟标注结果`);
  }

  function downloadFile(name, content, type = 'application/json;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    get('#export-menu').hidden = true;
    get('#export-results').setAttribute('aria-expanded', 'false');
  }

  function exportCases(onlyBad = false) {
    const rows = onlyBad ? visibleRows.filter(row => row.caseBad) : visibleRows;
    const bundle = engine.exportBundle(rows, demo.cases, demo.packs, state.submissions);
    bundle.filters = resultFilters();
    downloadFile(onlyBad ? '客户分析-badcase子集-模拟数据.json' : '客户分析-完整复核Case集-模拟数据.json', JSON.stringify(bundle, null, 2));
    toast(`已导出 ${bundle.cases.length} 个完整 Case · 包含全部节点数据与已提交结论`);
  }

  function showPackDetails() {
    const records = demo.cases.filter(record => record.packId === state.pack);
    const coverage = (key, values) => values.map(value => `<span class="badge">${value} · ${records.filter(record => record[key] === value).length}</span>`).join('');
    showDialog('Case 包 · 抽样覆盖与版本', '数据集版本与模型输出版本分别保存。这里展示已准备好的候选包，不在原型内执行真实抽样或回归。', null, `<div class="pack-detail-grid"><div>数据集版本<strong>${pack().datasetVersion}</strong></div><div>模型版本<strong>v${pack().version}</strong></div><div>客户 Case 数<strong>${records.length}</strong></div><div>输入冻结日期<strong>${pack().frozenAt}</strong></div></div><h3>抽样来源 · 模拟</h3><div class="analysis-tags">${coverage('sampling', demo.samplingTypes)}</div><h3>客户阶段覆盖</h3><div class="analysis-tags">${coverage('stage', ['首次邀约', '资料比较中', '已完成试驾'])}</div><h3>有效信息覆盖</h3><div class="analysis-tags">${coverage('information', ['资料完整', '资料不完整', '无有效信息'])}</div><p>未覆盖的类型显示为 0，不能代表已完成全场景抽样。真实入包来源和反馈情况待接入数据表。</p><p>${pack().judge} · ${pack().standard}<br>冻结输入随完整 Case 导出，不重新读取变化后的线上状态。</p>`);
  }

  function renderRegression() {
    const selection = state.regression;
    get('#regression-pack').innerHTML = options(demo.packs.map(record => ({ value: record.id, label: `${record.id} · ${record.datasetVersion} · ${record.count} 个客户` })), selection.packId);
    get('#regression-version').innerHTML = options([...new Set(demo.packs.map(record => record.version))].map(version => ({ value: version, label: `客户分析模型 v${version}` })), selection.version);
    get('#regression-pack').disabled = regressionRunning;
    get('#regression-version').disabled = regressionRunning;
    get('#run-regression').disabled = regressionRunning;
    get('#run-regression').textContent = regressionRunning ? '正在整理模拟结果…' : '运行回归（原型）';
    const report = selection.report;
    if (regressionRunning || !report) {
      get('#regression-results').innerHTML = `<div class="regression-empty panel">${icon('chart')}<h3>${regressionRunning ? '正在整理所选包与版本的回归结果' : '选择 Case 包和输出模型版本，开始回归评测'}</h3><p>${regressionRunning ? '对照已有冻结输出与已提交人工标注，不调用真实模型。' : '回归结果会展示客户级结论、差异项和人工参考情况。'}</p></div>`;
      return;
    }
    get('#regression-results').innerHTML = `<div class="scope-note"><span class="live-dot"></span><span id="regression-result-scope">${escape(report.packId)} · 数据集 ${report.datasetVersion} · 输出模型 v${report.version}</span><span>${escape(report.generatedAt)} · 模拟回归结果</span></div><div id="regression-summary" class="summary-grid">${summaryCard('回归客户数', 'regression-total', report.total, `冻结 Case 包 · ${report.missing} 个缺少输出待生成`, 'file')}${summaryCard('已对照人工标注', 'regression-compared', report.compared, `${report.judged} 个明确判定项 · 未标注不计分`, 'check', 'green')}${summaryCard('存在差异的客户', 'regression-differences', report.differences, `按 Case 去重 · ${report.insufficient} 项资料不足`, 'warning', 'orange')}${summaryCard('与人工结论一致率', 'regression-agreement', percentage(report.agreement), `${report.agreed} / ${report.judged} 个明确判定项`, 'chart')}</div>${report.missing ? '<div class="failure-banner">所选模型版本缺少该包的对应输出，全部标为待生成，未生成测试分数。</div>' : ''}<section class="result-list panel"><div class="list-toolbar regression-list-title"><h3>客户回归结果</h3><span class="muted">只比较同一客户、同一冻结输入与所选输出版本</span></div><div class="table-scroll"><table id="regression-table"><thead><tr><th>客户 / Case</th><th>当前状态</th><th>回归结果</th><th>一致项 / 对照项</th><th>差异项 / 资料不足项</th><th></th></tr></thead><tbody>${report.rows.map(row => `<tr data-regression-case="${row.caseId}"><td><div class="customer-cell"><strong>${escape(row.name)}</strong><small>${row.caseId}</small></div></td><td>${escape(row.stage)}</td><td><span class="badge ${row.status === '与人工一致' ? 'green' : row.differences.length ? 'orange' : ''}">${row.status}</span>${row.status === '缺少版本输出' ? '<small>待生成 · 无可对照输出</small>' : ''}</td><td>${row.judged ? `${row.agreed} / ${row.judged}` : '—'}</td><td>${row.differences.length} / ${row.insufficient}</td><td>${row.comparisons.length ? `<button data-regression-detail="${row.caseId}">查看对照${icon('arrow')}</button>` : '<span class="muted">暂无可对照结果</span>'}</td></tr>`).join('')}</tbody></table></div></section><p class="results-footnote">原型回归仅复用已有版本输出，不表示已经重新运行模型。更改 Case 包或模型版本后需重新运行；人工参考采用运行时的已提交快照。</p>`;
  }

  function runRegression() {
    if (regressionRunning) return;
    const selection = { packId: get('#regression-pack').value, version: get('#regression-version').value };
    regressionRunning = true;
    state.regression = { ...selection, report: null };
    persist();
    renderRegression();
    setTimeout(() => {
      const records = demo.cases.map(record => ({ ...record, evalStatus: recovered(record) ? 'completed' : 'failed' }));
      const report = engine.regressionReport(records, demo.packs, state.submissions, selection.packId, selection.version);
      report.generatedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      state.regression.report = report;
      regressionRunning = false;
      persist(); renderRegression();
    }, 500);
  }

  function showRegressionDetail(caseId) {
    const report = state.regression.report;
    const row = report?.rows.find(record => record.caseId === caseId);
    if (!row) return;
    showDialog('回归结果 · 模型输出与人工结论对照', `${row.name} · ${row.caseId} · ${report.packId} · 输出模型 v${report.version}`, null, `<div class="regression-detail-summary">${row.status} · 一致 ${row.agreed}/${row.judged} 项 · 差异 ${row.differences.length} 项</div>${row.comparisons.map(item => `<article class="data-card"><h3>${item.module} · ${escape(item.title)}</h3><p>${escape(item.unit)}</p><div class="comparison"><span>模型：${escape(item.ai)}</span>${icon('arrow')}<span class="human ${item.accuracy === 'disagree' ? 'changed' : ''}">人工：${escape(item.human)}</span></div>${item.reason ? `<p>人工说明：${escape(item.reason)}</p>` : ''}</article>`).join('')}`);
  }

  const extraFilters = { materialMode: demo.materialModes, sampling: demo.samplingTypes, stage: [...new Set([...demo.cases.map(record => record.stage), '首次邀约'])], information: ['资料完整', '资料不完整', '无有效信息'] };
  ['sampling', 'stage', 'information'].forEach(key => { get(`#case-${key}`).innerHTML = options([{ value: 'all', label: '全部' }, ...extraFilters[key]], 'all'); });

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.disabled) return;
    if (button?.dataset.view) { setView(button.dataset.view); return; }
    if (button?.id === 'pack-picker') { get('#pack-menu').hidden = !get('#pack-menu').hidden; button.setAttribute('aria-expanded', !get('#pack-menu').hidden); return; }
    if (button?.dataset.selectPack) {
      state.pack = button.dataset.selectPack;
      get('#pack-menu').hidden = true;
      caseFilter = 'all'; get('#case-search').value = '';
      ['sampling', 'stage', 'information'].forEach(key => { get(`#case-${key}`).value = 'all'; });
      document.querySelectorAll('[data-case-filter]').forEach(item => item.classList.toggle('active', item.dataset.caseFilter === 'all'));
      selectCase(demo.cases.find(record => record.packId === state.pack).id);
      get('#pack-picker').setAttribute('aria-expanded', 'false'); return;
    }
    if (!event.target.closest('.sidebar-pack')) { get('#pack-menu').hidden = true; get('#pack-picker').setAttribute('aria-expanded', 'false'); }
    if (button?.dataset.case) { selectCase(button.dataset.case); return; }
    if (button?.dataset.node) { selectNode(button.dataset.node); return; }
    if (button?.dataset.question) { selectQuestion(button.dataset.question); return; }
    if (button?.dataset.questionStep) { const items = reviewItems(); const index = items.findIndex(item => item.id === activeItem().id); selectQuestion(items[index + Number(button.dataset.questionStep)]?.id); return; }
    if (button?.dataset.viewBasis) { showEvaluationBasis(button.dataset.viewBasis); return; }
    if (button?.dataset.accuracy) { updateReview(button.closest('[data-item]').dataset.item, 'accuracy', button.dataset.accuracy); return; }
    if (button?.dataset.caseFilter) { caseFilter = button.dataset.caseFilter; document.querySelectorAll('[data-case-filter]').forEach(item => item.classList.toggle('active', item === button)); renderSidebar(); return; }
    if (button?.dataset.highlightSource) {
      document.querySelectorAll('.source-item').forEach(item => item.classList.remove('highlight'));
      const source = get(`#source-${button.dataset.highlightSource}`); source?.classList.add('highlight'); source?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
    }
    if (button?.dataset.navigateCase) {
      const records = demo.cases.filter(record => record.packId === state.pack);
      const currentIndex = records.findIndex(record => record.id === state.caseId);
      selectCase(records[(currentIndex + Number(button.dataset.navigateCase) + records.length) % records.length].id); return;
    }
    if (button?.dataset.metricModule) { resultModule = resultModule === button.dataset.metricModule ? 'all' : button.dataset.metricModule; resultPage = 1; renderResults(); return; }
    if (button?.dataset.resultMode) { resultMode = button.dataset.resultMode; document.querySelectorAll('[data-result-mode]').forEach(item => item.classList.toggle('active', item === button)); resultPage = 1; renderResults(); return; }
    if (button?.dataset.openResult) { state.node = button.dataset.resultNode; selectCase(button.dataset.openResult); selectQuestion(button.dataset.resultItem); setView('workbench'); return; }
    if (button?.id === 'run-regression') { runRegression(); return; }
    if (button?.dataset.regressionDetail) { showRegressionDetail(button.dataset.regressionDetail); return; }
    if (button?.id === 'pack-details') { showPackDetails(); return; }
    if (button?.id === 'legacy-records') { downloadFile('客户分析-旧版标注原始备份.json', JSON.stringify(legacyState, null, 2)); toast('旧版评分和原始标注完整保留；本轮 M3/M4 使用新口径重新复核'); return; }
    if (button?.id === 'show-trace') { showDialog('原始 Trace · 模拟记录', '本原型未接入真实 Trace。下方展示当前节点的模拟输入输出定位，不跳转到虚构的外部链接。', null, `<span>${customer().id} · ${state.node} · ${pack().prompt}</span>${rawDetails('查看模拟节点数据', customer().nodes[state.node])}`); return; }
    if (button?.id === 'edit-submission') {
      showDialog('更正已提交的人工结论', '当前已提交结果继续参与统计；完成更正并重新提交后，才更新结果。上一版人工结论将保留在本地修改记录中。', () => { state.editing.push(customer().id); persist(); renderWorkbench(); }); return;
    }
    if (button?.id === 'show-history') {
      const record = customer();
      const current = state.submissions[record.id];
      const entries = state.history.filter(entry => entry.caseId === record.id).map(entry => {
        const changes = demo.modules.flatMap(node => record.nodes[node.id].items.map(item => {
          const previous = entry.snapshot[node.id]?.[item.id];
          const latest = current.snapshot[node.id]?.[item.id];
          return previous?.human !== latest?.human || previous?.reason !== latest?.reason || previous?.agentIssue !== latest?.agentIssue ? `<p>${node.id} · ${item.title}<br>${escape(previous?.human)} → ${escape(latest?.human)}<br>原理由：${escape(previous?.reason || '与 AI 原判一致')}<br>当前理由：${escape(latest?.reason || '与 AI 原判一致')}</p>` : '';
        })).join('');
        return `<article class="data-card"><h3>第 ${entry.version} 版 · ${escape(entry.reviewer)}</h3><p>${entry.reviewedAt}</p>${changes || '<p>结论未改变，仅更新复核记录。</p>'}</article>`;
      }).join('');
      showDialog('人工结论修改记录', '历史版本与当前已提交版本分别保留，以下展示相对当前版本的变更。AI 原判保持不变。', null, entries); return;
    }
    if (button?.id === 'retry-evaluation') { state.recovered.push(customer().id); persist(); renderWorkbench(); toast('模拟重试成功，AI 初评已完成；没有调用真实评估服务'); return; }
    if (button?.id === 'save-draft') { persist(); toast(storageFailed ? '浏览器无法持久保存，请勿关闭页面' : '草稿已保存，切换客户或节点后可继续复核'); return; }
    if (button?.id === 'confirm-node') { confirmNode(); return; }
    if (button?.id === 'submit-case') { submitCase(); return; }
    if (button?.id === 'export-results') { get('#export-menu').hidden = !get('#export-menu').hidden; button.setAttribute('aria-expanded', !get('#export-menu').hidden); return; }
    if (button?.id === 'export-csv') { exportResults(); return; }
    if (button?.id === 'export-bundle' || button?.id === 'export-badcases') { exportCases(button.id === 'export-badcases'); return; }
    if (button?.id === 'export-report') { const bundle = engine.exportBundle(visibleRows, demo.cases, demo.packs, state.submissions); downloadFile('客户分析-评测汇总报告-模拟数据.json', JSON.stringify({ notice: bundle.notice, filters: resultFilters(), packs: bundle.packs, ...bundle.report }, null, 2)); toast('已导出当前结果范围的指标与节点问题汇总'); return; }
    if (!event.target.closest('.export-control')) { get('#export-menu').hidden = true; get('#export-results').setAttribute('aria-expanded', 'false'); }
    if (button?.id === 'previous-page' || button?.id === 'next-page') { resultPage += button.id === 'next-page' ? 1 : -1; renderResults(); return; }
  });
  get('#review-panel').addEventListener('change', event => {
    const field = event.target.dataset.field;
    if (field && field !== 'reason') updateReview(event.target.closest('[data-item]').dataset.item, field, event.target.value);
    if (event.target.dataset.alternative) {
      const itemId = event.target.closest('[data-item]').dataset.item;
      const selected = [...event.target.closest('.alternative-picker').querySelectorAll('input:checked')].map(input => input.dataset.alternative);
      updateReview(itemId, 'alternativeIds', selected);
    }
  });
  get('#review-panel').addEventListener('input', event => { if (event.target.dataset.field === 'reason') updateReview(event.target.closest('[data-item]').dataset.item, 'reason', event.target.value); });
  get('#case-search').addEventListener('input', renderSidebar);
  ['sampling', 'stage', 'information'].forEach(key => get(`#case-${key}`).addEventListener('change', renderSidebar));
  ['regression-pack', 'regression-version'].forEach(id => get(`#${id}`).addEventListener('change', () => {
    state.regression = { packId: get('#regression-pack').value, version: get('#regression-version').value, report: null };
    persist(); renderRegression();
  }));
  get('#question-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = reviewItems();
    const index = items.findIndex(item => item.id === activeItem()?.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    selectQuestion(items[next].id, true);
  });
  get('#action-dialog').addEventListener('submit', event => {
    event.preventDefault();
    const action = dialogAction;
    dialogAction = null;
    const confirmed = event.submitter?.value === 'confirm';
    get('#action-dialog').close(confirmed ? 'confirm' : 'cancel');
    if (confirmed && action) action();
  });
  get('#action-dialog').addEventListener('close', () => { dialogAction = null; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { get('#pack-menu').hidden = true; get('#pack-picker').setAttribute('aria-expanded', 'false'); get('#export-menu').hidden = true; get('#export-results').setAttribute('aria-expanded', 'false'); } });
  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
  renderWorkbench(); persist(); setView(location.hash.slice(1));
})();
