# 调用 DSH DoYourWeb 扩展能力（/ext/ HTTP 通道）
#
# 用法:
#   .\ext.ps1 status
#   .\ext.ps1 cookies.get -Args @{url='https://x.com'}
#   .\ext.ps1 downloads.download -Args @{url='https://example.com/a.png'; filename='a.png'}
#   .\ext.ps1 scripting.execute -Args @{tabId=123; code='document.title'}
#   .\ext.ps1 net.rules -Args @{action='list'}
#   .\ext.ps1 clipboard.read
#
# 需要: DSH 正在运行，扩展已配对

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Command,

    [hashtable]$Args = @{},

    [int]$TabId = 0,

    [int]$Port = 43187,

    [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'

# 读配对 token
$pairingFile = Join-Path $env:USERPROFILE ".dsh\browser-tabs\pairing.json"
if (-not (Test-Path $pairingFile)) {
    throw "找不到 $pairingFile — DSH 的浏览器桥接还没配对过"
}
$token = (Get-Content $pairingFile -Raw -Encoding UTF8 | ConvertFrom-Json).token
if (-not $token) { throw "pairing.json 里没有 token" }

# status 特判：查 /cdp/info
if ($Command -eq 'status') {
    $info = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/cdp/info" `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec $TimeoutSec
    [pscustomobject]@{
        ok     = $info.ok
        port   = $Port
        tabs   = if ($info.tabs) { $info.tabs.Count } else { 0 }
        direct = $info.directTarget
    } | Format-List
    return
}

# 构造请求体
$payload = @{ args = @($Args) } | ConvertTo-Json -Depth 10 -Compress
$uri = "http://127.0.0.1:$Port/ext/$Command"
if ($TabId -gt 0) { $uri += "?tabId=$TabId" }

try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json" `
        -Body $payload `
        -TimeoutSec $TimeoutSec
    $resp | ConvertTo-Json -Depth 20
}
catch {
    $detail = $_.ErrorDetails.Message
    if ($detail) {
        Write-Host "请求失败，服务端返回：" -ForegroundColor Red
        Write-Host $detail
    } else {
        Write-Host "请求失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 1
}
