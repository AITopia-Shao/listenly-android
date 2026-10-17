param(
    [Parameter(Mandatory=$true)][string]$ApkPath,
    [string]$SdkPath = 'C:\Program Files (x86)\Android\android-sdk',
    [string]$JdkPath = 'C:\Program Files\Android\openjdk\jdk-21.0.8',
    [switch]$ExpectLite
)
$ErrorActionPreference = 'Stop'
$taskApkPath = [IO.Path]::GetFullPath($ApkPath)
$taskProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskAppConfig = Get-Content -LiteralPath (Join-Path $taskProjectRoot 'app\build.gradle') -Raw -Encoding UTF8
if ($taskAppConfig -notmatch '\bversionCode\s+(\d+)') { throw 'Android app versionCode not found' }
$taskVersionCode = $Matches[1]
if ($taskAppConfig -notmatch "\bversionName\s+'([^']+)'") { throw 'Android app versionName not found' }
$taskVersionName = $Matches[1]
$taskTools = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'build-tools') -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'aapt.exe') } |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskApkPath)
$taskNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$taskAudio = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
function Read-ApkText([string]$EntryName) {
    $taskEntry = $taskArchive.GetEntry($EntryName)
    if (!$taskEntry) { throw "Missing APK entry: $EntryName" }
    $taskReader = New-Object IO.StreamReader($taskEntry.Open(),[Text.Encoding]::UTF8)
    try { return $taskReader.ReadToEnd() } finally { $taskReader.Dispose() }
}
function Read-ApkJson([string]$EntryName) {
    return (Read-ApkText $EntryName | ConvertFrom-Json)
}
function Collect-Audio($Node) {
    if ($null -eq $Node) { return }
    if ($Node -is [string]) {
        $taskRef = $Node -replace '^https://listenly\.local/assets/', '' -replace '^\./', ''
        if ($taskRef.StartsWith('media/') -and $taskRef -match '\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$') {
            [void]$taskAudio.Add('assets/web/' + $taskRef)
        }
    } elseif ($Node -is [System.Collections.IDictionary]) {
        foreach ($taskChild in $Node.Values) { Collect-Audio $taskChild }
    } elseif ($Node -is [PSCustomObject]) {
        foreach ($taskProperty in $Node.PSObject.Properties) { Collect-Audio $taskProperty.Value }
    } elseif ($Node -is [System.Collections.IEnumerable]) {
        foreach ($taskChild in $Node) { Collect-Audio $taskChild }
    }
}
try {
    foreach ($taskEntry in $taskArchive.Entries) {
        if ($taskEntry.FullName.Contains('\')) { throw "Android ZIP entry contains backslash: $($taskEntry.FullName)" }
        if (!$taskNames.Add($taskEntry.FullName)) { throw "Duplicate ZIP entry: $($taskEntry.FullName)" }
        if ($taskEntry.FullName -match '\.fingerprint$|/\.[^/]*tmp$|\.tmp$|(?:^|/)\.?cache/') { throw "Cache / temporary file in APK: $($taskEntry.FullName)" }
    }
    foreach ($taskRequired in @('AndroidManifest.xml','resources.arsc','classes.dex','assets/web/index.html','assets/web/app.compat.js','assets/web/app.js','assets/web/styles.css','assets/web/importer.js','assets/web/alignment.js','assets/web/activity.js','assets/web/playback-modes.js','assets/web/glass.js','assets/web/theme.js','assets/web/overlays.js','assets/web/flow-lens.js','assets/web/wallpaper.js','assets/web/import-media.js','assets/web/wallpapers.json','assets/web/wallpapers/day.svg','assets/web/wallpapers/night.svg','assets/web/icons/play-mask.svg','assets/web/icons/pause-mask.svg','assets/web/demo.json','assets/web/bundled-library.json')) {
        if (!$taskNames.Contains($taskRequired)) { throw "Required app entry missing: $taskRequired" }
    }
    if ($taskArchive.GetEntry('resources.arsc').Length -ne $taskArchive.GetEntry('resources.arsc').CompressedLength) { throw 'resources.arsc must be uncompressed for current Android targets' }
    $taskSourceWeb = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) 'app\src\main\assets\web'
    foreach ($taskModule in @('index.html','app.compat.js','app.js','styles.css','importer.js','alignment.js','activity.js','playback-modes.js','glass.js','theme.js','overlays.js','flow-lens.js','wallpaper.js','import-media.js','wallpapers/day.svg','wallpapers/night.svg','icons/play-mask.svg','icons/pause-mask.svg','demo.json')) {
        $taskHash = [Security.Cryptography.SHA256]::Create()
        $taskStream = $taskArchive.GetEntry('assets/web/' + $taskModule).Open()
        try { $taskEntryHash = [BitConverter]::ToString($taskHash.ComputeHash($taskStream)).Replace('-','') }
        finally { $taskStream.Dispose(); $taskHash.Dispose() }
        $taskSourceHash = (Get-FileHash -LiteralPath (Join-Path $taskSourceWeb $taskModule) -Algorithm SHA256).Hash
        if ($taskEntryHash -ne $taskSourceHash) { throw "APK contains an outdated app module: $taskModule" }
    }
    $taskHtml = Read-ApkText 'assets/web/index.html'
    $taskClassicTag = [regex]::Match($taskHtml, '<script\b[^>]*\bsrc\s*=\s*["'']app\.compat\.js["''][^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (!$taskClassicTag.Success -or $taskClassicTag.Value -notmatch '\bdefer(?:\s|=|>|/)') { throw 'index.html must load app.compat.js as a deferred classic script' }
    if ($taskHtml -match '<script\b[^>]*\btype\s*=\s*["'']module["'']') { throw 'index.html contains an ES module entry unsupported by the minimum WebView baseline' }
    $taskDemo = Read-ApkJson 'assets/web/demo.json'
    $taskBundle = Read-ApkJson 'assets/web/bundled-library.json'
    $taskPaperCount = @($taskBundle.papers).Count
    if (!$taskBundle.papers -or !$taskPaperCount) { throw 'APK contains no real listening papers' }
    if ($ExpectLite -and $taskPaperCount -ne 1) { throw 'Lite APK must contain exactly one real paper' }
    Collect-Audio $taskBundle
    [long]$taskCorpusAudioBytes = 0
    foreach ($taskRef in $taskAudio) {
        if (!$taskNames.Contains($taskRef)) { throw "Indexed audio missing from APK: $taskRef" }
        $taskCorpusAudioBytes += $taskArchive.GetEntry($taskRef).Length
    }
    $taskArticleCount = 0
    $taskQuestionCount = 0
    foreach ($taskPaper in $taskBundle.papers) {
        $taskArticleCount += @($taskPaper.articles).Count
        foreach ($taskArticle in $taskPaper.articles) { if ($taskArticle.questions) { $taskQuestionCount += @($taskArticle.questions).Count } }
    }
    if ($taskBundle.summary) {
        if ($taskBundle.summary.papers -ne $taskPaperCount -or $taskBundle.summary.articles -ne $taskArticleCount -or $taskBundle.summary.questions -ne $taskQuestionCount) { throw 'Bundled-library summary does not match its papers, articles and questions' }
        if ($ExpectLite -and $taskBundle.summary.audioBytes -ne $taskCorpusAudioBytes) { throw 'Lite bundled-library summary audioBytes does not match packaged corpus audio' }
    }
    Collect-Audio $taskDemo
    foreach ($taskRef in $taskAudio) {
        if (!$taskNames.Contains($taskRef)) { throw "Indexed audio missing from APK: $taskRef" }
        if ($taskArchive.GetEntry($taskRef).Length -le 32) { throw "Indexed audio is empty: $taskRef" }
    }
    $taskPackagedAudio = @($taskArchive.Entries | Where-Object { $_.FullName -match '^assets/web/media/.*\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$' })
    if ($ExpectLite -and $taskPackagedAudio.Count -ne $taskAudio.Count) { throw 'Lite APK contains audio from unselected papers' }
    foreach ($taskEntry in $taskPackagedAudio) {
        if ($taskEntry.FullName.StartsWith('assets/web/media/cet6/') -and !$taskAudio.Contains($taskEntry.FullName)) { throw "Unreferenced corpus audio in APK: $($taskEntry.FullName)" }
    }
} finally { $taskArchive.Dispose() }
$taskBadging = & (Join-Path $taskTools.FullName 'aapt.exe') dump badging $taskApkPath
if ($LASTEXITCODE -ne 0) { throw 'APK resource / manifest inspection failed' }
$taskBadgingText = $taskBadging -join "`n"
foreach ($taskContract in @("package: name='cn.listenly.app'", "sdkVersion:'26'", "targetSdkVersion:'37'", "application-label:'拾听'", "versionCode='$taskVersionCode'", "versionName='$taskVersionName'")) {
    if (!$taskBadgingText.Contains($taskContract)) { throw "Manifest contract not met: $taskContract" }
}
$taskSignatures = & (Join-Path $JdkPath 'bin\java.exe') -jar (Join-Path $taskTools.FullName 'lib\apksigner.jar') verify --verbose $taskApkPath
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
if (($taskSignatures -join "`n") -notmatch 'Verified using v2 scheme .*: true') { throw 'APK has no valid v2 signature' }
if (($taskSignatures -join "`n") -notmatch 'Verified using v3 scheme .*: true') { throw 'APK has no valid v3 signature' }
Write-Output ("PASS: {0} real papers; {1} indexed audio files; normalized ZIP paths; complete app modules; SDK26/37; valid v2/v3 signature; {2:N1} MB" -f $taskPaperCount,$taskAudio.Count,((Get-Item -LiteralPath $taskApkPath).Length / 1MB))
