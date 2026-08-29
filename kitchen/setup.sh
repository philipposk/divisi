#!/usr/bin/env bash
# One-time setup for the Divisi kitchen.
#
# Builds a self-contained conda env, clones the separation toolkit, and fetches
# the two model checkpoints. Everything lands under kitchen/ and nothing here is
# ever deployed or committed — the checkpoints in particular stay on this Mac.
#
#   bash kitchen/setup.sh
#
# Safe to re-run: each step is skipped if it is already done.

set -euo pipefail

KITCHEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="${DIVISI_ENV:-divisi}"
MSST="$KITCHEN/vendor/Music-Source-Separation-Training"
MODELS="$KITCHEN/models"

say() { printf "\n\033[1;32m==>\033[0m %s\n" "$*"; }
warn() { printf "\n\033[1;33m!!\033[0m %s\n" "$*"; }
die() { printf "\n\033[1;31mxx\033[0m %s\n" "$*" >&2; exit 1; }

command -v ffmpeg >/dev/null || die "ffmpeg not found. Install it:  brew install ffmpeg"
command -v conda >/dev/null || die "conda not found. Install Miniconda or Anaconda first."

# shellcheck disable=SC1091
source "$(conda info --base)/etc/profile.d/conda.sh"

say "conda env: $ENV_NAME"
if conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "already exists, reusing"
else
  conda create -y -n "$ENV_NAME" python=3.10
fi
conda activate "$ENV_NAME"

say "Separation toolkit"
if [ -d "$MSST/.git" ]; then
  echo "already cloned"
else
  mkdir -p "$KITCHEN/vendor"
  git clone --depth 1 https://github.com/ZFTurbo/Music-Source-Separation-Training "$MSST"
fi

say "Python packages (this is the slow part — torch is ~1 GB)"
python -m pip install --upgrade pip >/dev/null
python -m pip install torch torchaudio

# The toolkit's requirements are written for training on Linux boxes. Several
# entries are a desktop GUI, a CUDA-only kernel, or an experiment tracker — none
# of which inference touches, and wxpython in particular has no macOS ARM wheel
# and takes the whole install down with it.
SKIP='wxpython|keyboard|sageattention|bitsandbytes|wandb|moises-light|pyaudio'
grep -Ev "^($SKIP)" "$MSST/requirements.txt" | grep -Ev "^\s*(#|$)" > "$KITCHEN/requirements-inference.txt"
python -m pip install -r "$KITCHEN/requirements-inference.txt"
# librosa still reaches for pkg_resources, which python 3.12-era setuptools drops
python -m pip install "setuptools<81"
python -m pip install "huggingface_hub[cli]" hf_transfer

mkdir -p "$MODELS/vocals" "$MODELS/satb"

say "Vocals model (separates singing from accompaniment)"
VOCALS_CKPT="$MODELS/vocals/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
if [ -s "$VOCALS_CKPT" ]; then
  echo "already downloaded"
else
  echo "~960 MB, this takes a few minutes"
  curl -fL --retry 8 --retry-delay 3 --retry-all-errors -C - --progress-bar -o "$VOCALS_CKPT.part" \
    "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt" \
    && mv "$VOCALS_CKPT.part" "$VOCALS_CKPT" \
    || warn "vocals checkpoint failed to download — the SATB step still works on a cappella recordings"
fi

say "SATB model (splits four-part singing into S/A/T/B)"
# Hugging Face LFS throttles; hf_transfer plus the retry loop is what makes this
# finish rather than stalling half way through a 42 MB file.
export HF_HUB_ENABLE_HF_TRANSFER=1
if [ -s "$MODELS/satb/model_scnet_masked_ep_14_sdr_6.9052.ckpt" ]; then
  echo "already downloaded"
else
  for attempt in 1 2 3; do
    if hf download rbustos89/scnetmskedchoir --local-dir "$MODELS/satb" 2>/dev/null \
      || huggingface-cli download rbustos89/scnetmskedchoir --local-dir "$MODELS/satb"; then
      break
    fi
    warn "attempt $attempt failed, retrying"
  done
fi

say "What landed"
find "$MODELS" -type f \( -name '*.ckpt' -o -name '*.yaml' \) -exec ls -lh {} \; | awk '{print $5, $9}'

cat <<EOF

Done. Split a recording with:

  conda activate $ENV_NAME
  python kitchen/run.py /path/to/recording.wav --title "Fauré — Sanctus"

Results land in ~/Divisi/<title>/ — open that folder in the web player,
or just upload the MP3s to Drive and send the choir the link.
EOF
