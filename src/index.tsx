#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './cli/app.js';
import { parseArgs } from './utils/cliArgs.js';

async function main() {
  const { options: cliOptions, shouldExit } = await parseArgs();

  if (shouldExit) {
    process.exit(0);
  }

  // 渲染应用，传入 CLI 选项
  render(<App skipBanner={cliOptions.skipBanner} cliOptions={cliOptions} />);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
