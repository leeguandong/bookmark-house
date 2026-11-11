"""Read owned extension artifacts without browser, account or network access."""
from pathlib import Path
import json
import struct


def load_manifest(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
    if not isinstance(manifest, dict) or manifest.get('manifest_version') != 3:
        raise ValueError('This helper supports Manifest V3 extensions; check current store rules for other formats')
    if not isinstance(manifest.get('version'), str) or not manifest['version']:
        raise ValueError('manifest.version is required')
    return manifest


def safe_source_path(root, relative):
    if not isinstance(relative, str) or not relative:
        raise ValueError('Resource path must be a nonempty string')
    if Path(relative).is_absolute() or '\\' in relative or '..' in relative.split('/') or ':' in relative:
        raise ValueError('Unsafe extension resource path: ' + relative)
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Resource escaped extension root: ' + relative)
    return path


def localized(root, manifest, value):
    if isinstance(value, str) and value.startswith('__MSG_') and value.endswith('__'):
        locale = manifest.get('default_locale')
        if not locale:
            raise ValueError('Localized metadata requires default_locale')
        messages = json.loads(safe_source_path(root, '_locales/'+locale+'/messages.json').read_text(encoding='utf-8-sig'))
        key = value[6:-2]
        match = next((v for k,v in messages.items() if k.lower() == key.lower()), {})
        if not isinstance(match.get('message'), str):
            raise ValueError('Missing localized message: '+key)
        return match['message']
    return str(value or '')


def declared_resources(manifest):
    resources=[]
    def add(value):
        if isinstance(value,str) and value:
            resources.append(value)
    for value in manifest.get('icons',{}).values(): add(value)
    for key in ('options_page','devtools_page'): add(manifest.get(key))
    for key,prop in [('options_ui','page'),('background','service_worker'),('side_panel','default_path')]:
        add(manifest.get(key,{}).get(prop))
    action=manifest.get('action',{})
    add(action.get('default_popup'))
    icons=action.get('default_icon',{})
    if isinstance(icons,str): add(icons)
    elif isinstance(icons,dict):
        for value in icons.values(): add(value)
    for value in manifest.get('chrome_url_overrides',{}).values(): add(value)
    for item in manifest.get('content_scripts',[]):
        for key in ('js','css'):
            for value in item.get(key,[]): add(value)
    for item in manifest.get('web_accessible_resources',[]):
        for value in item.get('resources',[]): add(value)
    for value in manifest.get('sandbox',{}).get('pages',[]): add(value)
    return sorted(set(resources))


def image_info(path):
    data=path.read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=24 and data[12:16]==b'IHDR':
        width,height=struct.unpack('>II',data[16:24])
        return 'image/png',width,height
    if data.startswith(b'\xff\xd8'):
        index=2
        while index<len(data):
            if data[index]!=255:
                index+=1
                continue
            while index<len(data) and data[index]==255: index+=1
            if index>=len(data): break
            marker=data[index]; index+=1
            if marker in (0xD8,0xD9,0x01) or 0xD0<=marker<=0xD7: continue
            if index+2>len(data): break
            length=int.from_bytes(data[index:index+2],'big')
            if length<2 or index+length>len(data): break
            if marker in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF) and length>=7:
                height,width=struct.unpack('>HH',data[index+3:index+7])
                return 'image/jpeg',width,height
            index+=length
    raise ValueError('Expected a readable PNG/JPEG image: '+str(path))
