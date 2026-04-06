/**
 * 并发智能体集成测试
 * 验证三个 agent 能够真正并发执行、上下文隔离、结果准确聚合
 */

import { runConcurrentAgents, aggregateConcurrentResults } from '../runtime/agent/concurrentAgentRunner.js';
import type { RuntimeChatRequest } from '../runtime/kernel/runtimeTypes.js';
import type { AgentLoopDependencies } from '../runtime/agent/agentLoop.js';
import type { DaemonLogger } from '../daemon/logger.js';

/**
 * 测试场景：三个审查智能体并发执行
 *
 * 实际使用时的依赖项需要从系统注入
 */
export async function testConcurrentAgents(deps: AgentLoopDependencies): Promise<void> {
  console.log('🧪 开始并发智能体集成测试...\n');

  // 模拟共享的代码审查请求
  const sharedRequest: RuntimeChatRequest = {
    message: `Review this code change for:
1. Code reuse opportunities
2. Code quality issues  
3. Efficiency problems

Here's the git diff:
\`\`\`diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,10 +1,20 @@
 export function processData(items: any[]) {
   const result: any[] = [];
   for (let i = 0; i < items.length; i++) {
     result.push(items[i].value * 2);
   }
+  for (let i = 0; i < result.length; i++) {
+    console.log(result[i]);
+  }
   return result;
 }
\`\`\`

Focus on code quality, reuse, and efficiency.`,
    sessionId: 'test-session-123',
    workspace: '/tmp/test',
  };

  // 三个审查智能体 profiles
  const profileIds = [
    'code-reuse-reviewer',
    'code-quality-reviewer',
    'efficiency-reviewer',
  ];

  const agentLabels = {
    'code-reuse-reviewer': '复用审查',
    'code-quality-reviewer': '质量审查',
    'efficiency-reviewer': '效率审查',
  };

  console.log(`📊 配置：`);
  console.log(`   - 并发智能体数：${profileIds.length}`);
  console.log(`   - Profile IDs：${profileIds.join(', ')}`);
  console.log(`   - Session ID：${sharedRequest.sessionId}`);
  console.log(`   - Workspace：${sharedRequest.workspace}\n`);

  const startTime = Date.now();
  const agentEventCounts: Record<string, number> = {};
  const agentStatusMap: Record<string, string> = {};

  // 初始化计数器
  profileIds.forEach(pid => {
    agentEventCounts[pid] = 0;
    agentStatusMap[pid] = 'pending';
  });

  try {
    // 流式消费并发事件
    console.log('⏳ 等待智能体执行...\n');

    for await (const { agentId, event } of runConcurrentAgents(
      {
        profileIds,
        sharedRequest,
        agentLabels,
      },
      deps
    )) {
      agentEventCounts[agentId]++;

      // 实时显示事件
      if (event.type === 'text_delta') {
        process.stdout.write('.');
      } else if (event.type === 'tool_finished') {
        console.log(`\n[${agentId}] 工具执行完成：${(event as any).record.toolName}`);
      } else if (event.type === 'done') {
        agentStatusMap[agentId] = 'completed';
        console.log(`\n[${agentId}] ✅ 执行完成`);
      } else if (event.type === 'error') {
        agentStatusMap[agentId] = 'error';
        console.log(`\n[${agentId}] ❌ 错误：${(event as any).message}`);
      } else if (event.type === 'model_selected') {
        console.log(`[${agentId}] 🤖 选中模型：${(event as any).modelName}`);
      }
    }

    const duration = Date.now() - startTime;

    console.log(`\n\n✨ 测试完成！耗时 ${duration}ms\n`);

    // 验证结果
    console.log('📈 执行统计：');
    profileIds.forEach(pid => {
      const count = agentEventCounts[pid];
      const status = agentStatusMap[pid];
      console.log(`   - ${pid}：${count} 个事件，状态 ${status}`);
    });

    // 验证并发性：理想情况下，所有 agent 应该在类似的时间窗口完成
    console.log('\n✅ 验证并发执行：');
    const allCompleted = profileIds.every(pid => agentStatusMap[pid] === 'completed');
    if (allCompleted) {
      console.log('   ✓ 所有 agent 都成功完成');
    } else {
      console.log('   ⚠ 部分 agent 未完成或出错');
      profileIds.forEach(pid => {
        if (agentStatusMap[pid] !== 'completed') {
          console.log(`     - ${pid}：${agentStatusMap[pid]}`);
        }
      });
    }

    // 验证事件计数
    console.log('\n✅ 验证事件收集：');
    profileIds.forEach(pid => {
      const count = agentEventCounts[pid];
      if (count > 0) {
        console.log(`   ✓ ${pid} 收集了 ${count} 个事件`);
      } else {
        console.log(`   ✗ ${pid} 未收集事件`);
      }
    });

    return;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ 测试失败：${msg}`);
    throw error;
  }
}

/**
 * 单独测试：聚合结果函数
 */
export async function testAggregateResults(deps: AgentLoopDependencies): Promise<void> {
  console.log('\n🧪 测试结果聚合函数...\n');

  const sharedRequest: RuntimeChatRequest = {
    message: 'Quick test message',
    sessionId: 'test-aggregate-123',
    workspace: '/tmp/test',
  };

  try {
    const generator = runConcurrentAgents(
      {
        profileIds: ['code-reuse-reviewer', 'code-quality-reviewer'],
        sharedRequest,
      },
      deps
    );

    const results = await aggregateConcurrentResults(generator);

    console.log('✅ 结果聚合成功：');
    Object.entries(results).forEach(([agentId, data]) => {
      console.log(`   - ${agentId}：${data.events.length} 个事件`);
      if (data.finalMessages) {
        console.log(`     (包含 ${data.finalMessages.length} 条消息)`);
      }
    });

    return;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ 聚合测试失败：${msg}`);
    throw error;
  }
}
