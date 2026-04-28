---
tags:
  - providers
  - protocol
  - alice-cli
date: 2026-03-10
version: 0.5.1
---

# LLM Providers 协议对照表

## 总览

| Provider 类型            | 端点 baseURL 示例                         | 主路径                    | 消息格式基准        | 工具调用支持                     |
| ------------------------ | ----------------------------------------- | ------------------------- | ------------------- | -------------------------------- |
| `openai` / `lmstudio` 等 | `https://api.openai.com/v1` / 本地兼容端点 | `/chat/completions`       | OpenAI Chat         | `tools` + `tool_choice`          |
| `mistral`               | `https://api.mistral.ai`                  | `/chat/completions`       | OpenAI 兼容         | 复用 OpenAI-compatible 逻辑     |
| `anthropic`（Claude）   | `https://api.anthropic.com`               | `/v1/messages`            | Anthropic Messages  | `tools` + `tool_choice` + blocks |
| `anthropic`（MiniMax）  | `https://api.minimaxi.com/anthropic`      | `/v1/messages`            | Anthropic 兼容      | 同上，兼容 Claude 协议           |
| `google` (Gemini)       | `https://generativelanguage.googleapis.com` | `/v1/models:generateContent` | Gemini Messages     | functionDeclarations + functionCall |
| `xai`                   | `https://api.x.ai/v1`                     | `/chat/completions`       | OpenAI 兼容         | `tools` + `tool_choice`          |

## 协议要点摘要

### 1. OpenAICompatibleProvider

- **端点**：`POST {baseURL}/chat/completions`
- **请求消息**：
  - `messages: [{ role, content, tool_calls? }]`，直接使用内部 `Message` 结构转换后的 OpenAI 形式。
- **工具调用**：
  - `tools: [{ type: 'function', function: { name, description, parameters } }]`
  - `tool_choice: 'auto'`

### 2. AnthropicProvider（Claude & MiniMax）

- **端点**：`POST {baseURL}/v1/messages`
- **system**：通过顶层 `system: string` 传递。
- **messages 结构**（由 `buildAnthropicMessages` 统一生成）：
  - user：
    ```json
    { "role": "user", "content": [{ "type": "text", "text": "..." }] }
    ```
  - assistant 文本：
    ```json
    { "role": "assistant", "content": [{ "type": "text", "text": "..." }] }
    ```
  - assistant 工具调用（tool_use）：
    ```json
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "..." },
        { "type": "tool_use", "id": "call_xxx", "name": "toolName", "input": { ... } }
      ]
    }
    ```
  - 工具结果（tool_result）：
    ```json
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "call_xxx",
          "name": "toolName",
          "content": [{ "type": "text", "text": "{...tool result...}" }]
        }
      ]
    }
    ```
- **工具定义**：
  - `tools: [{ name, description, input_schema }]`
  - `tool_choice: { type: 'auto' }`

### 3. GoogleProvider (Gemini)

- **端点**：
  - 非流式：`POST {baseURL}/v1/models/{model}:generateContent`
  - 流式：`POST {baseURL}/v1/models/{model}:streamGenerateContent`
- **消息结构**：
  - `contents: [{ role: 'user' | 'model' | 'function', parts: [...] }]`
  - 普通文本：
    ```json
    { "role": "user", "parts": [{ "text": "..." }] }
    ```
  - 工具调用（functionCall）：
    ```json
    {
      "role": "model",
      "parts": [{ "functionCall": { "name": "toolName", "args": { ... } } }]
    }
    ```
  - 工具结果（functionResponse）：
    ```json
    {
      "role": "function",
      "parts": [
        {
          "functionResponse": {
            "name": "toolName",
            "response": { "content": "..." }
          }
        }
      ]
    }
    ```
- **工具定义**：
  - `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`

> 注：本表用于统一思路与后续类型定义，具体实现以 `src/core/providers/*.ts` 中的代码为准。

