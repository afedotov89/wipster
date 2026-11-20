#!/usr/bin/env python3
"""Validate docker-save metadata without extracting or logging configuration."""
import argparse
import re
import hashlib
import json
import sys
import tarfile
from pathlib import PurePosixPath

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('path'); parser.add_argument('source'); parser.add_argument('image')
parser.add_argument('--json', action='store_true', dest='machine')
args = parser.parse_args()
path, source, image = args.path, args.source, args.image
assert re.fullmatch(r'[0-9a-f]{40}', source), 'Invalid source'
assert re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'Invalid config identity'
oci_digest = None
with tarfile.open(path, 'r:gz') as archive:
    members = []
    expanded_size = 0
    for m in archive:
        members.append(m)
        expanded_size += m.size
        assert len(members) <= 5000, 'Too many archive entries'
        assert expanded_size <= 1536 * 1024 * 1024, 'Archive expands too far'
        p = PurePosixPath(m.name)
        assert not p.is_absolute() and '..' not in p.parts, 'Unsafe member path'
        assert m.isfile() or m.isdir(), 'Unexpected link or device'
    names = [PurePosixPath(m.name).as_posix() for m in members]
    assert len(names) == len(set(names)), 'Duplicate archive paths'
    manifests = [m for m in members if m.name == 'manifest.json']
    assert len(manifests) == 1 and manifests[0].size < 65536, 'Invalid manifest'
    manifest = json.load(archive.extractfile(manifests[0]))
    assert isinstance(manifest, list) and len(manifest) == 1, 'Exactly one image required'
    config = manifest[0]
    assert config['RepoTags'] == [f'wipster-backend:{source}'], 'Unexpected image tags'
    c = archive.getmember(config['Config'])
    assert c.isfile() and c.size < 1024 * 1024, 'Invalid image config'
    config_bytes = archive.extractfile(c).read()
    digest = hashlib.sha256(config_bytes).hexdigest()
    assert image == f'sha256:{digest}', 'Image config digest mismatch'
    image_config = json.loads(config_bytes)
    assert image_config.get('os') == 'linux' and image_config.get('architecture') == 'amd64', 'Unexpected image platform'
    assert image_config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == source, 'Unexpected source revision'
    assert ('oci-layout' in names) == ('index.json' in names), 'Incomplete OCI metadata'
    # Modern Docker may prefer OCI metadata over legacy manifest.json. Validate
    # both, so an archive cannot sneak in a second service tag through the index.
    if 'index.json' in names:
        layout = archive.getmember('oci-layout')
        assert layout.size < 1024, 'Invalid OCI layout'
        assert json.load(archive.extractfile(layout)) == {'imageLayoutVersion': '1.0.0'}, 'Invalid OCI layout version'
        entry = archive.getmember('index.json')
        assert entry.size < 65536, 'Invalid OCI index'
        index = json.load(archive.extractfile(entry))
        assert index.get('schemaVersion') == 2, 'Invalid OCI schema'
        assert isinstance(index['manifests'], list) and len(index['manifests']) == 1, 'One OCI image required'
        descriptor = index['manifests'][0]
        if 'platform' in descriptor:
            assert descriptor['platform'].get('os') == 'linux' and descriptor['platform'].get('architecture') == 'amd64', 'Unexpected OCI platform'
        annotations = descriptor.get('annotations', {})
        assert annotations.get('io.containerd.image.name', f'docker.io/library/wipster-backend:{source}') == f'docker.io/library/wipster-backend:{source}', 'Unexpected OCI image name'
        assert annotations.get('org.opencontainers.image.ref.name', source) == source, 'Unexpected OCI tag'
        assert descriptor['mediaType'] in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'), 'Nested OCI indexes are not accepted'
        algorithm, value = descriptor['digest'].split(':', 1)
        assert algorithm == 'sha256' and re.fullmatch(r'[0-9a-f]{64}', value), 'Invalid OCI digest'
        entry = archive.getmember(f'blobs/sha256/{value}')
        assert entry.size < 65536 and descriptor.get('size') == entry.size, 'Invalid OCI manifest'
        data = archive.extractfile(entry).read()
        assert hashlib.sha256(data).hexdigest() == value, 'OCI manifest digest mismatch'
        oci = json.loads(data)
        assert oci.get('schemaVersion') == 2, 'Invalid OCI manifest schema'
        assert oci['config']['digest'] == image and oci['config']['size'] == c.size, 'OCI/legacy image mismatch'
        config_blob = archive.getmember('blobs/sha256/' + image.split(':', 1)[1])
        assert config_blob.isfile() and config_blob.size == oci['config']['size'] == c.size, 'Invalid OCI config blob'
        oci_config_bytes = archive.extractfile(config_blob).read()
        assert 'sha256:' + hashlib.sha256(oci_config_bytes).hexdigest() == image, 'OCI config blob digest mismatch'
        assert oci_config_bytes == config_bytes, 'OCI/legacy config content mismatch'
        assert oci['config']['mediaType'] in ('application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json'), 'Invalid config media type'
        assert len(oci['layers']) == len(config['Layers']), 'OCI/legacy layers mismatch'
        for layer, legacy in zip(oci['layers'], config['Layers']):
            assert layer.get('mediaType') in ('application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.oci.image.layer.v1.tar+zstd', 'application/vnd.docker.image.rootfs.diff.tar', 'application/vnd.docker.image.rootfs.diff.tar.gzip'), 'Invalid OCI layer media type'
            assert type(layer.get('size')) is int and layer['size'] >= 0, 'Invalid OCI layer size'
            assert re.fullmatch(r'sha256:[0-9a-f]{64}', layer['digest']), 'Invalid layer digest'
            member = archive.getmember('blobs/sha256/' + layer['digest'].split(':')[1])
            assert member.isfile() and member.name == legacy and member.size == layer['size'], 'OCI/legacy layer mismatch'
            with archive.extractfile(member) as content:
                actual_layer = hashlib.file_digest(content, 'sha256').hexdigest()
            assert 'sha256:' + actual_layer == layer['digest'], 'OCI layer blob digest mismatch'
        oci_digest = descriptor['digest']
    if 'repositories' in names:
        entry = archive.getmember('repositories')
        assert entry.size < 65536, 'Invalid legacy repository metadata'
        repositories = json.load(archive.extractfile(entry))
        assert list(repositories) == ['wipster-backend'] and list(repositories['wipster-backend']) == [source], 'Unexpected legacy repository tags'
if args.machine:
    print(json.dumps(dict(config=image, manifest=oci_digest, source=source, os='linux', architecture='amd64')))
else:
    print('Single Wipster image archive verified')
