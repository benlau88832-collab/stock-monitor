@echo off
REM 一键配置并启动 A 股实时监控终端
REM 适用于 Windows 环境：PostgreSQL x64-16、Node.js v24+、npm 11+
REM 执行顺序：检查环境 → 检查 .env → 启动服务器 → 打开浏览器

setlocal enabledelayedexpansion

echo [1/5] 检查 PostgreSQL 服务 (postgresql-x64-16)...
sc query postgresql-x64-16 | findstr /C:"RUNNING" >nul
if %errorlevel% equ 0 (
    echo      [OK] PostgreSQL 服务正在运行
) else (
    echo      [WARN] PostgreSQL 服务未运行（如需数据库功能，请手动启动）
    echo             当前可继续运行（行情模块独立运行不受影响）
)

echo [2/5] 检查 .env 配置...
if exist ".env" (
    echo      [OK] .env 文件存在
    if exist ".env.example" (
        echo      [比较] .env 与 .env.example 内容差异（仅检查 DATABASE_URL 行）
        findstr /C:"DATABASE_URL" .env >nul && echo      [OK] DATABASE_URL 已配置 || echo      [WARN] DATABASE_URL 未在 .env 中找到，请检查
    ) else (
        echo      [INFO] .env.example 不存在（可从远程仓库获取）
    )
) else (
    echo      [创建] 未检测到 .env，正在从 .env.example 复制...
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo      [OK] 已复制 .env.example 到 .env
        echo             请手动编辑 .env 填入真实 DATABASE_URL 和可选 LLM API Key（如需 LLM 功能）
    ) else (
        echo      [ERROR] .env.example 也不存在！无法创建配置。
        echo              请从仓库下载：git clone https://github.com/benlau88832-collab/stock-monitor.git
        echo              并切换分支：git checkout arena/019f9863-stock-monitor
        pause
        exit /b 1
    )
)

echo [3/5] 检查 node_modules...
if exist "node_modules" (
    echo      [OK] node_modules 已存在
) else (
    echo      [安装] 正在执行 npm install...
    call npm install --quiet
    if %errorlevel% neq 0 (
        echo      [ERROR] npm install 失败！请检查网络或 Node 版本（需要 v22+ / v24+）
        pause
        exit /b 1
    )
    echo      [OK] 依赖安装完成
)

echo [4/5] 检查构建状态（可选）...
if exist ".next" (
    echo      [OK] 构建输出 .next 已存在
) else (
    echo      [INFO] 构建输出 .next 不存在，如需构建可执行：npm run build
)

echo [5/5] 启动开发服务器...
echo      正在执行：npm run dev
start cmd /c "npm run dev"

echo [等待] 服务器启动中（通常需要 2-5 秒）...
timeout /t 4 /nobreak >nul

echo [完成] 尝试打开浏览器访问：http://localhost:3000
start http://localhost:3000

echo.
echo ============================================================
echo 当前环境状态：
echo   - PostgreSQL: 已检查（如运行则正常）
echo   - .env 配置: 已检查/已复制
    echo   - node_modules: 已存在/已安装
    echo   - 服务器: npm run dev 已启动
    echo   - 浏览器: 已自动打开 localhost:3000
    echo ============================================================
    echo 提示：
    echo   1. 如需使用 LLM 增强分析，请在 .env 中填入 OPENAI_API_KEY / QWEN_API_KEY / DEEPSEEK_API_KEY
    echo   2. 数据来自东方财富真实接口，如页面显示数据获取失败，可能是网络/沙盒限制（不编造数据）
    echo   3. 所有修改文件已推送到远程：arena/019f9863-stock-monitor
    echo ============================================================
    echo 执行完毕。已停止，不再重复确认。
    pause
