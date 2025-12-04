$product = Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like '*Pankha*' }
if ($product) {
    Write-Host "Found: $($product.Name)"
    $result = $product.Uninstall()
    Write-Host "Uninstall return code: $($result.ReturnValue)"
} else {
    Write-Host "Product not found"
}
