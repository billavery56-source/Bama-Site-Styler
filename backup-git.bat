@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
title Bama Site Styler Git Backup

echo.
echo ==========================================
echo      Bama Site Styler - Git Backup
echo ==========================================
echo Folder: %cd%
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or not in PATH.
  echo Install Git and try again.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo ERROR: This folder is not a Git repository.
  echo.
  echo Run these commands once in this folder:
  echo   git init
  echo   git remote add origin YOUR_REPO_URL
  echo.
  pause
  exit /b 1
)

for /f %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%i
if not defined BRANCH (
  echo ERROR: Could not determine current branch.
  echo.
  pause
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format ''yyyy-MM-dd HH:mm:ss''"') do set DTS=%%i

echo Checking for changes...
git status --porcelain > "%temp%\bss_git_status.txt"

set HASCHANGES=0
for /f %%i in (%temp%\bss_git_status.txt) do set HASCHANGES=1

if "!HASCHANGES!"=="0" (
  echo No changes to back up.
  del "%temp%\bss_git_status.txt" >nul 2>nul
  echo.
  pause
  exit /b 0
)

del "%temp%\bss_git_status.txt" >nul 2>nul

echo.
echo Adding files...
git add -A
if errorlevel 1 (
  echo ERROR: git add failed.
  echo.
  pause
  exit /b 1
)

set MSG=Backup %DTS%
echo Creating commit: %MSG%
git commit -m "%MSG%"
if errorlevel 1 (
  echo ERROR: git commit failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Pushing to origin/%BRANCH% ...
git push origin %BRANCH%
if errorlevel 1 (
  echo ERROR: git push failed.
  echo.
  echo If this is the first push for this branch, run:
  echo   git push -u origin %BRANCH%
  echo.
  pause
  exit /b 1
)

echo.
echo Backup complete.
echo.
pause
endlocal