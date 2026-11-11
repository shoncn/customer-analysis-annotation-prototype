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
  if (!state || state.schema !== 1 || !demo.cases.some(customer => customer.id === state.caseId)) state = demo.initialState();
  state.editing ||= [];
  state.owners ||= {};
  Object.entries(state.submissions).forEach(([caseId, submission]) => { submission.snapshot ||= structuredClone(state.reviews[caseId]); submission.version ||= 1; });
  let caseFilter = 'all';
  let resultMode = 'all';
  let resultPage = 1;
  let visibleRows = [];
  let dialogAction = null;
  let toastTimer;
  let storageFailed = false;

  function customer() { return demo.cases.find(record => record.id === state.caseId); }
  function pack() { return demo.packs.find(record => record.id === state.pack); }
  function recovered(record) { return record.evalStatus === 'completed' || state.recovered.includes(record.id); }
  function locked(record = customer()) { return Boolean(state.submissions[record.id] && !state.editing.includes(record.id)); }
  function reviewFor(record, node, item) { return state.reviews[record.id]?.[node]?.[item.id] || {}; }
  function validCount(record, node) { return record.nodes[node].items.filter(item => !engine.validateReview(item, reviewFor(record, node, item)).length).length; }
  function completedNodes(record) { return recovered(record) ? demo.modules.filter(node => validCount(record, node.id) === record.nodes[node.id].items.length).length : 0; }
  function defaultAgentIssue(item) {
    return ({ status: '状态判断错误', action: '行动承接错误', fact: '事实无依据', point: '卡点判断错误', validity: '卡点判断错误', coverage: '关键问题遗漏', priority: '优先级不合理', query: 'Query 问题', materialGrade: '搜索问题', strategyQuery: '路由或检索', strategyCoverage: '路由或检索', grade: '选择或分支', branch: '选择或分支', alternative: '选择或分支', target: '目标偏离', plan: '方案未落实', execution: '话术未落实', consistency: '素材不一致', usable: '话术需修改', compliance: '无依据事实或承诺' })[item.key] || '上游判断';
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); storageFailed = false; }
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
    get('#pack-picker').innerHTML = `<span><span class="pack-version">模型 v${currentPack.version}<span class="badge blue">${currentPack.id === 'pack-320' ? '本轮' : '基线'}</span></span><small>${currentPack.title} · ${records.length} 个 Case</small></span>${icon('chevron')}`;
    get('#pack-meta').innerHTML = `<span>${currentPack.judge}</span><span>${currentPack.date}</span>`;
    get('#pack-menu').innerHTML = `<div class="menu-heading"><span>选择一个待标注 Case 包</span><span>模拟版本</span></div>${demo.packs.map(record => `<button class="pack-option ${record.id === state.pack ? 'selected' : ''}" data-select-pack="${record.id}">${icon('box')}<span><strong>客户分析模型 v${record.version}</strong><small>${record.title} · ${record.count} 个客户 Case</small><small>${record.date} · ${record.judge}</small></span>${record.id === state.pack ? icon('check', 'checked') : ''}</button>`).join('')}`;
    const search = get('#case-search').value.toLowerCase();
    const matching = records.filter(record => (!search || `${record.name} ${record.id}`.toLowerCase().includes(search)) && (caseFilter === 'all' || (caseFilter === 'submitted' ? state.submissions[record.id] : !state.submissions[record.id])));
    get('#case-count').textContent = `${matching.length} / ${records.length}`;
    get('#case-list').innerHTML = matching.length ? matching.map(record => {
      const submitted = state.submissions[record.id];
      const progress = completedNodes(record);
      const started = Boolean(state.reviews[record.id] || state.owners[record.id] || record.assignedTo);
      const status = !recovered(record) ? '初评失败' : submitted ? '已提交' : started ? '复核中' : '待领取';
      return `<button class="case-row ${record.id === state.caseId ? 'selected' : ''}" data-case="${record.id}" title="${submitted ? '查看已提交结果' : started ? '继续复核' : '领取并打开该 Case（模拟）'}"><span class="row-title"><strong>${record.name}</strong><span class="badge ${!recovered(record) ? 'red' : submitted ? 'green' : started ? 'blue' : ''}">${status}</span></span><span class="row-meta">${record.model} · ${record.stage}</span><span class="row-id"><span>${record.id}</span><span>${progress}/6 节点</span></span></button>`;
    }).join('') : '<div class="empty-state"><p>没有匹配的客户 Case</p></div>';
    const submitted = records.filter(record => state.submissions[record.id]).length;
    get('#workspace-progress').innerHTML = `<div class="progress-caption"><span>当前包已提交</span><strong>${submitted}<span class="muted"> / ${records.length}</span></strong></div><div class="progress-small" role="progressbar" aria-label="Case 包提交进度" aria-valuemin="0" aria-valuemax="${records.length}" aria-valuenow="${submitted}"><span style="width:${submitted / records.length * 100}%"></span></div>`;
  }

  function renderHeader() {
    const record = customer();
    const submission = state.submissions[record.id];
    get('#case-heading').innerHTML = `<div class="case-identity"><span class="avatar">${record.name[0]}</span><div><div class="case-name-line"><h2>${record.name}</h2><span class="case-code">${record.id}</span><span class="badge ${submission ? 'green' : 'blue'}">${submission ? state.editing.includes(record.id) ? '更正中' : '已提交' : '人工复核中'}</span><span class="badge">${record.model}</span></div><div class="case-subtitle"><span>分析时间 ${record.analysisTime}</span><span>触发：${record.trigger}</span><span>复核人：${escape(submission?.reviewer || state.owners[record.id] || record.assignedTo || reviewer)}</span></div></div></div><div class="case-tools"><button class="icon-button" data-navigate-case="-1" aria-label="上一个客户">${icon('arrow', 'rotate')}</button><button class="icon-button" data-navigate-case="1" aria-label="下一个客户">${icon('arrow')}</button><button class="button" id="show-trace">${icon('link')}原始 Trace</button>${locked() ? '<button id="edit-submission" class="button">更正结论</button>' : `<button id="submit-case" class="button primary" ${completedNodes(record) < 6 ? 'disabled title="完成六个节点并补齐必填项后提交"' : ''}>提交整条 Case</button>`}</div>`;
    if (state.history.some(entry => entry.caseId === record.id)) get('.case-tools').insertAdjacentHTML('afterbegin', `<button id="show-history" class="button">${icon('clock')}修改记录</button>`);
  }

  function renderTabs() {
    const record = customer();
    get('#node-tabs').innerHTML = demo.modules.map(node => {
      const finished = recovered(record) && validCount(record, node.id) === record.nodes[node.id].items.length;
      return `<button class="node-tab ${node.id === state.node ? 'active' : ''}" id="tab-${node.id}" data-node="${node.id}" role="tab" aria-controls="evidence-panel" aria-selected="${node.id === state.node}"><span class="node-label">${node.id}${finished ? icon('check') : '<i class="node-dot"></i>'}</span><strong>${node.short}</strong></button>`;
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
      input = `<div class="data-label">客户状态与主问题</div>${factBlock(node.input.customer_state)}<div class="query-row"><span>scene<b>${node.input.scene}</b></span><span>node<b>${node.input.node}</b></span></div><div class="data-tags"><span>已完成试驾：${record.stage === '已完成试驾' ? '是' : '否'}</span><span>实际查询 · 候选 + 详情</span></div>`;
      output = `<div class="query-row"><span>候选策略<b>${node.output.candidates.length} 条</b></span><span>已查范围<b>本模拟快照的 3 条策略</b></span></div>${node.output.candidates.map(strategy => `<div class="strategy-card ${strategy.selected ? 'selected' : ''}"><div class="strategy-top"><div><span class="strategy-code">${strategy.id} · 演示 ID</span><strong>${strategy.title}</strong></div>${strategy.selected ? '<span class="badge blue">最终选中</span>' : '<span class="badge">候选</span>'}</div><div class="strategy-subtitle">${strategy.subtitle}</div>${strategy.selected ? `<div class="branch-box"><span class="branch-label">实际采用分支</span><span>${strategy.branch}</span></div><p>${strategy.action}</p>` : ''}<details class="candidate-details"><summary>查看适用条件、排除条件与动作</summary><p>适用：${strategy.applicable}<br>排除：${strategy.exclude}<br>分支：${strategy.branch}${strategy.selected ? '' : `<br>动作：${strategy.action}`}</p></details></div>`).join('')}`;
    } else if (state.node === 'M3') {
      input = `<div class="data-label">素材需求</div>${factBlock(node.input.material_need)}${node.input.semantic_query ? `<div class="data-label">Q01 · 实际 Query</div>${factBlock(node.input.semantic_query)}<div class="query-row"><span>is_real_photo<b>false</b></span><span>请求结果<b>成功 · 3 条</b></span></div>` : ''}`;
      output = node.output.materials ? `<div class="data-label">完整返回 · 保留原始排序</div>${node.output.materials.map(material => `<div class="strategy-card"><div class="strategy-top"><div class="material-thumb"><div class="material-art">${icon('file')}</div><div><span class="strategy-code">#0${material.position} · ${material.materialId}</span><strong>${material.title}</strong></div></div>${material.selected ? '<span class="badge blue">已采用</span>' : ''}</div><p>${material.content}</p><span class="badge">${material.type} · 模拟内容预览</span></div>`).join('')}` : factBlock(node.output.reason);
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
    const items = state.node === 'M4' ? [...node.items].sort((first, second) => Number(second.key === 'grade') - Number(first.key === 'grade')) : node.items;
    get('#review-count').textContent = `${validCount(record, state.node)} / ${items.length} 项`;
    if (!recovered(record)) {
      get('#review-panel').innerHTML = `<div class="empty-state">${icon('warning')}<h3>AI 初评未完成</h3><p>模拟调用超时，尚未形成有效评估结论。<br>与客户分析 Agent 的业务错误分开记录。</p><button class="button" id="retry-evaluation">模拟重试初评</button></div>`;
      return;
    }
    if (!items.length) {
      get('#review-panel').innerHTML = `<div class="empty-state">${icon('info')}<h3>本轮未执行素材检索</h3><p>客户无需素材，按需跳过本节点。<br>不参与素材检索指标分母。</p></div>`;
      return;
    }
    let previousVersion = '';
    get('#review-panel').innerHTML = `<div class="review-notice">${icon('info')}<span>${readOnly ? '已提交确认结果，只读查看。更正会保留上一版记录。' : `先判断评估是否准确，再保留或修正结论。<br>${pack().judge} · ${pack().standard}（模拟版本）`}</span></div>${items.map((item, index) => {
      const review = reviewFor(record, state.node, item);
      const different = review.accuracy === 'disagree';
      const unknown = review.accuracy === 'unknown';
      const agentBad = engine.isBad(review);
      const versionHeading = item.version && item.version !== previousVersion ? `<div class="review-version-label">${item.version}</div>` : '';
      previousVersion = item.version;
      const evidenceOptions = record.evidence.map(source => ({ value: source.id, label: `${source.id} · ${source.title}` }));
      if (unknown) evidenceOptions.push({ value: '缺失：E01 原始工单', label: '缺失：E01 原始工单' }, { value: '缺失：节点输入', label: '缺失：节点实际输入' }, { value: '缺失：候选详情', label: '缺失：候选 / 素材完整内容' });
      return `${versionHeading}<article class="review-item ${different ? 'is-correction' : ''}" data-item="${item.id}"><div class="review-item-title"><span class="item-index">${String(index + 1).padStart(2, '0')}</span><strong>${item.title}</strong></div><div class="review-unit">${item.unit}</div><div class="ai-conclusion"><span class="ai-label">AI 初评</span>${statusBadge(item.ai)}${different ? `<span class="badge orange">已改判 → ${escape(review.human)}</span>` : ''}</div>${review.accuracy === 'agree' ? `<details class="candidate-details"><summary>查看 AI 判断理由与依据</summary><p class="ai-reason">${item.reason}</p><button class="ai-evidence-link" data-highlight-source="${item.evidence}">${icon('link')} 依据 ${item.evidence}</button></details>` : `<p class="ai-reason">${item.reason}</p><button class="ai-evidence-link" data-highlight-source="${item.evidence}">${icon('link')} 依据 ${item.evidence} · 查看原文</button>`}<div class="review-accuracy-label"><span>评估模型的判断准确吗？</span>${review.accuracy ? '<span>已复核</span>' : '<span class="muted">待确认</span>'}</div><div class="review-choices">${[['agree', '准确'], ['disagree', '不准确'], ['unknown', '资料不足']].map(([value, label]) => `<button data-accuracy="${value}" class="${review.accuracy === value ? 'selected' : ''}" ${readOnly ? 'disabled' : ''}>${review.accuracy === value ? icon(value === 'agree' ? 'check' : value === 'disagree' ? 'edit' : 'info') : ''}${label}</button>`).join('')}</div>${different || unknown ? `<div class="correction-form"><div class="two-fields"><label><span>人工结论 <b>*</b></span><select data-field="human" ${readOnly || unknown ? 'disabled' : ''}>${options(item.options, review.human)}</select></label>${different ? `<label><span>评估模型问题 <b>*</b></span><select data-field="judgeIssue" ${readOnly ? 'disabled' : ''}>${options(demo.judgeIssues, review.judgeIssue, '选择问题分类')}</select></label>` : '<div class="failure-banner">资料不足单列<br>不自动记为通过或业务错误</div>'}</div><label><span>${unknown ? '资料缺失说明' : '改判理由'} <b>*</b></span><textarea data-field="reason" ${readOnly ? 'disabled' : ''} placeholder="说明判断依据与原判的问题">${escape(review.reason)}</textarea></label><label><span>${unknown ? '缺失来源' : '引用原始依据'} <b>*</b></span><select data-field="evidence" ${readOnly ? 'disabled' : ''}>${options(evidenceOptions, review.evidence, '选择对应的资料来源')}</select></label></div>` : review.accuracy === 'agree' ? '<div class="confirmed-note"><span>人工结论与 AI 原判一致</span><span>原判已保留</span></div>' : ''}${review.accuracy && !unknown ? `<div class="agent-diagnosis"><label>客户分析 Agent 问题分类${item.key === 'grade' ? '（需明确问题，不按等级自动判错）' : ''}<select data-field="agentIssue" ${readOnly ? 'disabled' : ''}>${options(demo.agentIssues, review.agentIssue, agentBad ? '待归因 · 请选择问题分类' : '未确认 Agent 问题')}</select></label>${different && !agentBad ? '<p>评估有误，但 Agent 合理：不进入 badcase。</p>' : '<p>与评估模型误判分类分别记录。</p>'}</div>` : ''}</article>`;
    }).join('')}`;
  }

  function renderFooter() {
    if (!customer()) return;
    const record = customer();
    const done = completedNodes(record);
    get('#save-status').innerHTML = `${icon(storageFailed ? 'warning' : 'check')}${storageFailed ? '浏览器存储不可用，仅保留本次打开的进度' : locked() ? '已提交确认结果 · 历史原判保留' : '草稿已保存在本机'}<small>整条 Case ${done} / 6 节点已完成${state.editing.includes(record.id) ? ' · 重新提交后才更新聚合结果' : ''}</small>`;
    get('#save-draft').disabled = locked();
    get('#confirm-node').disabled = locked() || !recovered(record);
    const submit = get('#submit-case');
    if (submit) submit.disabled = done < 6;
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
        review.reason = '';
        review.evidence = item.evidence;
        review.agentIssue = engine.isBad({ human: item.ai }) ? defaultAgentIssue(item) : '';
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
      if (field === 'human') review.agentIssue = engine.isBad({ human: value }) ? defaultAgentIssue(item) : '';
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
  function setView(view) {
    get('#workbench').hidden = view !== 'workbench';
    get('#results').hidden = view !== 'results';
    get('#workspace-progress').hidden = view !== 'workbench';
    get('#export-results').hidden = view !== 'results';
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    history.replaceState(null, '', `#${view}`);
    get('#pack-menu').hidden = true;
    get('#pack-picker').setAttribute('aria-expanded', 'false');
    if (view === 'results') renderResults();
    else renderWorkbench();
  }

  function allRows() {
    return demo.cases.flatMap(record => {
      const submission = state.submissions[record.id];
      const reviews = submission?.snapshot || state.reviews[record.id] || {};
      const sourcePack = demo.packs.find(item => item.id === record.packId);
      return demo.modules.flatMap(node => record.nodes[node.id].items.map(item => ({ ...item, ...(reviews[node.id]?.[item.id] || {}), itemId: item.id, caseId: record.id, packId: record.packId, name: record.name, module: node.id, version: sourcePack.version, judgeVersion: sourcePack.judge, standard: sourcePack.standard, reviewer: submission?.reviewer || '', reviewedAt: submission?.reviewedAt || '', submitted: Boolean(submission) })));
    });
  }

  function resultFilters() { return { pack: get('#result-pack').value, module: get('#result-module').value, accuracy: get('#result-accuracy').value, issue: get('#result-issue').value, judgeIssue: get('#result-judge-issue').value, reviewer: get('#result-reviewer').value, search: get('#result-search').value.trim(), from: get('#result-from').value, to: get('#result-to').value, mode: resultMode }; }

  function summaryCard(title, id, number, footer, emblem, tone = '') {
    return `<article class="summary-card panel"><div class="summary-top"><span>${title}</span><span class="summary-icon ${tone}">${icon(emblem)}</span></div><div class="summary-number" id="${id}">${number}</div><p>${footer}</p></article>`;
  }

  function renderMetricCard(node, rows, selected) {
    const metrics = engine.moduleMetrics(rows, node.id);
    const metric = node.id === 'M6' ? metrics.find(item => item.key === 'compliance') : metrics[0];
    const human = metric.human;
    const ai = metric.ai;
    return `<button class="module-card ${selected === node.id ? 'active' : ''}" data-metric-module="${node.id}"><div class="module-card-top"><span>${node.id}</span>${node.short}</div><div class="metric-name">${metric.distribution ? '策略适配等级分布' : metric.title}</div>${metric.distribution ? `<div class="distribution">${human.grades.map((count, index) => `<span><i style="height:${Math.max(1, count / Math.max(1, ...human.grades) * 22)}px" title="Grade ${index + 1}：${count} 个"></i>G${index + 1} · ${count}</span>`).join('')}</div><div class="threshold-note">阈值待确认 · 不计算通过率</div>` : `<div class="metric-rate">${percentage(human.value)}</div><div class="metric-progress"><span class="${human.value >= 85 ? 'good' : ''}" style="width:${human.value ?? 0}%"></span></div>`}<div class="metric-base"><span>${metric.distribution ? `${human.denominator} 个已判等级` : `人工 ${human.numerator}/${human.denominator}${human.samples !== undefined ? ` · ${human.samples}次` : ''}`}</span><span>AI ${metric.distribution ? `${ai.denominator} 个` : percentage(ai.value)}</span></div></button>`;
  }

  function renderResults() {
    const filters = resultFilters();
    const rows = engine.filterRows(allRows(), filters);
    visibleRows = rows.sort((first, second) => Number(second.accuracy === 'disagree') - Number(first.accuracy === 'disagree') || second.reviewedAt.localeCompare(first.reviewedAt) || first.caseId.localeCompare(second.caseId));
    const summary = engine.summarize(rows);
    const candidateCount = demo.cases.filter(record => filters.pack === 'all' || record.packId === filters.pack).length;
    get('#result-scope').textContent = `当前筛选：${summary.cases} 个已复核 Case · ${summary.rows} 条标注项`;
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
    get('#results-table tbody').innerHTML = pageRows.length ? pageRows.map((row, index) => `<tr data-result="${index}"><td><div class="customer-cell"><strong>${row.name}</strong><small>${row.caseId}</small></div></td><td><span class="badge">v${row.version}</span></td><td><span>${row.module} · ${escape(row.title)}</span><div class="cell-sub">${row.unit}</div></td><td><div class="comparison"><span class="original">${escape(row.ai)}</span>${icon('arrow')}<span class="human ${row.accuracy === 'disagree' ? 'changed' : ''}">${escape(row.human)}</span></div></td><td><span class="badge ${row.accuracy === 'agree' ? 'green' : row.accuracy === 'disagree' ? 'orange' : ''}">${row.accuracy === 'agree' ? '准确' : row.accuracy === 'disagree' ? '不准确' : '资料不足'}</span>${row.judgeIssue ? `<div class="cell-sub">${escape(row.judgeIssue)}</div>` : ''}</td><td>${row.agentIssue ? `<span class="badge red">${escape(row.agentIssue)}</span>` : `<span class="muted">${engine.isBad(row) ? '待归因' : '—'}</span>`}</td><td>${row.reviewer}<small>${row.reviewedAt}</small></td><td><button data-open-result="${row.caseId}" data-result-node="${row.module}">查看${icon('arrow')}</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><h3>没有匹配的标注结果</h3><p>请调整筛选条件。未提交的草稿不会进入结果列表。</p></div></td></tr>';
    get('#pagination-summary').textContent = rows.length ? `共 ${rows.length} 条标注项，显示 ${(resultPage - 1) * 10 + 1}–${Math.min(resultPage * 10, rows.length)} 条` : '共 0 条标注项';
    get('#pagination-page').textContent = `${resultPage} / ${pageCount}`;
    get('#previous-page').disabled = resultPage <= 1;
    get('#next-page').disabled = resultPage >= pageCount;
  }

  function validateNode() {
    const record = customer();
    const errors = record.nodes[state.node].items.flatMap(item => {
      const review = reviewFor(record, state.node, item);
      if (!review.accuracy) return [];
      const problems = engine.validateReview(item, review);
      get(`[data-item="${item.id}"]`)?.classList.toggle('invalid', Boolean(problems.length));
      return problems.map(problem => `${item.title}：${problem}`);
    });
    return errors;
  }

  function confirmNode() {
    const errors = validateNode();
    if (errors.length) { toast(errors[0]); get('.review-item.invalid')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    const record = customer();
    const node = state.node;
    const remaining = record.nodes[node].items.filter(item => !reviewFor(record, node, item).accuracy);
    showDialog('确认本节点的人工复核', remaining.length ? `将本节点尚未复核的 ${remaining.length} 项按“AI 判断准确，人工结论与原判一致”确认。已填写的改判或资料不足结论保持不变。` : '本节点各项已完成复核。确认后保存进度并进入下一节点；只有提交整条 Case 后才参与结果统计。', () => {
      remaining.forEach(item => updateReview(item.id, 'accuracy', 'agree'));
      const nextIndex = demo.modules.findIndex(item => item.id === node) + 1;
      if (nextIndex < demo.modules.length) selectNode(demo.modules[nextIndex].id);
      else { renderWorkbench(); toast('六个节点已完成，可提交整条 Case'); }
      persist();
    });
  }

  function submitCase() {
    const record = customer();
    if (completedNodes(record) < 6) { toast('请完成六个节点并补齐必填项'); return; }
    showDialog(state.submissions[record.id] ? '提交更正后的整条 Case' : '提交整条 Case 的确认结果', `${record.name} · ${record.id}，六个节点已完成复核。提交后，人工结论进入聚合统计；AI 原判、理由和证据分别保留。`, () => {
      const previous = state.submissions[record.id];
      if (previous) state.history.push({ caseId: record.id, ...structuredClone(previous) });
      const reviewedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      state.submissions[record.id] = { reviewer, reviewedAt, snapshot: structuredClone(state.reviews[record.id]), version: (previous?.version || 0) + 1 };
      state.editing = state.editing.filter(caseId => caseId !== record.id);
      persist(); renderWorkbench(); toast('整条 Case 已提交 · 标注结果与聚合指标已更新');
    });
  }

  function exportResults() {
    const fields = [['caseId', 'Case 编号'], ['name', '客户'], ['version', '客户分析模型版本'], ['module', '节点'], ['title', '标注项'], ['unit', '评价粒度'], ['ai', 'AI 原判'], ['human', '人工结论'], ['accuracy', '评估准确性'], ['judgeIssue', '评估模型问题'], ['agentIssue', 'Agent 问题'], ['reason', '理由'], ['evidence', '依据'], ['reviewer', '复核人'], ['reviewedAt', '复核时间'], ['judgeVersion', '评估模型版本'], ['standard', '评分标准版本']];
    const csvValue = value => `"${String(value ?? '').replace(/^[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
    const content = '\ufeff' + [fields.map(field => csvValue(field[1])).join(','), ...visibleRows.map(row => fields.map(field => csvValue(row[field[0]])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '客户分析标注结果-模拟数据.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出当前筛选的 ${visibleRows.length} 条模拟标注结果`);
  }

  get('#result-pack').innerHTML = options([{ value: 'all', label: '全部 Case 包' }, ...demo.packs.map(record => ({ value: record.id, label: `模型 v${record.version} · ${record.count} 个 Case` }))], 'all');
  get('#result-module').innerHTML = options([{ value: 'all', label: '全部链路节点' }, ...demo.modules.map(node => ({ value: node.id, label: `${node.id} · ${node.short}` }))], 'all');
  get('#result-issue').innerHTML = options([{ value: 'all', label: '全部问题分类' }, ...demo.agentIssues], 'all');
  get('#result-judge-issue').innerHTML = options([{ value: 'all', label: '全部评估模型问题' }, ...demo.judgeIssues], 'all');
  get('#result-reviewer').innerHTML = options([{ value: 'all', label: '全部复核人' }, ...demo.reviewers], 'all');

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.disabled) return;
    if (button?.dataset.view) { setView(button.dataset.view); return; }
    if (button?.id === 'pack-picker') { get('#pack-menu').hidden = !get('#pack-menu').hidden; button.setAttribute('aria-expanded', !get('#pack-menu').hidden); return; }
    if (button?.dataset.selectPack) {
      state.pack = button.dataset.selectPack;
      get('#pack-menu').hidden = true;
      caseFilter = 'all'; get('#case-search').value = '';
      document.querySelectorAll('[data-case-filter]').forEach(item => item.classList.toggle('active', item.dataset.caseFilter === 'all'));
      selectCase(demo.cases.find(record => record.packId === state.pack).id);
      get('#pack-picker').setAttribute('aria-expanded', 'false'); return;
    }
    if (!event.target.closest('.sidebar-pack')) { get('#pack-menu').hidden = true; get('#pack-picker').setAttribute('aria-expanded', 'false'); }
    if (button?.dataset.case) { selectCase(button.dataset.case); return; }
    if (button?.dataset.node) { selectNode(button.dataset.node); return; }
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
    if (button?.dataset.metricModule) { get('#result-module').value = get('#result-module').value === button.dataset.metricModule ? 'all' : button.dataset.metricModule; resultPage = 1; renderResults(); return; }
    if (button?.dataset.resultMode) { resultMode = button.dataset.resultMode; document.querySelectorAll('[data-result-mode]').forEach(item => item.classList.toggle('active', item === button)); resultPage = 1; renderResults(); return; }
    if (button?.dataset.openResult) { state.node = button.dataset.resultNode; selectCase(button.dataset.openResult); setView('workbench'); return; }
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
    if (button?.id === 'export-results') { exportResults(); return; }
    if (button?.id === 'previous-page' || button?.id === 'next-page') { resultPage += button.id === 'next-page' ? 1 : -1; renderResults(); return; }
    if (button?.id === 'reset-filters') {
      ['pack', 'module', 'accuracy', 'issue', 'judge-issue', 'reviewer'].forEach(field => { get(`#result-${field}`).value = 'all'; });
      ['search', 'from', 'to'].forEach(field => { get(`#result-${field}`).value = ''; });
      resultMode = 'all'; resultPage = 1;
      document.querySelectorAll('[data-result-mode]').forEach(item => item.classList.toggle('active', item.dataset.resultMode === 'all'));
      renderResults(); return;
    }
  });
  get('#review-panel').addEventListener('change', event => { const field = event.target.dataset.field; if (field && field !== 'reason') updateReview(event.target.closest('[data-item]').dataset.item, field, event.target.value); });
  get('#review-panel').addEventListener('input', event => { if (event.target.dataset.field === 'reason') updateReview(event.target.closest('[data-item]').dataset.item, 'reason', event.target.value); });
  get('#case-search').addEventListener('input', renderSidebar);
  ['pack', 'module', 'accuracy', 'issue', 'judge-issue', 'reviewer', 'from', 'to'].forEach(field => get(`#result-${field}`).addEventListener('change', () => { resultPage = 1; renderResults(); }));
  get('#result-search').addEventListener('input', () => { resultPage = 1; renderResults(); });
  get('#action-dialog').addEventListener('submit', event => {
    event.preventDefault();
    const action = dialogAction;
    dialogAction = null;
    const confirmed = event.submitter?.value === 'confirm';
    get('#action-dialog').close(confirmed ? 'confirm' : 'cancel');
    if (confirmed && action) action();
  });
  get('#action-dialog').addEventListener('close', () => { dialogAction = null; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { get('#pack-menu').hidden = true; get('#pack-picker').setAttribute('aria-expanded', 'false'); } });
  window.addEventListener('hashchange', () => setView(location.hash === '#results' ? 'results' : 'workbench'));
  renderWorkbench(); persist(); setView(location.hash === '#results' ? 'results' : 'workbench');
})();
