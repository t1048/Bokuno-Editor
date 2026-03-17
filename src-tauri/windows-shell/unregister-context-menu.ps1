$ErrorActionPreference = 'Stop'

$menuSubKeys = @(
  'Software\Classes\SystemFileAssociations\text\shell\BokunoEditor',
  'Software\Classes\*\shell\BokunoEditor',
  'Software\Classes\Directory\shell\BokunoEditorGrep',
  'Software\Classes\Directory\Background\shell\BokunoEditorGrep',
  'Software\Classes\Drive\shell\BokunoEditorGrep'
)

$menuLabel = 'Bokuno-Editor{0}{1}{2}' -f [char]0x3067, [char]0x958B, [char]0x304F

$removed = @()
$missing = @()
$failed = @()

foreach ($subKey in $menuSubKeys) {
  $displayKey = "HKCU:\$subKey"

  try {
    $existingKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey, $false)
    if ($existingKey) {
      $existingKey.Close()
      [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subKey, $false)
      $removed += $displayKey
    }
    else {
      $missing += $displayKey
    }
  }
  catch {
    $failed += [PSCustomObject]@{
      Key = $displayKey
      Error = $_.Exception.Message
    }
    Write-Host "Failed to remove: $displayKey" -ForegroundColor Red
    Write-Host "Reason: $($_.Exception.Message)" -ForegroundColor Red
  }
}

if ($failed.Count -gt 0) {
  Write-Host "Removed: $($removed.Count) / Failed: $($failed.Count)" -ForegroundColor Red
  throw "Context menu removal failed."
}

if ($removed.Count -gt 0) {
  Write-Host "Context menu entry was removed: $menuLabel" -ForegroundColor Green
  Write-Host "Removed keys: $($removed -join ', ')"
}
if ($missing.Count -gt 0) {
  Write-Host 'No matching registry keys were found.' -ForegroundColor Yellow
  Write-Host "Checked keys: $($missing -join ', ')"
}
