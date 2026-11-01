# sbs-audio-out.ps1 - prints the name of Windows' default playback device
# (the one Media.SoundPlayer, i.e. sbs-session.mjs --play-pc, plays through).
# Read-only: it queries the device list and changes nothing.
#   powershell -NoProfile -ExecutionPolicy Bypass -File sbs-audio-out.ps1
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetAt(int index, out PropKey key);
  [PreserveSig] int GetValue(ref PropKey key, out PropVar value);
}
[StructLayout(LayoutKind.Sequential)] public struct PropKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Sequential)] public struct PropVar { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
public static class SbsAudioOut {
  public static string DefaultName(int flow) {
    var e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    IMMDevice d;
    if (e.GetDefaultAudioEndpoint(flow, 0, out d) != 0 || d == null) return "";
    IPropertyStore s;
    if (d.OpenPropertyStore(0, out s) != 0) return "";
    var k = new PropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    PropVar v;
    if (s.GetValue(ref k, out v) != 0 || v.vt != 31) return "";
    return Marshal.PtrToStringUni(v.p);
  }
}
"@
Write-Output ([SbsAudioOut]::DefaultName(0))
