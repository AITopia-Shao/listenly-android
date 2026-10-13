param(
    [string]$SdkPath = 'C:\Program Files (x86)\Android\android-sdk',
    [string]$JdkPath = 'C:\Program Files\Android\openjdk\jdk-21.0.8',
    [string]$OutputPath = '',
    [switch]$Lite,
    [switch]$Demo
)
$ErrorActionPreference = 'Stop'
if ($Demo -and $Lite) { throw '-Demo and -Lite cannot be combined.' }
function Invoke-BuildTool([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed ($LASTEXITCODE): $Executable" }
}
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskBuild = Join-Path ([IO.Path]::GetTempPath()) ('listenly-build-' + [guid]::NewGuid().ToString('N'))
$taskSavedBuild = Join-Path $taskRoot '.build\android'
$taskAppConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'app\build.gradle') -Raw -Encoding UTF8
if ($taskAppConfig -notmatch '\bversionCode\s+(\d+)') { throw 'Android app versionCode not found' }
$taskVersionCode = $Matches[1]
if ($taskAppConfig -notmatch "\bversionName\s+'([^']+)'") { throw 'Android app versionName not found' }
$taskVersionName = $Matches[1]
if (!$OutputPath) {
    $OutputPath = Join-Path $taskRoot $(if ($Demo) { "dist\listenly-demo-$taskVersionName.apk" } elseif ($Lite) { 'dist\拾听-轻量版.apk' } else { 'dist\拾听.apk' })
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$taskTools = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'build-tools') -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'aapt2.exe') } |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
$taskPlatform = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'platforms') -Directory |
    Where-Object { $_.Name -match '^android-\d+$' } |
    Sort-Object { [int]($_.Name -replace '^android-', '') } -Descending | Select-Object -First 1
