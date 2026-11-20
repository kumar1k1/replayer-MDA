# МОНИТОР.ps1 - каждые 30 секунд: загрузка процессора, память, температура (если Windows её отдаёт).
# Если память выше 97% или температура выше 90 °C - звук и окно с предупреждением.
$host.UI.RawUI.WindowTitle = "Монитор компьютера"
$warnMem = 97; $warnTemp = 90; $lastWarn = (Get-Date).AddHours(-1)
function Get-TempC {
  try {
    $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
    if ($z) { return [math]::Round((($z | Measure-Object CurrentTemperature -Maximum).Maximum / 10) - 273.15) }
  } catch {}
  return $null
}
Add-Type -AssemblyName System.Windows.Forms
Write-Host "Монитор запущен. Окно можно свернуть. Предупреждение - если память выше $warnMem% или температура выше $warnTemp C."
$t0 = Get-TempC
if ($t0 -eq $null) { Write-Host "Температуру Windows не отдаёт (часто так без прав администратора или на этой плате). Слежу за процессором и памятью." }
while ($true) {
  $os = Get-CimInstance Win32_OperatingSystem
  $mem = [math]::Round(100 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize * 100)
  $cpu = [math]::Round((Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average)
  $t = Get-TempC
  $ts = if ($t -ne $null) { "$t C" } else { "нет данных" }
  Write-Host ("{0}  процессор {1}%  память {2}%  температура {3}" -f (Get-Date -Format "HH:mm:ss"), $cpu, $mem, $ts)
  $bad = @()
  if ($mem -ge $warnMem) { $bad += "память занята на $mem%" }
  if ($t -ne $null -and $t -ge $warnTemp) { $bad += "температура $t C" }
  if ($bad.Count -gt 0 -and ((Get-Date) - $lastWarn).TotalMinutes -ge 5) {
    $lastWarn = Get-Date
    [console]::Beep(1000, 600); [console]::Beep(800, 600)
    [System.Windows.Forms.MessageBox]::Show("Внимание: " + ($bad -join ", ") + ".`nЕсли держится долго - закройте окно загрузки и запустите её снова в режиме ф (фон).", "Монитор компьютера") | Out-Null
  }
  Start-Sleep -Seconds 30
}
