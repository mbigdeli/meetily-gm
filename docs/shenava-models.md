# Shenava Persian transcription models

Meetily can optionally download and run three Shenava v1.0 Persian ASR models:

| Model | Parameters | Download | Intended trade-off |
|---|---:|---:|---|
| Koochik | 114M | 458.8 MB | highest accuracy |
| Rizeh | 32M | 116.7 MB | balanced |
| Rizeh Pizeh | 6.9M | 33.2 MB | smallest and fastest |

The app downloads `model.onnx` and `tokens.txt` directly from revision-pinned
Hugging Face repositories. The ONNX payload is verified with SHA-256 before it
is activated. Model binaries are not stored in this repository.

Shenava inference runs in the bundled `shenava-helper` process. Keeping its
sherpa-onnx runtime outside the main application prevents ONNX Runtime version
conflicts with Parakeet. Live recording still uses Meetily's normal
speech-chunk pipeline and emits transcript updates as each chunk completes.

## License and product restriction

The three Shenava v1.0 sherpa-onnx repositories are licensed
**CC-BY-NC-4.0**, independently of Meetily's MIT-licensed application code.

- Attribution to Reza Sayar / Shenava is required.
- Commercial use is prohibited unless the model author grants separate
  permission.
- Selecting or downloading a model does not change the license of Meetily's
  source code, but distribution or use of the model weights remains subject to
  CC-BY-NC-4.0.

Do not enable these model downloads in a paid product, commercial SaaS, or
enterprise deployment without obtaining permission from the model author.

Sources:

- https://huggingface.co/Reza2kn/Shenava-Koochik-v1.0-sherpa-onnx
- https://huggingface.co/Reza2kn/Shenava-Rizeh-v1.0-sherpa-onnx
- https://huggingface.co/Reza2kn/Shenava-Rizeh-Pizeh-v1.0-sherpa-onnx
