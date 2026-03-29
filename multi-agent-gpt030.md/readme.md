可以，而且这个功能的核心**不是 tmux**，而是**多会话编排层**。`tmux` 只是显示层。

按官方文档，Claude Code 的 agent teams 本质上是这几件事组合起来：

- 一个 **lead** 会话负责建队、派单、汇总结果
- 多个 **teammate** 会话各自独立运行，各有自己的上下文窗口
- 一个本地 **shared task list** 供成员认领/完成任务，带依赖关系
- 一个本地 **mailbox** 负责 agent 之间消息传递
- 一个 **display adapter** 决定显示在单终端里，还是映射到 `tmux`/iTerm2 分屏
- 成员启动时加载项目上下文，但**不继承 lead 的完整对话历史**
- 任务认领用 **file locking** 防止多个 agent 抢同一任务

Claude Code 官方文档甚至直接写了：
- team config 在 `~/.claude/teams/{team-name}/config.json`
- task list 在 `~/.claude/tasks/{team-name}/`
- split panes 依赖 `tmux` 或 iTerm2
- teammates 可以直接互发消息，不只是回报 lead  
来源：[Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)

而 Gemini CLI 这边，官方架构已经很接近你要做的底座了：
- `packages/cli` 是前端/UI
- `packages/core` 是编排和工具执行层
- 已有 **subagents**
- 已有 **git worktrees**
- 已有 **remote subagents / A2A**
来源：[Gemini CLI Architecture](https://geminicli.com/docs/architecture), [Gemini CLI Core](https://geminicli.com/docs/core/), [Subagents](https://geminicli.com/docs/core/subagents/), [Git Worktrees](https://geminicli.com/docs/cli/git-worktrees/), [Remote Subagents](https://geminicli.com/docs/core/remote-agents/)

**我的判断**：你 fork `gemini-cli` 做这个功能，最合理的路线不是“先搞 tmux”，而是按下面顺序做。

**一、先做 MVP 架构**
1. 在 `packages/core` 新增 `team-runtime`。
2. 定义四个核心对象：
   - `Team`
   - `Member`
   - `Task`
   - `Message`
3. 本地存储先用文件系统，不要一开始上数据库：
   - `~/.gemini/teams/{teamId}/config.json`
   - `~/.gemini/teams/{teamId}/tasks/*.json`
   - `~/.gemini/teams/{teamId}/mailboxes/{agentId}.jsonl`
4. 每个 teammate 就是一个**独立 Gemini session**，不是线程内共享状态对象。

**二、先把“编排”做通，再做 UI**
1. lead 创建 team
2. lead spawn 3 个 teammate
3. lead 创建任务
4. teammate claim task
5. teammate 完成后写 result + 发消息给 lead
6. lead 汇总

先只做 **in-process 模式**，不要先碰 tmux。  
原因很简单：如果没有共享任务/消息机制，tmux 分再漂亮也只是“多个终端窗口”，不是 agent team。

**三、teammate 的启动方式**
建议第一版直接复用 CLI 本身，按“多进程”做：

```bash
gemini --agent team-worker --team-id T123 --member-id M1
```

也就是：
- lead 也是一个 Gemini session
- teammate 也是 Gemini session
- 只是附加 team 上下文和专用工具

这样你不需要重写整套 agent loop。

**四、给 teammate 注入 4 个 team 工具**
最少需要这几个内部工具：

- `team_list_tasks`
- `team_claim_task`
- `team_complete_task`
- `team_send_message`

第二批再加：
- `team_broadcast`
- `team_read_mailbox`
- `team_create_task`
- `team_update_task_status`

这里你可以直接借鉴 Claude Code 的思路：  
**通信和协作是工具，不是 prompt hack。**

**五、任务系统要这样设计**
任务字段至少包括：

```json
{
  "id": "task-001",
  "title": "Review auth module",
  "description": "...",
  "status": "pending",
  "assignee": null,
  "dependsOn": [],
  "priority": 2,
  "createdBy": "lead",
  "claimedAt": null,
  "completedAt": null
}
```

关键点：
- `pending / in_progress / completed / blocked`
- `dependsOn`
- claim 时做锁
- 完成任务后自动解锁依赖任务

Claude Code 官方明确提到 task claiming 用 file locking，这个你应该照抄思路，而不是自己发明乐观并发协议。

**六、消息系统这样做**
消息不要直接走 stdout，应该是独立 mailbox：

```json
{
  "id": "msg-001",
  "from": "lead",
  "to": "member-2",
  "type": "instruction",
  "body": "Investigate caching layer",
  "createdAt": "2026-03-30T10:00:00Z"
}
```

投递模型：
- 先落盘到 mailbox
- 再通知对应 agent loop 有新消息
- agent 收到后把消息注入成新 turn

这一点和 Claude Code 文档里的 “automatic message delivery” 是一致的。  
我这里补充的是实现推断：**实际产品大概率也是“本地状态 + 注入新 turn”这一路**，tmux 本身不负责通信。

**七、tmux 只做 display adapter**
当编排层跑通以后，再接 `tmux`：

- lead 建一个 `tmux session`
- 每个 teammate 一个 pane
- 每个 pane 跑一个独立 `gemini --agent ...`
- pane 标题显示 agent 名称/任务状态
- lead pane 可以看到 team summary
- 用户点进 pane 直接和某个 teammate 对话

所以抽象要分层：

- `TeamOrchestrator`
- `SessionLauncher`
- `DisplayAdapter`
  - `InProcessDisplayAdapter`
  - `TmuxDisplayAdapter`

这样以后还能支持 iTerm2，不会把 tmux 写死在核心逻辑里。

**八、文件隔离建议直接接 worktrees**
Gemini CLI 自己已经有 experimental worktrees。这个非常适合 team 功能。

建议策略：
- 默认所有 teammate 共享同一工作区，只适合 review/research
- 如果任务涉及并行改代码，给每个 teammate 分配独立 worktree
- `member.workspacePath` 指向自己的 worktree

否则多个 agent 同时改一个仓库，冲突会非常难看。

**九、你在 gemini-cli 里的代码落点**
建议这样拆：

- `packages/core/src/team/`
  - `team-manager.ts`
  - `task-store.ts`
  - `mailbox-store.ts`
  - `member-runtime.ts`
  - `team-tools.ts`
  - `locks.ts`
- `packages/cli/src/commands/`
  - `team.ts`
- `packages/cli/src/display/`
  - `team-inprocess.tsx`
  - `team-tmux.ts`
- `packages/core/src/config/`
  - team feature flags
  - teammate mode
  - workspace isolation mode

**十、最小可交付版本**
第一阶段只做这些：

1. `gemini team create`
2. `gemini team run`
3. 3 个 teammate 并发跑
4. shared task list
5. direct messaging
6. in-process UI
7. 只支持 research/review，不支持并行写代码

等这个稳定了，再加：

1. `tmux` split panes
2. per-member worktree
3. plan approval gate
4. hooks
5. resume/cleanup
6. remote teammates over A2A

**十一、你最容易踩的坑**
- 把 tmux 当核心。错，tmux 只是展示。
- 让 lead 的完整 history 传给所有 teammate。会爆 token，也会污染职责。
- 不做任务锁。多个 agent 会重复认领任务。
- 不做工作区隔离就让多人写代码。很快互相覆盖。
- 不做 shutdown/cleanup。最后会留下 orphan process 和 orphan tmux session。
- 让 teammate 只能回 lead，不能互发消息。那就退化成 subagent，不是 team。

**十二、我给你的最终技术建议**
如果你真要 fork `gemini-cli` 做这个功能，最佳路线是：

1. 复用 `packages/core` 的 agent loop，不重写推理主循环
2. 新增 team orchestration 层
3. 用文件系统做 task/mailbox/config 的本地状态
4. 先做 in-process mode
5. 再加 tmux adapter
6. 最后把 worktree 和 A2A 接进来

这条路线最稳，也最像 Claude Code 已公开出来的机制。

如果你要，我下一步可以直接给你一份更工程化的东西：

- **模块设计文档**
- **数据结构定义**
- **CLI 命令设计**
- **MVP 开发里程碑**
- **给 Copilot/Codex 用的实施计划**

我可以按 `gemini-cli` 的现有包结构，直接给你写成一份可执行的开发 spec。

