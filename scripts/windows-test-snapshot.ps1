# Prints every process and every visible top-level window (with its text) as JSON.
# The Windows updater tests use it to show what a stuck installer is waiting on,
# such as a message box that ignores /S.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$windows = @()
try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class LatexDoTestWindows {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

  static string Text(IntPtr hWnd) {
    var text = new StringBuilder(1024);
    GetWindowText(hWnd, text, text.Capacity);
    return text.ToString();
  }

  public static List<object[]> Visible() {
    var result = new List<object[]>();
    EnumWindows(delegate (IntPtr hWnd, IntPtr unused) {
      if (!IsWindowVisible(hWnd)) return true;
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      var parts = new List<string>();
      parts.Add(Text(hWnd));
      EnumChildWindows(hWnd, delegate (IntPtr child, IntPtr unusedChild) {
        var text = Text(child);
        if (text.Length > 0) parts.Add(text);
        return true;
      }, IntPtr.Zero);
      result.Add(new object[] { processId, string.Join(" | ", parts.ToArray()) });
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
  $windows = @([LatexDoTestWindows]::Visible() | ForEach-Object {
    [pscustomobject]@{ ProcessId = [int]$_[0]; Text = [string]$_[1] }
  })
} catch {
  $windows = @([pscustomobject]@{ ProcessId = 0; Text = "Window listing failed: $($_.Exception.Message)" })
}

$processes = @(Get-CimInstance -ClassName Win32_Process |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath, CommandLine)

[pscustomobject]@{ processes = $processes; windows = $windows } | ConvertTo-Json -Depth 3 -Compress
