直接给你。设计原则：每条任务都是完整路径，没有歧义空间。

```markdown
# HEARTBEAT

## 全局设置
vault: ~/Documents/WorkVault
interval: 30m
silent_hours: 23:00-08:00

---

## 任务列表

### [DAILY] 日报检查
scan: Projects/*/Daily/
condition: 今日无新文件
action: Diana.remind("{{project}} 今日日报未收到")
priority: medium

### [WEEKLY:FRI] 周报生成
scan: Projects/*/Daily/
condition: 本周有5份以上日报
action:
  - 汇总写入 Projects/{{project}}/Weekly/{{week}}.md
  - Diana.notify("{{project}} 周报已生成")
priority: low

### [ALWAYS] 风险标记巡视
scan: Projects/*/
pattern: "#风险 #未处理"
condition: 标记存在超过72h
action: Diana.push("⚠️ {{project}} 有未处理风险项: {{title}}")
priority: high

### [MONTHLY:LAST_FRI] 月报触发
scan: Projects/*/Weekly/
condition: 本月周报≥3份
action:
  - Diana.notify("月报材料就绪，请确认后生成")
priority: medium

---

## 静默规则
- 所有任务无触发 → HEARTBEAT_OK
- priority:low 在 silent_hours 内 → 延迟到次日08:00
- priority:high 忽略 silent_hours
```

---

核心设计决策说明：

**`condition`是触发门槛，不是任务描述。** Agent只判断"条件是否成立"，成立就走`action`，不成立就跳过。路径完整，无需推断。

**`priority`控制打扰时机，不是重要性排序。** 决定什么时候推Diana、什么时候写文件就好。

**`[ALWAYS]`vs`[DAILY]`vs`[WEEKLY]`** 是任务频率声明，Agent不需要记忆"上次检查是什么时候"——Daemon的cron负责控制触发频率，heartbeat只管"这次触发该做什么"。

---

明天Pro到手，这个schema就是Daemon实现的spec。