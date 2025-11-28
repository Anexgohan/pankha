$dllPath = "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-g\FanControlBinV238\NvAPIWrapper.dll"

Write-Host "Loading NvAPIWrapper.dll..."
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)
Write-Host "Assembly Version:" $asm.GetName().Version
Write-Host ""

$typeName = 'NvAPIWrapper.GPU.GPUCoolerInformation'
Write-Host "Looking for $typeName ..."
$type = $asm.GetType($typeName)

if ($type) {
    Write-Host "Found!" -ForegroundColor Green
    Write-Host ""

    Write-Host "All methods on $typeName :"
    $allMethods = $type.GetMethods([System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::Public)

    foreach ($method in $allMethods) {
        $visibility = "private"
        if ($method.IsPublic) { $visibility = "PUBLIC" }
        elseif ($method.IsAssembly) { $visibility = "internal" }

        Write-Host "  [$visibility] $($method.Name)" -ForegroundColor $(if ($method.IsPublic) { 'Green' } else { 'Yellow' })

        if ($method.Name -like '*Cooler*' -or $method.Name -like '*Set*') {
            Write-Host "    Signature: $($method.ToString())" -ForegroundColor Cyan
        }
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Specifically checking SetCoolerSettings:" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    $setCoolerMethods = $allMethods | Where-Object { $_.Name -eq 'SetCoolerSettings' }
    Write-Host "Found $($setCoolerMethods.Count) SetCoolerSettings overload(s):"

    foreach ($method in $setCoolerMethods) {
        Write-Host ""
        Write-Host "  Full Signature: $($method.ToString())" -ForegroundColor White
        Write-Host "    IsPublic: $($method.IsPublic)" -ForegroundColor $(if ($method.IsPublic) { 'Green' } else { 'Red' })
        Write-Host "    IsAssembly (internal): $($method.IsAssembly)" -ForegroundColor $(if ($method.IsAssembly) { 'Yellow' } else { 'Green' })
        Write-Host "    IsPrivate: $($method.IsPrivate)" -ForegroundColor $(if ($method.IsPrivate) { 'Red' } else { 'Green' })

        $params = $method.GetParameters()
        Write-Host "    Parameters: $($params.Count)"
        foreach ($param in $params) {
            Write-Host "      - $($param.ParameterType.Name) $($param.Name)"
        }
    }

} else {
    Write-Host "Type not found!" -ForegroundColor Red
}
