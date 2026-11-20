param(
    [string]$Game = 'C:\Program Files (x86)\Steam\steamapps\common\A Township Tale'
)
$ErrorActionPreference = 'Stop'

$mgd = Join-Path $Game 'A Township Tale_Data\Managed'
$ml = Join-Path $Game 'MelonLoader\net35'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here 'bin'
$client = Join-Path $here 'client'

if (-not (Test-Path $csc)) { throw "The C# compiler was not found at $csc" }
if (-not (Test-Path $mgd)) { throw "The game was not found. Run: .\build.ps1 -Game 'C:\path\to\A Township Tale'" }
if (-not (Test-Path (Join-Path $ml 'MelonLoader.dll'))) { throw "MelonLoader was not found in $ml. Install TavernLauncher's server files first." }

$refs = @()
Get-ChildItem (Join-Path $mgd '*.dll') | ForEach-Object { $refs += "/r:$($_.FullName)" }
$refs += "/r:$(Join-Path $ml 'MelonLoader.dll')"
$refs += "/r:$(Join-Path $ml '0Harmony.dll')"
New-Item -ItemType Directory -Force $bin | Out-Null

function Build($name, $src, $extra) {
    $out = Join-Path $bin $name
    & $csc /target:library /nostdlib+ /noconfig /warn:4 /warnaserror+ /nologo "/out:$out" $refs $extra $src
    if ($LASTEXITCODE -ne 0) { throw "The build of $name failed ($LASTEXITCODE)" }
    $dll = Get-Item $out
    Write-Host ("Built {0}  {1} bytes  sha256 {2}" -f $dll.FullName, $dll.Length, (Get-FileHash $out -Algorithm SHA256).Hash.ToLower())
}

Build 'BotCore.Server.dll' @(Get-ChildItem $here -Filter '*.cs' | ForEach-Object { $_.FullName }) @()
Build 'BotCore.Client.dll' @(Get-ChildItem $client -Filter '*.cs' | ForEach-Object { $_.FullName }) @("/resource:$(Join-Path $client 'icon.png'),BotCore.Client.icon.png")
