@echo off
echo Installing Pankha Agent with Verbose Logging...
echo Log Path: "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-c\logs\install_full.log"

msiexec /i "bin\x64\Release\PankhaAgent.msi" /l*v "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-c\logs\install_full.log"

if %errorlevel% neq 0 (
    echo Installation failed with error code %errorlevel%
    pause
) else (
    echo Installation completed.
    pause
)
