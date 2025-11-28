$dllPath = "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-g\FanControlBinV238\NvAPIWrapper.dll"

Write-Host "Loading NvAPIWrapper.dll..."
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)

Write-Host "Assembly Version:" $asm.GetName().Version
Write-Host ""

Write-Host "Looking for CoolerInformation class..."
$type = $asm.GetType('NvAPIWrapper.GPU.CoolerInformation')

if ($type) {
    Write-Host "Found:" $type.FullName
    Write-Host ""

    Write-Host "Checking for SetCoolerSettings method..."
    $allMethods = $type.GetMethods([System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::Public)
    $setCoolerMethods = $allMethods | Where-Object { $_.Name -eq 'SetCoolerSettings' }

    Write-Host "Found" $setCoolerMethods.Count "SetCoolerSettings method(s):"
    foreach ($method in $setCoolerMethods) {
        Write-Host "  Method:" $method.ToString()
        Write-Host "    IsPublic:" $method.IsPublic
        Write-Host "    IsAssembly:" $method.IsAssembly
        Write-Host "    IsPrivate:" $method.IsPrivate
        Write-Host ""
    }

} else {
    Write-Host "CoolerInformation type not found!"
}
