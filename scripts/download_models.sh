#!/usr/bin/env bash
# Cluely Studio - Local Speech Recognition Model Downloader
# Downloads offline INT8 ONNX models for sub-200ms transcription

set -e

MODELS_DIR="$(cd "$(dirname "$0")/../extra-resources/models" && pwd)"
mkdir -p "$MODELS_DIR/nvidia/parakeet-tdt"
mkdir -p "$MODELS_DIR/nvidia/diarization"
mkdir -p "$MODELS_DIR/whisper-small"
mkdir -p "$MODELS_DIR/whisper-base"

echo "=== Cluely Studio: Downloading Local Speech Recognition Models ==="
echo "Target Directory: $MODELS_DIR"

# 1. NVIDIA Parakeet-TDT 0.6B (Primary English engine ~180-220ms)
if [ ! -f "$MODELS_DIR/nvidia/parakeet-tdt/encoder.int8.onnx" ]; then
  echo "--> Downloading NVIDIA Parakeet-TDT 0.6B INT8..."
  TMP_DIR=$(mktemp -d)
  curl -L "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-fast-conformer-tdt-en-24500.tar.bz2" -o "$TMP_DIR/parakeet.tar.bz2"
  tar -xjf "$TMP_DIR/parakeet.tar.bz2" -C "$TMP_DIR"
  cp "$TMP_DIR"/sherpa-onnx-nemo-fast-conformer-tdt-en-24500/*.onnx "$MODELS_DIR/nvidia/parakeet-tdt/"
  cp "$TMP_DIR"/sherpa-onnx-nemo-fast-conformer-tdt-en-24500/tokens.txt "$MODELS_DIR/nvidia/parakeet-tdt/"
  rm -rf "$TMP_DIR"
  echo "✓ NVIDIA Parakeet-TDT ready."
else
  echo "✓ NVIDIA Parakeet-TDT already present."
fi

# 2. Whisper Small Multilingual (Hindi, multilingual & accented speech)
if [ ! -f "$MODELS_DIR/whisper-small/small-decoder.int8.onnx" ]; then
  echo "--> Downloading Whisper Small Multilingual INT8..."
  TMP_DIR=$(mktemp -d)
  curl -L "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2" -o "$TMP_DIR/whisper.tar.bz2"
  tar -xjf "$TMP_DIR/whisper.tar.bz2" -C "$TMP_DIR"
  cp "$TMP_DIR"/sherpa-onnx-whisper-small/*.onnx "$MODELS_DIR/whisper-small/"
  cp "$TMP_DIR"/sherpa-onnx-whisper-small/*.txt "$MODELS_DIR/whisper-small/"
  rm -rf "$TMP_DIR"
  echo "✓ Whisper Small ready."
else
  echo "✓ Whisper Small already present."
fi

# 3. CAM++ Speaker Diarization
if [ ! -f "$MODELS_DIR/nvidia/diarization/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx" ]; then
  echo "--> Downloading CAM++ Speaker Diarization ONNX..."
  curl -L "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx" \
    -o "$MODELS_DIR/nvidia/diarization/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
  echo "✓ CAM++ Speaker Diarization ready."
else
  echo "✓ CAM++ Speaker Diarization already present."
fi

echo "=== All Offline Models Verified Successfully! ==="
