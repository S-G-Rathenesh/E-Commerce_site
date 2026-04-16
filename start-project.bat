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

call :validate_project || exit /b 1
call :detect_tools || exit /b 1
call :ensure_backend_python || exit /b 1
call :ensure_env_files || exit /b 1
call :ensure_env_values || exit /b 1
call :install_backend_deps_if_needed || exit /b 1
call :install_frontend_deps_if_needed || exit /b 1
call :warn_mongo_uri
call :check_mongo_connection || exit /b 1

call :kill_port_listeners 8000 Backend
call :kill_port_listeners 5173 Frontend

echo [INFO] Starting services in new terminals...
start "E-Commerce Backend" /D "%BACKEND_DIR%" cmd /k ""%PY_EXE%" -m uvicorn main:app --reload"
start "E-Commerce Frontend" /D "%FRONTEND_DIR%" cmd /k "npm.cmd run dev"

echo [OK] Backend: http://127.0.0.1:8000
echo [OK] Frontend: http://127.0.0.1:5173
echo [OK] Setup and startup complete.
exit /b 0

:validate_project
if not exist "%BACKEND_DIR%\main.py" (
  echo [ERROR] Backend not found at "%BACKEND_DIR%"
  exit /b 1
)

if not exist "%BACKEND_REQ%" (
  echo [ERROR] Backend requirements.txt not found at "%BACKEND_DIR%"
  exit /b 1
)

if not exist "%FRONTEND_PKG%" (
  echo [ERROR] Frontend package.json not found at "%FRONTEND_DIR%"
  exit /b 1
)

exit /b 0

:detect_tools
where py >nul 2>nul
if %errorlevel%==0 (
  set "BASE_PY_CMD=py"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "BASE_PY_CMD=python"
  ) else (
    echo [ERROR] Python is not installed or not in PATH.
    exit /b 1
  )
)

where npm >nul 2>nul
if not %errorlevel%==0 (
  echo [ERROR] npm is not installed or not in PATH.
  exit /b 1
)

exit /b 0

:ensure_backend_python
if exist "%VENV_PY%" (
  set "PY_EXE=%VENV_PY%"
  echo [OK] Using Python virtual environment at "%VENV_DIR%".
  exit /b 0
)

echo [INFO] Creating project virtual environment...
%BASE_PY_CMD% -m venv "%VENV_DIR%"
if errorlevel 1 (
  echo [ERROR] Failed to create virtual environment at "%VENV_DIR%".
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo [ERROR] Virtual environment was created but python executable was not found.
  exit /b 1
)

set "PY_EXE=%VENV_PY%"
echo [OK] Virtual environment created.
exit /b 0

:ensure_env_files
if not exist "%BACKEND_ENV%" (
  if exist "%BACKEND_DIR%\.env.example" (
    copy /Y "%BACKEND_DIR%\.env.example" "%BACKEND_ENV%" >nul
    echo [INFO] Created backend .env from .env.example
  ) else (
    (
      echo MONGO_URI=
      echo MONGO_DB_NAME=ecommerce
    ) > "%BACKEND_ENV%"
    echo [INFO] Created backend .env with defaults
  )
)

if not exist "%FRONTEND_ENV%" (
  if exist "%FRONTEND_DIR%\.env.example" (
    copy /Y "%FRONTEND_DIR%\.env.example" "%FRONTEND_ENV%" >nul
    echo [INFO] Created frontend .env from .env.example
  ) else (
    > "%FRONTEND_ENV%" echo VITE_API_BASE_URL=http://127.0.0.1:8000
    echo [INFO] Created frontend .env with defaults
  )
)

exit /b 0

