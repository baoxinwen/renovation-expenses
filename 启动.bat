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
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
)

rem 源码比构建产物新时自动重建（改过代码后无需手动 npm run build）
set REBUILD=0
if not exist dist\index.html set REBUILD=1
if "%REBUILD%"=="0" (
  powershell -NoProfile -Command "$d=(Get-Item 'dist\index.html').LastWriteTime; if (Get-ChildItem -Recurse -File 'client\src' | Where-Object { $_.LastWriteTime -gt $d }) { exit 1 } else { exit 0 }"
  if errorlevel 1 set REBUILD=1
)
if "%REBUILD%"=="1" (
  echo 检测到页面源码有更新，正在重新构建...
  call npm run build
  if errorlevel 1 (
    echo [错误] 页面构建失败，请把上方报错反馈给开发者
    pause
    exit /b 1
  )
)

echo 正在启动装修账本...
rem 延迟 2 秒再打开浏览器，等接口就绪
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:5174"
node server/index.js
echo.
echo 账本已退出。若非主动关闭，请把上方报错反馈给开发者。
pause
