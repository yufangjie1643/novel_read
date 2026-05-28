@echo off
setlocal
chcp 65001 >nul
echo [Legado Desktop] Starting in mobile UI mode at 390x844 phone preview...

set VITE_APP_UI_MODE=mobile
set VITE_APP_UI_MODE_FORCE=1
set LEGADO_WINDOW_PREVIEW=1
set LEGADO_WINDOW_WIDTH=390
set LEGADO_WINDOW_HEIGHT=844
set LEGADO_WINDOW_MIN_WIDTH=360
set LEGADO_WINDOW_MIN_HEIGHT=640

call "%~dp0start.bat"
