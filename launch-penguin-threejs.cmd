@echo off
setlocal
cd /d "%~dp0"
set "PENGUIN_NODE=C:\Users\kevin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%PENGUIN_NODE%" set "PENGUIN_NODE=node"
echo Penguin Shop - independent Three.js version
echo Open http://127.0.0.1:5178 in your browser.
if exist "dist\index.html" (
  "%PENGUIN_NODE%" "node_modules\vite\bin\vite.js" preview --host 127.0.0.1 --port 5178 --strictPort
) else (
  "%PENGUIN_NODE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5178 --strictPort
)
