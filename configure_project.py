#!/usr/bin/env python3
"""
ALICE GitHub Projects 配置脚本

这个脚本使用 GitHub GraphQL API 来配置 Project 字段选项。

使用方法:
    python3 configure_project.py

注意: GitHub GraphQL API 目前不支持创建单选选项，
      需要手动通过网页界面添加选项。
"""

import json
import subprocess
import sys


GH_PATH = "/opt/homebrew/bin/gh"


def get_auth_token():
    """获取 GitHub 认证 token"""
    result = subprocess.run([GH_PATH, "auth", "token"], capture_output=True, text=True)
    return result.stdout.strip()


def get_project_fields(token):
    """获取 Project 所有字段"""
    query = """
    {
      "query": "{\n      user(login: \"AndersHsueh\") {\n        projectV2(number: 3) {\n          fields(first: 20) {\n            nodes {\n              ... on ProjectV2FieldCommon {\n                name\n              }\n              ... on ProjectV2SingleSelectField {\n                id\n                name\n                options {\n                  id\n                  name\n                }\n              }\n            }\n          }\n        }\n      }\n    }"
    }"""

    result = subprocess.run(
        [GH_PATH, "api", "graphql"],
        input=query,
        capture_output=True,
        text=True,
        env={"GH_TOKEN": token},
    )

    try:
        data = json.loads(result.stdout)
        return (
            data.get("data", {})
            .get("user", {})
            .get("projectV2", {})
            .get("fields", {})
            .get("nodes", [])
        )
    except Exception as e:
        print(f"Error parsing fields: {e}")
        return []


def print_field_options(fields):
    """打印所有字段及其选项"""
    print("\n📋 当前 Project 字段配置:\n")

    for field in fields:
        name = field.get("name", "Unknown")
        print(f"  🔹 {name}")

        if "options" in field:
            for opt in field.get("options", []):
                print(f"     ✅ {opt.get('name', 'Unknown')}")

        print()


def main():
    """主函数"""
    print("🔧 ALICE GitHub Projects 配置工具")
    print("=" * 50)

    # 获取认证
    token = get_auth_token()
    if not token:
        print("❌ 无法获取 GitHub 认证 token")
        print("请先运行: gh auth login")
        sys.exit(1)

    # 获取字段
    fields = get_project_fields(token)
    print_field_options(fields)

    # 打印配置指南
    print("\n" + "=" * 50)
    print("📝 配置指南 (请在网页上完成)")
    print("=" * 50)

    print("""
由于 GitHub API 限制，请手动完成以下配置:

1️⃣ 访问 Project 页面:
   👉 https://github.com/users/AndersHsueh/projects/3

2️⃣ 添加 Priority 选项:
   - 点击 "Priority" 列标题
   - 选择 "Edit field"
   - 添加: 🟡 Medium, 🟢 Low

3️⃣ 添加 Version 选项:
   - 点击 "Version" 列标题
   - 选择 "Edit field"
   - 添加: v0.5.0, v0.6.0, v1.0.0

4️⃣ 添加 Type 选项:
   - 点击 "Type" 列标题
   - 选择 "Edit field"
   - 添加以下所有类型:
     • 模型, 安全, UX, 审计, 调度, 场景, 运维
     • 集成, Mac, Agent, 企业, 商业化, 营销, 文档, 测试

5️⃣ 添加 Source 选项:
   - 点击 "Source" 列标题
   - 选择 "Edit field"
   - 添加: Opus, Qwen, Grok

6️⃣ 创建视图 (可选):
   - 点击 "Views" → "New view"
   - Board 视图: 按 Status 分组
   - Table 视图: 按 Version 分组
   - Roadmap 视图: 按时间线

7️⃣ 设置自动化 (可选):
   - 点击 "Automation" → "Add automation"
   - 配置自动规则
""")

    print("\n✅ 配置完成!")
    print("\n💡 提示: 所有 Issues 已添加到 Project 中，")
    print("   你现在可以直接在 Project 页面拖拽管理 Issues。")


if __name__ == "__main__":
    main()
