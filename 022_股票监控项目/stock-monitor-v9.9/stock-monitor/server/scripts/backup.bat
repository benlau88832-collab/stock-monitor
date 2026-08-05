@echo off
REM ============================================================
REM stock-monitor 数据库每日备份（Windows 计划任务调用）
REM v9.27（P0-2）：不再硬编码密码 —— 委托 node scripts/backup.js
REM 从 server/.env 读取 DATABASE_URL，密码不落盘、不入版本库
REM 建议每日 03:00 执行
REM ============================================================
cd /d "%~dp0.."
node scripts/backup.js
if errorlevel 1 (
  echo 备份失败，请检查 server/.env 与 PostgreSQL 服务
  exit /b 1
)
