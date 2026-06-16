@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "BACKEND_ENV=%BACKEND_DIR%\.env"
set "FRONTEND_ENV=%FRONTEND_DIR%\.env"
set "BACKEND_REQ=%BACKEND_DIR%\requirements.txt"
set "FRONTEND_PKG=%FRONTEND_DIR%\package.json"
set "FRONTEND_LOCK=%FRONTEND_DIR%\package-lock.json"
set "BACKEND_STAMP=%BACKEND_DIR%\.deps-installed.stamp"
set "FRONTEND_STAMP=%FRONTEND_DIR%\.deps-installed.stamp"
set "VENV_DIR=%ROOT_DIR%.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

call :validate_project    || exit /b 1
call :detect_tools        || exit /b 1
call :ensure_backend_python || exit /b 1
call :ensure_env_files    || exit /b 1
call :ensure_env_values   || exit /b 1
call :install_backend_deps_if_needed  || exit /b 1
call :install_frontend_deps_if_needed || exit /b 1
call :warn_mongo_uri
call :check_mongo_connection || exit /b 1

call :kill_port_listeners 8000 Backend
call :kill_port_listeners 5173 Frontend

echo [INFO] Starting services in new terminals...
start "E-Commerce Backend"  /D "%BACKEND_DIR%"  cmd /k ""%PY_EXE%" -m uvicorn main:app --reload"
start "E-Commerce Frontend" /D "%FRONTEND_DIR%" cmd /k "npm.cmd run dev"

echo [OK] Backend:  http://127.0.0.1:8000
echo [OK] Frontend: http://127.0.0.1:5173
echo [OK] Setup and startup complete.
exit /b 0

rem ============================================================
:validate_project
if not exist "%BACKEND_DIR%\main.py" (
  echo [ERROR] Backend not found at "%BACKEND_DIR%"
  exit /b 1
)
if not exist "%BACKEND_REQ%" (
  echo [ERROR] Backend requirements.txt not found.
  exit /b 1
)
if not exist "%FRONTEND_PKG%" (
  echo [ERROR] Frontend package.json not found.
  exit /b 1
)
exit /b 0

rem ============================================================
:detect_tools
set "BASE_PY_CMD="

where py >nul 2>nul
if %errorlevel%==0 ( set "BASE_PY_CMD=py" & goto :detect_tools_py_found )

where python >nul 2>nul
if %errorlevel%==0 ( set "BASE_PY_CMD=python" & goto :detect_tools_py_found )

where python3 >nul 2>nul
if %errorlevel%==0 ( set "BASE_PY_CMD=python3" & goto :detect_tools_py_found )

rem --- Windows Store / AppData Python fallback ---
for /f "delims=" %%P in ('dir /b /s "%LOCALAPPDATA%\Microsoft\WindowsApps\python*.exe" 2^>nul') do (
  if not defined BASE_PY_CMD set "BASE_PY_CMD=%%P"
)

rem --- Search common install locations ---
if not defined BASE_PY_CMD (
  for %%D in (
    "%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe"
    "%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe"
    "%USERPROFILE%\AppData\Local\Programs\Python\Python310\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
  ) do (
    if not defined BASE_PY_CMD (
      if exist %%D set "BASE_PY_CMD=%%~D"
    )
  )
)

if not defined BASE_PY_CMD (
  echo [ERROR] Python is not installed or not in PATH.
  echo [HINT]  Install Python from https://python.org or the Microsoft Store.
  exit /b 1
)

:detect_tools_py_found
echo [OK] Found Python: %BASE_PY_CMD%

where npm >nul 2>nul
if not %errorlevel%==0 (
  echo [ERROR] npm is not installed or not in PATH.
  exit /b 1
)
exit /b 0

rem ============================================================
:ensure_backend_python
if exist "%VENV_PY%" (
  set "PY_EXE=%VENV_PY%"
  echo [OK] Using existing virtual environment.
  exit /b 0
)
echo [INFO] Creating project virtual environment...
%BASE_PY_CMD% -m venv "%VENV_DIR%"
if errorlevel 1 (
  echo [ERROR] Failed to create virtual environment.
  exit /b 1
)
if not exist "%VENV_PY%" (
  echo [ERROR] Virtual environment created but python.exe not found.
  exit /b 1
)
set "PY_EXE=%VENV_PY%"
echo [OK] Virtual environment created.
exit /b 0

