# Workfare Pay architectural bridge

The v3 media is rendered from the reproducible Blender source in `design/pay-bridge/render.py`. It uses analytical 3D geometry, physically based titanium/crystal materials and studio lights. No image/video generation service, stock media, portfolio video or paid generation credit is used for this version.

## Art direction

The bridge has two structural arch ribs, a solid optical-crystal core, an integrated deck and three upright pairs. Its proportions echo Workfare's bridge identity while exposing actual architectural depth. The sculpture floats against a homogeneous, horizonless plate; there is no floor, pedestal, separate industrial foot, text or embedded UI.

The material and integration reference is the `r-yalcin/rezan-works` implementation: rigid product geometry, dark satin industrial materials, restrained optical highlights, isolated media and calm movement. Its personal monogram, green tint and footage are not reused. Dark titanium has static anisotropic microstructure and softened physical edges; camera-invisible negative-fill flags preserve contrast in the light version.

## Physical lighting loop

The camera, sculpture, materials and reflection flags remain fixed. For each theme, Cycles renders three scene-linear 32-bit EXR radiance bases at 1920 × 1280, 128 samples, with fixed seed 23:

- **A:** constant studio rig and illumination world.
- **B:** the same scene plus the left softbox.
- **C:** the same scene plus the right softbox.

Each film frame combines `A + wL × (B − A) + wR × (C − A)` before Blender's AgX display transform. With `t = frame / 192`, the weights are `wL = 0.70 + 0.25 sin(2πt)` and `wR = 0.70 − 0.25 sin(2πt)`. This applies scene-linear light superposition to fixed, denoised Monte Carlo render bases; no generated intermediate geometry or optical-flow interpolation is involved. The illumination is cyclic with matching value and velocity at the boundary. The source verifies bit-identical composed linear arrays at frames 0 and 192; the delivered film contains frames 0–191.

There is no reversed sequence, ping-pong, crossfade between views, morphing, image rotation, animated noise seed or camera movement. Both modes use the same projection and physical geometry, each with its own studio illumination and an exact white/black display plate.

## Web delivery

- `workfare-pay-bridge-v3-light.mp4`
- `workfare-pay-bridge-v3-dark.mp4`
- `workfare-pay-bridge-v3-light.webp`
- `workfare-pay-bridge-v3-dark.webp`

The MP4s are 1920 × 1280 (3:2), 24 fps, exactly 192 frames / 8 seconds, H.264/yuv420p, without audio, with front-loaded metadata and explicit BT.709 matrix, primaries and transfer tags. Encoding uses CRF 14 with a 48-frame GOP. Each lossless WebP poster is derived from the matching first decoded delivery frame, so poster and film start with the same display pixels. Versioned filenames prevent cached previous bridge media surviving a release.

## Reproduction

Use Blender 4.4 or later and an installed FFmpeg executable with libx264 and libwebp. Pass an absolute work directory outside the repository; the script rejects an in-repository work directory. EXR bases, intermediate PNG frames and render reports stay there. Metal is selected when available; CPU is the fallback.

```sh
blender -b --python design/pay-bridge/render.py -- \
  --work-dir /absolute/external/workfare-pay-render \
  --output-dir /absolute/repository/public/media/pay \
  --ffmpeg /absolute/path/to/ffmpeg \
  --stage all
```

`--stage bases` produces the six EXRs and two static preview posters first. `--stage compose` reuses those bases to create the films without further Cycles rendering. No `.blend`, EXR or QA artifact belongs in the public media directory.
