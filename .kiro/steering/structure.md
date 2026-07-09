---
inclusion: always
---

# TaskVista 项目结构规范

## 推荐目录结构（MVP）
AWS-TaskVista/
├── frontend/                # Vue 3 + Vite 前端项目
│   ├── src/                 # Vue 源码（views、components、stores、api）
│   ├── public/
│   └── package.json
├── backend/                 # Lambda 函数代码（Node.js + TypeScript）
│   └── src/
│       ├── shared/          # 共通モジュール（logger、errors、response）
│       ├── projects/        # Projects Lambda
│       ├── tasks/           # Tasks Lambda
│       ├── comments/        # Comments Lambda
│       ├── attachments/     # Attachments Lambda
│       └── dashboard/       # Dashboard Lambda
├── .kiro/                   # Kiro 配置
│   ├── steering/            # 本目录所有 steering 文件
│   └── specs/               # Spec 文件夹
├── venv/                    # Python 虚拟环境（可选）
└── ...

## text 命名规范
- Vue 组件：PascalCase + View / Component 后缀
- Task ID / Project ID：UUID 或有意义字符串
- DynamoDB 属性：camelCase
- Git Commit：Conventional Commits（feat: / fix: / refactor: 等）