# PR: 支持多 LLM 后端（Issue #1）

## 📝 变更概述

本 PR 实现了 Issue #1 的需求，为 ALICE 添加了多 LLM 后端支持，包括：
- ✅ 支持 LM Studio、Ollama、OpenAI、Azure OpenAI 等多个提供商
- ✅ 智能降级机制（主模型故障时自动切换到最快的备用模型）
- ✅ 模型测速工具（`--test-model` 命令）
- ✅ 配置文件迁移到 JSONC 格式（支持注释）
- ✅ 环境变量支持（`${VAR_NAME}` 占位符）
- ✅ 向后兼容（自动迁移旧配置文件）

## 🎯 关闭的 Issue

Closes #1

## 🔧 技术实现

### 1. 配置文件重构
- **从**: `~/.alice/config.json`（单一 LLM 配置）
- **到**: `~/.alice/settings.jsonc`（多模型配置 + 注释支持）

新配置结构：
```jsonc
{
  "default_model": "lmstudio-local",    // 用户选择的默认模型
  "suggest_model": "lmstudio-local",    // 系统推荐的最快模型
  "models": [                            // 多模型配置列表
    {
      "name": "lmstudio-local",
      "provider": "lmstudio",
      "baseURL": "http://127.0.0.1:1234/v1",
      "model": "qwen3-vl-4b-instruct",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,      // 最后测速时间
      "speed": null                       // 响应速度（秒）
    }
  ]
}
```

### 2. Provider 适配器架构
创建了可扩展的适配器模式：
```
src/core/providers/
├── base.ts                  # 抽象基类
├── openai-compatible.ts     # OpenAI 兼容适配器
└── index.ts                 # 工厂类
```

当前所有 provider 都使用 OpenAI 兼容格式，便于后续扩展。

### 3. LLMClient 重构
- 支持根据 `provider` 类型动态选择适配器
- 实现智能降级机制：
  - 主模型失败时自动切换到 `suggest_model`
  - 判断是否应该降级（连接超时、服务器错误等）
  - 显示友好的降级提示
  - 避免无限重试

### 4. 模型测速工具（`--test-model`）
新增 `src/utils/test-model.ts`，实现：
- 批量测试所有配置的模型
- 发送简单测试消息（"Hello"）测量响应时间
- 更新每个模型的 `last_update_datetime` 和 `speed`
- 自动选出最快模型并更新 `suggest_model`
- 显示漂亮的测速结果汇总表格

### 5. 环境变量支持
- 支持 `${VAR_NAME}` 占位符格式
- 运行时自动从环境变量解析
- 安全存储 API Key（不保存明文在配置文件中）

### 6. 向后兼容
- 首次启动时检测 `config.json` 是否存在
- 自动迁移到 `settings.jsonc`
- 保留原配置文件作为备份（`config.json.backup`）
- 显示迁移成功提示

## 📦 新增依赖

- `jsonc-parser`: 解析支持注释的 JSON 文件

## 🚀 使用示例

### 1. 配置多个模型
编辑 `~/.alice/settings.jsonc`：
```jsonc
{
  "default_model": "openai-gpt4",
  "suggest_model": "lmstudio-local",
  "models": [
    {
      "name": "lmstudio-local",
      "provider": "lmstudio",
      "baseURL": "http://127.0.0.1:1234/v1",
      "model": "qwen3-vl-4b-instruct",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,
      "speed": null
    },
    {
      "name": "openai-gpt4",
      "provider": "openai",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4",
      "apiKey": "${OPENAI_API_KEY}",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,
      "speed": null
    }
  ]
}
```

### 2. 设置环境变量
```bash
export OPENAI_API_KEY="sk-xxxxx"
```

### 3. 测试所有模型
```bash
alice --test-model
```

输出示例：
```
🔍 ALICE 模型测速中...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/2] 测试 lmstudio-local (LM Studio)...
      端点: http://127.0.0.1:1234/v1
      ✓ 连接成功  ⏱️  1.2s

[2/2] 测试 openai-gpt4 (OpenAI)...
      端点: https://api.openai.com/v1
      ✓ 连接成功  ⏱️  2.5s  

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 测速结果汇总

┌────────────────────┬──────────────┬──────────┬─────────────────────┐
│ 模型名称           │ 提供商       │ 速度     │ 状态                │
├────────────────────┼──────────────┼──────────┼─────────────────────┤
│ lmstudio-local ⚡  │ LM Studio    │ 1.2s     │ ✓ 正常              │
│ openai-gpt4        │ OpenAI       │ 2.5s     │ ✓ 正常              │
└────────────────────┴──────────────┴──────────┴─────────────────────┘

💡 建议使用模型: lmstudio-local (速度最快)
📝 配置已更新: ~/.alice/settings.jsonc

测速完成！
```

### 4. 智能降级演示
当主模型（openai-gpt4）连接失败时：
```
⚠️  主模型 (openai-gpt4) 连接失败，已自动切换到备用模型 (lmstudio-local)
💡 提示：运行 'alice --test-model' 重新测速并更新推荐模型
```

## 📄 文档更新

- ✅ 更新 README.md，添加多后端配置说明
- ✅ 添加环境变量配置示例
- ✅ 添加 `--test-model` 使用说明
- ✅ 说明智能降级机制
- ✅ 创建 `settings.jsonc.example` 配置示例文件

## ✅ 测试验证

### 已测试场景
- [x] 配置文件自动迁移（从 config.json 到 settings.jsonc）
- [x] JSONC 格式解析（带注释）
- [x] 环境变量占位符解析（`${VAR_NAME}`）
- [x] `--test-model` 批量测速功能
- [x] 测速结果显示和配置更新
- [x] TypeScript 编译通过
- [x] 配置文件生成格式正确

### 待测试场景（需要实际运行的 LLM 服务）
- [ ] LM Studio 本地服务连接和对话
- [ ] Ollama 本地服务连接和对话
- [ ] OpenAI API 连接和对话（需要有效的 API Key）
- [ ] 主模型故障时的智能降级
- [ ] 多模型测速的实际速度对比

## 🔄 兼容性

- **向后兼容**: ✅ 自动检测并迁移旧配置文件
- **破坏性变更**: ⚠️ 配置文件格式变更（但会自动迁移）
- **最低版本要求**: Node.js ≥ 18

## 📝 审阅要点

1. **配置结构设计**: 是否合理？是否易于扩展？
2. **降级逻辑**: 触发条件是否合适？错误提示是否清晰？
3. **测速工具**: 输出格式是否美观？信息是否完整？
4. **环境变量**: 占位符格式是否合理？安全性如何？
5. **向后兼容**: 迁移逻辑是否正确？是否需要更多提示？

## 🎉 效果展示

### 配置文件示例
```jsonc
{
  // 默认使用的模型
  "default_model": "lmstudio-local",

  // 系统推荐的最快模型（由 --test-model 自动更新）
  "suggest_model": "lmstudio-local",

  // 多模型配置列表
  "models": [
    {
      "name": "lmstudio-local",
      "provider": "lmstudio",
      "baseURL": "http://127.0.0.1:1234/v1",
      "model": "qwen3-vl-4b-instruct",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": "2026-02-10T03:20:00Z",
      "speed": 1.2
    }
  ]
}
```

### 命令行参数
```bash
# 跳过启动动画
alice --no-banner

# 测试所有模型速度
alice --test-model
```

## 🙏 致谢

感谢 Issue #1 的需求提出！这个功能大大增强了 ALICE 的灵活性和可靠性。
