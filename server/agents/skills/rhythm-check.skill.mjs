import { parseMinutes, truncate } from "../utils.mjs";

const COMFORTABLE_MINUTES = 150;
/** 压缩时保留的最短任务时长，避免把任务压到无意义的长度。 */
const FLOOR_MINUTES = 15;

/** 从共享上下文中读取 Atlas 沉淀的时长估算。 */
function atlasEstimateFromMemory(context) {
  const facts = context?.memory?.facts;
  if (!Array.isArray(facts)) return 0;
  const fact = [...facts].reverse().find((item) => item.key === "agent.atlas.metrics");
  return Number(fact?.value?.estimatedMinutes || 0);
}

/**
 * 技能：节律与负载检查（rhythm-check）
 * 纯函数，可被任意声明了该技能的 Agent 复用。
 */
export const rhythmCheckSkill = {
  id: "rhythm-check",
  label: "节律检查",
  description: "检查作息、运动与负载是否越过生活边界",
  rules(input, context) {
    const goal = String(input?.goal || "今日节奏");
    const habits = Array.isArray(context?.state?.habits) ? context.state.habits : [];
    const tasks = Array.isArray(context?.state?.tasks) ? context.state.tasks : [];
    const unfinished = tasks.filter((task) => task.status !== "done");
    const unfinishedMinutes = unfinished.reduce((sum, task) => sum + parseMinutes(task.duration), 0);
    const fromAtlas = Number(input?.handoff?.payload?.estimatedMinutes || 0) || atlasEstimateFromMemory(context);
    const loadMinutes = unfinishedMinutes + fromAtlas;

    const sleepHabit = habits.find((habit) => /睡/u.test(habit.name));
    const moveHabit = habits.find((habit) => /运动|散步|健身|活动/u.test(habit.name));
    // null 表示没有对应习惯记录，不能默认判为「已完成」。
    const sleepReady = sleepHabit ? Boolean(sleepHabit.completed) : null;
    const moveReady = moveHabit ? Boolean(moveHabit.completed) : null;
    const overload = loadMinutes > COMFORTABLE_MINUTES;
    const excess = Math.max(0, loadMinutes - COMFORTABLE_MINUTES);

    // 先算出真实的减负方案，步骤文案与实际改动保持一致，并如实标注残差。
    const longestTask = unfinished.slice().sort((a, b) => parseMinutes(b.duration) - parseMinutes(a.duration))[0];
    let trim = null;
    if (overload && longestTask) {
      const minutes = parseMinutes(longestTask.duration);
      const reduction = Math.min(excess, Math.max(0, minutes - FLOOR_MINUTES));
      if (reduction > 0) {
        trim = { task: longestTask, reduction, trimmed: minutes - reduction, residual: excess - reduction };
      }
    }
    const residualText = (residual) => (residual > 0 ? `调整后仍超出上限 ${residual} 分钟，建议把剩余内容顺延到第 2 天。` : "");

    const steps = [
      {
        title: "锁定 23:30 前入睡的硬边界",
        detail: "晚间学习安排在 22:30 前收尾，睡眠优先级高于额外练习量。"
      },
      {
        title: trim ? `给今天减负 ${trim.reduction} 分钟` : overload ? "把一项任务顺延到第 2 天" : "保持当前节奏",
        detail: trim
          ? `把「${trim.task.title}」从 ${trim.task.duration} 调整为 ${trim.trimmed} 分钟，调整后当日约 ${loadMinutes - trim.reduction} 分钟。${residualText(trim.residual)}`
          : overload
            ? `当日待办合计约 ${loadMinutes} 分钟，超过单日舒适上限 ${COMFORTABLE_MINUTES} 分钟，且各任务已接近最短时长。`
            : `今日待办合计约 ${loadMinutes} 分钟，处于可持续区间。`
      },
      {
        title: "高强度学习后插入 10 分钟活动",
        detail: moveReady === false ? "把久坐切成两段，中间安排一次散步。" : "用短时走动恢复精力，避免连续久坐。"
      }
    ];

    const proposals = [];
    const walkTaskTitle = "晚饭后散步 30 分钟";
    if (moveHabit && moveReady === false && !unfinished.some((task) => task.title === walkTaskTitle)) {
      // 已有同名未完成任务时不再重复新增，避免「新增 → 下轮归档」的循环。
      proposals.push({
        type: "create_task",
        risk: "low",
        title: "保留晚饭后散步",
        detail: "运动属于低风险新增，可直接写入任务流。",
        payload: { title: walkTaskTitle, category: "生活", duration: "30 分钟", assignee: "mira" }
      });
    }
    if (trim) {
      proposals.push({
        type: "reschedule_block",
        risk: "high",
        title: `压缩「${trim.task.title}」`,
        detail: `负载 ${loadMinutes} 分钟超出上限 ${excess} 分钟，建议把该任务从 ${trim.task.duration} 调整为 ${trim.trimmed} 分钟。${residualText(trim.residual)}`,
        payload: {
          action: "trim_block",
          targetTaskId: trim.task.id,
          changes: { duration: `${trim.trimmed} 分钟` },
          block: "晚间学习",
          reason: `待办负载 ${loadMinutes} 分钟`,
          resultingLoadMinutes: loadMinutes - trim.reduction,
          residualMinutes: trim.residual
        }
      });
    } else if (overload) {
      // 无可压缩余量：定位不到可调整目标，交由工具层生成调整建议并如实标注。
      proposals.push({
        type: "reschedule_block",
        risk: "high",
        title: "把一项任务顺延到第 2 天",
        detail: `负载 ${loadMinutes} 分钟超出上限 ${excess} 分钟，且各任务已接近最短时长，建议把「${longestTask?.title || "最低优先级任务"}」整体顺延。`,
        payload: { action: "postpone", block: "晚间学习", reason: `待办负载 ${loadMinutes} 分钟` }
      });
    }

    // 去重：同名未完成任务中，较新的且由 Agent 创建的那条建议归档（软删除，可恢复）。
    const byTitle = new Map();
    for (const task of unfinished) {
      const list = byTitle.get(task.title) || [];
      list.push(task);
      byTitle.set(task.title, list);
    }
    const duplicate = [...byTitle.values()]
      .filter((list) => list.length > 1)
      .map((list) =>
        list
          .slice()
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .slice(1)
          .find((task) => task.source === "agent")
      )
      .filter(Boolean)[0];
    if (duplicate) {
      proposals.push({
        type: "delete_task",
        risk: "high",
        title: `归档重复任务「${truncate(duplicate.title, 20)}」`,
        detail: "任务流中存在同名未完成任务，建议归档较新的一条，保持清单清晰；归档后可随时恢复。",
        payload: { targetTaskId: duplicate.id, reason: "同名重复" }
      });
    }

    const handoffs = overload && input?.allowHandoff !== false
      ? [
          {
            to: "nova",
            reason: "当日负载偏高，请协助校准本周目标优先级",
            payload: { loadMinutes }
          }
        ]
      : [];

    // 约束：Mira 是作息边界的声明者，后续 Agent 与合并阶段都要遵守。
    const constraints = [
      { id: "sleep-boundary", label: "23:30 前入睡", detail: "睡眠优先级高于额外练习量，晚间学习需在 22:30 前收尾。" }
    ];
    if (overload) {
      constraints.push({
        id: "daily-load",
        label: `单日负载不超过 ${COMFORTABLE_MINUTES} 分钟`,
        detail: `当前负载 ${loadMinutes} 分钟，超出 ${excess} 分钟。`
      });
    }

    const habitText = (ready) => (ready === null ? "未记录" : ready ? "已完成" : "未完成");
    const overloadSummary = overload
      ? trim
        ? `今日负载约 ${loadMinutes} 分钟偏高${sleepReady === false ? "，且早睡尚未完成" : ""}，已提出减负 ${trim.reduction} 分钟${trim.residual > 0 ? `，调整后仍有 ${trim.residual} 分钟超出上限` : "，调整后回到上限内"}。`
        : `今日负载约 ${loadMinutes} 分钟偏高${sleepReady === false ? "，且早睡尚未完成" : ""}，各任务已接近最短时长，建议顺延一项。`
      : `今日负载约 ${loadMinutes} 分钟，作息与运动节奏可维持。`;

    return {
      status: "completed",
      summary: overloadSummary,
      steps,
      proposals,
      handoffs,
      constraints,
      notes: [
        `早睡习惯：${habitText(sleepReady)}；运动习惯：${habitText(moveReady)}。`,
        sleepReady === null ? "未找到入睡相关的习惯记录，未对睡眠状态下结论。" : null,
        truncate(`目标背景：${goal}`, 120)
      ].filter(Boolean),
      sources: ["Mira 节律检查规则", "工作台习惯数据"],
      metrics: { loadMinutes, unfinishedMinutes, fromAtlas, excess, overload, sleepReady, moveReady, plannedReductionMinutes: trim ? trim.reduction : 0, residualMinutes: trim ? trim.residual : excess }
    };
  }
};
