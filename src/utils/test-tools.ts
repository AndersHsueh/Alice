/**
 * 工具系统测试示例
 * 运行: npm run dev -- --test-tools
 */

import { toolRegistry, builtinTools, ToolExecutor } from '../tools/index.js';
import { configManager } from '../utils/config.js';
import type { ToolCall } from '../types/tool.js';

async function testTools() {
  console.log('🧪 工具系统测试\n');

  // 初始化配置
  await configManager.init();
  const config = configManager.get();

  // 注册所有内置工具
  toolRegistry.registerAll(builtinTools);
  console.log(`✓ 已注册 ${toolRegistry.getAll().length} 个工具\n`);

  // 列出所有工具
  console.log('📦 可用工具:');
  toolRegistry.getAll().forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
  console.log();

  // 创建工具执行器
  const executor = new ToolExecutor(config);

  // 测试 1: getCurrentDateTime
  console.log('--- 测试 1: getCurrentDateTime ---');
  const timeCall: ToolCall = {
    id: 'test-1',
    type: 'function',
    function: {
      name: 'getCurrentDateTime',
      arguments: '{}'
    }
  };
  const timeResult = await executor.execute(timeCall, (record) => {
    console.log(`[${record.toolLabel}] ${record.status}`);
  });
  console.log('结果:', JSON.stringify(timeResult.data, null, 2));
  console.log();

  // 测试 2: getCurrentDirectory
  console.log('--- 测试 2: getCurrentDirectory ---');
  const dirCall: ToolCall = {
    id: 'test-2',
    type: 'function',
    function: {
      name: 'getCurrentDirectory',
      arguments: '{}'
    }
  };
  const dirResult = await executor.execute(dirCall);
  console.log('结果:', dirResult.data);
  console.log();

  // 测试 3: searchFiles
  console.log('--- 测试 3: searchFiles (*.ts) ---');
  const searchCall: ToolCall = {
    id: 'test-3',
    type: 'function',
    function: {
      name: 'searchFiles',
      arguments: JSON.stringify({
        pattern: '*.ts',
        directory: './src'
      })
    }
  };
  const searchResult = await executor.execute(searchCall, (record) => {
    if (record.result?.status) {
      console.log(`[${record.toolLabel}] ${record.result.status}`);
    }
  });
  console.log(`找到 ${searchResult.data?.count} 个文件`);
  console.log();

  // 测试 4: readFile
  console.log('--- 测试 4: readFile (package.json) ---');
  const readCall: ToolCall = {
    id: 'test-4',
    type: 'function',
    function: {
      name: 'readFile',
      arguments: JSON.stringify({
        path: 'package.json'
      })
    }
  };
  const readResult = await executor.execute(readCall);
  if (readResult.success) {
    const pkg = JSON.parse(readResult.data.content);
    console.log(`项目: ${pkg.name} v${pkg.version}`);
    console.log(`依赖数量: ${Object.keys(pkg.dependencies || {}).length}`);
  }
  console.log();

  // 测试 5: listFiles
  console.log('--- 测试 5: listFiles (.) ---');
  const listCall: ToolCall = {
    id: 'test-5',
    type: 'function',
    function: {
      name: 'listFiles',
      arguments: JSON.stringify({
        directory: '.',
        detailed: false
      })
    }
  };
  const listResult = await executor.execute(listCall);
  console.log(`目录: ${listResult.data?.directory}`);
  console.log(`文件: ${listResult.data?.files} 个`);
  console.log(`目录: ${listResult.data?.directories} 个`);
  console.log();

  // 测试 6: getGitInfo
  console.log('--- 测试 6: getGitInfo ---');
  const gitCall: ToolCall = {
    id: 'test-6',
    type: 'function',
    function: {
      name: 'getGitInfo',
      arguments: '{}'
    }
  };
  const gitResult = await executor.execute(gitCall);
  if (gitResult.success) {
    console.log(`当前分支: ${gitResult.data.currentBranch}`);
    console.log(`修改文件: ${gitResult.data.status.modified.length} 个`);
    console.log(`最近提交: ${gitResult.data.recentCommits[0]?.message}`);
  }
  console.log();

  console.log('✅ 测试完成！');
}

// 运行测试
testTools().catch(console.error);
