"""Render Workfare Pay's two rigid material plates; no paid or generative API.

Run with Blender, then pass the bundled helper a Python interpreter with Pillow
and NumPy. All costly intermediates belong outside the checkout. See README.md.
"""
import argparse
import bpy
import bmesh
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--work-dir', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--ffmpeg', required=True)
parser.add_argument('--python', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
WIDTH, HEIGHT, FPS, DURATION = 1024, 768, 12, 20
FRAMES = FPS * DURATION
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
Path(args.work_dir).mkdir(parents=True, exist_ok=True)
Path(args.output).mkdir(parents=True, exist_ok=True)
helper = HERE / 'encode.py'
fingerprint = hashlib.sha256()
for source in [Path(__file__), helper, REPO/'public/brand/workfare-mark-light.png']:
    fingerprint.update(source.read_bytes())
manifest = {'source_sha256': fingerprint.hexdigest(), 'dimensions': [WIDTH, HEIGHT], 'fps': FPS}
manifest_path = Path(args.work_dir)/'source-manifest.json'
if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
    raise ValueError('Use a new private work directory after changing render sources')
manifest_path.write_text(json.dumps(manifest, indent=2))
subprocess.run([args.python, str(helper), 'trace', '--source', str(REPO/'public/brand/workfare-mark-light.png'), '--output', str(Path(args.work_dir)/'workfare-mark-contour.json')], check=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.film_transparent = True
scene.render.fps = FPS
scene.frame_start = 0
scene.frame_end = FRAMES-1
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0
scene.render.use_persistent_data = True
devices = {}
scene.cycles.samples = 16
scene.cycles.seed = 71
scene.cycles.use_animated_seed = False
scene.cycles.use_denoising = True
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = .035
scene.cycles.max_bounces = 6
scene.cycles.transmission_bounces = 4
scene.cycles.transparent_max_bounces = 8
scene.cycles.film_transparent_glass = False
scene.cycles.film_transparent_roughness = .2
scene.cycles.denoising_use_gpu = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    devices = {device.name: device.type for device in prefs.devices}
    scene.cycles.device = 'GPU' if any(device.type == 'METAL' for device in prefs.devices) else 'CPU'
except Exception as error:
    scene.cycles.device = 'CPU'
    devices = {'fallback': str(error)}
world = bpy.data.worlds.new('Neutral horizonless studio')
world.use_nodes = True
scene.world = world
world.node_tree.nodes.clear()
world_bsdf = world.node_tree.nodes.new('ShaderNodeBackground')
world_output = world.node_tree.nodes.new('ShaderNodeOutputWorld')
world.node_tree.links.new(world_bsdf.outputs['Background'],world_output.inputs['Surface'])

def material(name, color, metallic=0, roughness=.2, transmission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    node.inputs['IOR'].default_value = 1.46
    node.inputs['Transmission Weight'].default_value = transmission
    node.inputs['Coat Weight'].default_value = .16
    if metallic:
        node.inputs['Anisotropic'].default_value = .28
    return mat

titanium = material('Satin titanium frame — no procedural noise', (.45, .47, .5), .94, .245)
glass = material('Solid optical glass — actual thickness', (.84, .88, .89), 0, .055, .96)
glass.use_raytrace_refraction = True
logo_material = material('Small satin-silver Workfare maker mark', (.62, .65, .68), .92, .32)

def rounded_loop(width, height, radius, segments=16):
    points = []
    for cx, cy, start in [(width / 2-radius, height/2-radius, 0),
                           (-width/2+radius, height/2-radius, math.pi/2),
                           (-width/2+radius, -height/2+radius, math.pi),
                           (width/2-radius, -height/2+radius, 3*math.pi/2)]:
        for index in range(segments):
            angle = start + index / segments * math.pi/2
            points.append((cx+radius*math.cos(angle), cy+radius*math.sin(angle)))
    return points

def create_mesh(name, vertices, faces, mat, parent, bevel=0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    if bevel:
        mod = obj.modifiers.new('Small machined edge radius', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod = obj.modifiers.new('Stable planar weighted normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 30
    return obj

def solid(name, width, height, radius, depth, mat, parent, z=0):
    outline = rounded_loop(width, height, radius)
    count = len(outline)
    vertices = [(x,y,z-depth/2) for x,y in outline] + [(x,y,z+depth/2) for x,y in outline]
    faces = [tuple(range(count-1,-1,-1)), tuple(range(count,2*count))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return create_mesh(name,vertices,faces,mat,parent,.014)

def rim(name, width, height, radius, thickness, depth, parent):
    outer = rounded_loop(width,height,radius)
    inner = rounded_loop(width-2*thickness,height-2*thickness,radius-thickness)
    count = len(outer)
    vertices = [(x,y,z) for z in [-depth/2,depth/2] for outline in [outer,inner] for x,y in outline]
    faces = []
    for i in range(count):
        j=(i+1)%count
        # Outside wall, inside wall, lower ring, upper ring.
        faces += [(i,j,j+2*count,i+2*count),(i+count,i+3*count,j+3*count,j+count),
                  (i,i+count,j+count,j),(i+2*count,j+2*count,j+3*count,i+3*count)]
    return create_mesh(name,vertices,faces,titanium,parent,.012)

# Image-derived logo contour is prepared from the actual existing Workfare alpha mask.
# Each point lies on the front face, so this reads as a small engraved maker mark.
with open(os.path.join(args.work_dir, 'workfare-mark-contour.json')) as handle:
    logo = json.load(handle)

plates=[]
for index in range(2):
    assembly = bpy.data.objects.new(('Front' if index == 0 else 'Rear')+' complete plate', None)
    scene.collection.objects.link(assembly)
    plates.append(assembly)
    rim(assembly.name+' titanium edge',3.85,2.5,.27,.075,.145,assembly)
    solid(assembly.name+' optical-glass pane',3.70,2.35,.195,.115,glass,assembly)
    if index == 0:
        # Exact source outline, small enough to remain a maker's mark.
        curve=bpy.data.curves.new('Exact Workfare alpha-outline, holes preserved','CURVE')
        curve.dimensions='2D'
        curve.fill_mode='BOTH'
        curve.resolution_u=1
        curve.extrude=.0006
        for shape in logo['contours']:
            spline=curve.splines.new('POLY')
            spline.points.add(len(shape)-1)
            for point,(x,y) in zip(spline.points,shape):
                point.co=(-1.23+x*.47,-.71+y*.47,0,1)
            spline.use_cyclic_u=True
        mark=bpy.data.objects.new('Small original Workfare maker mark',curve)
        scene.collection.objects.link(mark)
        mark.parent=assembly
        mark.location.z=.079
        curve.materials.append(logo_material)

def pose(frame):
    # Canonical symmetric phase: every repeated pose has the same numeric input.
    # This is rigid analytic geometry, not reversal of a generated movie.
    phase_index=frame%FRAMES
    phase_index=min(phase_index,FRAMES-phase_index)
    phase=2*math.pi*phase_index/FRAMES
    travel=(1-math.cos(phase))/2
    # Each complete rigid object moves along the shared depth axis.
    # Camera and all lights remain perfectly fixed throughout the full period.
    depth=.34+.32*travel
    plates[0].location=(-.02,-.12,depth/2)
    plates[1].location=(.10,.20,-depth/2)
    plates[0].rotation_euler=(0, math.radians(1.1)*travel, math.radians(-7))
    plates[1].rotation_euler=(0, math.radians(-.7)*travel, math.radians(-7))
    bpy.context.view_layer.update()

def track(obj, target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

bpy.ops.object.camera_add(location=(4.4,-6.1,7.8))
camera=bpy.context.object
camera.name='Fixed orthographic product camera'
camera.data.type='ORTHO'
camera.data.ortho_scale=5.9
track(camera,(0,0,0))
scene.camera=camera

def softbox(name, location, energy, width, height):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.shape='RECTANGLE'
    data.size=width
    data.size_y=height
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=location
    track(obj,(0,0,0))
    return obj

key=softbox('Large stable top-left softbox',(-3,-4,7),900,5,3)
edge=softbox('Narrow stable right edge light',(4,2,4),800,3.5,1.3)
fill=softbox('Quiet front reflector',(0,-5,1),160,4,3)
top=softbox('Top satin reflection strip',(-1,3,5),650,4,1.0)


def lighting(theme):
    # The material and geometry are shared. Only real, fixed studio lighting differs.
    if theme == 'light':
        world_bsdf.inputs['Color'].default_value=(.7,.7,.7,1)
        world_bsdf.inputs['Strength'].default_value=.28
        key.data.energy=950; edge.data.energy=650; fill.data.energy=120; top.data.energy=500
    else:
        world_bsdf.inputs['Color'].default_value=(.018,.018,.018,1)
        world_bsdf.inputs['Strength'].default_value=.4
        key.data.energy=800; edge.data.energy=1000; fill.data.energy=70; top.data.energy=700

report = {'engine':'CYCLES','resolution':[WIDTH,HEIGHT],'samples':16,
          'max_bounces':6,'transmission_bounces':4,'seed':71,'devices':devices,
          'fps':FPS,'duration_seconds':DURATION,'unique_poses_per_theme':FRAMES//2+1,
          'motion':'fixed camera/lights, analytic rigid cosine depth and rotation',
          'frames':[]}
report_path=Path(args.work_dir)/'render-report.json'

def render_frame(theme, frame):
    lighting(theme)
    pose(frame)
    directory=Path(args.work_dir)/theme
    directory.mkdir(exist_ok=True)
    path=directory/f'frame-{frame:03d}.png'
    # Resume only a complete PNG at the requested dimensions. Use a fresh work
    # directory when changing source/settings; never overwrite another job's files.
    if not path.exists():
        temporary = path.with_name(path.stem+'.partial.png')
        scene.render.filepath=str(temporary)
        started=time.monotonic()
        bpy.ops.render.render(write_still=True)
        temporary.replace(path)
        elapsed=round(time.monotonic()-started,3)
    else:
        header=path.read_bytes()[:24]
        if (header[:8] != b'\x89PNG\r\n\x1a\n'
                or int.from_bytes(header[16:20],'big') != WIDTH
                or int.from_bytes(header[20:24],'big') != HEIGHT):
            raise ValueError('Invalid cached render frame')
        elapsed=0
    transforms={plate.name:[list(row) for row in plate.matrix_world] for plate in plates}
    item={'theme':theme,'frame':frame,'seconds':elapsed,'transforms':transforms}
    report['frames'].append(item)
    report_path.write_text(json.dumps(report,indent=2))
    print('WORKFARE_MATERIAL_FRAME '+json.dumps({'theme':theme,'frame':frame,'seconds':elapsed}),flush=True)
    return path

# Make both exact-geometry frame-zero posters available before the full sequence.
for theme in ['light','dark']:
    path=render_frame(theme,0)
    subprocess.run([args.python,str(helper),'poster','--source',str(path),'--theme',theme,
                    '--output',str(Path(args.output)/f'workfare-pay-material-v5-{theme}.webp')],check=True)
    print('WORKFARE_PROVISIONAL_POSTER '+theme,flush=True)

for theme in ['light','dark']:
    for frame in range(1,FRAMES//2+1):
        render_frame(theme,frame)
    # min(i, N-i) reuses only an analytically identical 3D pose, not an
    # interpolated/generated frame. The two cosine turning points have zero speed.
    subprocess.run([args.python,str(helper),'encode','--frames',str(Path(args.work_dir)/theme),
                    '--theme',theme,'--output',args.output,'--ffmpeg',args.ffmpeg],check=True)
    print('WORKFARE_FINAL_THEME '+theme,flush=True)
print('WORKFARE_MATERIAL_COMPLETE',flush=True)
