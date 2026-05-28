@echo off
chcp 65001 >nul
echo [Legado Desktop] Starting development server without proxy...

:: Remove proxy environment variables for this session
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
set http_proxy=
set https_proxy=
set all_proxy=
set NO_PROXY=
set no_proxy=

echo Proxy env vars cleared.
echo.

:: Start Tauri dev mode
cargo tauri dev