rem ============================================================
:ensure_env_files
if not exist "%BACKEND_ENV%" (
  if exist "%BACKEND_DIR%\.env.example" (
    copy /Y "%BACKEND_DIR%\.env.example" "%BACKEND_ENV%" >nul
    echo [INFO] Created backend .env from .env.example
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "Set-Content -LiteralPath '%BACKEND_ENV%' -Value @('MONGO_URI=','MONGO_DB_NAME=ecommerce','MONGO_ENABLE_FALLBACK=true')"
    echo [INFO] Created backend .env with defaults
  )
)
if not exist "%FRONTEND_ENV%" (
  if exist "%FRONTEND_DIR%\.env.example" (
    copy /Y "%FRONTEND_DIR%\.env.example" "%FRONTEND_ENV%" >nul
    echo [INFO] Created frontend .env from .env.example
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "Set-Content -LiteralPath '%FRONTEND_ENV%' -Value 'VITE_API_BASE_URL=http://127.0.0.1:8000'"
    echo [INFO] Created frontend .env with defaults
  )
)
exit /b 0

rem ============================================================
:ensure_env_values
rem -- Use PowerShell for all .env reads/writes to handle Unicode paths --

rem -- Ensure MONGO_URI key exists in backend .env --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; if(-not($lines -match '^MONGO_URI=')){$lines+='MONGO_URI=mongodb://127.0.0.1:27017'; Set-Content -LiteralPath $p -Value $lines; Write-Host '[INFO] Added default MONGO_URI to backend .env'}"
if errorlevel 1 ( echo [ERROR] Failed to update backend .env & exit /b 1 )

rem -- Ensure MONGO_URI is not blank (fill default if empty value) --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; $lines=Get-Content -LiteralPath $p; $out=@(); foreach($l in $lines){ if($l -match '^MONGO_URI=$'){ $out+='MONGO_URI=mongodb://127.0.0.1:27017' }else{ $out+=$l } }; Set-Content -LiteralPath $p -Value $out"
if errorlevel 1 ( echo [ERROR] Failed to normalize MONGO_URI & exit /b 1 )

rem -- Ensure MONGO_DB_NAME --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; if(-not($lines -match '^MONGO_DB_NAME=')){$lines+='MONGO_DB_NAME=ecommerce'; Set-Content -LiteralPath $p -Value $lines; Write-Host '[INFO] Added MONGO_DB_NAME to backend .env'}"
if errorlevel 1 ( echo [ERROR] Failed to update MONGO_DB_NAME & exit /b 1 )

rem -- Ensure MONGO_ENABLE_FALLBACK --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; if(-not($lines -match '^MONGO_ENABLE_FALLBACK=')){$lines+='MONGO_ENABLE_FALLBACK=true'; Set-Content -LiteralPath $p -Value $lines; Write-Host '[INFO] Added MONGO_ENABLE_FALLBACK to backend .env'}"
if errorlevel 1 ( echo [ERROR] Failed to update MONGO_ENABLE_FALLBACK & exit /b 1 )

rem -- Ensure VITE_API_BASE_URL in frontend .env --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%FRONTEND_ENV%'; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; if(-not($lines -match '^VITE_API_BASE_URL=')){$lines+='VITE_API_BASE_URL=http://127.0.0.1:8000'; Set-Content -LiteralPath $p -Value $lines; Write-Host '[INFO] Added VITE_API_BASE_URL to frontend .env'}"
if errorlevel 1 ( echo [ERROR] Failed to update frontend .env & exit /b 1 )

exit /b 0

rem ============================================================
:install_backend_deps_if_needed
call :is_stamp_current "%BACKEND_REQ%" "%BACKEND_STAMP%"
if errorlevel 1 (
  echo [INFO] Installing backend dependencies...
  pushd "%BACKEND_DIR%"
  "%PY_EXE%" -m pip install -r requirements.txt
  if errorlevel 1 ( popd & echo [ERROR] Failed to install backend dependencies. & exit /b 1 )
  popd
  type nul > "%BACKEND_STAMP%"
  echo [OK] Backend dependencies installed.
) else (
  echo [OK] Backend dependencies already up to date.
)
exit /b 0

rem ============================================================
:install_frontend_deps_if_needed
set "INSTALL_FRONTEND_DEPS=0"

if not exist "%FRONTEND_DIR%\node_modules" set "INSTALL_FRONTEND_DEPS=1"

call :is_stamp_current "%FRONTEND_PKG%" "%FRONTEND_STAMP%"
if errorlevel 1 set "INSTALL_FRONTEND_DEPS=1"

if exist "%FRONTEND_LOCK%" (
  call :is_stamp_current "%FRONTEND_LOCK%" "%FRONTEND_STAMP%"
  if errorlevel 1 set "INSTALL_FRONTEND_DEPS=1"
)

