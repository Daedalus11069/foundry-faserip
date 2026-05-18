@echo off
setlocal

set "TARGET=%localappdata%\FoundryVTT\Data\systems\faserip"

if exist "%TARGET%" (
    echo Removing symlink: %TARGET%
    rmdir "%TARGET%"
    echo Symlink removed successfully.
) else (
    echo No symlink found at %TARGET%
)

endlocal