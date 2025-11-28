# Check NvAPIWrapper for SetCoolerSettings method

$dllPath = "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-g\FanControlBinV238\NvAPIWrapper.dll"

Write-Host "Loading NvAPIWrapper.dll..." -ForegroundColor Cyan
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)

Write-Host "Assembly Version: $($asm.GetName().Version)" -ForegroundColor Green
Write-Host ""

Write-Host "Looking for CoolerInformation class..." -ForegroundColor Cyan
$type = $asm.GetType('NvAPIWrapper.GPU.CoolerInformation')

if ($type) {
    Write-Host "Found: $($type.FullName)" -ForegroundColor Green
    Write-Host ""

    Write-Host "Public methods containing 'Cooler':" -ForegroundColor Yellow
    $publicMethods = $type.GetMethods([System.Reflection.BindingFlags]::Public -bor [System.Reflection.BindingFlags]::Instance)
    $coolerMethods = $publicMethods | Where-Object { $_.Name -like '*Cooler*' }

    if ($coolerMethods) {
        foreach ($method in $coolerMethods) {
            Write-Host "  ✓ $($method.ToString())" -ForegroundColor White
        }
    } else {
        Write-Host "  No public methods with 'Cooler' in name" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Checking specifically for SetCoolerSettings..." -ForegroundColor Yellow
    $setCoolerMethod = $type.GetMethod('SetCoolerSettings')

    if ($setCoolerMethod) {
        Write-Host "  ✓ Found: $($setCoolerMethod.ToString())" -ForegroundColor Green
        Write-Host "  IsPublic: $($setCoolerMethod.IsPublic)" -ForegroundColor $(if ($setCoolerMethod.IsPublic) { 'Green' } else { 'Red' })
        Write-Host "  IsAssembly (internal): $($setCoolerMethod.IsAssembly)" -ForegroundColor $(if ($setCoolerMethod.IsAssembly) { 'Red' } else { 'Green' })
    } else {
        Write-Host "  ✗ SetCoolerSettings method not found (might be internal/private)" -ForegroundColor Red

        Write-Host ""
        Write-Host "Checking non-public methods..." -ForegroundColor Yellow
        $allMethods = $type.GetMethods([System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::Public)
        $setCoolerMethods = $allMethods | Where-Object { $_.Name -eq 'SetCoolerSettings' }

        foreach ($method in $setCoolerMethods) {
            Write-Host "  Found (non-public): $($method.ToString())" -ForegroundColor Yellow
            Write-Host "    IsPublic: $($method.IsPublic)" -ForegroundColor Yellow
            Write-Host "    IsAssembly (internal): $($method.IsAssembly)" -ForegroundColor Yellow
            Write-Host "    IsPrivate: $($method.IsPrivate)" -ForegroundColor Yellow
        }
    }

} else {
    Write-Host "CoolerInformation type not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available GPU-related types:" -ForegroundColor Yellow
    $asm.GetTypes() | Where-Object { $_.FullName -like '*GPU*' } | Select-Object -First 20 | ForEach-Object {
        Write-Host "  - $($_.FullName)" -ForegroundColor Gray
    }
}