if (!$taskTools -or !$taskPlatform) { throw 'Android SDK platforms / build-tools not found.' }
$taskJar = Join-Path $taskPlatform.FullName 'android.jar'
$taskJava = Join-Path $JdkPath 'bin\java.exe'
$taskJavac = Join-Path $JdkPath 'bin\javac.exe'
$taskKeytool = Join-Path $JdkPath 'bin\keytool.exe'
foreach ($taskExe in @($taskJava,$taskJavac,$taskKeytool)) {
    if (!(Test-Path -LiteralPath $taskExe)) { throw "Required JDK executable missing: $taskExe" }
}
$taskNpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (!$taskNpmCommand) { throw 'npm.cmd not found; install Node.js and run npm ci in the project first.' }
$taskPythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (!$taskPythonCommand) { throw 'Python 3.10 or newer is required to create Android-compatible APK ZIP entries.' }
# Generate the classic Chromium 58 entry before taking the Android asset snapshot.
# This prevents APKs from shipping an outdated bundle after source changes.
Push-Location -LiteralPath $taskRoot
try { Invoke-BuildTool $taskNpmCommand.Source @('run','build:web') }
finally { Pop-Location }
$taskCompatPath = Join-Path $taskRoot 'app\src\main\assets\web\app.compat.js'
if (!(Test-Path -LiteralPath $taskCompatPath -PathType Leaf) -or (Get-Item -LiteralPath $taskCompatPath).Length -le 0) {
    throw 'build:web did not produce app.compat.js'
}
foreach ($taskDir in @($taskBuild,$taskSavedBuild,(Join-Path $taskBuild 'gen'),(Join-Path $taskBuild 'classes'),(Join-Path $taskBuild 'dex'),[IO.Path]::GetDirectoryName($OutputPath))) {
    New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
}
# Keep compiler paths simple and stage a consistent snapshot. Demo edition uses
# only public original examples. Lite edition also copies the latest complete paper.
$taskMainSource = Join-Path $taskRoot 'app\src\main'
if ($Demo) {
    $taskDemoMain = Join-Path $taskRoot '.build\demo\main'
    Invoke-BuildTool $taskPythonCommand.Source @((Join-Path $taskRoot 'tools\prepare-demo-assets.py'),'--output',$taskDemoMain)
    $taskMainSource = $taskDemoMain
}
$taskWebSource = Join-Path $taskMainSource 'assets\web'
$taskAudioPattern = '\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4)$'
$taskKeepAudio = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Add-ReferencedAudio($Node) {
    if ($null -eq $Node) { return }
    if ($Node -is [string]) {
        $taskRef = $Node -replace '^https://listenly\.local/assets/', '' -replace '^\./', ''
        if ($taskRef.StartsWith('media/') -and $taskRef -match $taskAudioPattern) {
            $taskAudioPath = [IO.Path]::GetFullPath((Join-Path $taskWebSource $taskRef.Replace('/','\')))
            if (!$taskAudioPath.StartsWith($taskWebSource + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe bundled audio path' }
            [void]$taskKeepAudio.Add($taskAudioPath)
        }
    } elseif ($Node -is [System.Collections.IDictionary]) {
        foreach ($taskChild in $Node.Values) { Add-ReferencedAudio $taskChild }
    } elseif ($Node -is [PSCustomObject]) {
        foreach ($taskProperty in $Node.PSObject.Properties) { Add-ReferencedAudio $taskProperty.Value }
    } elseif ($Node -is [System.Collections.IEnumerable]) {
        foreach ($taskChild in $Node) { Add-ReferencedAudio $taskChild }
    }
}
$taskBundlePath = Join-Path $taskWebSource 'bundled-library.json'
if (!(Test-Path -LiteralPath $taskBundlePath)) { throw 'Build requires bundled-library.json' }
$taskBundle = Get-Content -LiteralPath $taskBundlePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Lite) {
    $taskPaperOrder = @{}
    $taskOrder = 0
    foreach ($taskPaper in $taskBundle.papers) { $taskPaperOrder[[string]$taskPaper.id] = $taskOrder; $taskOrder++ }
    $taskComplete = @($taskBundle.papers | Where-Object {
        $taskQuestionCount = 0
        foreach ($taskArticle in $_.articles) { if ($taskArticle.questions) { $taskQuestionCount += @($taskArticle.questions).Count } }
        $taskQuestionCount -ge 25
    } | Sort-Object @{Expression={ [int]$_.year };Descending=$true},
        @{Expression={ if ($_.id -match '(?:^|[-_])(\d{4})[-_](\d{1,2})(?:[-_]|$)') { [int]$Matches[2] } elseif ($_.month) { [int]$_.month } else { 0 } };Descending=$true},
        @{Expression={ @($_.articles).Count };Descending=$true},
        @{Expression={ $taskPaperOrder[[string]$_.id] };Descending=$false})
    if (!$taskComplete.Count) { throw 'No complete paper with at least 25 questions is available for Lite build' }
    $taskSelected = $taskComplete[0]
    $taskBundle.papers = @($taskSelected)
}
Add-ReferencedAudio $taskBundle.papers
if ($Lite) {
    $taskLiteQuestions = 0
    foreach ($taskArticle in $taskSelected.articles) { if ($taskArticle.questions) { $taskLiteQuestions += @($taskArticle.questions).Count } }
    [long]$taskLiteAudioBytes = 0
    foreach ($taskAudioPath in $taskKeepAudio) {
        if (!(Test-Path -LiteralPath $taskAudioPath -PathType Leaf)) { throw "Missing bundled audio: $taskAudioPath" }
        $taskLiteAudioBytes += (Get-Item -LiteralPath $taskAudioPath).Length
    }
    $taskBundle.summary = [PSCustomObject]@{
        papers = 1
        articles = @($taskSelected.articles).Count
        questions = $taskLiteQuestions
        audioBytes = $taskLiteAudioBytes
    }
}
Add-ReferencedAudio (Get-Content -LiteralPath (Join-Path $taskWebSource 'demo.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
foreach ($taskAudioPath in $taskKeepAudio) {
    if (!(Test-Path -LiteralPath $taskAudioPath -PathType Leaf)) { throw "Missing bundled audio: $taskAudioPath" }
}
if ($Lite) { Write-Host "Lite edition: $($taskSelected.title); $($taskKeepAudio.Count) recordings" }
if ($Demo) { Write-Host "Public demo edition: original examples only; $($taskKeepAudio.Count) recordings" }
$taskCorpusPrefix = (Join-Path $taskWebSource 'media\cet6') + '\'
foreach ($taskSource in Get-ChildItem -LiteralPath $taskMainSource -File -Recurse) {
    $taskRelative = $taskSource.FullName.Substring($taskMainSource.Length + 1)
    if ($taskSource.Name -match '\.fingerprint$|^\..*tmp$|\.tmp$' -or $taskRelative -match '(?:^|[\\/])\.?cache[\\/]') { continue }
    if ($taskSource.Name -match $taskAudioPattern -and !$taskKeepAudio.Contains($taskSource.FullName)) {
        if ($Lite -or $taskSource.FullName.StartsWith($taskCorpusPrefix,[StringComparison]::OrdinalIgnoreCase)) { continue }
    }
    $taskDestination = Join-Path (Join-Path $taskBuild 'main') $taskRelative
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($taskDestination)) | Out-Null
    Copy-Item -LiteralPath $taskSource.FullName -Destination $taskDestination
}
if ($Lite) {
    [IO.File]::WriteAllText((Join-Path $taskBuild 'main\assets\web\bundled-library.json'),
        ($taskBundle | ConvertTo-Json -Depth 100 -Compress), (New-Object Text.UTF8Encoding($false)))
}
# The portable build compiles against the newest installed Android stubs. The code
# gates modern APIs at runtime; target SDK stays 37. Android Studio compiles at 37.
Write-Host "Compiling with $($taskPlatform.Name), targeting API 37; tools $($taskTools.Name)"
$taskManifest = Join-Path $taskBuild 'AndroidManifest.xml'
[xml]$taskXml = Get-Content -LiteralPath (Join-Path $taskRoot 'app\src\main\AndroidManifest.xml') -Raw -Encoding UTF8
$taskXml.manifest.SetAttribute('package','cn.listenly.app')
$taskXml.manifest.SetAttribute('versionCode','http://schemas.android.com/apk/res/android',$taskVersionCode) | Out-Null
$taskXml.manifest.SetAttribute('versionName','http://schemas.android.com/apk/res/android',$taskVersionName) | Out-Null
$taskXml.manifest.application.SetAttribute('debuggable','http://schemas.android.com/apk/res/android','true') | Out-Null
$taskXml.Save($taskManifest)
$taskCompiled = Join-Path $taskBuild 'compiled'
New-Item -ItemType Directory -Force -Path $taskCompiled | Out-Null
$taskBase = Join-Path $taskBuild 'base.apk'
foreach ($taskResource in Get-ChildItem -LiteralPath (Join-Path $taskBuild 'main\res') -File -Recurse) {
    Invoke-BuildTool (Join-Path $taskTools.FullName 'aapt2.exe') @('compile',$taskResource.FullName,'-o',$taskCompiled)
}
$taskFlats = @(Get-ChildItem -LiteralPath $taskCompiled -Filter '*.flat' | ForEach-Object { $_.FullName })
$taskLinkArgs = @('link','-I',$taskJar,'--manifest',$taskManifest,'--java',(Join-Path $taskBuild 'gen'),'--auto-add-overlay','-o',$taskBase) + $taskFlats
if (Test-Path -LiteralPath (Join-Path $taskBuild 'main\assets')) { $taskLinkArgs += @('-A',(Join-Path $taskBuild 'main\assets')) }
Invoke-BuildTool (Join-Path $taskTools.FullName 'aapt2.exe') $taskLinkArgs
$taskSources = @(Get-ChildItem -LiteralPath (Join-Path $taskBuild 'main\java') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
$taskSources += @(Get-ChildItem -LiteralPath (Join-Path $taskBuild 'gen') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
Invoke-BuildTool $taskJavac (@('--release','8','-encoding','UTF-8','-classpath',$taskJar,'-d',(Join-Path $taskBuild 'classes')) + $taskSources)
$taskClasses = @(Get-ChildItem -LiteralPath (Join-Path $taskBuild 'classes') -Filter '*.class' -Recurse | ForEach-Object { $_.FullName })
Invoke-BuildTool $taskJava (@('-cp',(Join-Path $taskTools.FullName 'lib\d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',$taskJar,'--output',(Join-Path $taskBuild 'dex')) + $taskClasses)
$taskNormalizedApk = Join-Path $taskBuild 'normalized.apk'
# .NET Framework's NoCompression may still emit ZIP method 8. Android needs
# resources.arsc to use actual ZIP_STORED (method 0), so normalize with Python.
# The helper streams entries and does not buffer the complete audio corpus.
$taskNormalizeTool = Join-Path $taskRoot 'tools\normalize-apk.py'
Invoke-BuildTool $taskPythonCommand.Source @($taskNormalizeTool,$taskBase,$taskNormalizedApk,'--dex-dir',(Join-Path $taskBuild 'dex'))
$taskAligned = Join-Path $taskBuild 'aligned.apk'
Invoke-BuildTool (Join-Path $taskTools.FullName 'zipalign.exe') @('-P','16','-f','4',$taskNormalizedApk,$taskAligned)
$taskKeystore = Join-Path $taskSavedBuild 'debug.keystore'
if (!(Test-Path -LiteralPath $taskKeystore)) {
    Invoke-BuildTool $taskKeytool @('-genkeypair','-keystore',$taskKeystore,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Listenly Debug,O=Local,C=CN','-keyalg','RSA','-keysize','2048','-validity','10000')
}
$taskSigned = Join-Path $taskBuild 'signed.apk'
Invoke-BuildTool $taskJava @('-jar',(Join-Path $taskTools.FullName 'lib\apksigner.jar'),'sign','--ks',$taskKeystore,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',$taskSigned,$taskAligned)
Invoke-BuildTool $taskJava @('-jar',(Join-Path $taskTools.FullName 'lib\apksigner.jar'),'verify','--verbose',$taskSigned)
Invoke-BuildTool $taskPythonCommand.Source @($taskNormalizeTool,'--verify',$taskSigned)
Invoke-BuildTool (Join-Path $taskTools.FullName 'zipalign.exe') @('-c','-P','16','4',$taskSigned)
Copy-Item -LiteralPath $taskSigned -Destination $OutputPath -Force
Write-Host "APK ready: $OutputPath"
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$taskCleanup = [IO.Path]::GetFullPath($taskBuild)
if (!$taskCleanup.StartsWith($taskTempRoot,[StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($taskCleanup) -notmatch '^listenly-build-[a-f0-9]{32}$') {
    throw 'Refusing to remove a temporary build directory outside the expected location.'
}
Remove-Item -LiteralPath $taskCleanup -Recurse -Force
