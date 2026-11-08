param(
    [Parameter(Mandatory=$true)]
    [string]$Command
)
$script = $Command + "`nexit`n"
$tmp = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmp, $script, [System.Text.Encoding]::ASCII)
cmd /c "novacom.exe -t open tty:// < `"$tmp`""
Remove-Item $tmp -Force
