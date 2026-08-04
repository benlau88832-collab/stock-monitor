@echo off
REM ============================================================
REM stock-monitor 数据库每日备份脚本（Windows 计划任务调用）
REM 用法：手动执行或加到计划任务（建议每日 03:00）
REM ============================================================
set PGBIN=C:\Program Files (x86)\PostgreSQL\16\bin
set PGPASSWORD=StockMonitor2026
set BACKUP_DIR=E:\CC-HAHA\workspace\022_股票监控项目\backups
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

"%PGBIN%\pg_dump.exe" -U postgres -h 127.0.0.1 -d stock_monitor -F c -f "%BACKUP_DIR%\stock_monitor_%DATE%.dump"

echo 备份完成: %BACKUP_DIR%\stock_monitor_%DATE%.dump
