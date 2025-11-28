$packageVersion = "0.8.1.101"
$dllPath = "C:\Users\Anex\.nuget\packages\nvapiwrapper.net\$packageVersion\lib\netstandard2.0\NvAPIWrapper.dll"
Write-Host "Package Version: $packageVersion" -ForegroundColor Cyan
Write-Host "DLL Path: $dllPath" -ForegroundColor Gray

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing CoolerPolicy Enum" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Loading NvAPIWrapper.dll from NuGet..."
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)
Write-Host "Assembly Version:" $asm.GetName().Version
Write-Host ""

$enumTypeName = 'NvAPIWrapper.Native.GPU.CoolerPolicy'
Write-Host "Looking for enum: $enumTypeName" -ForegroundColor Yellow
$enumType = $asm.GetType($enumTypeName)

if ($enumType) {
    Write-Host "✓ Found!" -ForegroundColor Green
    Write-Host ""

    Write-Host "Enum Properties:" -ForegroundColor Cyan
    Write-Host "  IsEnum: $($enumType.IsEnum)"
    Write-Host "  UnderlyingType: $($enumType.GetEnumUnderlyingType().Name)"
    Write-Host ""

    Write-Host "Defined Values:" -ForegroundColor Cyan
    $values = [Enum]::GetValues($enumType)
    $names = [Enum]::GetNames($enumType)

    for ($i = 0; $i -lt $names.Length; $i++) {
        $name = $names[$i]
        $value = [int]$values[$i]
        Write-Host "  $name = $value" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "Testing specific values:" -ForegroundColor Cyan

    # Test if 'Auto' exists
    $hasAuto = [Enum]::IsDefined($enumType, 'Auto')
    Write-Host "  IsDefined('Auto'): $hasAuto" -ForegroundColor $(if ($hasAuto) { 'Green' } else { 'Red' })

    # Test if 'Manual' exists
    $hasManual = [Enum]::IsDefined($enumType, 'Manual')
    Write-Host "  IsDefined('Manual'): $hasManual" -ForegroundColor $(if ($hasManual) { 'Green' } else { 'Red' })

    # Test if value 0 is defined
    $has0 = [Enum]::IsDefined($enumType, 0)
    Write-Host "  IsDefined(0): $has0" -ForegroundColor $(if ($has0) { 'Green' } else { 'Yellow' })

    # Test if value 1 is defined
    $has1 = [Enum]::IsDefined($enumType, 1)
    Write-Host "  IsDefined(1): $has1" -ForegroundColor $(if ($has1) { 'Green' } else { 'Yellow' })

    Write-Host ""
    Write-Host "Casting tests:" -ForegroundColor Cyan

    try {
        $cast0 = [NvAPIWrapper.Native.GPU.CoolerPolicy]0
        Write-Host "  (CoolerPolicy)0 = $cast0" -ForegroundColor Green
    } catch {
        Write-Host "  (CoolerPolicy)0 failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    try {
        $cast1 = [NvAPIWrapper.Native.GPU.CoolerPolicy]1
        Write-Host "  (CoolerPolicy)1 = $cast1" -ForegroundColor Green
    } catch {
        Write-Host "  (CoolerPolicy)1 failed: $($_.Exception.Message)" -ForegroundColor Red
    }

} else {
    Write-Host "✗ Enum type not found!" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
