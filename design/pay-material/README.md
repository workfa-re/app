# Workfare Pay material film

Two complete optical-glass plates with machined titanium edges and a small maker's
mark traced from `public/brand/workfare-mark-light.png`. There are no account
balances, card numbers, payment-method logos or claims about financial products.

The fixed orthographic camera keeps the whole silhouette visible in a 4:3 frame.
Light and dark use the same mesh, materials and camera with different real,
stationary studio lighting. Background compositing matches the application:
RGB 244 in light mode and RGB 9 in dark mode. Rendered object contrast is retained.

## Motion and rendering

- Native 1024 × 768, **12 fps**, 240 frames / 20 seconds, silent H.264/BT.709.
- Blender Cycles, Metal where available, 16 samples, six total/four transmission
  bounces, fixed seed 71, adaptive sampling and denoising.
- Real rigid translation and rotation; no generated/interpolated frames, warped
  silhouettes, optical flow, changing light-only frames or camera fly-through.
- With `q = (1 − cos(2πt / 20)) / 2`, plate separation is `0.34 + 0.32q` scene
  units. Front/rear tilt is `1.1q` / `−0.7q` degrees. Both turning points have
  zero velocity. Geometry and the number of parts never change.
- Positions at `t` and `20 − t` are analytically identical. The renderer produces
  121 distinct poses per theme; the encoder reuses only those exact same poses
  for the second half of the physical cycle. This is not reversal of a generated
  clip. An independently rendered quarter-/three-quarter-cycle proof differed
  by at most 1/255 per 8-bit channel (mean 0.00231), consistent with render rounding.
- The source-frame set never repeats the endpoint. The final WebP poster is
  extracted from the encoded first frame, with a pixel-exact decode comparison.

## Reproduce

Use a **new private work directory outside the repository** for a source/settings
change. Blender 4.4.3 and a Python interpreter with Pillow/NumPy are required;
encoding uses an explicit FFmpeg executable with libx264. No paid or external
generation service is used.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b \
  --python design/pay-material/render.py -- \
  --work-dir /absolute/private/render-directory \
  --output /absolute/checkout/public/media/pay/v5 \
  --python /absolute/path/to/python3 \
  --ffmpeg /absolute/path/to/ffmpeg
```

The script first creates both temporary layout posters. After each completed
theme, it encodes the video, atomically replaces that poster with its exact
decoded first frame and writes a compact delivery report. Reports verify native
frame count, visible five-second motion, loop-boundary difference, poster equality
and the five-megabyte-per-film limit. RGBA masters, timings and transforms stay
in the private work directory, outside the checkout.
