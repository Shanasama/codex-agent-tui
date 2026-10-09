param([Parameter(Mandatory=$true)][string]$StateFile, [string]$SnapshotDirectory, [string]$NodePath = 'node.exe', [string]$LaunchId = '')
$ErrorActionPreference = 'Stop'
$StateFile = [IO.Path]::GetFullPath($StateFile)
$window = $null; $mutex = $null; $activateSignal = $null; $timer = $null
try {
# Use this host's modules even when launched from a PowerShell 7 parent.
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -Force
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
  $script:readyToken = $LaunchId
  $script:contentRendered = $false
  if (!$SnapshotDirectory) {
    $hash = [Security.Cryptography.SHA256]::Create()
    $identity = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($StateFile.ToLowerInvariant()))).Replace('-', '').Substring(0,16)
    $hash.Dispose()
    $created = $false
    $mutex = New-Object Threading.Mutex($true, ('Local\CodexWorkflow-' + $identity), [ref]$created)
    $activateSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, ('Local\CodexWorkflowShow-' + $identity))
    if (!$created) { $activateSignal.Set() | Out-Null; return }
  }
  $xamlPath = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', 'public', 'workflow-window.xaml'))
  $window = [Windows.Markup.XamlReader]::Parse([IO.File]::ReadAllText($xamlPath))
  $root = $window.FindName('Root')
  $brush = New-Object Windows.Media.BrushConverter
  $script:lastStateStamp = 0
  $script:frame = $null
  $renderPath = [IO.Path]::Combine($PSScriptRoot, 'render-workflow-frame.js')
  $font = New-Object Windows.Media.FontFamily('Consolas')
  $typeface = New-Object Windows.Media.Typeface('Consolas')
  $measure = New-Object Windows.Media.FormattedText('M', [Globalization.CultureInfo]::InvariantCulture, [Windows.FlowDirection]::LeftToRight, $typeface, 14, [Windows.Media.Brushes]::White)
  $cellWidth = $measure.WidthIncludingTrailingWhitespace
  $lineHeight = 18
  function Update-State {
    try {
      $stamp = [IO.File]::GetLastWriteTimeUtc($StateFile).Ticks
      if ($stamp -eq $script:lastStateStamp) { return }
      $info = New-Object Diagnostics.ProcessStartInfo
      $info.FileName = $NodePath
      $info.Arguments = '"' + $renderPath + '" "' + $StateFile + '"'
      $info.UseShellExecute = $false
      $info.CreateNoWindow = $true
      $info.RedirectStandardOutput = $true
      $info.RedirectStandardError = $true
      $info.StandardOutputEncoding = [Text.Encoding]::UTF8
      $info.StandardErrorEncoding = [Text.Encoding]::UTF8
      $render = [Diagnostics.Process]::Start($info)
      $json = $render.StandardOutput.ReadToEnd()
      $diagnostic = $render.StandardError.ReadToEnd()
      $render.WaitForExit()
      if ($render.ExitCode -ne 0) { throw ('Render failed: ' + $diagnostic) }
      $render.Dispose()
      $script:frame = $json | ConvertFrom-Json
      $canvas = $window.FindName('TerminalCanvas')
      $canvas.Children.Clear()
      $canvas.Width = $script:frame.columns * $cellWidth
      $canvas.Height = $script:frame.rows * $lineHeight
      foreach ($segment in $script:frame.segments) {
        if ($segment.shape) {
          $w = $segment.width * $cellWidth; $mx = $cellWidth / 2; $my = $lineHeight / 2
          $edges = @(switch ([int][char]$segment.shape) {
            9472 { ,@(0,$my,$w,$my) }
            9474 { ,@($mx,0,$mx,$lineHeight) }
            9484 { ,@($mx,$my,$w,$my); ,@($mx,$my,$mx,$lineHeight) }
            9488 { ,@(0,$my,$mx,$my); ,@($mx,$my,$mx,$lineHeight) }
            9492 { ,@($mx,0,$mx,$my); ,@($mx,$my,$w,$my) }
            9496 { ,@($mx,0,$mx,$my); ,@(0,$my,$mx,$my) }
            9516 { ,@(0,$my,$w,$my); ,@($mx,$my,$mx,$lineHeight) }
          })
          foreach ($edge in $edges) {
            $line = New-Object Windows.Shapes.Line
            $line.X1 = $segment.x * $cellWidth + $edge[0]
            $line.Y1 = $segment.y * $lineHeight + $edge[1]
            $line.X2 = $segment.x * $cellWidth + $edge[2]
            $line.Y2 = $segment.y * $lineHeight + $edge[3]
            $line.Stroke = $brush.ConvertFromString([string]$segment.fg)
            $line.StrokeThickness = 1
            $canvas.Children.Add($line) | Out-Null
          }
          continue
        }
        $text = New-Object Windows.Controls.TextBlock
        $text.Text = [string]$segment.text
        $text.FontFamily = $font
        $text.FontSize = 14
        $text.FontWeight = if ($segment.bold) { [Windows.FontWeights]::Bold } else { [Windows.FontWeights]::Normal }
        $text.Foreground = $brush.ConvertFromString([string]$segment.fg)
        $text.Background = $brush.ConvertFromString([string]$segment.bg)
        $text.Width = $segment.width * $cellWidth + 0.1
        $text.Height = $lineHeight
        $text.TextWrapping = 'NoWrap'
        [Windows.Controls.Canvas]::SetLeft($text, $segment.x * $cellWidth)
        [Windows.Controls.Canvas]::SetTop($text, $segment.y * $lineHeight)
        $canvas.Children.Add($text) | Out-Null
      }
      $script:lastStateStamp = $stamp
    } catch {
      $window.FindName('WindowHint').Text = 'Display error: ' + $_.Exception.Message
      [IO.File]::WriteAllText(($StateFile+'.render-error.txt'), $_.Exception.ToString())
    }
  }
  function Save-WindowStatus {
    if ($SnapshotDirectory) { return }
    $status = @{ pid=$PID; width=$window.ActualWidth; height=$window.ActualHeight; resizeMode=[string]$window.ResizeMode; title=$window.Title; launchId=$script:readyToken; visible=$window.IsVisible; rendered=($script:contentRendered -and $script:frame.segments.Count -gt 0) }
    [IO.File]::WriteAllText(($StateFile+'.window.json'), ($status | ConvertTo-Json))
  }
  function Save-Render([string]$name) {
    $window.UpdateLayout()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$root.ActualWidth, [int]$root.ActualHeight, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $visual = New-Object Windows.Media.DrawingVisual
    $context = $visual.RenderOpen()
    $context.DrawRectangle((New-Object Windows.Media.VisualBrush($root)), $null, (New-Object Windows.Rect(0,0,$root.ActualWidth,$root.ActualHeight)))
    $context.Close()
    $bitmap.Render($visual)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create([IO.Path]::Combine($SnapshotDirectory, $name+'.png'))
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
    $metrics = @{ width=$window.ActualWidth; height=$window.ActualHeight; resizeMode=[string]$window.ResizeMode; probabilities=@($script:frame.probabilities | ForEach-Object { $_.value }); columns=$script:frame.columns; rows=$script:frame.rows; segments=$script:frame.segments.Count }
    [IO.File]::WriteAllText([IO.Path]::Combine($SnapshotDirectory, $name+'.json'), ($metrics | ConvertTo-Json))
  }
  $window.Add_Loaded({ Update-State; Save-WindowStatus })
  $window.Add_ContentRendered({ $script:contentRendered=$true; Save-WindowStatus })
  $window.Add_SizeChanged({ Save-WindowStatus })
  $script:captured = $false
  if ($SnapshotDirectory) {
    $SnapshotDirectory = [IO.Path]::GetFullPath($SnapshotDirectory)
    [IO.Directory]::CreateDirectory($SnapshotDirectory) | Out-Null
    $window.Add_ContentRendered({
      if ($script:captured) { return }; $script:captured=$true
      Save-Render 'normal'
      $window.Width=640; $window.Height=600
      $window.Dispatcher.BeginInvoke([Action]{ Save-Render 'small'; $window.Close() }, [Windows.Threading.DispatcherPriority]::ApplicationIdle) | Out-Null
    })
  }
  $timer = New-Object Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(350)
  $timer.Add_Tick({
    Update-State
    if ($activateSignal -and $activateSignal.WaitOne(0)) {
      if ($window.WindowState -eq 'Minimized') { $window.WindowState='Normal' }
      $window.Activate() | Out-Null
      try { $request = [IO.File]::ReadAllText(($StateFile+'.launch-request.json')) | ConvertFrom-Json; $script:readyToken=$request.launchId } catch {}
      Save-WindowStatus
    }
  })
  $timer.Start()
  $window.ShowDialog() | Out-Null
} catch {
  [IO.File]::WriteAllText(($StateFile+'.error.txt'), $_.Exception.ToString())
  exit 1
} finally {
  if ($timer) { $timer.Stop() }
  if ($activateSignal) { $activateSignal.Dispose() }
  if ($mutex) { if ($created) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
