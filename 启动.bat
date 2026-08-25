@echo off
chcp 65001 >nul
title 装修账本
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
)

if not exist dist (
  echo 正在构建页面（仅首次需要）...
  call npm run build
)

echo 正在启动装修账本...
start "" http://localhost:5174
node server/index.js
pause
