(function (root) {
  const modules = [
    { id: 'M1', title: '客户状态判断', short: '客户状态', description: '核对客户当前阶段、意愿与已有进展。' },
    { id: 'M2', title: '卡点识别', short: '卡点识别', description: '核对主问题、当前有效性和优先级。' },
    { id: 'M3', title: '素材检索与选择', short: '素材检索', description: '对照每次 Query、完整候选和最终选用素材。' },
    { id: 'M4', title: '策略检索与选择', short: '策略选择', description: '核对实际候选、适用分支和最终采用动作。' },
    { id: 'M5', title: '目标与跟进方案', short: '目标方案', description: '核对目标及方案是否承接客户状态和策略打法。' },
    { id: 'M6', title: '电话与企微文案', short: '沟通文案', description: '逐版核对策略落实、素材一致性、可用性与合规。' },
  ];
  const packs = [
    { id: 'pack-320', title: '客户分析 · 本轮迭代', datasetVersion: '2026-11-11', version: '3.2.0', date: '2026-11-11', frozenAt: '2026-11-11', judge: 'Judge 1.4.0', standard: '评测标准 0.3 · 策略三档', prompt: 'CA-prompt 3.2', count: 8 },
    { id: 'pack-310', title: '客户分析 · 上轮基线', datasetVersion: '2026-11-10', version: '3.1.0', date: '2026-11-10', frozenAt: '2026-11-10', judge: 'Judge 1.4.0', standard: '评测标准 0.3 · 策略三档', prompt: 'CA-prompt 3.1', count: 6 },
  ];
  const judgeIssues = ['误判为正确', '误判为错误', '等级偏高', '等级偏低', '依据引用错误', '判断理由不成立', '遗漏评估项'];
  const issuesByModule = {
    M1: ['状态判断错误', '行动承接错误', '事实无依据'],
    M2: ['卡点判断错误', '关键问题遗漏', '优先级不合理'],
    M3: ['Query 问题', '搜索问题', '素材选择问题', '素材供给不足'],
    M4: ['策略查询条件错误', '策略候选遗漏', '策略选择错误', '打法分支错误', '策略供给不足'],
    M5: ['目标偏离', '方案未落实'],
    M6: ['话术未落实', '素材不一致', '话术需修改', '线上行为披露', '无依据事实或承诺'],
  };
  const agentIssues = Object.values(issuesByModule).flat();
  const reviewers = ['评测 · 周宁', '业务 · 李悦', '研发 · 赵然'];
  const grades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', '证据不足'];
  const strategyGrades = ['1 分', '2 分', '3 分', '证据不足'];
  const samplingTypes = ['已使用 · 负反馈', '未使用 · 正反馈'];
  const materialModes = [{ value: 'direct', label: '非兜底 · 正常选用' }, { value: 'fallback', label: '兜底选用' }, { value: 'none', label: '未选用素材' }];
  const correctOptions = ['正确', '错误', '证据不足'];
  const profiles = [
    ['陈先生', '理想 L9', '家庭用车', '已完成试驾', '家庭空间', '希望带家人再体验一次，先看后排空间视频'],
    ['王女士', '理想 L6', '城市通勤', '资料比较中', '泊车体验', '先了解泊车功能，再决定周末是否到店'],
    ['林先生', '理想 L7', '家庭增购', '已完成试驾', '长途舒适性', '已经试驾，希望进一步了解长途乘坐体验'],
    ['赵女士', '理想 L8', '置换用车', '已完成试驾', '置换流程', '已接受评估旧车，准备先明确置换流程'],
    ['刘先生', '理想 L9', '家庭用车', '资料比较中', '后排空间', '请先把后排空间资料发来，暂不安排电话'],
    ['周女士', '理想 L6', '城市通勤', '资料比较中', '使用便利性', '想了解日常通勤和停车便利性'],
    ['吴先生', '理想 L7', '家庭用车', '已完成试驾', '购车时间', '试驾后准备和家人商量购车时间'],
    ['郑女士', '理想 L8', '家庭增购', '资料比较中', '家庭出行', '希望先比较家庭出行场景的使用体验'],
    ['张先生', '理想 L9', '家庭用车', '已完成试驾', '家庭空间', '想再看家庭空间的视频后带家人复试驾'],
    ['许女士', '理想 L7', '家庭增购', '已完成试驾', '长途舒适性', '已经接受复试驾，待家人确认时间'],
    ['何先生', '理想 L6', '城市通勤', '资料比较中', '泊车体验', '先看泊车演示资料，不希望立即电话邀约'],
    ['唐女士', '理想 L8', '置换用车', '已完成试驾', '置换流程', '已同意旧车评估，希望先核对流程材料'],
    ['孙先生', '理想 L9', '家庭用车', '已完成试驾', '复试驾时间', '不需要更多素材，只确认复试驾的时间'],
    ['黄女士', '理想 L6', '城市通勤', '资料比较中', '日常用车', '先看日常用车的资料再确定到店时间'],
  ];

  function assessment(id, key, title, unit, ai, options, reason, extra = {}) {
    return { id, key, title, unit, ai, options, reason, evidence: 'E02', ...extra };
  }

  function makeCase(profile, index) {
    const [name, model, purpose, stage, topic, request] = profile;
    const packId = index < 8 ? 'pack-320' : 'pack-310';
    const order = index < 8 ? index + 1 : index - 7;
    const caseId = `CA-${index < 8 ? '320' : '310'}-${String(order).padStart(2, '0')}`;
    const trial = stage === '已完成试驾';
    const special = index === 0 || index === 9;
    const sourceDate = index < 8 ? '2026-11-10' : '2026-11-09';
    const correctBranch = trial ? '已体验 · 意愿明确 · 承接下一步' : '先资料 · 再反馈 · 尊重触达限制';
    const selectedBranch = special ? '未试驾 · 激发首次体验兴趣' : correctBranch;
    const evidence = [
      { id: 'E01', title: trial ? '试驾工单' : '客户资料', date: `${sourceDate} 14:30`, type: '业务记录', text: trial ? `客户已完成 ${model} 试驾，对${topic}进一步提出问题。` : `客户正在比较 ${model}，本轮主要关注${topic}，暂无已完成试驾记录。` },
      { id: 'E02', title: '企微沟通原文', date: `${sourceDate} 18:20`, type: '客户自述', text: index === 0 ? '「这周末带家人再试一次，先把后排空间的视频发我。」' : `「${request}。」` },
      { id: 'E03', title: '历史跟进记录', date: `${index < 8 ? '2026-11-11' : '2026-11-10'} 09:10`, type: '业务摘要', text: index === 0 ? '已接受周末家庭复试驾；先发送空间资料，家人到场时间待确认。' : `已记录客户关于${topic}的诉求，保留已有安排，不重复首次邀约。` },
    ];
    if (index === 6) {
      evidence[0].available = false;
      evidence[0].text = '缺少原始试驾工单，仅有历史客户画像，无法核验当前阶段。';
    }
    if (index === 4) evidence.push({ id: 'E04', title: '后台行为记录', date: `${sourceDate} 17:20`, type: '线上行为 · 非客户自述', text: `后台记录客户浏览了${topic}页面。仅用于内部分析，不能向客户透露后台掌握方式。` });
    const materials = [
      { materialId: `DEMO-MAT-${order}-01`, title: `${model} · ${topic}场景演示`, content: `围绕${topic}的真实使用场景及细节演示。`, type: '视频', position: 1, selected: true, materialVersion: '模拟素材快照 11.10' },
      { materialId: `DEMO-MAT-${order}-02`, title: `${model} · ${topic}图文介绍`, content: `与${topic}相关的图文介绍和说明。`, type: '图文', position: 2, selected: false, materialVersion: '模拟素材快照 11.10' },
      { materialId: `DEMO-MAT-${order}-03`, title: `${model} · 外观配色实拍`, content: '展示外观颜色及车漆效果，不包含当前关注主题的演示。', type: '实拍', position: 3, selected: false, materialVersion: '模拟素材快照 11.10' },
    ];
    if (index === 8) {
      materials[0].content = '视频主要展示外观及车漆，只有简短的家庭空间镜头，缺少客户关注的后排体验。';
      materials[1].content = '图文主要介绍前排储物，未完整说明客户关注的后排空间场景。';
    }
    const strategies = [
      { id: 'DEMO-STR-104', title: `${topic}场景体验`, subtitle: '主策略 · 体验问题的实际解决', branch: selectedBranch, applicable: trial ? '已体验且希望继续了解相关场景' : '正在比较并愿意进一步了解', exclude: '客户明确拒绝体验或尚需先核实条件', action: special ? '介绍家庭空间亮点，激发客户首次试驾兴趣，再发起到店邀约。' : `先提供${topic}资料，承接客户已经认可的下一步安排。`, selected: true },
      { id: 'DEMO-STR-207', title: trial ? '共同决策人参与复试驾' : '先资料后反馈', subtitle: '候选策略 · 承接已有进展', branch: correctBranch, applicable: trial ? '已完成试驾，接受进一步体验，需家人参与' : '客户希望先看资料再决定是否到店', exclude: '无客户意愿依据，不应新增邀请', action: `先发送${topic}资料，确认反馈，再按客户意愿推进。`, selected: false },
      { id: 'DEMO-STR-312', title: '低打扰信息跟进', subtitle: '候选策略 · 尊重沟通限制', branch: '只看资料 · 暂不电话', applicable: '客户明确希望先看资料，或当前不便电话', exclude: '已有紧急待办需先处理', action: '发送已确认资料，避免连续追问，等待客户反馈。', selected: false },
    ];
    if ([1, 2, 4, 8, 10].includes(index)) strategies[1].selected = true;
    const nodes = {
      M1: {
        input: { customer_information: { information: { model, purpose, stage, topic }, revision: 'demo-profile-r12' }, records: evidence },
        output: { available_facts: [`客户关注${topic}`, trial ? '已完成试驾' : '尚未完成试驾'], information_assessments: ['当前状态有最近记录支持', '行动时间仍需进一步确认'], decision: { customer_state: `${stage}；${request}；保留已经认可的下一步安排。` } },
        items: [assessment('status-0', 'status', '客户当前阶段是否正确', '状态项 · 当前阶段', '正确', correctOptions, `客户记录支持“${stage}”的判断。`, { expectedCount: 2 }), assessment('status-1', 'status', '客户当前意愿是否正确', '状态项 · 有效意愿', '正确', correctOptions, '客户自述与当前意愿一致。', { expectedCount: 2 }), assessment('action-0', 'action', '已有行动是否正确承接', '行动事项 · 下一步约定', '正确', [...correctOptions, '不适用'], '已经接受的下一步被保留，没有重置进展。'), assessment('fact-0', 'fact', '事实陈述是否有依据', '事实陈述 · 主要关注点', '有依据', ['有依据', '与证据冲突', '无依据断言', '无法核验'], '企微原文直接支持本轮关注主题。')],
      },
      M2: {
        input: { customer_state: stage, records: evidence, unresolved_conditions: ['具体时间需确认'] },
        output: { decision: { main_issue: `${topic}需要进一步确认，优先完成已接受的资料与安排。` }, unresolved_gaps: ['相关问题的客户反馈尚未取得'] },
        items: [assessment('point-0', 'point', '卡点判断是否正确', '卡点 · 当前关注问题', '正确', correctOptions, '客户明确提出问题，不是无依据推断。', { pointId: 'p1' }), assessment('validity-0', 'validity', '卡点是否当前有效', '卡点 · 当前关注问题', '有效', ['有效', '已解决或失效', '证据不足'], '未见解决记录，且最近自述仍表明需要确认。', { pointId: 'p1' }), assessment('coverage-0', 'coverage', '关键问题是否被覆盖', '参考问题 · 本轮主要诉求', '已覆盖', ['已覆盖', '遗漏', '证据不足'], '原文主要诉求在输出中完整保留。', { expectedCount: 1 }), assessment('priority-0', 'priority', '主问题与优先级是否合理', '整条 Case · 优先问题', '合理', ['合理', '不合理', '证据不足', '不适用'], '先处理客户本轮诉求，再推进下一步。')],
      },
      M3: {
        input: { material_need: `回应客户${topic}问题，先提供${model}相关资料`, semantic_query: `${model} ${topic} 场景演示`, is_real_photo: false },
        output: { materials, material_ids: [materials[0].materialId], final_materials: [materials[0]] },
        items: [assessment('query-0', 'query', '素材 Query 构造是否合理', '搜索请求 · Q01', '是', ['是', '否', '证据不足'], '车型、主题与客户诉求对应，无新增限制。', { requestId: 'Q01', result: 'success', returnedCount: 3 }), ...materials.map((material, materialIndex) => assessment(`material-${materialIndex}`, 'materialGrade', `素材 #0${materialIndex + 1} 相关性等级`, `素材 · ${material.title}`, `Grade ${[5, 4, 2][materialIndex]}`, grades, materialIndex < 2 ? '素材正文能够回应当前 Query 的主要主题。' : '素材聚焦外观，与本轮 Query 主题不同。', { requestId: 'Q01', position: materialIndex + 1 }))],
      },
      M4: {
        input: { customer_state: `${stage}；${request}`, main_issue: `${topic}需要进一步确认`, scene: '考虑与比较', node: topic, strategy_library_version: '模拟策略快照 2026-11-10' },
        output: { candidates: strategies, strategy_ids: strategies.filter(strategy => strategy.selected).map(strategy => strategy.id), strategy_id: strategies[0].id, decision: { concrete_help: strategies.filter(strategy => strategy.selected).map(strategy => strategy.action).join('；'), next_step: special ? '邀请首次到店试驾' : '承接客户认可的下一步安排' }, selected_branch: selectedBranch, independent_review: { scope: '本模拟快照中展示的 3 条策略', reference_ids: [strategies[0].id, strategies[1].id] } },
        items: [assessment('strategy-query', 'strategyQuery', '策略查询条件是否合理', '查询 · 场景与问题方向', '合理', ['合理', '不合理', '证据不足'], '查询主题与客户主要诉求一致，保留适用策略范围。'), ...strategies.slice(0, 2).map((strategy, strategyIndex) => assessment(`strategy-coverage-${strategyIndex}`, 'strategyCoverage', '适用策略是否被候选覆盖', `人工参考策略 · ${strategy.title}`, '已覆盖', ['已覆盖', '遗漏', '证据不足'], '独立审查认可的适用策略出现在本次候选中。', { expectedCount: 2 })), assessment('strategy-grade', 'grade', '客户策略组合适配得分', '客户粒度 · 全部实际采用策略与动作', special ? '2 分' : '3 分', strategyGrades, special ? '主题适配，但共同决策人参与复试驾可能是更优方案。初评尚未识别实际分支冲突。' : '实际采用策略共同承接客户状态、主要问题及已有安排，在本模拟候选范围内为合理优选。'), assessment('strategy-branch', 'branch', '打法分支与动作是否正确', '实际策略组合 · 分支与最终动作', special ? '错误' : '正确', correctOptions, special ? '已完成试驾且接受复试驾，当前动作却重新激发首次兴趣。' : '各采用分支均尊重当前意愿并承接已有安排。'), assessment('strategy-alternative', 'alternative', '库内是否存在明确更优方案', '独立审查 · 同版可见候选', special ? '存在明确更优' : '当前合理优选', ['当前合理优选', '存在相当方案', '存在明确更优', '当前不适用且有替代', '已确认无适用方法', '审查不足'], special ? '共同决策人参与复试驾更直接承接客户当前进展。' : '在已查的候选范围内，当前方案合理。')],
      },
      M5: {
        input: { customer_state: stage, strategy_id: strategies[0].id, selected_branch: selectedBranch, decision: { concrete_help: strategies[0].action } },
        output: { follow_target: { content: special ? '激发首次试驾兴趣，促成到店体验' : `回应${topic}问题，承接客户认可的下一步` }, follow_strategy: { content: strategies[0].action, reason: '依据本轮选定策略形成跟进安排' }, final_output: { followTarget: { content: special ? '激发首次试驾兴趣，促成到店体验' : `回应${topic}问题，承接客户认可的下一步` }, followStrategy: { content: strategies[0].action } } },
        items: [assessment('target-0', 'target', '目标是否与客户状态和策略一致', '目标方案结果版本', special ? '不一致' : '一致', ['一致', '不一致', '证据不足'], special ? '目标重置了已完成试驾的进展，不能以首次兴趣替代复试驾安排。' : '目标承接客户状态与选定打法。'), assessment('plan-0', 'plan', '方案是否落实策略打法', '目标方案结果版本', '已落实', ['已落实', '未落实', '证据不足'], '方案具体动作与选定打法一致；选错策略本身由 M4 评价。')],
      },
      M6: {
        input: { customer_state: stage, strategy_id: strategies[0].id, follow_target: `回应${topic}问题`, materials: [materials[0]], facts: evidence },
        output: { follow_playbook: `您好，关于您提到的${topic}，我准备了相关资料。您方便时我们可以结合实际使用场景进一步沟通。`, wecom_suggestion: { message: index === 4 ? `看到您最近在 App 浏览了${topic}，我把相关视频发给您。` : `这是${model}的${topic}场景视频，先供您参考。您看过后，我们再按您的安排继续。`, messageWithoutMaterial: `关于${topic}，我已记下您的问题。待相关信息确认后再联系您。` }, final_output: '本模拟案例的阶段原文与最终保存文案一致' },
        items: ['电话话术', '企微素材版', '企微无素材版'].flatMap((version, versionIndex) => [assessment(`execution-${versionIndex}`, 'execution', '话术是否落实策略打法', `文案版本 · ${version}`, '已落实', ['已落实', '未落实', '证据不足'], '开场、帮助与下一步承接方案。', { version }), assessment(`consistency-${versionIndex}`, 'consistency', '话术是否符合素材情况', `文案版本 · ${version}`, versionIndex === 2 ? '不适用' : '符合', ['符合', '不符合', '证据不足', '不适用'], versionIndex === 2 ? '无素材版文案不依赖附件，独立成立。' : '实际素材支持文案描述的主题。', { version }), assessment(`usable-${versionIndex}`, 'usable', '话术质量是否可直接使用', `文案版本 · ${version}`, '可用', ['可用', '需修改', '证据不足'], '表达清楚且主题集中，不需要实质改写。', { version }), assessment(`compliance-${versionIndex}`, 'compliance', '对客表达是否合规', `文案版本 · ${version}`, '合规', ['合规', '违规', '证据不足'], '初评未识别到对客表达违规。', { version })]),
      },
    };
    if (index === 3) nodes.M2.output.decision.main_issue = '优先重新收集家庭用车诉求，再考虑是否安排旧车评估；暂未承接已接受的评估安排。';
    if (index === 2) nodes.M1.items[0].ai = '错误';
    nodes.M3.output.requests = [{ id: 'Q01', query: nodes.M3.input.semantic_query, result: 'success', materials, fallback: false }];
    nodes.M3.output.materialMode = 'direct';
    nodes.M3.output.execution = '已搜索';
    if (special) {
      const fallbackMaterial = { ...materials[2], position: 1, selected: true };
      nodes.M3.output = { execution: '已搜索', materialMode: 'fallback', reason: '合理 Query 未召回素材，随后按车型检索兜底素材。需结合两次请求判断供给缺口。', requests: [{ id: 'Q01', query: nodes.M3.input.semantic_query, result: 'success', materials: [], fallback: false }, { id: 'Q02', query: `${model} 外观配色实拍`, result: 'success', materials: [fallbackMaterial], fallback: true }], materials: [fallbackMaterial], material_ids: [fallbackMaterial.materialId], final_materials: [fallbackMaterial] };
      nodes.M3.items = [assessment('query-0', 'query', '首次 Query 构造是否合理', '搜索请求 · Q01', '是', ['是', '否', '证据不足'], '车型与主题对应客户诉求，但本次返回为空。', { requestId: 'Q01', result: 'success', returnedCount: 0 }), assessment('query-1', 'query', '兜底 Query 是否承接检索过程', '搜索请求 · Q02', '是', ['是', '否', '证据不足'], '本轮因首次未召回而按车型兜底；是否满足客户问题，需独立检查素材内容。', { requestId: 'Q02', result: 'success', returnedCount: 1 }), assessment('material-fallback', 'materialGrade', '兜底素材相关性等级', `素材 · ${fallbackMaterial.title}`, 'Grade 2', grades, '车型匹配，但外观实拍不回应客户当前主题，不因兜底而提高相关性等级。', { requestId: 'Q02', position: 1 })];
      nodes.M6.input.materials = [fallbackMaterial];
      nodes.M6.output.wecom_suggestion.message = `关于您提到的${topic}，我记下了需要确认的问题。这是${model}外观配色实拍，供您参考。`;
    }
    if (index === 7 || index === 12) {
      const reason = index === 7 ? '缺少正确专家 ID，未执行素材搜索' : '客户明确无需素材，只确认复试驾时间';
      nodes.M3.input = { material_need: index === 7 ? nodes.M3.input.material_need : '客户已明确不需要更多素材，只确认时间' };
      nodes.M3.output = { execution: '未执行', materialMode: 'none', reason, requests: [], final_materials: [] };
      nodes.M3.items = [];
    }
    if (index === 12) {
      nodes.M3.input = { material_need: '客户已明确不需要更多素材，只确认时间' };
      nodes.M3.output = { execution: '未执行', materialMode: 'none', reason: '本轮无需素材，按需跳过检索', requests: [], final_materials: [] };
      nodes.M3.items = [];
    }
    const selectedStrategies = strategies.filter(strategy => strategy.selected);
    nodes.M5.input.strategy_ids = selectedStrategies.map(strategy => strategy.id);
    nodes.M6.input.strategy_ids = selectedStrategies.map(strategy => strategy.id);
    nodes.M5.input.decision.concrete_help = selectedStrategies.map(strategy => strategy.action).join('；');
    nodes.M5.output.follow_strategy.content = nodes.M5.input.decision.concrete_help;
    nodes.M5.output.final_output.followStrategy.content = nodes.M5.input.decision.concrete_help;
    if (!nodes.M3.output.final_materials.length) {
      nodes.M6.input.materials = [];
      nodes.M6.output.wecom_suggestion.message = nodes.M6.output.wecom_suggestion.messageWithoutMaterial;
      nodes.M6.items.filter(item => item.key === 'consistency').forEach(item => { item.ai = '不适用'; item.reason = '本轮未选用素材，文案不依赖附件。'; });
    }
    return { id: caseId, packId, name, model, purpose, stage, topic, request, evidence, nodes, sampling: samplingTypes[index % 2], information: index === 6 ? '资料不完整' : '资料完整', analysisTime: `${index < 8 ? '2026-11-11' : '2026-11-10'} 09:${String(12 + order).padStart(2, '0')}`, trigger: '新增客户沟通', evalStatus: index === 5 ? 'failed' : 'completed', assignedTo: index === 0 ? '评测 · 周宁' : '' };
  }

  const cases = profiles.map(makeCase);

  function initialState() {
    const state = { schema: 2, demoSamples: 1, pack: packs[0].id, caseId: cases[0].id, node: 'M4', reviews: {}, submissions: {}, history: [], recovered: [] };
    const agree = item => ({ accuracy: 'agree', human: item.ai, judgeIssue: '', agentIssue: root.AnnotationEngine.isBad({ key: item.key, human: item.ai }) ? ({ branch: '打法分支错误', target: '目标偏离', status: '状态判断错误' }[item.key] || '') : '', reason: item.key === 'grade' && item.ai === '2 分' ? item.reason : '', evidence: item.evidence });
    [2, 3, 4, 6, 8, 9].forEach((caseIndex, submittedIndex) => {
      const customer = cases[caseIndex];
      state.reviews[customer.id] = {};
      modules.forEach(node => {
        state.reviews[customer.id][node.id] = Object.fromEntries(customer.nodes[node.id].items.map(item => [item.id, agree(item)]));
      });
      state.submissions[customer.id] = { reviewer: reviewers[submittedIndex % 3], reviewedAt: `${customer.packId === 'pack-320' ? '2026-11-11' : '2026-11-10'} 10:${String(10 + submittedIndex * 5).padStart(2, '0')}` };
    });
    state.reviews[cases[2].id].M1['status-0'] = { accuracy: 'disagree', human: '正确', judgeIssue: '误判为错误', agentIssue: '', reason: '原始工单明确显示试驾已完成，Agent 状态结论正确，AI 原判为误报。', evidence: 'E01' };
    state.reviews[cases[3].id].M2['priority-0'] = { accuracy: 'disagree', human: '不合理', judgeIssue: '误判为正确', agentIssue: '优先级不合理', reason: '应优先落实已接受的置换评估，而不是重复收集已经明确的用车诉求。', evidence: 'E03' };
    state.reviews[cases[4].id].M6['compliance-1'] = { accuracy: 'disagree', human: '违规', judgeIssue: '误判为正确', agentIssue: '线上行为披露', reason: '素材版话术直接透露后台观察到的 App 浏览行为，不是客户主动自述。', evidence: 'E04' };
    state.reviews[cases[6].id].M1['status-0'] = { accuracy: 'unknown', human: '证据不足', judgeIssue: '', agentIssue: '', reason: '本模拟案例缺少能够核对当前阶段的原始试驾工单，不能确认 AI 判断。', evidence: '缺失：E01 原始工单' };
    [0, 1].forEach(materialIndex => {
      state.reviews[cases[8].id].M3[`material-${materialIndex}`] = { accuracy: 'disagree', human: `Grade ${materialIndex + 2}`, judgeIssue: '等级偏高', agentIssue: '搜索问题', reason: '模拟素材的实际展示内容未覆盖本轮主要场景，初评相关性等级偏高。', evidence: 'E02' };
    });
    state.reviews[cases[9].id].M4['strategy-grade'] = { accuracy: 'disagree', human: '1 分', judgeIssue: '等级偏高', agentIssue: '打法分支错误', reason: '策略主题虽然相关，实际采用分支却重置了客户已经接受的复试驾进展。', evidence: 'E02' };
    state.reviews[cases[0].id] = {};
    ['M1', 'M2', 'M3', 'M4'].forEach(node => { state.reviews[cases[0].id][node] = Object.fromEntries(cases[0].nodes[node].items.map(item => [item.id, agree(item)])); });
    state.reviews[cases[0].id].M4['strategy-grade'] = { accuracy: 'disagree', human: '1 分', judgeIssue: '等级偏高', agentIssue: '打法分支错误', reason: '客户已完成试驾，并明确愿意带家人复试驾。AI 只检查了策略主题，忽略了“首次体验”分支与已有进展的冲突。', evidence: 'E02', alternativeIds: ['DEMO-STR-207'] };
    Object.entries(state.submissions).forEach(([caseId, submission]) => { submission.reviewedModules = modules.map(module => module.id); submission.snapshot = structuredClone(state.reviews[caseId]); });
    return state;
  }

  root.AnnotationDemo = { modules, packs, cases, judgeIssues, agentIssues, issuesByModule, reviewers, samplingTypes, materialModes, initialState };
})(globalThis);
