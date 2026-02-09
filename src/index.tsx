#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './cli/app.js';

// 解析命令行参数
const args = process.argv.slice(2);
const skipBanner = args.includes('--no-banner');

// 渲染应用
render(<App skipBanner={skipBanner} />);
