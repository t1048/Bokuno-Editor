$ErrorActionPreference = 'Stop'

$menuKey = 'HKCU:\Software\Classes\SystemFileAssociations\text\shell\BokunoEditor'

if (Test-Path $menuKey) {
  Remove-Item -Path $menuKey -Recurse -Force
  Write-Host '右クリックメニュー「Bokuno-Editorで開く」を削除しました。' -ForegroundColor Green
  Write-Host "削除先: $menuKey"
}
else {
  Write-Host '削除対象のレジストリキーは存在しませんでした。' -ForegroundColor Yellow
  Write-Host "確認先: $menuKey"
}