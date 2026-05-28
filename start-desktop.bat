@echo off
setlocal
chcp 65001 >nul
echo [Legado Desktop] Starting in desktop UI mode...

set VITE_APP_UI_MODE=desktop
set VITE_APP_UI_MODE_FORCE=1
set LEGADO_WINDOW_PREVIEW=1
set LEGADO_WINDOW_WIDTH=1200
set LEGADO_WINDOW_HEIGHT=800
set LEGADO_WINDOW_MIN_WIDTH=800
set LEGADO_WINDOW_MIN_HEIGHT=600

call "%~dp0start.bat"