if "%INSTALL_FRONTEND_DEPS%"=="0" (
  pushd "%FRONTEND_DIR%"
  call npm.cmd ls --depth=0 >nul 2>nul
  if errorlevel 1 set "INSTALL_FRONTEND_DEPS=1"
  popd
)

if "%INSTALL_FRONTEND_DEPS%"=="1" (
  echo [INFO] Installing frontend dependencies...
  pushd "%FRONTEND_DIR%"
  call npm.cmd install
  if errorlevel 1 ( popd & echo [ERROR] Failed to install frontend dependencies. & exit /b 1 )
  popd
  type nul > "%FRONTEND_STAMP%"
  echo [OK] Frontend dependencies installed.
) else (
  echo [OK] Frontend dependencies already up to date.
)
exit /b 0

rem ============================================================
:warn_mongo_uri
rem Use PowerShell to read .env safely (handles Unicode paths)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; if(-not(Test-Path -LiteralPath $p)){exit 1}; $v=(Get-Content -LiteralPath $p | Where-Object {$_ -match '^MONGO_URI=(.+)$'} | Select-Object -First 1); if(-not $v){exit 1}; $val=$v -replace '^MONGO_URI=',''; if([string]::IsNullOrWhiteSpace($val)){exit 1}; if($val -match '<|>|cluster0\.example\.mongodb\.net'){exit 2}; exit 0" >nul 2>nul
set "URI_CHECK=%errorlevel%"

if "%URI_CHECK%"=="1" (
  echo [WARN] MONGO_URI is missing or empty in backend .env. Backend may fail to start.
)
if "%URI_CHECK%"=="2" (
  echo [WARN] MONGO_URI appears to contain placeholder values. Backend may fail to start.
)
exit /b 0

rem ============================================================
:check_mongo_connection
echo [INFO] Checking MongoDB connectivity...

rem Check if fallback is enabled via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BACKEND_ENV%'; $lines=@(); if(Test-Path -LiteralPath $p){$lines=Get-Content -LiteralPath $p}; $fb=$lines | Where-Object {$_ -match '^MONGO_ENABLE_FALLBACK=(true|1|yes|on)$'}; if($fb){exit 0}else{exit 1}" >nul 2>nul
if %errorlevel%==0 ( set "ALLOW_FALLBACK=1" ) else ( set "ALLOW_FALLBACK=0" )

pushd "%BACKEND_DIR%"
"%PY_EXE%" -c "from dotenv import load_dotenv; import os; from pymongo import MongoClient; load_dotenv(); uri=os.getenv('MONGO_URI','').strip(); db=os.getenv('MONGO_DB_NAME','ecommerce').strip() or 'ecommerce'; allow=os.getenv('MONGO_TLS_ALLOW_INVALID_CERTS','').strip().lower() in {'1','true','yes','on'}; kw={'serverSelectionTimeoutMS':12000}; kw.update({'tlsAllowInvalidCertificates':True} if allow else {}); MongoClient(uri, **kw)[db].command('ping')" >nul 2>nul
set "MONGO_CHECK_EXIT=%errorlevel%"
popd

if not "%MONGO_CHECK_EXIT%"=="0" (
  if "%ALLOW_FALLBACK%"=="1" (
    echo [WARN] MongoDB connection failed - fallback in-memory mode enabled.
    exit /b 0
  )
  echo [ERROR] MongoDB connection failed. Backend startup aborted.
  echo [HINT]  Verify MONGO_URI in backend\.env and your network access.
  echo [HINT]  Or set MONGO_ENABLE_FALLBACK=true in backend\.env for local testing.
  exit /b 1
)

echo [OK] MongoDB connectivity check passed.
exit /b 0

rem ============================================================
:is_stamp_current
if not exist "%~1" exit /b 1
if not exist "%~2" exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src=Get-Item -LiteralPath '%~1'; $stamp=Get-Item -LiteralPath '%~2'; if($src.LastWriteTimeUtc -le $stamp.LastWriteTimeUtc){exit 0}else{exit 1}"
if errorlevel 1 exit /b 1
exit /b 0

rem ============================================================
:kill_port_listeners
set "TARGET_PORT=%~1"
set "SERVICE_NAME=%~2"
set "FOUND_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  set "FOUND_PID=%%P"
  echo [INFO] %SERVICE_NAME% port %TARGET_PORT% in use by PID %%P. Stopping...
  taskkill /PID %%P /F >nul 2>nul
)
if defined FOUND_PID (
  echo [OK] Cleared existing process on port %TARGET_PORT%.
) else (
  echo [OK] Port %TARGET_PORT% is free.
)
exit /b 0
