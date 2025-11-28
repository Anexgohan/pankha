$dllPath = "D:\Cache temp\temp\pankha-fan-control\dev\pankha-dev\agents\clients\windows\varient-g\FanControlBinV238\NvAPIWrapper.dll"

Write-Host "Loading NvAPIWrapper.dll..."
$asm = [System.Reflection.Assembly]::LoadFile($dllPath)

Write-Host "Assembly Version:" $asm.GetName().Version
Write-Host ""

Write-Host "All types in assembly (first 50):"
$asm.GetTypes() | Select-Object -First 50 | ForEach-Object {
    Write-Host "  -" $_.FullName
}

Write-Host ""
Write-Host "Types containing 'Cooler':"
$asm.GetTypes() | Where-Object { $_.FullName -like '*Cooler*' } | ForEach-Object {
    Write-Host "  -" $_.FullName
}

Write-Host ""
Write-Host "Types containing 'GPU':"
$asm.GetTypes() | Where-Object { $_.FullName -like '*GPU*' } | Select-Object -First 20 | ForEach-Object {
    Write-Host "  -" $_.FullName
}
