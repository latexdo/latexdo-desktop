# Bundled Local Speech Runtime

LatexDo desktop can copy this directory to the packaged app as `speech/`.
The setup wizard can also download the same runtime layout into the user's app
data directory. Electron starts the speech runtime automatically when the user
clicks the microphone; users should not have to configure or launch a server
manually.

Expected packaged layout:

```
speech/
  bin/
    darwin/arm64/whisper-server
    darwin/x64/whisper-server
    linux/x64/whisper-server
    win32/x64/whisper-server.exe
  models/
    ggml-base.en.bin
```

The binary must expose an OpenAI-compatible `/v1/audio/transcriptions`
endpoint and listen on loopback only. During development, set:

- `LATEXDO_SPEECH_ROOT`
- `LATEXDO_SPEECH_SERVER_PATH`
- `LATEXDO_SPEECH_MODEL_PATH`

to test a locally built runtime without copying it into this folder.
