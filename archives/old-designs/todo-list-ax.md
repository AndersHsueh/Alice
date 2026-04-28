# Alice 待办事项（来自 deepagentsjs 对比分析）

## 优先级：高

- [ ] **对话摘要压缩（Summarization）**
  - 在 `LLMClient.chatStreamWithTools()` 的 while 循环中，检查 `conversationMessages` token 数
  - 达到阈值时调用 LLM 生成历史摘要，用摘要替换旧消息，保留最近 N 条
  - 解决长对话 400 / token 溢出崩溃问题
  - 参考：`deepagentsjs/libs/deepagents/src/middleware/summarization.ts`

## 优先级：中

- [ ] **Tool Call 容错修复（Patch Tool Calls）**
  - 在工具调用结果处理前，加一层修复层，自动修正模型返回的 malformed JSON
  - 减少因模型输出格式不规范导致的 400 错误
  - 参考：`deepagentsjs/libs/deepagents/src/middleware/patch_tool_calls.ts`

- [ ] **结构化记忆层（Memory）**
  - Agent 可以主动读写 key-value 记忆块，实现跨会话持久记忆
  - 当前 SessionManager 只存消息历史，没有 Agent 可读写的结构化记忆
  - 参考：`deepagentsjs/libs/deepagents/src/middleware/memory.ts`

## 优先级：低

- [ ] **子代理委派（Subagent Delegation）**
  - 主 Agent 通过工具把复杂子任务委派给专门的子 Agent
  - 需要较大架构改动，当前 daemon taskRunner 不是 Agent 级委派
  - 参考：`deepagentsjs/libs/deepagents/src/middleware/subagents.ts`

- [ ] **中间件架构重构**
  - 将 `LLMClient` 的单体逻辑拆分为可组合的处理阶段
  - 提升长期可维护性和可测试性
  - 参考：`deepagentsjs/libs/deepagents/src/agent.ts` 的中间件栈设计

---

## TUI 界面相关（用户重点关注）

> 待补充：你有哪些具体想改进的 TUI 方向？
