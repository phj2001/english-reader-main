# ============================================
# Tesseract OCR Auto Installation Script
# ============================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Tesseract OCR Auto Installer" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check admin privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[!] Recommended to run as Administrator for PATH configuration" -ForegroundColor Yellow
    Write-Host "    If PATH configuration fails, add Tesseract to PATH manually" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to continue (or Ctrl+C to cancel)"
}

# Tesseract configuration
$tesseractVersion = "5.3.3.20231005"
$downloadUrl = "https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.3.3.20231005.exe"
$installerPath = "$env:TEMP\tesseract-installer.exe"
$installPath = "C:\Program Files\Tesseract-OCR"

Write-Host "[*] Preparing to download Tesseract $tesseractVersion ..." -ForegroundColor Green

# Check if already installed
if (Test-Path $installPath) {
    Write-Host "[+] Tesseract already detected at: $installPath" -ForegroundColor Green
    $choice = Read-Host "Reinstall? (Y/N)"
    if ($choice -ne "Y" -and $choice -ne "y") {
        Write-Host "Skipping installation, checking configuration..." -ForegroundColor Yellow
        goto Configure
    }
}

# Download installer
Write-Host "[*] Downloading Tesseract (~50MB)..." -ForegroundColor Yellow
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "[+] Download complete" -ForegroundColor Green
} catch {
    Write-Host "[!] Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "[*] Manual download: $downloadUrl" -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit 1
}

# Install Tesseract
Write-Host ""
Write-Host "[*] Installing Tesseract..." -ForegroundColor Yellow
try {
    $process = Start-Process -FilePath $installerPath -ArgumentList "/S", "/D=$installPath" -Wait -PassThru -NoNewWindow
    Write-Host "[+] Installation complete" -ForegroundColor Green
} catch {
    Write-Host "[!] Installation failed: $_" -ForegroundColor Red
    Write-Host "Please run installer manually: $installerPath" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Cleanup installer
Remove-Item $installerPath -ErrorAction SilentlyContinue

Configure:
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Environment Variables" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Verify installation path
if (-not (Test-Path $installPath)) {
    Write-Host "[!] Tesseract installation directory not found: $installPath" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Add to PATH
$tesseractBin = Join-Path $installPath "tesseract.exe"
$pathEnv = [Environment]::GetEnvironmentVariable("Path", "User")

if ($pathEnv -notlike "*$installPath*") {
    Write-Host "[*] Adding Tesseract to user PATH..." -ForegroundColor Yellow

    if ($isAdmin) {
        [Environment]::SetEnvironmentVariable("Path", "$pathEnv;$installPath", "User")
        Write-Host "[+] Environment variable configured (restart terminal required)" -ForegroundColor Green
    } else {
        Write-Host "[!] Administrator privileges required for PATH configuration" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "[*] Manually add to PATH:" -ForegroundColor Cyan
        Write-Host "   $installPath" -ForegroundColor White
        Write-Host ""
        Write-Host "[*] Steps:" -ForegroundColor Cyan
        Write-Host "   1. Right-click 'This PC' -> Properties -> Advanced system settings" -ForegroundColor White
        Write-Host "   2. Environment Variables -> User variables -> Path -> Edit" -ForegroundColor White
        Write-Host "   3. New -> Enter: $installPath" -ForegroundColor White
        Write-Host "   4. OK and restart terminal" -ForegroundColor White
    }
} else {
    Write-Host "[+] Environment variable already configured" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Verification" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Refresh environment variables
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Start-Sleep -Seconds 2

try {
    $versionOutput = & $tesseractBin --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Tesseract installed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Version:" -ForegroundColor Cyan
        Write-Host $versionOutput[0] -ForegroundColor White
        Write-Host ""
        Write-Host "Installation path: $installPath" -ForegroundColor White
        Write-Host "Executable: $tesseractBin" -ForegroundColor White
    } else {
        throw "Verification failed"
    }
} catch {
    Write-Host "[!] Verification failed, but installation may have succeeded" -ForegroundColor Yellow
    Write-Host "   Restart terminal and run: tesseract --version" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Complete" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[*] Next steps:" -ForegroundColor Green
Write-Host "   1. Close current terminal" -ForegroundColor White
Write-Host "   2. Open new terminal" -ForegroundColor White
Write-Host "   3. Run: tesseract --version" -ForegroundColor White
Write-Host "   4. Start English Reader project" -ForegroundColor White
Write-Host ""
Write-Host "If issues persist, run: fix_tesseract.ps1" -ForegroundColor Yellow
Write-Host ""

Read-Host "Press Enter to exit"
