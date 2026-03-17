$ErrorActionPreference = 'Stop'

Write-Host "Start: $PSCommandPath"
Write-Host "Current: $(Get-Location)"
Write-Host "PSScriptRoot: $PSScriptRoot"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"

$menuSubKeys = @(
  'Software\Classes\SystemFileAssociations\text\shell\BokunoEditor',
  'Software\Classes\*\shell\BokunoEditor'
)

$candidateExePaths = @(
  (Join-Path $PSScriptRoot 'Bokuno-Editor.exe'),
  (Join-Path (Split-Path -Parent $PSScriptRoot) 'Bokuno-Editor.exe')
)

$exePath = $candidateExePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exePath) {
  Write-Host "Bokuno-Editor.exe was not found. Candidates: $($candidateExePaths -join ', ')"
  throw "Bokuno-Editor.exe was not found. Place it in the same folder as this script or one level above."
}
Write-Host "Executable: $exePath"

$menuLabel = 'Bokuno-Editor{0}{1}{2}' -f [char]0x3067, [char]0x958B, [char]0x304F
$commandValue = '"{0}" "%1"' -f $exePath

function Write-Step {
  param([string]$Message)
  $timestamp = Get-Date -Format 'HH:mm:ss.fff'
  Write-Host "[$timestamp] $Message"
}

function Set-RegistryContextMenu {
  param(
    [string]$SubKeyPath,
    [string]$ExecutablePath,
    [string]$CommandValue,
    [string]$MenuLabel
  )

  $menuKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKeyPath)
  if (-not $menuKey) {
    throw "Failed to create registry key: HKCU:\$SubKeyPath"
  }

  try {
    $menuKey.SetValue('', $MenuLabel, [Microsoft.Win32.RegistryValueKind]::String)
    $menuKey.SetValue('Icon', $ExecutablePath, [Microsoft.Win32.RegistryValueKind]::String)

    $commandKey = $menuKey.CreateSubKey('command')
    if (-not $commandKey) {
      throw "Failed to create command subkey: HKCU:\$SubKeyPath\\command"
    }

    try {
      $commandKey.SetValue('', $CommandValue, [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally {
      $commandKey.Close()
    }
  }
  finally {
    $menuKey.Close()
  }
}

$registeredKeys = @()
$failedEntries = @()

foreach ($subKey in $menuSubKeys) {
  $displayKey = "HKCU:\$subKey"
  Write-Step "Target key: $displayKey"

  try {
    Set-RegistryContextMenu -SubKeyPath $subKey -ExecutablePath $exePath -CommandValue $commandValue -MenuLabel $menuLabel
    $registeredKeys += $displayKey
    Write-Step "Registered: $displayKey"
  }
  catch {
    $failedEntries += [PSCustomObject]@{
      Key = $displayKey
      Error = $_.Exception.Message
    }
    Write-Host "Failed: $displayKey" -ForegroundColor Red
    Write-Host "Reason: $($_.Exception.Message)" -ForegroundColor Red
  }
}

if ($failedEntries.Count -gt 0) {
  Write-Host 'Context menu registration failed.' -ForegroundColor Red
  Write-Host "Success: $($registeredKeys.Count) / Failed: $($failedEntries.Count)"
  throw "Context menu registration failed."
}

Write-Host "Context menu entry was registered: $menuLabel" -ForegroundColor Green
Write-Host "Registered keys: $($registeredKeys -join ', ')"
Write-Host "Executable: $exePath"
Write-Host 'Completed.'
