$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Bingo Virtual Publico.lnk"
if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Arranque automatico quitado."
} else {
  Write-Host "No se encontro el acceso directo de arranque automatico."
}
