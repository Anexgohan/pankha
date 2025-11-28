$dllPath = "C:\Users\Anex\.nuget\packages\nvapiwrapper.net\0.8.1.101\lib\netstandard2.0\NvAPIWrapper.dll"

Write-Host "Loading NuGet NvAPIWrapper.dll..."
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)
Write-Host "Assembly Version:" $asm.GetName().Version
Write-Host ""

$typeName = 'NvAPIWrapper.GPU.GPUCoolerInformation'
$type = $asm.GetType($typeName)

if ($type) {
    Write-Host "Found $typeName" -ForegroundColor Green
    Write-Host ""

    Write-Host "Checking SetCoolerSettings..." -ForegroundColor Cyan
    $allMethods = $type.GetMethods([System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::Public)
    $setCoolerMethods = $allMethods | Where-Object { $_.Name -eq 'SetCoolerSettings' }

    Write-Host "Found $($setCoolerMethods.Count) SetCoolerSettings overload(s):"

    foreach ($method in $setCoolerMethods) {
        Write-Host ""
        Write-Host "  Signature: $($method.ToString())"
        Write-Host "    IsPublic: $($method.IsPublic)" -ForegroundColor $(if ($method.IsPublic) { 'Green' } else { 'Red' })
        Write-Host "    IsAssembly (internal): $($method.IsAssembly)" -ForegroundColor $(if ($method.IsAssembly) { 'Yellow' } else { 'Green' })
    }
} else {
    Write-Host "Type not found!" -ForegroundColor Red
}
