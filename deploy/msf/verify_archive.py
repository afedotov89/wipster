#!/usr/bin/env python3
"""Validate docker-save metadata without extracting or logging configuration."""
import hashlib
import json
import sys
import tarfile
from pathlib import PurePosixPath

path, source, image = sys.argv[1:]
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
    assert len(manifest) == 1, 'Exactly one image required'
    config = manifest[0]
    assert config['RepoTags'] == [f'wipster-backend:{source}'], 'Unexpected image tags'
    c = archive.getmember(config['Config'])
    assert c.size < 1024 * 1024, 'Invalid image config'
    digest = hashlib.sha256(archive.extractfile(c).read()).hexdigest()
    assert image == f'sha256:{digest}', 'Image config digest mismatch'
    # Modern Docker may prefer OCI metadata over legacy manifest.json. Validate
    # both, so an archive cannot sneak in a second service tag through the index.
    if 'index.json' in names:
        entry = archive.getmember('index.json')
        assert entry.size < 65536, 'Invalid OCI index'
        index = json.load(archive.extractfile(entry))
        assert len(index['manifests']) == 1, 'One OCI image required'
        descriptor = index['manifests'][0]
        annotations = descriptor.get('annotations', {})
        assert annotations.get('io.containerd.image.name', f'docker.io/library/wipster-backend:{source}') == f'docker.io/library/wipster-backend:{source}', 'Unexpected OCI image name'
        assert annotations.get('org.opencontainers.image.ref.name', source) == source, 'Unexpected OCI tag'
        assert descriptor['mediaType'] in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'), 'Nested OCI indexes are not accepted'
        algorithm, value = descriptor['digest'].split(':', 1)
        assert algorithm == 'sha256' and len(value) == 64, 'Invalid OCI digest'
        entry = archive.getmember(f'blobs/sha256/{value}')
        assert entry.size < 65536, 'Invalid OCI manifest'
        data = archive.extractfile(entry).read()
        assert hashlib.sha256(data).hexdigest() == value, 'OCI manifest digest mismatch'
        assert json.loads(data)['config']['digest'] == image, 'OCI/legacy image mismatch'
    if 'repositories' in names:
        entry = archive.getmember('repositories')
        assert entry.size < 65536, 'Invalid legacy repository metadata'
        repositories = json.load(archive.extractfile(entry))
        assert list(repositories) == ['wipster-backend'] and list(repositories['wipster-backend']) == [source], 'Unexpected legacy repository tags'
print('Single Wipster image archive verified')
