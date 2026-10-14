import { randomUUID } from "node:crypto";
import { now, truncate } from "./utils.mjs";

/** Agent 提议动作 → 工具权限键的映射。 */
export const TOOL_FOR_PROPOSAL = {
  create_task: "tasks:create",
  update_task: "tasks:update",
  reschedule_block: "schedule:reblock",
  delete_task: "tasks:archive",
  goal_recalibration: "goals:recalibrate"
};

/** 受支持的工具键白名单，Agent 定义文件只能声明这些工具。 */
export const TOOL_NAMES = ["state:read", "tasks:create", "tasks:update", "tasks:archive", "schedule:reblock", "goals:recalibrate"];

const CATEGORIES = new Set(["学习", "生活", "成长"]);
const ASSIGNEES = new Set(["atlas", "mira", "nova", "self"]);
const EDITABLE_FIELDS = ["title", "category", "duration", "assignee"];

const findActiveTask = (state, id) => (state.tasks || []).find((task) => task.id === id && !task.archivedAt) || null;

/** 只接受可编辑字段，并做与 API 相同的长度/枚举校验。 */
function sanitizeChanges(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const changes = {};
  if (typeof raw.title === "string" && raw.title.trim() && raw.title.trim().length <= 60) changes.title = raw.title.trim();
  if (CATEGORIES.has(raw.category)) changes.category = raw.category;
  if (typeof raw.duration === "string" && raw.duration.trim() && raw.duration.trim().length <= 20) changes.duration = raw.duration.trim();
  if (ASSIGNEES.has(raw.assignee)) changes.assignee = raw.assignee;
  return changes;
}

function describeChanges(before, after) {
  const labels = { title: "名称", category: "领域", duration: "时长", assignee: "负责人" };
  return Object.keys(after)
    .map((field) => `${labels[field] || field} ${before[field] ?? "—"} → ${after[field]}`)
    .join("，");
}

/**
 * 受控工具层：Agent 不能直接改业务状态，所有写入都经过权限校验。
 * 低风险动作可在运行中被自动应用；高影响动作必须经用户确认后调用。
 * 删除是软删除（归档），可在归档箱恢复。
 */
