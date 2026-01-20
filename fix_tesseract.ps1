# ============================================
# Tesseract OCR Troubleshooting Script
# ============================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Tesseract OCR Diagnostic & Fix" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check common installation paths
$possiblePaths = @(
    "C:\Program Files\Tesseract-OCR",
    "C:\Program Files (x86)\Tesseract-OCR",
    "C:\Tesseract-OCR",
    "${env:ProgramFiles}\Tesseract-OCR",
    "${env:ProgramFiles(x86)}\Tesseract-OCR"
)

Write-Host "[*] Searching for Tesseract installation..." -ForegroundColor Yellow
$installPath = $null

foreach ($path in $possiblePaths) {
    if (Test-Path (Join-Path $path "tesseract.exe")) {
        $installPath = $path
        Write-Host "[+] Found installation: $path" -ForegroundColor Green
        break
    }
}

if (-not $installPath) {
    Write-Host "[!] Tesseract installation not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "[*] Please run install script first: install_tesseract.ps1" -ForegroundColor Cyan
    Write-Host "   or install Tesseract OCR manually" -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit 1
}

# Test Tesseract executable
Write-Host ""
Write-Host "[*] Testing Tesseract executable..." -ForegroundColor Yellow

$tesseractBin = Join-Path $installPath "tesseract.exe"

try {
    $output = & $tesseractBin --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Tesseract runs successfully" -ForegroundColor Green
        Write-Host "   Version: $($output[0])" -ForegroundColor White
    } else {
        throw "Exit code: $LASTEXITCODE"
    }
} catch {
    Write-Host "[!] Tesseract execution failed" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "[*] Attempting repair..." -ForegroundColor Yellow

    # Check DLL dependencies
    Write-Host ""
    Write-Host "[*] Checking Visual C++ Runtime..." -ForegroundColor Yellow

    $vcRedistKeys = @(
        "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
        "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x86"
    )

    $vcInstalled = $false
    foreach ($key in $vcRedistKeys) {
        if (Test-Path $key) {
            $vcInstalled = $true
            Write-Host "[+] Found Visual C++ Runtime" -ForegroundColor Green
            break
        }
    }

    if (-not $vcInstalled) {
        Write-Host "[!] Missing Visual C++ Runtime" -ForegroundColor Red
        Write-Host ""
        Write-Host "[*] Please download and install:" -ForegroundColor Cyan
        Write-Host "   Microsoft Visual C++ 2015-2022 Redistributable (x64)" -ForegroundColor White
        Write-Host "   https://aka.ms/vs/17/release/vc_redist.x64.exe" -ForegroundColor White
        Write-Host ""
    }

    Write-Host "[!] Cannot auto-fix this issue" -ForegroundColor Red
    Write-Host ""
    Write-Host "[*] Possible solutions:" -ForegroundColor Cyan
    Write-Host "   1. Reinstall Tesseract" -ForegroundColor White
    Write-Host "   2. Install Visual C++ 2015-2022 Runtime" -ForegroundColor White
    Write-Host "   3. Run Tesseract in compatibility mode" -ForegroundColor White
    Read-Host "Press Enter to exit"
    exit 1
}

# Check PATH environment variable
Write-Host ""
Write-Host "[*] Checking PATH environment variable..." -ForegroundColor Yellow

$pathEnv = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
$inPath = $pathEnv -split ";" | Where-Object { $_ -eq $installPath }

if ($inPath) {
    Write-Host "[+] Tesseract is in PATH" -ForegroundColor Green
} else {
    Write-Host "[!] Tesseract not in PATH" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[*] Attempting to add to PATH..." -ForegroundColor Yellow

    try {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$installPath", "User")
        Write-Host "[+] Added to user PATH (requires terminal restart)" -ForegroundColor Green
    } catch {
        Write-Host "[!] Failed to add (requires admin privileges)" -ForegroundColor Red
        Write-Host ""
        Write-Host "[*] Manually add to PATH:" -ForegroundColor Cyan
        Write-Host "   $installPath" -ForegroundColor White
    }
}

