$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Bingo Virtual Publico.lnk"
$target = Join-Path $project "INICIAR-BINGO-PUBLICO-OCULTO.vbs"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$target`""
$shortcut.WorkingDirectory = $project
$shortcut.Description = "Inicia Bingo Virtual publico con Cloudflare Tunnel"
$shortcut.Save()
Write-Host "Listo. Bingo Virtual intentara iniciar automaticamente al entrar a Windows."
Write-Host "Acceso directo creado en: $shortcutPath"
Write-Host "Recuerda revisar public-url.txt para ver el enlace publico actual."
