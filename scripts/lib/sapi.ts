// Windows SAPI text-to-speech through Windows PowerShell 5.1 (System.Speech is a .NET Framework
// assembly; PowerShell 7 does not ship it). See docs/research/audio-tooling.md §7.
// Text, voice and output path travel in environment variables and the script is passed with
// -EncodedCommand, so quotes, `$()` and `&` in the text are spoken literally (no injection) and no
// execution-policy change or .ps1 file is needed.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { wavToMp3 } from "./mp3-encode";

const execFileAsync = promisify(execFile);

export interface SapiVoice {
  name: string;
  culture: string;
  gender: string;
}

export type SapiProbe = { available: true; voices: SapiVoice[] } | { available: false; reason: string };

export class SapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SapiError";
  }
}

const LIST_VOICES_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  foreach ($v in $s.GetInstalledVoices()) {
    if ($v.Enabled) { [Console]::Out.WriteLine(($v.VoiceInfo.Name, $v.VoiceInfo.Culture.Name, $v.VoiceInfo.Gender) -join '|') }
  }
} finally { $s.Dispose() }
`;

const SPEAK_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $s.SelectVoice($env:SAPI_VOICE)
  $s.Rate = [int]$env:SAPI_RATE
  $s.Volume = 100
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo([int]$env:SAPI_SAMPLE_RATE, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($env:SAPI_OUT, $fmt)
  $s.Speak($env:SAPI_TEXT)
  $s.SetOutputToNull()
  [Console]::Out.Write($s.Voice.Name)
} finally { $s.Dispose() }
`;

function encodeCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** First meaningful lines of a failed PowerShell run, for an honest error message. */
function describeFailure(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, stderr, message } = error as { code?: unknown; stderr?: unknown; message?: unknown };
    if (code === "ENOENT") return "powershell.exe was not found on PATH";
    const text = typeof stderr === "string" && stderr.trim() ? stderr : typeof message === "string" ? message : "";
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#< CLIXML") && !line.startsWith("At line:") && !line.startsWith("+"));
    if (lines.length > 0) return lines.slice(0, 2).join(" ").slice(0, 300);
  }
  return String(error);
}

async function runPowerShell(script: string, env: Record<string, string>, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeCommand(script)],
    { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, encoding: "utf8" },
  );
  return stdout;
}

/** Whether SAPI speech works here, and which voices are installed. Never throws. */
export async function probeSapi(): Promise<SapiProbe> {
  if (process.platform !== "win32") {
    return { available: false, reason: `Windows SAPI is only available on Windows (this is ${process.platform})` };
  }
  try {
    const stdout = await runPowerShell(LIST_VOICES_PS, {}, 30_000);
    const voices = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, culture = "", gender = ""] = line.split("|");
        return { name, culture, gender };
      });
    if (voices.length === 0) return { available: false, reason: "no Windows SAPI voices are installed" };
    return { available: true, voices };
  } catch (error) {
    return { available: false, reason: `Windows SAPI is unavailable: ${describeFailure(error)}` };
  }
}

/**
 * The installed voice to use: the preferred one when installed (exact name, or a name containing it,
 * e.g. "David" ⇒ "Microsoft David Desktop"), else the first installed English voice, else the first voice.
 */
export function chooseVoice(preferred: string, installed: SapiVoice[]): string | null {
  const wanted = preferred.toLowerCase();
  const match =
    installed.find((voice) => voice.name.toLowerCase() === wanted) ??
    installed.find((voice) => voice.name.toLowerCase().includes(wanted));
  return (match ?? installed.find((voice) => voice.culture.toLowerCase().startsWith("en")) ?? installed[0])?.name ?? null;
}

export interface SpeakOptions {
  /** Exact installed voice name, e.g. "Microsoft Zira Desktop". */
  voice: string;
  /** -10..10, default 0. */
  rate?: number;
  /** WAV sample rate SAPI renders at. Default 22050 (resampled to 44.1 kHz for the MP3). */
  sampleRate?: number;
}

/** Speaks `text` to a 16-bit mono WAV. Throws SapiError with the reason on failure. */
export async function synthesizeSpeechWav(text: string, options: SpeakOptions): Promise<{ wav: Uint8Array; voice: string }> {
  if (process.platform !== "win32") throw new SapiError("Windows SAPI is only available on Windows");
  if (!text.trim()) throw new SapiError("Nothing to speak: the text is empty");
  const rate = options.rate ?? 0;
  if (!Number.isInteger(rate) || rate < -10 || rate > 10) throw new SapiError("SAPI rate must be an integer from -10 to 10");
  const dir = await mkdtemp(join(tmpdir(), "venue-radio-sapi-"));
  const out = join(dir, "speech.wav");
  try {
    const voice = await runPowerShell(
      SPEAK_PS,
      {
        SAPI_TEXT: text,
        SAPI_OUT: out,
        SAPI_VOICE: options.voice,
        SAPI_RATE: String(rate),
        SAPI_SAMPLE_RATE: String(options.sampleRate ?? 22050),
      },
      60_000,
    );
    const wav = new Uint8Array(await readFile(out));
    if (wav.length <= 44) throw new SapiError("SAPI produced an empty WAV file");
    return { wav, voice: voice.trim() || options.voice };
  } catch (error) {
    if (error instanceof SapiError) throw error;
    throw new SapiError(`SAPI speech failed: ${describeFailure(error)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Speech as a 44.1 kHz / 128 kbps mono MP3, loudness-normalised to -16 LUFS / -1 dBFS. */
export async function speakToMp3(text: string, options: SpeakOptions): Promise<{ mp3: Uint8Array; voice: string }> {
  const { wav, voice } = await synthesizeSpeechWav(text, options);
  return { mp3: wavToMp3(wav, { sampleRate: 44100, kbps: 128 }), voice };
}
