"""Render the Workfare Pay architectural bridge and its periodic studio lighting.

Run with Blender 4.4+: blender -b --python design/pay-bridge/render.py -- \
  --work-dir /absolute/path/outside/repository --output-dir /absolute/path/public/media/pay \
  --ffmpeg /absolute/path/to/ffmpeg --stage all

The camera, geometry, materials and reflection flags never move. Three scene-linear
radiance bases per theme represent a constant rig and two independently dimmed
softboxes. Combine them before AgX, preserving physical light superposition. A fixed
sampling seed makes residual Monte Carlo noise stationary throughout the film.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import bpy
from mathutils import Vector
import numpy as np

WIDTH, HEIGHT, FPS, FRAMES = 1920, 1280, 24, 192
SEED, SAMPLES = 23, 128


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
    parser.add_argument('--stage', choices=['bases', 'compose', 'all'], default='all')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def material(name, color, metallic, roughness, transmission=0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Transmission Weight'].default_value = transmission
    shader.inputs['IOR'].default_value = 1.46
    if metallic:
        shader.inputs['Anisotropic'].default_value = .32
    return result


def brushed_titanium():
    result = material('Dark satin titanium', (.15, .175, .18), .96, .35)
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinate = nodes.new('ShaderNodeTexCoord')
    stretch = nodes.new('ShaderNodeVectorMath')
    stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = (1, 32, 2)
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 190
    noise.inputs['Detail'].default_value = 1
    links.new(coordinate.outputs['Generated'], stretch.inputs[0])
    links.new(stretch.outputs['Vector'], noise.inputs['Vector'])
    roughness = nodes.new('ShaderNodeMapRange')
    roughness.inputs['From Min'].default_value = 0
    roughness.inputs['From Max'].default_value = 1
    roughness.inputs['To Min'].default_value = .335
    roughness.inputs['To Max'].default_value = .365
    links.new(noise.outputs['Fac'], roughness.inputs['Value'])
    links.new(roughness.outputs['Result'], shader.inputs['Roughness'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .035
    bump.inputs['Distance'].default_value = .002
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return result


def finish(obj, mat, bevel=.035):
    obj.data.materials.append(mat)
    modifier = obj.modifiers.new('Precision softened physical edge', 'BEVEL')
    modifier.width, modifier.segments = bevel, 4
    modifier = obj.modifiers.new('Weighted planar normals', 'WEIGHTED_NORMAL')
    modifier.keep_sharp, modifier.weight = True, 30
    return obj


def box(name, location, dimensions, mat, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name, obj.dimensions = name, dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, bevel)


def arch(scene, name, radius_x, radius_z, thickness, center_y, depth, mat):
    """Closed elliptical structural rib, defined analytically rather than traced."""
    segments, vertices = 128, []
    for side in [-1, 1]:
        for inner in [False, True]:
            inset = thickness if inner else 0
            for index in range(segments + 1):
                angle = math.pi * index / segments
                vertices.append(((radius_x - inset) * math.cos(angle),
                                 center_y + side * depth / 2,
                                 -.42 + (radius_z - inset) * math.sin(angle)))
    stride, faces = segments + 1, []
    for index in range(segments):
        for start, end in [(0, 1), (2, 0), (1, 3), (3, 2)]:
            faces.append((start * stride + index, start * stride + index + 1,
                          end * stride + index + 1, end * stride + index))
    faces += [(0, stride, 3 * stride, 2 * stride),
              (segments, 2 * stride + segments, 3 * stride + segments, stride + segments)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    finish(obj, mat, .022)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def aim(obj, target=(0, 0, .8)):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def area(scene, name, location, energy, size, shape='DISK', size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, shape, size
    if size_y is not None:
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    aim(obj)
    return obj


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples, scene.cycles.seed = SAMPLES, SEED
    scene.cycles.use_animated_seed = False
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.max_bounces, scene.cycles.transmission_bounces = 8, 6
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.resolution_percentage, scene.render.fps = 100, FPS
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0
    scene.world = bpy.data.worlds.new('Horizonless studio illumination')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.clear()
    world = scene.world.node_tree.nodes.new('ShaderNodeBackground')
    output = scene.world.node_tree.nodes.new('ShaderNodeOutputWorld')
    scene.world.node_tree.links.new(world.outputs['Background'], output.inputs['Surface'])
    scene.use_nodes = True
    scene.node_tree.nodes.clear()
    layer = scene.node_tree.nodes.new('CompositorNodeRLayers')
    plate = scene.node_tree.nodes.new('CompositorNodeAlphaOver')
    output = scene.node_tree.nodes.new('CompositorNodeComposite')
    scene.node_tree.links.new(layer.outputs['Image'], plate.inputs[2])
    scene.node_tree.links.new(plate.outputs['Image'], output.inputs['Image'])
    devices = {}
    try:
        preferences = bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type = 'METAL'
        preferences.get_devices()
        for device in preferences.devices:
            device.use = device.type == 'METAL'
            devices[device.name] = device.type
        scene.cycles.device = 'GPU' if 'METAL' in devices.values() else 'CPU'
    except Exception as error:
        scene.cycles.device = 'CPU'
        devices['fallback'] = str(error)
    titanium = brushed_titanium()
    glass = material('Solid optical crystal', (.89, .94, .93), 0, .12, 1)
    seam = material('Dark titanium deck seams', (.085, .095, .095), .92, .27)
    arch(scene, 'Rear satin arch rib', 2.52, 2.65, .23, .49, .13, titanium)
    arch(scene, 'Optical crystal arch core', 2.47, 2.60, .19, 0, .86, glass)
    arch(scene, 'Front satin arch rib', 2.52, 2.65, .23, -.49, .13, titanium)
    box('Titanium bridge deck', (0, 0, .30), (4.80, 1.05, .17), titanium, .045)
    box('Cast-glass deck inset', (0, 0, .398), (4.49, .76, .055), glass, .024)
    for x in [-1.10, 0, 1.10]:
        top = -.42 + (2.65 - .23) * math.sqrt(1 - (x / (2.52 - .23)) ** 2)
        for y in [-.49, .49]:
            box(f'Vertical hanger {x} {y}', (x, y, (top + .40) / 2),
                (.12, .12, top - .40), titanium, .018)
        box(f'Deck transverse seam {x}', (x, 0, .445), (.026, .76, .014), seam, .006)
    bpy.ops.object.camera_add(location=(6.2, -11, 6.1))
    camera = bpy.context.object
    camera.name, camera.data.type = 'Locked architectural camera', 'ORTHO'
    camera.data.ortho_scale = 6.8
    aim(camera, (0, 0, .88))
    scene.camera = camera
    area(scene, 'Constant broad overhead', (0, -4, 7), 1100, 9)
    area(scene, 'Constant front fill', (0, -6, 1.8), 140, 5)
    left = area(scene, 'Variable left softbox', (-5, -1, 3), 650, 7, 'RECTANGLE', 3.5)
    right = area(scene, 'Variable right softbox', (4, 3, 4.5), 1000, 7)
    flag_material = material('Negative-fill reflection flags', (.002, .002, .002), 0, .8)
    for name, location, size in [('Left reflection flag', (-4, -2, 3), (3, 5)),
                                  ('Upper reflection flag', (1, 2, 5), (5, 2.5))]:
        bpy.ops.mesh.primitive_plane_add(size=1, location=location)
        flag = bpy.context.object
        flag.name, flag.dimensions = name, (*size, 1)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        aim(flag)
        flag.data.materials.append(flag_material)
        flag.visible_camera = False
    return scene, world, plate, left, right, devices


def set_theme(world, plate, theme):
    if theme == 'dark':
        world.inputs['Color'].default_value = (.009, .012, .011, 1)
        world.inputs['Strength'].default_value = .28
        plate.inputs[1].default_value = (0, 0, 0, 1)
    else:
        world.inputs['Color'].default_value = (.8, .82, .80, 1)
        world.inputs['Strength'].default_value = .12
        # HDR white maps to an exact white display plate after AgX; its intensity
        # is compositing-only and never illuminates the sculpture.
        plate.inputs[1].default_value = (32, 32, 32, 1)


def read_linear_image(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    values = np.empty(WIDTH * HEIGHT * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    color_space = image.colorspace_settings.name
    bpy.data.images.remove(image)
    return values.reshape((HEIGHT, WIDTH, 4)), color_space


def weights(frame):
    phase = 2 * math.pi * (frame % FRAMES) / FRAMES
    change = .25 * math.sin(phase)
    return .70 + change, .70 - change


def pixels_at(a, difference_left, difference_right, frame):
    left, right = weights(frame)
    values = a + left * difference_left + right * difference_right
    values[:, :, :3] = np.maximum(values[:, :, :3], 0)
    values[:, :, 3] = 1
    return values


def save_display(image, values, target, scene):
    image.pixels.foreach_set(values.ravel())
    image.update()
    image.save_render(str(target), scene=scene)


def poster(ffmpeg, frame, target):
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(frame),
                    '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-quality', '100', '-y', str(target)], check=True)


def main():
    args = arguments()
    if not args.ffmpeg:
        raise RuntimeError('Pass an installed FFmpeg executable with --ffmpeg.')
    args.work_dir = args.work_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    repository = Path(__file__).resolve().parents[2]
    if args.work_dir.is_relative_to(repository):
        raise RuntimeError('Keep EXR bases, frames and QA outside the repository.')
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    scene, world, plate, left, right, devices = build_scene()
    report = {'engine': 'Cycles', 'devices': devices, 'samples': SAMPLES, 'seed': SEED,
              'dimensions': [WIDTH, HEIGHT], 'fps': FPS, 'frames': FRAMES,
              'duration_seconds': FRAMES / FPS, 'method': 'scene-linear static light transport bases before AgX',
              'weights': '.70 ± .25*sin(2*pi*frame/192)', 'bases': [], 'films': []}
    if args.stage in ['bases', 'all']:
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.exr_codec = 'ZIP'
        for theme in ['light', 'dark']:
            set_theme(world, plate, theme)
            for name, left_energy, right_energy in [('A', 0, 0), ('B', 650, 0), ('C', 0, 1000)]:
                left.data.energy, right.data.energy = left_energy, right_energy
                target = args.work_dir / f'{theme}-{name}.exr'
                scene.render.filepath = str(target)
                started = time.monotonic()
                bpy.ops.render.render(write_still=True)
                report['bases'].append({'theme': theme, 'basis': name, 'seconds': round(time.monotonic() - started, 2)})
                print(f'BASIS_COMPLETE {theme}-{name}', flush=True)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 20
    for theme in ['light', 'dark']:
        a, color_space = read_linear_image(args.work_dir / f'{theme}-A.exr')
        b, _ = read_linear_image(args.work_dir / f'{theme}-B.exr')
        c, _ = read_linear_image(args.work_dir / f'{theme}-C.exr')
        difference_left, difference_right = b - a, c - a
        del b, c
        image = bpy.data.images.new(f'{theme} scene-linear film', WIDTH, HEIGHT, alpha=True, float_buffer=True)
        image.colorspace_settings.name = color_space
        first = pixels_at(a, difference_left, difference_right, 0)
        boundary = pixels_at(a, difference_left, difference_right, FRAMES)
        if not np.array_equal(first, boundary):
            raise RuntimeError('Analytic loop endpoint mismatch.')
        linear_boundary_hash = hashlib.sha256(first.tobytes()).hexdigest()
        frame_dir = args.work_dir / f'frames-{theme}'
        frame_dir.mkdir(exist_ok=True)
        first_path = frame_dir / '0000.png'
        save_display(image, first, first_path, scene)
        poster_path = args.output_dir / f'workfare-pay-bridge-v3-{theme}.webp'
        poster(args.ffmpeg, first_path, poster_path)
        print(f'POSTER_COMPLETE {poster_path}', flush=True)
        if args.stage in ['compose', 'all']:
            started = time.monotonic()
            for frame in range(1, FRAMES):
                save_display(image, pixels_at(a, difference_left, difference_right, frame),
                             frame_dir / f'{frame:04d}.png', scene)
                if frame % 24 == 0:
                    print(f'COMPOSITE_PROGRESS {theme} {frame}/{FRAMES}', flush=True)
            video_path = args.output_dir / f'workfare-pay-bridge-v3-{theme}.mp4'
            subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-framerate', str(FPS),
                            '-i', str(frame_dir / '%04d.png'), '-frames:v', str(FRAMES), '-an',
                            '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-g', '48', '-pix_fmt', 'yuv420p',
                            '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
                            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                            '-movflags', '+faststart+write_colr', '-y', str(video_path)], check=True)
            decoded_first = args.work_dir / f'{theme}-decoded-first.png'
            subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(video_path),
                            '-frames:v', '1', '-pix_fmt', 'rgb24', '-y', str(decoded_first)], check=True)
            poster(args.ffmpeg, decoded_first, poster_path)
            report['films'].append({'theme': theme, 'seconds': round(time.monotonic() - started, 2),
                                    'linear_endpoint_hash': linear_boundary_hash,
                                    'path': str(video_path), 'bytes': video_path.stat().st_size})
            print(f'FILM_COMPLETE {video_path}', flush=True)
        bpy.data.images.remove(image)
    report_path = args.work_dir / f'{args.stage}-report.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'RENDER_COMPLETE {report_path}', flush=True)


if __name__ == '__main__':
    main()
