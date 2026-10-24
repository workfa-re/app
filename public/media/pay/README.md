# Workfare Pay bridge motion

## Source and generation

The approved bridge comes from the Workfare Pay design concept `exec-bea09635-14d7-4b97-9f15-c362ed76096c.png`. Its standalone image was prepared as `exec-0aada60e-b965-4f82-a0d5-9ee43627bb3d.png` (1672 × 940 PNG). The unchanged project copy is `workfare-pay-bridge-reference-v2.png`; Higgsfield reference media ID: `3e68f635-5f34-4b9f-b647-d519ffb0d821`.

Exactly one FLUX 3 Video generation was requested on 24 October 2026: job `ca8695ab-0410-4ec9-a674-8d5558198b9b`, quoted cost **50 credits**. The same image was supplied as both start and end frame; request: 2K, five seconds, no audio, one result. Returned master: **2560 × 1440, 24 fps, 121 frames / 5.04 seconds**, H.264, no audio stream. The original 5,433,615-byte master is preserved outside the repository in the local `workfare-pay-family` QA folder. No stock footage, external player, generated UI text or logo is embedded.

## Web assets

- `workfare-pay-bridge-loop-v2-light.mp4` and `workfare-pay-bridge-loop-v2-dark.mp4`: full-resolution 2560 × 1440 H.264, muted, 109 frames / approximately 4.54 seconds, fast-start delivery. Versioned filenames prevent old cached bridge media surviving a deployment.
- The model's first/last frames were not pixel-identical. The web cycle removes the initial half-second settling period and uses a short forward overlap back to its first usable frame. There is **no reversed playback, ping-pong, camera move, geometric warp or second generated clip**. The neutral dark edition grades this same cycle; it is not a separate paid generation.
- `workfare-pay-bridge-v2-light.jpg` and `workfare-pay-bridge-v2-dark.jpg`: 2560 × 1440 matching first-frame fallbacks.

The responsive hero retains the entire arch and both supports. On small screens it removes empty space to the left rather than cropping the sculpture. The decorative video has a 44 px play/pause control, never blocks payment UI, pauses offscreen/in a hidden tab, and initially stays unloaded for reduced motion, data saving or rejected playback. The approved still and matching posters remain usable without playback.

This replaces the earlier unreferenced Kling 3.0 Turbo draft (`c9ac6fa6-e4a5-4882-8618-f86d23ace9b4`, previously quoted at 10 credits). That draft and its old public filenames are no longer shipped.