export function createTools({ repository }) {
  async function createTask({ proposal, agent }) {
    const payload = proposal.payload || {};
    const title = truncate(payload.title || proposal.title || "", 60);
    if (!title) {
      // 与 API 的 1-60 字校验对齐，避免写入无标题任务。
      return { ok: false, reason: "缺少任务标题，未写入任务流", effect: null };
    }
    const timestamp = now();
    const task = {
      id: `task-${randomUUID()}`,
      title,
      category: CATEGORIES.has(payload.category) ? payload.category : "成长",
      duration: truncate(payload.duration || "25 分钟", 20),
      assignee: ASSIGNEES.has(payload.assignee) ? payload.assignee : (agent?.id || "self"),
      status: "todo",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: "agent",
      agentId: proposal.agentId || agent?.id || "self",
      origin: proposal.id
    };
    await repository.update((state) => {
      if (!Array.isArray(state.tasks)) state.tasks = [];
      state.tasks.unshift(task);
      return task;
    });
    return { ok: true, effect: "created_task", targetId: task.id, summary: `已写入任务流：${task.title}` };
  }

  async function updateTask({ proposal, targetId, changes }) {
    const patch = changes || sanitizeChanges(proposal.payload?.changes);
    const id = targetId || proposal.payload?.targetTaskId;
    if (!id) return { ok: false, reason: "缺少 targetTaskId，无法定位要修改的任务", effect: null };
    if (!Object.keys(patch).length) return { ok: false, reason: "没有可用的修改字段（仅支持名称/领域/时长/负责人）", effect: null };

    const result = await repository.update((state) => {
      const task = findActiveTask(state, id);
      if (!task) return null;
      const before = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, task[field]]));
      Object.assign(task, patch, { updatedAt: now() });
      return { id: task.id, title: task.title, before };
    });
    if (!result) return { ok: false, reason: `没有找到可修改的任务：${id}`, effect: null };
    return {
      ok: true,
      effect: "updated_task",
      targetId: result.id,
      summary: `已更新「${truncate(result.title, 24)}」：${describeChanges(result.before, patch)}`
    };
  }

  async function archiveTask({ proposal, agent }) {
    const id = proposal.payload?.targetTaskId;
    if (!id) return { ok: false, reason: "缺少 targetTaskId，无法定位要归档的任务", effect: null };
    const result = await repository.update((state) => {
      const task = findActiveTask(state, id);
      if (!task) return null;
      task.archivedAt = now();
      task.archivedBy = proposal.agentId || agent?.id || "agent";
      task.updatedAt = task.archivedAt;
      return { id: task.id, title: task.title };
    });
    if (!result) return { ok: false, reason: `没有找到可归档的任务：${id}`, effect: null };
    return {
      ok: true,
      effect: "archived_task",
      targetId: result.id,
      summary: `已归档「${truncate(result.title, 24)}」，可在归档箱恢复`
    };
  }

  async function recordRecalibration({ proposal, agent }) {
    const payload = proposal.payload || {};
    const timestamp = now();
    const task = {
      id: `task-${randomUUID()}`,
      title: truncate(payload.focusTaskTitle || `聚焦：${payload.suggestedFocus || proposal.title}`, 60),
      category: "成长",
      duration: "25 分钟",
      assignee: ASSIGNEES.has(payload.assignee) ? payload.assignee : (agent?.id || "nova"),
      status: "todo",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: "agent",
      agentId: proposal.agentId || agent?.id || "nova",
      origin: proposal.id
    };
    await repository.update((state) => {
      if (!Array.isArray(state.tasks)) state.tasks = [];
      state.tasks.unshift(task);
      return task;
    });
    return {
      ok: true,
      effect: "recorded_goal_focus",
      targetId: task.id,
      summary: `已新增聚焦任务：${task.title}（未修改现有目标与优先级）`
    };
  }

  return {
    async readState() {
      const state = await repository.getState();
      // Agent 只处理未归档任务，避免基于历史数据重复建议。
      return { ...state, tasks: (state.tasks || []).filter((task) => !task.archivedAt) };
    },

    /**
     * 应用一条建议。返回 { ok, effect, targetId, summary, reason }。
     * 权限不足时返回 ok:false，由调用方决定是否升级为待确认项。
     */
    async applyProposal({ proposal, agent }) {
      const toolName = TOOL_FOR_PROPOSAL[proposal?.type];
      if (!toolName) {
        return { ok: false, reason: `暂不支持的动作类型：${proposal?.type}`, effect: null };
      }
      if (!agent || !agent.allows(toolName)) {
        return { ok: false, reason: `${agent?.name || proposal?.agentId || "该 Agent"} 没有执行 ${toolName} 的权限`, effect: null };
      }

      switch (proposal.type) {
        case "create_task":
          return createTask({ proposal, agent });
        case "update_task":
          return updateTask({ proposal });
        case "delete_task":
          return archiveTask({ proposal, agent });
        case "goal_recalibration":
          return recordRecalibration({ proposal, agent });
        case "reschedule_block": {
          // 带具体目标时执行真实调整；否则退化为生成一条调整建议任务，并如实说明。
          const hasTarget = Boolean(proposal.payload?.targetTaskId && Object.keys(sanitizeChanges(proposal.payload?.changes)).length);
          if (hasTarget) return updateTask({ proposal });
          const created = await createTask({
            proposal: {
              ...proposal,
              payload: {
                ...proposal.payload,
                title: `调整：${proposal.title}`,
                category: proposal.payload?.category || "成长",
                duration: proposal.payload?.duration || "25 分钟",
                assignee: proposal.agentId
              }
            },
            agent
          });
          return {
            ...created,
            effect: "created_adjustment_task",
            summary: `未能定位具体任务，已生成调整建议：${created.summary.replace(/^已写入任务流：/, "")}`
          };
        }
        default:
          return { ok: false, reason: `暂不支持的动作类型：${proposal.type}`, effect: null };
      }
    }
  };
}