:ensure_env_values
findstr /R /C:"^MONGO_URI=" "%BACKEND_ENV%" >nul
if errorlevel 1 (
  >> "%BACKEND_ENV%" echo MONGO_URI=mongodb://127.0.0.1:27017
  echo [INFO] Added default local MONGO_URI to backend .env
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$path='%BACKEND_ENV%';" ^
  "$key='MONGO_URI';" ^
  "$value='mongodb://127.0.0.1:27017';" ^
  "$lines=@(); if (Test-Path -LiteralPath $path) { $lines=Get-Content -LiteralPath $path };" ^
  "$out=@();" ^
  "foreach ($line in $lines) {" ^
  "  if ($line -match ('^' + [regex]::Escape($key) + '=')) {" ^
  "    if ($line -match ('^' + [regex]::Escape($key) + '=$')) { $out += ($key + '=' + $value) } else { $out += $line }" ^
  "  } else {" ^
  "    $out += $line" ^
  "  }" ^
  "}" ^
  "Set-Content -LiteralPath $path -Value $out"

if errorlevel 1 (
  echo [ERROR] Failed to normalize MONGO_URI in backend .env.
  exit /b 1
)

findstr /R /C:"^MONGO_DB_NAME=" "%BACKEND_ENV%" >nul
if errorlevel 1 (
  >> "%BACKEND_ENV%" echo MONGO_DB_NAME=ecommerce
  echo [INFO] Added MONGO_DB_NAME to backend .env
)

findstr /R /C:"^MONGO_ENABLE_FALLBACK=" "%BACKEND_ENV%" >nul
if errorlevel 1 (
  >> "%BACKEND_ENV%" echo MONGO_ENABLE_FALLBACK=true
  echo [INFO] Added MONGO_ENABLE_FALLBACK=true to backend .env
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$path='%FRONTEND_ENV%';" ^
  "$key='VITE_API_BASE_URL';" ^
  "$value='http://127.0.0.1:8000';" ^
  "$lines=@(); if (Test-Path -LiteralPath $path) { $lines=Get-Content -LiteralPath $path };" ^
  "$found=$false; $out=@();" ^
  "foreach ($line in $lines) {" ^
  "  if ($line -match ('^' + [regex]::Escape($key) + '=')) {" ^
  "    if (-not $found) { $out += ($key + '=' + $value); $found=$true }" ^
  "  } else {" ^
  "    $out += $line" ^
  "  }" ^
  "}" ^
  "if (-not $found) { $out += ($key + '=' + $value) };" ^
  "Set-Content -LiteralPath $path -Value $out"

if errorlevel 1 (
  echo [ERROR] Failed to ensure VITE_API_BASE_URL in frontend .env.
  exit /b 1
)

exit /b 0

:install_backend_deps_if_needed
call :is_stamp_current "%BACKEND_REQ%" "%BACKEND_STAMP%"
if errorlevel 1 (
  echo [INFO] Installing backend dependencies...
  pushd "%BACKEND_DIR%"
  "%PY_EXE%" -m pip install -r requirements.txt
  if errorlevel 1 (
    popd
    echo [ERROR] Failed to install backend dependencies.
    exit /b 1
  )
  popd
  type nul > "%BACKEND_STAMP%"
  echo [OK] Backend dependencies installed.
) else (
  echo [OK] Backend dependencies already up to date.
)

exit /b 0

:install_frontend_deps_if_needed
set "INSTALL_FRONTEND_DEPS=0"

if not exist "%FRONTEND_DIR%\node_modules" (
  set "INSTALL_FRONTEND_DEPS=1"
)

call :is_stamp_current "%FRONTEND_PKG%" "%FRONTEND_STAMP%"
if errorlevel 1 (
  set "INSTALL_FRONTEND_DEPS=1"
)

if exist "%FRONTEND_LOCK%" (
  call :is_stamp_current "%FRONTEND_LOCK%" "%FRONTEND_STAMP%"
  if errorlevel 1 (
    set "INSTALL_FRONTEND_DEPS=1"
  )
)

if "%INSTALL_FRONTEND_DEPS%"=="0" (
  pushd "%FRONTEND_DIR%"
  call npm.cmd ls --depth=0 >nul 2>nul
  if errorlevel 1 (
    set "INSTALL_FRONTEND_DEPS=1"
  )
  popd
)

if "%INSTALL_FRONTEND_DEPS%"=="1" (
  echo [INFO] Installing frontend dependencies...
  pushd "%FRONTEND_DIR%"
  call npm.cmd install
  if errorlevel 1 (
    popd
    echo [ERROR] Failed to install frontend dependencies.
    exit /b 1
  )
  popd
  type nul > "%FRONTEND_STAMP%"
  echo [OK] Frontend dependencies installed.
) else (
  echo [OK] Frontend dependencies already up to date.
)

exit /b 0

:warn_mongo_uri
findstr /R /C:"^MONGO_URI=." "%BACKEND_ENV%" >nul
if errorlevel 1 (
  echo [WARN] MONGO_URI is missing or empty in backend .env. Backend may fail to start.
  exit /b 0
)

findstr /R /C:"^MONGO_URI=.*<.*>.*" "%BACKEND_ENV%" >nul
if not errorlevel 1 (
  echo [WARN] MONGO_URI appears to contain placeholder values. Backend may fail to start.
  exit /b 0
)

findstr /I /C:"cluster0.example.mongodb.net" "%BACKEND_ENV%" >nul
if not errorlevel 1 (
  echo [WARN] MONGO_URI appears to use example host values. Backend may fail to start.
)

exit /b 0

:check_mongo_connection
echo [INFO] Checking MongoDB connectivity...
set "ALLOW_FALLBACK=0"
findstr /I /R /C:"^MONGO_ENABLE_FALLBACK=true" "%BACKEND_ENV%" >nul
if not errorlevel 1 set "ALLOW_FALLBACK=1"
findstr /I /R /C:"^MONGO_ENABLE_FALLBACK=1" "%BACKEND_ENV%" >nul
if not errorlevel 1 set "ALLOW_FALLBACK=1"

pushd "%BACKEND_DIR%"
"%PY_EXE%" -c "from dotenv import load_dotenv; import os; from pymongo import MongoClient; load_dotenv(); uri=os.getenv('MONGO_URI','').strip(); db=os.getenv('MONGO_DB_NAME','ecommerce').strip() or 'ecommerce'; allow=os.getenv('MONGO_TLS_ALLOW_INVALID_CERTS','').strip().lower() in {'1','true','yes','on'}; kw={'serverSelectionTimeoutMS':12000}; kw.update({'tlsAllowInvalidCertificates':True} if allow else {}); client=MongoClient(uri, **kw); client[db].command('ping')" >nul 2>nul
set "MONGO_CHECK_EXIT=%errorlevel%"
popd

if not "%MONGO_CHECK_EXIT%"=="0" (
  if "%ALLOW_FALLBACK%"=="1" (
    echo [WARN] MongoDB connection failed, but fallback mode is enabled.
    echo [WARN] Backend will start in in-memory mode.
    exit /b 0
  )

  echo [ERROR] MongoDB connection failed. Backend startup aborted.
  echo [HINT] Verify MONGO_URI in backend/.env and your network access to MongoDB Atlas.
  echo [HINT] If needed for local testing, use: MONGO_URI=mongodb://127.0.0.1:27017
  echo [HINT] You can also try setting MONGO_TLS_ALLOW_INVALID_CERTS=true in backend/.env.
  echo [HINT] Or enable in-memory mode: MONGO_ENABLE_FALLBACK=true in backend/.env.
  exit /b 1
)

echo [OK] MongoDB connectivity check passed.
exit /b 0

:is_stamp_current
if not exist "%~1" exit /b 1
if not exist "%~2" exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src=Get-Item -LiteralPath '%~1';" ^
  "$stamp=Get-Item -LiteralPath '%~2';" ^
  "if ($src.LastWriteTimeUtc -le $stamp.LastWriteTimeUtc) { exit 0 } else { exit 1 }"

if errorlevel 1 exit /b 1
exit /b 0

:kill_port_listeners
set "TARGET_PORT=%~1"
set "SERVICE_NAME=%~2"
set "FOUND_PID="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  set "FOUND_PID=%%P"
  echo [INFO] %SERVICE_NAME% port %TARGET_PORT% is in use by PID %%P. Stopping it...
  taskkill /PID %%P /F >nul 2>nul
)

if defined FOUND_PID (
  echo [OK] Cleared existing process on port %TARGET_PORT%.
) else (
  echo [OK] Port %TARGET_PORT% is free.
)

exit /b 0
