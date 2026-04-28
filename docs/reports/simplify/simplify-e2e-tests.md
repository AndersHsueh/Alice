/**
 * /simplify 命令 E2E 测试计划
 * 
 * 该文档描述了如何验证 /simplify 命令的功能，包括手动测试步骤和自动化测试框架。
 */

# /simplify 命令端到端测试

## 1. 测试环境准备

### 1.1 启动 daemon
```bash
npm run dev
```

### 1.2 准备测试项目
在任何有 git repository 的目录中进行测试：
```bash
cd /path/to/test/project
git init
# 创建一些代码和修改
echo "function hello() { return 'world'; }" > test.js
git add test.js
git commit -m "initial"
# 修改代码
echo "function hello() { return 'hello world'; }" > test.js
```

## 2. 手动测试步骤

### 2.1 基础流程测试
1. 启动 alice CLI
2. 输入命令：`/simplify`
3. 预期行为：
   - ✓ 显示 Phase 1 进度：检测代码变更
   - ✓ 显示 Phase 2 进度：启动三个审查智能体
   - ✓ 显示 Phase 3 进度：聚合审查结果
   - ✓ 显示最终摘要（变更统计、审查结果、执行时间）

### 2.2 带选项的测试
```
/simplify focus on performance
```
预期：命令接收并存储 focus 选项，在系统提示中使用

### 2.3 无变更的测试
在没有 git diff 的项目中运行：
```
/simplify
```
预期：显示"未检测到代码变更"

## 3. 自动化测试框架（待实现）

### 3.1 单元测试
- [ ] `phase1_identifyChanges()`：测试 git diff 解析
- [ ] `phase2_reviewInParallel()`：测试并发智能体启动
- [ ] `phase3_aggregateAndFix()`：测试问题去重和聚合

### 3.2 集成测试
- [ ] 完整三阶段流程
- [ ] 三个智能体的并发执行
- [ ] 事件流的正确传输

### 3.3 E2E 测试场景
- [ ] 场景 1：简单代码变更
- [ ] 场景 2：多文件变更
- [ ] 场景 3：大型变更（性能测试）

## 4. 验证检查清单

### Phase 1: 识别变更
- [ ] 成功获取 git diff
- [ ] 正确识别变更文件列表
- [ ] 正确统计改动行数
- [ ] 处理边界情况（无 git、无变更等）

### Phase 2: 并发审查
- [ ] 三个智能体同时启动
- [ ] 各智能体接收完整的 diff 上下文
- [ ] 各智能体的输出流式传输
- [ ] 错误恢复（某个智能体失败）

### Phase 3: 聚合修复
- [ ] 问题正确去重（按 location + type）
- [ ] 去重时保留最高严重级别
- [ ] 按严重级别统计
- [ ] 正确区分"已应用"和"建议"修复

## 5. 已知限制（当前阶段）

- [ ] Phase 1：git diff 检测需要连接到工具系统
- [ ] Phase 2：并发智能体执行需要访问 daemon 的 LLMClient 和 AgentLoop
- [ ] Phase 3：修复应用需要实现实际的代码变换

## 6. 后续优化

1. **性能优化**
   - 缓存 diff 内容避免重复计算
   - 实现 token 预算管理
   - 支持大型仓库的分批处理

2. **用户体验**
   - 实现进度条显示
   - 添加修复预览（before/after 对比）
   - 支持交互式修复应用确认

3. **功能扩展**
   - 支持自定义审查规则
   - 支持保存和回顾历史审查报告
   - 集成 git commit 一键应用修复

## 7. 测试数据

### 测试项目 A：小型变更
```
- 1 个文件修改
- 5-10 行改动
- 简单的函数重构
```

### 测试项目 B：中型变更
```
- 3-5 个文件修改
- 50-100 行改动
- 含有重复代码、质量问题、性能问题
```

### 测试项目 C：大型变更
```
- 10+ 个文件修改
- 500+ 行改动
- 含有架构变更
```

---

## 当前实现状态

✅ 命令骨架创建完成（三阶段函数设计）
✅ Build 通过，无编译错误
⚠️ Phase 1 占位符实现（需连接工具系统）
⚠️ Phase 2 占位符实现（需访问 daemon）
⚠️ Phase 3 部分实现（需真实数据）

## 下一步

1. 连接 Phase 1 到工具系统（executeCommand）
2. 连接 Phase 2 到 daemon 的 LLMClient 和 AgentLoop
3. 实现 Phase 3 的完整逻辑（代码修复应用）
4. 编写单元测试和集成测试
5. 手动 E2E 测试验证