# Fix Python pytesseract configuration
Write-Host ""
Write-Host "[*] Checking Python configuration..." -ForegroundColor Yellow

$serverDir = Join-Path $PSScriptRoot "english-reader-server\app"
$envExample = Join-Path $serverDir ".env.example"
$envFile = Join-Path $serverDir ".env"

if (Test-Path $envFile) {
    Write-Host "[+] Found configuration file: .env" -ForegroundColor Green

    $envContent = Get-Content $envFile -Raw
    if ($envContent -match 'TESSERACT_CMD') {
        Write-Host "[+] TESSERACT_CMD already configured" -ForegroundColor Green
    } else {
        Write-Host "[!] TESSERACT_CMD not configured" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "[*] Adding configuration to .env file..." -ForegroundColor Yellow

        $newConfig = "`n# Tesseract executable path`nTESSERACT_CMD=$tesseractBin`n"
        Add-Content -Path $envFile -Value $newConfig
        Write-Host "[+] Added TESSERACT_CMD configuration" -ForegroundColor Green
    }
} else {
    Write-Host "[!] .env file not found" -ForegroundColor Yellow
    if (Test-Path $envExample) {
        Write-Host "[*] Copy .env.example to .env" -ForegroundColor Cyan
        Write-Host "   Then add:" -ForegroundColor Cyan
        Write-Host "   TESSERACT_CMD=$tesseractBin" -ForegroundColor White
    }
}

# Fix Python code configuration
Write-Host ""
Write-Host "[*] Fixing Python code configuration..." -ForegroundColor Yellow

$ocrServicePath = Join-Path $serverDir "ocr_service.py"

if (Test-Path $ocrServicePath) {
    $ocrContent = Get-Content $ocrServicePath -Raw

    if ($ocrContent -match 'pytesseract\.pytesseract\.tesseract_cmd') {
        Write-Host "[+] ocr_service.py already has tesseract_cmd configured" -ForegroundColor Green
    } else {
        Write-Host "[!] ocr_service.py missing tesseract_cmd configuration" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "[*] Adding configuration to ocr_service.py..." -ForegroundColor Yellow

        $newImport = "`nimport pytesseract`n"
        $newConfig = "`n# Configure Tesseract executable path`npytesseract.pytesseract.tesseract_cmd = r'$tesseractBin'`n"

        if ($ocrContent -notmatch 'import pytesseract') {
            $ocrContent = $ocrContent.Insert($ocrContent.IndexOf("class OCRService"), $newImport)
        }

        if ($ocrContent -notmatch 'tesseract_cmd') {
            $ocrContent = $ocrContent.Insert($ocrContent.IndexOf("class OCRService"), $newConfig)
        }

        Set-Content -Path $ocrServicePath -Value $ocrContent -Encoding UTF8
        Write-Host "[+] Updated ocr_service.py" -ForegroundColor Green
    }
} else {
    Write-Host "[!] ocr_service.py not found" -ForegroundColor Yellow
}

# Final verification
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Final Verification" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Refresh environment variables
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "[*] Testing command line..." -ForegroundColor Yellow
Start-Sleep -Seconds 1

try {
    $testResult = & $tesseractBin --version 2>&1 | Select-Object -First 1
    Write-Host "[+] Command line test passed" -ForegroundColor Green
    Write-Host "   $testResult" -ForegroundColor White
} catch {
    Write-Host "[!] Command line test failed" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Fix Complete" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[*] Next steps:" -ForegroundColor Green
Write-Host "   1. Close all terminal windows" -ForegroundColor White
Write-Host "   2. Open new terminal" -ForegroundColor White
Write-Host "   3. Run: tesseract --version" -ForegroundColor White
Write-Host "   4. Start English Reader backend" -ForegroundColor White
Write-Host ""
Write-Host "If issues persist, please provide error logs for further assistance." -ForegroundColor Yellow
Write-Host ""

Read-Host "Press Enter to exit"
