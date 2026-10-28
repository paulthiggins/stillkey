#!/usr/bin/env python3
"""Rehearse real images/Compose config locally, without touching the VPS or ACME."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
import uuid


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--compose', help='Optional standalone docker-compose binary')
    args = parser.parse_args()
    compose_bin = [args.compose] if args.compose else ['docker', 'compose']
    prefix = 'stillkey-check-' + uuid.uuid4().hex[:10]
    networks = {name: prefix + '-' + name for name in ['mch-proxy', 'stillkey-proxy']}
    commands = {}
    images = []
    with tempfile.TemporaryDirectory(prefix='stillkey-container-test-') as temporary:
        root = Path(temporary)
        # Python's data filter refuses archive traversal and escaping links.
        with tarfile.open(args.bundle) as archive:
            archive.extractall(root, filter='data')
        env = root / 'test.env'
        env.write_text('ACME_EMAIL=test@example.com\nRELEASE_ID=test\n')
        gateway_file = root / 'setup/gateway/Caddyfile'
        original_gateway = gateway_file.read_text()
        try:
            run(['docker', 'run', '--rm', '--network', 'none', '-e', 'ACME_EMAIL=test@example.com',
                 '-v', f'{gateway_file}:/etc/caddy/Caddyfile:ro', 'caddy:2.11.7-alpine',
                 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
            gateway_file.write_text(original_gateway.replace('www.myclinichelper.com', 'http://www.myclinichelper.test')
                                    .replace('myclinichelper.com', 'http://myclinichelper.test')
                                    .replace('stillkey.paulhiggins.cloud', 'http://stillkey.test'))
            for name, network in networks.items():
                run(['docker', 'network', 'create', '--internal', network])
                result = run(['docker', 'network', 'inspect', '--format', '{{.Internal}}', network], capture_output=True)
                assert result.stdout.strip() == 'true', name
            for app in ['myclinichelper', 'stillkey']:
                image = f'local/{prefix}-{app}:test'
                images.append(image)
                run(['docker', 'build', '-q', '-t', image, str(root / 'content' / app)])
                run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'caddy', image,
                     'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
            for app in ['myclinichelper', 'stillkey', 'gateway']:
                source = root / 'setup' / app / 'compose.yaml'
                result = run(compose_bin + ['--env-file', str(env), '-f', str(source), 'config', '--format', 'json'], capture_output=True)
                config = json.loads(result.stdout)
                project = prefix + '-' + app
                config['name'] = project
                for network in config['networks'].values():
                    network['name'] = networks.get(network.get('name'), project + '-egress')
                if app == 'gateway':
                    config['services']['caddy']['ports'] = [{'target': 80, 'published': '0', 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
                    for key, volume in config.get('volumes', {}).items():
                        volume['name'] = project + '-' + key
                else:
                    assert not config['services']['web'].get('ports'), 'App publishes a port'
                    config['services']['web']['image'] = f'local/{prefix}-{app}:test'
                target = source.with_name('compose.test.json')
                target.write_text(json.dumps(config))
                command = compose_bin + ['-p', project, '-f', str(target)]
                commands[app] = command
                run(command + ['up', '-d', '--wait', '--wait-timeout', '90'])
            port_result = run(commands['gateway'] + ['port', 'caddy', '80'], capture_output=True)
            port = port_result.stdout.strip().rsplit(':', 1)[1]
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(host, path='/'):
                req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers={'Host': host})
                try:
                    response = opener.open(req, timeout=15)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    return response.status, response.headers, response.read()

            for host in ['myclinichelper.test', 'www.myclinichelper.test', 'stillkey.test']:
                status, _, body = request(host)
                assert status == 200 and b'<html' in body.lower(), host
                assert request(host, '/healthz')[2] == b'ok', host
                assert request(host, '/.env')[0] == 404, host
            _, headers, html = request('stillkey.test')
            assert 'frame-ancestors' in headers['Content-Security-Policy']
            assert headers['Cache-Control'] == 'no-cache'
            asset = re.search(rb'src="(/assets/[^"]+\.js)"', html).group(1).decode()
            assert 'immutable' in request('stillkey.test', asset)[1]['Cache-Control']
            assert request('stillkey.test', '/sw.js')[1]['Cache-Control'] == 'no-cache'
            assert request('stillkey.test', '/manifest.webmanifest')[0] == 200
            assert request('stillkey.test', '/assets/missing-file.js')[0] == 404
            assert request('stillkey.test', '/assets/missing-file.js')[1]['Cache-Control'] == 'no-cache'
            assert request('myclinichelper.test', '/cfg/patient_assessment_form.json')[0] == 200
            assert request('myclinichelper.test', '/favicon.ico')[0] == 200
            # Verify safe reload sees replaced files through the directory bind mount.
            gateway_file.write_text(gateway_file.read_text().replace('header {', 'header {\n\t\tX-Rehearsal verified'))
            run(commands['gateway'] + ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
            assert request('stillkey.test')[1]['X-Rehearsal'] == 'verified'
            run(commands['stillkey'] + ['restart'])
            run(commands['stillkey'] + ['up', '-d', '--wait', '--wait-timeout', '90'])
            assert request('stillkey.test')[0] == 200
            print('PASS: domain routing, health, private networks, public content, PWA/security/cache headers, 404s, Caddy reload, and app restart.')
        finally:
            for command in reversed(list(commands.values())):
                subprocess.run(command + ['logs', '--tail', '15'], check=False)
                subprocess.run(command + ['down', '--volumes', '--remove-orphans'], check=False)
            for network in networks.values():
                subprocess.run(['docker', 'network', 'rm', network], check=False, stdout=subprocess.DEVNULL)
            for image in images:
                subprocess.run(['docker', 'image', 'rm', image], check=False, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
