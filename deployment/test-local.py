#!/usr/bin/env python3
"""Verify independent updates/rollback against a representative legacy installation."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
import uuid


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--compose', help='Optional standalone Compose binary')
    args = parser.parse_args()
    compose_cli = [args.compose] if args.compose else ['docker', 'compose']
    repo = Path(__file__).resolve().parent.parent
    fixture = repo / 'infrastructure/initial-vps'
    prefix = 'sk-independent-' + uuid.uuid4().hex[:10]
    network_names = {name: prefix + '-' + name for name in ['mch-proxy', 'stillkey-proxy']}
    app_project = prefix + '-stillkey'
    commands, image_tags = {}, []
    baseline_tag = 'legacy-' + prefix
    initial_time = datetime(2099, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=int(uuid.uuid4().hex[:8], 16) % 30_000_000)
    with tempfile.TemporaryDirectory(prefix='stillkey-independent-test-') as directory:
        root = Path(directory)
        bundle = root / 'release'
        bundle.mkdir()
        with tarfile.open(args.bundle) as archive:
            names = archive.getnames()
            assert not any('myclinichelper' in name or '/gateway/' in name or 'bootstrap.sh' in name for name in names), 'Bundle includes unrelated infrastructure'
            archive.extractall(bundle, filter='data')
        assert (bundle / 'APPLICATION').read_text().strip() == 'stillkey'
        stack = root / 'installed'
        for app in ['gateway', 'myclinichelper', 'stillkey']:
            (stack / app).mkdir(parents=True)
        shared_env = stack / '.env'
        shared_env.write_text(f'RELEASE_ID={baseline_tag}\nACME_EMAIL=test@example.com\n')
        gateway = stack / 'gateway/Caddyfile'
        gateway.write_text((fixture / 'gateway/Caddyfile').read_text()
                           .replace('www.myclinichelper.com', 'http://www.clinic.test')
                           .replace('myclinichelper.com', 'http://clinic.test')
                           .replace('stillkey.paulhiggins.cloud', 'http://stillkey.test'))
        # Baseline site is deliberately synthetic; no mounted site or real patient data.
        clinic_context = root / 'clinic'
        (clinic_context / 'public').mkdir(parents=True)
        (clinic_context / 'public/index.html').write_text('<html>unrelated clinic application</html>')
        for name in ['Dockerfile', 'Caddyfile']:
            shutil.copy2(fixture / 'myclinichelper' / name, clinic_context / name)
        baseline_context = root / 'baseline'
        shutil.copytree(bundle / 'content/stillkey', baseline_context)
        (baseline_context / 'public/index.html').write_text('<html>Stillkey baseline</html>')
        baseline_image = f'local/stillkey:{baseline_tag}'
        clinic_image = f'local/{prefix}-clinic:baseline'
        image_tags.extend([baseline_image, clinic_image])
        try:
            for network in network_names.values():
                run(['docker', 'network', 'create', '--internal', network])
            run(['docker', 'build', '-q', '-t', baseline_image, str(baseline_context)])
            run(['docker', 'build', '-q', '-t', clinic_image, str(clinic_context)])
            for app in ['myclinichelper', 'stillkey', 'gateway']:
                source = fixture / app / 'compose.yaml'
                cfg = json.loads(run(compose_cli + ['--env-file', str(shared_env), '-f', str(source), 'config', '--format', 'json'], capture_output=True).stdout)
                project = app_project if app == 'stillkey' else prefix + '-' + app
                cfg['name'] = project
                for net in cfg['networks'].values():
                    net['name'] = network_names.get(net.get('name'), project + '-egress')
                service = cfg['services']['caddy' if app == 'gateway' else 'web']
                service['healthcheck']['interval'] = '1s'
                service['healthcheck']['retries'] = 2
                if app == 'gateway':
                    service['ports'] = [{'target': 80, 'published': '0', 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
                    service['volumes'][0]['source'] = str(stack / 'gateway')
                    for key, vol in cfg['volumes'].items():
                        vol['name'] = project + '-' + key
                elif app == 'myclinichelper':
                    service['image'] = clinic_image
                else:
                    # Keep unresolved legacy RELEASE_ID interpolation for the first real update.
                    original = (fixture / 'stillkey/compose.yaml').read_text()
                    original = original.replace('name: stillkey-proxy', 'name: ' + network_names['stillkey-proxy'])
                    original = original.replace('interval: 15s', 'interval: 1s').replace('retries: 4', 'retries: 2')
                    (stack / app / 'compose.yaml').write_text(original)
                if app != 'stillkey':
                    (stack / app / 'compose.yaml').write_text(json.dumps(cfg))
                command = compose_cli + ['-p', project, '--env-file', str(shared_env), '-f', str(stack / app / 'compose.yaml')]
                commands[app] = command
                run(command + ['up', '-d', '--wait', '--wait-timeout', '90'])
            port = run(commands['gateway'] + ['port', 'caddy', '80'], capture_output=True).stdout.strip().rsplit(':', 1)[1]
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(host):
                req = urllib.request.Request(f'http://127.0.0.1:{port}/', headers={'Host': host})
                with opener.open(req, timeout=15) as response:
                    assert response.status == 200
                    return response.read()

            def external_state():
                files = {str(p.relative_to(stack)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in stack.rglob('*') if p.is_file() and p.relative_to(stack).parts[0] != 'stillkey'}
                containers = {}
                for app in ['gateway', 'myclinichelper']:
                    service = 'caddy' if app == 'gateway' else 'web'
                    cid = run(commands[app] + ['ps', '--quiet', service], capture_output=True).stdout.strip()
                    state = json.loads(run(['docker', 'inspect', cid], capture_output=True).stdout)[0]
                    containers[app] = (cid, state['State']['StartedAt'], state['RestartCount'], state['Image'])
                return files, containers

            untouched = external_state()
            assert b'unrelated clinic' in request('clinic.test')
            assert b'baseline' in request('stillkey.test')
            test_env = {**os.environ, 'STILLKEY_PROJECT_NAME': app_project}
            if args.compose:
                test_env['STILLKEY_COMPOSE_BIN'] = args.compose
            template = bundle / 'setup/stillkey/compose.yaml'
            template.write_text(template.read_text().replace('interval: 15s', 'interval: 1s').replace('retries: 4', 'retries: 2'))
            release_ids = [(initial_time + timedelta(seconds=i)).strftime('%Y%m%dT%H%M%SZ') for i in range(3)]
            snapshots = []
            for index, release_id in enumerate(release_ids):
                tag = f'local/stillkey:{release_id}'
                assert subprocess.run(['docker', 'image', 'inspect', tag], capture_output=True).returncode != 0, 'Test release tag already exists'
                image_tags.append(tag)
                (bundle / 'RELEASE_ID').write_text(release_id + '\n')
                (bundle / 'content/stillkey/public/index.html').write_text(f'<html>Stillkey release {index + 1}</html>')
                if index == 2:
                    config = bundle / 'content/stillkey/Caddyfile'
                    config.write_text(config.read_text().replace('respond /healthz "ok" 200', 'respond /healthz "ok" 503'))
                    failed = subprocess.run(['bash', str(bundle / 'setup/deploy.sh'), '--stack-root', str(stack)], env=test_env)
                    assert failed.returncode != 0, 'Unhealthy update unexpectedly succeeded'
                    assert b'release 2' in request('stillkey.test'), 'Automatic rollback did not restore release 2'
                else:
                    run(['bash', str(bundle / 'setup/deploy.sh'), '--stack-root', str(stack)], env=test_env)
                    assert b'release ' + str(index + 1).encode() in request('stillkey.test')
                    assert f'RELEASE_ID={release_id}' in (stack / 'stillkey/.env').read_text()
                assert external_state() == untouched, 'Update changed shared files or unrelated containers'
                assert b'unrelated clinic' in request('clinic.test')
                snapshots = sorted((stack / 'stillkey/history').iterdir())
                assert len(snapshots) == index + 1
            # Restore all the way to the original shared-env baseline.
            run(['bash', str(bundle / 'setup/rollback.sh'), str(snapshots[0]), '--stack-root', str(stack)], env=test_env)
            assert b'baseline' in request('stillkey.test')
            assert external_state() == untouched, 'Manual rollback changed another app or gateway'
            print('PASS: app-only bundle; legacy shared-env transition; two independent updates; unhealthy-update rollback; manual rollback; shared files and gateway/clinic container identities unchanged.', flush=True)
        finally:
            for p in (stack / 'stillkey/history').glob('*/previous.compose.json'):
                image_tags.append(json.loads(p.read_text())['services']['web']['image'])
            for command in reversed(list(commands.values())):
                subprocess.run(command + ['logs', '--tail', '10'], check=False)
                subprocess.run(command + ['down', '--volumes', '--remove-orphans'], check=False)
            for network in network_names.values():
                subprocess.run(['docker', 'network', 'rm', network], check=False, stdout=subprocess.DEVNULL)
            for image in image_tags:
                subprocess.run(['docker', 'image', 'rm', image], check=False, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
