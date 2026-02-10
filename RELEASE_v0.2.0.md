# ALICE v0.2.0 Release Notes

🎉 **重大更新**: 完整的 Function Calling 工具系统！

发布日期: 2026-02-10

## 🚀 新特性

### 🔧 Function Calling 工具系统

ALICE 现在支持完整的工具调用能力，AI 可以自动执行实际任务：

#### 7 个内置工具

1. **readFile** - 读取文件内容
   - 支持多种编码格式
   - 自动显示文件大小

2. **listFiles** - 列出目录内容
   - 递归扫描目录
   - 可选详细信息（大小、修改时间）

3. **searchFiles** - 搜索文件
   - 支持 glob 模式（`**/*.ts`, `src/**/*.{js,tsx}` 等）
   - 自动忽略 node_modules, .git 等

4. **getCurrentDirectory** - 获取当前目录
   - 返回绝对路径
   - 显示操作系统平台

5. **getGitInfo** - Git 仓库信息
   - 当前分支和所有分支
   - 文件状态（修改、新增、删除）
   - 最近 5 条提交记录
   - 远程仓库信息

6. **getCurrentDateTime** - 获取当前时间
   - ISO 8601 格式
   - 本地时区格式
   - Unix 时间戳
   - 星期几

7. **executeCommand** - 执行系统命令 ⚠️
   - 跨平台支持（Windows PowerShell / Linux Bash）
   - 危险命令检测
   - 用户确认对话框
   - 流式输出显示
   - 30 秒超时保护

### 🎯 核心能力

- **智能工具调用**: AI 自动决定何时使用哪个工具
- **工具调用循环**: 支持多轮工具交互（最大 5 次迭代）
- **实时进度展示**: 工具执行状态实时更新
- **流式响应**: 边执行工具边输出 AI 回复
- **安全机制**: 危险命令需要用户确认
- **跨平台**: Windows/macOS/Linux 全平台支持

### 💡 使用示例

```bash
# 查询时间
> You: 现在几点了？
Alice: 现在是 2026 年 2 月 10 日 21:40，星期二。

# 搜索文件
> You: 这个项目有多少个 TypeScript 文件？
Alice: 项目中共有 25 个 TypeScript 文件...

# 读取文件
> You: 帮我看看 package.json 的内容
Alice: 你的项目名称是 alice-cli，版本 0.2.0...

# 执行命令（带确认）
> You: 删除 node_modules
[⚠️ 危险命令警告] 确认执行? (y/N):
```

## 📦 技术实现

### 架构升级

- **Provider 层**: 支持 OpenAI Function Calling API 格式
- **LLMClient**: 完整的工具调用循环实现
- **ToolRegistry**: 工具注册和管理
- **ToolExecutor**: 工具执行和进度跟踪
- **UI 组件**: ToolCallStatus、DangerousCommandConfirm

### 新增依赖

```json
{
  "ajv": "^8.17.1",        // JSON Schema 验证
  "glob": "^13.0.1",       // 文件搜索
  "simple-git": "^3.30.0"  // Git 信息获取
}
```

### 新增配置

`~/.alice/settings.jsonc`:
```jsonc
{
  // 危险命令确认开关
  "dangerous_cmd": true  // 默认开启，推荐
}
```

## 🔄 破坏性变更

无。所有新功能都是增量添加，向后兼容。

## 🐛 修复

- 改进流式响应的稳定性
- 修复会话状态管理问题
- 优化错误处理和提示

## 📊 统计

- **新增代码**: ~3000 行
- **新增文件**: 20+ 个
- **文档**: 3 个详细实现文档
- **测试**: 完整的工具系统测试脚本

## 🎓 文档

- `TOOL_SYSTEM_IMPLEMENTATION.md` - 工具系统架构
- `PHASE2_IMPLEMENTATION.md` - LLM 集成详解
- `PHASE5_IMPLEMENTATION.md` - UI 集成指南
- 更新的 `README.md` - 包含工具使用示例

## ⚠️ 已知限制

1. **LM Studio 兼容性**
   - 需要支持 Function Calling 的版本
   - 某些模型可能不支持工具调用
   - 可能需要使用 GPT-3.5/4 或兼容模型

2. **性能考虑**
   - 工具调用会增加响应延迟
   - 建议使用本地 LLM 以获得最佳性能

## 🚀 下一步

计划中的功能：
- 更多内置工具（网络请求、数据库查询等）
- 自定义工具支持
- 工具调用历史记录
- 性能优化和缓存
- 更多 LLM 后端支持

## 🙏 致谢

感谢所有测试者和贡献者！

---

**完整更新日志**: [v0.1.0...v0.2.0](https://github.com/AndersHsueh/Alice/compare/v0.1.0...v0.2.0)

**Issues 关闭**: #3, #17

**下载**: [Release v0.2.0](https://github.com/AndersHsueh/Alice/releases/tag/v0.2.0)
