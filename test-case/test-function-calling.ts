/**
 * Function Calling 集成测试
 * 测试 LLM 与工具系统的完整集成
 *
 * 注意：需要 LM Studio 运行并支持 Function Calling
 * 运行: npx tsx test-case/test-function-calling.ts
 */

import { LLMClient } from '../src/core/llm.js';
import { configManager } from '../src/utils/config.js';
import { toolRegistry, builtinTools } from '../src/tools/index.js';
import type { Message } from '../src/types/index.js';
import { getErrorMessage } from '../src/utils/error.js';

async function testFunctionCalling() {
  console.log('🧪 Function Calling 集成测试\n');

  // 初始化配置
  await configManager.init();
  const config = configManager.get();
  const modelConfig = configManager.getDefaultModel();

  if (!modelConfig) {
    console.error('❌ 未找到默认模型配置');
    return;
  }

  // 注册工具
  toolRegistry.registerAll(builtinTools);
  console.log(`✓ 已注册 ${toolRegistry.getAll().length} 个工具\n`);

  // 加载系统提示词
  const systemPrompt = await configManager.loadSystemPrompt();

  // 创建 LLM 客户端
  const llmClient = new LLMClient(modelConfig, systemPrompt);
  llmClient.enableTools(config);

  console.log(`✓ 使用模型: ${modelConfig.name} (${modelConfig.model})`);
  console.log(`✓ 工具系统已启用\n`);

  // 测试场景 1: 获取当前时间
  console.log('--- 测试 1: 获取当前时间 ---');
  const test1Messages: Message[] = [
    {
      role: 'user',
      content: '现在几点了？',
      timestamp: new Date()
    }
  ];

  try {
    console.log('发送请求...');
    const response1 = await llmClient.chatWithTools(test1Messages, (record) => {
      console.log(`[${record.toolLabel}] ${record.status}`, record.result?.status || '');
    });
    console.log('\nAI 回复:', response1.content);
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    console.error('错误:', msg);

    // 检查是否是 Function Calling 不支持的错误
    if (msg.includes('tools') || msg.includes('function')) {
      console.log('\n⚠️  LM Studio 可能不支持 Function Calling');
      console.log('💡 请确保：');
      console.log('   1. LM Studio 已更新到最新版本');
      console.log('   2. 使用的模型支持 Function Calling');
      console.log('   3. 或使用 OpenAI API 进行测试');
    }
  }

  console.log('\n');

  // 测试场景 2: 搜索文件（流式）
  console.log('--- 测试 2: 搜索文件（流式） ---');
  const test2Messages: Message[] = [
    {
      role: 'user',
      content: '这个项目有多少个 TypeScript 文件？',
      timestamp: new Date()
    }
  ];

  try {
    console.log('发送请求（流式）...\n');
    let fullResponse = '';

    for await (const chunk of llmClient.chatStreamWithTools(test2Messages, (record) => {
      if (record.status === 'running' && record.result?.status) {
        console.log(`[${record.toolLabel}] ${record.result.status}`);
      } else if (record.status === 'success') {
        console.log(`[${record.toolLabel}] ✓ 完成\n`);
      }
    })) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }

    console.log('\n\n✅ 流式对话完成');
  } catch (error: unknown) {
    console.error('错误:', getErrorMessage(error));
  }

  console.log('\n--- 测试完成 ---');
}

// 运行测试
testFunctionCalling().catch(console.error);
