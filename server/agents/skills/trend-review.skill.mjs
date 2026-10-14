import { truncate } from "../utils.mjs";

/** 少于该样本量时不据完成度给出校准建议。 */
const MIN_SAMPLE = 3;

/** 从共享上下文中读取 Mira 沉淀的负载判断。 */
function miraLoadFromMemory(context) {
  const facts = context?.memory?.facts;
  if (!Array.isArray(facts)) return 0;
  const fact = [...facts].reverse().find((item) => item.key === "agent.mira.metrics");
  return Number(fact?.value?.loadMinutes || 0);
}

/**
 * 技能：趋势与目标校准（trend-review）
 * 纯函数，可被任意声明了该技能的 Agent 复用。
 */
export const trendReviewSkill = {
  id: "trend-review",
  label: "趋势复盘",
  description: "从任务与复盘数据中提炼趋势并校准目标优先级",
  rules(input, context) {
    const goal = String(input?.goal || "当前成长目标");
    const tasks = Array.isArray(context?.state?.tasks) ? context.state.tasks : [];
    const reviews = Array.isArray(context?.state?.reviews) ? context.state.reviews : [];
    const done = tasks.filter((task) => task.status === "done").length;
    const sampleSize = tasks.length;
    // 样本不足时不得据完成度下结论（避免零样本/小样本产出高影响建议）。
    const enoughData = sampleSize >= MIN_SAMPLE;
    const completionRate = sampleSize ? Math.round((done / sampleSize) * 100) : null;
    const validMoods = reviews
      .map((review) => Number(review.mood))
      .filter((mood) => Number.isInteger(mood) && mood >= 1 && mood <= 5);
    const moodAverage = validMoods.length
      ? Math.round((validMoods.reduce((sum, mood) => sum + mood, 0) / validMoods.length) * 10) / 10
      : null;
    const loadMinutes = Number(input?.handoff?.payload?.loadMinutes || 0) || miraLoadFromMemory(context);

    const steps = [
      {
        title: "写下目标背后的真实意图",
        detail: `用一句话说明「${truncate(goal, 18)}」真正想改善的是什么，避免只追逐数字。`
      },
      {
        title: "只保留一个今天能验证的小行动",
        detail: completionRate === null || completionRate >= 60 ? "把当前进度延续下去，不额外加码。" : "先完成一个最小行动，重建推进感，而不是补齐所有计划。"
      },
      {
        title: "周日用 10 分钟对照趋势",
        detail: moodAverage === null ? "记录本周状态评分，为下一次校准留下依据。" : `当前复盘平均状态 ${moodAverage} 分，把它和完成率放在一起看。`
      }
    ];

    const proposals = [];
    const overloaded = loadMinutes > 150;
    const lowCompletion = completionRate !== null && completionRate < 60;
    const needsRecalibration = overloaded || (lowCompletion && enoughData);
    if (needsRecalibration) {
      proposals.push({
        type: "goal_recalibration",
        risk: "high",
        title: "收窄当前首要目标",
        detail: lowCompletion && enoughData
          ? `当前任务完成度约 ${completionRate}%（样本 ${sampleSize} 个），倾向于计划过载，建议只保留一个首要目标。`
          : `当日负载 ${loadMinutes} 分钟偏高，建议把非关键目标延后。`,
        payload: {
          completionRate,
          sampleSize,
          loadMinutes,
          suggestedFocus: "保留一个最重要目标，其余延后",
          reason: "目标校准会影响整体计划结构"
        }
      });
    }

    const completionText = completionRate === null
      ? "暂无可统计的任务，未做完成度判断"
      : `任务完成度约 ${completionRate}%${enoughData ? "" : `（样本仅 ${sampleSize} 个，不足以判断趋势）`}`;
    const moodText = moodAverage === null
      ? (reviews.length ? "复盘状态评分均为无效值，未计入平均" : "暂无复盘记录")
      : `复盘平均状态 ${moodAverage} 分（基于 ${validMoods.length} 条有效记录）`;

    return {
      status: "completed",
      summary: `${completionText}，${moodText}。统计为累计快照，不按自然周截取。`,
      steps,
      proposals,
      handoffs: [],
      notes: [
        `统计口径：${sampleSize} 个任务中完成 ${done} 个；复盘记录 ${reviews.length} 条，其中有效状态评分 ${validMoods.length} 条。`,
        "统计为累计快照，不按自然周截取；趋势结论为倾向性判断，不等同于确定预测。",
        enoughData ? null : `样本量不足 ${MIN_SAMPLE} 个，已抑制基于完成度的校准建议。`
      ].filter(Boolean),
      sources: ["Nova 趋势规则", "工作台任务与复盘数据"],
      metrics: { completionRate, sampleSize, enoughData, moodAverage, reviewCount: reviews.length, validMoodCount: validMoods.length, loadMinutes, needsRecalibration }
    };
  }
};
