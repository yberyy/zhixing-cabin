import { parseMinutes, topicFromGoal } from "../utils.mjs";

const TOPIC_PACKS = [
  {
    test: /数学|高数|高等数学|线代|线性代数|概率|微积分|几何|统计/u,
    subtopics: ["核心定义与定理", "典型例题精练", "错题与边界条件"],
    practice: "限时刷题轮次"
  },
  {
    test: /英语|单词|词汇|阅读|听力|口语|作文|语法/u,
    subtopics: ["高频词汇", "长难句拆解", "限时阅读训练"],
    practice: "精读 + 复述轮次"
  },
  {
    test: /编程|代码|算法|数据结构|前端|后端|项目|数据库/u,
    subtopics: ["概念与 API", "手写最小实现", "调试与边界用例"],
    practice: "实现 + 测试轮次"
  },
  {
    test: /论文|写作|报告|综述/u,
    subtopics: ["论点与结构", "素材与引用", "成稿与打磨"],
    practice: "提纲 + 写作轮次"
  }
];

const DEFAULT_PACK = {
  subtopics: ["明确验收标准", "拆到最小可练单元", "设计一次自我检验"],
  practice: "专注练习轮次"
};

/** 单个专注轮次的上限，与指令/产品文档声明的 25-45 分钟保持一致。 */
const ROUND_MAX_MINUTES = 45;
/** 超过该时长才触发拆分建议，避免对正常的 46-60 分钟任务反复打扰。 */
const ROUND_TRIGGER_MINUTES = 60;

/**
 * 技能：学习拆解（study-coach）
 * 纯函数，不依赖具体 Agent 实例，可被任意声明了该技能的 Agent 复用。
 */
export const studyCoachSkill = {
  id: "study-coach",
  label: "学习拆解",
  description: "把学习目标拆成学习单元、练习与间隔复习节奏",
  rules(input, context) {
    const goal = String(input?.goal || "当前学习目标");
    const topic = topicFromGoal(goal);
    const pack = TOPIC_PACKS.find((item) => item.test.test(goal)) || DEFAULT_PACK;
    const tasks = Array.isArray(context?.state?.tasks) ? context.state.tasks : [];
    const unfinishedStudy = tasks.filter((task) => task.status !== "done" && task.category === "学习");
    const unfinishedStudyMinutes = unfinishedStudy.reduce((sum, task) => sum + parseMinutes(task.duration), 0);

    const subtopics = pack.subtopics.map((title, index) => ({
      title,
      detail: `${topic} · 第 ${index + 1} 个学习单元`
    }));

    const reviewPlan = [
      { after: "当天", action: "结束 5 分钟内做无提示回忆" },
      { after: "第 2 天", action: "重做 3 道代表性错题" },
      { after: "第 7 天", action: "做一次 15 分钟混合小测" }
    ];

    const steps = [
      {
        title: `写清「${topic}」的验收标准`,
        detail: "用一句话定义今天结束时可以自检的结果，避免边学边改目标。"
      },
      {
        title: `拆成两个${pack.practice}`,
        detail: "每轮 25-45 分钟，结束后立刻做 5 分钟无提示回忆。"
      },
      {
        title: "用 3 道代表性题目做检验",
        detail: "记录错因并标注属于哪个子单元，作为下一次复习入口。"
      }
    ];

    const proposals = [
      {
        type: "create_task",
        risk: "low",
        title: `制定「${topic}」学习单元`,
        detail: "把学习目标落成一个可执行的 45 分钟任务。",
        payload: { title: `复习：${topic}`, category: "学习", duration: "45 分钟", assignee: "atlas" }
      },
      {
        type: "create_task",
        risk: "low",
        title: `安排「${topic}」复习节点`,
        detail: "建议在第 2 天做一次错题回顾，落实间隔复习（排期由你决定）。",
        payload: { title: `回顾错题：${topic}`, category: "学习", duration: "25 分钟", assignee: "atlas" }
      }
    ];

    const estimatedMinutes = proposals.reduce((sum, proposal) => sum + parseMinutes(proposal.payload.duration || 0), 0);

    // 超过单个专注轮次的任务建议拆分（高影响：会修改用户任务，需要确认）
    const longestStudyTask = unfinishedStudy.slice().sort((a, b) => parseMinutes(b.duration) - parseMinutes(a.duration))[0];
    if (longestStudyTask && parseMinutes(longestStudyTask.duration) > ROUND_TRIGGER_MINUTES) {
      // 收敛到声明的单个专注轮次上限，而不是只减 20 分钟仍留在上限之外。
      proposals.push({
        type: "update_task",
        risk: "high",
        title: `拆分长任务「${longestStudyTask.title}」`,
        detail: `该任务预计 ${longestStudyTask.duration}，超过单个专注轮次上限 ${ROUND_MAX_MINUTES} 分钟，建议调整为 ${ROUND_MAX_MINUTES} 分钟，剩余内容另起一轮。`,
        payload: {
          targetTaskId: longestStudyTask.id,
          changes: { duration: `${ROUND_MAX_MINUTES} 分钟` },
          reason: `超过单个专注轮次上限 ${ROUND_MAX_MINUTES} 分钟`
        }
      });
    }
    const handoffs = input?.allowHandoff === false
      ? []
      : [
          {
            to: "mira",
            reason: `请校验「${topic}」的学习安排是否挤压睡眠与运动`,
            payload: { estimatedMinutes, topic }
          }
        ];

    return {
      status: "completed",
      summary: `已把「${topic}」拆为 ${subtopics.length} 个学习单元和 3 步行动，并给出间隔复习建议。`,
      subtopics,
      reviewPlan,
      steps,
      proposals,
      handoffs,
      notes: [`工作台还有约 ${unfinishedStudyMinutes} 分钟未完成的学习任务。`],
      sources: ["Atlas 知识拆解规则", "工作台任务数据"],
      metrics: { estimatedMinutes, unfinishedStudyMinutes }
    };
  }
};
