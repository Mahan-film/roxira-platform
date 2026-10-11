import { DockerEngineClient } from './docker-engine.client';

describe('DockerEngineClient.parseTarget', () => {
  const parse = (t: string) => DockerEngineClient.parseTarget(t);

  it('accepts an absolute socket path', () => {
    expect(parse('/var/run/docker.sock')).toEqual({
      socketPath: '/var/run/docker.sock',
    });
  });

  it('accepts unix:///path', () => {
    expect(parse('unix:///var/run/docker.sock')).toEqual({
      socketPath: '/var/run/docker.sock',
    });
  });

  it('accepts tcp:// and http:// with and without port', () => {
    expect(parse('tcp://docker-socket-proxy:2375')).toEqual({
      host: 'docker-socket-proxy',
      port: 2375,
    });
    expect(parse('http://10.0.0.5:2376/')).toEqual({ host: '10.0.0.5', port: 2376 });
    expect(parse('tcp://proxy')).toEqual({ host: 'proxy', port: 2375 });
  });

  it('accepts bracketed IPv6 and strips the brackets', () => {
    expect(parse('tcp://[::1]:2375')).toEqual({ host: '::1', port: 2375 });
    expect(parse('http://[fd00::2]')).toEqual({ host: 'fd00::2', port: 2375 });
  });

  it.each([
    '',
    '   ',
    'docker.sock',
    'relative/path.sock',
    'docker-socket-proxy:2375',
    'ftp://host:2375',
    'tcp://',
    'tcp://host:abc',
    'tcp://host:70000',
    'tcp://host:0',
    'tcp://host/extra/path',
    'unix://relative.sock',
    'tcp://[::1',
  ])('rejects garbage %p with a clear error', (bad) => {
    expect(() => parse(bad)).toThrow(/Docker target/);
  });
});
