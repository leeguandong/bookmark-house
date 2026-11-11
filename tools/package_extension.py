#!/usr/bin/env python3
"""Build a root-manifest ZIP/report. No remote actions, state reset or source edits."""
from pathlib import Path
import argparse
import fnmatch
import hashlib
import json
import os
import tempfile
import zipfile
from release_common import load_manifest,declared_resources,safe_source_path

DEV_DIRS={'node_modules','tests','test','work','coverage','__pycache__','docs','tools'}
DEV_NAMES={'package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','tsconfig.json','readme.md','readme.txt','security.md','agents.md'}
PRIVATE_NAMES={'bookmarks','history','cookies','login data','credentials.json','service-account.json'}


def selected(path,patterns):
    return any(fnmatch.fnmatchcase(path,pattern) for pattern in patterns)


def build(source,output,includes=(),excludes=(),overwrite=False):
    source=Path(source).resolve(); output=Path(output).resolve()
    if not source.is_dir(): raise ValueError('Extension directory does not exist')
    if output.is_relative_to(source): raise ValueError('Place output ZIP outside the source directory')
    manifest=load_manifest(source)
    entries=[]; omitted=[]
    for path in sorted(source.rglob('*')):
        relative=path.relative_to(source).as_posix(); parts=relative.split('/'); low=path.name.lower()
        chosen=selected(relative,includes) if includes else not (
            any(part.startswith('.') or part.lower() in DEV_DIRS for part in parts)
            or low in DEV_NAMES or low.endswith(('.map','.pyc')) or low in {'thumbs.db','.ds_store'})
        if relative=='manifest.json': chosen=True
        if selected(relative,excludes): chosen=False
        if path.is_symlink():
            if chosen: raise ValueError('Refusing symlink: '+relative)
            continue
        if not path.is_file(): continue
        if not path.resolve().is_relative_to(source): raise ValueError('File escaped source directory: '+relative)
        if not chosen:
            omitted.append(relative); continue
        if low.startswith('.env') or low in PRIVATE_NAMES or low.endswith(('.pem','.key','.p12','.pfx')):
            raise ValueError('Remove private/credential data from runtime files: '+relative)
        entries.append((relative,path))
    names={name for name,path in entries}
    if 'manifest.json' not in names: raise ValueError('manifest.json must be included at ZIP root')
    for resource in declared_resources(manifest):
        safe_source_path(source,resource.replace('*','SAFE_GLOB'))
        if not any(fnmatch.fnmatchcase(name,resource) for name in names):
            raise ValueError('Missing or excluded manifest resource: '+resource)
    output.parent.mkdir(parents=True,exist_ok=True)
    descriptor,temporary=tempfile.mkstemp(prefix='.cws-',suffix='.zip',dir=output.parent)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for name,path in entries:
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
                info.external_attr=0o100644<<16
                archive.writestr(info,path.read_bytes())
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None: raise ValueError('ZIP integrity check failed')
        digest=hashlib.sha256(Path(temporary).read_bytes()).hexdigest()
        if output.exists() and hashlib.sha256(output.read_bytes()).hexdigest()!=digest and not overwrite:
            raise ValueError('Different package exists; choose new output or explicitly use --overwrite')
        os.replace(temporary,output)
    finally:
        if Path(temporary).exists(): Path(temporary).unlink()
    report={'version':manifest['version'],'manifest_version':manifest['manifest_version'],'package':str(output),
            'sha256':digest,'bytes':output.stat().st_size,'files':sorted(names),'omitted':omitted,
            'declared_resources_checked':declared_resources(manifest),
            'scope':'Root manifest, declared resources, known private filenames, ZIP CRC. Dynamic dependencies and store compliance require separate checks.'}
    output.with_suffix(output.suffix+'.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True); parser.add_argument('--output',required=True)
    parser.add_argument('--include',action='append',default=[],help='Relative POSIX glob; repeat as needed')
    parser.add_argument('--exclude',action='append',default=[]); parser.add_argument('--overwrite',action='store_true')
    args=parser.parse_args()
    try: report=build(args.source,args.output,args.include,args.exclude,args.overwrite)
    except (ValueError,OSError,json.JSONDecodeError) as error: parser.exit(2,str(error)+'\n')
    print(json.dumps({key:report[key] for key in ('package','version','sha256','bytes')},ensure_ascii=True))


if __name__=='__main__': main()
