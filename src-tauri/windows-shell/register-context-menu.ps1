$ErrorActionPreference = 'Stop'

$menuKey = 'HKCU:\Software\Classes\SystemFileAssociations\text\shell\BokunoEditor'
$commandKey = Join-Path $menuKey 'command'

$candidateExePaths = @(
  (Join-Path $PSScriptRoot 'Bokuno-Editor.exe'),
  (Join-Path (Split-Path -Parent $PSScriptRoot) 'Bokuno-Editor.exe')
)

$exePath = $candidateExePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exePath) {
  throw "Bokuno-Editor.exe が見つかりません。スクリプトと同じフォルダ、または1つ上のフォルダに配置してください。"
}

New-Item -Path $menuKey -Force | Out-Null
New-ItemProperty -Path $menuKey -Name '(default)' -Value 'Bokuno-Editorで開く' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $menuKey -Name 'Icon' -Value $exePath -PropertyType String -Force | Out-Null

New-Item -Path $commandKey -Force | Out-Null
$commandValue = '"{0}" "%1"' -f $exePath
New-ItemProperty -Path $commandKey -Name '(default)' -Value $commandValue -PropertyType String -Force | Out-Null

Write-Host '右クリックメニュー「Bokuno-Editorで開く」を登録しました。' -ForegroundColor Green
Write-Host "登録先: $menuKey"
Write-Host "実行ファイル: $exePath"