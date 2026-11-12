(function (root) {
  const insufficientValues = new Set(['证据不足', '无法核验', '审查不足']);
  const badValues = new Set(['错误', '不合理', '不一致', '未落实', '不符合', '需修改', '违规', '遗漏', '已解决或失效', '与证据冲突', '无依据断言', '当前不适用且有替代', '否']);

  function isBad(row) {
    if (insufficientValues.has(row.human) || row.human === '不适用') return false;
    return (row.key === 'grade' && row.human === '1 分') || badValues.has(row.human) || Boolean(row.agentIssue);
  }

  function summarize(rows) {
    const submitted = rows.filter(row => row.submitted);
    const judged = submitted.filter(row => row.accuracy === 'agree' || row.accuracy === 'disagree');
    const agreed = judged.filter(row => row.accuracy === 'agree').length;
    return {
      cases: new Set(submitted.map(row => row.caseId)).size,
      badcases: new Set(submitted.filter(row => row.caseBad || isBad(row)).map(row => row.caseId)).size,
      rows: submitted.length,
      agreed,
      judged: judged.length,
      agreement: judged.length ? agreed / judged.length * 100 : null,
      insufficient: submitted.filter(row => insufficientValues.has(row.human)).length,
      corrections: submitted.filter(row => row.accuracy === 'disagree').length,
    };
  }

  function filterRows(rows, filters = {}) {
    return rows.filter(row => {
      if (!row.submitted) return false;
      if (['sampling', 'stage', 'information', 'materialMode', 'rootModule', 'rootIssue', 'datasetVersion'].some(key => filters[key] && filters[key] !== 'all' && row[key] !== filters[key])) return false;
      if (filters.pack && filters.pack !== 'all' && row.packId !== filters.pack) return false;
      if (filters.module && filters.module !== 'all' && row.module !== filters.module) return false;
      if (filters.accuracy && filters.accuracy !== 'all' && row.accuracy !== filters.accuracy) return false;
      if (filters.issue && filters.issue !== 'all' && row.agentIssue !== filters.issue) return false;
      if (filters.judgeIssue && filters.judgeIssue !== 'all' && row.judgeIssue !== filters.judgeIssue) return false;
      if (filters.reviewer && filters.reviewer !== 'all' && row.reviewer !== filters.reviewer) return false;
      if (filters.mode === 'bad' && !isBad(row)) return false;
      if (filters.mode === 'correction' && row.accuracy !== 'disagree') return false;
      if (filters.mode === 'improvement' && !(row.key === 'grade' && row.human === '2 分') && row.human !== '存在明确更优') return false;
      if (filters.from && (!row.reviewedAt || row.reviewedAt.slice(0, 10) < filters.from)) return false;
      if (filters.to && (!row.reviewedAt || row.reviewedAt.slice(0, 10) > filters.to)) return false;
      if (filters.search && ![row.caseId, row.name, row.title, row.reason].join(' ').toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }

  function ratio(values, positive, eligible) {
    const applicable = values.filter(value => eligible.includes(value));
    const numerator = applicable.filter(value => positive.includes(value)).length;
    return { value: applicable.length ? numerator / applicable.length * 100 : null, numerator, denominator: applicable.length };
  }

  function grouped(rows, key) {
    const groups = new Map();
    rows.forEach(row => {
      const groupKey = typeof key === 'function' ? key(row) : row[key];
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(row);
    });
    return [...groups.values()];
  }

  function statusMetric(rows, field) {
    const values = grouped(rows.filter(row => row.key === 'status'), 'caseId').map(group => {
      if (group.length < (group[0].expectedCount || 1)) return '证据不足';
      if (group.some(row => row[field] === '错误')) return '错误';
      return group.every(row => row[field] === '正确') ? '正确' : '证据不足';
    });
    return ratio(values, ['正确'], ['正确', '错误']);
  }

  function averageCoverage(rows, field, key) {
    const samples = grouped(rows.filter(row => row.key === key), 'caseId').filter(group => group.length >= (group[0].expectedCount || 1));
    const valid = samples.map(group => ratio(group.map(row => row[field]), ['已覆盖'], ['已覆盖', '遗漏'])).filter(result => result.denominator);
    return { value: valid.length ? valid.reduce((total, sample) => total + sample.value, 0) / valid.length : null, numerator: valid.reduce((total, sample) => total + sample.numerator, 0), denominator: valid.reduce((total, sample) => total + sample.denominator, 0), samples: valid.length };
  }

  function materialMetrics(requests) {
    const valid = requests.filter(request => request.result === 'success' && request.grades.slice(0, 3).every(grade => typeof grade === 'number' && grade >= 1 && grade <= 5));
    const relevant = valid.reduce((total, request) => total + request.grades.slice(0, 3).filter(grade => grade >= 4).length, 0);
    const firstHits = valid.filter(request => request.grades[0] >= 4).length;
    const audited = valid.filter(request => Array.isArray(request.referenceGrades) && request.referenceGrades.length);
    const ndcgValues = audited.map(request => {
      const gain = grade => 2 ** (grade - 1) - 1;
      const dcg = grades => grades.slice(0, 3).reduce((total, grade, index) => total + gain(grade) / Math.log2(index + 2), 0);
      const ideal = dcg([...request.referenceGrades].sort((first, second) => second - first));
      return ideal ? dcg(request.grades) / ideal * 100 : null;
    }).filter(value => value !== null);
    return {
      precision: { value: valid.length ? relevant / (valid.length * 3) * 100 : null, numerator: relevant, denominator: valid.length * 3, samples: valid.length },
      hit: { value: valid.length ? firstHits / valid.length * 100 : null, numerator: firstHits, denominator: valid.length },
      ndcg: { value: ndcgValues.length ? ndcgValues.reduce((total, value) => total + value, 0) / ndcgValues.length : null, numerator: null, denominator: ndcgValues.length },
    };
  }

  function validateReview(item, review) {
    const errors = [];
    if (!review.accuracy) return ['尚未确认评估是否准确'];
    if (!item.options.includes(review.human)) errors.push('请选择有效的人工结论');
    if (review.accuracy === 'agree' && review.human !== item.ai) errors.push('确认一致时需保留 AI 原判');
    if (review.accuracy === 'disagree') {
      if (review.human === item.ai) errors.push('人工改判不能与 AI 原判相同');
      if (!review.reason?.trim()) errors.push('请填写改判理由');
    }
    if (review.accuracy === 'unknown') {
      if (!insufficientValues.has(review.human)) errors.push('资料不足需选择对应的未明确结论');
      if (!review.reason?.trim()) errors.push('请说明缺失资料');
    }
    if (item.key === 'grade' && ['1 分', '2 分'].includes(review.human)) {
      if (!review.reason?.trim() && review.accuracy !== 'disagree') errors.push('请说明策略组合评分理由');
    }
    return errors;
  }

  function issueDistribution(rows) {
    const problems = rows.filter(row => row.submitted && isBad(row));
    const total = new Set(problems.map(row => row.caseId)).size;
    const distribution = (key, label) => grouped(problems, key).map(group => {
      const count = new Set(group.map(row => row.caseId)).size;
      return { name: label(group[0]), count, value: count / total * 100 };
    }).sort((first, second) => second.count - first.count);
    return { total, issues: distribution(row => `${row.module}:${row.title || row.itemId || row.key}`, row => row.title || row.itemId || row.key), modules: distribution('module', row => row.module) };
  }

  function strategyDiversity(rows) {
    const cases = grouped(rows.filter(row => row.submitted && row.module === 'M4' && row.selectedStrategies?.length), 'caseId');
    const adopted = cases.flatMap(group => [...new Map(group[0].selectedStrategies.map(strategy => [strategy.id, strategy])).values()]);
    const strategies = grouped(adopted, 'id').map(group => ({ id: group[0].id, name: group[0].title || group[0].id, count: group.length, value: group.length / cases.length * 100 })).sort((first, second) => second.count - first.count);
    return { distinct: strategies.length, cases: cases.length, strategies };
  }

  function materialSegments(rows) {
    return ['direct', 'fallback', 'none'].map(mode => {
      const selected = rows.filter(row => row.submitted && row.module === 'M3' && row.materialMode === mode);
      const materials = selected.filter(row => row.key === 'materialGrade');
      const relevance = ratio(materials.map(row => row.human), ['Grade 4', 'Grade 5'], ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5']);
      return { mode, cases: new Set(selected.map(row => row.caseId)).size, relevance, usage: null };
    });
  }

  function exportBundle(rows, cases, packs, submissions) {
    const selectedIds = new Set(rows.filter(row => row.submitted).map(row => row.caseId));
    const selected = cases.filter(record => selectedIds.has(record.id) && submissions[record.id]);
    const packIds = new Set(selected.map(record => record.packId));
    return structuredClone({
      schema: 2,
      notice: '交互原型 · 模拟数据。数据集与模型版本分别保存；全部节点输入输出随 Case 导出，人工结果只使用已提交快照。',
      packs: packs.filter(pack => packIds.has(pack.id)),
      cases: selected.map(record => ({ ...(submissions[record.id].dataSnapshot || record), review: submissions[record.id] })),
      badcaseIds: [...new Set(rows.filter(row => row.submitted && (row.caseBad || isBad(row))).map(row => row.caseId))],
      report: { summary: summarize(rows), issues: issueDistribution(rows), strategyDiversity: strategyDiversity(rows), materialSegments: materialSegments(rows), metrics: Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map(module => [module, moduleMetrics(rows, module)])) },
    });
  }

  function regressionReport(cases, packs, submissions, packId, version) {
    const pack = packs.find(record => record.id === packId);
    const records = cases.filter(record => record.packId === packId);
    const rows = records.map(record => {
      const result = { caseId: record.id, name: record.name, stage: record.stage, status: '', agreed: 0, judged: 0, insufficient: 0, differences: [], comparisons: [] };
      if (!pack || pack.version !== version) return { ...result, status: '缺少版本输出' };
      if (record.evalStatus !== 'completed') return { ...result, status: '初评失败' };
      const submission = submissions[record.id];
      if (!submission) return { ...result, status: '未提交人工标注' };
      const snapshot = submission.snapshot || {};
      Object.entries(record.nodes).filter(([module]) => submission.reviewedModules?.includes(module)).forEach(([module, node]) => {
        node.items.forEach(item => {
          const review = snapshot[module]?.[item.id];
          if (!review?.accuracy) return;
          const comparison = { module, itemId: item.id, title: item.title, unit: item.unit, key: item.key, expectedCount: item.expectedCount, requestId: item.requestId, result: item.result, returnedCount: item.returnedCount, position: item.position, pointId: item.pointId, ai: item.ai, human: review.human, reason: review.reason, submitted: true, caseId: record.id };
          const comparable = ['agree', 'disagree'].includes(review.accuracy) && !insufficientValues.has(review.human) && !insufficientValues.has(item.ai);
          if (!comparable) result.insufficient += 1;
          else {
            result.judged += 1;
            if (item.ai === review.human) result.agreed += 1;
            else result.differences.push(comparison);
          }
          result.comparisons.push({ ...comparison, accuracy: comparable ? item.ai === review.human ? 'agree' : 'disagree' : 'unknown' });
        });
      });
      result.status = !result.judged ? '资料不足' : result.differences.length ? '存在差异' : result.insufficient ? '部分资料不足' : '与人工一致';
      return result;
    });
    const judged = rows.reduce((total, row) => total + row.judged, 0);
    const agreed = rows.reduce((total, row) => total + row.agreed, 0);
    return { packId, datasetVersion: pack?.datasetVersion, version, total: records.length, compared: rows.filter(row => row.judged).length, missing: rows.filter(row => row.status === '缺少版本输出').length, failed: rows.filter(row => row.status === '初评失败').length, differences: rows.filter(row => row.differences.length).length, insufficient: rows.reduce((total, row) => total + row.insufficient, 0), judged, agreed, agreement: judged ? agreed / judged * 100 : null, rows };
  }

  function moduleMetrics(rows, module) {
    const selected = rows.filter(row => row.module === module && row.submitted);
    const regular = (title, key, positive, eligible, note) => ({ title, note, key, human: ratio(selected.filter(row => row.key === key).map(row => row.human), positive, eligible), ai: ratio(selected.filter(row => row.key === key).map(row => row.ai), positive, eligible) });
    if (module === 'M1') return [
      { title: '客户状态输出正确率', key: 'status', human: statusMetric(selected, 'human'), ai: statusMetric(selected, 'ai'), note: '按 Case：关键状态项全部正确才记正确；证据不足单列。' },
      regular('行动状态承接正确率', 'action', ['正确'], ['正确', '错误'], '按行动事项统计，证据不足和不适用不进入分母。'),
      regular('事实遵守率', 'fact', ['有依据'], ['有依据', '与证据冲突', '无依据断言'], '按事实陈述统计，无法核验单列；不将未知默认为事实。'),
    ];
    if (module === 'M2') return [
      regular('卡点判断正确率', 'point', ['正确'], ['正确', '错误'], '按已识别卡点统计，不衡量遗漏。'),
      { title: '卡点当前有效率', key: 'validity', ...Object.fromEntries(['human', 'ai'].map(field => [field, ratio(selected.filter(row => row.key === 'validity' && selected.some(point => point.key === 'point' && point.caseId === row.caseId && point.pointId === row.pointId && point[field] === '正确')).map(row => row[field]), ['有效'], ['有效', '已解决或失效'])])), note: '仅统计真实性已经确认的卡点，失效卡点计入分母。' },
      { title: '关键问题覆盖率', key: 'coverage', human: averageCoverage(selected, 'human', 'coverage'), ai: averageCoverage(selected, 'ai', 'coverage'), note: '每个 Case 的已覆盖参考问题数 / 应覆盖问题数，再取有效 Case 平均。' },
      regular('主问题与优先级合理率', 'priority', ['合理'], ['合理', '不合理'], '按适用且可明确判定的 Case 统计。'),
    ];
    if (module === 'M3') {
      const values = Object.fromEntries(['human', 'ai'].map(field => [field, materialMetrics(selected.filter(row => row.key === 'query').map(query => {
        const materials = selected.filter(row => row.key === 'materialGrade' && row.caseId === query.caseId && row.requestId === query.requestId);
        const grades = Array.from({ length: Math.min(3, query.returnedCount ?? materials.length) }, (_, position) => {
          const value = materials.find(row => row.position === position + 1)?.[field];
          return value?.startsWith('Grade ') ? Number(value.slice(-1)) : value;
        });
        return { requestId: query.requestId, result: query.result, grades };
      }))]));
      return [
        { title: '素材搜索 Precision@3', key: 'materialGrade', human: values.human.precision, ai: values.ai.precision, note: '每次成功请求前三位 Grade ≥ 4 的数量 / 3，再取平均；不足三条补零。' },
        regular('素材 Query 构造合理率', 'query', ['是'], ['是', '否'], '按搜索请求统计，证据不足单列。'),
        { title: '素材搜索 MRR@1 / Hit@1', key: 'materialGrade', human: values.human.hit, ai: values.ai.hit, note: '每次首条 Grade ≥ 4 记 1，否则记 0，再取平均。' },
        { title: '素材搜索 NDCG@3', key: 'materialGrade', human: values.human.ndcg, ai: values.ai.ndcg, note: '需同一 Query 的独立已审定候选集合。本模拟数据未提供，不生成数值。' },
      ];
    }
    if (module === 'M4') return [
      { title: '客户策略组合三档分布', key: 'grade', distribution: true, ...Object.fromEntries(['human', 'ai'].map(field => [field, { value: null, numerator: null, denominator: selected.filter(row => row.key === 'grade' && ['1 分', '2 分', '3 分'].includes(row[field])).length, grades: [1, 2, 3].map(grade => selected.filter(row => row.key === 'grade' && row[field] === `${grade} 分`).length) }])), note: '一个客户的实际策略组合计一次：1 分需优化，2 分适配但有更优，3 分适配且最优；2 分单列优选提升，badcase 入集口径待确认。' },
      regular('策略查询合理率', 'strategyQuery', ['合理'], ['合理', '不合理'], '按查询统计，证据不足单列。'),
      { title: '适用策略候选召回率', key: 'strategyCoverage', human: averageCoverage(selected, 'human', 'strategyCoverage'), ai: averageCoverage(selected, 'ai', 'strategyCoverage'), note: '先按 Case 计算参考策略覆盖比例，再取平均；审查集合不完整不统计。' },
      regular('打法分支与动作正确率', 'branch', ['正确'], ['正确', '错误'], '按实际采用的分支统计，不以同策略 ID 代替分支正确性。'),
      regular('库内更优或适用替代遗漏率', 'alternative', ['存在明确更优', '当前不适用且有替代'], ['当前合理优选', '存在相当方案', '存在明确更优', '当前不适用且有替代', '已确认无适用方法'], '问题指标，越低越好；审查不足单列。'),
    ];
    if (module === 'M5') return [
      regular('目标准确一致率', 'target', ['一致'], ['一致', '不一致'], '按目标方案结果版本统计，不平均掩盖核心目标冲突。'),
      regular('方案打法落实率', 'plan', ['已落实'], ['已落实', '未落实'], '按目标方案结果版本统计，证据不足与未评单列。'),
    ];
    return [
      regular('策略打法落实率', 'execution', ['已落实'], ['已落实', '未落实'], '电话、企微素材版和无素材版均按各自文案版本统计。'),
      regular('素材一致率', 'consistency', ['符合'], ['符合', '不符合'], '按适用文案版本统计；无素材且不依赖附件的版本不适用。'),
      regular('话术可用率', 'usable', ['可用'], ['可用', '需修改'], '表达质量独立于策略、素材与合规，不互相抵消。'),
      regular('对客合规通过率', 'compliance', ['合规'], ['合规', '违规'], '任一确认违规即该文案版本违规；必需证据不足不计入分母。'),
    ];
  }

  root.AnnotationEngine = { isBad, summarize, filterRows, ratio, statusMetric, materialMetrics, validateReview, moduleMetrics, issueDistribution, strategyDiversity, materialSegments, exportBundle, regressionReport, insufficientValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AnnotationEngine;
})(globalThis);
