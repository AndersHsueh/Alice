#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './cli/app.js';
import { testAllModels } from './utils/test-model.js';

// 解析命令行参数
const args = process.argv.slice(2);
const skipBanner = args.includes('--no-banner');
const testModel = args.includes('--test-model');

// 如果是测试模式，直接执行测速并退出
if (testModel) {
  testAllModels()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('测速失败:', error);
      process.exit(1);
    });
} else {
  // 渲染应用
  render(<App skipBanner={skipBanner} />);
}
