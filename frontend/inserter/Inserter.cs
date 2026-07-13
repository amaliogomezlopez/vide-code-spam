// Vibe Spam global dictation inserter.
//
// Small native helper that does the "last mile" of global dictation: insert
// transcribed text into the focused text control of ANY app (Chrome, VS Code,
// Codex, Claude, Edge, ...). Compiled at build time with csc.exe and bundled
// as an extraResource; the Electron main process invokes it via spawn.
//
// Why a compiled helper instead of PowerShell + Add-Type at runtime:
//   - PowerShell Add-Type recompiles a .cs into TEMP on every run, which is
//     fragile (TEMP permission errors, antivirus, sandboxed paths).
//   - A prebuilt exe starts in ~30ms vs 300-800ms for PowerShell.
//   - Deterministic: what we test is what ships.
//
// Subcommands:
//   inserter.exe capture
//       Prints a JSON line describing the focused element + its host window.
//       Run this the instant dictation starts, BEFORE any UI steals focus.
//
//   inserter.exe insert --capture <json> --text <path>
//       Reads transcribed text from <path> (so newlines/quotes are safe) and
//       inserts it into the previously captured control. Chain of strategies,
//       each verified before declaring success:
//         1. Re-localize the captured control (RuntimeId) and SetFocus it,
//            then send Ctrl+V via SendInput. Verify the control's Value grew
//            by the expected amount.
//         2. UIAutomation ValuePattern.SetValue (works for many native fields).
//         3. SendInput Unicode char-by-char (last resort; flaky in Chromium).
//         4. Leave text on the clipboard and report failure clearly so the
//            user can Ctrl+V manually.
//
// Output: human-readable log lines on stdout (forwarded to the debug panel),
//         and a final JSON status line prefixed with "RESULT ".

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace VibeSpam.Inserter
{
    internal static class Inserter
    {
        // ---------- Win32 interop ----------
        // CRITICAL: the Win32 INPUT type is { DWORD type; UNION {MOUSEINPUT, KEYBDINPUT,
        // HARDWAREINPUT} u; }. The union's size is dictated by its LARGEST member
        // (MOUSEINPUT), not by whichever member we happen to use. If we declare only
        // KEYBDINPUT, Marshal.SizeOf(INPUT) returns the wrong value (32 on x64 instead
        // of 40), and SendInput silently fails (returns 0) for EVERY call because the
        // cbSize it demands is the real struct size. We model the union explicitly with
        // FieldOffset so the size is correct on both x86 and x64.
        [StructLayout(LayoutKind.Explicit)]
        private struct INPUT
        {
            [FieldOffset(0)] public int type;
            [FieldOffset(8)]  public MOUSEINPUT mi;
            [FieldOffset(8)]  public KEYBDINPUT ki;
            [FieldOffset(8)]  public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        private const int INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const ushort VK_MENU = 0x12;   // ALT
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_V = 0x56;

        [DllImport("user32.dll")]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;

        // Virtual keys for modifiers we may need to release before sending Ctrl+V.
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_LSHIFT = 0xA0;
        private const ushort VK_RSHIFT = 0xA1;
        private const ushort VK_LCONTROL = 0xA2;
        private const ushort VK_RCONTROL = 0xA3;
        private const ushort VK_LMENU = 0xA4;
        private const ushort VK_RMENU = 0xA5;
        private const ushort VK_LWIN = 0x5B;
        private const ushort VK_RWIN = 0x5C;

        private static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    Console.Error.WriteLine("usage: inserter capture | insert --capture <json> --text <path>");
                    return 2;
                }
                if (args[0] == "capture")
                    return RunCapture();
                if (args[0] == "insert")
                    return RunInsert(args);
                if (args[0] == "selftest")
                    return RunSelfTest();
                Console.Error.WriteLine("unknown subcommand: " + args[0]);
                return 2;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("fatal: " + ex.Message);
                return 3;
            }
        }

        // =============================================================
        // selftest
        // =============================================================
        private static int RunSelfTest()
        {
            int cb = Marshal.SizeOf(typeof(INPUT));
            Console.Out.WriteLine("INPUT cbSize=" + cb);
            // Send a single key-up of a harmless key (VK_NUMLOCK's state toggles
            // but won't disrupt anything; better: send nothing real and just
            // measure the return value with a no-op we read back).
            var seq = new INPUT[1];
            seq[0] = MakeKey(VK_SHIFT, true);   // shift-up: harmless if not down
            uint sent = SendInput(1, seq, cb);
            Console.Out.WriteLine("SendInput returned " + sent + " (expected 1)");
            Console.Out.WriteLine("RESULT {\"cbSize\":" + cb + ",\"sent\":" + sent + "}");
            return sent == 1 ? 0 : 1;
        }

        // =============================================================
        // capture
        // =============================================================
        private static int RunCapture()
        {
            // The focused element. NOTE: AutomationElement.FocusedElement reflects
            // the UIA focus at call time, which for Win32/Edit controls matches the
            // caret owner. For Chromium apps it returns the WebView/document element
            // rather than a per-field element, but its RuntimeId is still stable per
            // window and re-focusable, which is what we need.
            var el = AutomationElement.FocusedElement;
            var host = GetForegroundWindow();
            uint procId;
            uint threadId = GetWindowThreadProcessId(host, out procId);

            string runtimeId = "";
            string name = "";
            string autoId = "";
            string controlType = "";
            string processName = "";
            if (el != null)
            {
                runtimeId = JoinRuntimeId(el);
                try { name = el.Current.Name ?? ""; } catch { }
                try { autoId = el.Current.AutomationId ?? ""; } catch { }
                try { controlType = el.Current.ControlType.ProgrammaticName ?? ""; } catch { }
                try
                {
                    using (var p = Process.GetProcessById((int)el.Current.ProcessId))
                        processName = p.ProcessName;
                }
                catch { }
            }

            string hostProcName = "";
            try
            {
                using (var p = Process.GetProcessById((int)procId))
                    hostProcName = p.ProcessName;
            }
            catch { }

            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"hwnd\":").Append(host.ToInt64()).Append(',');
            sb.Append("\"thread\":").Append(threadId).Append(',');
            sb.Append("\"pid\":").Append(procId).Append(',');
            sb.Append("\"process\":\"").Append(Escape(hostProcName)).Append("\",");
            sb.Append("\"runtimeId\":\"").Append(Escape(runtimeId)).Append("\",");
            sb.Append("\"name\":\"").Append(Escape(name)).Append("\",");
            sb.Append("\"automationId\":\"").Append(Escape(autoId)).Append("\",");
            sb.Append("\"controlType\":\"").Append(Escape(controlType)).Append("\",");
            sb.Append("\"elementProcess\":\"").Append(Escape(processName)).Append("\"");
            sb.Append('}');

            // Single JSON line on stdout.
            Console.Out.WriteLine(sb.ToString());
            return 0;
        }

        // =============================================================
        // insert
        // =============================================================
        private static int RunInsert(string[] args)
        {
            string captureJson = null;
            string textPath = null;
            for (int i = 1; i < args.Length; i++)
            {
                if (args[i] == "--capture" && i + 1 < args.Length) captureJson = args[++i];
                else if (args[i] == "--text" && i + 1 < args.Length) textPath = args[++i];
            }
            if (textPath == null)
            {
                Result("fail", "missing --text");
                return 2;
            }

            string text = File.ReadAllText(textPath, Encoding.UTF8);
            var cap = ParseCapture(captureJson);
            Log("insert text " + text.Length + " chars");

            // Bring the host window forward (with the Alt-tap trick to defeat the
            // foreground lock) so the target control can actually receive input.
            if (cap != null && cap.Hwnd != IntPtr.Zero)
            {
                BringHostForward(cap);
            }
            else
            {
                Log("no capture; using current foreground");
            }

            // Best path for browser/Electron editors: if the captured host is
            // already foreground, the real caret is still in the text box. Paste
            // there immediately and avoid UIAutomation RuntimeId/SetFocus, which
            // can hang on Chromium accessibility containers such as Codex Group
            // nodes or Chrome omnibox Edit nodes.
            if (cap != null && cap.Hwnd != IntPtr.Zero && GetForegroundWindow() == cap.Hwnd)
            {
                Log("pasting to current foreground focus");
                if (SendCtrlV())
                {
                    Sleep(120);
                    Log("paste ctrl+v foreground ok (unverifiable target)");
                    Result("ok", "ctrl+v-foreground");
                    return 0;
                }
                Log("paste ctrl+v foreground failed to send; trying UIAutomation fallback");
            }

            AutomationElement target = null;
            if (cap != null && !string.IsNullOrEmpty(cap.RuntimeId))
            {
                target = FindByRuntimeId(cap.RuntimeId);
                if (target == null) Log("capture element not found; falling back to foreground");
            }
            if (target == null) target = AutomationElement.FocusedElement;
            if (target == null)
            {
                Result("fail", "no target element");
                return 1;
            }

            // Ensure the element actually has keyboard focus before sending keys.
            EnsureFocus(target);

            // ---- Strategy 1: Ctrl+V (atomic, universal in Chromium/Electron) ----
            string before = SafeGetValue(target);
            if (SendCtrlV())
            {
                // Chromium/Electron update their accessibility tree asynchronously,
                // so the Value pattern may lag the actual paste by a few tens of ms.
                // Poll briefly before declaring failure.
                string after = null;
                bool grew = false;
                for (int attempt = 0; attempt < 4; attempt++)
                {
                    Sleep(attempt == 0 ? 120 : 90);
                    after = SafeGetValue(target);
                    if (ValueGrew(before, after, text)) { grew = true; break; }
                }
                if (grew)
                {
                    Log("paste ctrl+v ok (value grew " + (after == null ? 0 : after.Length - (before == null ? 0 : before.Length)) + ")");
                    Result("ok", "ctrl+v");
                    return 0;
                }
                Log("paste ctrl+v sent but value unchanged after retries; trying fallbacks");
            }
            else
            {
                Log("paste ctrl+v failed to send");
            }

            // ---- Strategy 2: UIAutomation ValuePattern.SetValue ----
            if (TryValuePattern(target, text))
            {
                Log("paste valuepattern ok");
                Result("ok", "valuepattern");
                return 0;
            }

            // ---- Strategy 3: SendInput Unicode char-by-char ----
            if (SendUnicodeText(target, text))
            {
                Sleep(120);
                string after2 = SafeGetValue(target);
                if (ValueGrew(before, after2, text))
                {
                    Log("paste sendinput unicode ok");
                    Result("ok", "sendinput");
                    return 0;
                }
                Log("paste sendinput unicode sent but value unchanged");
            }

            // ---- Strategy 4: give up, text is already on the clipboard ----
            Log("paste failed: text left on clipboard, press Ctrl+V");
            Result("fail", "unchanged");
            return 1;
        }

        // =============================================================
        // Focus helpers
        // =============================================================
        private static void BringHostForward(Capture cap)
        {
            try
            {
                // Fast path: if our target is already the foreground window, do
                // NOTHING. No SetForegroundWindow, no ShowWindow, no Alt-tap.
                // Each of those has side effects (windows un-maximizing, focus
                // flicker, stuck modifiers) we want to avoid when we can.
                if (GetForegroundWindow() == cap.Hwnd)
                {
                    Log("foreground already set " + cap.Hwnd.ToInt64() + " (" + cap.Process + ")");
                    return;
                }

                uint currentThread = GetCurrentThreadId();
                // AttachThreadInput lets us set focus across processes; combined
                // with the Alt-tap it reliably defeats the SetForegroundWindow lock.
                AttachThreadInput(currentThread, cap.Thread, true);
                try
                {
                    SendAltTap();
                    // Only restore from minimized. Calling SW_RESTORE on an
                    // already maximized window UN-maximizes it (the bug: the
                    // target window visibly shrinks). If maximized, leave it as
                    // is; SetForegroundWindow keeps it maximized.
                    if (IsIconic(cap.Hwnd))
                    {
                        ShowWindow(cap.Hwnd, SW_RESTORE);
                        Log("window restored from minimized");
                    }
                    BringWindowToTop(cap.Hwnd);
                    SetForegroundWindow(cap.Hwnd);
                    Sleep(160);
                }
                finally
                {
                    AttachThreadInput(currentThread, cap.Thread, false);
                }
                Log("foreground set " + cap.Hwnd.ToInt64() + " (" + cap.Process + ")");
            }
            catch (Exception ex)
            {
                Log("foreground failed: " + ex.Message);
            }
        }

        private static void EnsureFocus(AutomationElement target)
        {
            try
            {
                target.SetFocus();
                Sleep(80);
                Log("focused target element");
            }
            catch (Exception ex)
            {
                Log("focus target failed: " + ex.Message);
            }
        }

        private static AutomationElement FindByRuntimeId(string runtimeId)
        {
            try
            {
                var wanted = SplitRuntimeId(runtimeId);
                if (wanted.Length == 0) return null;
                // Walk from the desktop looking for a matching RuntimeId.
                var root = AutomationElement.RootElement;
                var walker = TreeWalker.RawViewWalker;
                return FindByRuntimeIdRecursive(root, walker, wanted, 0);
            }
            catch (Exception ex)
            {
                Log("find by runtimeId failed: " + ex.Message);
                return null;
            }
        }

        // Bounded DFS: RuntimeId lookup can be slow if we let it scan everything,
        // so cap depth and breadth. The target is almost always near the top.
        private static AutomationElement FindByRuntimeIdRecursive(
            AutomationElement node, TreeWalker walker, int[] wanted, int depth)
        {
            if (node == null || depth > 6) return null;
            var rid = node.GetRuntimeId();
            if (RuntimeIdEquals(rid, wanted)) return node;
            var child = walker.GetFirstChild(node);
            int seen = 0;
            while (child != null && seen < 64)
            {
                var hit = FindByRuntimeIdRecursive(child, walker, wanted, depth + 1);
                if (hit != null) return hit;
                child = walker.GetNextSibling(child);
                seen++;
            }
            return null;
        }

        // =============================================================
        // Input helpers
        // =============================================================
        private static void SendAltTap()
        {
            var seq = new INPUT[2];
            seq[0] = MakeKey(VK_MENU, false);
            seq[1] = MakeKey(VK_MENU, true);
            SendInput(2, seq, Marshal.SizeOf(typeof(INPUT)));
        }

        // Release any modifier keys that the system thinks are held down. The
        // Alt-tap and cross-process AttachThreadInput dance can leave Shift/Ctrl/
        // Alt/Win in a "down" state in the async key state, which corrupts the
        // subsequent Ctrl+V (it becomes Ctrl+Alt+V, Ctrl+Shift+V, etc. and either
        // pastes the wrong thing or nothing). We probe each modifier and send an
        // explicit key-up for whichever are reported down.
        private static void ReleaseStuckModifiers()
        {
            try
            {
                ushort[] mods = {
                    VK_SHIFT, VK_LSHIFT, VK_RSHIFT,
                    VK_CONTROL, VK_LCONTROL, VK_RCONTROL,
                    VK_MENU, VK_LMENU, VK_RMENU,
                    VK_LWIN, VK_RWIN,
                };
                var ups = new System.Collections.Generic.List<INPUT>();
                foreach (var vk in mods)
                {
                    // High-order bit set => physically down right now.
                    if ((GetAsyncKeyState(vk) & 0x8000) != 0)
                    {
                        var up = new INPUT { type = INPUT_KEYBOARD };
                        up.ki.wVk = vk;
                        up.ki.dwFlags = KEYEVENTF_KEYUP;
                        ups.Add(up);
                    }
                }
                if (ups.Count > 0)
                {
                    SendInput((uint)ups.Count, ups.ToArray(), Marshal.SizeOf(typeof(INPUT)));
                    Sleep(40);
                    Log("released " + ups.Count + " stuck modifiers");
                }
            }
            catch (Exception ex)
            {
                Log("release modifiers failed: " + ex.Message);
            }
        }

        private static bool SendCtrlV()
        {
            try
            {
                ReleaseStuckModifiers();
                var seq = new INPUT[4];
                seq[0] = MakeKey(VK_CONTROL, false);
                seq[1] = MakeKey(VK_V, false);
                seq[2] = MakeKey(VK_V, true);
                seq[3] = MakeKey(VK_CONTROL, true);
                uint sent = SendInput(4, seq, Marshal.SizeOf(typeof(INPUT)));
                if (sent != 4) Log("sendctrlv SendInput returned " + sent + "/4");
                return sent == 4;
            }
            catch (Exception ex)
            {
                Log("sendctrlv failed: " + ex.Message);
                return false;
            }
        }

        private static bool SendUnicodeText(AutomationElement target, string text)
        {
            try
            {
                EnsureFocus(target);
                ReleaseStuckModifiers();
                int cb = Marshal.SizeOf(typeof(INPUT));
                // Send in modest batches so we don't blow input-queue limits on long text.
                const int Batch = 64;
                for (int start = 0; start < text.Length; start += Batch)
                {
                    int len = Math.Min(Batch, text.Length - start);
                    var seq = new INPUT[len * 2];
                    for (int i = 0; i < len; i++)
                    {
                        char ch = text[start + i];
                        seq[i * 2] = MakeUnicode(ch, false);
                        seq[i * 2 + 1] = MakeUnicode(ch, true);
                    }
                    SendInput((uint)seq.Length, seq, cb);
                }
                return true;
            }
            catch (Exception ex)
            {
                Log("sendinput unicode failed: " + ex.Message);
                return false;
            }
        }

        private static INPUT MakeKey(ushort vk, bool up)
        {
            var i = new INPUT { type = INPUT_KEYBOARD };
            i.ki.wVk = vk;
            i.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
            return i;
        }

        private static INPUT MakeUnicode(char ch, bool up)
        {
            var i = new INPUT { type = INPUT_KEYBOARD };
            i.ki.wScan = ch;
            i.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
            return i;
        }

        // =============================================================
        // Value / pattern helpers
        // =============================================================
        private static string SafeGetValue(AutomationElement el)
        {
            try
            {
                object pat;
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat))
                {
                    var value = ((ValuePattern)pat).Current.Value;
                    return value ?? "";
                }
            }
            catch { }
            return null;
        }

        // ValuePattern.SetValue REPLACES the entire field content instead of
        // inserting at the caret, so it is only safe (i.e. semantically
        // equivalent to pasting) when the field is empty. In a non-empty field
        // it would wipe whatever the user already typed. We therefore restrict
        // it to empty fields, and verify the value actually became our text.
        private static bool TryValuePattern(AutomationElement el, string text)
        {
            try
            {
                object pat;
                if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat))
                {
                    var vp = (ValuePattern)pat;
                    string current = vp.Current.Value ?? "";
                    if (!string.IsNullOrEmpty(current))
                    {
                        Log("valuepattern skipped: field not empty (" + current.Length + " chars)");
                        return false;
                    }
                    vp.SetValue(text);
                    Sleep(60);
                    string after = vp.Current.Value ?? "";
                    if (Normalize(after) == Normalize(text))
                    {
                        return true;
                    }
                    Log("valuepattern set but value mismatch");
                    return false;
                }
            }
            catch (Exception ex)
            {
                Log("valuepattern failed: " + ex.Message);
            }
            return false;
        }

        // Heuristic: did the control's text actually grow by roughly the inserted
        // length? Cheap, robust signal that the paste landed. Tolerant of small
        // differences (autocomplete, formatting) by checking the tail.
        private static bool ValueGrew(string before, string after, string inserted)
        {
            if (after == null) return false;
            int beforeLen = before == null ? 0 : before.Length;
            int grew = after.Length - beforeLen;
            // The inserted text should appear somewhere near the end (caret moved on).
            if (grew <= 0) return false;
            // Tolerate whitespace/trim differences: check the inserted tail matches.
            string tail = after.Length >= inserted.Length
                ? after.Substring(after.Length - inserted.Length)
                : after;
            return Normalize(tail) == Normalize(inserted) || grew >= inserted.Length * 0.5;
        }

        private static string Normalize(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                if (c == '\r') continue;
                if (c == '\n' || c == '\t' || c == ' ') sb.Append(' ');
                else sb.Append(c);
            }
            return sb.ToString().TrimEnd();
        }

        // =============================================================
        // Capture parse / runtime id utilities
        // =============================================================
        private sealed class Capture
        {
            public IntPtr Hwnd;
            public uint Thread;
            public uint Pid;
            public string Process;
            public string RuntimeId;
        }

        private static Capture ParseCapture(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var c = new Capture();
            long hwnd = ParseLongField(json, "hwnd");
            c.Hwnd = hwnd == 0 ? IntPtr.Zero : new IntPtr(hwnd);
            c.Thread = (uint)ParseLongField(json, "thread");
            c.Pid = (uint)ParseLongField(json, "pid");
            c.Process = ParseStringField(json, "process");
            c.RuntimeId = ParseStringField(json, "runtimeId");
            return c;
        }

        private static long ParseLongField(string json, string field)
        {
            string token = "\"" + field + "\":";
            int i = json.IndexOf(token, StringComparison.Ordinal);
            if (i < 0) return 0;
            i += token.Length;
            int end = i;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) end++;
            long v;
            long.TryParse(json.Substring(i, end - i), out v);
            return v;
        }

        private static string ParseStringField(string json, string field)
        {
            string token = "\"" + field + "\":\"";
            int i = json.IndexOf(token, StringComparison.Ordinal);
            if (i < 0) return "";
            i += token.Length;
            var sb = new StringBuilder();
            while (i < json.Length && json[i] != '"')
            {
                if (json[i] == '\\' && i + 1 < json.Length)
                {
                    char n = json[i + 1];
                    if (n == 'n') sb.Append('\n');
                    else if (n == 't') sb.Append('\t');
                    else if (n == '\\') sb.Append('\\');
                    else if (n == '"') sb.Append('"');
                    else sb.Append(n);
                    i += 2;
                }
                else
                {
                    sb.Append(json[i]);
                    i++;
                }
            }
            return sb.ToString();
        }

        private static string JoinRuntimeId(AutomationElement el)
        {
            var rid = el.GetRuntimeId();
            if (rid == null || rid.Length == 0) return "";
            var sb = new StringBuilder();
            for (int i = 0; i < rid.Length; i++)
            {
                if (i > 0) sb.Append(';');
                sb.Append(rid[i]);
            }
            return sb.ToString();
        }

        private static int[] SplitRuntimeId(string s)
        {
            if (string.IsNullOrEmpty(s)) return new int[0];
            var parts = s.Split(';');
            var list = new List<int>(parts.Length);
            foreach (var p in parts)
            {
                int v;
                if (int.TryParse(p, out v)) list.Add(v);
            }
            return list.ToArray();
        }

        private static bool RuntimeIdEquals(int[] a, int[] b)
        {
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (a[i] != b[i]) return false;
            return true;
        }

        // =============================================================
        // misc
        // =============================================================
        private static void Sleep(int ms) { Thread.Sleep(ms); }

        private static void Log(string msg)
        {
            Console.Out.WriteLine(msg);
        }

        private static void Result(string status, string detail)
        {
            Console.Out.WriteLine("RESULT {\"status\":\"" + status + "\",\"detail\":\"" + Escape(detail) + "\"}");
        }

        private static string Escape(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                if (c == '\\') sb.Append("\\\\");
                else if (c == '"') sb.Append("\\\"");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else if (c < 0x20) { }
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
