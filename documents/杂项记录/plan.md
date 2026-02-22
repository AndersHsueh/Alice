# ALICE CLI MVP 开发计划

## 产品定位
**面向非技术人员的 AI CLI 办公助手**  
专注于文档处理、知识管理、办公自动化

## 技术栈
- Node.js + TypeScript (ESM)
- UI: ink (React for CLI)
- LLM: LM Studio 本地运行 (qwen3-vl-4b-instruct)
- Banner: 粒子聚合效果（方案5）或矩阵雨（方案4）

## MVP 功能范围
✅ 启动 banner 动画  
✅ 基本聊天界面  
✅ LM Studio API 集成  
✅ 系统提示词支持  
✅ 配置管理  
✅ 命令历史记录  
✅ 会话保存  
✅ 流式输出  

## 实施阶段

### Phase 1: 项目初始化 (30分钟)
- package.json + tsconfig.json
- 目录结构搭建
- 依赖安装

### Phase 2: 配置管理 (20分钟)
- ~/.alice/config.json
- ./agents/system_prompt.md
- 配置工具类

### Phase 3: Banner 实现 (45分钟)
- 粒子聚合动画（首选）
- 降级方案：矩阵雨

### Phase 4: 核心组件 (60分钟)
- 入口 + 主应用
- Header, ChatArea, InputBox

### Phase 5: LLM 集成 (45分钟)
- HTTP 客户端
- 流式响应
- 系统提示词

### Phase 6: 交互功能 (40分钟)
- 命令历史
- 会话保存
- 基础命令

### Phase 7: 测试优化 (30分钟)
- 端到端测试
- Bug 修复

**总预计时间:** 约 4-5 小时

## 开发顺序
1. 项目脚手架 → 2. 最小界面 → 3. LLM 连接 → 4. Banner → 5. 交互功能

## 下一步
开始 Phase 1: 项目初始化
