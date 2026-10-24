# Workfare Pay depth film

## Generation and source

One Higgsfield video was submitted on 24 October 2026 using Kling 3.0, `mode: 4k`, 8 seconds, 16:9, sound off, count 1. Job: `faa110b9-c429-4d3d-b5ed-685688de2c96`. The quote was **48 credits**; the measured account balance changed from 906 to 858 credits. No additional still, variant, retry or paid upscale was generated.

The returned master is 3840 × 2160, 24 fps, 193 frames / approximately 8.04 seconds, H.264, without audio. It remains outside the repository with the generation request, original result, processing script and QA reports. The requested 4K mode and returned dimensions do not establish how the provider internally renders or upscales its model output.

The brief specifies a moving, spatial macro composition of thick optical glass and dark satin titanium, with visible camera travel and parallax. It excludes an isolated bridge/logo, lettering, money, cards, people and colored glow. The delivered forms are mostly layered optical plates rather than the softer curved bands in the initial concept. This is illustrative generated material imagery, not a depiction of banking functions or a real physical product.

## Delivered media

- `workfare-pay-depth-v4-light.mp4`
- `workfare-pay-depth-v4-dark.mp4`
- `workfare-pay-depth-v4-light.webp`
- `workfare-pay-depth-v4-dark.webp`

Both films are **1920 × 1080, 24 fps, 175 frames / 7.291667 seconds**, H.264 High / yuv420p, limited-range BT.709 matrix, primaries and transfer tags, CRF 22, 175-frame GOP, fast-start MP4, without audio. The long GOP is appropriate for a decorative loop without arbitrary seeking and avoids unnecessary intermediate keyframes. Each lossless WebP comes from the first decoded frame of its final delivery film. Their RGB pixels were verified identical, avoiding a poster-to-playback color jump.

The final files are 3,206,646 bytes (light) and 3,259,727 bytes (dark), approximately 54% smaller than the CRF-16 reference. Full-resolution SSIM against that reference is 0.995900 / 0.996169 overall and 0.993850 / 0.994254 for luma. Glass-edge and brushed-metal detail crops were visually compared; the final grade, geometry, motion and edit remain the same. Compression created no new generation cost.

Both themes use the same generated motion. The local grades remove chroma, use a low-key neutral curve for dark mode and a high-key optical curve for light mode. The light grade raises the original gray field toward white while retaining the moving glass/metal layers. Text contrast and the final page-edge blend belong to the interface composition.

## Loop construction

The original generated film does **not** close seamlessly by itself. Its measured first/last-frame mean absolute RGB difference was 18.82/255 at 320 × 180 review resolution, versus a mean adjacent-frame difference of 2.57/255.

The delivery starts at source frame 18. Its final 13 frames overlap source frames 180–192 with the nearby opening camera views at frames 5–17, using a half-second forward crossfade. The next loop continues naturally from source frame 17 to frame 18. There is no reversed playback, ping-pong, frozen ending, optical-flow synthesis or local geometric warp. The short edit is a composited overlap between forward-moving views, not a claim that the provider generated a perfect native loop.

At the same review resolution, delivery boundary differences are 1.36/255 (light) and 2.64/255 (dark), below the respective mean internal step differences of 1.80 and 3.15. Opening-to-middle differences are 32.05 and 55.68/255, confirming substantial visible movement rather than the earlier near-static illumination treatment. Full frames and decoded continuity were reviewed outside the repository.

## Processing settings

The grade is applied before the forward overlap:

```text
Dark:  hue=s=0,curves=all='0/0 .30/.012 .42/.075 .60/.30 .82/.65 1/.96'
Light: hue=s=0,curves=all='0/1 .25/.97 .4/.9 .58/.68 .8/.85 1/1'
```

The two branches use `trim=start_frame=18:end_frame=193` and `trim=start_frame=5:end_frame=18`, reset timestamps, and explicitly retain 24 fps with the same timebase. They join through `xfade=transition=fade:duration=0.5:offset=6.75`. Delivery is limited to 175 frames. Output uses an explicit BT.709 scale matrix plus x264 VUI and MP4 color tags; posters are lossless derivatives of decoded delivery frame 0.

No source master, intermediate render, contact sheet or debug artifact belongs in this public directory. These four versioned assets replace the prior bridge films.
